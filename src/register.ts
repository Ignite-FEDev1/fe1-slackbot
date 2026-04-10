import { App } from '@slack/bolt';
import { commands } from './commands';

/**
 * Slack App 에 모든 기능(커맨드)을 등록한다.
 * index.ts (Lambda) 와 local.ts (Express) 에서 공통으로 사용한다.
 */
export const registerApp = (app: App) => {
  // 각 command 가 필요한 shortcut/action/view 리스너를 스스로 등록
  for (const cmd of commands) {
    cmd.register(app);
  }

  // /fe1 슬래시 커맨드 라우터
  app.command('/fe1', async ({ command, ack, respond, client }) => {
    await ack();

    const [sub, ...args] = command.text.trim().split(/\s+/).filter(Boolean);
    const name = sub || 'help';

    const target = commands.find((c) => c.name === name);

    if (!target || !target.runSlash) {
      const available = commands.map((c) => c.name).join(', ');
      await respond({
        text: `알 수 없는 명령어: \`${name}\`\n사용 가능: ${available}\n\`\/fe1 help\` 로 전체 도움말을 확인하세요.`,
      });
      return;
    }

    await target.runSlash({
      app,
      userId: command.user_id,
      channelId: command.channel_id,
      args,
      respond: async (text: string) => {
        await respond({ text });
      },
    });
  });
};
