import { App, MessageShortcut } from '@slack/bolt';
import axios from 'axios';
import { SLACK_JIRA_USER_MAP } from '../constant';
import { getJiraCredsByAccountId } from '../db';
import { Command } from './types';

const CONFLUENCE_HOST = 'https://ignitecorp.atlassian.net/wiki';
const SPACE_KEY = 'IF';
const ROOT_PAGE_ID = '1323532404';
const WEEKLY_DATE_RE = /(\d{4}-\d{2}-\d{2})/;
const MAX_RESULTS = 3;

const SHORTCUT_ID = 'create_weekly_document';
const FE1_USERGROUP_ID = 'S06J9P5HQ2U';

interface ConfluencePage {
  id: string;
  title: string;
  _links: { webui: string };
}

interface ConfluencePageDetail {
  id: string;
  title: string;
  body: { storage: { value: string } };
  _links: { webui: string };
}

// ── 공통: 인증 조회 ────────────────────────────────────────────────
async function getIgniteAuth(slackUserId: string) {
  const accountId = SLACK_JIRA_USER_MAP[slackUserId];
  if (!accountId) return null;
  const creds = await getJiraCredsByAccountId(accountId);
  if (!creds?.igniteJiraEmail || !creds?.igniteJiraApiToken) return null;
  return { email: creds.igniteJiraEmail, token: creds.igniteJiraApiToken };
}

