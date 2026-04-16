import { App, MessageShortcut } from '@slack/bolt';
import { invokeWorker } from '../invokeWorker';
import { getIssueDetails, JiraIssueDetails } from '../jira/updateIssue';
import { Command } from './types';

const SHORTCUT_ID = 'bulk_update_batch_tickets';
const VIEW_ID = 'bulk_update_batch_tickets_modal';

interface PrivateMetadata {
  channel: string;
  threadTs: string;
  triggerUserId: string;
  ticketKeys: string[];
}

const ESTIMATE_PATTERN = /^(\d+\.?\d*)(d|m|w|h)$/i;
const isValidEstimate = (v: string) => ESTIMATE_PATTERN.test(v.trim());
const isValidDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

/**
 * 본문에서 생성 시 추가된 Slack 쓰레드 링크 suffix 를 제거한다.
 * `\n\n---\n🔗 Slack 쓰레드: ...` 패턴
 */
const stripThreadLinkSuffix = (desc: string): string => {
  const idx = desc.indexOf('\n\n---\n🔗 Slack 쓰레드:');
  return idx >= 0 ? desc.slice(0, idx) : desc;
};

interface BuildModalParams {
  metadata: PrivateMetadata;
  details: JiraIssueDetails;
}

const buildModalView = ({ metadata, details }: BuildModalParams) => {
  const cleanDesc = stripThreadLinkSuffix(details.description);
  const ticketList = metadata.ticketKeys.join(', ');

  const blocks: any[] = [];

  // 안내
  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `📦 *${metadata.ticketKeys.length}개 티켓* 일괄 변경: ${ticketList}`,
      },
    ],
  });

  // 1. 제목
  blocks.push({
    type: 'input',
    block_id: 'title_block',
    label: { type: 'plain_text', text: '제목' },
    element: {
      type: 'plain_text_input',
      action_id: 'title',
      initial_value: details.summary,
      max_length: 250,
    },
  });

  // 2. 본문
  blocks.push({
    type: 'input',
    block_id: 'description_block',
    label: { type: 'plain_text', text: '본문' },
    element: {
      type: 'plain_text_input',
      action_id: 'description',
      multiline: true,
      initial_value: cleanDesc,
    },
  });

  // 3. 시작일
  blocks.push({
    type: 'input',
    block_id: 'start_date_block',
    optional: true,
    label: { type: 'plain_text', text: '시작일' },
    element: {
      type: 'datepicker',
      action_id: 'start_date',
      ...(details.startDate ? { initial_date: details.startDate } : {}),
      placeholder: { type: 'plain_text', text: '시작일 선택' },
    },
  });

  // 4. 종료일
  blocks.push({
    type: 'input',
    block_id: 'end_date_block',
    optional: true,
    label: { type: 'plain_text', text: '종료일' },
    element: {
      type: 'datepicker',
      action_id: 'end_date',
      ...(details.dueDate ? { initial_date: details.dueDate } : {}),
      placeholder: { type: 'plain_text', text: '종료일 선택' },
    },
  });

  // 5. 최초추정치
  blocks.push({
    type: 'input',
    block_id: 'estimate_block',
    optional: true,
    label: { type: 'plain_text', text: '최초추정치' },
    hint: {
      type: 'plain_text',
      text: '형식: 숫자 + 단위 (d=일, w=주, h=시간, m=분) 예: 3d, 1w, 1.5h',
    },
    element: {
      type: 'plain_text_input',
      action_id: 'estimate',
      initial_value: details.originalEstimate ?? '',
      placeholder: { type: 'plain_text', text: '예: 3d' },
    },
  });

  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `ℹ️ 첫 번째 티켓(${details.key})의 현재 값을 불러왔습니다. 수정한 내용이 전체 티켓에 일괄 반영됩니다.`,
      },
    ],
  });

  return {
    type: 'modal' as const,
    callback_id: VIEW_ID,
    private_metadata: JSON.stringify(metadata),
    title: { type: 'plain_text' as const, text: '배치 티켓 일괄 변경' },
    submit: { type: 'plain_text' as const, text: '일괄 변경' },
    close: { type: 'plain_text' as const, text: '취소' },
    blocks,
  };
};

