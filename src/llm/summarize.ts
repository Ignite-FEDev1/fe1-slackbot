// 도메인별 요약 프롬프트 모음. 실제 LLM 호출은 src/llm/client.ts 로 위임.
//
// 호출자별 LLM 선택:
// - 티켓 생성/배치/텍스트(Chrome Ext) → callLlm + MODEL_FAST (Haiku): 짧은 추출이라 Haiku 충분, latency 도 양호.
//   호출 경로는 worker 비동기 (init_ticket_modal_work) 라 30초 타임아웃 무관.
// - daily/weekly/monthly 요약 → callLlm + MODEL_DEFAULT (Sonnet): 품질 우선.
import { callLlm, MODEL_FAST } from './client';

/**
 * LLM 응답 JSON 을 파싱하여 TicketDraft 로 반환.
 * 모든 요약 함수가 공통으로 사용한다.
 */
const parseTicketDraft = (raw: string | null, tag: string): TicketDraft | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (
      typeof parsed?.title === 'string' &&
      typeof parsed?.description === 'string'
    ) {
      return { title: parsed.title, description: parsed.description };
    }
  } catch (e) {
    console.error(`[llm] (${tag}) 응답 JSON 파싱 실패:`, raw);
  }
  return null;
};

// ─── 공통 프롬프트 블록 ─────────────────────────────────────────────

const STYLE_RULES = `## [절대 규칙] 문체
반드시 모든 문장을 명사형 어미로 끝내라. 이 규칙을 어기면 출력이 무효 처리된다.
- 절대 "~합니다", "~됩니다", "~입니다", "~했습니다", "~이루어졌습니다" 등 경어/합쇼체를 쓰지 마라.
- 반드시 "~함", "~구현", "~개선", "~적용", "~수정", "~필요", "~예정", "~확인" 같은 명사형 종결로 끝내라.
- 올바른 예: "슬랙봇 기능 개선", "API 응답 포맷 변경", "배포 후 모니터링 필요", "컨플루언스 연동 검토"
- 잘못된 예: "슬랙봇의 기능을 개선합니다", "API 응답 포맷을 변경합니다", "모니터링이 필요합니다"
- 모든 불릿(-) 항목, 제목, 본문의 매 문장에 이 규칙을 적용하라.`;

const SELF_CONTAINED_RULES = `## 가장 중요한 원칙
티켓은 **원문을 보지 못한 다른 팀원이 읽어도 어떤 작업을 어떻게 해야 할지 이해할 수 있도록** 자립적으로(self-contained) 작성되어야 한다.
- "위에서 얘기한 그것", "아까 그 버그", "앞서 논의한 방식" 같이 원문 컨텍스트에 의존하는 표현 금지.
- 원문에서 당연시된 용어/약어/시스템명이 있다면 한 번은 풀어서 써라.
- 읽는 사람이 "이 화면이 뭔지, 왜 해야 하는지, 어디를 어떻게 바꿔야 하는지" 정도는 티켓만 보고 알 수 있어야 한다.
- 단, 원문에 없는 정보를 지어내지는 말 것. 명확하지 않은 부분은 참고 섹션에 "명확히 할 것" 으로 남겨라.`;

const RESPONSE_FORMAT = `## 응답 형식
반드시 아래 JSON 스키마로만 응답하라:
{
  "title": string,        // 한국어, 60자 이내, 명사형 종결. 무엇을 하는지 한 줄에 드러나야 함
  "description": string   // 한국어 markdown, 모든 문장 명사형 종결
}

description 은 다음 섹션을 반드시 포함한다:
## 배경
- 이 작업이 왜 필요한지, 어떤 문제/요청에서 출발했는지
- 관련된 시스템/화면/기능 이름 (약어면 풀어쓰기)

## 작업 내용
- 구체적으로 무엇을 해야 하는지. 가능한 한 체크리스트 형태의 액션 아이템으로
- 파일/컴포넌트/API 이름 등이 언급됐다면 명시

## 참고
- 제약사항, 관련 링크, 결정사항, 아직 불확실한 점

각 섹션 내용은 불릿(-)으로 작성한다. 모든 불릿 항목은 명사형 어미로 끝낸다.`;

/**
 * 컨텍스트 블록을 빌드하는 공통 헬퍼.
 */
const buildContextBlock = (lines: string[]): string =>
  lines.length ? `\n<컨텍스트>\n${lines.join('\n')}\n</컨텍스트>\n` : '';

// ─── 타입 ─────────────────────────────────────────────────────────

export interface ThreadMessage {
  user: string;
  text: string;
}

export interface TicketDraft {
  title: string;
  description: string;
}

export interface SummarizeContext {
  /** 티켓 담당자의 표시 이름. LLM 이 이 사람 관점에서 작업을 추출한다. */
  assigneeName?: string;
  /** 사용자가 추가로 넣는 지시사항. 예: "FE 작업만", "백엔드 제외" */
  instructions?: string;
}

// ─── 쓰레드 기반 요약 (단일 티켓) ──────────────────────────────────

export const summarizeThreadToTicket = async (
  messages: ThreadMessage[],
  context: SummarizeContext = {}
): Promise<TicketDraft | null> => {
  if (messages.length === 0) return null;

  const conversation = messages
    .map((m, i) => `[${i + 1}] ${m.user}: ${m.text}`)
    .join('\n');

  const contextLines: string[] = [];
  if (context.assigneeName) {
    contextLines.push(`- 담당자: ${context.assigneeName}`);
    contextLines.push(
      `- 이 티켓은 "${context.assigneeName}" 가 해야 할 작업만 담아야 한다. 쓰레드에 다른 사람(다른 직군 포함)의 작업이 섞여 있어도, 담당자의 작업으로 명시되거나 담당자에게 요청된 작업만 추출하라. 담당자의 작업이 명확하지 않으면 본문에 "쓰레드에서 담당자의 작업 범위를 특정하기 어려움"이라고 표시하라.`
    );
  }
  if (context.instructions) {
    contextLines.push(`- 추가 지시사항: ${context.instructions}`);
  }

  const system = `너는 소프트웨어 팀의 Jira 티켓 작성 보조다.
입력된 Slack 쓰레드 대화를 읽고, 논의에서 도출된 작업을 하나의 Jira Task 로 정리한다.

${STYLE_RULES}

${SELF_CONTAINED_RULES}

${RESPONSE_FORMAT}
컨텍스트에 담당자가 명시되어 있으면, 담당자의 관점에서 해당 인물이 할 작업만 제목/본문에 담아라.`;

  const user = `${buildContextBlock(contextLines)}<쓰레드>
${conversation}
</쓰레드>`;

  return parseTicketDraft(
    await callLlm(system, user, { model: MODEL_FAST }),
    'thread'
  );
};

export interface BatchSummarizeContext {
  /** 담당자 수 (프롬프트 안내용) */
  assigneeCount?: number;
  /** 사용자가 추가로 넣는 지시사항 */
  instructions?: string;
}

// ─── 쓰레드 기반 요약 (배치 티켓) ─────────────────────────────────

