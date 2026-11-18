import 'dotenv/config';
import { WebClient } from '@slack/web-api';
import { sendDelayReminder } from '../jira/delayReminder';
import { nowKst } from '../util/kst';

const main = async () => {
  if (!process.env.ATLASSIAN_TOKEN) {
    throw new Error('ATLASSIAN_TOKEN is required');
  }
  const dryRun = process.env.DRY_RUN === 'true';
  const channel = process.env.JIRA_DELAY_SLACK_CHANNEL;
  if (!dryRun && (!process.env.SLACK_BOT_TOKEN || !channel)) {
    throw new Error('SLACK_BOT_TOKEN and JIRA_DELAY_SLACK_CHANNEL are required');
  }

  // Do not retry an ambiguous Slack timeout: the first request may have posted.
  const slack = new WebClient(process.env.SLACK_BOT_TOKEN, {
    retryConfig: { retries: 0 },
  });
  const today = nowKst().toISOString().slice(0, 10);
  const count = await sendDelayReminder(today, async (text) => {
    if (dryRun) {
      console.log(text);
      return;
    }
    await slack.chat.postMessage({
      channel: channel!,
      text,
      unfurl_links: false,
      unfurl_media: false,
    });
  });
  console.log(
    `[jira-delay-reminder] ${today}: ${count} message(s) ${dryRun ? 'previewed' : 'sent'}`
  );
};

main().catch((error: unknown) => {
  // Axios errors contain request credentials; never log the entire error.
  console.error(error instanceof Error ? error.message : 'Jira delay reminder failed');
  process.exitCode = 1;
});
