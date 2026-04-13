import { App, AwsLambdaReceiver } from '@slack/bolt';
import dotenv from 'dotenv';
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

export const handler = async (event: any, context: any, callback: any) => {
  // 비동기 worker 호출 (InvocationType: 'Event') 처리
  if (event?.type && (event.type === 'create_ticket_work' || event.type === 'batch_ticket_work' || event.type === 'regenerate_summary_work')) {
    await handleWorker(event as WorkerPayload);
    return { statusCode: 200 };
  }

  // 일반 Slack 이벤트
  const lambdaHandler = await receiver.start();
  return lambdaHandler(event, context, callback);
};