export const summarizeThreadForBatchTicket = async (
  messages: ThreadMessage[],
  context: BatchSummarizeContext = {}
): Promise<TicketDraft | null> => {
  if (messages.length === 0) return null;

  const conversation = messages
    .map((m, i) => `[${i + 1}] ${m.user}: ${m.text}`)
    .join('\n');

  const contextLines: string[] = [];
  if (context.assigneeCount && context.assigneeCount > 0) {
    contextLines.push(
      `- 이 티켓은 동일한 내용으로 ${context.assigneeCount}명에게 각각 복제되어 할당된다.`
    );
  }
  if (context.instructions) {
    contextLines.push(`- 추가 지시사항: ${context.instructions}`);
  }

  const system = `너는 소프트웨어 팀의 Jira 티켓 작성 보조다.
입력된 Slack 쓰레드 대화를 읽고, 여러 팀원이 공통으로 수행할 작업을 하나의 Jira Task 로 정리한다.
이 티켓은 동일한 내용으로 N명에게 각각 복제되어 할당되며, 할당받은 사람 모두가 (함께 또는 각자 동일하게) 수행해야 하는 작업이다.
(예: 배포 모니터링, 공통 환경 설정, 일괄 이슈 점검, 공지 숙지 등)

${STYLE_RULES}

${SELF_CONTAINED_RULES}

## 배치 티켓 작성 규칙
- 제목과 본문에 **특정 인물 이름을 넣지 말 것**. "모두가 해야 할 일" 관점으로 작성.
- 제목은 공통 작업이 무엇인지 한 줄로 드러나야 함. (예: "6월 정기배포 모니터링", "신규 스프린트 보드 확인")
- 본문의 "작업 내용" 섹션은 할당받은 각자가 수행해야 할 구체적 액션 아이템으로 구성.
- 동시 수행인지 / 각자 수행인지 / 순차 수행인지 가능한 한 명확히 기술.

${RESPONSE_FORMAT}`;

  const user = `${buildContextBlock(contextLines)}<쓰레드>
${conversation}
</쓰레드>`;

  return parseTicketDraft(
    await callLlm(system, user, { model: MODEL_FAST }),
    'batch'
  );
};

// ─── 텍스트 기반 요약 (Chrome Extension 등) ───────────────────────

export interface TextSummarizeContext {
  /** 티켓 담당자 이름 */
  assigneeName?: string;
  /** 추가 지시사항 */
  instructions?: string;
  /** 텍스트를 가져온 페이지 URL */
  sourceUrl?: string;
}

/**
 * 사용자가 블록 지정한 텍스트를 기반으로 Jira 티켓 초안을 생성한다.
 * Chrome Extension 등 Slack 쓰레드가 아닌 입력 소스에서 사용한다.
 */
export const summarizeTextToTicket = async (
  text: string,
  context: TextSummarizeContext = {}
): Promise<TicketDraft | null> => {
  if (!text.trim()) return null;

  const contextLines: string[] = [];
  if (context.assigneeName) {
    contextLines.push(`- 담당자: ${context.assigneeName}`);
    contextLines.push(
      `- 이 티켓은 "${context.assigneeName}" 가 해야 할 작업만 담아야 한다. 텍스트에 다른 사람의 작업이 섞여 있어도, 담당자의 작업만 추출하라. 담당자의 작업이 명확하지 않으면 본문에 "텍스트에서 담당자의 작업 범위를 특정하기 어려움"이라고 표시하라.`
    );
  }
  if (context.instructions) {
    contextLines.push(`- 추가 지시사항: ${context.instructions}`);
  }
  if (context.sourceUrl) {
    contextLines.push(`- 원문 출처: ${context.sourceUrl}`);
  }

  const system = `너는 소프트웨어 팀의 Jira 티켓 작성 보조다.
사용자가 웹 페이지에서 선택(블록 지정)한 텍스트를 읽고, 해당 내용에서 도출된 작업을 하나의 Jira Task 로 정리한다.
입력 텍스트는 Confluence 댓글, 기획서, 회의록, 이메일 등 다양한 소스일 수 있다.

${STYLE_RULES}

${SELF_CONTAINED_RULES}

${RESPONSE_FORMAT}
컨텍스트에 담당자가 명시되어 있으면, 담당자의 관점에서 해당 인물이 할 작업만 제목/본문에 담아라.`;

  const user = `${buildContextBlock(contextLines)}<선택한 텍스트>
${text}
</선택한 텍스트>`;

  return parseTicketDraft(
    await callLlm(system, user, { model: MODEL_FAST }),
    'text'
  );
};

// ─── 데일리 스크럼 "한 일" 추출 (위클리 문서용) ───────────────────

/**
 * 한 사람이 일주일간 데일리 스크럼 쓰레드에 쓴 댓글들을 받아
 * "한 일"만 추출해 프로젝트별로 정리한 마크다운으로 반환한다.
 */
export const summarizeUserDoneFromDailyScrum = async (
  rawText: string,
  userName: string
): Promise<string | null> => {
  if (!rawText.trim()) return null;

  const system = `너는 팀의 데일리 스크럼 쓰레드 댓글에서 "한 일"만 추출해 주간 보고서 형태로 정리하는 보조다.

## 입력 형식
- 한 사람("${userName}")이 일주일간 데일리 스크럼 쓰레드에 쓴 모든 댓글의 원문이 날짜별로 구분되어 있다.
- 한 사람이 같은 날 "할 일"과 "한 일"을 별도 댓글로 나눠 쓰는 경우가 많다.

## 추출 규칙
- "한 일", "한일", "헌 일", "한일들" 같은 오타/변형도 모두 "한 일" 섹션으로 인식한다.
- "한 일" 댓글의 항목만 추출한다. "할 일" 댓글은 무시한다.
- 회의/일정 (예: "15:00 ~ 월간회고", "11:00 ~ FE1 데일리", "13:00 - 점심", "14:30 ~ 성과회고") 은 무조건 제외한다.
- 같은 작업이 여러 날 반복 언급되면 한 번만 정리한다 (가장 구체적인 표현으로).
- 특정 날짜에 한정된 단발성 작업과 며칠에 걸친 작업이 둘 다 있으면 둘 다 살린다.

## 그룹핑 규칙
- 입력에 프로젝트 헤더(통합딜러포탈, CPO, 그룹웨어, 프로파일, 딜러프로파일 등)가 있으면 그 헤더 단위로 그룹핑한다.
- 프로젝트 헤더가 불명확하면 "기타" 섹션으로 묶는다.

${STYLE_RULES}

## 응답 형식
반드시 아래 JSON 으로만 응답:
{
  "summary": string  // 마크다운. **프로젝트명** 헤더 + 불릿(-) 리스트
}

빈 결과면 summary 는 "(추출된 한 일 없음)" 으로.`;

  const fewShotInput = `=== 2026-04-30 (목) ===
할 일

CPO
[Jira 티켓관리] 데일리 동기화 - CPO VQ 제외
CPO Nodejs - hmgAdmin internal API 아웃바운드 해제 요청 처리

11:00 ~ FE1 데일리
14:30 ~ [화상] 내부 월말 성과회고
---
한 일

CPO
[Jira 티켓관리] 데일리 동기화 - CPO VQ 제외
CPO Nodejs - hmgAdmin internal API 아웃바운드 해제 요청 처리
DataDog -> Pinpoint 마이그레이션 - 기술검토

11:00 ~ FE1 데일리
14:30 ~ [화상] 내부 월말 성과회고

=== 2026-05-01 (금) ===
한일

그룹웨어
gw-lib changelog 작성

CPO
0501 정기배포 QA 대응`;

  const fewShotOutput = `{
  "summary": "**CPO**\\n- [Jira 티켓관리] 데일리 동기화 - CPO VQ 제외\\n- CPO Nodejs - hmgAdmin internal API 아웃바운드 해제 요청 처리\\n- DataDog → Pinpoint 마이그레이션 - 기술검토\\n- 0501 정기배포 QA 대응\\n\\n**그룹웨어**\\n- gw-lib changelog 작성"
}`;

  const userPrompt = `<예시 입력>
${fewShotInput}
</예시 입력>

<예시 출력>
${fewShotOutput}
</예시 출력>

<실제 입력 (작성자: ${userName})>
${rawText}
</실제 입력>`;

  const raw = await callLlm(system, userPrompt);
  if (!raw) {
    console.error('[llm] daily-summary callLlm 가 null 반환 (네트워크/API 에러)');
    return null;
  }
  console.log('[llm] daily-summary raw 응답 (앞 500자):', raw.slice(0, 500));
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.summary === 'string') return parsed.summary;
    console.error('[llm] daily-summary parsed.summary 가 문자열 아님:', typeof parsed?.summary, parsed);
    return null;
  } catch (e) {
    console.error('[llm] daily-summary JSON 파싱 실패. raw:', raw);
    return null;
  }
};

