import { App, MessageShortcut } from '@slack/bolt';
import { invokeWorker } from '../invokeWorker';
import { Command } from './types';

const FE1_WEB_BASE_URL = 'https://fe1-jira-sync.vercel.app';
const VERCEL_BYPASS_SECRET = process.env.VERCEL_BYPASS_SECRET || '';

const SHORTCUT_ID = 'create_deploy_room';
const VIEW_ID = 'create_deploy_room_modal';

interface Template {
  id: string;
  name: string;
  project: string;
  deployType: string;
}

interface ModalMetadata {
  channel: string;
  threadTs: string;
  templates: Template[];
}

/** YYYY-MM-DD → YYMMDD */
const toYYMMDD = (date: string) => {
  const [y, m, d] = date.split('-');
  return y.slice(2) + m + d;
};

const fetchHeaders = (): Record<string, string> => {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (VERCEL_BYPASS_SECRET) {
    h['x-vercel-protection-bypass'] = VERCEL_BYPASS_SECRET;
  }
  return h;
};

const fetchTemplates = async (): Promise<Template[]> => {
  const res = await fetch(`${FE1_WEB_BASE_URL}/api/deploy-room/templates`, {
    headers: fetchHeaders(),
  });
  if (!res.ok) throw new Error(`templates API: ${res.status}`);
  const data = await res.json();
  return data.templates ?? [];
};

