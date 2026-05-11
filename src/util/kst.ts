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

export interface WeekRange {
  /** 월요일 'YYYY-MM-DD' (KST) */
  monday: string;
  /** 금요일 'YYYY-MM-DD' (KST) */
  friday: string;
  oldestSec: number; // 월요일 00:00:00 KST (unix seconds)
  latestSec: number; // 금요일 23:59:59.999 KST (unix seconds)
  isoStart: string;
  isoEnd: string;
}

/** 'YYYY-MM-DD' (월요일) → KST 기준 해당 주 월~금 범위 */
export const buildKstWeekRange = (mondayYmd: string): WeekRange => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(mondayYmd)) {
    throw new Error(`잘못된 monday 포맷 (YYYY-MM-DD 필요): ${mondayYmd}`);
  }
  const [y, m, d] = mondayYmd.split('-').map((s) => parseInt(s, 10));
  const oldestUtcMs = Date.UTC(y, m - 1, d) - KST_OFFSET_MS; // 월 00:00 KST
  const latestUtcMs = Date.UTC(y, m - 1, d + 5) - KST_OFFSET_MS - 1; // 금요일 23:59:59.999 KST = 토요일 0시 직전
  const fridayDate = new Date(Date.UTC(y, m - 1, d + 4));
  const friday = fridayDate.toISOString().slice(0, 10);
  return {
    monday: mondayYmd,
    friday,
    oldestSec: oldestUtcMs / 1000,
    latestSec: latestUtcMs / 1000,
    isoStart: new Date(oldestUtcMs).toISOString(),
    isoEnd: new Date(latestUtcMs).toISOString(),
  };
};

/**
 * 임의 KST Date → 그 주의 월요일 'YYYY-MM-DD'.
 * 토/일이면 그 주의 월요일을 그대로 반환 (호출자가 "전 주" 로 보정해야 한다면 -7d).
 */
export const kstMondayOf = (kst: Date): string => {
  const dow = kst.getUTCDay(); // 0=일, 1=월, ..., 6=토
  const offsetToMon = dow === 0 ? -6 : 1 - dow; // 일 → -6, 월 → 0, ..., 토 → -5
  const mon = new Date(kst.getTime() + offsetToMon * 24 * 60 * 60 * 1000);
  return mon.toISOString().slice(0, 10);
};

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