// ─── 월간 성과 요약 (Q코드 평가 기준) ───────────────────────────────

const Q_CODE_REFERENCE = `## Q1 최고지향
- Q1-1 신규과제 제안력: 조직에 도입/실행된 신규안을 직접 제안하고 주도
- Q1-2 자율적 실행력(도전수용): 지시 없이 신규 업무를 자발 수주/완료
- Q1-3 전문성·차별화(내외부 인정): 사내 표준/블로그/외부 발표 등으로 전문성 입증
- Q1-4 성과 연결성(전문성→비즈니스 효과): 제안/실행이 KPI 개선(매출/성능/비용 절감)으로 증빙
- Q1-5 지식전파/확산력: 문서/샘플코드/교육으로 팀 평균 역량 향상에 기여

## Q2 팀워크
- Q2-1 협업 주도력: 교차조직 이슈를 주도해 합의/실행까지 이끌어 프로젝트 성공에 기여
- Q2-2 동료 지원·멘토링: 후배/동료의 문제 해결을 정기적으로 멘토링해 성과/생산성 향상
- Q2-3 의사소통의 명확성(요약·전달력): 복잡한 이슈를 간결·논리적으로 요약하여 합의를 빠르게 이끌어냄
- Q2-4 역할/책임 분배 능력: 팀 목표 달성을 위해 적절히 역할을 배분하고 조율
- Q2-5 갈등 관리/합의 형성: 이견 상황에서 중립적 조정으로 최적 대안 도출

## Q3 적극성
- Q3-1 주도적 문제해결력: 문제를 스스로 정의하고 솔루션을 주도하여 가시적 결과로 연결
- Q3-2 기대 초과 산출(퀄리티): 요구사항을 뛰어넘는 품질/설계로 산출물 제공
- Q3-3 자발적 개선·혁신 시도: 프로세스/도구/제품 개선을 자발적으로 추진
- Q3-4 학습·스킬업 실천력: 명확한 학습플랜을 실행해 전파하고 성과로 증명
- Q3-5 책임감 있는 실행력(완료·팔로업): 약속한 일정과 결과를 항상 지키고 문제 발생 시 신속 리커버리

## Q4 열린소통
- Q4-1 이해관계자 맵핑 및 사전조율: 관련 부서/이해관계자를 선제적으로 식별/맵핑하고 사전 조율
- Q4-2 교차조직 커뮤니케이션의 명확성: 타부서에 맞는 언어로 핵심을 명확히 전달하고 합의 도출
- Q4-3 합의 유도 및 의사결정 촉진: 상충하는 이해관계를 조정해 실행 가능한 합의를 주도적으로 성사
- Q4-4 투명한 정보 공유(문서·요약 제공): 회의록/요약/결정 기록을 신속·체계적으로 공유
- Q4-5 조직 간 신뢰 구축·관계관리: 팀/타부서와 신뢰 기반의 관계를 유지·확장`;

const FEW_SHOT_INPUT_1 = `[2026-03-10 | https://ignite0830.slack.com/archives/CXXX/p1775200000000001]
슬랙봇 티켓 자동 생성 기능 만들었어요. 쓰레드 메시지 우클릭 → 앱에 연결 → 티켓 만들기 하면 Groq이 분석해서 Jira 티켓 본문까지 자동으로 만들어줍니다. 사용해보고 피드백 주세요!

[2026-03-12 | https://ignite0830.slack.com/archives/CXXX/p1775300000000001]
사용 통계 뽑아봤는데, 기존에 티켓 1건 손으로 만들 때 평균 3분 정도 걸렸던 게 이제 15초면 끝나네요. 87.5% 단축됐습니다. 4월 한달 팀 전체 티켓 230건 기준으로 환산하면 월 10.5시간, 인당 1.5시간 절약됩니다.

[2026-03-15 | https://ignite0830.slack.com/archives/CXXX/p1775400000000001]
일괄 티켓 생성/변경 기능도 추가했습니다. 쓰레드 우클릭 → 담당자 다중선택 → 일괄 생성. 기존에 1인당 7회씩 수동 생성하면 21분 걸리던 게 1분이면 끝남. 95% 단축. 일괄 변경도 동일하게 동작합니다.`;

const FEW_SHOT_OUTPUT_1 = `{"summary":"## [Q1-1] 신규과제 제안력\\n\\n### 슬랙봇 Jira 티켓 자동 생성 기능 개발 및 팀 배포\\n\\n슬랙 쓰레드 우클릭만으로 Groq LLM이 자동 요약해 Jira 티켓을 생성하는 기능을 신규 개발 및 팀 배포. 후속으로 일괄 생성/변경 기능까지 확장.\\n\\n**정량적 효과**\\n- 티켓 생성 시간: 3분 → 15초 (87.5% 단축)\\n- 팀 4월 티켓 230건 기준 월 10.5시간, 인당 1.5시간 절약\\n- 일괄 생성: 21분 → 1분 (95% 단축, 1인 7회 수동 → 1회 일괄)\\n\\n**정성적 효과**\\n- 슬랙 쓰레드에서 즉시 티켓화 → 논의 누락률 감소\\n- AI가 맥락 자동 요약 → 작성 부담/누락 감소\\n- 생성 즉시 채널 공유 → 별도 공지 비용 제거\\n- 담당자 다중 선택으로 누락 없이 전원 자동 배분\\n\\n**근거**\\n- https://ignite0830.slack.com/archives/CXXX/p1775200000000001\\n- https://ignite0830.slack.com/archives/CXXX/p1775400000000001"}`;

