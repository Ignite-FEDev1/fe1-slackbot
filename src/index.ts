import { App, AwsLambdaReceiver } from '@slack/bolt';

import dotenv from 'dotenv';
import {
  handleGetSlackTemplate,
  handleSelectSlackTemplate,
} from './handler/slackTemplate';
import { handleGetSsmCommand } from './handler/ssmCommand';
import {
  handleCreateDailyPage,
  handleCreateNextDailyPage,
  handleGetDailyPage,
  handleGetWeeklyPage,
} from './handler/dailyPage';

dotenv.config();

const receiver = new AwsLambdaReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET || '',
});

export const app = new App({
  token: process.env.SLACK_BOT_TOKEN || '',
  signingSecret: process.env.SLACK_SIGNING_SECRET || '',
  receiver,
});

let commandUserId = '';

export const getUserId = () => {
  return commandUserId;
};

app.command('/bot-fe1-demo', async ({ command, ack, respond, say, client }) => {
  commandUserId = command.user_id;
  await ack();
  await respond({
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${command.user_name}님 반갑습니다!\n어떤 작업을 도와드릴까요? 🤖`,
        },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: '슬랙 템플릿',
              emoji: true,
            },
            value: 'slack_template',
            action_id: 'slack_template',
          },
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: '데일리',
              emoji: true,
            },
            value: 'daily_page',
            action_id: 'daily_page',
          },
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: '위클리',
              emoji: true,
            },
            value: 'weekly_page',
            action_id: 'weekly_page',
          },
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: '데일리 페이지 만들기',
              emoji: true,
            },
            value: 'create_daily_page',
            action_id: 'create_daily_page',
          },
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: 'EC2 SSM 명령어',
              emoji: true,
            },
            value: 'ssm_command',
            action_id: 'ssm_command',
          },
        ],
      },
    ],
  });
});

// 슬랙 템플릿 액션
app.action('slack_template', handleSelectSlackTemplate);
app.action(/^.*_slack_template$/, handleGetSlackTemplate);

// 데일리 페이지 액션
app.action('daily_page', handleGetDailyPage);

// 데일리 페이지 생성
app.action('create_daily_page', handleCreateDailyPage);
app.action('create_next_daily_page', handleCreateNextDailyPage);

// 위클리 페이지 액션
app.action('weekly_page', handleGetWeeklyPage);

// Session Manager Command 액션
app.action('ssm_command', handleGetSsmCommand);

// Handle the Lambda function event
export const handler = async (event: any, context: any, callback: any) => {
  const handler = await receiver.start();
  return handler(event, context, callback);
};
