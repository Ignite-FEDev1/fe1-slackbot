import Anthropic from '@anthropic-ai/sdk';
import axios from 'axios';

// 모델 별칭 (벤더/버전 변경 시 이 상수만 갱신).
// 현재 매핑: 한국어 nuance + 구조화 추출 정확도 기준 Sonnet 4.6 / Haiku 4.5 / Opus 4.7.
export const MODEL_DEFAULT = 'claude-sonnet-4-6';
export const MODEL_FAST = 'claude-haiku-4-5-20251001';
export const MODEL_PREMIUM = 'claude-opus-4-7';

let _client: Anthropic | null = null;
const getClient = (): Anthropic => {
  if (_client) return _client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY 미설정');
  // SDK 기본 timeout 은 10분. Lambda timeout(240s) 보다 짧게 두어 명확히 fail-fast.
  _client = new Anthropic({ apiKey, timeout: 200 * 1000, maxRetries: 1 });
  return _client;
};

export interface LlmOptions {
  model?: string;
  maxTokens?: number;
  /** system 프롬프트를 prompt cache 에 올림 (5분 TTL, 입력 90% 할인) */
  cacheSystem?: boolean;
}

/**
 * 응답 텍스트에서 JSON 객체만 안전하게 추출.
 * 1. 그대로 JSON.parse 시도 (모델이 깨끗한 JSON 반환한 경우)
 * 2. 마크다운 코드 펜스(```json ... ```) 안의 본문으로 시도 (closing 있을 때)
 * 3. 시작 펜스만 있고 closing 없을 때 (max_tokens 잘림) — 펜스 이후 끝까지로 시도
 * 4. balanced brace scanner — 첫 균형 객체 추출
 * 5. 마지막 fallback: truncated JSON 자동 복구 (문자열 닫고 잠긴 객체 닫아 파싱 가능하게)
 */
const extractJsonObject = (text: string): string => {
  const trimmed = text.trim();
  if (canParse(trimmed)) return trimmed;

  // 2) closed fence
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    const inner = fence[1].trim();
    if (canParse(inner)) return inner;
    const repaired = tryRepairTruncatedJson(inner);
    if (repaired && canParse(repaired)) return repaired;
  }

  // 3) unclosed fence (응답이 max_tokens 에서 잘림)
  const openFence = trimmed.match(/```(?:json)?\s*([\s\S]*)$/);
  if (openFence) {
    const inner = openFence[1].trim();
    if (canParse(inner)) return inner;
    const repaired = tryRepairTruncatedJson(inner);
    if (repaired && canParse(repaired)) return repaired;
  }

  // 4) balanced brace scanner
  const scanned = scanBalancedObject(trimmed);
  if (scanned && canParse(scanned)) return scanned;

  // 5) truncated JSON 복구 시도 (전체 본문 대상)
  const repaired = tryRepairTruncatedJson(trimmed);
  if (repaired && canParse(repaired)) return repaired;

  return trimmed;
};

/**
 * max_tokens 한도로 잘린 JSON 을 부분 복구.
 * 첫 `{` 부터 시작해 문자열/배열/객체 깊이를 추적, 잘린 위치에서:
 * - 미완성 문자열은 `"` 로 닫고
 * - 열린 배열/객체는 `]` `}` 로 닫는다.
 * 결과로 마지막 정상 key/value 까지의 부분 JSON 을 반환 (파싱 가능하면).
 */
const tryRepairTruncatedJson = (s: string): string | null => {
  const start = s.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  const stack: ('}' | ']')[] = [];
  let inString = false;
  let escape = false;
  // 마지막으로 `,` 나 key:value 종료점 직후 위치를 기억해 잘린 곳을 그 위치로 되감기
  let safeEnd = -1;

  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (c === '\\') {
        escape = true;
        continue;
      }
      if (c === '"') {
        inString = false;
      }
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === '{') {
      stack.push('}');
      depth++;
    } else if (c === '[') {
      stack.push(']');
      depth++;
    } else if (c === '}' || c === ']') {
      if (stack[stack.length - 1] === c) {
        stack.pop();
        depth--;
        if (depth === 0) {
          // 끝까지 정상 닫힘 → 그 위치까지 substring
          return s.slice(start, i + 1);
        }
      }
    } else if (c === ',' && depth >= 1) {
      safeEnd = i; // 안전 절단 지점
    }
  }

  // 여기 도달 = JSON 이 완전히 닫히지 않음 → 복구 시도
  let body = safeEnd > start ? s.slice(start, safeEnd) : s.slice(start);
  // 미완성 문자열이면 닫아준다
  if (inString) body += '"';
  // 미닫힘 stack 닫기
  while (stack.length > 0) {
    const closer = stack.pop()!;
    body += closer;
  }
  return body;
};