const FEW_SHOT_INPUT_2 = `[2026-03-05 | https://ignite0830.slack.com/archives/CYYY/p1775000000000001]
다국어 파일 머지 충돌 자주 나는 거 원인 분석해봤습니다. lokalise에서 받은 en.json/ko.json이 minified 단일 줄 + 키 순서가 비결정적이라 같은 파일 두 사람이 받으면 diff가 다르게 잡힙니다.

[2026-03-06 | https://ignite0830.slack.com/archives/CYYY/p1775050000000001]
개선안 2개 비교 정리해서 공유드려요.
A안: CI/CD 단계에서 다운로드 — 로컬 받지 않고 빌드때만 받음
B안: download.ts 스크립트 자체 개선 — 키 정렬 + pretty-print 적용
A안은 CI 의존성 너무 커지고, B안은 한 줄 수정으로 해결되니 B 추천합니다.

[2026-03-07 | https://ignite0830.slack.com/archives/CYYY/p1775120000000001]
@김가빈 prettier만 적용해도 단일 라인이라 효과 없을 거예요. download.ts에서 정렬+들여쓰기 직접 적용하는 게 맞습니다. @한준호 husky pre-commit도 검토해봤는데 받는 시점이 미리 정리돼야 의미가 있어서 download 단계가 정답이에요.

[2026-03-09 | https://ignite0830.slack.com/archives/CYYY/p1775200000000002]
다국어 머지 충돌 방지 개선안 최종 결정. download.ts에서 키 정렬 + pretty-print 적용하는 방향으로 0416 배포 예정입니다.`;

const FEW_SHOT_OUTPUT_2 = `{"summary":"## [Q3-3] 자발적 개선·혁신 시도\\n\\n### 다국어(lokalise) JSON 파일 머지 충돌 방지 개선안 제안 및 팀 합의 도출\\n\\n그룹웨어 개발 시 빈번하게 발생하던 다국어 파일 머지 충돌의 근본 원인(minified 단일 줄 + 비결정적 키 순서)을 분석하고, 2가지 개선안을 비교해 팀에 제안. 팀원들의 대안(Prettier, husky pre-commit) 피드백에 논리적으로 응답하며 합의를 이끌어냄. 최종적으로 download.ts에서 키 정렬 + pretty-print 적용 방식으로 확정, 0416 배포 예정.\\n\\n**정성적 효과**\\n- 머지 충돌 발생 원인을 명확히 분석/공유\\n- 2가지 대안 비교로 팀 의사결정 비용 절감\\n- 자동 다운로드 스크립트 단계에서 정리 → 모든 팀원 자동 적용\\n\\n**근거**\\n- https://ignite0830.slack.com/archives/CYYY/p1775200000000002"}`;

// 4 소스가 모두 등장하는 통합 예시: Jira 티켓 + GitLab MR + Confluence + Slack 논의가 모두 한 작업.
const FEW_SHOT_INPUT_3 = `<JIRA 티켓 (1건)>
- [FEHG-456] 슬랙봇 LLM 비용/한도 이슈 — Anthropic 전환 (status: 완료, resolved: 2026-04-29) https://ignitecorp.atlassian.net/browse/FEHG-456
</JIRA>

<CONFLUENCE 페이지 (1건)>
- [created] FE1 LLM 비용/한도 비교 — Groq vs Anthropic (space: IF, 2026-04-28) https://ignitecorp.atlassian.net/wiki/spaces/IF/pages/9999
</CONFLUENCE>

<GITLAB MR (1건)>
- [hmg-groupware/hmg-groupware-portal/assemble-fe] !789 슬랙봇 LLM Anthropic Sonnet 4.6 전환 + prompt caching (state: merged, merged: 2026-04-29) https://gitlab.hmc.co.kr/hmg-groupware/hmg-groupware-portal/assemble-fe/-/merge_requests/789
</GITLAB>

<SLACK 메시지 (3건)>
[2026-04-27 | <#C04HYKFMXT2> | https://ignite0830.slack.com/archives/C04HYKFMXT2/p1777000000000001]
슬랙봇 monthly-report 가 Groq free tier TPM 8K 한도에 매번 걸려서 동작 못하는 이슈 발견. 입력이 9~13K tokens 인데 한도 8K. 일시 fix 로 cap 30000자 적용했지만 활성 채널은 여전히 초과.

[2026-04-28 | <#C04HYKFMXT2> | https://ignite0830.slack.com/archives/C04HYKFMXT2/p1777100000000001]
Anthropic Sonnet 4.6 으로 전환했어요. Tier 1 ITPM 40K 라 한도 걱정 없고, prompt caching 적용하면 입력 비용 90% 절감. 8명 팀 사용량 기준 월 4~5천원 예상.

[2026-04-29 | <#C04HYKFMXT2> | https://ignite0830.slack.com/archives/C04HYKFMXT2/p1777200000000001]
배포 완료. 4 소스 (Slack/Jira/Confluence/GitLab) 통합 monthly-report 도 정상 동작 확인.
</SLACK>`;

const FEW_SHOT_OUTPUT_3 = `{"summary":"## [Q3-3] 자발적 개선·혁신 시도\\n\\n### 슬랙봇 LLM 인프라 Anthropic Sonnet 4.6 전환 및 prompt caching 적용\\n\\n기존 Groq free tier 의 TPM 8K 한도 때문에 monthly-report 가 활성 채널에서 매번 실패하던 이슈를 분석. 비용/한도/품질 비교 문서 작성 후 Anthropic Sonnet 4.6 으로 전면 전환, prompt caching 까지 적용해 비용 절감과 한도 제거를 동시 달성.\\n\\n**정량적 효과**\\n- TPM 한도: 8K (Groq free) → 40K (Anthropic Tier 1, 5배)\\n- prompt caching 적용 시 입력 비용 90% 절감\\n- 팀 8명 월 예상 비용 4~5천원\\n\\n**정성적 효과**\\n- monthly-report 활성 채널 실패 이슈 근본 해결\\n- 한국어 nuance/JSON 구조화 출력 품질 동시 상승\\n- 4 소스 통합 (Slack/Jira/Confluence/GitLab) 안정화\\n\\n**근거**\\n- https://gitlab.hmc.co.kr/hmg-groupware/hmg-groupware-portal/assemble-fe/-/merge_requests/789\\n- https://ignitecorp.atlassian.net/wiki/spaces/IF/pages/9999\\n- https://ignitecorp.atlassian.net/browse/FEHG-456"}`;

