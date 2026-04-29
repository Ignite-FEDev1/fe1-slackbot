import axios from 'axios';
import { WebClient } from '@slack/web-api';
import { MONTHLY_REPORT_GITLAB_PROJECTS } from './constant';
import { buildKstMonthRange, MonthRange, tsToKstDate } from './util/kst';

export { buildKstMonthRange, type MonthRange };

const SLACK_WORKSPACE_HOST = 'ignite0830.slack.com';
const CONFLUENCE_HOST = 'https://ignitecorp.atlassian.net/wiki';

export const JIRA_HOSTS = {
  ignite: 'https://ignitecorp.atlassian.net',
  hmg: 'https://hmg.atlassian.net',
} as const;
export type JiraInstance = keyof typeof JIRA_HOSTS;

export const buildSlackPermalink = (channelId: string, ts: string): string => {
  const tsNoDot = ts.replace('.', '');
  return `https://${SLACK_WORKSPACE_HOST}/archives/${channelId}/p${tsNoDot}`;
};

// ─── Slack 멀티 채널 수집 ──────────────────────────────────────────

export interface SlackUserMessage {
  channelId: string;
  ts: string;
  text: string;
  date: string;
  permalink: string;
}

// 50자 이상이어도 멘션 1~2개 + 짧은 한 마디만 있는 메시지는 성과로 보지 않는다.
const MENTION_ONLY_RE = /^<@U[A-Z0-9]+>\s*\S{0,20}$/;

export const isAchievementWorthy = (text: string, minLength = 50): boolean => {
  const t = text.trim();
  if (t.length < minLength) return false;
  if (MENTION_ONLY_RE.test(t)) return false;
  return true;
};

interface OneChannelResult {
  messages: SlackUserMessage[];
  ok: boolean;
  errorMsg?: string;
}

const fetchSlackOneChannel = async (
  client: WebClient,
  channelId: string,
  triggerUserId: string,
  range: MonthRange
): Promise<OneChannelResult> => {
  const results: SlackUserMessage[] = [];
  const seenTs = new Set<string>();

  const parents: Array<{
    ts: string;
    user?: string;
    text?: string;
    reply_count?: number;
    reply_users?: string[];
  }> = [];
  let cursor: string | undefined;
  let errorMsg: string | undefined;

  do {
    try {
      const res = await client.conversations.history({
        channel: channelId,
        oldest: String(range.oldestSec),
        latest: String(range.latestSec),
        limit: 200,
        cursor,
      });
      const msgs = (res.messages ?? []) as typeof parents;
      parents.push(...msgs);
      cursor = res.response_metadata?.next_cursor || undefined;
    } catch (e: any) {
      errorMsg = e?.data?.error || e?.message || String(e);
      console.error(`[slack-fetcher] history 실패 (${channelId}):`, errorMsg);
      return { messages: [], ok: false, errorMsg };
    }
  } while (cursor);

  for (const p of parents) {
    if (p.user === triggerUserId && p.text && !seenTs.has(p.ts)) {
      results.push({
        channelId,
        ts: p.ts,
        text: p.text,
        date: tsToKstDate(p.ts),
        permalink: buildSlackPermalink(channelId, p.ts),
      });
      seenTs.add(p.ts);
    }
  }

  // reply_users 에 본인 ID 가 있는 쓰레드만 replies 호출 → tier-3 rate limit 회피.
  // reply_users 가 없는(undefined) 메시지는 Slack 이 reply_users 미반환할 수 있어 보수적으로 포함.
  const withThreads = parents.filter((p) => {
    if ((p.reply_count ?? 0) === 0) return false;
    if (Array.isArray(p.reply_users)) return p.reply_users.includes(triggerUserId);
    return true;
  });
  const CONCURRENCY = 6;
  for (let i = 0; i < withThreads.length; i += CONCURRENCY) {
    const batch = withThreads.slice(i, i + CONCURRENCY);
    const batchRes = await Promise.all(
      batch.map(async (parent) => {
        const matches: SlackUserMessage[] = [];
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
              const tsNum = parseFloat(m.ts);
              if (tsNum < range.oldestSec || tsNum > range.latestSec) continue;
              if (m.user === triggerUserId && m.text) {
                matches.push({
                  channelId,
                  ts: m.ts,
                  text: m.text,
                  date: tsToKstDate(m.ts),
                  permalink: buildSlackPermalink(channelId, m.ts),
                });
              }
            }
            rcursor = r.response_metadata?.next_cursor || undefined;
          } while (rcursor);
        } catch (e) {
          console.error(`[slack-fetcher] replies 실패 (${parent.ts}):`, e);
        }
        return matches;
      })
    );
    for (const arr of batchRes) {
      for (const m of arr) {
        if (!seenTs.has(m.ts)) {
          results.push(m);
          seenTs.add(m.ts);
        }
      }
    }
  }

  return { messages: results, ok: true };
};

