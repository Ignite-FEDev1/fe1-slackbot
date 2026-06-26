import { WebClient } from '@slack/web-api';
import { buildSlackPermalink } from './monthlyFetchers';
import { tsToKstDate } from './util/kst';

export interface InteractionMessage {
  channelId: string;
  ts: string;
  threadTs?: string;
  userId: string;
  text: string;
  date: string;
  permalink: string;
}

export interface TeammateInteractionResult {
  /** key = teammate slack user id */
  byTeammateId: Record<string, InteractionMessage[]>;
  failedChannels: { channelId: string; reason: string }[];
}

type TimeWindow = { oldestSec: number; latestSec: number };

interface RawMessage {
  ts: string;
  user?: string;
  text?: string;
  thread_ts?: string;
  reply_count?: number;
  reply_users?: string[];
}

const MENTION_RE = /<@(U[A-Z0-9]+|W[A-Z0-9]+)>/g;

const collectMentions = (text: string | undefined): Set<string> => {
  const out = new Set<string>();
  if (!text) return out;
  let m: RegExpExecArray | null;
  MENTION_RE.lastIndex = 0;
  while ((m = MENTION_RE.exec(text)) !== null) out.add(m[1]);
  return out;
};

const fetchAllHistory = async (
  client: WebClient,
  channelId: string,
  range: TimeWindow
): Promise<{ messages: RawMessage[]; ok: boolean; errorMsg?: string }> => {
  const all: RawMessage[] = [];
  let cursor: string | undefined;
  do {
    try {
      const res = await client.conversations.history({
        channel: channelId,
        oldest: String(range.oldestSec),
        latest: String(range.latestSec),
        limit: 200,
        cursor,
      });
      all.push(...((res.messages ?? []) as RawMessage[]));
      cursor = res.response_metadata?.next_cursor || undefined;
    } catch (e: any) {
      const errorMsg = e?.data?.error || e?.message || String(e);
      console.error(`[teammate-fetcher] history 실패 (${channelId}):`, errorMsg);
      return { messages: [], ok: false, errorMsg };
    }
  } while (cursor);
  return { messages: all, ok: true };
};

const fetchAllReplies = async (
  client: WebClient,
  channelId: string,
  threadTs: string
): Promise<RawMessage[]> => {
  const all: RawMessage[] = [];
  let cursor: string | undefined;
  try {
    do {
      const r = await client.conversations.replies({
        channel: channelId,
        ts: threadTs,
        limit: 200,
        cursor,
      });
      all.push(...((r.messages ?? []) as RawMessage[]));
      cursor = r.response_metadata?.next_cursor || undefined;
    } while (cursor);
  } catch (e) {
    console.error(`[teammate-fetcher] replies 실패 (${threadTs}):`, e);
  }
  return all;
};

/**
 * 채널 8개 × 월 단위 메시지에서, 본인 ↔ 각 팀원의 직접 상호작용 메시지를 팀원별로 분류.
 *
 * "직접 상호작용" 판정:
 *  - 본인이 작성한 top-level 메시지에서 팀원을 멘션
 *  - 팀원이 작성한 top-level 메시지에서 본인을 멘션
 *  - 같은 쓰레드에 본인 + 팀원이 모두 메시지를 남김 (작성 또는 멘션) → 그 쓰레드의 양쪽 메시지를 모두 포함
 */
