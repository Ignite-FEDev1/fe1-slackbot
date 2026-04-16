import { WebClient } from '@slack/web-api';
import { SLACK_JIRA_USER_MAP } from './constant';
import { getJiraCredsByAccountId } from './db';
import { createFehgTask, CreatedIssue } from './jira/createIssue';
import { updateIssue } from './jira/updateIssue';
import { getActiveEpics } from './jira/epics';
import { summarizeThreadToTicket, SummarizeContext } from './llm/groq';
import { fetchThreadMessages } from './slack/thread';

const client = new WebClient(process.env.SLACK_BOT_TOKEN);

/**
 * Slack 쓰레드 URL 생성.
 * https://app.slack.com/client 기반 범용 딥링크 (워크스페이스 도메인 불필요)
 */
const getSlackThreadUrl = (channel: string, threadTs: string): string => {
  const tsNoDot = threadTs.replace('.', '');
  return `https://app.slack.com/client/archives/${channel}/p${tsNoDot}`;
};

export interface CreateTicketWorkerPayload {
  type: 'create_ticket_work';
  channel: string;
  threadTs: string;
  triggerUserId: string;
  title: string;
  description: string;
  assigneeSlackId: string;
  epicKey: string;
  startDate?: string;
  endDate?: string;
  estimate?: string;
}

export interface BatchTicketWorkerPayload {
  type: 'batch_ticket_work';
  channel: string;
  threadTs: string;
  triggerUserId: string;
  title: string;
  description: string;
  selectedUsers: string[];
  epicKey: string;
  startDate?: string;
  endDate?: string;
  estimate?: string;
}

export interface RegenerateWorkerPayload {
  type: 'regenerate_summary_work';
  viewId: string;
  channel: string;
  threadTs: string;
  triggerUserId: string;
  assigneeUserId: string;
  instructions: string;
  selectedEpicKey?: string;
  startDate?: string;
  endDate?: string;
  estimate?: string;
}

export interface BatchTicketBulkUpdateWorkerPayload {
  type: 'batch_ticket_bulk_update_work';
  channel: string;
  threadTs: string;
  triggerUserId: string;
  ticketKeys: string[];
  title?: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  estimate?: string;
}

export interface CreateDeployRoomWorkerPayload {
  type: 'create_deploy_room_work';
  channel: string;
  threadTs: string;
  triggerUserId: string;
  title: string;
  templateId: string;
  deployType: string;
  deployDate: string;
  confluencePageUrl?: string;
}

export interface ExtCreateTicketWorkerPayload {
  type: 'ext_create_ticket_work';
  title: string;
  description: string;
  assigneeSlackId: string;
  epicKey: string;
  startDate?: string;
  endDate?: string;
  estimate?: string;
  sourceUrl?: string;
  slackChannel?: string;
}

export interface ExtBatchTicketWorkerPayload {
  type: 'ext_batch_ticket_work';
  title: string;
  description: string;
  selectedUsers: string[];
  epicKey: string;
  startDate?: string;
  endDate?: string;
  estimate?: string;
  sourceUrl?: string;
}

export type WorkerPayload =
  | CreateTicketWorkerPayload
  | BatchTicketWorkerPayload
  | RegenerateWorkerPayload
  | BatchTicketBulkUpdateWorkerPayload
  | CreateDeployRoomWorkerPayload
  | ExtCreateTicketWorkerPayload
  | ExtBatchTicketWorkerPayload;

export const handleWorker = async (payload: WorkerPayload): Promise<void> => {
  if (payload.type === 'create_ticket_work') {
    await handleCreateTicketWork(payload);
  } else if (payload.type === 'batch_ticket_work') {
    await handleBatchTicketWork(payload);
  } else if (payload.type === 'regenerate_summary_work') {
    await handleRegenerateSummary(payload);
  } else if (payload.type === 'batch_ticket_bulk_update_work') {
    await handleBatchTicketBulkUpdateWork(payload);
  } else if (payload.type === 'create_deploy_room_work') {
    await handleCreateDeployRoom(payload);
  } else if (payload.type === 'ext_create_ticket_work') {
    await handleExtCreateTicketWork(payload);
  } else if (payload.type === 'ext_batch_ticket_work') {
    await handleExtBatchTicketWork(payload);
  }
};