// ── 위클리 목록 조회 ───────────────────────────────────────────────
async function fetchRecentWeeklies(auth: { email: string; token: string }) {
  const res = await axios.get(`${CONFLUENCE_HOST}/rest/api/content/${ROOT_PAGE_ID}/child/page`, {
    params: { limit: 50, start: 0 },
    auth: { username: auth.email, password: auth.token },
  });

  const pages: ConfluencePage[] = res.data.results ?? [];

  return pages
    .filter((p) => WEEKLY_DATE_RE.test(p.title))
    .map((p) => {
      const date = p.title.match(WEEKLY_DATE_RE)![1];
      return {
        title: p.title,
        date,
        url: `${CONFLUENCE_HOST}${p._links.webui}`,
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, MAX_RESULTS)
    .reverse();
}

// ── 최신 위클리 페이지 상세 조회 ────────────────────────────────────
async function fetchLatestWeeklyDetail(
  auth: { email: string; token: string }
): Promise<ConfluencePageDetail | null> {
  const res = await axios.get(`${CONFLUENCE_HOST}/rest/api/content/${ROOT_PAGE_ID}/child/page`, {
    params: { limit: 50, start: 0 },
    auth: { username: auth.email, password: auth.token },
  });

  const pages: ConfluencePage[] = res.data.results ?? [];
  const latest = pages
    .filter((p) => WEEKLY_DATE_RE.test(p.title))
    .sort((a, b) => {
      const da = a.title.match(WEEKLY_DATE_RE)![1];
      const db = b.title.match(WEEKLY_DATE_RE)![1];
      return db.localeCompare(da);
    })[0];

  if (!latest) return null;

  const detail = await axios.get(
    `${CONFLUENCE_HOST}/rest/api/content/${latest.id}?expand=body.storage`,
    { auth: { username: auth.email, password: auth.token } }
  );

  return detail.data;
}

// ── 날짜 +7일 ──────────────────────────────────────────────────────
function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// ── 위클리 제목에서 날짜 추출 후 새 제목 생성 ──────────────────────
function buildNextWeeklyTitle(currentTitle: string): { newTitle: string; newDate: string } | null {
  const match = currentTitle.match(WEEKLY_DATE_RE);
  if (!match) return null;
  const newDate = addDays(match[1], 7);
  const newTitle = currentTitle.replace(match[1], newDate);
  return { newTitle, newDate };
}

// ── Confluence 페이지 생성 ─────────────────────────────────────────
async function createWeeklyPage(
  auth: { email: string; token: string },
  title: string,
  body: string
): Promise<{ id: string; url: string }> {
  const res = await axios.post(
    `${CONFLUENCE_HOST}/rest/api/content`,
    {
      type: 'page',
      title,
      space: { key: SPACE_KEY },
      ancestors: [{ id: ROOT_PAGE_ID }],
      body: { storage: { value: body, representation: 'storage' } },
    },
    {
      auth: { username: auth.email, password: auth.token },
      headers: { 'Content-Type': 'application/json' },
    }
  );

  return {
    id: res.data.id,
    url: `${CONFLUENCE_HOST}${res.data._links.webui}`,
  };
}

// ── 기존 페이지 존재 여부 확인 ──────────────────────────────────────
async function findExistingPage(
  auth: { email: string; token: string },
  title: string
): Promise<{ url: string } | null> {
  // 'IF' 는 CQL 예약어라 반드시 따옴표로 감싸야 함
  const cql = `space = "${SPACE_KEY}" AND title = "${title}" AND type = page`;
  const res = await axios.get(`${CONFLUENCE_HOST}/rest/api/content/search`, {
    params: { cql, limit: 1 },
    auth: { username: auth.email, password: auth.token },
  });

  const page = res.data.results?.[0];
  if (!page) return null;

  return { url: `${CONFLUENCE_HOST}${page._links.webui}` };
}

// ── Command ─────────────────────────────────────────────────────────
export const weeklyCommand: Command = {
  name: 'weekly',
  description: '최근 위클리 문서 보기',

  register(app: App) {
    app.action(new RegExp(`^weekly_open_`), async ({ ack }) => {
      await ack();
    });

    // 메시지 숏컷: 우클릭 → "위클리 문서 생성"
    app.shortcut(SHORTCUT_ID, async ({ shortcut, ack, client }) => {
      await ack();

      const s = shortcut as MessageShortcut;
      const channel = s.channel.id;
      const threadTs = s.message.thread_ts || s.message.ts;
      const userId = s.user.id;

      // 로딩 모달
      const loading = await client.views.open({
        trigger_id: s.trigger_id,
        view: {
          type: 'modal',
          callback_id: 'weekly_create_loading',
          title: { type: 'plain_text', text: '위클리 문서 생성' },
          close: { type: 'plain_text', text: '닫기' },
          blocks: [
            {
              type: 'section',
              text: { type: 'mrkdwn', text: '⏳ 위클리 문서를 생성하는 중...' },
            },
          ],
        },
      });

      try {
        const auth = await getIgniteAuth(userId);
        if (!auth) {
          await client.views.update({
            view_id: loading.view?.id,
            view: {
              type: 'modal',
              callback_id: 'weekly_create_error',
              title: { type: 'plain_text', text: '위클리 문서 생성' },
              close: { type: 'plain_text', text: '닫기' },
              blocks: [
                {
                  type: 'section',
                  text: { type: 'mrkdwn', text: '❌ Jira 인증정보가 없습니다. fe1-web에서 계정을 등록해주세요.' },
                },
              ],
            },
          });
          return;
        }

        // 최신 위클리 조회
        const latest = await fetchLatestWeeklyDetail(auth);
        if (!latest) {
          await client.views.update({
            view_id: loading.view?.id,
            view: {
              type: 'modal',
              callback_id: 'weekly_create_error',
              title: { type: 'plain_text', text: '위클리 문서 생성' },
              close: { type: 'plain_text', text: '닫기' },
              blocks: [
                {
                  type: 'section',
                  text: { type: 'mrkdwn', text: '❌ 기존 위클리 문서를 찾을 수 없습니다.' },
                },
              ],
            },
          });
          return;
        }

        // 다음 주 제목 생성
        const next = buildNextWeeklyTitle(latest.title);
        if (!next) {
          await client.views.update({
            view_id: loading.view?.id,
            view: {
              type: 'modal',
              callback_id: 'weekly_create_error',
              title: { type: 'plain_text', text: '위클리 문서 생성' },
              close: { type: 'plain_text', text: '닫기' },
              blocks: [
                {
                  type: 'section',
                  text: { type: 'mrkdwn', text: '❌ 위클리 제목에서 날짜를 추출할 수 없습니다.' },
                },
              ],
            },
          });
          return;
        }

        // 이미 존재하는지 확인
        const existing = await findExistingPage(auth, next.newTitle);

        if (existing) {
          // 이미 존재 → 기존 문서 링크 안내
          await client.views.update({
            view_id: loading.view?.id,
            view: {
              type: 'modal',
              callback_id: 'weekly_create_done',
              title: { type: 'plain_text', text: '위클리 문서 생성' },
              close: { type: 'plain_text', text: '닫기' },
              blocks: [
                {
                  type: 'section',
                  text: {
                    type: 'mrkdwn',
                    text: `📄 *${next.newTitle}* 문서가 이미 존재합니다.\n\n<${existing.url}|Confluence에서 열기>`,
                  },
                },
              ],
            },
          });

          // 스레드에 기존 문서 링크 전송
          await client.chat.postMessage({
            channel,
            thread_ts: threadTs,
            text: `<!subteam^${FE1_USERGROUP_ID}> ${next.newTitle}\n${existing.url}`,
          });
          return;
        }

        // Confluence 페이지 생성 (본문 복제, 제목만 변경)
        const created = await createWeeklyPage(auth, next.newTitle, latest.body.storage.value);

        // 모달 업데이트: 완료
        await client.views.update({
          view_id: loading.view?.id,
          view: {
            type: 'modal',
            callback_id: 'weekly_create_done',
            title: { type: 'plain_text', text: '위클리 문서 생성' },
            close: { type: 'plain_text', text: '닫기' },
            blocks: [
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: `✅ *${next.newTitle}* 문서가 생성되었습니다.\n\n<${created.url}|Confluence에서 열기>`,
                },
              },
            ],
          },
        });

        // 스레드에 메시지 전송: @fe1 멘션 + 문서 링크
        await client.chat.postMessage({
          channel,
          thread_ts: threadTs,
          text: `<!subteam^${FE1_USERGROUP_ID}> ${next.newTitle}\n${created.url}`,
        });
      } catch (err: any) {
        const msg = err instanceof Error ? err.message : String(err);
        const status = err?.response?.status;
        const responseData = err?.response?.data;
        const detail =
          responseData?.message ||
          responseData?.errors?.[0]?.message ||
          (typeof responseData === 'string' ? responseData : undefined) ||
          (responseData ? JSON.stringify(responseData).slice(0, 500) : '');

        console.error(
          '[weekly] 문서 생성 실패:',
          msg,
          'status:',
          status,
          'response:',
          responseData ? JSON.stringify(responseData).slice(0, 1000) : '(없음)'
        );

        await client.views.update({
          view_id: loading.view?.id,
          view: {
            type: 'modal',
            callback_id: 'weekly_create_error',
            title: { type: 'plain_text', text: '위클리 문서 생성' },
            close: { type: 'plain_text', text: '닫기' },
            blocks: [
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text:
                    `❌ 문서 생성 실패: ${msg}` +
                    (status ? ` (HTTP ${status})` : '') +
                    (detail ? `\n\`\`\`${detail}\`\`\`` : ''),
                },
              },
            ],
          },
        });
      }
    });
  },

  async runSlash({ client, userId, channelId }) {
    const auth = await getIgniteAuth(userId);
    if (!auth) {
      await client.chat.postEphemeral({
        channel: channelId,
        user: userId,
        text: '❌ 등록되지 않은 사용자이거나 Jira 인증정보가 없습니다.',
      });
      return;
    }

    try {
      const weeklies = await fetchRecentWeeklies(auth);

      if (weeklies.length === 0) {
        await client.chat.postEphemeral({
          channel: channelId,
          user: userId,
          text: '위클리 문서가 없습니다.',
        });
        return;
      }

      const blocks: any[] = [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `📝 *FE1 위클리* 최근 ${weeklies.length}건` },
        },
        { type: 'divider' },
        ...weeklies.map((w) => ({
          type: 'section',
          text: { type: 'mrkdwn', text: `*${w.title}*` },
          accessory: {
            type: 'button',
            text: { type: 'plain_text', text: '열기' },
            url: w.url,
            action_id: `weekly_open_${w.date}`,
          },
        })),
      ];

      await client.chat.postEphemeral({
        channel: channelId,
        user: userId,
        text: '위클리 목록',
        blocks,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[weekly] Confluence 조회 실패:', msg);
      await client.chat.postEphemeral({
        channel: channelId,
        user: userId,
        text: `❌ 위클리 조회 실패: ${msg}`,
      });
    }
  },
};
