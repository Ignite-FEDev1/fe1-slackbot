import { App } from '@slack/bolt';
import { MONTHLY_REPORT_CHANNELS, SLACK_USER_NAMES } from '../constant';
import { invokeWorker } from '../invokeWorker';
import { nowKst } from '../util/kst';
import { Command } from './types';

const VIEW_ID = 'with_teammates_modal';

const formatYm = (year: number, monthIndex: number): string => {
  const d = new Date(Date.UTC(year, monthIndex, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

const buildMonthOptions = () => {
  const now = nowKst();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  return Array.from({ length: 6 }, (_, idx) => {
    const ym = formatYm(y, m - idx);
    return { text: { type: 'plain_text' as const, text: ym }, value: ym };
  });
};

export const withTeammatesCommand: Command = {
  name: 'with',
  description: '팀원별 슬랙 소통 리포트 (월 선택 → 본인 ↔ 각 팀원 협업 요약 DM)',

  register(app: App) {
    app.view(VIEW_ID, async ({ ack, view, body, client }) => {
      console.log('[with] view submit 진입. user:', body.user.id);

      const values = view.state.values;
      const yearMonth =
        values.month_block?.month?.selected_option?.value ?? '';

      const errors: Record<string, string> = {};
      if (!yearMonth) errors.month_block = '월을 선택해주세요.';
      if (Object.keys(errors).length > 0) {
        await ack({ response_action: 'errors', errors });
        return;
      }

      await ack();

      const teammateCount = Object.keys(SLACK_USER_NAMES).filter(
        (uid) => uid !== body.user.id
      ).length;

      try {
        await client.chat.postMessage({
          channel: body.user.id,
          text: `👥 *${yearMonth} 팀원별 커뮤니케이션 분석 시작*`,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `👥 *${yearMonth} 팀원별 커뮤니케이션 분석 시작*\n\nFE1 활동 채널 ${MONTHLY_REPORT_CHANNELS.length}개에서 본인 ↔ 팀원 ${teammateCount}명의 직접 소통을 정리합니다.\n결과는 2~5분 안에 *이 DM* 으로 도착합니다.`,
              },
            },
          ],
        });
      } catch (e) {
        console.error('[with] DM 시작 알림 실패:', e);
      }

      try {
        await invokeWorker({
          type: 'with_teammates_work',
          triggerUserId: body.user.id,
          yearMonth,
        });
        console.log('[with] invokeWorker 호출 성공');
      } catch (e) {
        console.error('[with] invokeWorker 실패:', e);
        try {
          await client.chat.postMessage({
            channel: body.user.id,
            text: `❌ Worker 호출 실패: ${e instanceof Error ? e.message : String(e)}`,
          });
        } catch {
          /* ignore */
        }
      }
    });
  },

  async runSlash({ client, triggerId, userId, channelId, respond }) {
    const monthOptions = buildMonthOptions();
    const initialMonth = monthOptions[0];

    try {
      await client.views.open({
        trigger_id: triggerId,
        view: {
          type: 'modal',
          callback_id: VIEW_ID,
          title: { type: 'plain_text', text: '팀원 커뮤니케이션' },
          submit: { type: 'plain_text', text: '분석 시작' },
          close: { type: 'plain_text', text: '취소' },
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text:
                  '*해당 월에 본인이 각 팀원과 슬랙에서 직접 주고받은 협업 내역*을 팀원별로 정리합니다.\n\n' +
                  '• FE1 활동 채널의 본인 ↔ 팀원 직접 소통만 추출\n' +
                  '• 팀원별 주요 논의/결정/도움 요약 + 영구 링크\n\n' +
                  '결과는 *본인 DM* 으로 발송됩니다.',
              },
            },
            {
              type: 'input',
              block_id: 'month_block',
              label: { type: 'plain_text', text: '월' },
              element: {
                type: 'static_select',
                action_id: 'month',
                initial_option: initialMonth,
                options: monthOptions,
              },
            },
          ],
        },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[with] 모달 오픈 실패:', msg);
      await client.chat.postEphemeral({
        channel: channelId,
        user: userId,
        text: `❌ 모달 열기 실패: ${msg}`,
      });
      await respond('❌ 모달을 여는 데 실패했습니다.');
    }
  },
};
