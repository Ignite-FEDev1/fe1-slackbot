import { getActiveEpics } from '../jira/epics';
import { summarizeTextToTicket, TextSummarizeContext } from '../llm/summarize';
import { invokeWorker } from '../invokeWorker';
import { SLACK_JIRA_USER_MAP, SLACK_USER_NAMES } from '../constant';

interface ApiRequest {
  path: string;
  method: string;
  headers: Record<string, string>;
  body: any;
}

interface ApiResponse {
  statusCode: number;
  body: string;
  headers?: Record<string, string>;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, x-api-key',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const json = (statusCode: number, data: any): ApiResponse => ({
  statusCode,
  body: JSON.stringify(data),
  headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
});

/**
 * API key 검증. 환경변수 EXTENSION_API_KEY 와 비교한다.
 */
const authenticate = (headers: Record<string, string>): boolean => {
  const key = process.env.EXTENSION_API_KEY;
  if (!key) {
    console.error('[api] EXTENSION_API_KEY 가 설정되지 않았습니다.');
    return false;
  }
  const provided = headers['x-api-key'] || headers['X-Api-Key'] || '';
  return provided === key;
};

/**
 * Chrome Extension 등 외부 클라이언트를 위한 REST API 라우터.
 */
export const handleApiRequest = async (req: ApiRequest): Promise<ApiResponse> => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return { statusCode: 204, body: '', headers: CORS_HEADERS };
  }

  if (!authenticate(req.headers)) {
    return json(401, { error: '인증 실패. x-api-key 를 확인해주세요.' });
  }

  // GET /api/epics — 에픽 목록 조회
  if (req.path === '/api/epics' && req.method === 'GET') {
    const epics = await getActiveEpics();
    return json(200, { epics });
  }

  // GET /api/members — 팀원 목록 조회
  if (req.path === '/api/members' && req.method === 'GET') {
    const members = Object.entries(SLACK_JIRA_USER_MAP).map(([slackId, jiraAccountId]) => ({
      slackId,
      jiraAccountId,
      name: SLACK_USER_NAMES[slackId] || slackId,
    }));
    return json(200, { members });
  }

  // POST /api/summarize — 텍스트 기반 LLM 요약
  if (req.path === '/api/summarize' && req.method === 'POST') {
    const { text, assigneeName, instructions, sourceUrl } = req.body || {};
    if (!text || typeof text !== 'string') {
      return json(400, { error: 'text 필드가 필요합니다.' });
    }
    const ctx: TextSummarizeContext = { assigneeName, instructions, sourceUrl };
    const draft = await summarizeTextToTicket(text, ctx);
    return json(200, { draft });
  }

  // POST /api/ticket — 티켓 생성 (worker 위임)
  if (req.path === '/api/ticket' && req.method === 'POST') {
    const {
      title, description, assigneeSlackId, epicKey,
      startDate, endDate, estimate, sourceUrl, slackChannel,
    } = req.body || {};

    if (!title || !epicKey) {
      return json(400, { error: 'title, epicKey 는 필수입니다.' });
    }

    await invokeWorker({
      type: 'ext_create_ticket_work',
      title,
      description: description || '',
      assigneeSlackId: assigneeSlackId || '',
      epicKey,
      startDate,
      endDate,
      estimate,
      sourceUrl,
      slackChannel,
    });

    return json(202, { message: '티켓 생성이 요청되었습니다.' });
  }

  // POST /api/batch-ticket — 일괄 티켓 생성 (worker 위임)
  if (req.path === '/api/batch-ticket' && req.method === 'POST') {
    const {
      title, description, selectedUsers, epicKey,
      startDate, endDate, estimate, sourceUrl,
    } = req.body || {};

    if (!title || !epicKey) {
      return json(400, { error: 'title, epicKey 는 필수입니다.' });
    }
    if (!selectedUsers || !Array.isArray(selectedUsers) || selectedUsers.length === 0) {
      return json(400, { error: 'selectedUsers 가 필요합니다. (1명 이상)' });
    }

    await invokeWorker({
      type: 'ext_batch_ticket_work',
      title,
      description: description || '',
      selectedUsers,
      epicKey,
      startDate,
      endDate,
      estimate,
      sourceUrl,
    });

    return json(202, { message: '일괄 티켓 생성이 요청되었습니다.' });
  }

  return json(404, { error: '지원하지 않는 경로입니다.' });
};
