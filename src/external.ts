import axios, { AxiosError } from 'axios';
import { getUserId as getSlackUserId, getUserId } from '.';
import { SLACK_GITHUB_USER_MAP, SLACK_JIRA_USER_MAP } from './constant';
import {
  JiraIssue,
  JiraIssueResponse,
  JiraPage,
  JiraPageResponse,
  ParsedJiraPage,
  ParsedJiraTask,
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