const handleCreateTicketWork = async (p: CreateTicketWorkerPayload) => {
  const assigneeAccountId = SLACK_JIRA_USER_MAP[p.assigneeSlackId] || undefined;

  // 담당자의 Jira 인증정보를 Supabase에서 조회 → 해당 인증으로 생성하면 보고자=담당자
  let jiraAuth: { email: string; apiToken: string } | undefined;
  if (assigneeAccountId) {
    try {
      const creds = await getJiraCredsByAccountId(assigneeAccountId);
      if (creds?.igniteJiraEmail && creds?.igniteJiraApiToken) {
        jiraAuth = {
          email: creds.igniteJiraEmail,
          apiToken: creds.igniteJiraApiToken,
        };
      }
    } catch (e) {
      console.error('[worker] Supabase 인증 조회 실패, 기본 인증으로 fallback:', e);
    }
  }

  // Slack 쓰레드 링크를 description 하단에 추가
  const threadUrl = getSlackThreadUrl(p.channel, p.threadTs);
  const descWithLink = `${p.description}\n\n---\n🔗 Slack 쓰레드: ${threadUrl}`;

  const created = await createFehgTask({
    summary: p.title,
    description: descWithLink,
    assigneeAccountId,
    epicKey: p.epicKey,
    startDate: p.startDate,
    dueDate: p.endDate,
    originalEstimate: p.estimate,
    jiraAuth,
  });

  if (!p.channel || !p.threadTs) return;

  if (created) {
    const creatorMention = p.triggerUserId ? `<@${p.triggerUserId}>` : '누군가';
    const assigneeMention = p.assigneeSlackId ? `<@${p.assigneeSlackId}>` : '미지정';

    // 시작일/종료일/추정치 정보 조합
    const detailParts: string[] = [];
    if (p.startDate && p.endDate) {
      detailParts.push(`📅 ${p.startDate} → ${p.endDate}`);
    } else if (p.startDate) {
      detailParts.push(`📅 시작: ${p.startDate}`);
    } else if (p.endDate) {
      detailParts.push(`📅 종료: ${p.endDate}`);
    }
    if (p.estimate) {
      detailParts.push(`⏱ 추정: ${p.estimate}`);
    }
    const detailLine = detailParts.length ? `\n${detailParts.join('  ·  ')}` : '';

    await client.chat.postMessage({
      channel: p.channel,
      thread_ts: p.threadTs,
      text: `✅ FEHG 티켓 생성 완료: ${created.key} ${p.title} (${created.url}) · 생성자 ${creatorMention}`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `✅ *FEHG 티켓 생성 완료*\n<${created.url}|${created.key}> · ${p.title}${detailLine}`,
          },
          accessory: {
            type: 'button',
            text: { type: 'plain_text', text: '🔗 티켓 열기' },
            url: created.url,
            action_id: 'open_created_ticket_worker',
          },
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `🧑‍💻 생성자: ${creatorMention} · 👤 담당자: ${assigneeMention}`,
            },
          ],
        },
      ],
    });
  } else {
    await client.chat.postMessage({
      channel: p.channel,
      thread_ts: p.threadTs,
      text: `❌ 티켓 생성에 실패했습니다. 로그를 확인해주세요.`,
    });
  }

  // 담당자 매핑이 없으면 DM 경고
  if (!assigneeAccountId && p.triggerUserId) {
    try {
      await client.chat.postMessage({
        channel: p.triggerUserId,
        text: `⚠️ Slack user \`${p.assigneeSlackId}\` 의 Jira accountId 매핑이 \`SLACK_JIRA_USER_MAP\` 에 없어서 담당자 미할당 상태로 생성되었습니다.`,
      });
    } catch {
      /* ignore */
    }
  }
};

