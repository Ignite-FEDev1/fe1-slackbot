import { App, ExpressReceiver } from '@slack/bolt';
import dotenv from 'dotenv';
import { registerApp } from './register';

dotenv.config();

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
