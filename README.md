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

### Jira 일정 지체 알림 (Firebase)

Firebase 예약 함수 `jiraDelayReminder`가 월~금 오후 5시(KST)에 실행합니다. 공휴일도 실행합니다.
Jira 조회 후 Slack 채널 `C04HYKFMXT2`로 발송합니다. 오후 5시 30분 이후에는 자동으로 발송하지 않습니다.

- 시작일(`customfield_10015`)이 오늘보다 과거이고 To Do 상태 범주인 FEHG 티켓을 알립니다.
- 종료일(`duedate`)이 오늘 이하이고 Done 상태 범주가 아닌 FEHG 티켓을 알립니다.
- 날짜는 한국 시간 기준입니다. 해당 날짜가 없는 티켓은 그 조건에서 제외합니다.
- 담당자별로 묶고 `SLACK_JIRA_USER_MAP`으로 멘션합니다. 매핑이 없으면 Jira 표시 이름을 씁니다. 미할당 티켓은 `담당자 없음`으로 표시합니다.
- 두 조건에 모두 해당하면 두 구역에 각각 표시합니다. 대상 티켓이 없으면 발송하지 않습니다.

**첫 배포 및 전환:**

1. `ignite-fe1`이 Blaze인지 확인하세요. 무료 체험을 쓰는 경우 연결한 결제 계정이 **무료 체험판**인지도 확인하세요.
2. 아래 명령으로 시크릿 두 개를 등록하고 함수만 배포하세요. Jira 토큰은 `JIRA_CONFIG.EMAIL` 계정의 토큰을 사용하세요. 처음에는 `JIRA_DELAY_SEND_ENABLED`를 설정하지 마세요. 기본값은 `false`입니다.
3. Cloud Scheduler에서 `firebase-schedule-jiraDelayReminder-us-central1`을 수동으로 실행해 함수 로그의 `preview`, `date`, `count`를 확인하세요. 미리보기는 Jira만 조회합니다. 실제 예약 시각도 평일 17시 실행 로그에서 확인하세요.
4. 실제 발송 전에 Firestore `(default)` DB가 없으면 Native 모드로 `us-central1`에 만드세요. 함수의 **런타임 서비스 계정**에 `roles/datastore.user` 권한이 있는지 확인하세요. 같은 날짜의 발송 시도를 한 번으로 제한합니다. Slack 응답이 불명확하거나 일부 발송이 실패해도 같은 날 자동으로 재발송하지 않습니다.
5. 이 변경을 `main`에 반영해 GitHub의 기존 Jira 예약을 먼저 끄세요. 이전 Jira 실행이 대기·실행 중이지 않은지 확인하세요. 그날 이미 발송했다면 다음 평일부터 전환하세요. `firebase-jira/.env.ignite-fe1`에 `JIRA_DELAY_SEND_ENABLED=true`를 설정하고 같은 함수만 다시 배포하세요. 전환 이후 GitHub 수동 실행은 미리보기만 합니다.

```bash
npm ci
npm ci --prefix firebase-jira
npx firebase-tools login
npx firebase-tools functions:secrets:set ATLASSIAN_TOKEN --project ignite-fe1
npx firebase-tools functions:secrets:set SLACK_BOT_TOKEN --project ignite-fe1
npx firebase-tools deploy --only functions:jira-reminder --project ignite-fe1
npx firebase-tools functions:artifacts:setpolicy --days 1 --location us-central1 --project ignite-fe1
```

함수는 인스턴스를 상시 실행하지 않으며 최대 1개만 실행합니다. 예약은 1개입니다.
예산 알림은 청구 상한이 아닙니다. 무료 체험이 만료되면 함수가 중단될 수 있으므로 만료 전에 운영 방식을 결정하세요.

```bash
npm run test:jira-delays
DRY_RUN=true npm run remind:jira-delays # .env의 Jira 토큰으로 조회, Slack 발송 없음
```

### FrontEnd 보안 뉴스 (GitHub Actions)

