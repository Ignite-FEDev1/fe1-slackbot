import axios, { AxiosError } from 'axios';
import { getUserId as getSlackUserId, getUserId } from '.';
import { SLACK_GITHUB_USER_MAP, SLACK_JIRA_USER_MAP, GW_JIRA_CONFIG, FEHG_TARGET_EPICS, FEHG_TO_GW_FIELD_MAPPING, EPIC_FIELD_MAPPING, FEHG_LINK_FIELD } from './constant';
import {
  JiraIssue,
  JiraIssueResponse,
  JiraPage,
  JiraPageResponse,
  ParsedJiraPage,
  ParsedJiraTask,
  GWJiraIssue,
  GWJiraCreatePayload,
  GWJiraUpdatePayload,
  FEHGEpicIssue,
  JiraIssueDetail,
} from './types/jira';

const auth = {
  username: 'ssj@ignite.co.kr',
  password: process.env.ATLASSIAN_TOKEN || '',
};

export const getJirIssues = async (
  jql: string
): Promise<ParsedJiraTask[] | null> => {
  try {
    const jiraApiUrl = `https://ignite
corp.atlassian.net/rest/agile/1.0/board/251/issue?jql=${encodeURIComponent(
      jql
    )}`;

    if (!auth.password) {
      return null;
    }

    const response = await axios.get<JiraIssueResponse>(jiraApiUrl, { auth });

    if (!response?.data?.issues || response.data.issues.length === 0) {
      return null;
    }

    const tasks: ParsedJiraTask[] = response.data.issues.map((issue) => ({
      id: issue.id,
      key: issue.key,
      name: issue.fields.summary || '',
      status: issue.fields.status.name || '',
      url: `https://ignitecorp.atlassian.net/browse/${issue.key}`,
    }));

    return tasks.length > 0 ? tasks : null;
  } catch (e) {
    console.error('Error fetching Jira tasks:', e);
    return null;
  }
};

export const getTodayJiraIssues = async (): Promise<
  ParsedJiraTask[] | null
> => {
  try {
    // JQL을 활용하여 오늘 해야 할 일 조회
    const jql = `assignee IN (${
      SLACK_JIRA_USER_MAP[getUserId()]
    }) AND "start date[date]" <= now() AND due >= now() AND NOT IN (Done, 완료) ORDER BY updated DESC`;
    return await getJirIssues(jql);
  } catch (e) {
    console.error('Error fetching Jira tasks:', e);
    return null;
  }
};

export const getNotStartedJiraIssues = async (): Promise<
  ParsedJiraTask[] | null
> => {
  try {
    // JQL을 활용하여 아직 시작하지 않은 일 조회
    const jql = `assignee IN (${
      SLACK_JIRA_USER_MAP[getUserId()]
    }) AND "start date[date]" <= now() AND status NOT IN (TODO, "To Do", Done, 완료) ORDER BY updated DESC`;
    return await getJirIssues(jql);
  } catch (e) {
    console.error('Error fetching Jira tasks:', e);
    return null;
  }
};

export const getNotEndedJiraIssues = async (): Promise<
  ParsedJiraTask[] | null
> => {
  try {
    // JQL을 활용하여 아직 끝나지 않은 일 조회
    const jql = `assignee IN (${
      SLACK_JIRA_USER_MAP[getUserId()]
    }) AND due <= now() AND status NOT IN (Done, 완료) ORDER BY updated DESC`;
    return await getJirIssues(jql);
  } catch (e) {
    console.error('Error fetching Jira tasks:', e);
    return null;
  }
};

export const getLatestGitHubPR = async (
  owner: string,
  repo: string,
  token: string
) => {
  const url = `https://api.github.com/repos/${owner}/${repo}/pulls`;
  try {
    const response = await axios.get(url, {
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });

    const slackUserId = getSlackUserId();
    const githubUser =
      SLACK_GITHUB_USER_MAP[slackUserId as keyof typeof SLACK_GITHUB_USER_MAP];

    if (!githubUser) {
      return null;
    }

    if (response.data.length === 0) {
      return null;
    }

    const currentUserPRs = response.data.filter(
      (pr: any) => pr.user.login === githubUser
    );

    if (currentUserPRs.length === 0) {
      return null;
    }

    return currentUserPRs[0];
  } catch (error) {
    const isAxiosError = axios.isAxiosError(error);
    if (isAxiosError) {
      console.log(
        'Error fetching latest GitHub PR:',
        error.response ? error.response.data : error.message
      );
      return;
    }
    console.log(error);
  }
};

