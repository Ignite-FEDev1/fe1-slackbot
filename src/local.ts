// dotenv 를 다른 import 보다 먼저 실행해야 함 —
// register.ts 체인의 db.ts 가 모듈 로드 시점에 process.env 를 읽는다
import 'dotenv/config';
import { App, ExpressReceiver } from '@slack/bolt';
import { registerApp } from './register';

const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET || '',
  endpoints: { events: '/slack/events' },
});

const app = new App({
  token: process.env.SLACK_BOT_TOKEN || '',
  receiver,
});

registerApp(app);

(async () => {
  await app.start(3086);
  console.log('⚡️ FE1 Bot (local) running on http://localhost:3086');
  console.log('📡 Slack events endpoint: /slack/events');
})();
