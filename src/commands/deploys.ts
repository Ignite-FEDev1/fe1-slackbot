import { App } from '@slack/bolt';
import axios from 'axios';
import https from 'https';
import { SLACK_JIRA_USER_MAP } from '../constant';
import { getJiraCredsByAccountId, getHmgCredsByAccountId } from '../db';
import { Command } from './types';

// ── 프로젝트별 Confluence 설정 ──────────────────────────────────────
interface ProjectConfig {
  label: string;
  host: string; // Confluence wiki base URL
  spaceKey: string;
  rootPageId: string;
  /** CQL title 검색 키워드 */
  titleSearch: string;
  /** 인증 조회 방식: ignite | hmg */
  authType: 'ignite' | 'hmg';
}

const PROJECTS: Record<string, ProjectConfig> = {
  cpo: {
    label: 'CPO',
    host: 'https://ignitecorp.atlassian.net/wiki',
    spaceKey: 'CPO',
    rootPageId: '362676616',
    titleSearch: 'Dev) 배포 -',
    authType: 'ignite',
  },
  groupware: {
    label: '그룹웨어',
    host: 'https://hmg.atlassian.net/wiki',
    spaceKey: 'SPC2',
    rootPageId: '167518624',
    titleSearch: 'Dev) 배포 관리 -',
    authType: 'hmg',
  },
};

const ACTION_SELECT_PROJECT = 'deploys_select_project';
const DEPLOY_DATE_RE = /(\d{4}-\d{2}-\d{2})/;
const MAX_RESULTS = 5;

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

// ── Confluence API ──────────────────────────────────────────────────
interface ConfluencePage {
  id: string;
  title: string;
  _links: { webui: string };
}

async function fetchRecentDeploys(
  config: ProjectConfig,
  auth: { email: string; token: string }
): Promise<{ title: string; url: string }[]> {
  const cql = `space = ${config.spaceKey} AND title ~ "${config.titleSearch}" AND type = page`;

  const res = await axios.get(`${config.host}/rest/api/content/search`, {
    params: { cql, limit: 500 },
    auth: { username: auth.email, password: auth.token },
    httpsAgent,
  });

  const pages: ConfluencePage[] = res.data.results ?? [];

  // 제목에 YYYY-MM-DD 가 있는 것만 = 실제 배포대장 (월별 폴더 제외)
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  const all = pages
    .filter((p) => DEPLOY_DATE_RE.test(p.title))
    .map((p) => {
      const dateMatch = p.title.match(DEPLOY_DATE_RE)!;
      return {
        title: p.title,
        date: dateMatch[1],
        url: `${config.host}${p._links.webui}`,
      };
    });

  // 과거(오늘 포함): 최신순 → 최근 2건
  const past = all
    .filter((d) => d.date <= today)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 2);

  // 미래: 오름차순 → 가까��� 3건
  const future = all
    .filter((d) => d.date > today)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 3);

  // 날짜순 정렬 (과거 → 오늘 → 미래)
  return [...past.reverse(), ...future];
}

// ── 사용자 인증 조회 ────────────────────────────────────────────────
async function getAuthForProject(
  slackUserId: string,
  authType: 'ignite' | 'hmg'
): Promise<{ email: string; token: string } | null> {
  const accountId = SLACK_JIRA_USER_MAP[slackUserId];
  if (!accountId) return null;

  if (authType === 'ignite') {
    const creds = await getJiraCredsByAccountId(accountId);
    if (!creds?.igniteJiraEmail || !creds?.igniteJiraApiToken) return null;
    return { email: creds.igniteJiraEmail, token: creds.igniteJiraApiToken };
  }

  const creds = await getHmgCredsByAccountId(accountId);
  if (!creds?.hmgJiraEmail || !creds?.hmgJiraApiToken) return null;
  return { email: creds.hmgJiraEmail, token: creds.hmgJiraApiToken };
}

// ── Command ─────────────────────────────────────────────────────────
export const deploysCommand: Command = {
  name: 'deploys',
  description: '최근 배포대장 목록 보기',

  register(app: App) {
    // 프로젝트 선택 액션 핸들러
    app.action(ACTION_SELECT_PROJECT, async ({ body, ack, respond }) => {
      await ack();

      // static_select 값 추출
      const action = (body as any).actions?.[0];
      const projectKey = action?.selected_option?.value as string;
      const slackUserId = body.user.id;

      const config = PROJECTS[projectKey];
      if (!config) {
        await respond({ text: '알 수 없는 프로젝트입니다.', replace_original: true });
        return;
      }

      // 로딩 표시
      await respond({
        replace_original: true,
        text: `⏳ *${config.label}* 배포대장을 불러오는 중...`,
      });

      try {
        const auth = await getAuthForProject(slackUserId, config.authType);
        if (!auth) {
          await respond({
            replace_original: true,
            text: `❌ Confluence 인증정보가 없습니다. fe1-web에서 ${config.authType === 'hmg' ? 'HMG' : 'Ignite'} Jira 계정을 등록해주세요.`,
          });
          return;
        }

        const deploys = await fetchRecentDeploys(config, auth);

        if (deploys.length === 0) {
          await respond({
            replace_original: true,
            text: `*${config.label}* 배포대장이 없습니다.`,
          });
          return;
        }

        const blocks: any[] = [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `📋 *${config.label}* 최근 배포대장 (${deploys.length}건)`,
            },
          },
          { type: 'divider' },
          ...deploys.map((d) => ({
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*${d.title}*`,
            },
            accessory: {
              type: 'button',
              text: { type: 'plain_text', text: '열기' },
              url: d.url,
              action_id: `deploys_open_${d.date}`,
            },
          })),
        ];

        await respond({ replace_original: true, blocks, text: '배포대장 목록' });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[deploys] Confluence 조회 실패:', msg);
        await respond({
          replace_original: true,
          text: `❌ 배포대장 조회 실패: ${msg}`,
        });
      }
    });

    // URL 버튼 ack
    app.action(new RegExp(`^deploys_open_`), async ({ ack }) => {
      await ack();
    });
  },

  async runSlash({ client, userId, channelId }) {
    const options = Object.entries(PROJECTS).map(([key, cfg]) => ({
      text: { type: 'plain_text' as const, text: cfg.label },
      value: key,
    }));

    await client.chat.postEphemeral({
      channel: channelId,
      user: userId,
      text: '프로젝트를 선택하세요.',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '📦 *배포대장 조회* — 프로젝트를 선택하세요.',
          },
          accessory: {
            type: 'static_select',
            placeholder: { type: 'plain_text', text: '프로젝트 선택' },
            options,
            action_id: ACTION_SELECT_PROJECT,
          },
        },
      ],
    });
  },
};
