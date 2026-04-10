import { App, AwsLambdaReceiver } from '@slack/bolt';
import dotenv from 'dotenv';
import { registerApp } from './register';

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
  const lambdaHandler = await receiver.start();
  return lambdaHandler(event, context, callback);
};