const canParse = (s: string): boolean => {
  try {
    const v = JSON.parse(s);
    return typeof v === 'object' && v !== null;
  } catch {
    return false;
  }
};

/** 문자열 리터럴/escape 인식하는 brace 카운터로 첫 번째 balanced 객체 반환. */
const scanBalancedObject = (s: string): string | null => {
  const start = s.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (c === '\\' && inString) {
      escape = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
};

/**
 * LLM 호출 (현 구현체: Anthropic Messages API).
 * - 입력: system + user 텍스트
 * - 출력: 응답 텍스트에서 추출한 JSON 문자열 또는 null
 * - 일부 신형 모델(Sonnet 4.6 등)이 assistant prefill 을 거부하므로 프리필 미사용
 */
export const callLlm = async (
  systemPrompt: string,
  userPrompt: string,
  options: LlmOptions = {}
): Promise<string | null> => {
  const model = options.model ?? MODEL_DEFAULT;
  const maxTokens = options.maxTokens ?? 4096;
  const cacheSystem = options.cacheSystem ?? true;

  try {
    const client = getClient();
    const res = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system: cacheSystem
        ? [
            {
              type: 'text',
              text: systemPrompt,
              cache_control: { type: 'ephemeral' },
            },
          ]
        : systemPrompt,
      messages: [
        {
          role: 'user',
          content:
            userPrompt +
            '\n\n응답은 반드시 유효한 JSON 객체 하나로만 출력하라. 마크다운 코드 펜스, 설명, 인사말 등 다른 텍스트를 절대 포함하지 마라.',
        },
      ],
    });

    const usage = res.usage;
    if (usage) {
      console.log(
        `[llm] usage (model=${model}): input=${usage.input_tokens}, output=${usage.output_tokens}, cache_read=${usage.cache_read_input_tokens ?? 0}, cache_create=${usage.cache_creation_input_tokens ?? 0}`
      );
    }

    const block = res.content.find((b) => b.type === 'text');
    if (!block || block.type !== 'text') {
      console.error('[llm] 응답에 text 블록 없음');
      return null;
    }

    return extractJsonObject(block.text);
  } catch (e: any) {
    console.error(
      `[llm] LLM 호출 실패 (model=${model}):`,
      e?.status,
      e?.message || e
    );
    return null;
  }
};

// ─── Groq (OpenAI 호환 REST) — 빠른 응답이 중요한 동기 경로용 ─────
//
// 티켓 만들기/일괄 티켓 만들기처럼 슬랙 모달이 LLM 응답을 기다리는 동기 흐름은
// API Gateway 30초 한도 안에 모달 update 까지 끝나야 한다.
// Anthropic Sonnet 보다 Groq Llama 가 응답 latency 가 짧아 이 경로에 사용.

const GROQ_MODEL = 'llama-3.3-70b-versatile';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

interface GroqResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

/**
 * Groq Chat Completions 호출. JSON 모드로 요청한다.
 * 반환은 JSON 문자열 (본문) — 호출자가 JSON.parse 한다.
 */
export const callGroq = async (
  systemPrompt: string,
  userPrompt: string
): Promise<string | null> => {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    console.error('[llm] GROQ_API_KEY 미설정');
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
    const u = res.data.usage;
    if (u) {
      console.log(
        `[llm] groq usage (model=${GROQ_MODEL}): prompt=${u.prompt_tokens ?? 0}, completion=${u.completion_tokens ?? 0}, total=${u.total_tokens ?? 0}`
      );
    }
    return res.data.choices?.[0]?.message?.content ?? null;
  } catch (e: any) {
    console.error(
      '[llm] Groq 호출 실패:',
      e?.response?.status,
      e?.response?.data || e?.message
    );
    return null;
  }
};