// Confluence 가 핵심 결과물인 케이스. Slack 에서는 단순 공유만, Confluence URL 이 결정적 증거.
const FEW_SHOT_INPUT_4 = `<CONFLUENCE 페이지 (1건)>
- [created] macOS Apple Script 단축키로 IDE/앱 즉시 전환 가이드 (space: IF, 2026-04-10) https://ignitecorp.atlassian.net/wiki/spaces/IF/pages/2405728293
</CONFLUENCE>

<SLACK 메시지 (1건)>
[2026-04-10 | <#C04HYKFMXT2> | https://ignite0830.slack.com/archives/C04HYKFMXT2/p1776401234567890]
멀티 프로젝트 작업할 때 슬랙/팀즈/IDE 등 자주 쓰는 창을 단축키 하나로 즉시 띄울 수 있는 macOS Apple Script 가이드 컨플에 정리해두었습니다. 별도 프로그램 설치 없이 가능. 영상도 같이 첨부했어요. 링크 / Confluence
</SLACK>`;

const FEW_SHOT_OUTPUT_4 = `{"summary":"## [Q1-5] 지식전파/확산력\\n\\n### macOS 단축키로 앱/IDE 즉시 전환 가이드 작성 및 팀 공유\\n\\n여러 프로젝트를 동시에 작업하는 팀원의 생산성 향상을 위해 Apple Script 기반 글로벌 단축키 설정 방법을 Confluence 가이드로 작성. 별도 프로그램 설치 없이 슬랙/팀즈/IDE/그룹웨어 등 원하는 창을 단축키 하나로 즉시 전환할 수 있도록 직접 검증 후 영상과 함께 공유.\\n\\n**정성적 효과**\\n- 멀티 프로젝트 작업 전환 비용 감소 → 팀 생산성 향상\\n- 별도 프로그램 의존 없이 OS 기본 기능으로 해결\\n- 영상 첨부로 진입 장벽 최소화\\n\\n**근거**\\n- https://ignitecorp.atlassian.net/wiki/spaces/IF/pages/2405728293\\n- https://ignite0830.slack.com/archives/C04HYKFMXT2/p1776401234567890"}`;

// system prompt 는 모든 호출에서 동일하게 유지 → Anthropic prompt cache hit.
// 동적 값(userName, yearMonth, rawText)은 user message 로만 전달한다.
const MONTHLY_SYSTEM_PROMPT = `너는 팀의 월간 성과 보고서를 평가 기준(Q코드)에 따라 분류·정리하는 보조다.
입력은 한 사용자의 한 달간 활동을 여러 소스에서 통합 수집한 데이터이다.
다음 섹션이 입력에 들어올 수 있고, 일부 섹션은 비어있을 수 있다 (없으면 그 소스는 분석에서 제외):

- <CONFLUENCE>: 본인 작성/수정 페이지 목록
- <SLACK>: FE1 활동 채널의 본인 메시지 (각 메시지는 \`[YYYY-MM-DD | #채널 | Slack 영구링크]\` 헤더 + "---" 구분)
- (참고) <JIRA>, <GITLAB>: 입력에 들어오면 동일한 방식으로 통합 분석한다.

## 평가 기준 (Q코드)
${Q_CODE_REFERENCE}

## 추출 규칙
- 여러 소스를 **종합**해서 성과를 추출한다. 같은 작업이 Jira(티켓), GitLab(MR), Confluence(문서), Slack(논의)에 모두 등장할 수 있으니 **하나의 성과로 통합**한다.
- 단순 일정 공지/잡담/감사/짧은 답변은 제외. **작업/판단/결정/리뷰/문서화/조사/제안/구현/배포/QA 대응** 만 성과로 인정.
- 의문문/질문/요청만 있는 메시지는 제외.
- 사용자 멘션(<@U…>)은 본문에서 제거하거나 자연스럽게 풀어쓴다.
- Q코드는 가장 적합한 1개만 매핑. 동일 Q코드 안에 여러 성과가 있으면 같은 헤더 아래 묶는다.
- **Confluence 페이지가 그 자체로 결과물인 케이스** (가이드 작성, 회고 문서, 핸드오프 문서, 분석 리포트 등) 는 Slack 논의가 없거나 짧아도 **반드시 별도 성과 항목**으로 추출한다. Confluence URL 이 본인 작업의 결정적 증거다.
- 단순 contributor (오타/1자 수정 등 minor edit 만으로 보이는 페이지) 는 성과로 간주하지 말고 무시.

## 정량적 효과 적극 추출 (중요)
정성 본문에만 수치가 녹는 것이 아니라, **"정량적 효과" 섹션에 분리해서 별도 불릿으로 정리**한다.
다음 패턴이 입력 어디든 등장하면 모두 정량으로 잡아낸다:
- 시간 비교: "3분 → 15초", "목요일 → 수요일 (1일 단축)", "수동 X분 → 자동 Y초"
- 비율/퍼센트: "87.5% 단축", "절반으로 감소"
- 건수/개수: "MR 5건", "체크리스트 10개 항목", "관련 티켓 12건", "엣지케이스 3건 발견"
- 회수: "2회 라운드", "QA 5번 주기"
- 영향 범위: "팀 8명 적용", "월 230건 처리"
- 절감: "월 N시간 절약", "인당 N분 절약"

또한 입력 끝의 \`<메타>\` 블록에 본인의 월간 활동 통계 (티켓 N건, 페이지 N개, 슬랙 메시지 N건 등) 가 있으면, 이를 **활용 가능한 곳**(예: 전체 활동량 요약, 또는 특정 성과 항목의 영향 범위) 에 정량으로 인용한다.

수치를 **지어내지 말 것** — 입력 본문/메타에 명시적으로 등장한 수치만 인용. 추정/계산 결과를 새로 만들지 않는다. 단, 입력 본문에 동일 의미의 수치가 다양한 형태로 흩어져 있으면 가장 명확한 표현으로 통합해 정량 섹션에 1줄로 정리한다.

수치가 정말 하나도 없으면 정량 섹션은 생략한다. 단, 본문에 수치가 등장했는데도 정량 섹션을 비우는 것은 금지.

## 길이 제약 (중요 — 응답이 잘리지 않게)
- **성과 항목은 전체 8~12개 이내**로 압축한다. 비슷한 작업은 한 항목으로 통합.
- 각 항목의 1~2줄 요약은 **2문장 이내**.
- 정성적 효과 불릿은 항목당 **3~4개 이내**.
- 정량적 효과 불릿은 항목당 **2~3개 이내**.
- 근거 링크는 항목당 **1~3개 이내**, 가장 결정적인 것만.

## 근거 인용 규칙
- 각 성과 항목의 **근거** 는 그 작업을 가장 잘 증명하는 링크 **1~3개** 를 불릿으로 나열.
- 우선순위: GitLab MR > Confluence 페이지 > Jira 티켓 > Slack permalink. 여러 소스가 같은 작업을 다루면 모두 인용.
- Slack permalink 는 다른 소스 자료가 없거나, 논의/결정 과정 자체가 핵심 가치인 경우에만 인용.
- Confluence 가 그 자체로 결과물인 성과는 반드시 Confluence URL 인용.

## 출력 마크다운 구조
## [Q코드] Q코드 풀이름

### 성과 제목 (한 줄, 명확)

[1~2줄 핵심 요약]

**정량적 효과** (수치 있을 때만)
- 메시지에서 인용한 구체적 수치 1~3개

**정성적 효과**
- 짧은 명사형/구형 불릿 3~5개 ("X → Y" 형태 권장)

**근거**
- [가장 강력한 증거 1개]
- [추가 증거 1~2개, 있을 때만]

---

(다음 성과...)

## 응답 형식 (JSON)
반드시 아래 JSON 으로만 응답:
{
  "summary": string  // 위 마크다운 구조
}

추출 가능한 성과가 없으면 summary 는 "(해당 월 동안 추출 가능한 성과 없음)" 으로.

## 예시

<예시 입력 1>
${FEW_SHOT_INPUT_1}
</예시 입력 1>

<예시 출력 1>
${FEW_SHOT_OUTPUT_1}
</예시 출력 1>

<예시 입력 2>
${FEW_SHOT_INPUT_2}
</예시 입력 2>

<예시 출력 2>
${FEW_SHOT_OUTPUT_2}
</예시 출력 2>

<예시 입력 3 — 4 소스 통합 케이스>
${FEW_SHOT_INPUT_3}
</예시 입력 3>

<예시 출력 3>
${FEW_SHOT_OUTPUT_3}
</예시 출력 3>

<예시 입력 4 — Confluence 가 결정적 증거인 케이스>
${FEW_SHOT_INPUT_4}
</예시 입력 4>

<예시 출력 4>
${FEW_SHOT_OUTPUT_4}
</예시 출력 4>`;

