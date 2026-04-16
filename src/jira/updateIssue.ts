import { jiraClient } from './client';

export interface UpdateTaskInput {
  issueKey: string;
  summary?: string;
  description?: string;
  startDate?: string;
  dueDate?: string;
  originalEstimate?: string;
}

export interface JiraIssueDetails {
  key: string;
  summary: string;
  description: string;
  startDate: string | null;
  dueDate: string | null;
  originalEstimate: string | null;
}

/**
 * ADF → plain text 변환.
 * 생성 시 plain text → ADF 로 변환한 것의 역변환이므로 paragraph > text 만 처리.
 */
const fromAdf = (adf: any): string => {
  if (!adf || !adf.content) return '';
  return adf.content
    .map((block: any) =>
      (block.content || []).map((node: any) => node.text || '').join('')
    )
    .join('\n');
};

/**
 * plain text → ADF 변환. createIssue.ts 의 toAdf 와 동일한 로직.
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
 * Jira 이슈 상세 조회 (제목, 본문, 시작일, 종료일, 추정치)
 */
export const getIssueDetails = async (
  issueKey: string
): Promise<JiraIssueDetails | null> => {
  try {
    const res = await jiraClient.get(`/issue/${issueKey}`, {
      params: {
        fields: 'summary,description,customfield_10015,duedate,timetracking',
      },
    });
    const fields = res.data.fields;
    return {
      key: res.data.key,
      summary: fields.summary || '',
      description: fromAdf(fields.description),
      startDate: fields.customfield_10015 || null,
      dueDate: fields.duedate || null,
      originalEstimate: fields.timetracking?.originalEstimate || null,
    };
  } catch (e: any) {
    console.error(
      '[jira] getIssueDetails 실패:',
      JSON.stringify(e?.response?.data || { message: e?.message }, null, 2)
    );
    return null;
  }
};

/**
 * Jira 이슈 필드 업데이트. 전달된 필드만 변경한다.
 */
export const updateIssue = async (input: UpdateTaskInput): Promise<boolean> => {
  const fields: Record<string, unknown> = {};

  if (input.summary !== undefined) fields.summary = input.summary;
  if (input.description !== undefined) fields.description = toAdf(input.description);
  if (input.startDate !== undefined)
    fields.customfield_10015 = input.startDate || null;
  if (input.dueDate !== undefined) fields.duedate = input.dueDate || null;
  if (input.originalEstimate !== undefined) {
    fields.timetracking = {
      originalEstimate: input.originalEstimate || null,
    };
  }

  if (Object.keys(fields).length === 0) return true;

  try {
    await jiraClient.put(`/issue/${input.issueKey}`, { fields });
    return true;
  } catch (e: any) {
    console.error(
      `[jira] updateIssue ${input.issueKey} 실패:`,
      JSON.stringify(e?.response?.data || { message: e?.message }, null, 2)
    );
    return false;
  }
};
