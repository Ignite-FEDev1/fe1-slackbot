import { App } from '@slack/bolt';
import { MONTHLY_REPORT_CHANNELS } from '../constant';
import { invokeWorker } from '../invokeWorker';
import { nowKst } from '../util/kst';
import { Command } from './types';

const VIEW_ID = 'monthly_report_modal';

const formatYm = (year: number, monthIndex: number): string => {
  const d = new Date(Date.UTC(year, monthIndex, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

const buildMonthOptions = () => {
  const now = nowKst();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  // 이번달 + 최근 5개월 = 총 6개. 다음달은 데이터 없음 → 옵션 제외.
  return Array.from({ length: 6 }, (_, idx) => {
    const ym = formatYm(y, m - idx);
    return { text: { type: 'plain_text' as const, text: ym }, value: ym };
  });
};


export const monthlyReportCommand: Command = {
  name: 'monthly-report',
  description: '월간 성과 리포트 (Slack/Jira/Confluence/GitLab 통합 → DM + 메일)',

  register(app: App) {
    app.view(VIEW_ID, async ({ ack, view, body, client }) => {
      console.log('[monthly-report] view submit 진입. user:', body.user.id);

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
      console.log('[monthly-report] ack 완료. yearMonth:', yearMonth);

      // 시작 알림 DM
      try {
        await client.chat.postMessage({
          channel: body.user.id,
          text: `📊 *${yearMonth} 월간 성과 분석 시작*`,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `📊 *${yearMonth} 월간 성과 분석 시작*\n\nSlack ${MONTHLY_REPORT_CHANNELS.length}개 채널 + Confluence 페이지를 분석합니다.\n결과는 1~3분 안에 *이 DM* 으로 도착합니다.`,
              },
            },
          ],
        });
      } catch (e) {
        console.error('[monthly-report] DM 시작 알림 실패:', e);
      }

      try {
        await invokeWorker({
          type: 'monthly_report_work',
          triggerUserId: body.user.id,
          yearMonth,
        });
        console.log('[monthly-report] invokeWorker 호출 성공');
      } catch (e) {
        console.error('[monthly-report] invokeWorker 실패:', e);
        try {
          await client.chat.postMessage({
            channel: body.user.id,
            text: `❌ Worker 호출 실패: ${e instanceof Error ? e.message : String(e)}`,
          });
        } catch {/* ignore */}
      }
    });
  },

  async runSlash({ client, triggerId, userId, channelId, respond }) {
    const monthOptions = buildMonthOptions();
    // 이번달 = monthOptions[0] (buildMonthOptions 가 idx=0 을 이번달로 생성)
    const initialMonth = monthOptions[0];

    try {
      await client.views.open({
        trigger_id: triggerId,
        view: {
          type: 'modal',
          callback_id: VIEW_ID,
          title: { type: 'plain_text', text: '월간 성과 리포트' },
          submit: { type: 'plain_text', text: '분석 시작' },
          close: { type: 'plain_text', text: '취소' },
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text:
                  '*해당 월의 본인 활동을 통합 분석*해 Q코드 기반 성과 보고서를 생성합니다.\n\n' +
                  '• Slack: FE1 활동 채널의 본인 메시지/쓰레드 댓글\n' +
                  '• Confluence: 본인 작성/수정 페이지\n\n' +
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
      console.error('[monthly-report] 모달 오픈 실패:', msg);
      await client.chat.postEphemeral({
        channel: channelId,
        user: userId,
        text: `❌ 모달 열기 실패: ${msg}`,
      });
      await respond('❌ 모달을 여는 데 실패했습니다.');
    }
  },
};