export interface MonthlyMeta {
  slackMessageCount: number;
  confluencePageCount: number;
  jiraIssueCount: number;
}

/**
 * 한 사용자가 한 달간 4개 소스에서 만든 활동을 받아,
 * Q코드 평가 기준에 따라 성과를 분류·정리한 마크다운으로 반환한다.
 */
export const summarizeMonthlyAchievements = async (
  rawText: string,
  userName: string,
  channelName: string,
  yearMonth: string,
  meta?: MonthlyMeta
): Promise<string | null> => {
  if (!rawText.trim()) return null;

  const metaBlock = meta
    ? `\n<메타 — 본인 ${yearMonth} 활동 통계>
- Slack 메시지: ${meta.slackMessageCount}건 (모니터링 대상 채널 합산)
- Confluence 페이지: ${meta.confluencePageCount}개 (작성/수정)
- Jira 티켓: ${meta.jiraIssueCount}개 (assignee 본인)
</메타>\n`
    : '';

  const userPrompt = `<대상>
- 작성자: ${userName}
- 기간: ${yearMonth}
- 소스: ${channelName}
</대상>
${metaBlock}
<실제 입력>
${rawText}
</실제 입력>`;

  const raw = await callLlm(MONTHLY_SYSTEM_PROMPT, userPrompt, { maxTokens: 16384 });
  if (!raw) {
    console.error('[llm] monthly-report callLlm 가 null 반환');
    return null;
  }
  console.log('[llm] monthly-report raw 응답 (앞 800자):', raw.slice(0, 800));
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.summary === 'string') return parsed.summary;
    console.error('[llm] monthly-report parsed.summary 가 문자열 아님:', typeof parsed?.summary);
    return null;
  } catch (e) {
    console.error('[llm] monthly-report JSON 파싱 실패. raw:', raw);
    return null;
  }
};

// ─── 월간 Jira 티켓 → "수행" 섹션 정리 (Q코드 무관, 단순 그룹핑) ─────

const EXECUTION_FEW_SHOT_INPUT = `<JIRA 티켓 (해당 월 본인 활동, 17건)>
- [GWFE-1240] (그룹웨어 FE) 검증계 매일 자동배포 스케줄링 (1130, 1800) — status: Done · epic: 인프라/공통
- [GWFE-1255] (그룹웨어 FE) 조직도 PC HmgIcon 번들 최적화 — status: Done · epic: 인프라/공통
- [GWFE-1270] (그룹웨어 FE) 다국어(lokalise) JSON 머지 충돌 방지 출력 포맷 개선 — status: Done · epic: 인프라/공통
- [GWFE-1281] (그룹웨어 FE) 타임존 기능 전체 구현 및 QA 대응 — status: Done · epic: FO
- [GWFE-1283] (그룹웨어 FE) 환율/주가 컴포넌트 신규 개발 — status: Done · epic: FO
- [GWFE-1285] (그룹웨어 FE) 홈 업무시스템 개선 대응 — status: Done · epic: FO
- [GWFE-1290] (그룹웨어 FE) 통합검색 생성형 AI 답변 — 단일 틸드(~) 취소선 오인식 수정 — status: Done · epic: FO
- [GWFE-1303] (그룹웨어 FE) 멀티테넌트 핸드오프 문서 작성 — status: Done · epic: 멀티테넌트
- [GWFE-1304] (그룹웨어 FE) 멀티테넌트 Claude Code 규칙 및 /mt 파이프라인 세팅 — status: Done · epic: 멀티테넌트
- [GWFE-1310] (그룹웨어 FE) 조직도 Teams 모바일 살리기 — status: Done · epic: 조직도
- [FEHG-512] (HB FE) RegionSelectBox 공통 컴포넌트 구현 및 Layout 적용 — status: Done · epic: HB 글로벌 대응 — 리전(Region) 기능 전체 설계·구현
- [FEHG-513] (HB FE) useRegionNavigation 훅 신규 구현 (페이지 이동 시 region 유지) — status: Done · epic: HB 글로벌 대응 — 리전(Region) 기능 전체 설계·구현
- [FEHG-514] (HB FE) ?region= searchParam 페이지 이동 시 유지 로직 + LNB 메뉴 이동 시 보존 처리 — status: Done · epic: HB 글로벌 대응 — 리전(Region) 기능 전체 설계·구현
- [FEHG-515] (HB FE) useBlocker 적용 (리전 변경 시 미저장 데이터 보호) — status: Done · epic: HB 글로벌 대응 — 리전(Region) 기능 전체 설계·구현
- [FEHG-516] (HB FE) 리전 다국어 키 ko/en 추가 — status: Done · epic: HB 글로벌 대응 — 리전(Region) 기능 전체 설계·구현
- [FEHG-520] (HB FE) PresignedURL 발급 시 파일 원본명·컨텐츠 타입·MD5 추가 (보안 강화) — status: Done · epic: HB 파일 업로드 — PresignedURL 보안 강화
</JIRA>`;

