# FE1 Slack Bot 🤖

FE1 팀을 위한 업무 자동화 Slack 봇입니다. 지라 이슈 관리, 데일리/위클리 페이지 생성, 슬랙 템플릿 제공 등 다양한 업무를 자동화해드립니다.

## 🚀 주요 기능

### 📋 업무 자동화

- **슬랙 템플릿**: CPO BO/소프티어 배포 템플릿 자동 생성
- **지라 이슈 관리**: 내 담당 이슈 조회 및 상태 동기화
- **이슈 싱크**: 블록된 이슈들의 상태 자동 동기화

### 📅 데일리/위클리 관리

- **데일리 페이지**: 오늘의 작업 내용 자동 생성
- **위클리 페이지**: 주간 작업 요약 생성
- **페이지 목록**: 최신 데일리/위클리 페이지 조회

### 🔧 시스템 관리

- **SSM 명령어**: AWS SSM 명령어 실행
- **EKS 명령어**: Kubernetes 클러스터 관리
- **PR 리뷰**: GitHub PR 리뷰 상태 확인

## 🛠️ 기술 스택

- **Runtime**: Node.js 20.x
- **Framework**: Serverless Framework
- **Slack SDK**: @slack/bolt
- **Build Tool**: esbuild
- **Language**: TypeScript
- **Cloud**: AWS Lambda

## 📦 설치 및 설정

### 1. 의존성 설치

```bash
npm install
```

### 2. 환경 변수 설정

다음 환경 변수들을 설정해주세요:

```bash
# Slack 설정
SLACK_SIGNING_SECRET=your_slack_signing_secret
SLACK_BOT_TOKEN=your_slack_bot_token

# 외부 서비스 토큰
GITHUB_TOKEN=your_github_token
ATLASSIAN_TOKEN=your_atlassian_token
```

### 3. 로컬 개발

```bash
# 로컬 개발 서버 실행
npm run dev

# 파일 변경 감지 모드
npm run dev:watch
```

## 🚀 배포

### 1. 빌드

```bash
npm run build
```

### 2. 배포

```bash
# 일반 배포
sls deploy

# 또는 npm 스크립트 사용 (TLS 이슈 자동 처리)
npm run deploy
```

### 3. VPN/TLS 이슈 해결

VPN 연결 시 TLS 인증서 문제가 발생하는 경우:

```bash
export NODE_TLS_REJECT_UNAUTHORIZED=0
sls deploy
```

⚠️ **주의**: 보안상 해당 터미널에서는 다른 작업을 피해주세요.

## 📝 사용법

### Slack 명령어

- `/bot-fe1-demo`: 봇 메인 메뉴 실행

### 주요 기능별 사용법

#### 📄 슬랙 템플릿

1. 메인 메뉴에서 "📄 슬랙 템플릿" 선택
2. 원하는 템플릿 유형 선택:
   - CPO BO 정기배포/핫픽스
   - 소프티어 정기배포/핫픽스

#### 📌 지라 이슈 관리

1. 메인 메뉴에서 "📌 내 지라 이슈 확인" 선택
2. 다음 정보 확인:
   - 오늘 작업한 이슈
   - 시작하지 않은 이슈
   - 완료하지 않은 이슈

#### 🔄 이슈 싱크

1. 메인 메뉴에서 "🔄 싱크 맞추기" 선택
2. 블록된 이슈들의 상태를 자동으로 동기화

#### 📅 데일리/위클리

1. 메인 메뉴에서 "📅 데일리" 또는 "📆 위클리" 선택
2. 페이지 생성 또는 목록 조회

## 🔍 로그 확인

```bash
# 실시간 로그 확인
sls logs -f slack -t
```

## 📁 프로젝트 구조

```
src/
├── handler/           # 기능별 핸들러
│   ├── dailyPage.ts   # 데일리/위클리 페이지 관리
│   ├── slackTemplate.ts # 슬랙 템플릿 관리
│   ├── syncIssues.ts  # 지라 이슈 동기화
│   ├── ssmCommand.ts  # SSM 명령어 실행
│   ├── eksCommand.ts  # EKS 명령어 실행
│   └── ...
├── external.ts        # 외부 API 연동
├── constant.ts        # 상수 정의
├── types/            # TypeScript 타입 정의
└── util.ts           # 유틸리티 함수
```

## 🤝 기여하기

1. `src/` 하위 폴더에서 작업
2. `npm run build`로 빌드
3. `sls deploy`로 배포

## 📞 지원

문제가 발생하거나 개선 사항이 있으시면 팀에 문의해주세요.
