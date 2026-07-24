import { Command } from "./types";

const TEMPLATE_TEXT = `@ 박범진 님 안녕하세요 cc. @fe-bo
\`{메뉴명}\` - 운영계 메뉴 추가 부탁드립니다.
(\`{배포일 및 사유}\`로 운영 선등록 요청드리는 메뉴입니다.)

> [신규생성] \`{1dep명}\`(1dep) > \`{메뉴명}\`(신규)
• 메뉴 위치: \`{1dep명}\`(1dep) 하위 > \`{기준 메뉴명}\` 다음
• 메뉴명(한) : \`{메뉴명}\`
• 도메인: https://cpo.kia-corp.io/ (cpo-api 아님 주의 :star:)
• 메뉴URL: \`{경로}\`
• 메뉴 권한 목록
  • 읽기 - 권한명: 읽기, 권한코드: \`{읽기 권한코드}\`
  • 쓰기 - 권한명: 쓰기, 권한코드: \`{쓰기 권한코드}\`

@ 조민근 님
권한 관리 엑셀 갱신 부탁드립니다.
https://ignitecorp.atlassian.net/wiki/spaces/CPO/pages/317653090/BO

💡 예시
• 배포일 및 사유: 260723 정기배포
• 메뉴명: 상품 전시 키워드관리
• 경로: /sales/display-keyword
• 권한코드: bo-display-keyword_READ, bo-display-keyword_WRITE
`;

export const cpoBoMenuNewCommand: Command = {
  name: "cpo-bo-menu-new",
  description: "CPO BO 신규 메뉴 추가 요청 템플릿 출력 (ephemeral)",

  register() {},

  async runSlash({ client, userId, channelId }) {
    await client.chat.postEphemeral({
      channel: channelId,
      user: userId,
      text: TEMPLATE_TEXT,
    });
  },
};
