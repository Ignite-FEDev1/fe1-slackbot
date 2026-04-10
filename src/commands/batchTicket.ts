import { App, BlockAction, MessageShortcut } from '@slack/bolt';
import { SLACK_JIRA_USER_MAP } from '../constant';
import { createFehgTask, CreatedIssue } from '../jira/createIssue';
import { getActiveEpics, JiraEpic } from '../jira/epics';
import {
  BatchSummarizeContext,
  summarizeThreadForBatchTicket,
  TicketDraft,
} from '../llm/groq';
import { fetchThreadMessages } from '../slack/thread';
import { Command } from './types';

const SHORTCUT_ID = 'create_batch_tickets_from_thread';
const VIEW_ID = 'create_batch_tickets_modal';
const REGENERATE_ACTION_ID = 'regenerate_batch_summary';

interface PrivateMetadata {
  channel: string;
  threadTs: string;
  triggerUserId: string;
}

// 최초추정치 포맷 검증 (fe1-web 과 동일한 패턴)
const ESTIMATE_PATTERN = /^(\d+\.?\d*)(d|m|w|h)$/i;
const isValidEstimate = (v: string) => ESTIMATE_PATTERN.test(v.trim());

// 날짜 검증 (YYYY-MM-DD)
const isValidDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

/**
 * FE1 팀 기본 멤버 목록.
 * SLACK_JIRA_USER_MAP 에 등록된 사람들을 FE1 팀원으로 간주한다.
 * 배치 티켓 생성 시 초기 선택 상태가 된다.
 */
const getDefaultTeamSlackIds = (): string[] => Object.keys(SLACK_JIRA_USER_MAP);

interface BuildModalParams {
  metadata: PrivateMetadata;
  epics: JiraEpic[];
  draft: TicketDraft | null;
  selectedUsers: string[];
  instructions: string;
  selectedEpicKey?: string;
  startDate?: string;
  endDate?: string;
  estimate?: string;
}

