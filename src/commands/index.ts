import { batchTicketCommand } from './batchTicket';
import { createTicketCommand } from './createTicket';
import { buildHelpCommand } from './help';
import { Command } from './types';

/**
 * 봇의 모든 기능 모듈을 여기에 등록한다.
 * 새 기능 추가 시 파일 생성 후 이 배열에 한 줄만 추가하면 된다.
 */
export const commands: Command[] = [
  createTicketCommand,
  batchTicketCommand,
  buildHelpCommand(() => commands),
];

export type { Command } from './types';
