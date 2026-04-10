import { App } from '@slack/bolt';

/**
 * 하나의 봇 기능 = 하나의 Command 모듈.
 *
 * 각 Command 는 자신이 필요로 하는 Slack 핸들러(shortcut/action/view/command subcommand)를
 * register 안에서 직접 app 에 등록한다.
 *
 * 새 기능 추가:
 * 1) src/commands/<feature>.ts 에 Command 구현
 * 2) src/commands/index.ts 의 commands 배열에 추가
 */
export interface Command {
  /** /fe1 <name> 서브커맨드로 호출될 이름. 서브커맨드가 없으면 빈 문자열 가능. */
  name: string;
  /** /fe1 help 에서 표시될 설명 */
  description: string;
  /** Slack App 에 필요한 모든 리스너를 등록한다. */
  register: (app: App) => void;
  /** /fe1 <name> 서브커맨드로 호출됐을 때 실행될 핸들러. 없으면 슬래시 커맨드로는 호출 불가. */
  runSlash?: (ctx: SlashContext) => Promise<void>;
}

export interface SlashContext {
  app: App;
  userId: string;
  channelId: string;
  args: string[];
  respond: (text: string) => Promise<void>;
}