export interface SlackMultiResult {
  messages: SlackUserMessage[];
  failedChannels: { channelId: string; reason: string }[];
}

export const fetchSlackMultiChannel = async (
  client: WebClient,
  channelIds: string[],
  triggerUserId: string,
  range: MonthRange
): Promise<SlackMultiResult> => {
  const all: SlackUserMessage[] = [];
  const failedChannels: { channelId: string; reason: string }[] = [];
  // 동시성 2 — 8 채널 × 쓰레드 병렬 6 = 최대 12 in-flight, Slack tier-3 한도 안전.
  const CONCURRENCY = 2;
  for (let i = 0; i < channelIds.length; i += CONCURRENCY) {
    const batch = channelIds.slice(i, i + CONCURRENCY);
    const res = await Promise.all(
      batch.map((cid) => fetchSlackOneChannel(client, cid, triggerUserId, range))
    );
    res.forEach((r, idx) => {
      if (r.ok) {
        all.push(...r.messages);
      } else {
        failedChannels.push({
          channelId: batch[idx],
          reason: r.errorMsg ?? 'unknown',
        });
      }
    });
  }
  return {
    messages: all.filter((m) => isAchievementWorthy(m.text)),
    failedChannels,
  };
};

// ─── Jira 본인 활동 ─────────────────────────────────────────────────

export interface JiraIssue {
  key: string;
  summary: string;
  status: string;
  url: string;
  resolved?: string;
  instance: JiraInstance;
  projectKey: string;
  projectName: string;
  epicSummary?: string;
}

interface JiraSearchResponse {
  issues?: Array<{
    key: string;
    fields: {
      summary: string;
      status: { name: string };
      resolutiondate?: string;
      project?: { key: string; name: string };
      parent?: { fields?: { summary?: string; issuetype?: { name?: string } } };
    };
  }>;
  nextPageToken?: string;
  isLast?: boolean;
}

