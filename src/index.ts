import { App, AwsLambdaReceiver } from '@slack/bolt';
import dotenv from 'dotenv';
import { handleApiRequest } from './api/router';
import { registerApp } from './register';
import { handleWorker, WORKER_TYPES, WorkerPayload } from './worker';

dotenv.config();

const receiver = new AwsLambdaReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET || '',
});

export const app = new App({
  token: process.env.SLACK_BOT_TOKEN || '',
  receiver,
});

registerApp(app);

export const handler = async (event: any, context: any, callback: any) => {
  // 비동기 worker 호출 (InvocationType: 'Event') 처리
  if (event?.type && WORKER_TYPES.has(event.type)) {
    await handleWorker(event as WorkerPayload);
    return { statusCode: 200 };
  }

  // REST API 요청 (/api/*) 처리
  // API Gateway REST(v1: path/httpMethod)와 Lambda Function URL(v2: rawPath/requestContext) 겸용
  const apiPath = event?.path ?? event?.rawPath;
  const apiMethod = event?.httpMethod ?? event?.requestContext?.http?.method;
  if (apiPath?.startsWith('/api/')) {
    const rawBody =
      event.body && event.isBase64Encoded
        ? Buffer.from(event.body, 'base64').toString()
        : event.body;
    return handleApiRequest({
      path: apiPath,
      method: apiMethod,
      headers: event.headers || {},
      body: rawBody ? JSON.parse(rawBody) : {},
    });
  }

  // 일반 Slack 이벤트
  const lambdaHandler = await receiver.start();
  return lambdaHandler(event, context, callback);
};