const handleBatchTicketWork = async (p: BatchTicketWorkerPayload) => {
  // Slack 쓰레드 링크를 description 하단에 추가
  const batchThreadUrl = getSlackThreadUrl(p.channel, p.threadTs);
  const batchDescWithLink = `${p.description}\n\n---\n🔗 Slack 쓰레드: ${batchThreadUrl}`;

  const results: Array<{
    slackUserId: string;
    created: CreatedIssue | null;
    missingMapping: boolean;
  }> = await Promise.all(
    p.selectedUsers.map(async (slackUserId) => {
      const assigneeAccountId = SLACK_JIRA_USER_MAP[slackUserId];
      if (!assigneeAccountId) {
        return { slackUserId, created: null, missingMapping: true };
      }

      // 담당자별 Jira 인증 조회
      let jiraAuth: { email: string; apiToken: string } | undefined;
      try {
        const creds = await getJiraCredsByAccountId(assigneeAccountId);
        if (creds?.igniteJiraEmail && creds?.igniteJiraApiToken) {
          jiraAuth = {
            email: creds.igniteJiraEmail,
            apiToken: creds.igniteJiraApiToken,
          };
        }
      } catch {
        // fallback to default auth
      }

      const created = await createFehgTask({
        summary: p.title,
        description: batchDescWithLink,
        assigneeAccountId,
        epicKey: p.epicKey,
        startDate: p.startDate || undefined,
        dueDate: p.endDate || undefined,
        originalEstimate: p.estimate || undefined,
        jiraAuth,
      });
      return { slackUserId, created, missingMapping: false };
    })
  );

  if (!p.channel || !p.threadTs) return;

  const creatorMention = p.triggerUserId ? `<@${p.triggerUserId}>` : '누군가';
  const successLines = results
    .filter((r) => r.created)
    .map((r) => `• <@${r.slackUserId}> → <${r.created!.url}|${r.created!.key}>`);
  const failureLines = results
    .filter((r) => !r.created)
    .map((r) =>
      r.missingMapping
        ? `• <@${r.slackUserId}> → ⚠️ Jira 매핑 없음 (SLACK_JIRA_USER_MAP 확인)`
        : `• <@${r.slackUserId}> → ❌ 생성 실패`
    );

  const successCount = successLines.length;
  const failCount = failureLines.length;

  // 시작일/종료일/추정치 정보 조합
  const batchDetailParts: string[] = [];
  if (p.startDate && p.endDate) {
    batchDetailParts.push(`📅 ${p.startDate} → ${p.endDate}`);
  } else if (p.startDate) {
    batchDetailParts.push(`📅 시작: ${p.startDate}`);
  } else if (p.endDate) {
    batchDetailParts.push(`📅 종료: ${p.endDate}`);
  }
  if (p.estimate) {
    batchDetailParts.push(`⏱ 추정: ${p.estimate}`);
  }
  const batchDetailLine = batchDetailParts.length ? batchDetailParts.join('  ·  ') : '';

  const summaryText = [
    `*📦 배치 티켓 생성 결과*  ·  성공 ${successCount} / 실패 ${failCount}`,
    `*제목*: ${p.title}`,
    batchDetailLine,
    '',
    successLines.length ? successLines.join('\n') : '_성공한 티켓 없음_',
    failureLines.length ? '\n*⚠️ 실패*\n' + failureLines.join('\n') : '',
  ]
    .filter(Boolean)
    .join('\n');

  // 성공한 티켓 키 목록을 metadata 에 저장 → 일괄 변경 시 사용
  const successTicketKeys = results
    .filter((r) => r.created)
    .map((r) => r.created!.key);

  await client.chat.postMessage({
    channel: p.channel,
    thread_ts: p.threadTs,
    text: `배치 티켓 생성 결과: 성공 ${successCount} / 실패 ${failCount} · 생성자 ${creatorMention}`,
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: summaryText },
      },
      {
        type: 'context',
        elements: [{ type: 'mrkdwn', text: `🧑‍💻 생성자: ${creatorMention}` }],
      },
    ],
    metadata: {
      event_type: 'batch_ticket_result',
      event_payload: {
        ticket_keys: successTicketKeys.join(','),
      },
    },
  });
};

/**
 * 재요약 worker: LLM 호출 → 모달 업데이트
 */
