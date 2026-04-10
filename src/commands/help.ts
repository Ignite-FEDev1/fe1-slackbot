import { Command } from './types';

/**
 * help 는 commands 배열을 참조해야 하므로 순환 import 를 피하기 위해
 * 팩토리 함수로 만든다.
 */
export const buildHelpCommand = (getCommands: () => Command[]): Command => ({
  name: 'help',
  description: '사용 가능한 명령어 목록',

  register() {
    // 별도 리스너 없음
  },

  async runSlash({ respond }) {
    const lines = getCommands()
      .filter((c) => c.name !== 'help')
      .map((c) => `• \`/fe1 ${c.name}\` — ${c.description}`)
      .join('\n');
    await respond(`*FE1 Bot 사용 가능한 명령어*\n${lines}`);
  },
});
