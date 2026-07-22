# FE1 Slack Bot 🤖

FE1 팀 업무를 Slack 안에서 처리해주는 봇입니다. `/fe1` 슬래시 커맨드와 메시지 숏컷으로 동작하며, AWS Lambda 에서 운영됩니다.

## 🚀 기능

전체 목록은 Slack 에서 `/fe1 help` 로 확인하세요. 주요 기능:

| 커맨드 | 설명 |
|---|---|
| `ticket` | 쓰레드 → FEHG Jira 티켓 생성 (메시지 숏컷 "티켓 만들기", LLM 이 초안 작성) |
| `batch-ticket` / `batch-ticket-update` | 여러 명 대상 티켓 배치 생성/수정 |
| `deploy-room` | 배포방 생성 (메시지 숏컷) |
| `deploys` | 최근 배포대장 목록 |
| `weekly` | 최근 위클리 문서 보기 |
| `weekly-report` | 위클리 리포트 (데일리 스크럼/Jira/Slack 통합 → DM) |
| `monthly-report` | 월간 성과 리포트 (Slack/Jira/Confluence/GitLab 통합 → DM + 메일) |
| `with` | 팀원별 슬랙 소통 리포트 |

이 외에 Chrome Extension 용 API(`/api/*`)도 같은 Lambda 에서 서빙합니다.

## ⚠️ 개발 & 테스트 — 반드시 읽기

**이 봇은 로컬에서 테스트할 수 없습니다. 배포해서 Slack 에서 직접 확인하는 것이 유일한 테스트 방법입니다.**

- 봇은 화면이 없습니다. 모든 결과물(모달, 쓰레드 답글, DM)은 Slack 안에서 확인합니다.
- 로컬 서버(`npm run dev`)를 띄워도 Slack 이 사내 VPN 안의 내 컴퓨터로 이벤트를 보낼 방법이 없습니다 (ngrok 사용 불가 환경).
- 스테이지는 `prod` 하나뿐입니다. **배포하면 팀 전체가 쓰는 봇이 내 코드로 교체됩니다.** 팀 내부용이라 괜찮지만, 아래 규칙은 지켜주세요.
  - 배포 전 `main` 최신을 rebase/merge 해서 다른 사람 기능이 롤백되지 않게 하기
  - 작업이 끝나면 (머지 후) `main` 기준으로 재배포해서 운영 상태 복구하기

### 배포 테스트 절차

```bash
# 0. 사전 준비 (최초 1회)
#    - .env : .env.example 복사 후 성주님께 실제 값 전체를 받아서 채우기 (일부만 있으면 배포 실패)
#    - AWS 자격증명 : default 프로필, ap-northeast-2 (Lambda/CloudFormation 배포 권한)
#    - serverless v3 : npm i -g serverless@3

npm install
npm run deploy     # = build + sls deploy → 운영 Lambda 교체

# Slack 에서 /fe1 <커맨드> 로 직접 테스트
```

배포 로그, 런타임 오류는 CloudWatch (`/aws/lambda/fe1-slackbot-prod-slack`) 에서 확인합니다.

### `npm run dev` 는 뭐에 쓰나요?

번들이 깨지지 않고 부팅되는지 확인하는 스모크 체크 용도입니다. `localhost:3086` 에 서버가 뜨긴 하지만 Slack 요청을 받을 수 없으므로 기능 테스트는 불가능합니다.

## 🏗️ 구조

```
src/
├── index.ts            # Lambda 엔트리 (Slack 이벤트 + /api 라우팅 + worker 분기)
├── local.ts            # 로컬 부팅 확인용 Express 서버
├── register.ts         # /fe1 슬래시 라우터 + commands 등록
├── worker.ts           # 장시간 작업 처리 (리포트 생성 등, Lambda 자기호출)
├── invokeWorker.ts     # worker 비동기 invoke
├── constant.ts         # JIRA 설정, SLACK_JIRA_USER_MAP 등
├── db.ts               # Supabase (사용자별 Jira 인증정보, settings)
├── commands/           # 🧩 기능 모듈 (1 feature = 1 file)
│   ├── types.ts        # Command 인터페이스
│   ├── index.ts        # Command 레지스트리
│   └── *.ts            # 각 기능 (createTicket, deployRoom, weeklyReport, ...)
├── api/router.ts       # Chrome Extension API
├── llm/                # LLM 호출 (Anthropic/Groq) + 프롬프트
├── jira/               # Jira REST v3 클라이언트, 이슈 생성/수정, 에픽
├── slack/thread.ts     # 쓰레드 메시지 fetch + 사용자 이름 치환
├── email/resend.ts     # 리포트 메일 발송
├── *Fetchers.ts        # weekly/monthly/teammate 리포트용 데이터 수집
└── util/kst.ts         # KST 날짜 유틸
```

### 새 기능 추가하는 법

1. `src/commands/<feature>.ts` 생성, `Command` 인터페이스 구현
2. `src/commands/index.ts` 의 `commands` 배열에 한 줄 추가
3. `npm run deploy` 후 Slack 에서 확인

## ⚙️ 환경 변수

`.env.example` 을 `.env` 로 복사하고 실제 값을 채웁니다. **값은 성주님께 받으세요.**

`serverless.yml` 이 배포 시 `.env` 의 값을 Lambda 환경변수로 주입하므로, 키가 하나라도 비어 있으면 배포가 실패합니다. 내 기능이 안 쓰는 키도 전부 필요합니다.

## 🛠️ Slack 앱 설정

### Slash Commands
- `/fe1` — Request URL 을 배포된 Lambda 엔드포인트로 설정

### Interactivity & Shortcuts → Shortcuts → On messages
- `티켓 만들기` (Callback ID: `create_ticket_from_thread`), `배포방 만들기` 등 — Callback ID 는 **코드와 일치해야 함**

### OAuth Bot Token Scopes
- `commands`
- `chat:write`
- `channels:history`, `groups:history`, `im:history`
- `users:read`

## 📝 Slack ↔ Jira 사용자 매핑

`src/constant.ts` 의 `SLACK_JIRA_USER_MAP` 에서 관리. 매핑이 없는 사용자에게 할당 시 봇이 DM 으로 경고를 보냅니다.
