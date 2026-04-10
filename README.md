# FE1 Slack Bot 🤖

Slack 쓰레드에서 바로 FEHG Jira 티켓을 만들어주는 봇입니다. 쓰레드의 논의 내용을 LLM(Groq)이 요약해서 제목·본문 초안을 자동으로 채워줍니다.

## 🚀 기능

### Step 1 — 쓰레드 → 티켓 1개 생성 ✅
- 쓰레드 메시지 우클릭 → **티켓 만들기** (Slack message shortcut)
- 봇이 쓰레드 전체 대화를 읽음 → Groq 로 요약 → 모달에 초안 채움
- 사용자는 모달에서 **제목 / 본문 / 담당자 / 에픽** 만 확인/수정하고 생성 버튼 클릭
- 생성되면 쓰레드에 `✅ FEHG-1234` 링크가 자동으로 달림
- 공수, 시작/종료일 등은 Jira 에서 직접 입력

### Step 2 이후 (예정)
- 동시에 여러 명을 대상으로 같은 티켓 배치 생성 (배포 모니터링 등)
- `/fe1 <기능>` 으로 확장

## 🏗️ 구조

```
src/
├── index.ts            # Lambda 엔트리 (AwsLambdaReceiver)
├── local.ts            # 로컬 개발용 Express 서버
├── register.ts         # /fe1 슬래시 라우터 + commands 등록
├── constant.ts         # JIRA 설정, SLACK_JIRA_USER_MAP
├── commands/           # 🧩 기능 모듈 (1 feature = 1 file)
│   ├── types.ts        # Command 인터페이스
│   ├── index.ts        # Command 레지스트리
│   ├── createTicket.ts # Step 1 기능
│   └── help.ts         # /fe1 help
├── llm/
│   └── groq.ts         # Groq API 호출 + 프롬프트
├── jira/
│   ├── client.ts       # Jira REST v3 axios 인스턴스
│   ├── epics.ts        # 에픽 목록 조회
│   └── createIssue.ts  # Task 생성 + ADF 변환
└── slack/
    └── thread.ts       # 쓰레드 메시지 fetch + 사용자 이름 치환
```

### 새 기능 추가하는 법
1. `src/commands/<feature>.ts` 생성, `Command` 인터페이스 구현
2. `src/commands/index.ts` 의 `commands` 배열에 한 줄 추가
3. 끝

## ⚙️ 환경 변수

```bash
SLACK_SIGNING_SECRET=xxx
SLACK_BOT_TOKEN=xoxb-xxx
ATLASSIAN_TOKEN=xxx          # Jira API 토큰
GROQ_API_KEY=gsk_xxx         # https://console.groq.com/keys
```

## 🛠️ Slack 앱 설정

### Slash Commands
- `/fe1` — Request URL 을 배포된 Lambda 엔드포인트로 설정

### Interactivity & Shortcuts → Shortcuts → On messages
- Name: `티켓 만들기`
- Callback ID: `create_ticket_from_thread` ← **코드와 일치해야 함**

### OAuth Bot Token Scopes
- `commands`
- `chat:write`
- `channels:history`, `groups:history`, `im:history`
- `users:read`

## 🧑‍💻 로컬 개발

```bash
npm install
npm run dev        # localhost:3086 에서 실행
# ngrok 등으로 외부 노출 후 Slack 앱 Request URL 연결
```

## 🚀 배포

```bash
npm run deploy
# = npm run build && sls deploy
```

## 📝 Slack ↔ Jira 사용자 매핑

`src/constant.ts` 의 `SLACK_JIRA_USER_MAP` 에서 관리. 매핑이 없는 사용자에게 할당 시 봇이 DM 으로 경고를 보냅니다.
