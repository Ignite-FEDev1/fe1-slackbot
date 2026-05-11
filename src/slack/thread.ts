import { WebClient } from '@slack/web-api';
import { ThreadMessage } from '../llm/summarize';

/**
 * Slack 쓰레드의 모든 메시지를 가져와서 LLM 에 넘길 수 있는 형태로 변환한다.
 * 봇 메시지는 제외한다.
 */
export const fetchThreadMessages = async (
  client: WebClient,
  channel: string,
  threadTs: string
): Promise<ThreadMessage[]> => {
  const res = await client.conversations.replies({
    channel,
    ts: threadTs,
    limit: 200,
  });

  const messages = res.messages ?? [];

  // user id → display name 캐싱
  const userIds = Array.from(
    new Set(
      messages
        .map((m) => m.user)
        .filter((u): u is string => Boolean(u))
    )
  );
  const nameMap: Record<string, string> = {};
  await Promise.all(
    userIds.map(async (uid) => {
      try {
        const info = await client.users.info({ user: uid });
        nameMap[uid] =
          info.user?.profile?.display_name ||
          info.user?.real_name ||
          uid;
      } catch {
        nameMap[uid] = uid;
      }
    })
  );

  return messages
    .filter((m) => !m.bot_id && m.text)
    .map((m) => ({
      user: m.user ? nameMap[m.user] ?? m.user : 'unknown',
      text: (m.text ?? '').replace(/<@([UW][A-Z0-9]+)>/g, (_, uid) =>
        nameMap[uid] ? `@${nameMap[uid]}` : `@${uid}`
      ),
    }));
};
