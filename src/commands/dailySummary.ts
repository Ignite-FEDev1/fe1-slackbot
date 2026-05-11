import { WebClient } from '@slack/web-api';
import { SLACK_USER_NAMES } from '../constant';
import { summarizeUserDoneFromDailyScrum } from '../llm/summarize';
import { KST_OFFSET_MS, nowKst, tsToKstDateLabel } from '../util/kst';
import { Command } from './types';

const TEAM_FE_DEV_CHANNEL = 'C04D0SD0S3B';
const DAILY_REMINDER_KEYWORD = '데일리 스크럼';
const TARGET_USER_ID = 'U04FUFTCGCC';

interface SlackMessage {
  ts: string;
  user?: string;
  text?: string;
  thread_ts?: string;
  reply_count?: number;
}

function getLastWeekRangeKST() {
  const now = nowKst();
  const kstDay = now.getUTCDay();
  const daysSinceMonday = kstDay === 0 ? 6 : kstDay - 1;

  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();

  const lastMondayUtcMs = Date.UTC(y, m, d - daysSinceMonday - 7) - KST_OFFSET_MS;
  const latestUtcMs = lastMondayUtcMs + 5 * 86400 * 1000 - 1; // 금요일 23:59:59.999 KST

  const labelKst = (utcMs: number) =>
    new Date(utcMs + KST_OFFSET_MS).toISOString().slice(0, 10);

  return {
    oldest: lastMondayUtcMs / 1000,
    latest: latestUtcMs / 1000,
    mondayLabel: labelKst(lastMondayUtcMs),
    fridayLabel: labelKst(lastMondayUtcMs + 4 * 86400 * 1000),
  };
}

// ── 지난주 데일리 스크럼 부모 메시지 조회 ─────────────────────────
async function fetchDailyScrumThreads(
  client: WebClient,
  channelId: string,
  oldest: number,
  latest: number
): Promise<SlackMessage[]> {
  const threads: SlackMessage[] = [];
  let cursor: string | undefined;

  do {
    const res = await client.conversations.history({
      channel: channelId,
      oldest: String(oldest),
      latest: String(latest),
      limit: 200,
      cursor,
    });

    const msgs = (res.messages ?? []) as SlackMessage[];
    for (const m of msgs) {
      if (m.text?.includes(DAILY_REMINDER_KEYWORD)) {
        threads.push(m);
      }
    }

    cursor = res.response_metadata?.next_cursor || undefined;
  } while (cursor);

  return threads;
}

// ── 한 쓰레드에서 특정 사용자 댓글 수집 ───────────────────────────
async function fetchUserRepliesInThread(
  client: WebClient,
  channelId: string,
  threadTs: string,
  targetUserId: string
): Promise<string[]> {
  const replies: string[] = [];
  let cursor: string | undefined;

  do {
    const res = await client.conversations.replies({
      channel: channelId,
      ts: threadTs,
      limit: 200,
      cursor,
    });

    const msgs = (res.messages ?? []) as SlackMessage[];
    for (const m of msgs) {
      if (m.user === targetUserId && m.text) {
        replies.push(m.text);
      }
    }

    cursor = res.response_metadata?.next_cursor || undefined;
  } while (cursor);

  return replies;
}

export const dailySummaryCommand: Command = {
  name: 'daily-summary',
  description: '[PoC] 지난주 데일리 스크럼에서 한 일 추출 (서성주 고정)',

  register() {
    // 별도 리스너 없음
  },

  async runSlash({ client, userId, channelId }) {
    const targetName = SLACK_USER_NAMES[TARGET_USER_ID] ?? TARGET_USER_ID;
    const range = getLastWeekRangeKST();

    await client.chat.postEphemeral({
      channel: channelId,
      user: userId,
      text: `⏳ ${range.mondayLabel} ~ ${range.fridayLabel} ${targetName}의 한 일 수집 중...`,
    });

    try {
      const threads = await fetchDailyScrumThreads(
        client,
        TEAM_FE_DEV_CHANNEL,
        range.oldest,
        range.latest
      );

      if (threads.length === 0) {
        await client.chat.postEphemeral({
          channel: channelId,
          user: userId,
          text: `❌ 지난주 데일리 스크럼 쓰레드를 찾을 수 없음 (${range.mondayLabel} ~ ${range.fridayLabel})\n채널: <#${TEAM_FE_DEV_CHANNEL}>`,
        });
        return;
      }

      const dailyBlocks: { date: string; texts: string[] }[] = [];
      for (const thread of threads) {
        const replies = await fetchUserRepliesInThread(
          client,
          TEAM_FE_DEV_CHANNEL,
          thread.ts,
          TARGET_USER_ID
        );
        if (replies.length > 0) {
          dailyBlocks.push({
            date: tsToKstDateLabel(thread.ts),
            texts: replies,
          });
        }
      }
      dailyBlocks.sort((a, b) => a.date.localeCompare(b.date));

      if (dailyBlocks.length === 0) {
        await client.chat.postEphemeral({
          channel: channelId,
          user: userId,
          text: `⚠️ 지난주 ${targetName}이(가) 작성한 댓글 없음 (쓰레드 ${threads.length}개 확인)`,
        });
        return;
      }

      const rawCombined = dailyBlocks
        .map((b) => `=== ${b.date} ===\n${b.texts.join('\n---\n')}`)
        .join('\n\n');

      const summary = await summarizeUserDoneFromDailyScrum(rawCombined, targetName);

      const debugRaw =
        rawCombined.length > 2500
          ? rawCombined.slice(0, 2500) + '\n\n...(잘림)'
          : rawCombined;

      await client.chat.postEphemeral({
        channel: channelId,
        user: userId,
        text: `${targetName}의 한 일 (${range.mondayLabel} ~ ${range.fridayLabel})`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `📋 *${targetName}의 한 일* (${range.mondayLabel} ~ ${range.fridayLabel})`,
            },
          },
          { type: 'divider' },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: summary || '⚠️ LLM 응답 실패',
            },
          },
          { type: 'divider' },
          {
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: `🔍 raw input (디버그, ${dailyBlocks.length}일치)`,
              },
            ],
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '```\n' + debugRaw + '\n```',
            },
          },
        ],
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[daily-summary] 실패:', msg);
      await client.chat.postEphemeral({
        channel: channelId,
        user: userId,
        text: `❌ 데일리 요약 실패: ${msg}`,
      });
    }
  },
};
