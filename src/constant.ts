// Jira 프로젝트 설정
export const JIRA_CONFIG = {
  BASE_URL: 'https://ignitecorp.atlassian.net',
  PROJECT_KEY: 'FEHG',
  EMAIL: 'ssj@ignite.co.kr',
} as const;

// Slack user ID → Jira accountId 매핑
// Slack 프로필에서 "Copy member ID" 로 가져온 값
export const SLACK_JIRA_USER_MAP: Record<string, string> = {
  U05PV23Q8AZ: '712020:f4f9e56c-4b40-41ac-af83-5d2f774a72d5', // 한준호
  U04FBFS5SCX: '639a6767f134138b5a5132f6', // 손현지
  U04D5SP327J: '637426199e48f2b9a6108c25', // 김가빈
  U04DLF61U9K: '638d49155fce844d606c7682', // 박성찬
  U04FUFTCGCC: '639fa03f2c70aae1e6f79806', // 서성주
  U08FJ0Z9ABS: '712020:11fff4cb-cb95-457e-95a2-6cf9045c53b2', // 김찬영
  U08H1QS9805: '712020:403a306e-0eff-4d57-9fda-2f517158d40f', // 조한빈
  // U061LC4V0BT: '712020:96cf8ab5-20ff-4d6b-960d-5d38b7a46a39', // 이미진
};

// Slack user ID → 표시 이름 (Extension 등에서 사용)
export const SLACK_USER_NAMES: Record<string, string> = {
  U05PV23Q8AZ: '한준호',
  U04FBFS5SCX: '손현지',
  U04D5SP327J: '김가빈',
  U04DLF61U9K: '박성찬',
  U04FUFTCGCC: '서성주',
  U08FJ0Z9ABS: '김찬영',
  U08H1QS9805: '조한빈',
};
