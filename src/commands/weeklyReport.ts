import { App } from '@slack/bolt';
import { invokeWorker } from '../invokeWorker';
import { kstMondayOf, nowKst } from '../util/kst';
import { Command } from './types';

const formatYmd = (utcMs: number): string =>
  new Date(utcMs).toISOString().slice(0, 10);

/**
 * 실행 시점 기준 한 일 주의 월요일 = 전주 월요일.
 * (할 일 주 = 한 일 주 + 7일 = 이번 주 월요일)
 *
 * 토/일 실행 시 kstMondayOf 는 그 주의 월요일을 반환하므로,
 * 일관되게 "한 일 = 직전 영업주" 가 되도록 항상 -7d 적용.
 */
const resolveDoneMonday = (): string => {
  const now = nowKst();
  const thisWeekMon = kstMondayOf(now);
  const [y, m, d] = thisWeekMon.split('-').map((s) => parseInt(s, 10));
  return formatYmd(Date.UTC(y, m - 1, d - 7));
};

export const weeklyReportCommand: Command = {
  name: 'weekly-report',
  description: '위클리 리포트 (데일리 스크럼/Jira/Slack 통합 → DM)',

  register() {
    // 모달/뷰 핸들러 없음 — 슬래시 즉시 실행
  },

  async runSlash({ client, userId, channelId, respond }) {
    const weekMonday = resolveDoneMonday();
    const [y, m, d] = weekMonday.split('-').map((s) => parseInt(s, 10));
    const friday = formatYmd(Date.UTC(y, m - 1, d + 4));

    // 시작 알림 (커맨드 실행 채널에 ephemeral)
    try {
      await client.chat.postEphemeral({
        channel: channelId,
        user: userId,
        text: `📅 *${weekMonday} ~ ${friday} 위클리 분석 시작*\n결과는 1~3분 안에 *본인 DM* 으로 도착합니다.`,
      });
    } catch (e) {
      console.error('[weekly-report] ephemeral 시작 알림 실패:', e);
      await respond(`📅 ${weekMonday} ~ ${friday} 위클리 분석을 시작합니다. 결과는 본인 DM 으로 도착합니다.`);
    }

    // 본인 DM 으로도 시작 알림
    try {
      await client.chat.postMessage({
        channel: userId,
        text: `📅 *${weekMonday} ~ ${friday} 위클리 분석 시작*`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `📅 *${weekMonday} ~ ${friday} 위클리 분석 시작*\n\n데일리 스크럼 + 활동 채널 + 다음 주 Jira 티켓을 분석합니다.\n결과는 1~3분 안에 *이 DM* 으로 도착합니다.`,
            },
          },
        ],
      });
    } catch (e) {
      console.error('[weekly-report] DM 시작 알림 실패:', e);
    }

    try {
      await invokeWorker({
        type: 'weekly_report_work',
        triggerUserId: userId,
        weekMonday,
      });
      console.log('[weekly-report] invokeWorker 호출 성공. weekMonday:', weekMonday);
    } catch (e) {
      console.error('[weekly-report] invokeWorker 실패:', e);
      try {
        await client.chat.postMessage({
          channel: userId,
          text: `❌ Worker 호출 실패: ${e instanceof Error ? e.message : String(e)}`,
        });
      } catch {
        /* ignore */
      }
    }
  },
};