export const getLatestGitLabMR = async (projectId: string, token: string) => {
  const url = `https://gitlab.com/api/v4/projects/${projectId}/merge_requests`;
  try {
    const response = await axios.get(url, {
      headers: {
        'Private-Token': token,
      },
      params: {
        state: 'opened',
        order_by: 'created_at',
        sort: 'desc',
        per_page: 1,
      },
    });

    console.log('response: ', response.data);

    if (response.data.length === 0) {
      return null;
    }

    // 최신 MR은 목록의 첫 번째 요소
    const latestMR = response.data[0];
    console.log('latestMR: ', latestMR);
    // return latestMR;
  } catch (error) {
    const isAxiosError = axios.isAxiosError(error);
    if (isAxiosError) {
      console.log(
        'Error fetching latest GitHub PR:',
        error.response ? error.response.data : error.message
      );
      return;
    }
    console.log(error);
  }
};

export const getLatestCPODeployPages = async () => {
  try {
    const auth = {
      username: 'ssj@ignite.co.kr',
      password: process.env.ATLASSIAN_TOKEN || '',
    };
    const deployPageId = '362676616';
    const childPageUrl = `https://ignitecorp.atlassian.net/wiki/rest/api/content/${deployPageId}/child/page`;

    if (!auth.password) {
      return null;
    }

    const response = await axios.get(childPageUrl, { auth });

    if (!response?.data?.results || response.data.results.length === 0) {
      return null;
    }

    // 최신 월 배포 관리 페이지 획득 (ex. Dev) 배포관리 - 2024-09)
    const latestMonthPageId = response.data.results[0].id;
    const latestMonthPageUrl = `https://ignitecorp.atlassian.net/wiki/rest/api/content/${latestMonthPageId}/child/page`;
    const latestChildPageResponse = await axios.get(latestMonthPageUrl, {
      auth,
    });

    const beforeLatestMonthPageId = response.data.results[1].id;
    const beforeLatestMonthPageUrl = `https://ignitecorp.atlassian.net/wiki/rest/api/content/${beforeLatestMonthPageId}/child/page`;
    const beforeChildPageResponse = await axios.get(beforeLatestMonthPageUrl, {
      auth,
    });

    if (
      (!latestChildPageResponse?.data?.results ||
        latestChildPageResponse.data.results.length === 0) &&
      (!beforeChildPageResponse?.data?.results ||
        beforeChildPageResponse.data.results.length === 0)
    ) {
      return null;
    }

    // 최신 페이지 3개를 담을 배열 초기화
    let pages = [];

    // latestMonthPage 자식 페이지 추가
    if (
      latestChildPageResponse?.data?.results &&
      latestChildPageResponse.data.results.length > 0
    ) {
      pages = latestChildPageResponse.data.results.slice(-3);
    }

    // beforeLatestMonthPage 자식 페이지 추가
    if (beforeChildPageResponse?.data?.results && pages.length < 3) {
      const remainingSlots = 3 - pages.length;
      const beforePages = beforeChildPageResponse.data.results.slice(
        -remainingSlots
      );
      pages = [...pages, ...beforePages];
    }

    // 반환할 페이지 정보 구성
    const results = pages
      .map((page: { title?: string; _links?: { webui?: string } }) => ({
        name: page.title || '',
        url: page._links?.webui
          ? `https://ignitecorp.atlassian.net/wiki${page._links.webui}`
          : '',
      }))
      .filter((page: { name?: string; url?: string }) => page.name && page.url);

    return results.length > 0 ? results : null;
  } catch (e) {
    return null;
  }
};

export const getLatestPages = async (
  containerId: string,
  count: number = 10
) => {
  try {
    const childPageUrl = `https://ignitecorp.atlassian.net/wiki/rest/api/content/${containerId}/child/page`;

    if (!auth.password) {
      return null;
    }

    const response = await axios.get<JiraPageResponse>(childPageUrl, { auth });

    if (!response?.data?.results || response.data.results.length === 0) {
      return null;
    }

    // 최신 페이지 3개를 담을 배열 초기화
    let pages: JiraPage[] = [];

    // latestMonthPage 자식 페이지 추가
    if (response?.data?.results && response.data.results.length > 0) {
      pages = response.data.results.slice(-1 * count);
    }

    // 반환할 페이지 정보 구성
    const results: ParsedJiraPage[] = pages
      .map(
        (page: {
          title?: string;
          _links?: { webui?: string };
          id: string;
        }) => ({
          name: page.title || '',
          url: page._links?.webui
            ? `https://ignitecorp.atlassian.net/wiki${page._links.webui}`
            : '',
          id: page.id,
        })
      )
      .filter((page: { name?: string; url?: string }) => page.name && page.url);

    return results.length > 0 ? results : null;
  } catch (e) {
    console.log(e);
    return null;
  }
};

