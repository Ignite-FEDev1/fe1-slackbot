import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { runScheduledReminder } from './scheduledReminder';

const slot = '2026-11-25T08:00:00Z'; // Wed 17:00 KST
const start = Date.parse(slot);

function setup() {
  let time = start;
  const reads: string[] = [];
  const claims = new Set<string>();
  const posts: string[] = [];
  return {
    setTime: (value: number) => { time = value; },
    reads, claims, posts,
    deps: {
      now: () => time,
      loadMessages: async (date: string) => {
        reads.push(date);
        return ['first', 'second'];
      },
      claimDelivery: async (date: string) => {
        if (claims.has(date)) return false;
        claims.add(date);
        return true;
      },
      postMessage: async (text: string) => { posts.push(text); },
    },
  };
}

test('previews on demand using the KST date without claiming or posting', async () => {
  const { deps, reads, claims, posts } = setup();
  const result = await runScheduledReminder('2026-11-24T16:00:00Z', false, deps);
  assert.deepEqual(result, { date: '2026-11-25', status: 'preview', count: 2 });
  assert.deepEqual(reads, ['2026-11-25']);
  assert.equal(claims.size, 0);
  assert.deepEqual(posts, []);
});

test('rejects off-schedule or late live events before contacting Jira', async () => {
  const { deps, reads, setTime } = setup();
  assert.equal((await runScheduledReminder('2026-11-28T08:00:00Z', true, deps)).status,
    'outside-schedule');
  assert.equal((await runScheduledReminder('2026-11-25T07:59:00Z', true, deps)).status,
    'outside-schedule');
  setTime(start + 30 * 60_000);
  assert.equal((await runScheduledReminder(slot, true, deps)).status, 'outside-window');
  assert.deepEqual(reads, []);
});

test('accepts Scheduler timestamps with seconds without moving the 17:30 deadline', async () => {
  const observed = '2026-11-25T00:00:01.291545-08:00';
  const { deps, posts, setTime } = setup();
  setTime(start + 28_699);
  assert.equal((await runScheduledReminder(observed, true, deps)).status, 'sent');
  setTime(start + 30 * 60_000 - 9_999);
  assert.equal((await runScheduledReminder(observed, true, deps)).status, 'outside-window');
  assert.deepEqual(posts, ['first', 'second']);
});

test('does not send if the window closes during the read or between Slack posts', async () => {
  const { deps, claims, posts, setTime } = setup();
  const afterDeadline = start + 30 * 60_000;
  const lateRead = await runScheduledReminder(slot, true, {
    ...deps,
    loadMessages: async () => {
      setTime(afterDeadline);
      return ['first'];
    },
  });
  assert.equal(lateRead.status, 'outside-window');
  assert.equal(claims.size, 0);

  setTime(start);
  const partial = await runScheduledReminder(slot, true, {
    ...deps,
    postMessage: async (text) => {
      await deps.postMessage(text);
      setTime(afterDeadline);
    },
  });
  assert.equal(partial.status, 'outside-window');
  assert.equal(partial.count, 1);
  assert.deepEqual(posts, ['first']);
});

test('delivers only once when two invocations overlap', async () => {
  const { deps, posts } = setup();
  const results = await Promise.all([
    runScheduledReminder(slot, true, deps),
    runScheduledReminder(slot, true, deps),
  ]);
  assert.deepEqual(results.map(({ status }) => status).sort(), ['already-claimed', 'sent']);
  assert.deepEqual(posts, ['first', 'second']);
});

test('does not claim an empty digest or replay an ambiguous Slack failure', async () => {
  const { deps, claims, posts } = setup();
  const empty = await runScheduledReminder(slot, true, {
    ...deps, loadMessages: async () => [],
  });
  assert.equal(empty.status, 'no-delays');
  assert.equal(claims.size, 0);
  await assert.rejects(runScheduledReminder(slot, true, {
    ...deps,
    postMessage: async (text) => {
      await deps.postMessage(text);
      throw new Error('Slack timeout');
    },
  }), /Slack timeout/);
  assert.equal((await runScheduledReminder(slot, true, deps)).status, 'already-claimed');
  assert.deepEqual(posts, ['first']);
});