export const deployRoomCommand: Command = {
  name: 'deploy-room',
  description: '배포방 생성 (쓰레드에서 메시지 우클릭 → 배포방 만들기)',

  register(app: App) {
    // URL 버튼 ack
    app.action('open_deploy_room', async ({ ack }) => {
      await ack();
    });

    // 1) 메시지 숏컷: 쓰레드에서 메시지 우클릭 → "배포방 만들기"
    app.shortcut(SHORTCUT_ID, async ({ shortcut, ack, client }) => {
      await ack();

      const s = shortcut as MessageShortcut;
      const channel = s.channel.id;
      const threadTs = s.message.thread_ts || s.message.ts;

      // 로딩 모달 즉시 오픈 (3초 내 필수)
      const loading = await client.views.open({
        trigger_id: s.trigger_id,
        view: {
          type: 'modal',
          callback_id: VIEW_ID + '_loading',
          title: { type: 'plain_text', text: '배포방 생성' },
          close: { type: 'plain_text', text: '닫기' },
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: '⏳ 배포 시나리오를 불러오는 중입니다...',
              },
            },
          ],
        },
      });

      try {
        const templates = await fetchTemplates();

        if (templates.length === 0) {
          await client.views.update({
            view_id: loading.view?.id,
            view: {
              type: 'modal',
              callback_id: VIEW_ID + '_error',
              title: { type: 'plain_text', text: '배포방 생성' },
              close: { type: 'plain_text', text: '닫기' },
              blocks: [
                {
                  type: 'section',
                  text: {
                    type: 'mrkdwn',
                    text: '⚠️ 등록된 배포 시나리오가 없습니다.',
                  },
                },
              ],
            },
          });
          return;
        }

        const templateOptions = templates.map((t) => ({
          text: { type: 'plain_text' as const, text: t.name },
          value: t.id,
        }));

        const today = new Date().toISOString().split('T')[0];

        const metadata: ModalMetadata = {
          channel,
          threadTs,
          templates: templates.map((t) => ({
            id: t.id,
            name: t.name,
            project: t.project,
            deployType: t.deployType,
          })),
        };

        await client.views.update({
          view_id: loading.view?.id,
          view: {
            type: 'modal',
            callback_id: VIEW_ID,
            private_metadata: JSON.stringify(metadata),
            title: { type: 'plain_text', text: '배포방 생성' },
            submit: { type: 'plain_text', text: '생성' },
            close: { type: 'plain_text', text: '취소' },
            blocks: [
              {
                type: 'input',
                block_id: 'template_block',
                label: { type: 'plain_text', text: '배포 시나리오' },
                element: {
                  type: 'static_select',
                  action_id: 'template',
                  placeholder: {
                    type: 'plain_text',
                    text: '시나리오 선택',
                  },
                  options: templateOptions,
                },
              },
              {
                type: 'input',
                block_id: 'deploy_type_block',
                label: { type: 'plain_text', text: '배포 유형' },
                element: {
                  type: 'static_select',
                  action_id: 'deploy_type',
                  initial_option: {
                    text: { type: 'plain_text', text: '비정기' },
                    value: 'adhoc',
                  },
                  options: [
                    { text: { type: 'plain_text', text: '정기' }, value: 'regular' },
                    { text: { type: 'plain_text', text: '비정기' }, value: 'adhoc' },
                    { text: { type: 'plain_text', text: '핫픽스' }, value: 'hotfix' },
                  ],
                },
              },
              {
                type: 'input',
                block_id: 'deploy_date_block',
                label: { type: 'plain_text', text: '배포일' },
                element: {
                  type: 'datepicker',
                  action_id: 'deploy_date',
                  initial_date: today,
                  placeholder: { type: 'plain_text', text: '날짜 선택' },
                },
              },
              {
                type: 'input',
                block_id: 'confluence_block',
                optional: true,
                label: { type: 'plain_text', text: '배포대장 URL' },
                hint: {
                  type: 'plain_text',
                  text: 'Confluence 배포대장 페이지 URL (선택)',
                },
                element: {
                  type: 'url_text_input',
                  action_id: 'confluence_url',
                  placeholder: {
                    type: 'plain_text',
                    text: 'https://wiki.example.com/...',
                  },
                },
              },
            ],
          },
        });
      } catch (e) {
        console.error('[deployRoom] 모달 준비 실패:', e);
        await client.views.update({
          view_id: loading.view?.id,
          view: {
            type: 'modal',
            callback_id: VIEW_ID + '_error',
            title: { type: 'plain_text', text: '배포방 생성' },
            close: { type: 'plain_text', text: '닫기' },
            blocks: [
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: '❌ 배포 시나리오를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.',
                },
              },
            ],
          },
        });
      }
    });

    // 2) 모달 submit 핸들러
    app.view(VIEW_ID, async ({ ack, view, body }) => {
      const values = view.state.values;
      const templateId =
        values.template_block?.template?.selected_option?.value ?? '';
      const deployType =
        values.deploy_type_block?.deploy_type?.selected_option?.value ?? 'adhoc';
      const deployDate =
        values.deploy_date_block?.deploy_date?.selected_date ?? '';
      const confluenceUrl =
        values.confluence_block?.confluence_url?.value?.trim() ?? '';

      const errors: Record<string, string> = {};
      if (!templateId) errors.template_block = '배포 시나리오를 선택해주세요.';
      if (!deployDate) errors.deploy_date_block = '배포일을 선택해주세요.';

      if (Object.keys(errors).length > 0) {
        await ack({ response_action: 'errors', errors });
        return;
      }

      await ack(); // 모달 즉시 닫기

      const metadata: ModalMetadata = view.private_metadata
        ? JSON.parse(view.private_metadata)
        : { channel: '', threadTs: '', templates: [] };

      const template = metadata.templates.find((t) => t.id === templateId);
      const templateName = template?.name ?? '';
      const title = `${templateName} ${toYYMMDD(deployDate)}`;

      await invokeWorker({
        type: 'create_deploy_room_work',
        channel: metadata.channel,
        threadTs: metadata.threadTs,
        triggerUserId: body.user.id,
        title,
        templateId,
        deployType,
        deployDate,
        confluencePageUrl: confluenceUrl || undefined,
      });
    });
  },

  async runSlash({ respond }) {
    await respond(
      '쓰레드에서 메시지 우클릭 → *배포방 만들기* 메뉴를 사용해주세요.\n' +
        '(Slack App 설정에서 `create_deploy_room` 숏컷을 등록해야 합니다.)'
    );
  },
};