export const getPageContent = async (pageId: string) => {
  try {
    const pageUrl = `https://ignitecorp.atlassian.net/wiki/rest/api/content/${pageId}?expand=body.storage`;

    const response = await axios.get(pageUrl, { auth });

    if (!response?.data || !response.data.body?.storage?.value) return null;

    return {
      title: response.data.title,
      body: response.data.body.storage.value, // 원본 페이지 내용 (HTML)
    };
  } catch (e) {
    logSimplifiedError(e);
    return null;
  }
};

export const createNewPage = async (
  containerId: string,
  content: string,
  title: string
) => {
  try {
    const createPageUrl = `https://ignitecorp.atlassian.net/wiki/rest/api/content`;

    const newPageData = {
      type: 'page',
      title, // 새로운 제목
      ancestors: [{ id: containerId }], // 부모 페이지 설정
      space: { key: 'IF' }, // 스페이스 키 설정
      body: {
        storage: {
          value: content, // 원본 페이지 내용 유지
          representation: 'storage',
        },
      },
    };

    const response = await axios.post(createPageUrl, newPageData, { auth });

    return response.data;
  } catch (e) {
    logSimplifiedError(e);
    return null;
  }
};

export const getLatestChildPage = async (pageId: string) => {
  try {
    const auth = {
      username: 'ssj@ignite.co.kr',
      password: process.env.ATLASSIAN_TOKEN || '',
    };
    const childPageUrl = `https://ignitecorp.atlassian.net/wiki/rest/api/content/${pageId}/child/page`;

    if (!auth.password) {
      return null;
    }

    const response = await axios.get(childPageUrl, { auth });

    if (!response?.data?.results || response.data.results.length === 0) {
      return null;
    }

    const name = response.data.results[0].title || '';
    const webui = response.data.results[0]._links?.webui || '';
    const url = webui ? `https://ignitecorp.atlassian.net/wiki${webui}` : '';

    if (!name || !url) {
      return null;
    }

    return { name, url };
  } catch (e) {
    return null;
  }
};

export const logSimplifiedError = (error: unknown) => {
  // AxiosError가 아닌 경우 빠르게 반환
  if (!(error instanceof AxiosError)) {
    console.log('Non-Axios Error:');
    console.log(error);
    return;
  }

  // 서버 응답이 있을 경우
  if (error.response) {
    console.log('Error Response:', {
      status: error.response.status,
      statusText: error.response.statusText,
      data: error.response.data,
    });
  } else if (error.request) {
    console.log('Error Request:', {
      request: error.request,
    });
  }

  // 설정 중 발생한 오류
  console.log('Error Message:', {
    message: error.message,
  });

  // 요청 설정 정보는 항상 출력
  console.log('Request Config:', {
    method: error.config?.method,
    url: error.config?.url,
    headers: error.config?.headers,
    params: error.config?.params,
    data: error.config?.data,
  });
};

// ===== GW Jira API 함수들 =====

// GW Jira 인증 헤더
const gwJiraHeaders = {
  'Authorization': `Bearer ${GW_JIRA_CONFIG.TOKEN}`,
  'Content-Type': 'application/json; charset=UTF-8',
  'Accept': 'application/json',
};

/**
 * GW Jira에서 티켓 조회
 */
export const getGWJiraIssue = async (issueKey: string): Promise<GWJiraIssue | null> => {
  try {
    const url = `${GW_JIRA_CONFIG.BASE_URL}/rest/api/2/issue/${issueKey}`;
    const response = await axios.get<GWJiraIssue>(url, { headers: gwJiraHeaders });
    return response.data;
  } catch (error) {
    console.error(`GW Jira 티켓 조회 실패 (${issueKey}):`, error);
    logSimplifiedError(error);
    return null;
  }
};

/**
 * GW Jira에 새 티켓 생성
 */
export const createGWJiraIssue = async (payload: GWJiraCreatePayload): Promise<GWJiraIssue | null> => {
  try {
    const url = `${GW_JIRA_CONFIG.BASE_URL}/rest/api/2/issue`;
    const response = await axios.post<GWJiraIssue>(url, payload, { headers: gwJiraHeaders });
    console.log(`✅ GW 티켓 생성 성공: ${response.data.key}`);
    return response.data;
  } catch (error) {
    console.error('GW Jira 티켓 생성 실패:', error);
    logSimplifiedError(error);
    return null;
  }
};