`.github/workflows/security-news.yml`이 매일 오전 9시(KST, 주말 포함)에 실행됩니다.
기존 Jira 알림과 별도로 채널 `C0ALN3RU92R`에 발송합니다. 예약 실행은 지연될 수 있습니다.

- 채널 본문은 `2026-11-19 FrontEnd 보안 뉴스` 한 줄입니다.
- 뉴스 목록은 스레드 댓글 하나에 번호를 붙여 보냅니다.
  `1. [Critical] 패키지: 간략한 원문 요약 <링크>` 형식입니다.
  Slack 길이 제한에 가까우면 댓글을 나눕니다.
- GitHub Advisory Database의 reviewed npm 공지 중 High·Critical만 수집합니다.
  React, Vite, Next.js, Webpack, esbuild, Rollup, Babel 등 정확한 감시 목록은
  `src/security/news.ts`의 `FE_PACKAGES`에 있습니다. npm 전체나 모든 전이 의존성을 감시하지는 않습니다.
- Node.js 런타임은 공식 보안 RSS와 공식 사이트의 Markdown 원문에서 별도로 수집합니다.
  상세 공지에서 High·Critical로 표시한 취약점만 알립니다. 상세 내용이 없는 사전 예고는 제외합니다.
- 최초 실행은 최근 14일을 조회합니다. 이후에는 마지막 성공 시점부터 하루를 겹쳐 조회합니다.
  GitHub API에는 UTC 날짜 단위로 범위를 전달하고, 감시 패키지는 조회 결과에서 걸러냅니다.
  Node.js 공지는 최소 최근 14일을 다시 확인합니다. 원본 DB 반영이 늦거나 RSS에서 빠진 공지는 놓칠 수 있습니다.
- 새 뉴스가 없으면 제목도 보내지 않습니다. 이미 보낸 항목은 생략합니다.
  심각도·요약·영향 버전·수정 버전이 바뀌면 다시 알립니다.
  같은 날 다시 실행하면 기존 스레드에 번호를 이어서 추가합니다.
- 발송 기록은 별도 `security-news-state` 브랜치의 `security-news/<채널 ID>.json`에 저장합니다.
  정상 발송한 댓글마다 저장하므로 runner가 바뀌어도 기록을 유지합니다.
  Slack 발송 직후 기록 저장 전에 프로세스가 끊기면 중복 가능성이 있습니다.
  전송 ID를 재사용하지만 정확히 한 번 발송을 보장하지는 않습니다.
  이 브랜치를 삭제하면 발송 기록도 사라집니다.

**활성화:** 기존 `SLACK_BOT_TOKEN`을 재사용합니다. 봇을 `C0ALN3RU92R`에 초대하세요.
Workflow를 기본 브랜치에 반영하세요. Lambda 배포나 추가 외부 서비스는 필요 없습니다.
발송 기록을 쓰기 위해 workflow의 `GITHUB_TOKEN`에 `contents: write`가 필요합니다.
조직 정책이나 브랜치 규칙이 `security-news-state` 생성·쓰기를 막지 않아야 합니다.

Actions → FrontEnd security news → Run workflow에서 `dry_run: true`로 미리보기하세요.
미리보기는 Slack 발송과 브랜치 생성·기록 저장을 하지 않습니다.
`false`로 실행하면 실제로 발송하고 기록을 저장합니다.

```bash
npm run test:security-news
DRY_RUN=true npm run notify:security-news # 공개 공지 조회, Slack 발송 없음
```

로컬에서 GitHub 실행 환경변수가 없으면 빈 발송 기록으로 미리보기합니다.
따라서 실제 Actions의 중복 제거 결과와 다를 수 있습니다.

## ⚠️ 개발 & 테스트 — 반드시 읽기

**슬래시 커맨드와 모달 등 Slack 상호작용은 배포 후 Slack에서 직접 확인해야 합니다.**
Jira 일정 지체 알림은 위의 단위 테스트와 미리보기 명령으로 확인할 수 있습니다.

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
