import { App, AwsLambdaReceiver, Block, KnownBlock } from '@slack/bolt';

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
import {
  handleSyncIssues,
  handleSyncIssuesFehgToHb,
  handleSyncIssuesFehgToKq,
} from './handler/syncIssues';
import {
  handleFEHGToGWSync,
  handleShowEpicList,
  handleCreateAllTickets,
  handleShowMappingStatus,
  handleSyncTicketStatus,
  handleTestEpicCreation,
} from './handler/fehgToGwSync';

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
          // {
          //   type: 'button',
          //   text: { type: 'plain_text', text: '📌 내 지라 이슈 확인' },
          //   value: 'my_jira_issues',
          //   action_id: 'my_jira_issues',
          // },
          {
            type: 'button',
            text: { type: 'plain_text', text: '🔄 FEHG→HB 싱크' },
            value: 'sync_fehg_to_hb',
            action_id: 'sync_fehg_to_hb',
            style: 'primary',
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: '🔄 FEHG→KQ 싱크' },
            value: 'sync_fehg_to_kq',
            action_id: 'sync_fehg_to_kq',
            style: 'primary',
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: '🌉 FEHG→GW 연동' },
            value: 'fehg_gw_sync_main',
            action_id: 'fehg_gw_sync_main',
            style: 'primary',
          },
        ],
      },

      { type: 'divider' },
      // 데일리/위클리
      // {
      //   type: 'section',
      //   text: { type: 'mrkdwn', text: '*📌 데일리/위클리*' },
      // },
      // {
      //   type: 'actions',
      //   elements: [
      //     {
      //       type: 'button',
      //       text: { type: 'plain_text', text: '📅 데일리' },
      //       value: 'daily_page',
      //       action_id: 'daily_page',
      //     },
      //     {
      //       type: 'button',
      //       text: { type: 'plain_text', text: '📆 위클리' },
      //       value: 'weekly_page',
      //       action_id: 'weekly_page',
      //     },
      //     {
      //       type: 'button',
      //       text: { type: 'plain_text', text: '📝 데일리 페이지 만들기' },
      //       value: 'create_daily_page',
      //       action_id: 'create_daily_page',
      //     },
      //   ],
      // },
      // { type: 'divider' },

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

// 싱크 맞추기 액션들
app.action('sync_issues', handleSyncIssues); // 기존 호환성 유지
app.action('sync_fehg_to_hb', handleSyncIssuesFehgToHb);
app.action('sync_fehg_to_kq', handleSyncIssuesFehgToKq);

// Session Manager Command 액션
app.action('ssm_command', handleGetSsmCommand);

// FEHG → GW 연동 액션들
app.action('fehg_gw_sync_main', handleFEHGToGWSync);
app.action('show_epic_list', handleShowEpicList);
app.action('create_all_tickets', handleCreateAllTickets);
app.action('show_mapping_status', handleShowMappingStatus);
app.action('sync_ticket_status', handleSyncTicketStatus);
app.action('test_epic_creation', handleTestEpicCreation);

// Handle the Lambda function event
export const handler = async (event: any, context: any, callback: any) => {
  const handler = await receiver.start();
  return handler(event, context, callback);
};