/**
 * GW Jira 티켓 업데이트
 */
export const updateGWJiraIssue = async (issueKey: string, payload: GWJiraUpdatePayload): Promise<boolean> => {
  try {
    const url = `${GW_JIRA_CONFIG.BASE_URL}/rest/api/2/issue/${issueKey}`;
    await axios.put(url, payload, { headers: gwJiraHeaders });
    console.log(`✅ GW 티켓 업데이트 성공: ${issueKey}`);
    return true;
  } catch (error) {
    console.error(`GW Jira 티켓 업데이트 실패 (${issueKey}):`, error);
    logSimplifiedError(error);
    return false;
  }
};

/**
 * FEHG 에픽의 하위 티켓들 조회
 */
export const getFEHGEpicIssues = async (epicId: number): Promise<FEHGEpicIssue[] | null> => {
  try {
    const jql = `parent = FEHG-${epicId} ORDER BY created DESC`;
    const jiraApiUrl = `https://ignitecorp.atlassian.net/rest/api/2/search?jql=${encodeURIComponent(jql)}&expand=parent`;
    
    if (!auth.password) {
      console.error('ATLASSIAN_TOKEN이 설정되지 않았습니다.');
      return null;
    }

    const response = await axios.get<{ issues: FEHGEpicIssue[] }>(jiraApiUrl, { auth });
    
    if (!response?.data?.issues || response.data.issues.length === 0) {
      console.log(`📭 에픽 FEHG-${epicId}에 하위 티켓이 없습니다.`);
      return null;
    }

    console.log(`📋 에픽 FEHG-${epicId}에서 ${response.data.issues.length}개 하위 티켓 조회 완료`);
    return response.data.issues;
  } catch (error) {
    console.error(`FEHG 에픽 ${epicId} 하위 티켓 조회 실패:`, error);
    logSimplifiedError(error);
    return null;
  }
};

/**
 * FEHG 티켓에 AUTOWAY 링크 추가
 */
export const updateFEHGTicketWithGWLink = async (fehgKey: string, gwTicketUrl: string): Promise<boolean> => {
  try {
    const url = `https://ignitecorp.atlassian.net/rest/api/2/issue/${fehgKey}`;
    const payload = {
      fields: {
        [FEHG_LINK_FIELD]: gwTicketUrl // FEHG 티켓의 customfield_10306에 AUTOWAY URL 저장
      }
    };

    console.log(`🔗 FEHG 티켓 ${fehgKey}의 ${FEHG_LINK_FIELD}에 AUTOWAY URL 저장: ${gwTicketUrl}`);
    await axios.put(url, payload, { auth });
    console.log(`✅ FEHG 티켓 ${fehgKey}에 AUTOWAY 링크 추가 완료`);
    return true;
  } catch (error) {
    console.error(`FEHG 티켓 ${fehgKey} 링크 업데이트 실패:`, error);
    logSimplifiedError(error);
    return false;
  }
};

/**
 * FEHG 에픽 정보 조회 (단일 에픽)
 */
export const getFEHGEpicInfo = async (epicId: number): Promise<FEHGEpicIssue | null> => {
  try {
    const jiraApiUrl = `https://ignitecorp.atlassian.net/rest/api/2/issue/FEHG-${epicId}`;
    
    if (!auth.password) {
      console.error('ATLASSIAN_TOKEN이 설정되지 않았습니다.');
      return null;
    }

    const response = await axios.get<FEHGEpicIssue>(jiraApiUrl, { auth });
    
    if (!response?.data) {
      console.log(`📭 에픽 FEHG-${epicId}를 찾을 수 없습니다.`);
      return null;
    }

    console.log(`📋 에픽 FEHG-${epicId} 조회 완료: ${response.data.fields.summary}`);
    return response.data;
  } catch (error) {
    console.error(`FEHG 에픽 ${epicId} 조회 실패:`, error);
    logSimplifiedError(error);
    return null;
  }
};

/**
 * GW Jira에 에픽 생성
 */
