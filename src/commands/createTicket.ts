import { App, BlockAction, MessageShortcut } from '@slack/bolt';
import { WebClient } from '@slack/web-api';
import { invokeWorker } from '../invokeWorker';
import { getActiveEpics, JiraEpic } from '../jira/epics';
import {
  summarizeThreadToTicket,
  SummarizeContext,
  TicketDraft,
} from '../llm/groq';
import { fetchThreadMessages } from '../slack/thread';
import { Command } from './types';

const SHORTCUT_ID = 'create_ticket_from_thread';
const VIEW_ID = 'create_ticket_modal';
const REGENERATE_ACTION_ID = 'regenerate_summary';

interface PrivateMetadata {
  channel: string;
  threadTs: string;
  triggerUserId: string;
}

/**
 * Slack user ID → display name 조회.
 * LLM 컨텍스트에 "담당자: {이름}" 으로 넘기기 위함.
 */
const getSlackDisplayName = async (
  client: WebClient,
  userId: string
): Promise<string> => {
  try {
    const info = await client.users.info({ user: userId });
    return (
      info.user?.profile?.display_name ||
      info.user?.real_name ||
      userId
    );
  } catch {
    return userId;
  }
};

interface BuildModalParams {
  metadata: PrivateMetadata;
  epics: JiraEpic[];
  draft: TicketDraft | null;
  assigneeUserId: string;
  instructions: string;
  selectedEpicKey?: string;
}

const buildModalView = ({
  metadata,
  epics,
  draft,
  assigneeUserId,
  instructions,
  selectedEpicKey,
}: BuildModalParams) => {
  const epicOptions = epics.slice(0, 100).map((e) => ({
    text: {
      type: 'plain_text' as const,
      text: `${e.key} ${e.summary}`.slice(0, 75),
    },
    value: e.key,
  }));

  const initialEpic =
    selectedEpicKey && epicOptions.find((o) => o.value === selectedEpicKey)
      ? epicOptions.find((o) => o.value === selectedEpicKey)!
      : undefined;

  const blocks: any[] = [];

  // 1. 담당자
  blocks.push({
    type: 'input',
    block_id: 'assignee_block',
    label: { type: 'plain_text', text: '담당자' },
    element: {
      type: 'users_select',
      action_id: 'assignee',
      initial_user: assigneeUserId,
    },
  });

  // 2. 제목
  blocks.push({
    type: 'input',
    block_id: 'title_block',
    label: { type: 'plain_text', text: '제목' },
    element: {
      type: 'plain_text_input',
      action_id: 'title',
      initial_value: draft?.title ?? '',
      max_length: 250,
    },
  });

  // 3. 본문
  blocks.push({
    type: 'input',
    block_id: 'description_block',
    label: { type: 'plain_text', text: '본문' },
    element: {
      type: 'plain_text_input',
      action_id: 'description',
      multiline: true,
      initial_value: draft?.description ?? '',
    },
  });

  // 4. 상위 에픽
  if (epicOptions.length > 0) {
    blocks.push({
      type: 'input',
      block_id: 'epic_block',
      label: { type: 'plain_text', text: '상위 에픽' },
      element: {
        type: 'static_select',
        action_id: 'epic',
        placeholder: { type: 'plain_text', text: '에픽 선택' },
        options: epicOptions,
        ...(initialEpic ? { initial_option: initialEpic } : {}),
      },
    });
  } else {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '⚠️ _진행중인 FEHG 에픽을 찾지 못했습니다._',
      },
    });
  }

  // 5. 추가 지시사항
  blocks.push({
    type: 'input',
    block_id: 'instructions_block',
    optional: true,
    label: {
      type: 'plain_text',
      text: '추가 지시사항 (선택)',
    },
    hint: {
      type: 'plain_text',
      text: '예: "FE 작업만 추출", "김가빈이 해야 할 API 연동만"',
    },
    element: {
      type: 'plain_text_input',
      action_id: 'instructions',
      multiline: true,
      initial_value: instructions,
    },
  });

  // 6. 🔄 재요약 버튼
  blocks.push({
    type: 'actions',
    block_id: 'regenerate_block',
    elements: [
      {
        type: 'button',
        action_id: REGENERATE_ACTION_ID,
        text: {
          type: 'plain_text',
          text: '🔄 담당자/지시사항 반영해 다시 요약',
        },
      },
    ],
  });

  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: draft
          ? '✨ Groq 가 쓰레드 + 담당자/지시사항 기반으로 초안을 만들었습니다. 수정하거나 🔄 버튼으로 다시 요약할 수 있어요.'
          : '⚠️ LLM 요약에 실패했습니다. 직접 입력하거나 🔄 버튼으로 다시 시도하세요.',
      },
    ],
  });

  return {
    type: 'modal' as const,
    callback_id: VIEW_ID,
    private_metadata: JSON.stringify(metadata),
    title: { type: 'plain_text' as const, text: 'FEHG 티켓 만들기' },
    submit: { type: 'plain_text' as const, text: '생성' },
    close: { type: 'plain_text' as const, text: '취소' },
    blocks,
  };
};

