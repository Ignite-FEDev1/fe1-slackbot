import axios from 'axios';

// Groq 는 OpenAI 호환 API. 무료 티어 제공.
// 모델 선택: https://console.groq.com/docs/models
const GROQ_MODEL = 'llama-3.3-70b-versatile';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

interface GroqResponse {
  choices?: Array<{
    message?: { content?: string };
  }>;
}

/**
 * Groq Chat Completions 호출. JSON 모드로 요청한다.
 */
const callGroq = async (
  systemPrompt: string,
  userPrompt: string
): Promise<string | null> => {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    console.error('[llm] GROQ_API_KEY 가 설정되지 않았습니다.');
    return null;
  }

  try {
    const res = await axios.post<GroqResponse>(
      GROQ_URL,
      {
        model: GROQ_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' },
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 20000,
      }
    );

    return res.data.choices?.[0]?.message?.content ?? null;
  } catch (e: any) {
    console.error('[llm] Groq 호출 실패:', e?.response?.data || e?.message);
    return null;
  }
};

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

/**
 * 쓰레드 메시지들 + 담당자/추가 지시사항 컨텍스트를 받아서
 * Jira 티켓의 제목과 본문 초안을 생성한다.
 *
 * 한 쓰레드 안에 여러 역할(FE/BE/디자인 등)의 작업이 섞여있을 수 있으므로,
 * 담당자 관점에서 해당 인물이 해야 할 작업만 추출하도록 프롬프트를 구성한다.
 */
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
  const contextBlock = contextLines.length
    ? `\n<컨텍스트>\n${contextLines.join('\n')}\n</컨텍스트>\n`
    : '';

  const system = `너는 소프트웨어 팀의 Jira 티켓 작성 보조다.
입력된 Slack 쓰레드 대화를 읽고, 논의에서 도출된 작업을 하나의 Jira Task 로 정리한다.

## 가장 중요한 원칙
티켓은 **이 쓰레드를 보지 못한 다른 팀원이 읽어도 어떤 작업을 어떻게 해야 할지 이해할 수 있도록** 자립적으로(self-contained) 작성되어야 한다.
- "위에서 얘기한 그것", "아까 그 버그", "앞서 논의한 방식" 같이 쓰레드 컨텍스트에 의존하는 표현 금지.
- 쓰레드에서 당연시된 용어/약어/시스템명이 있다면 한 번은 풀어서 써라.
- 읽는 사람이 "이 화면이 뭔지, 왜 해야 하는지, 어디를 어떻게 바꿔야 하는지" 정도는 티켓만 보고 알 수 있어야 한다.
- 단, 대화에 없는 정보를 지어내지는 말 것. 명확하지 않은 부분은 참고 섹션에 "명확히 할 것" 으로 남겨라.

## 응답 형식
반드시 아래 JSON 스키마로만 응답하라:
{
  "title": string,        // 한국어, 60자 이내, 동사로 시작. 무엇을 하는지 한 줄에 드러나야 함
  "description": string   // 한국어 markdown
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

각 섹션 내용은 불릿(-)으로 작성한다.
컨텍스트에 담당자가 명시되어 있으면, 담당자의 관점에서 해당 인물이 할 작업만 제목/본문에 담아라.`;

  const user = `${contextBlock}<쓰레드>
${conversation}
</쓰레드>`;

  const raw = await callGroq(system, user);
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
    console.error('[llm] Groq 응답 JSON 파싱 실패:', raw);
  }
  return null;
};

export interface BatchSummarizeContext {
  /** 담당자 수 (프롬프트 안내용) */
  assigneeCount?: number;
  /** 사용자가 추가로 넣는 지시사항 */
  instructions?: string;
}

/**
 * 배치 티켓용 요약. 여러 명에게 "동일한" 티켓이 복제되어 할당되는 상황.
 * - 단일 담당자 관점이 아닌, "모두가 함께/각자 수행할 공통 작업" 관점으로 요약한다.
 * - 특정 사람 이름을 본문에 넣지 않는다.
 */
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
  const contextBlock = contextLines.length
    ? `\n<컨텍스트>\n${contextLines.join('\n')}\n</컨텍스트>\n`
    : '';

  const system = `너는 소프트웨어 팀의 Jira 티켓 작성 보조다.
입력된 Slack 쓰레드 대화를 읽고, 여러 팀원이 공통으로 수행할 작업을 하나의 Jira Task 로 정리한다.
이 티켓은 동일한 내용으로 N명에게 각각 복제되어 할당되며, 할당받은 사람 모두가 (함께 또는 각자 동일하게) 수행해야 하는 작업이다.
(예: 배포 모니터링, 공통 환경 설정, 일괄 이슈 점검, 공지 숙지 등)

## 가장 중요한 원칙
티켓은 **이 쓰레드를 보지 못한 다른 팀원이 읽어도 어떤 작업을 어떻게 해야 할지 이해할 수 있도록** 자립적으로(self-contained) 작성되어야 한다.
- "위에서 얘기한 그것", "아까 그 일정" 같이 쓰레드 컨텍스트에 의존하는 표현 금지.
- 쓰레드에서 당연시된 용어/약어/시스템명이 있다면 한 번은 풀어서 써라.
- 읽는 사람이 "이 작업을 언제, 어디서, 어떻게 수행해야 하는지" 를 티켓만 보고 알 수 있어야 한다.
- 대화에 없는 정보를 지어내지 말 것. 불확실한 점은 참고 섹션에 "명확히 할 것" 으로 남겨라.

## 배치 티켓 작성 규칙
- 제목과 본문에 **특정 인물 이름을 넣지 말 것**. "모두가 해야 할 일" 관점으로 작성.
- 제목은 공통 작업이 무엇인지 한 줄로 드러나야 함. (예: "6월 정기배포 모니터링", "신규 스프린트 보드 확인")
- 본문의 "작업 내용" 섹션은 할당받은 각자가 수행해야 할 구체적 액션 아이템으로 구성.
- 동시 수행인지 / 각자 수행인지 / 순차 수행인지 가능한 한 명확히 기술.

## 응답 형식
반드시 아래 JSON 스키마로만 응답하라:
{
  "title": string,        // 한국어, 60자 이내, 동사로 시작. 공통 작업이 무엇인지 드러나야 함
  "description": string   // 한국어 markdown
}

description 은 다음 섹션을 반드시 포함한다:
## 배경
- 이 공통 작업이 왜 필요한지, 어떤 이벤트/일정에서 출발했는지
- 관련된 시스템/대상 범위

## 작업 내용
- 할당받은 사람이 각자 수행해야 할 구체 액션 (체크리스트 형태)
- 시점(언제), 대상(어디/무엇을), 방법(어떻게) 을 가능한 한 구체적으로

## 참고
- 제약사항, 관련 링크, 결정사항, 아직 불확실한 점`;

  const user = `${contextBlock}<쓰레드>
${conversation}
</쓰레드>`;

  const raw = await callGroq(system, user);
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
    console.error('[llm] Groq (batch) 응답 JSON 파싱 실패:', raw);
  }
  return null;
};
