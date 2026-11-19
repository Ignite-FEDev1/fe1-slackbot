import 'dotenv/config';
import axios from 'axios';
import { WebClient } from '@slack/web-api';
import { collectNews, formatNewsError, NewsState, sendNews } from '../security/news';
import { GitHubNewsState } from '../security/state';
import { nowKst } from '../util/kst';

const main = async () => {
  const dryRun = process.env.DRY_RUN === 'true';
  const channel = process.env.SECURITY_NEWS_SLACK_CHANNEL ?? 'C0ALN3RU92R';
  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  const baseSha = process.env.GITHUB_SHA;
  if (!dryRun && (!token || !repository || !baseSha || !process.env.SLACK_BOT_TOKEN)) {
    throw new Error('GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_SHA and SLACK_BOT_TOKEN are required');
  }
  if (repository && !/^[\w.-]+\/[\w.-]+$/.test(repository)) {
    throw new Error('Invalid GITHUB_REPOSITORY');
  }
  const github = axios.create({
    timeout: 30000,
    headers: {
      Accept: 'application/vnd.github+json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  const store = token && repository && baseSha
    ? new GitHubNewsState(axios.create({
      baseURL: `https://api.github.com/repos/${repository}`,
      timeout: 30000,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
    }), channel, baseSha)
    : undefined;
  const state: NewsState = store ? await store.load() : { version: 1, sent: {} };
  const checkedAt = new Date();
  const items = await collectNews(state, checkedAt, github);
  const date = nowKst().toISOString().slice(0, 10);
  if (dryRun) {
    // Work on a copy: previews must not change the stored delivery checkpoint.
    const preview = JSON.parse(JSON.stringify(state)) as NewsState;
    let counter = 0;
    await sendNews(items, date, preview, async ({ text, thread_ts }) => {
      console.log(`[${thread_ts ? 'thread' : 'channel'} ${channel}]\n${text}`);
      return { ts: `preview-${++counter}` };
    }, async () => {});
    console.log(`[security-news] ${items.length} item(s) previewed; no state saved`);
    return;
  }
  // Ambiguous Slack timeouts are not retried automatically.
  const slack = new WebClient(process.env.SLACK_BOT_TOKEN, { retryConfig: { retries: 0 } });
  const save = (next: NewsState) => store!.save(next);
  // Verify checkpoint write access before posting anything to Slack.
  await save(state);
  const count = await sendNews(items, date, state, (message) =>
    slack.chat.postMessage({
      ...message, channel, unfurl_links: false, unfurl_media: false,
    }), save);
  state.lastCheckedAt = checkedAt.toISOString();
  await save(state);
  console.log(`[security-news] ${date}: ${count} item(s) sent to ${channel}`);
};

main().catch((error: unknown) => {
  // Never log HTTP configuration, headers, or the full error object.
  console.error(formatNewsError(error));
  process.exitCode = 1;
});
