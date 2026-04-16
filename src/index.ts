import { App, AwsLambdaReceiver } from '@slack/bolt';
import dotenv from 'dotenv';
import { handleApiRequest } from './api/router';
import { registerApp } from './register';
import { handleWorker, WorkerPayload } from './worker';

dotenv.config();

const receiver = new AwsLambdaReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET || '',
});

export const app = new App({
  token: process.env.SLACK_BOT_TOKEN || '',
  receiver,
});

registerApp(app);

/** worker payload type 목록 */
const WORKER_TYPES = new Set([
  'create_ticket_work',
  'batch_ticket_work',
  'regenerate_summary_work',
  'batch_ticket_bulk_update_work',
  'create_deploy_room_work',
  'ext_create_ticket_work',
  'ext_batch_ticket_work',
]);

export const handler = async (event: any, context: any, callback: any) => {
  // 비동기 worker 호출 (InvocationType: 'Event') 처리
  if (event?.type && WORKER_TYPES.has(event.type)) {
    await handleWorker(event as WorkerPayload);
    return { statusCode: 200 };
  }

  // REST API 요청 (/api/*) 처리
  if (event?.path?.startsWith('/api/')) {
    return handleApiRequest({
      path: event.path,
      method: event.httpMethod,
      headers: event.headers || {},
      body: event.body ? JSON.parse(event.body) : {},
    });
  }

  // 일반 Slack 이벤트
  const lambdaHandler = await receiver.start();
  return lambdaHandler(event, context, callback);
};
