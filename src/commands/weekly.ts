import { App } from '@slack/bolt';
import axios from 'axios';
import { SLACK_JIRA_USER_MAP } from '../constant';
import { getJiraCredsByAccountId } from '../db';
import { Command } from './types';

const CONFLUENCE_HOST = 'https://ignitecorp.atlassian.net/wiki';
const SPACE_KEY = 'IF';
const ROOT_PAGE_ID = '1323532404';
const WEEKLY_DATE_RE = /(\d{4}-\d{2}-\d{2})/;
const MAX_RESULTS = 3;

interface ConfluencePage {
  id: string;
  title: string;
  _links: { webui: string };
}

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
    .reverse(); // 오래된 순 → 최신순 (위에서 아래로)
}

export const weeklyCommand: Command = {
  name: 'weekly',
  description: '최근 위클리 문서 보기',

  register(app: App) {
    app.action(new RegExp(`^weekly_open_`), async ({ ack }) => {
      await ack();
    });
  },

  async runSlash({ client, userId, channelId }) {
    const accountId = SLACK_JIRA_USER_MAP[userId];
    if (!accountId) {
      await client.chat.postEphemeral({
        channel: channelId,
        user: userId,
        text: '❌ 등록되지 않은 사용자입니다.',
      });
      return;
    }

    const creds = await getJiraCredsByAccountId(accountId);
    if (!creds?.igniteJiraEmail || !creds?.igniteJiraApiToken) {
      await client.chat.postEphemeral({
        channel: channelId,
        user: userId,
        text: '❌ Ignite Jira 인증정보가 없습니다. fe1-web에서 계정을 등록해주세요.',
      });
      return;
    }

    try {
      const weeklies = await fetchRecentWeeklies({
        email: creds.igniteJiraEmail,
        token: creds.igniteJiraApiToken,
      });

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
