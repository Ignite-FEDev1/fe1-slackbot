/**
 * Chrome Extension 설정.
 * 배포 후 실제 값으로 업데이트할 것.
 *
 * API_URL: Lambda Function URL (마지막 슬래시 없이).
 *   API Gateway 비용 제거를 위해 execute-api 엔드포인트에서 전환함 (2026-07).
 * API_KEY: .env 의 EXTENSION_API_KEY 와 동일한 값
 *
 * H_CHAT_BASE_URL / H_CHAT_MODEL: 사내망(10.146.x.x) 에서 직접 호출하는 Claude Messages 호환 API.
 *   외부망에서는 fetch 가 실패하므로 popup.js 의 summarizeWithFallback 이 API_URL(Anthropic) 로 폴백한다.
 *   API Key 는 git 에 두지 않고 GET /api/hchat-credentials 를 통해 Lambda+Supabase 에서 받아온다 (llm.js).
 */
const CONFIG = {
  API_URL: 'https://253cy5dc3eamu6vjxc7lmr43pu0izhps.lambda-url.ap-northeast-2.on.aws',
  API_KEY: '6d0cf022dcaae41c444722cfd6aa51ec388d7252b792d7c4',
  H_CHAT_BASE_URL: 'https://internal-apigw-kr.hmg-corp.io/hchat-in/api',
  H_CHAT_MODEL: 'claude-haiku-4-5',
};