export const fetchJiraMonthlyIssues = async (
  instance: JiraInstance,
  auth: { email: string; token: string },
  jiraAccountId: string,
  range: MonthRange,
  projectKeys?: string[]
): Promise<JiraIssue[]> => {
  const host = JIRA_HOSTS[instance];
  const projectClause =
    projectKeys && projectKeys.length > 0
      ? `project IN (${projectKeys.map((k) => `"${k}"`).join(', ')}) AND `
      : '';
  const jql =
    `${projectClause}` +
    `assignee = "${jiraAccountId}" ` +
    `AND updated >= "${range.yearMonth}-01" AND updated < "${nextMonthFirst(range.yearMonth)}" ` +
    `ORDER BY updated DESC`;

  // parent 는 epic 또는 상위 task. issuetype.name 으로 epic 여부 분류 가능.
  const fields = 'summary,status,resolutiondate,updated,project,parent';
  const maxResults = 100;
  const issues: JiraIssue[] = [];

  try {
    let nextPageToken: string | undefined;
    for (let i = 0; i < 10; i++) {
      const res = await axios.get<JiraSearchResponse>(
        `${host}/rest/api/3/search/jql`,
        {
          params: {
            jql,
            fields,
            maxResults,
            ...(nextPageToken ? { nextPageToken } : {}),
          },
          auth: { username: auth.email, password: auth.token },
          timeout: 30000,
        }
      );
      const data = res.data ?? {};
      const batch = data.issues ?? [];
      for (const issue of batch) {
        const parent = issue.fields.parent;
        const isEpicParent = parent?.fields?.issuetype?.name?.toLowerCase() === 'epic';
        issues.push({
          key: issue.key,
          summary: issue.fields.summary,
          status: issue.fields.status?.name ?? '',
          url: `${host}/browse/${issue.key}`,
          resolved: issue.fields.resolutiondate?.slice(0, 10),
          instance,
          projectKey: issue.fields.project?.key ?? '',
          projectName: issue.fields.project?.name ?? issue.fields.project?.key ?? '',
          epicSummary: isEpicParent ? parent?.fields?.summary : undefined,
        });
      }
      if (data.isLast || !data.nextPageToken) break;
      nextPageToken = data.nextPageToken;
    }
    console.log(`[jira-fetcher] ${instance}: ${issues.length}건`);
    return issues;
  } catch (e: any) {
    console.error(
      `[jira-fetcher] ${instance} 실패:`,
      e?.response?.status,
      e?.response?.data?.errorMessages || e?.message
    );
    return issues;
  }
};

const nextMonthFirst = (ym: string): string => {
  const [y, m] = ym.split('-').map((s) => parseInt(s, 10));
  if (m === 12) return `${y + 1}-01-01`;
  return `${y}-${String(m + 1).padStart(2, '0')}-01`;
};

// ─── Confluence 본인 활동 ───────────────────────────────────────────

export interface ConfluencePage {
  title: string;
  url: string;
  spaceKey: string;
  type: 'created' | 'modified';
  date: string;
}

export const fetchConfluenceMonthlyPages = async (
  auth: { email: string; token: string },
  jiraAccountId: string,
  range: MonthRange
): Promise<ConfluencePage[]> => {
  // CQL 필드명은 소문자: lastmodified (camelCase 는 일부 인스턴스에서 무시됨)
  const cql =
    `type = page AND ` +
    `(creator = "${jiraAccountId}" OR contributor = "${jiraAccountId}") AND ` +
    `lastmodified >= "${range.yearMonth}-01" AND lastmodified < "${nextMonthFirst(range.yearMonth)}" ` +
    `ORDER BY lastmodified DESC`;

  console.log('[confluence-fetcher] CQL:', cql);

  try {
    const res = await axios.get(`${CONFLUENCE_HOST}/rest/api/content/search`, {
      params: { cql, limit: 100, expand: 'history,space,version' },
      auth: { username: auth.email, password: auth.token },
      timeout: 30000,
    });
    const pages = (res.data?.results ?? []) as Array<{
      title: string;
      _links: { webui: string };
      space?: { key: string };
      history?: { createdBy?: { accountId?: string }; createdDate?: string };
      version?: { when?: string };
    }>;
    console.log(
      `[confluence-fetcher] 응답: status=${res.status}, results=${pages.length}, totalSize=${res.data?.totalSize ?? '?'}, size=${res.data?.size ?? '?'}`
    );
    if (pages.length > 0) {
      console.log(
        `[confluence-fetcher] 첫 페이지 샘플: title="${pages[0].title}", creator=${pages[0].history?.createdBy?.accountId}`
      );
    }
    return pages.map((p) => {
      const isCreator = p.history?.createdBy?.accountId === jiraAccountId;
      return {
        title: p.title,
        url: `${CONFLUENCE_HOST}${p._links.webui}`,
        spaceKey: p.space?.key ?? '',
        type: isCreator ? 'created' : 'modified',
        date:
          (isCreator ? p.history?.createdDate : p.version?.when)?.slice(0, 10) ??
          '',
      };
    });
  } catch (e: any) {
    const status = e?.response?.status;
    const data = e?.response?.data;
    console.error(
      '[confluence-fetcher] 실패:',
      'status=', status,
      'data=', data ? JSON.stringify(data).slice(0, 500) : undefined,
      'message=', e?.message
    );
    return [];
  }
};

