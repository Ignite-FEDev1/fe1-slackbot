// Korea Standard Time (UTC+9) 유틸. 슬랙 ts/Jira/Confluence 모두 KST 기준 일자 다룰 때 사용.

export const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

const DAY_NAMES_KO = ['일', '월', '화', '수', '목', '금', '토'];

/** Slack ts ('1234567890.123456') → KST 기준 'YYYY-MM-DD' */
export const tsToKstDate = (ts: string): string => {
  const d = new Date(parseFloat(ts) * 1000 + KST_OFFSET_MS);
  return d.toISOString().slice(0, 10);
};

/** Slack ts → 'YYYY-MM-DD (요일)' */
export const tsToKstDateLabel = (ts: string): string => {
  const d = new Date(parseFloat(ts) * 1000 + KST_OFFSET_MS);
  return `${d.toISOString().slice(0, 10)} (${DAY_NAMES_KO[d.getUTCDay()]})`;
};

/** 현재 시각의 KST Date 객체 (getUTC* 메서드로 KST 값 읽기 위함) */
export const nowKst = (): Date => new Date(Date.now() + KST_OFFSET_MS);

export interface MonthRange {
  yearMonth: string;       // "2026-04"
  oldestSec: number;       // KST 월 1일 00:00 (unix seconds)
  latestSec: number;       // KST 마지막날 23:59:59.999 (unix seconds)
  isoStart: string;        // ISO string of oldestSec
  isoEnd: string;          // ISO string of latestSec
}

/** "YYYY-MM" → KST 기준 해당 월의 시작/끝 범위 */
export const buildKstMonthRange = (yearMonth: string): MonthRange => {
  const [yearStr, monthStr] = yearMonth.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  if (!year || !month || month < 1 || month > 12) {
    throw new Error(`잘못된 yearMonth: ${yearMonth}`);
  }
  const oldestUtcMs = Date.UTC(year, month - 1, 1) - KST_OFFSET_MS;
  const latestUtcMs = Date.UTC(year, month, 1) - KST_OFFSET_MS - 1;
  return {
    yearMonth,
    oldestSec: oldestUtcMs / 1000,
    latestSec: latestUtcMs / 1000,
    isoStart: new Date(oldestUtcMs).toISOString(),
    isoEnd: new Date(latestUtcMs).toISOString(),
  };
};