const handleRegenerateSummary = async (p: RegenerateWorkerPayload) => {
  try {
    // 담당자 이름 조회
    let assigneeName = p.assigneeUserId;
    try {
      const info = await client.users.info({ user: p.assigneeUserId });
      assigneeName =
        info.user?.profile?.display_name ||
        info.user?.real_name ||
        p.assigneeUserId;
    } catch { /* fallback to userId */ }

    const [messages, epics] = await Promise.all([
      fetchThreadMessages(client, p.channel, p.threadTs),
      getActiveEpics(),
    ]);

    const ctx: SummarizeContext = {
      assigneeName,
      instructions: p.instructions || undefined,
    };
    const draft = await summarizeThreadToTicket(messages, ctx);

    const epicOptions = epics.slice(0, 100).map((e) => ({
      text: { type: 'plain_text' as const, text: `${e.key} ${e.summary}`.slice(0, 75) },
      value: e.key,
    }));
    const initialEpic =
      p.selectedEpicKey && epicOptions.find((o) => o.value === p.selectedEpicKey)
        ? epicOptions.find((o) => o.value === p.selectedEpicKey)!
        : undefined;

    const metadata = { channel: p.channel, threadTs: p.threadTs, triggerUserId: p.triggerUserId };
    const blocks: any[] = [];

    // 1. 담당자
    blocks.push({
      type: 'input', block_id: 'assignee_block',
      label: { type: 'plain_text', text: '담당자' },
      element: { type: 'users_select', action_id: 'assignee', initial_user: p.assigneeUserId },
    });
    // 2. 제목
    blocks.push({
      type: 'input', block_id: 'title_block',
      label: { type: 'plain_text', text: '제목' },
      element: { type: 'plain_text_input', action_id: 'title', initial_value: draft?.title ?? '', max_length: 250 },
    });
    // 3. 본문
    blocks.push({
      type: 'input', block_id: 'description_block',
      label: { type: 'plain_text', text: '본문' },
      element: { type: 'plain_text_input', action_id: 'description', multiline: true, initial_value: draft?.description ?? '' },
    });
    // 4. 에픽
    if (epicOptions.length > 0) {
      blocks.push({
        type: 'input', block_id: 'epic_block',
        label: { type: 'plain_text', text: '상위 에픽' },
        element: {
          type: 'static_select', action_id: 'epic',
          placeholder: { type: 'plain_text', text: '에픽 선택' },
          options: epicOptions,
          ...(initialEpic ? { initial_option: initialEpic } : {}),
        },
      });
    } else {
      blocks.push({ type: 'section', text: { type: 'mrkdwn', text: '⚠️ _진행중인 FEHG 에픽을 찾지 못했습니다._' } });
    }
    // 5. 시작일
    blocks.push({
      type: 'input', block_id: 'start_date_block', optional: true,
      label: { type: 'plain_text', text: '시작일' },
      element: { type: 'datepicker', action_id: 'start_date', ...(p.startDate ? { initial_date: p.startDate } : {}), placeholder: { type: 'plain_text', text: '시작일 선택' } },
    });
    // 6. 종료일
    blocks.push({
      type: 'input', block_id: 'end_date_block', optional: true,
      label: { type: 'plain_text', text: '종료일' },
      element: { type: 'datepicker', action_id: 'end_date', ...(p.endDate ? { initial_date: p.endDate } : {}), placeholder: { type: 'plain_text', text: '종료일 선택' } },
    });
    // 7. 추정치
    blocks.push({
      type: 'input', block_id: 'estimate_block', optional: true,
      label: { type: 'plain_text', text: '최초추정치' },
      hint: { type: 'plain_text', text: '형식: 숫자 + 단위 (d=일, w=주, h=시간, m=분) 예: 3d, 1w, 1.5h' },
      element: { type: 'plain_text_input', action_id: 'estimate', initial_value: p.estimate ?? '', placeholder: { type: 'plain_text', text: '예: 3d' } },
    });
    // 8. 추가 지시사항
    blocks.push({
      type: 'input', block_id: 'instructions_block', optional: true,
      label: { type: 'plain_text', text: '추가 지시사항 (선택)' },
      hint: { type: 'plain_text', text: '예: "FE 작업만 추출", "김가빈이 해야 할 API 연동만"' },
      element: { type: 'plain_text_input', action_id: 'instructions', multiline: true, initial_value: p.instructions },
    });
    // 9. 재요약 버튼
    blocks.push({
      type: 'actions', block_id: 'regenerate_block',
      elements: [{ type: 'button', action_id: 'regenerate_summary', text: { type: 'plain_text', text: '🔄 담당자/지시사항 반영해 다시 요약' } }],
    });
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: draft
        ? '✨ Groq 가 쓰레드 + 담당자/지시사항 기반으로 초안을 만들었습니다. 수정하거나 🔄 버튼으로 다시 요약할 수 있어요.'
        : '⚠️ LLM 요약에 실패했습니다. 직접 입력하거나 🔄 버튼으로 다시 시도하세요.' }],
    });

    await client.views.update({
      view_id: p.viewId,
      view: {
        type: 'modal' as const,
        callback_id: 'create_ticket_modal',
        private_metadata: JSON.stringify(metadata),
        title: { type: 'plain_text' as const, text: 'FEHG 티켓 만들기' },
        submit: { type: 'plain_text' as const, text: '생성' },
        close: { type: 'plain_text' as const, text: '취소' },
        blocks,
      },
    });
  } catch (e) {
    console.error('[worker] 재요약 실패:', e);
  }
};

