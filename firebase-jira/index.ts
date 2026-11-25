import { WebClient } from '@slack/web-api';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { defineBoolean, defineSecret } from 'firebase-functions/params';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { buildDelayMessages, fetchDelayedIssues } from '../src/jira/delayReminder';
import { runScheduledReminder, SLACK_TIMEOUT_MS } from '../src/jira/scheduledReminder';

const sendEnabled = defineBoolean('JIRA_DELAY_SEND_ENABLED', { default: false });
const atlassianToken = defineSecret('ATLASSIAN_TOKEN');
const slackToken = defineSecret('SLACK_BOT_TOKEN');

initializeApp();

export const jiraDelayReminder = onSchedule({
  schedule: '0 17 * * 1-5',
  timeZone: 'Asia/Seoul',
  region: 'us-central1',
  memory: '256MiB',
  minInstances: 0,
  maxInstances: 1,
  concurrency: 1,
  timeoutSeconds: 120,
  retryCount: 0,
  secrets: [atlassianToken, slackToken],
}, async (event) => {
  let stage = 'schedule';
  let slack: WebClient;
  try {
    const result = await runScheduledReminder(event.scheduleTime, sendEnabled.value(), {
      now: Date.now,
      async loadMessages(date) {
        stage = 'jira';
        if (!atlassianToken.value()) throw new Error('Missing Jira token');
        return buildDelayMessages(await fetchDelayedIssues(date, undefined, 10), date);
      },
      async claimDelivery(date) {
        stage = 'slack-config';
        const token = slackToken.value();
        if (!token) throw new Error('Missing Slack token');
        slack = new WebClient(token, {
          retryConfig: { retries: 0 },
          rejectRateLimitedCalls: true,
          timeout: SLACK_TIMEOUT_MS,
        });
        stage = 'firestore';
        try {
          await getFirestore().collection('slackbot_jira_deliveries').doc(date).create({
            claimedAt: new Date(),
          });
          return true;
        } catch (error) {
          if ((error as { code?: unknown })?.code === 6) return false; // gRPC ALREADY_EXISTS
          throw error;
        }
      },
      async postMessage(text) {
        stage = 'slack';
        await slack.chat.postMessage({
          channel: 'C04HYKFMXT2',
          text,
          unfurl_links: false,
          unfurl_media: false,
        });
      },
    });
    const details = { ...result, scheduleTime: event.scheduleTime };
    if (result.status === 'outside-window' || result.status === 'outside-schedule') {
      logger.warn('Jira reminder skipped', details);
    } else {
      logger.info('Jira reminder processed', details);
    }
  } catch {
    logger.error('Jira reminder failed', { stage, scheduleTime: event.scheduleTime });
    throw new Error(`Jira reminder failed at ${stage}`);
  }
});