export const fetchTeammateInteractions = async (
  client: WebClient,
  channelIds: string[],
  meUserId: string,
  teammateUserIds: string[],
  range: TimeWindow
): Promise<TeammateInteractionResult> => {
  const byTeammateId: Record<string, InteractionMessage[]> = {};
  for (const tid of teammateUserIds) byTeammateId[tid] = [];
  const failedChannels: { channelId: string; reason: string }[] = [];
  const teammateSet = new Set(teammateUserIds);

  // 채널 동시성 2 (monthly-report 와 동일 안전 수준)
  const CHANNEL_CONCURRENCY = 2;
  for (let i = 0; i < channelIds.length; i += CHANNEL_CONCURRENCY) {
    const batch = channelIds.slice(i, i + CHANNEL_CONCURRENCY);
    const channelResults = await Promise.all(
      batch.map(async (channelId) => {
        const { messages: parents, ok, errorMsg } = await fetchAllHistory(
          client,
          channelId,
          range
        );
        if (!ok) {
          return { channelId, failed: true, reason: errorMsg ?? 'unknown' };
        }

        // 후보 쓰레드: 본인 또는 팀원이 작성/언급/참여한 메시지 (replies 가져올 후보)
        const seenThread = new Set<string>();
        const threadCandidates: RawMessage[] = [];
        for (const p of parents) {
          const mentions = collectMentions(p.text);
          const userMatch =
            p.user === meUserId ||
            (p.user && teammateSet.has(p.user)) ||
            mentions.has(meUserId) ||
            [...mentions].some((u) => teammateSet.has(u));
          const replyUsers = Array.isArray(p.reply_users) ? p.reply_users : [];
          const replyMatch =
            (p.reply_count ?? 0) > 0 &&
            (replyUsers.includes(meUserId) ||
              replyUsers.some((u) => teammateSet.has(u)) ||
              // reply_users 가 잘려 보일 수 있어 보수적으로 본인 등장 시 포함
              p.user === meUserId);
          if (!userMatch && !replyMatch) continue;
          const key = p.thread_ts ?? p.ts;
          if (seenThread.has(key)) continue;
          seenThread.add(key);
          threadCandidates.push(p);
        }

        // 후보 쓰레드의 전체 replies 수집 (parent + replies)
        const THREAD_CONCURRENCY = 6;
        type ThreadMsgs = { parent: RawMessage; messages: RawMessage[] };
        const threadResults: ThreadMsgs[] = [];
        for (let j = 0; j < threadCandidates.length; j += THREAD_CONCURRENCY) {
          const tb = threadCandidates.slice(j, j + THREAD_CONCURRENCY);
          const arr = await Promise.all(
            tb.map(async (parent) => {
              const threadKey = parent.thread_ts ?? parent.ts;
              const hasReplies = (parent.reply_count ?? 0) > 0;
              if (!hasReplies) {
                return { parent, messages: [parent] } satisfies ThreadMsgs;
              }
              const all = await fetchAllReplies(client, channelId, threadKey);
              // parent 가 history 결과의 broadcast reply 형태로 들어왔다면
              // all 안에 진짜 parent + 모든 reply 가 모두 들어있음
              return { parent, messages: all.length > 0 ? all : [parent] };
            })
          );
          threadResults.push(...arr);
        }

        // 각 쓰레드에서 본인/팀원 상호작용 추출
        const localBuckets: Record<string, InteractionMessage[]> = {};
        for (const tid of teammateUserIds) localBuckets[tid] = [];

        for (const t of threadResults) {
          const inWindow = (m: RawMessage) => {
            const n = parseFloat(m.ts);
            return n >= range.oldestSec && n <= range.latestSec;
          };

          // 쓰레드 참여자 + 멘션된 사용자 집합 (작성자 + 본문 멘션 모두 포함)
          const participants = new Set<string>();
          const mentionedAny = new Set<string>();
          for (const m of t.messages) {
            if (m.user) participants.add(m.user);
            for (const u of collectMentions(m.text)) mentionedAny.add(u);
          }
          const meInThread =
            participants.has(meUserId) || mentionedAny.has(meUserId);

          for (const teammateId of teammateUserIds) {
            const teammateInThread =
              participants.has(teammateId) || mentionedAny.has(teammateId);
            // 본인과 팀원이 모두 쓰레드에 등장해야 "직접 상호작용"
            if (!(meInThread && teammateInThread)) continue;

            // 쓰레드 메시지 중 본인 OR 팀원이 작성한 메시지만 수집
            // (다른 사람 메시지가 섞이지 않게)
            for (const m of t.messages) {
              if (!m.text || !m.user) continue;
              if (m.user !== meUserId && m.user !== teammateId) continue;
              if (!inWindow(m)) continue;
              localBuckets[teammateId].push({
                channelId,
                ts: m.ts,
                threadTs: m.thread_ts && m.thread_ts !== m.ts ? m.thread_ts : undefined,
                userId: m.user,
                text: m.text,
                date: tsToKstDate(m.ts),
                permalink: buildSlackPermalink(
                  channelId,
                  m.ts,
                  m.thread_ts && m.thread_ts !== m.ts ? m.thread_ts : undefined
                ),
              });
            }
          }
        }

        return { channelId, failed: false, buckets: localBuckets };
      })
    );

    for (const r of channelResults) {
      if (r.failed) {
        failedChannels.push({ channelId: r.channelId, reason: r.reason ?? 'unknown' });
        continue;
      }
      for (const teammateId of teammateUserIds) {
        byTeammateId[teammateId].push(...r.buckets![teammateId]);
      }
    }
  }

  // 중복 제거 (같은 ts/channel 중복) + 시간순 정렬
  for (const teammateId of teammateUserIds) {
    const seen = new Set<string>();
    const dedup: InteractionMessage[] = [];
    for (const m of byTeammateId[teammateId]) {
      const key = `${m.channelId}:${m.ts}`;
      if (seen.has(key)) continue;
      seen.add(key);
      dedup.push(m);
    }
    dedup.sort((a, b) => parseFloat(a.ts) - parseFloat(b.ts));
    byTeammateId[teammateId] = dedup;
  }

  return { byTeammateId, failedChannels };
};