export const createTicketCommand: Command = {
  name: 'ticket',
  description:
    '이 쓰레드 내용으로 FEHG Jira Task 생성 (쓰레드에서 메시지 우클릭 → 티켓 만들기)',

  register(app: App) {
    // 1) 메시지 숏컷: 쓰레드에서 메시지 우클릭 → "티켓 만들기"
    app.shortcut(SHORTCUT_ID, async ({ shortcut, ack, client }) => {
      await ack();

      const s = shortcut as MessageShortcut;
      const channel = s.channel.id;
      const threadTs = s.message.thread_ts || s.message.ts;
      const triggerUserId = s.user.id;

      // 로딩 모달 즉시 오픈 (3초 내 필수)
      const loading = await client.views.open({
        trigger_id: s.trigger_id,
        view: {
          type: 'modal',
          callback_id: VIEW_ID + '_loading',
          title: { type: 'plain_text', text: '티켓 만들기' },
          close: { type: 'plain_text', text: '닫기' },
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: '⏳ 쓰레드를 읽고 Groq 로 요약 중입니다...',
              },
            },
          ],
        },
      });

      try {
        // 쓰레드 + 에픽 + 호출자 이름 병렬 조회
        const [messages, epics, triggerName] = await Promise.all([
          fetchThreadMessages(client, channel, threadTs),
          getActiveEpics(),
          getSlackDisplayName(client, triggerUserId),
        ]);

        // 초기 요약은 호출자를 담당자로 가정
        const draft = await summarizeThreadToTicket(messages, {
          assigneeName: triggerName,
        });

        const metadata: PrivateMetadata = {
          channel,
          threadTs,
          triggerUserId,
        };

        await client.views.update({
          view_id: loading.view?.id,
          view: buildModalView({
            metadata,
            epics,
            draft,
            assigneeUserId: triggerUserId,
            instructions: '',
          }),
        });
      } catch (e) {
        console.error('[createTicket] 모달 준비 실패:', e);
        await client.views.update({
          view_id: loading.view?.id,
          view: {
            type: 'modal',
            callback_id: VIEW_ID + '_error',
            title: { type: 'plain_text', text: '티켓 만들기' },
            close: { type: 'plain_text', text: '닫기' },
            blocks: [
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: '❌ 쓰레드를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.',
                },
              },
            ],
          },
        });
      }
    });

    // 2) 🔄 재요약 버튼 핸들러
    app.action(
      REGENERATE_ACTION_ID,
      async ({ ack, body, client }) => {
        await ack();

        const b = body as BlockAction;
        const view = b.view;
        if (!view) return;

        const values = view.state.values;
        const assigneeUserId =
          values.assignee_block?.assignee?.selected_user ?? b.user.id;
        const instructions =
          values.instructions_block?.instructions?.value?.trim() ?? '';
        const selectedEpicKey =
          values.epic_block?.epic?.selected_option?.value ?? undefined;

        const metadata: PrivateMetadata = view.private_metadata
          ? JSON.parse(view.private_metadata)
          : ({} as PrivateMetadata);

        // 로딩 힌트를 위해 현재 블록을 그대로 두고 context 만 살짝 업데이트하면 좋겠지만,
        // Slack modal update 는 전체 교체이므로 그냥 즉시 재요약 후 교체.
        try {
          const [messages, epics, assigneeName] = await Promise.all([
            fetchThreadMessages(client, metadata.channel, metadata.threadTs),
            getActiveEpics(),
            getSlackDisplayName(client, assigneeUserId),
          ]);

          const ctx: SummarizeContext = {
            assigneeName,
            instructions: instructions || undefined,
          };
          const draft = await summarizeThreadToTicket(messages, ctx);

          await client.views.update({
            view_id: view.id,
            hash: view.hash,
            view: buildModalView({
              metadata,
              epics,
              draft,
              assigneeUserId,
              instructions,
              selectedEpicKey,
            }),
          });
        } catch (e) {
          console.error('[createTicket] 재요약 실패:', e);
        }
      }
    );

    // 3) 모달 submit 핸들러
    app.view(VIEW_ID, async ({ ack, view, client }) => {
      const values = view.state.values;
      const title = values.title_block?.title?.value?.trim() ?? '';
      const description =
        values.description_block?.description?.value?.trim() ?? '';
      const assigneeSlackId =
        values.assignee_block?.assignee?.selected_user ?? '';
      const epicKey =
        values.epic_block?.epic?.selected_option?.value ?? '';

      const errors: Record<string, string> = {};
      if (!title) errors.title_block = '제목을 입력해주세요.';
      if (!epicKey) errors.epic_block = '상위 에픽을 선택해주세요.';
      if (Object.keys(errors).length > 0) {
        await ack({ response_action: 'errors', errors });
        return;
      }

      await ack(); // 즉시 200 반환 → 팝업 닫힘

      const metadata: PrivateMetadata = view.private_metadata
        ? JSON.parse(view.private_metadata)
        : ({} as PrivateMetadata);

      // Jira 생성 + Slack 메시지를 비동기 Lambda worker에 위임
      await invokeWorker({
        type: 'create_ticket_work',
        channel: metadata.channel,
        threadTs: metadata.threadTs,
        triggerUserId: metadata.triggerUserId,
        title,
        description,
        assigneeSlackId,
        epicKey,
      });
    });

    // 4) 버튼 URL open_created_ticket — 응답용 더미 (URL 버튼은 ack 만 하면 됨)
    app.action('open_created_ticket', async ({ ack }) => {
      await ack();
    });
  },

  async runSlash({ respond }) {
    await respond(
      '쓰레드에서 메시지 우클릭 → *티켓 만들기* 메뉴를 사용해주세요.\n' +
        '(슬래시 커맨드로는 쓰레드 컨텍스트를 알 수 없습니다.)'
    );
  },
};
