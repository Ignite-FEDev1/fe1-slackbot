import { LinkBlockInputItem } from './types';

export const JIRA_BOARD_IDS = {
  FEHG: 251,
  HB: 350,
  HDD: 37,
  KQ: 20,
};

export const USER_GROUP_IDS = [
  { name: 'fe1', id: 'S06J9P5HQ2U' },
  { name: 'fe-hmgdev', id: 'S067AHD9MFZ' },
  { name: 'hmg-board FE 개발자', id: 'S093RBN8F1T' },
  { name: 'fe-groupware', id: 'S07NV01MHN1' },
];

export const SLACK_GITHUB_USER_MAP = {
  U05PV23Q8AZ: 'ignite-junho', // 한준호
  U04FBFS5SCX: 'ignite-hyunji', // 손현지
  U04D5SP327J: 'ignite-gabin', // 김가빈
  U04DLF61U9K: 'ignite-sungchan', // 박성찬
  U04FUFTCGCC: 'ignite-seongju', // 서성주
  U08FJ0Z9ABS: 'ignite-cykim', // 김찬영
  U08H1QS9805: 'ignite-hanbeen', // 조한빈
  U061LC4V0BT: 'ignite-mijin', // 이미진
};

export const SLACK_JIRA_USER_MAP: Record<string, string> = {
  U05PV23Q8AZ: '712020:f4f9e56c-4b40-41ac-af83-5d2f774a72d5', // 한준호
  U04FBFS5SCX: '639a6767f134138b5a5132f6', // 손현지
  U04D5SP327J: '637426199e48f2b9a6108c25', // 김가빈
  U04DLF61U9K: '638d49155fce844d606c7682', // 박성찬
  U04FUFTCGCC: '639fa03f2c70aae1e6f79806', // 서성주
  U08FJ0Z9ABS: '712020:11fff4cb-cb95-457e-95a2-6cf9045c53b2', // 김찬영
  U08H1QS9805: '712020:403a306e-0eff-4d57-9fda-2f517158d40f', // 조한빈
  U061LC4V0BT: '712020:96cf8ab5-20ff-4d6b-960d-5d38b7a46a39', // 이미진
};

export const CHANNEL_IDS = [
  { name: '이그나이트', id: 'C049HGQT9ST' },
  { name: '랜덤', id: 'C049V4J95NZ' },
  { name: 'cpo-code-review', id: 'C049XEKQ8AJ' },
  { name: '일반', id: 'C049Y00LMH9' },
  { name: 'cpo-프라이싱', id: 'C04CB5SBCLT' },
  { name: 'cpo-판매금융', id: 'C04CDMRE0N8' },
  { name: 'fe-정보공유', id: 'C04ET5DMYAC' },
  { name: '프라이싱엔진알림_test', id: 'C04MESZA9FB' },
  { name: 'cpo-결제', id: 'C04MY87NMQX' },
  { name: 'cpo-bo', id: 'C04N82W0RPY' },
  { name: 'cpo-qa', id: 'C053GEE9A5R' },
  { name: '기아-cpo-인프라구성', id: 'C054BH5GV0F' },
  { name: 'app-distributions', id: 'C056YP55HHQ' },
  { name: 'fe1-dm', id: 'C04HYKFMXT2' },
  { name: 'fe-dm', id: 'C0617SQTU67' },
];

export const PROJECT_NAMES = [
  { name: 'CPO BO', value: 'kia-cpo-bo-web' },
  { name: 'HMG Developer', value: 'hmg-dev-web' },
  { name: 'Groupware', value: 'hmg-groupware-bo-web' },
];

// 싱크 대상별 업데이트 필드 설정
export const SYNC_FIELD_CONFIG = {
  FEHG_TO_HB: {
    description: 'FEHG → HB 싱크 시 업데이트할 필드들',
    fields: [
      'summary',
      'duedate',
      'customfield_10015',
      'assignee',
      'timetracking',
      'customfield_10020', // sprint 필드
    ] as const,
  },
  FEHG_TO_KQ: {
    description: 'FEHG → KQ 싱크 시 업데이트할 필드들',
    fields: [
      'summary',
      'duedate',
      'customfield_10015',
      'assignee',
      'timetracking',
      'customfield_10020', // sprint 필드 추가
    ] as const,
  },
} as const;

// 싱크 타입 정의
export type SyncType = keyof typeof SYNC_FIELD_CONFIG;

// 스프린트 매핑 설정
export const SPRINT_MAPPING = {
  FEHG_TO_HB: {
    description: 'FEHG → HB 스프린트 매핑',
    pattern: /^FEHG\s+(\d{2})(\d{2})$/,
    targetFormat: 'HB 20$1$2',
  },
  FEHG_TO_KQ: {
    description: 'FEHG → KQ 스프린트 매핑',
    pattern: /^FEHG\s+(\d{2})(\d{2})$/,
    targetFormat: 'KQ 20$1$2',
  },
} as const;

// 스프린트 매핑 함수
export function mapSprintName(
  sourceSprintName: string,
  syncType: SyncType
): string | null {
  const mapping = SPRINT_MAPPING[syncType as keyof typeof SPRINT_MAPPING];
  if (!mapping) {
    return null;
  }

  const match = sourceSprintName.match(mapping.pattern);
  if (!match) {
    return null;
  }

  const year = match[1]; // 25
  const month = match[2]; // 08
  return mapping.targetFormat.replace('$1', year).replace('$2', month);
}

// 스프린트 존재 여부 확인 함수 (HB 스프린트 목록에서 확인)
export function findMatchingSprint(
  sourceSprintName: string | null,
  targetSprints: Array<{ name: string; id: number }>,
  syncType: SyncType
): { id: number; name: string } | null {
  if (!sourceSprintName || typeof sourceSprintName !== 'string') {
    console.warn(`⚠️ 유효하지 않은 스프린트 이름:`, sourceSprintName);
    return null;
  }

  const mappedSprintName = mapSprintName(sourceSprintName, syncType);
  if (!mappedSprintName) {
    return null;
  }

  const matchingSprint = targetSprints.find(
    (sprint) => sprint.name === mappedSprintName
  );
  return matchingSprint
    ? { id: matchingSprint.id, name: matchingSprint.name }
    : null;
}

// 스프린트 캐시 설정
export const SPRINT_CACHE_CONFIG = {
  TTL: 5 * 60 * 1000, // 5분 (밀리초)
  MAX_RETRIES: 3, // 최대 재시도 횟수
  RETRY_DELAY: 1000, // 재시도 간격 (밀리초)
} as const;