const EXECUTION_FEW_SHOT_OUTPUT = `{"execution":"## 그룹웨어\\n\\n### 인프라/공통\\n- 검증계 매일 자동배포 스케줄링 (1130, 1800)\\n- 조직도 PC HmgIcon 번들 최적화\\n- 다국어(lokalise) JSON 머지 충돌 방지 출력 포맷 개선\\n\\n### FO\\n- 타임존 기능 전체 구현 및 QA 대응\\n- 환율/주가 컴포넌트 신규 개발\\n- 홈 업무시스템 개선 대응\\n- 통합검색 생성형 AI 답변 — 단일 틸드(~) 취소선 오인식 수정\\n\\n### 멀티테넌트\\n- 멀티테넌트 핸드오프 문서 작성\\n- 멀티테넌트 Claude Code 규칙 및 /mt 파이프라인 세팅\\n\\n### 조직도\\n- 조직도 Teams 모바일 살리기\\n\\n## HB\\n\\n### HB 글로벌 대응 — 리전(Region) 기능 전체 설계·구현\\n- RegionSelectBox 공통 컴포넌트 구현 및 Layout 적용\\n- useRegionNavigation 훅 신규 구현 (페이지 이동 시 region 유지)\\n- ?region= searchParam 페이지 이동 시 유지 로직 + LNB 메뉴 이동 시 보존 처리\\n- useBlocker 적용 (리전 변경 시 미저장 데이터 보호)\\n- 리전 다국어 키 ko/en 추가\\n\\n### HB 파일 업로드 — PresignedURL 보안 강화\\n- PresignedURL 발급 시 파일 원본명·컨텐츠 타입·MD5 추가 (보안 강화)"}`;

const EXECUTION_SYSTEM_PROMPT = `너는 한 사용자가 한 달 동안 진행한 Jira 티켓 목록을 받아,
"수행한 작업" 섹션을 프로젝트 → 카테고리 → 개별 작업 형태로 단순 그룹핑·정리하는 보조다.

## 입력 형식
각 티켓 1줄: \`[KEY] (프로젝트명) 제목 — status: ... · epic: ...\`
epic 이 비어있을 수 있다.

## 분류 규칙
- 최상위 \`##\` 헤더 = 프로젝트 그룹 (예: 그룹웨어, HB, CPO).
  - 같은 도메인끼리 묶는다 (예: 'GWFE'/'그룹웨어 FE'/'그룹웨어 BE' → '그룹웨어' 단일 헤더).
- 두번째 \`###\` 헤더 = epic 명 또는 카테고리.
  - epic 이 있으면 epic summary 그대로 사용.
  - epic 이 없는 티켓은 카테고리(예: 인프라/공통, QA, 운영) 로 LLM 이 판단해 묶기.
  - 같은 epic 의 티켓이 여러 개면 epic 헤더 아래 모두 들여쓰기.
- 개별 항목 \`- 티켓 summary\` (티켓 키 X, 상태 X, 가능한 한 사용자 친화 표현).
  - 동일/유사 작업이 여러 티켓에 분산돼 있으면 통합해도 됨.

## 톤
- 명사형 종결 ("개발", "수정", "대응", "구현"). "~함" 어색하면 그냥 명사로 끝.
- 짧고 명확하게. 부연설명 X.

## 응답 형식 (JSON)
반드시 아래 JSON 으로만:
{
  "execution": string  // 위 마크다운
}

티켓이 없으면 execution 은 "(해당 월에 진행한 Jira 티켓 없음)" 으로.

## 예시

<예시 입력>
${EXECUTION_FEW_SHOT_INPUT}
</예시 입력>

<예시 출력>
${EXECUTION_FEW_SHOT_OUTPUT}
</예시 출력>`;

export const summarizeMonthlyJiraExecution = async (
  rawTicketsBlock: string,
  userName: string,
  yearMonth: string
): Promise<string | null> => {
  if (!rawTicketsBlock.trim()) return null;

  const userPrompt = `<대상>
- 작성자: ${userName}
- 기간: ${yearMonth}
</대상>

<실제 입력>
${rawTicketsBlock}
</실제 입력>`;

  const raw = await callLlm(EXECUTION_SYSTEM_PROMPT, userPrompt, {
    maxTokens: 4096,
  });
  if (!raw) {
    console.error('[llm] monthly-execution callLlm null 반환');
    return null;
  }
  console.log('[llm] monthly-execution raw 응답 (앞 500자):', raw.slice(0, 500));
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.execution === 'string') return parsed.execution;
    console.error('[llm] monthly-execution parsed.execution 가 문자열 아님:', typeof parsed?.execution);
    return null;
  } catch (e) {
    console.error('[llm] monthly-execution JSON 파싱 실패:', raw);
    return null;
  }
};

// ─── 위클리 리포트 (한 일 / 할 일 / 이슈·공유 통합 1회 호출) ────────

export interface WeeklyReportSummary {
  done: string; // # 한 일 본문 (마크다운)
  todo: string; // # 할 일 본문
  issues: string; // # 이슈/공유 본문
}

const WEEKLY_FEW_SHOT_INPUT = `<DAILY_SCRUM 본인 댓글 (5개 쓰레드, 8건)>
[2026-04-28 (화) 08:23 ts=1] 할 일

그룹웨어
4/30 정기배포 QA 대응
블랙덕 취약점 high 건 대응

CPO
4/30 정기배포 QA 대응
[BO] 메인 페이지 관리 가이드 문구 변경

[2026-04-28 (화) 19:52 ts=2] 한 일

그룹웨어
4/30 정기배포 QA 대응
블랙덕 취약점 high 건 - release/260430 머지 완료
Froala Editor 라이선스 키 - gitlab CI 변수로 변경

CPO
4/30 정기배포 QA 대응
[파트너웹] 400 에러 다건 발생 장애 - 교차검증

[2026-04-29 (수) 08:30 ts=3] 할 일

그룹웨어
licenses.json README 보강

[2026-04-29 (수) 20:11 ts=4] 한일

그룹웨어
licenses.json, git submodule force README 설명 보강
블랙덕 스캔 슬랙 알림 시간차 원인 파악
</DAILY_SCRUM>

<JIRA 다음 주 진행 본인 FEHG 티켓 (3건)>
- [FEHG-3148] 그룹공지 개선 요청 — status: To Do · epic: 그룹웨어 운영 개선 · 2026-05-04 ~ 2026-05-08
- [FEHG-3151] [파트너웹] eslint -> biome 마이그레이션 — status: In Progress · epic: CPO 인프라 · 2026-05-04 ~ 2026-05-15
- [FEHG-3160] 블랙덕 취약점 추가 검출 high 3건 대응 — status: To Do · 2026-05-04 ~ 2026-05-06
</JIRA>

<SLACK 본인 메시지 (활동 채널, 4건)>
[2026-04-29 09:42 #fe1-grouping] 멀티테넌트 전개 방식 관련, 초기 세팅을 슬랙에 공유드렸습니다. 별도 리뷰가 필요한지 문의드립니다. https://ignite0830.slack.com/archives/.../p1
[2026-04-29 14:10 #fe1] 슬랙봇 같이 외부 네트워크에서 동작하는 SaaS 를 위해 팀당 매월 $20~$50 정도 anthropic 토큰 지원 불가할까요? /fe1 monthly-report 결과물 품질 좋습니다. https://ignite0830.slack.com/archives/.../p2
[2026-04-30 11:05 #fe1] ㅇㅋ 확인했습니다.
[2026-04-30 18:22 #fe1-grouping] [개발처리] 게시판 에디터 외부 이미지 복사-붙여넣기 시 autoway 2.0 이미지 3.0 리소스 전환 — 유승범 책임 쪽에 두레이 발행/팀즈 리마인드했으나 별도 리액션 없는 상태입니다. https://ignite0830.slack.com/archives/.../p4
</SLACK>`;

