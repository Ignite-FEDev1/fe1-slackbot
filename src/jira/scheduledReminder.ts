import { KST_OFFSET_MS } from '../util/kst';

const SEND_WINDOW_MS = 30 * 60 * 1000;
export const SLACK_TIMEOUT_MS = 10_000;

interface ReminderDependencies {
  now: () => number;
  loadMessages: (date: string) => Promise<string[]>;
  claimDelivery: (date: string) => Promise<boolean>;
  postMessage: (text: string) => Promise<unknown>;
}

export async function runScheduledReminder(
  scheduleTime: string,
  sendEnabled: boolean,
  { now, loadMessages, claimDelivery, postMessage }: ReminderDependencies
) {
  const scheduledAt = Date.parse(scheduleTime);
  if (!Number.isFinite(scheduledAt)) throw new Error('Invalid Jira reminder schedule time');

  const kst = new Date(scheduledAt + KST_OFFSET_MS);
  const date = kst.toISOString().slice(0, 10);
  const result = (status: string, count = 0) => ({ status, date, count });
  if (!sendEnabled) return result('preview', (await loadMessages(date)).length);

  const slot = new Date(kst).setUTCHours(17, 0, 0, 0) - KST_OFFSET_MS;
  const deadline = slot + SEND_WINDOW_MS;
  if (kst.getUTCDay() % 6 === 0 || scheduledAt < slot || scheduledAt >= deadline) {
    return result('outside-schedule');
  }

  const canSend = () => {
    const time = now();
    return time >= scheduledAt && time + SLACK_TIMEOUT_MS <= deadline;
  };
  if (!canSend()) return result('outside-window');
  const messages = await loadMessages(date);
  if (!canSend()) return result('outside-window');
  if (messages.length === 0) return result('no-delays');
  if (!(await claimDelivery(date))) return result('already-claimed');

  let sent = 0;
  for (const text of messages) {
    if (!canSend()) return result('outside-window', sent);
    await postMessage(text);
    sent++;
  }
  return result('sent', sent);
}