export const createGWEpic = async (fehgEpic: FEHGEpicIssue): Promise<GWJiraIssue | null> => {
  try {
    const fehgUrl = `https://ignitecorp.atlassian.net/browse/${fehgEpic.key}`;
    const gwDescription = `
[자동 생성] FEHG 에픽 연동

**원본 FEHG 에픽**: [${fehgEpic.key}](${fehgUrl})

**원본 설명**:
${fehgEpic.fields.description || '설명 없음'}

---
*이 에픽은 FEHG-${fehgEpic.key}와 연동됩니다.*
    `.trim();

    // Epic 필드 매핑 적용 (AUTOWAY 티켓 생성용)
    const createPayload: any = {
      fields: {
        project: { key: GW_JIRA_CONFIG.PROJECT_KEY },
        issuetype: { name: 'Epic' }, // Epic으로 생성
        summary: `[FEHG] ${fehgEpic.fields.summary}`, // FEHG summary → AUTOWAY summary
        description: gwDescription,
        // 주의: AUTOWAY 티켓에는 FEHG 링크를 저장하지 않음 (description에 이미 포함됨)
      }
    };

    // duedate 매핑 (있는 경우에만)
    if (fehgEpic.fields.duedate) {
      createPayload.fields[EPIC_FIELD_MAPPING.duedate] = fehgEpic.fields.duedate;
      console.log(`📅 Due Date 매핑: ${fehgEpic.fields.duedate}`);
    }

    // customfield_10015 → customfield_11209 매핑 (있는 경우에만)
    if (fehgEpic.fields.customfield_10015) {
      createPayload.fields[EPIC_FIELD_MAPPING.customfield_10015] = fehgEpic.fields.customfield_10015;
      console.log(`🔧 Custom Field 매핑: customfield_10015 → customfield_11209`);
    }

    console.log('🚀 GW 에픽 생성 페이로드:', JSON.stringify(createPayload, null, 2));

    const gwEpic = await createGWJiraIssue(createPayload);
    if (gwEpic) {
      console.log(`✅ GW 에픽 생성 성공: ${gwEpic.key} (${fehgEpic.key} 연동)`);
      console.log(`📋 매핑된 필드들:`);
      console.log(`   - summary: ${fehgEpic.fields.summary}`);
      console.log(`   - duedate: ${fehgEpic.fields.duedate || 'N/A'}`);
      console.log(`   - customfield_10015: ${fehgEpic.fields.customfield_10015 || 'N/A'}`);
    }
    
    return gwEpic;
  } catch (error) {
    console.error(`FEHG → GW 에픽 생성 실패 (${fehgEpic.key}):`, error);
    logSimplifiedError(error);
    return null;
  }
};

/**
 * FEHG → GW 티켓 생성 및 연결
 */
export const createLinkedGWTicket = async (fehgIssue: FEHGEpicIssue): Promise<{ gwIssue: GWJiraIssue; success: boolean } | null> => {
  try {
    // FEHG 티켓 정보를 GW 형식으로 변환
    const fehgUrl = `https://ignitecorp.atlassian.net/browse/${fehgIssue.key}`;
    const gwDescription = `
[자동 생성] FEHG 연동 티켓

**원본 FEHG 티켓**: [${fehgIssue.key}](${fehgUrl})
**에픽**: ${fehgIssue.fields.parent?.fields?.summary || 'N/A'}

**원본 설명**:
${fehgIssue.fields.description || '설명 없음'}

---
*이 티켓은 FEHG-${fehgIssue.fields.parent?.key || 'Unknown'} 에픽과 연동됩니다.*
    `.trim();

    // GW 티켓 생성 페이로드
    const createPayload: GWJiraCreatePayload = {
      fields: {
        project: { key: GW_JIRA_CONFIG.PROJECT_KEY },
        issuetype: { name: 'Task' },
        summary: `[FEHG] ${fehgIssue.fields.summary}`,
        description: gwDescription,
        customfield_10306: fehgUrl, // HMG Jira 링크 필드에 FEHG URL 저장
      }
    };

    // 1. GW 티켓 생성
    const gwIssue = await createGWJiraIssue(createPayload);
    if (!gwIssue) {
      return null;
    }

    // 2. FEHG 티켓에 GW 링크 추가
    const gwUrl = `${GW_JIRA_CONFIG.BASE_URL}/browse/${gwIssue.key}`;
    const linkSuccess = await updateFEHGTicketWithGWLink(fehgIssue.key, gwUrl);

    return {
      gwIssue,
      success: linkSuccess
    };
  } catch (error) {
    console.error(`FEHG → GW 티켓 생성 실패 (${fehgIssue.key}):`, error);
    logSimplifiedError(error);
    return null;
  }
};
