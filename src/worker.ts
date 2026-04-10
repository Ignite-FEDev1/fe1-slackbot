import { WebClient } from '@slack/web-api';
import { SLACK_JIRA_USER_MAP } from './constant';
import { createFehgTask, CreatedIssue } from './jira/createIssue';

const client = new WebClient(process.env.SLACK_BOT_TOKEN);

export interface CreateTicketWorkerPayload {
  type: 'create_ticket_work';
  channel: string;
  threadTs: string;
  triggerUserId: string;
  title: string;
  description: string;
  assigneeSlackId: string;
  epicKey: string;
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

export type WorkerPayload = CreateTicketWorkerPayload | BatchTicketWorkerPayload;

export const handleWorker = async (payload: WorkerPayload): Promise<void> => {
  if (payload.type === 'create_ticket_work') {
    await handleCreateTicketWork(payload);
  } else if (payload.type === 'batch_ticket_work') {
    await handleBatchTicketWork(payload);
  }
};

const handleCreateTicketWork = async (p: CreateTicketWorkerPayload) => {
  const assigneeAccountId = SLACK_JIRA_USER_MAP[p.assigneeSlackId] || undefined;

  const created = await createFehgTask({
    summary: p.title,
    description: p.description,
    assigneeAccountId,
    epicKey: p.epicKey,
  });

  if (!p.channel || !p.threadTs) return;

  if (created) {
    const creatorMention = p.triggerUserId ? `<@${p.triggerUserId}>` : '누군가';
    const assigneeMention = p.assigneeSlackId ? `<@${p.assigneeSlackId}>` : '미지정';
    await client.chat.postMessage({
      channel: p.channel,
      thread_ts: p.threadTs,
      text: `✅ FEHG 티켓 생성 완료: ${created.key} ${p.title} (${created.url}) · 생성자 ${creatorMention}`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `✅ *FEHG 티켓 생성 완료*\n<${created.url}|${created.key}> · ${p.title}`,
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
      const created = await createFehgTask({
        summary: p.title,
        description: p.description,
        assigneeAccountId,
        epicKey: p.epicKey,
        startDate: p.startDate || undefined,
        dueDate: p.endDate || undefined,
        originalEstimate: p.estimate || undefined,
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

  const summaryText = [
    `*📦 배치 티켓 생성 결과*  ·  성공 ${successCount} / 실패 ${failCount}`,
    `*제목*: ${p.title}`,
    '',
    successLines.length ? successLines.join('\n') : '_성공한 티켓 없음_',
    failureLines.length ? '\n*⚠️ 실패*\n' + failureLines.join('\n') : '',
  ]
    .filter(Boolean)
    .join('\n');

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
  });
};