/**
 * 배치 티켓 일괄 변경 worker
 */
const handleBatchTicketBulkUpdateWork = async (
  p: BatchTicketBulkUpdateWorkerPayload
) => {
  // Slack 쓰레드 링크를 description 에 재추가
  const threadUrl = getSlackThreadUrl(p.channel, p.threadTs);
  const descWithLink = p.description
    ? `${p.description}\n\n---\n🔗 Slack 쓰레드: ${threadUrl}`
    : undefined;

  const results = await Promise.all(
    p.ticketKeys.map(async (key) => {
      const success = await updateIssue({
        issueKey: key,
        summary: p.title,
        description: descWithLink,
        startDate: p.startDate,
        dueDate: p.endDate,
        originalEstimate: p.estimate,
      });
      return { key, success };
    })
  );

  if (!p.channel || !p.threadTs) return;

  const successCount = results.filter((r) => r.success).length;
  const failCount = results.filter((r) => !r.success).length;
  const creatorMention = p.triggerUserId
    ? `<@${p.triggerUserId}>`
    : '누군가';

  const successKeys = results.filter((r) => r.success).map((r) => r.key);
  const failKeys = results.filter((r) => !r.success).map((r) => r.key);

  // 변경 내용 요약
  const changeParts: string[] = [];
  if (p.title) changeParts.push(`제목: ${p.title}`);
  if (p.startDate && p.endDate) {
    changeParts.push(`📅 ${p.startDate} → ${p.endDate}`);
  } else if (p.startDate) {
    changeParts.push(`📅 시작: ${p.startDate}`);
  } else if (p.endDate) {
    changeParts.push(`📅 종료: ${p.endDate}`);
  }
  if (p.estimate) changeParts.push(`⏱ 추정: ${p.estimate}`);

  const summaryText = [
    `*🔄 배치 티켓 일괄 변경 결과*  ·  성공 ${successCount} / 실패 ${failCount}`,
    changeParts.length ? changeParts.join('  ·  ') : '',
    '',
    successKeys.length
      ? `✅ ${successKeys.join(', ')}`
      : '_성공한 티켓 없음_',
    failKeys.length ? `❌ 실패: ${failKeys.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  await client.chat.postMessage({
    channel: p.channel,
    thread_ts: p.threadTs,
    text: `배치 티켓 일괄 변경 결과: 성공 ${successCount} / 실패 ${failCount}`,
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: summaryText },
      },
      {
        type: 'context',
        elements: [
          { type: 'mrkdwn', text: `🧑‍💻 변경자: ${creatorMention}` },
        ],
      },
    ],
  });
};

/**
 * 배포방 생성 worker: fe1-web API 호출 → Slack 메시지
 */
const FE1_WEB_BASE_URL = 'https://fe1-jira-sync.vercel.app';
const VERCEL_BYPASS_SECRET = process.env.VERCEL_BYPASS_SECRET || '';

const handleCreateDeployRoom = async (p: CreateDeployRoomWorkerPayload) => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (VERCEL_BYPASS_SECRET) {
    headers['x-vercel-protection-bypass'] = VERCEL_BYPASS_SECRET;
  }

  try {
    const res = await fetch(`${FE1_WEB_BASE_URL}/api/deploy-room/sessions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        title: p.title,
        templateId: p.templateId,
        deployType: p.deployType,
        deployDate: p.deployDate,
        confluencePageUrl: p.confluencePageUrl,
      }),
    });

    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.error || `API 응답: ${res.status}`);
    }

    const sessionId = data.session.id;
    const deployRoomUrl = `${FE1_WEB_BASE_URL}/deploy-room/${sessionId}`;
    const creatorMention = p.triggerUserId ? `<@${p.triggerUserId}>` : '';

    await client.chat.postMessage({
      channel: p.channel,
      ...(p.threadTs ? { thread_ts: p.threadTs } : {}),
      text: `✅ 배포방 생성 완료: ${p.title} (${deployRoomUrl})`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `✅ *배포방 생성 완료*\n<${deployRoomUrl}|${p.title}>`,
          },
          accessory: {
            type: 'button',
            text: { type: 'plain_text', text: '🔗 배포방 열기' },
            url: deployRoomUrl,
            action_id: 'open_deploy_room',
          },
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `📅 배포일: ${p.deployDate}  ·  🧑‍💻 생성자: ${creatorMention}`,
            },
          ],
        },
      ],
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[worker] 배포방 생성 실패:', e);

    await client.chat.postMessage({
      channel: p.channel,
      ...(p.threadTs ? { thread_ts: p.threadTs } : {}),
      text: `❌ 배포방 생성 실패: ${msg}`,
    });
  }
};

