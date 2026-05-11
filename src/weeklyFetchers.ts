import axios from 'axios';
import { WebClient } from '@slack/web-api';
import { JIRA_HOSTS } from './monthlyFetchers';
import {
  buildKstWeekRange,
  tsToKstDate,
  tsToKstDateLabel,
  WeekRange,
} from './util/kst';

export { buildKstWeekRange, type WeekRange };

// ─── 데일리 스크럼 쓰레드 → 본인 댓글 raw 수집 ────────────────────

export interface DailyScrumReply {
  date: string; // 쓰레드 parent 의 KST 일자 'YYYY-MM-DD'
  dateLabel: string; // 'YYYY-MM-DD (요일)'
  ts: string; // 본인 댓글 ts
  text: string; // 본인 댓글 본문
}

const DAILY_SCRUM_KEYWORDS = ['데일리 스크럼', '데일리스크럼'];

const isDailyScrumParent = (msg: { subtype?: string; text?: string }): boolean => {
  if (!msg.text) return false;
  // Slackbot 리마인더는 subtype === 'bot_message' 또는 'reminder_add'.
  // 안전하게 본문 키워드만으로도 매칭.
  return DAILY_SCRUM_KEYWORDS.some((kw) => msg.text!.includes(kw));
};

/**
 * 한 주(월~금)의 데일리 스크럼 쓰레드에서 triggerUserId 가 단 모든 댓글을 수집.
 * 한 일/할 일 분류는 LLM 에 위임 — 여기서는 raw 그대로 반환.
 */
export const fetchDailyScrumWeeklyReplies = async (
  client: WebClient,
  channelId: string,
  triggerUserId: string,
  range: WeekRange
): Promise<DailyScrumReply[]> => {
  const parents: Array<{ ts: string; text?: string; subtype?: string; reply_count?: number }> = [];
  let cursor: string | undefined;
  do {
    const res = await client.conversations.history({
      channel: channelId,
      oldest: String(range.oldestSec),
      latest: String(range.latestSec),
      limit: 200,
      cursor,
    });
    parents.push(...((res.messages ?? []) as typeof parents));
    cursor = res.response_metadata?.next_cursor || undefined;
  } while (cursor);

  const scrumParents = parents.filter(
    (p) => isDailyScrumParent(p) && (p.reply_count ?? 0) > 0
  );
  console.log(
    `[weekly-fetcher] daily-scrum parent: total=${parents.length}, scrum=${scrumParents.length}`
  );

  const all: DailyScrumReply[] = [];
  // 5개 쓰레드(월~금)뿐이라 동시성 5 안전.
  const results = await Promise.all(
    scrumParents.map(async (parent) => {
      const matches: DailyScrumReply[] = [];
      const date = tsToKstDate(parent.ts);
      const dateLabel = tsToKstDateLabel(parent.ts);
      try {
        let rcursor: string | undefined;
        do {
          const r = await client.conversations.replies({
            channel: channelId,
            ts: parent.ts,
            limit: 200,
            cursor: rcursor,
          });
          const replies = (r.messages ?? []) as Array<{
            ts: string;
            user?: string;
            text?: string;
          }>;
          for (const m of replies) {
            if (m.ts === parent.ts) continue;
            if (m.user !== triggerUserId) continue;
            if (!m.text) continue;
            matches.push({ date, dateLabel, ts: m.ts, text: m.text });
          }
          rcursor = r.response_metadata?.next_cursor || undefined;
        } while (rcursor);
      } catch (e) {
        console.error(`[weekly-fetcher] replies 실패 (${parent.ts}):`, e);
      }
      return matches;
    })
  );
  for (const arr of results) all.push(...arr);
  // ts 오름차순 = 시간순 (월요일 → 금요일, 같은 날은 아침 → 저녁)
  all.sort((a, b) => parseFloat(a.ts) - parseFloat(b.ts));
  return all;
};

// ─── Jira FEHG 다음 주 진행 티켓 ───────────────────────────────────

export interface NextWeekJiraIssue {
  key: string;
  summary: string;
  status: string;
  url: string;
  startDate?: string;
  dueDate?: string;
  epicSummary?: string;
}

interface JiraSearchResponse {
  issues?: Array<{
    key: string;
    fields: {
      summary: string;
      status: { name: string };
      duedate?: string;
      customfield_10015?: string; // startDate
      parent?: { fields?: { summary?: string; issuetype?: { name?: string } } };
    };
  }>;
  nextPageToken?: string;
  isLast?: boolean;
}

/**
 * 다음 주(월~금) 작업 기간이 걸쳐 있는 본인 FEHG 티켓.
 * 시작일 ≤ 다음주_금 AND 종료일 ≥ 다음주_월 AND statusCategory != Done.
 */
export const fetchJiraNextWeekIssues = async (
  auth: { email: string; token: string },
  jiraAccountId: string,
  nextWeek: WeekRange
): Promise<NextWeekJiraIssue[]> => {
  const host = JIRA_HOSTS.ignite;
  const jql =
    `project = FEHG ` +
    `AND assignee = "${jiraAccountId}" ` +
    `AND statusCategory != Done ` +
    `AND cf[10015] <= "${nextWeek.friday}" ` +
    `AND duedate >= "${nextWeek.monday}" ` +
    `ORDER BY cf[10015] ASC`;

  const fields = 'summary,status,duedate,customfield_10015,parent';
  const issues: NextWeekJiraIssue[] = [];
  try {
    let nextPageToken: string | undefined;
    for (let i = 0; i < 5; i++) {
      const res = await axios.get<JiraSearchResponse>(
        `${host}/rest/api/3/search/jql`,
        {
          params: {
            jql,
            fields,
            maxResults: 100,
            ...(nextPageToken ? { nextPageToken } : {}),
          },
          auth: { username: auth.email, password: auth.token },
          timeout: 30000,
        }
      );
      const data = res.data ?? {};
      for (const issue of data.issues ?? []) {
        const parent = issue.fields.parent;
        const isEpic = parent?.fields?.issuetype?.name?.toLowerCase() === 'epic';
        issues.push({
          key: issue.key,
          summary: issue.fields.summary,
          status: issue.fields.status?.name ?? '',
          url: `${host}/browse/${issue.key}`,
          startDate: issue.fields.customfield_10015,
          dueDate: issue.fields.duedate,
          epicSummary: isEpic ? parent?.fields?.summary : undefined,
        });
      }
      if (data.isLast || !data.nextPageToken) break;
      nextPageToken = data.nextPageToken;
    }
    console.log(`[weekly-fetcher] jira next-week: ${issues.length}건`);
    return issues;
  } catch (e: any) {
    console.error(
      '[weekly-fetcher] jira next-week 실패:',
      e?.response?.status,
      e?.response?.data?.errorMessages || e?.message
    );
    return issues;
  }
};
