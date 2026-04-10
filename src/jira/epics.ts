import { JIRA_CONFIG } from '../constant';
import { jiraClient } from './client';

export interface JiraEpic {
  key: string;
  summary: string;
}

// Jira Cloud 2024년 enhanced search API.
// fe1-web 과 동일한 엔드포인트/파라미터를 사용한다.
interface SearchJqlResponse {
  issues: Array<{
    key: string;
    fields: { summary: string };
  }>;
  nextPageToken?: string;
  isLast?: boolean;
}

/**
 * FEHG 프로젝트의 완료되지 않은 에픽 목록을 조회한다.
 *
 * fe1-web (`lib/services/jira/ignite.service.ts`) 의
 * `getIncompleteEpicsByProject` 와 동일한 JQL.
 * - 한국어 로케일이라 issuetype = "에픽" 으로 조회해야 한다.
 */
export const getActiveEpics = async (): Promise<JiraEpic[]> => {
  const jql = `project = ${JIRA_CONFIG.PROJECT_KEY} AND issuetype = 에픽 AND status != Done AND status != 완료 ORDER BY created DESC`;

  try {
    const res = await jiraClient.get<SearchJqlResponse>('/search/jql', {
      params: {
        jql,
        fields: 'summary',
        maxResults: 100,
      },
    });

    return (res.data.issues ?? []).map((issue) => ({
      key: issue.key,
      summary: issue.fields.summary,
    }));
  } catch (e: any) {
    console.error(
      '[jira] getActiveEpics 실패:',
      JSON.stringify(e?.response?.data || { message: e?.message }, null, 2)
    );
    return [];
  }
};
