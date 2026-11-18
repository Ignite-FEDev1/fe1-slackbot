import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import axios from 'axios';
import { SLACK_JIRA_USER_MAP } from '../constant';
import {
  buildDelayMessages,
  DelayIssue,
  fetchDelayedIssues,
  sendDelayReminder,
} from './delayReminder';

const today = '2026-11-18';
const [slackId, accountId] = Object.entries(SLACK_JIRA_USER_MAP)[0];
const issue = (
  key: string,
  fields: Partial<DelayIssue['fields']> = {}
): DelayIssue => ({
  key,
  fields: {
    summary: `Summary ${key}`,
    status: { statusCategory: { key: 'new' } },
    assignee: { accountId, displayName: 'Mapped user' },
    ...fields,
  },
});

test('uses strict start and inclusive due boundaries, excluding done issues', () => {
  const messages = buildDelayMessages([
    issue('FEHG-1', { customfield_10015: '2026-11-17' }),
    issue('FEHG-2', { customfield_10015: today }),
    issue('FEHG-3', { customfield_10015: '2026-11-19' }),
    issue('FEHG-4', {
      customfield_10015: '2026-11-17',
      status: { statusCategory: { key: 'indeterminate' } },
    }),
    issue('FEHG-5', {
      customfield_10015: '2026-11-17',
      duedate: '2026-11-17',
      status: { statusCategory: { key: 'done' } },
    }),
    issue('FEHG-6', { duedate: today }),
    issue('FEHG-7', {
      duedate: '2026-11-17',
      status: { statusCategory: { key: 'indeterminate' } },
    }),
    issue('FEHG-8', { duedate: '2026-11-19' }),
    issue('FEHG-9'),
  ], today);
  assert.equal(messages.length, 1);
  const [start, end] = messages[0].split('[ 종료 현황을 확인해주세요 ]');
  assert.match(start, /FEHG-1>/);
  assert.doesNotMatch(start, /FEHG-[2-9]>/);
  assert.match(end, /FEHG-6>/);
  assert.match(end, /FEHG-7>/);
  assert.doesNotMatch(end, /FEHG-[1-589]>/);
});

test('groups by assignee, mentions mapped users, escapes text and retains both delays', () => {
  const [message] = buildDelayMessages([
    issue('FEHG-1', { customfield_10015: '2026-11-17', duedate: today }),
    issue('FEHG-2', {
      customfield_10015: '2026-11-17',
      summary: 'A & B <@UINJECTED>\nnext line',
    }),
    issue('FEHG-3', {
      duedate: today,
      assignee: { accountId: 'unmapped', displayName: 'Unknown <user>' },
    }),
    issue('FEHG-4', { duedate: today, assignee: null }),
  ], today);
  assert.equal(message.split(`<@${slackId}>`).length - 1, 2);
  assert.equal(message.split('|FEHG-1>').length - 1, 2);
  assert.ok(message.startsWith(
    `*[ 시작일이 지체되었어요 ]*\n\n*<@${slackId}>*\n` +
    '  • <https://ignitecorp.atlassian.net/browse/FEHG-1|FEHG-1> Summary FEHG-1\n' +
    '  • <https://ignitecorp.atlassian.net/browse/FEHG-2|FEHG-2> '
  ));
  assert.match(message, /A &amp; B &lt;@UINJECTED&gt; next line/);
  assert.match(message, /\n\n\*Unknown &lt;user&gt;\*\n  • /);
  assert.match(message, /\n\n\*담당자 없음\*\n  • /);
  assert.doesNotMatch(message, /^\s*-/m);
  assert.match(message, /<https:\/\/ignitecorp\.atlassian\.net\/browse\/FEHG-2\|FEHG-2>/);
});

test('splits large reports without dropping issues or assignee context', () => {
  const issues = Array.from({ length: 300 }, (_, i) =>
    issue(`FEHG-${i + 1}`, {
      duedate: today,
      summary: 'x'.repeat(255),
    })
  );
  const messages = buildDelayMessages(issues, today);
  assert.ok(messages.length > 1);
  for (const message of messages) {
    assert.ok(message.length <= 35000);
    assert.ok(message.startsWith(
      `*[ 종료 현황을 확인해주세요 ]*\n\n*<@${slackId}>*\n  • `
    ));
  }
  assert.equal(messages.join('\n').match(/\|FEHG-\d+>/g)?.length, 300);
});

test('fetches all Jira pages with explicit date filters and required fields', async () => {
  const client = axios.create({
    adapter: async (config) => {
      assert.equal(config.url, '/search/jql');
      assert.match(config.params.jql, /project = FEHG AND statusCategory != Done/);
      assert.ok(config.params.jql.includes(`cf[10015] < "${today}"`));
      assert.ok(config.params.jql.includes(`duedate <= "${today}"`));
      assert.match(config.params.jql, /statusCategory = "To Do"/);
      assert.equal(config.params.fields, 'summary,status,assignee,customfield_10015,duedate');
      const secondPage = config.params.nextPageToken === 'page-2';
      return {
        config, status: 200, statusText: 'OK', headers: {},
        data: {
          issues: [issue(secondPage ? 'FEHG-2' : 'FEHG-1')],
          isLast: secondPage,
          nextPageToken: secondPage ? undefined : 'page-2',
        },
      };
    },
  });
  assert.deepEqual((await fetchDelayedIssues(today, client)).map(({ key }) => key),
    ['FEHG-1', 'FEHG-2']);
});

test('does not send when empty or when a later Jira page fails', async () => {
  let sent = 0;
  const postMessage = async () => { sent++; };
  const empty = axios.create({
    adapter: async (config) => ({
      config, status: 200, statusText: 'OK', headers: {},
      data: { issues: [], isLast: true },
    }),
  });
  assert.equal(await sendDelayReminder(today, postMessage, empty), 0);
  assert.equal(sent, 0);

  const failing = axios.create({
    adapter: async (config) => {
      if (config.params.nextPageToken) throw new Error('Jira unavailable');
      return {
        config, status: 200, statusText: 'OK', headers: {},
        data: {
          issues: [issue('FEHG-1', { duedate: today })],
          nextPageToken: 'page-2',
        },
      };
    },
  });
  await assert.rejects(sendDelayReminder(today, postMessage, failing), /Jira unavailable/);
  assert.equal(sent, 0);
});

test('sends generated messages and propagates Slack failures', async () => {
  const client = axios.create({
    adapter: async (config) => ({
      config, status: 200, statusText: 'OK', headers: {},
      data: { issues: [issue('FEHG-1', { duedate: today })], isLast: true },
    }),
  });
  const sent: string[] = [];
  assert.equal(await sendDelayReminder(today, async (text) => { sent.push(text); }, client), 1);
  assert.match(sent[0], /FEHG-1>/);
  await assert.rejects(sendDelayReminder(today, async () => {
    throw new Error('Slack unavailable');
  }, client), /Slack unavailable/);
});

test('rejects repeated pagination tokens instead of sending a partial report', async () => {
  const client = axios.create({
    adapter: async (config) => ({
      config, status: 200, statusText: 'OK', headers: {},
      data: { issues: [], nextPageToken: 'same-token' },
    }),
  });
  await assert.rejects(fetchDelayedIssues(today, client), /repeated pagination token/);
});