/**
 * Chrome Extension 등 외부 클라이언트에서 요청한 티켓 생성 worker.
 * Slack 쓰레드 대신 sourceUrl 을 description 에 추가한다.
 */
const handleExtCreateTicketWork = async (p: ExtCreateTicketWorkerPayload) => {
  const assigneeAccountId = p.assigneeSlackId
    ? SLACK_JIRA_USER_MAP[p.assigneeSlackId] || undefined
    : undefined;

  let jiraAuth: { email: string; apiToken: string } | undefined;
  if (assigneeAccountId) {
    try {
      const creds = await getJiraCredsByAccountId(assigneeAccountId);
      if (creds?.igniteJiraEmail && creds?.igniteJiraApiToken) {
        jiraAuth = {
          email: creds.igniteJiraEmail,
          apiToken: creds.igniteJiraApiToken,
        };
      }
    } catch (e) {
      console.error('[worker] Supabase 인증 조회 실패, 기본 인증으로 fallback:', e);
    }
  }

  // sourceUrl 이 있으면 description 하단에 추가
  const descWithLink = p.sourceUrl
    ? `${p.description}\n\n---\n🔗 원문: ${p.sourceUrl}`
    : p.description;

  const created = await createFehgTask({
    summary: p.title,
    description: descWithLink,
    assigneeAccountId,
    epicKey: p.epicKey,
    startDate: p.startDate,
    dueDate: p.endDate,
    originalEstimate: p.estimate,
    jiraAuth,
  });

  // Slack 채널이 지정되어 있으면 결과 알림
  const notifyChannel = p.slackChannel || process.env.EXT_NOTIFY_SLACK_CHANNEL;
  if (!notifyChannel) return;

  if (created) {
    const assigneeMention = p.assigneeSlackId ? `<@${p.assigneeSlackId}>` : '미지정';
    const detailParts: string[] = [];
    if (p.startDate && p.endDate) {
      detailParts.push(`📅 ${p.startDate} → ${p.endDate}`);
    } else if (p.startDate) {
      detailParts.push(`📅 시작: ${p.startDate}`);
    } else if (p.endDate) {
      detailParts.push(`📅 종료: ${p.endDate}`);
    }
    if (p.estimate) {
      detailParts.push(`⏱ 추정: ${p.estimate}`);
    }
    const detailLine = detailParts.length ? `\n${detailParts.join('  ·  ')}` : '';

    await client.chat.postMessage({
      channel: notifyChannel,
      text: `✅ FEHG 티켓 생성 완료 (Extension): ${created.key} ${p.title}`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `✅ *FEHG 티켓 생성 완료* (Extension)\n<${created.url}|${created.key}> · ${p.title}${detailLine}`,
          },
          accessory: {
            type: 'button',
            text: { type: 'plain_text', text: '🔗 티켓 열기' },
            url: created.url,
            action_id: 'open_created_ticket_worker',
          },
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `👤 담당자: ${assigneeMention}${p.sourceUrl ? `  ·  🔗 <${p.sourceUrl}|원문 보기>` : ''}`,
            },
          ],
        },
      ],
    });
  } else {
    await client.chat.postMessage({
      channel: notifyChannel,
      text: `❌ Extension 티켓 생성 실패: ${p.title}`,
    });
  }
};