// ─── GitLab MR 조회 ─────────────────────────────────────────────────

export interface GitlabMR {
  project: string;
  iid: number;
  title: string;
  state: string;
  url: string;
  createdAt: string;
  mergedAt?: string;
}

export interface GitlabFetchResult {
  mrs: GitlabMR[];
  ok: boolean;
  reason?: string;
}

const classifyGitlabError = (e: any): string => {
  const code = e?.code;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return 'Lambda 외부망에서 사내 GitLab 도달 불가 (DNS resolve 실패)';
  }
  if (code === 'ECONNREFUSED' || code === 'ETIMEDOUT') {
    return `네트워크 연결 실패 (${code})`;
  }
  const status = e?.response?.status;
  if (status === 401 || status === 403) return `권한 거부 (HTTP ${status})`;
  return e?.response?.data?.message || e?.message || String(e);
};

const fetchGitlabUsername = async (
  baseUrl: string,
  token: string
): Promise<{ username: string | null; reason?: string }> => {
  try {
    const res = await axios.get(`${baseUrl}/api/v4/user`, {
      headers: { 'PRIVATE-TOKEN': token },
      timeout: 15000,
    });
    return { username: res.data?.username ?? null };
  } catch (e: any) {
    const reason = classifyGitlabError(e);
    console.error('[gitlab-fetcher] /user 실패:', reason);
    return { username: null, reason };
  }
};

export const fetchGitlabMonthlyMRs = async (
  baseUrl: string,
  token: string,
  range: MonthRange
): Promise<GitlabFetchResult> => {
  const { username, reason } = await fetchGitlabUsername(baseUrl, token);
  if (!username) {
    return { mrs: [], ok: false, reason: reason ?? 'username 조회 실패' };
  }
  console.log(`[gitlab-fetcher] author_username=${username}`);

  const all: GitlabMR[] = [];
  // 프로젝트 4개 병렬
  const results = await Promise.all(
    MONTHLY_REPORT_GITLAB_PROJECTS.map(async (projectPath) => {
      const encodedPath = encodeURIComponent(projectPath);
      const url = `${baseUrl}/api/v4/projects/${encodedPath}/merge_requests`;
      const mrs: GitlabMR[] = [];
      try {
        // 페이지네이션 (보통 한달치 MR 100개 미만)
        const res = await axios.get(url, {
          headers: { 'PRIVATE-TOKEN': token },
          params: {
            author_username: username,
            updated_after: range.isoStart,
            updated_before: range.isoEnd,
            state: 'all',
            per_page: 100,
            order_by: 'updated_at',
            sort: 'desc',
          },
          timeout: 30000,
        });
        const data = res.data as Array<{
          iid: number;
          title: string;
          state: string;
          web_url: string;
          created_at: string;
          merged_at?: string;
        }>;
        for (const m of data) {
          mrs.push({
            project: projectPath,
            iid: m.iid,
            title: m.title,
            state: m.state,
            url: m.web_url,
            createdAt: m.created_at.slice(0, 10),
            mergedAt: m.merged_at?.slice(0, 10),
          });
        }
      } catch (e: any) {
        console.error(
          `[gitlab-fetcher] ${projectPath} 실패:`,
          e?.response?.status,
          e?.response?.data?.message || e?.message
        );
      }
      return mrs;
    })
  );
  for (const arr of results) all.push(...arr);
  return { mrs: all, ok: true };
};