export const batchTicketUpdateCommand: Command = {
  name: 'batch-ticket-update',
  description:
    '배치 생성된 FEHG 티켓들을 일괄 변경. 배치 결과 메시지에서 우클릭 → 배치 티켓 일괄 변경',

  register(app: App) {
    // 1) 메시지 숏컷
    app.shortcut(SHORTCUT_ID, async ({ shortcut, ack, client }) => {
      await ack();

      const s = shortcut as MessageShortcut;
      const channel = s.channel.id;
      const threadTs = s.message.thread_ts || s.message.ts;
      const triggerUserId = s.user.id;

      // metadata 에서 ticket_keys 추출
      const msg = s.message as any;
      const ticketKeysRaw = msg.metadata?.event_payload?.ticket_keys;

      if (!ticketKeysRaw) {
        await client.views.open({
          trigger_id: s.trigger_id,
          view: {
            type: 'modal',
            title: { type: 'plain_text', text: '배치 티켓 일괄 변경' },
            close: { type: 'plain_text', text: '닫기' },
            blocks: [
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: '⚠️ 이 메시지에 배치 티켓 정보가 없습니다.\n배치 티켓 생성 결과 메시지에서만 사용할 수 있습니다.',
                },
              },
            ],
          },
        });
        return;
      }

      const ticketKeys: string[] =
        typeof ticketKeysRaw === 'string'
          ? ticketKeysRaw.split(',').filter(Boolean)
          : ticketKeysRaw;

      if (ticketKeys.length === 0) {
        await client.views.open({
          trigger_id: s.trigger_id,
          view: {
            type: 'modal',
            title: { type: 'plain_text', text: '배치 티켓 일괄 변경' },
            close: { type: 'plain_text', text: '닫기' },
            blocks: [
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: '⚠️ 변경할 티켓이 없습니다.',
                },
              },
            ],
          },
        });
        return;
      }

      // 로딩 모달
      const loading = await client.views.open({
        trigger_id: s.trigger_id,
        view: {
          type: 'modal',
          callback_id: VIEW_ID + '_loading',
          title: { type: 'plain_text', text: '배치 티켓 일괄 변경' },
          close: { type: 'plain_text', text: '닫기' },
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `⏳ ${ticketKeys[0]} 에서 현재 상태를 불러오는 중...`,
              },
            },
          ],
        },
      });

      try {
        const details = await getIssueDetails(ticketKeys[0]);

        if (!details) {
          await client.views.update({
            view_id: loading.view?.id,
            view: {
              type: 'modal',
              title: { type: 'plain_text', text: '배치 티켓 일괄 변경' },
              close: { type: 'plain_text', text: '닫기' },
              blocks: [
                {
                  type: 'section',
                  text: {
                    type: 'mrkdwn',
                    text: '❌ Jira 에서 티켓 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.',
                  },
                },
              ],
            },
          });
          return;
        }

        const metadata: PrivateMetadata = {
          channel,
          threadTs,
          triggerUserId,
          ticketKeys,
        };

        await client.views.update({
          view_id: loading.view?.id,
          view: buildModalView({ metadata, details }),
        });
      } catch (e) {
        console.error('[batchTicketUpdate] 모달 준비 실패:', e);
        await client.views.update({
          view_id: loading.view?.id,
          view: {
            type: 'modal',
            title: { type: 'plain_text', text: '배치 티켓 일괄 변경' },
            close: { type: 'plain_text', text: '닫기' },
            blocks: [
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: '❌ 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
                },
              },
            ],
          },
        });
      }
    });

    // 2) 모달 submit 핸들러
    app.view(VIEW_ID, async ({ ack, view }) => {
      const values = view.state.values;
      const title = values.title_block?.title?.value?.trim() ?? '';
      const description =
        values.description_block?.description?.value?.trim() ?? '';
      const startDate =
        values.start_date_block?.start_date?.selected_date ?? '';
      const endDate = values.end_date_block?.end_date?.selected_date ?? '';
      const estimate =
        values.estimate_block?.estimate?.value?.trim() ?? '';

      const errors: Record<string, string> = {};
      if (!title) errors.title_block = '제목을 입력해주세요.';
      if (estimate && !isValidEstimate(estimate))
        errors.estimate_block =
          '형식이 올바르지 않습니다. (예: 3d, 1w, 1.5h, 30m)';
      if (startDate && !isValidDate(startDate))
        errors.start_date_block = '시작일 포맷이 올바르지 않습니다.';
      if (endDate && !isValidDate(endDate))
        errors.end_date_block = '종료일 포맷이 올바르지 않습니다.';
      if (startDate && endDate && startDate > endDate)
        errors.end_date_block = '종료일은 시작일 이후여야 합니다.';

      if (Object.keys(errors).length > 0) {
        await ack({ response_action: 'errors', errors });
        return;
      }

      await ack();

      const metadata: PrivateMetadata = view.private_metadata
        ? JSON.parse(view.private_metadata)
        : ({} as PrivateMetadata);

      await invokeWorker({
        type: 'batch_ticket_bulk_update_work',
        channel: metadata.channel,
        threadTs: metadata.threadTs,
        triggerUserId: metadata.triggerUserId,
        ticketKeys: metadata.ticketKeys,
        title,
        description,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        estimate: estimate || undefined,
      });
    });
  },

  async runSlash({ respond }) {
    await respond(
      '배치 티켓 생성 결과 메시지에서 우클릭 → *배치 티켓 일괄 변경* 메뉴를 사용해주세요.'
    );
  },
};
