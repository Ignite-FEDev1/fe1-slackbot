import axios from 'axios';
import { JIRA_CONFIG } from '../constant';
import { buildIssueUrl, jiraClient } from './client';

export interface CreateTaskInput {
  summary: string;
  description: string;
  assigneeAccountId?: string;
  epicKey: string; // 필수 — fe1-web 과 동일하게 에픽 지정 없이는 생성 불가
  /** YYYY-MM-DD. fe1-web 에서 customfield_10015 = 시작일 */
  startDate?: string;
  /** YYYY-MM-DD. fe1-web 에서 duedate = 종료일 */
  dueDate?: string;
  /** Jira 포맷. fe1-web 의 패턴: /^(\d+\.?\d*)(d|m|w|h)$/i (예: 3d, 1w, 1.5h) */
  originalEstimate?: string;
  /** 담당자의 Jira 인증정보. 제공되면 이 인증으로 API 호출 → 보고자=담당자 */
  jiraAuth?: {
    email: string;
    apiToken: string;
  };
}

export interface CreatedIssue {
  key: string;
  url: string;
}

/**
 * LLM 이 만든 markdown-ish 텍스트를 Jira ADF 문단으로 변환한다.
 * fe1-web/app/create-ticket/page.tsx 의 변환 로직과 동일한 구조.
 */
const toAdf = (text: string) => {
  const lines = text.split('\n');
  const content: Array<Record<string, unknown>> = [];

  for (const raw of lines) {
    const line = raw.trimEnd();
    content.push({
      type: 'paragraph',
      content: line ? [{ type: 'text', text: line }] : [],
    });
  }

  if (content.length === 0) {
    content.push({ type: 'paragraph', content: [] });
  }

  return { type: 'doc', version: 1, content };
};

/**
 * FEHG 프로젝트에 "작업" 타입 티켓을 생성한다.
 * 공수/시작-종료일 등은 Jira 에서 직접 입력하므로 여기서 안 채운다.
 *
 * fe1-web `app/create-ticket/page.tsx` 의 handleCreateTicket 과 동일한 payload 구조.
 */
export const createFehgTask = async (
  input: CreateTaskInput
): Promise<CreatedIssue | null> => {
  const fields: Record<string, unknown> = {
    project: { key: JIRA_CONFIG.PROJECT_KEY },
    summary: input.summary,
    issuetype: { name: '작업' },
    parent: { key: input.epicKey },
    description: toAdf(input.description),
  };

  if (input.assigneeAccountId) {
    fields.assignee = { accountId: input.assigneeAccountId };
  }
  if (input.startDate) {
    fields.customfield_10015 = input.startDate;
  }
  if (input.dueDate) {
    fields.duedate = input.dueDate;
  }
  if (input.originalEstimate) {
    fields.timetracking = { originalEstimate: input.originalEstimate };
  }

  // 담당자 인증정보가 제공되면 해당 인증으로 호출 (보고자=담당자)
  const client = input.jiraAuth
    ? axios.create({
        baseURL: `${JIRA_CONFIG.BASE_URL}/rest/api/3`,
        auth: {
          username: input.jiraAuth.email,
          password: input.jiraAuth.apiToken,
        },
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
      })
    : jiraClient;

  try {
    const res = await client.post<{ key: string }>('/issue', { fields });
    return {
      key: res.data.key,
      url: buildIssueUrl(res.data.key),
    };
  } catch (e: any) {
    console.error(
      '[jira] createFehgTask 실패. 요청 fields:',
      JSON.stringify(fields, null, 2)
    );
    console.error(
      '[jira] 응답:',
      JSON.stringify(e?.response?.data || { message: e?.message }, null, 2)
    );
    return null;
  }
};