const buildModalView = ({
  metadata,
  epics,
  draft,
  selectedUsers,
  instructions,
  selectedEpicKey,
  startDate,
  endDate,
  estimate,
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

  // 1. 담당자들 (multi_users_select, FE1 팀 전원 기본 선택)
  blocks.push({
    type: 'input',
    block_id: 'assignees_block',
    label: { type: 'plain_text', text: '담당자들 (여러 명 선택)' },
    element: {
      type: 'multi_users_select',
      action_id: 'assignees',
      initial_users: selectedUsers,
      placeholder: { type: 'plain_text', text: '담당자 선택' },
    },
    hint: {
      type: 'plain_text',
      text: 'FE1 팀 전원이 기본 선택되어 있습니다. 제외할 사람만 해제하세요.',
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

  // 5. 시작일
  blocks.push({
    type: 'input',
    block_id: 'start_date_block',
    optional: true,
    label: { type: 'plain_text', text: '시작일' },
    element: {
      type: 'datepicker',
      action_id: 'start_date',
      ...(startDate ? { initial_date: startDate } : {}),
      placeholder: { type: 'plain_text', text: '시작일 선택' },
    },
  });

  // 6. 종료일
  blocks.push({
    type: 'input',
    block_id: 'end_date_block',
    optional: true,
    label: { type: 'plain_text', text: '종료일' },
    element: {
      type: 'datepicker',
      action_id: 'end_date',
      ...(endDate ? { initial_date: endDate } : {}),
      placeholder: { type: 'plain_text', text: '종료일 선택' },
    },
  });

  // 7. 최초추정치
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
      initial_value: estimate ?? '',
      placeholder: { type: 'plain_text', text: '예: 3d' },
    },
  });

  // 8. 추가 지시사항
  blocks.push({
    type: 'input',
    block_id: 'instructions_block',
    optional: true,
    label: { type: 'plain_text', text: '추가 지시사항 (선택)' },
    hint: {
      type: 'plain_text',
      text: '예: "배포 전 체크리스트 포함", "장애 대응 프로토콜도 적어줘"',
    },
    element: {
      type: 'plain_text_input',
      action_id: 'instructions',
      multiline: true,
      initial_value: instructions,
    },
  });

  // 9. 🔄 재요약 버튼
  blocks.push({
    type: 'actions',
    block_id: 'regenerate_block',
    elements: [
      {
        type: 'button',
        action_id: REGENERATE_ACTION_ID,
        text: {
          type: 'plain_text',
          text: '🔄 지시사항 반영해 다시 요약',
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
          ? '✨ Groq 가 배치 티켓 관점으로 초안을 만들었습니다. 수정하거나 🔄 버튼으로 다시 요약할 수 있어요.'
          : '⚠️ LLM 요약에 실패했습니다. 직접 입력하거나 🔄 버튼으로 다시 시도하세요.',
      },
    ],
  });

  return {
    type: 'modal' as const,
    callback_id: VIEW_ID,
    private_metadata: JSON.stringify(metadata),
    title: { type: 'plain_text' as const, text: '배치 티켓 만들기' },
    submit: { type: 'plain_text' as const, text: '생성' },
    close: { type: 'plain_text' as const, text: '취소' },
    blocks,
  };
};

export const batchTicketCommand: Command = {
  name: 'batch-ticket',
  description:
    '여러 명에게 동일한 FEHG 티켓 일괄 생성 (배포 모니터링 등). 쓰레드에서 메시지 우클릭 → 배치 티켓 만들기',

  register(app: App) {
    // 1) 메시지 숏컷
    app.shortcut(SHORTCUT_ID, async ({ shortcut, ack, client }) => {
      await ack();

      const s = shortcut as MessageShortcut;
      const channel = s.channel.id;
      const threadTs = s.message.thread_ts || s.message.ts;
      const triggerUserId = s.user.id;

      const loading = await client.views.open({
        trigger_id: s.trigger_id,
        view: {
          type: 'modal',
          callback_id: VIEW_ID + '_loading',
          title: { type: 'plain_text', text: '배치 티켓 만들기' },
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
        const defaultUsers = getDefaultTeamSlackIds();
        const [messages, epics] = await Promise.all([
          fetchThreadMessages(client, channel, threadTs),
          getActiveEpics(),
        ]);

        const draft = await summarizeThreadForBatchTicket(messages, {
          assigneeCount: defaultUsers.length,
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
            selectedUsers: defaultUsers,
            instructions: '',
          }),
        });
      } catch (e) {
        console.error('[batchTicket] 모달 준비 실패:', e);
        await client.views.update({
          view_id: loading.view?.id,
          view: {
            type: 'modal',
            callback_id: VIEW_ID + '_error',
            title: { type: 'plain_text', text: '배치 티켓 만들기' },
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

    // 2) 🔄 재요약 버튼
    app.action(REGENERATE_ACTION_ID, async ({ ack, body, client }) => {
      await ack();

      const b = body as BlockAction;
      const view = b.view;
      if (!view) return;

      const values = view.state.values;
      const selectedUsers =
        values.assignees_block?.assignees?.selected_users ??
        getDefaultTeamSlackIds();
      const instructions =
        values.instructions_block?.instructions?.value?.trim() ?? '';
      const selectedEpicKey =
        values.epic_block?.epic?.selected_option?.value ?? undefined;
      const startDate =
        values.start_date_block?.start_date?.selected_date ?? undefined;
      const endDate =
        values.end_date_block?.end_date?.selected_date ?? undefined;
      const estimate =
        values.estimate_block?.estimate?.value?.trim() ?? '';

      const metadata: PrivateMetadata = view.private_metadata
        ? JSON.parse(view.private_metadata)
        : ({} as PrivateMetadata);

      try {
        const [messages, epics] = await Promise.all([
          fetchThreadMessages(client, metadata.channel, metadata.threadTs),
          getActiveEpics(),
        ]);

        const ctx: BatchSummarizeContext = {
          assigneeCount: selectedUsers.length,
          instructions: instructions || undefined,
        };
        const draft = await summarizeThreadForBatchTicket(messages, ctx);

        await client.views.update({
          view_id: view.id,
          hash: view.hash,
          view: buildModalView({
            metadata,
            epics,
            draft,
            selectedUsers,
            instructions,
            selectedEpicKey,
            startDate,
            endDate,
            estimate,
          }),
        });
      } catch (e) {
        console.error('[batchTicket] 재요약 실패:', e);
      }
    });

    // 3) 모달 submit 핸들러
    app.view(VIEW_ID, async ({ ack, view, client }) => {
      const values = view.state.values;
      const title = values.title_block?.title?.value?.trim() ?? '';
      const description =
        values.description_block?.description?.value?.trim() ?? '';
      const selectedUsers: string[] =
        values.assignees_block?.assignees?.selected_users ?? [];
      const epicKey =
        values.epic_block?.epic?.selected_option?.value ?? '';
      const startDate =
        values.start_date_block?.start_date?.selected_date ?? '';
      const endDate =
        values.end_date_block?.end_date?.selected_date ?? '';
      const estimate =
        values.estimate_block?.estimate?.value?.trim() ?? '';

      const errors: Record<string, string> = {};
      if (!title) errors.title_block = '제목을 입력해주세요.';
      if (!epicKey) errors.epic_block = '상위 에픽을 선택해주세요.';
      if (selectedUsers.length === 0)
        errors.assignees_block = '담당자를 1명 이상 선택해주세요.';
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

      // 각 담당자마다 티켓 생성 (병렬 — ack 응답 3초 제한 대응)
      const results: Array<{
        slackUserId: string;
        created: CreatedIssue | null;
        missingMapping: boolean;
      }> = await Promise.all(
        selectedUsers.map(async (slackUserId) => {
          const assigneeAccountId = SLACK_JIRA_USER_MAP[slackUserId];
          if (!assigneeAccountId) {
            return { slackUserId, created: null, missingMapping: true };
          }
          const created = await createFehgTask({
            summary: title,
            description,
            assigneeAccountId,
            epicKey,
            startDate: startDate || undefined,
            dueDate: endDate || undefined,
            originalEstimate: estimate || undefined,
          });
          return { slackUserId, created, missingMapping: false };
        })
      );

      // 결과 메시지 구성
      if (metadata.channel && metadata.threadTs) {
        const creatorMention = metadata.triggerUserId
          ? `<@${metadata.triggerUserId}>`
          : '누군가';

        const successLines = results
          .filter((r) => r.created)
          .map(
            (r) =>
              `• <@${r.slackUserId}> → <${r.created!.url}|${r.created!.key}>`
          );
        const failureLines = results
          .filter((r) => !r.created)
          .map((r) =>
            r.missingMapping
              ? `• <@${r.slackUserId}> → ⚠️ Jira 매핑 없음 (SLACK_JIRA_USER_MAP 확인)`
              : `• <@${r.slackUserId}> → ❌ 생성 실패`
          );

        const successCount = successLines.length;
        const failCount = failureLines.length;

        const summaryText = [
          `*📦 배치 티켓 생성 결과*  ·  성공 ${successCount} / 실패 ${failCount}`,
          `*제목*: ${title}`,
          '',
          successLines.length ? successLines.join('\n') : '_성공한 티켓 없음_',
          failureLines.length ? '\n*⚠️ 실패*\n' + failureLines.join('\n') : '',
        ]
          .filter(Boolean)
          .join('\n');

        await client.chat.postMessage({
          channel: metadata.channel,
          thread_ts: metadata.threadTs,
          text: `배치 티켓 생성 결과: 성공 ${successCount} / 실패 ${failCount} · 생성자 ${creatorMention}`,
          blocks: [
            {
              type: 'section',
              text: { type: 'mrkdwn', text: summaryText },
            },
            {
              type: 'context',
              elements: [
                {
                  type: 'mrkdwn',
                  text: `🧑‍💻 생성자: ${creatorMention}`,
                },
              ],
            },
          ],
        });
      }
    });
  },

  async runSlash({ respond }) {
    await respond(
      '쓰레드에서 메시지 우클릭 → *배치 티켓 만들기* 메뉴를 사용해주세요.\n' +
        '(슬래시 커맨드로는 쓰레드 컨텍스트를 알 수 없습니다.)'
    );
  },
};