/**
 * Chrome Extension 등 외부 클라이언트에서 요청한 일괄 티켓 생성 worker.
 * 기존 handleBatchTicketWork 와 동일한 로직이나 Slack 쓰레드 대신 sourceUrl 사용.
 */
const handleExtBatchTicketWork = async (p: ExtBatchTicketWorkerPayload) => {
  const descWithLink = p.sourceUrl
    ? `${p.description}\n\n---\n🔗 원문: ${p.sourceUrl}`
    : p.description;

  const results: Array<{
    slackUserId: string;
    created: CreatedIssue | null;
    missingMapping: boolean;
  }> = await Promise.all(
    p.selectedUsers.map(async (slackUserId) => {
      const assigneeAccountId = SLACK_JIRA_USER_MAP[slackUserId];
      if (!assigneeAccountId) {
        return { slackUserId, created: null, missingMapping: true };
      }

      let jiraAuth: { email: string; apiToken: string } | undefined;
      try {
        const creds = await getJiraCredsByAccountId(assigneeAccountId);
        if (creds?.igniteJiraEmail && creds?.igniteJiraApiToken) {
          jiraAuth = {
            email: creds.igniteJiraEmail,
            apiToken: creds.igniteJiraApiToken,
          };
        }
      } catch {
        // fallback to default auth
      }

      const created = await createFehgTask({
        summary: p.title,
        description: descWithLink,
        assigneeAccountId,
        epicKey: p.epicKey,
        startDate: p.startDate || undefined,
        dueDate: p.endDate || undefined,
        originalEstimate: p.estimate || undefined,
        jiraAuth,
      });
      return { slackUserId, created, missingMapping: false };
    })
  );

  const notifyChannel = process.env.EXT_NOTIFY_SLACK_CHANNEL;
  if (!notifyChannel) return;

  const successLines = results
    .filter((r) => r.created)
    .map((r) => `• <@${r.slackUserId}> → <${r.created!.url}|${r.created!.key}>`);
  const failureLines = results
    .filter((r) => !r.created)
    .map((r) =>
      r.missingMapping
        ? `• <@${r.slackUserId}> → ⚠️ Jira 매핑 없음`
        : `• <@${r.slackUserId}> → ❌ 생성 실패`
    );

  const successCount = successLines.length;
  const failCount = failureLines.length;

  const detailParts: string[] = [];
  if (p.startDate && p.endDate) {
    detailParts.push(`📅 ${p.startDate} → ${p.endDate}`);
  } else if (p.startDate) {
    detailParts.push(`📅 시작: ${p.startDate}`);
  } else if (p.endDate) {
    detailParts.push(`📅 종료: ${p.endDate}`);
  }
  if (p.estimate) {
    detailParts.push(`⏱ 추정: ${p.estimate}`);
  }
  const detailLine = detailParts.length ? detailParts.join('  ·  ') : '';

  const summaryText = [
    `*📦 배치 티켓 생성 결과* (Extension)  ·  성공 ${successCount} / 실패 ${failCount}`,
    `*제목*: ${p.title}`,
    detailLine,
    '',
    successLines.length ? successLines.join('\n') : '_성공한 티켓 없음_',
    failureLines.length ? '\n*⚠️ 실패*\n' + failureLines.join('\n') : '',
    p.sourceUrl ? `\n🔗 <${p.sourceUrl}|원문 보기>` : '',
  ]
    .filter(Boolean)
    .join('\n');

  await client.chat.postMessage({
    channel: notifyChannel,
    text: `배치 티켓 생성 결과 (Extension): 성공 ${successCount} / 실패 ${failCount}`,
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: summaryText },
      },
    ],
  });
};