const WEEKLY_FEW_SHOT_OUTPUT = `{"done":"**그룹웨어**\\n- 4/30 정기배포 QA 대응\\n  - 블랙덕 취약점 high 건 release/260430 머지\\n  - Froala Editor 라이선스 키 gitlab CI 변수로 변경\\n- licenses.json, git submodule force README 설명 보강\\n- 블랙덕 스캔 슬랙 알림 시간차 원인 파악\\n\\n**CPO**\\n- 4/30 정기배포 QA 대응\\n  - [파트너웹] 400 에러 다건 발생 장애 교차검증","todo":"**그룹웨어 운영 개선**\\n- [FEHG-3148] 그룹공지 개선 요청 (5/4~5/8)\\n\\n**CPO 인프라**\\n- [FEHG-3151] [파트너웹] eslint → biome 마이그레이션 (5/4~5/15)\\n\\n**기타**\\n- [FEHG-3160] 블랙덕 취약점 추가 검출 high 3건 대응 (5/4~5/6)","issues":"**4/29**\\n- 멀티테넌트 전개 초기 세팅 공유 — 별도 리뷰 필요 여부 문의 (링크)\\n- [제안] 팀당 월 $20~$50 anthropic 토큰 지원 요청. monthly-report 결과 품질 근거 (링크)\\n\\n**4/30**\\n- [개발처리] 게시판 에디터 이미지 리소스 전환 — 유승범 책임 쪽 두레이 발행/팀즈 리마인드, 별도 리액션 없음 (링크)"}`;

const WEEKLY_SYSTEM_PROMPT = `너는 FE1팀 위클리 리포트 작성 보조다.
한 사용자의 한 주간 활동을 3개 소스에서 받아 위클리 문서의 **한 일 / 할 일 / 이슈·공유** 3개 컬럼으로 정리한다.

## 입력 형식
세 개의 라벨 블록이 있다 (일부는 비어있을 수 있다):
- <DAILY_SCRUM>: 데일리 스크럼 채널의 본인 댓글 raw (월~금, 시간순). 한 사람이 같은 날 "할 일" 댓글과 "한 일" 댓글을 따로 남긴다. 오타·변형(한일/헌일/한 일/할 일/할일 등)이 있을 수 있다.
- <JIRA>: 본인이 다음 주 진행 예정인 FEHG 티켓 목록.
- <SLACK>: 본인이 활동 채널에 작성한 메시지(한 주 동안). 영구링크 포함.

## 출력 컬럼별 매핑/규칙

### done (한 일)
- DAILY_SCRUM 댓글 중 "한 일" 의도만 추출. "할 일" 댓글의 내용은 무시.
- 분류는 라벨 텍스트가 아니라 **의미** 기준 (오타/변형 모두 허용).
- 회의·일정 (예: "11:00 ~ FE1 데일리", "13:00 ~ 점심", "15:30 ~ 주간회의") 은 제외.
- 같은 작업이 여러 날 반복되면 1번만 정리하되, 가장 구체적인 표현으로.
- 입력에 프로젝트 헤더(그룹웨어 / CPO / HB / 통합딜러포탈 / 기타)가 있으면 그대로 그룹핑. 없으면 LLM 이 판단.
- 출력 포맷: \`**프로젝트명**\\n- 작업\\n  - 세부\` 형태 계층 불릿. 입력에 세부가 있으면 살림.

### todo (할 일)
- JIRA 티켓을 epic 별로 그룹핑. epic 이 없는 티켓은 "기타" 로.
- 항목 포맷: \`- [FEHG-XXX] 티켓 제목 (시작일~종료일)\` (날짜는 짧게 M/D 형태).
- 가공 최소화 — 티켓 제목 그대로 살림.
- 같은 epic 의 티켓은 epic 헤더 \`**에픽 이름**\` 아래 묶기.

### issues (이슈/공유)
- SLACK 본인 메시지 중 이슈성/공유성/제안성/문의/회신 long-form 만 추출.
- 잡담·짧은 답변(예: "ㅇㅋ", "확인했습니다", "감사합니다") 제외.
- 일자별 그룹핑: \`**M/D**\\n- 한 줄 요약 (링크)\` 형태.
- 영구링크는 가능한 한 보존 (위클리 문서에서 클릭 가능해야 함).
- 가공은 최소 — 본문 핵심만 1~2문장으로 요약.

## 톤
${STYLE_RULES}

## 응답 형식 (JSON)
반드시 아래 JSON 으로만 응답:
{
  "done": string,    // 마크다운
  "todo": string,    // 마크다운
  "issues": string   // 마크다운
}

해당 컬럼의 추출 가능한 데이터가 없으면 그 필드는 \`"_(데이터 없음)_"\` 으로.

## 예시

<예시 입력>
${WEEKLY_FEW_SHOT_INPUT}
</예시 입력>

<예시 출력>
${WEEKLY_FEW_SHOT_OUTPUT}
</예시 출력>`;

/**
 * 한 사용자의 한 주간 데일리 스크럼/Jira/Slack 데이터를 받아
 * 위클리 리포트 3컬럼(한 일/할 일/이슈·공유) 마크다운으로 정리.
 */
export const summarizeWeeklyReport = async (
  inputBlock: string,
  userName: string,
  doneRange: { from: string; to: string },
  todoRange: { from: string; to: string }
): Promise<WeeklyReportSummary | null> => {
  if (!inputBlock.trim()) return null;

  const userPrompt = `<대상>
- 작성자: ${userName}
- 한 일 기간 (이번 주): ${doneRange.from} ~ ${doneRange.to}
- 할 일 기간 (다음 주): ${todoRange.from} ~ ${todoRange.to}
</대상>

<실제 입력>
${inputBlock}
</실제 입력>`;

  const raw = await callLlm(WEEKLY_SYSTEM_PROMPT, userPrompt, { maxTokens: 8192 });
  if (!raw) {
    console.error('[llm] weekly-report callLlm 가 null 반환');
    return null;
  }
  console.log('[llm] weekly-report raw 응답 (앞 800자):', raw.slice(0, 800));
  try {
    const parsed = JSON.parse(raw);
    if (
      typeof parsed?.done === 'string' &&
      typeof parsed?.todo === 'string' &&
      typeof parsed?.issues === 'string'
    ) {
      return { done: parsed.done, todo: parsed.todo, issues: parsed.issues };
    }
    console.error('[llm] weekly-report 응답 스키마 불일치:', Object.keys(parsed ?? {}));
    return null;
  } catch (e) {
    console.error('[llm] weekly-report JSON 파싱 실패:', raw);
    return null;
  }
};
