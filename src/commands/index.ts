import { batchTicketCommand } from './batchTicket';
import { batchTicketUpdateCommand } from './batchTicketUpdate';
import { createTicketCommand } from './createTicket';
import { dailySummaryCommand } from './dailySummary';
import { deployRoomCommand } from './deployRoom';
import { deploysCommand } from './deploys';
import { buildHelpCommand } from './help';
import { monthlyReportCommand } from './monthlyReport';
import { pingCommand } from './ping';
import { weeklyCommand } from './weekly';
import { weeklyReportCommand } from './weeklyReport';
import { Command } from './types';

/**
 * 봇의 모든 기능 모듈을 여기에 등록한다.
 * 새 기능 추가 시 파일 생성 후 이 배열에 한 줄만 추가하면 된다.
 */
export const commands: Command[] = [
  createTicketCommand,
  batchTicketCommand,
  batchTicketUpdateCommand,
  deployRoomCommand,
  deploysCommand,
  weeklyCommand,
  weeklyReportCommand,
  dailySummaryCommand,
  monthlyReportCommand,
  pingCommand,
  buildHelpCommand(() => commands),
];

export type { Command } from './types';
