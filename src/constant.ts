import { LinkBlockInputItem } from './types';

export const JIRA_BOARD_IDS = {
  FEHG: 251,
  HB: 350,
  HDD: 37,
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
};

export const SLACK_JIRA_USER_MAP: Record<string, string> = {
  U05PV23Q8AZ: '712020:f4f9e56c-4b40-41ac-af83-5d2f774a72d5', // 한준호
  U04FBFS5SCX: '639a6767f134138b5a5132f6', // 손현지
  U04D5SP327J: '637426199e48f2b9a6108c25', // 김가빈
  U04DLF61U9K: '638d49155fce844d606c7682', // 박성찬
  U04FUFTCGCC: '639fa03f2c70aae1e6f79806', // 서성주
  U08FJ0Z9ABS: '712020:11fff4cb-cb95-457e-95a2-6cf9045c53b2', // 김찬영
  U08H1QS9805: '712020:403a306e-0eff-4d57-9fda-2f517158d40f', // 조한빈
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
