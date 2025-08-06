import { App, Block, ExpressReceiver, KnownBlock } from '@slack/bolt';
import dotenv from 'dotenv';
import {
  handleCreateDailyPage,
  handleCreateNextDailyPage,
  handleGetDailyPage,
  handleGetWeeklyPage,
  handleMyJiraIssues,
} from './handler/dailyPage';
import {
  handleGetSlackTemplate,
  handleSelectSlackTemplate,
} from './handler/slackTemplate';
import { handleGetSsmCommand } from './handler/ssmCommand';
import { handleSyncIssues } from './handler/syncIssues';

dotenv.config();

// Express receiver for local development
const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET || '',
  endpoints: {
    events: '/slack/events',
  },
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

app.command('/bot-fe1-demo', async ({ command, ack, respond }) => {
  commandUserId = command.user_id;
  await ack();

  try {
    const blocks: (Block | KnownBlock)[] = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `👋 *${command.user_name}님 반갑습니다!*\n어떤 작업을 도와드릴까요? 🤖`,
        },
      },
      { type: 'divider' },

      // 슬랙 템플릿 관련
      {
        type: 'section',
        text: { type: 'mrkdwn', text: '*🚀 업무 자동화*' },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: '📄 슬랙 템플릿' },
            value: 'slack_template',
            action_id: 'slack_template',
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: '📌 내 지라 이슈 확인' },
            value: 'my_jira_issues',
            action_id: 'my_jira_issues',
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: '🔄 싱크 맞추기' },
            value: 'sync_issues',
            action_id: 'sync_issues',
          },
        ],
      },

      { type: 'divider' },
      // 데일리/위클리
      {
        type: 'section',
        text: { type: 'mrkdwn', text: '*📌 데일리/위클리*' },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: '📅 데일리' },
            value: 'daily_page',
            action_id: 'daily_page',
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: '📆 위클리' },
            value: 'weekly_page',
            action_id: 'weekly_page',
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: '📝 데일리 페이지 만들기' },
            value: 'create_daily_page',
            action_id: 'create_daily_page',
          },
        ],
      },
      { type: 'divider' },

      // 세 번째 버튼 그룹 (서버 관련)
      {
        type: 'section',
        text: { type: 'mrkdwn', text: '*🖥️ 기타*' },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: '🛠️ EC2 SSM 명령어' },
            value: 'ssm_command',
            action_id: 'ssm_command',
          },
        ],
      },
    ];
    await respond({ blocks });
  } catch (error) {
    console.error(error);
    await respond({
      text: '오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
    });
  }
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

// 오늘 내 할일 액션
app.action('my_jira_issues', handleMyJiraIssues);

// 싱크 맞추기 액션
app.action('sync_issues', handleSyncIssues);

// Session Manager Command 액션
app.action('ssm_command', handleGetSsmCommand);

// Start local development server
(async () => {
  await app.start(3086);
  console.log('⚡️ Bolt app is running on port 3086');
  console.log('🌐 Ngrok URL: https://7003d0f1a40e.ngrok-free.app');
  console.log('📡 Events endpoint: /slack/events');
})();
