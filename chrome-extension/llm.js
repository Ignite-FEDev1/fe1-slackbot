// Anthropic Claude Messages API 직접 호출 모듈.
// 호출 실패 시 throw 만 하고, 폴백 처리는 popup.js 에서 담당한다.
// 401/403 은 키 설정 문제이므로 isAuthError 로 표시한다.

(function (global) {
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

  const buildContextBlock = (lines) =>
    lines.length ? `\n<컨텍스트>\n${lines.join('\n')}\n</컨텍스트>\n` : '';

  const buildSystemPrompt = () => `너는 소프트웨어 팀의 Jira 티켓 작성 보조다.
사용자가 웹 페이지에서 선택(블록 지정)한 텍스트를 읽고, 해당 내용에서 도출된 작업을 하나의 Jira Task 로 정리한다.
입력 텍스트는 Confluence 댓글, 기획서, 회의록, 이메일 등 다양한 소스일 수 있다.

${STYLE_RULES}

${SELF_CONTAINED_RULES}

${RESPONSE_FORMAT}
컨텍스트에 담당자가 명시되어 있으면, 담당자의 관점에서 해당 인물이 할 작업만 제목/본문에 담아라.`;

  // ─── JSON 추출/복구 ────────────────────────────────────────────

  const canParse = (s) => {
    try {
      const v = JSON.parse(s);
      return typeof v === 'object' && v !== null;
    } catch { return false; }
  };

  const tryRepairTruncatedJson = (s) => {
    const start = s.indexOf('{');
    if (start === -1) return null;
    let depth = 0;
    const stack = [];
    let inString = false;
    let escape = false;
    let safeEnd = -1;
    for (let i = start; i < s.length; i++) {
      const c = s[i];
      if (escape) { escape = false; continue; }
      if (inString) {
        if (c === '\\') { escape = true; continue; }
        if (c === '"') { inString = false; }
        continue;
      }
      if (c === '"') { inString = true; continue; }
      if (c === '{') { stack.push('}'); depth++; }
      else if (c === '[') { stack.push(']'); depth++; }
      else if (c === '}' || c === ']') {
        if (stack[stack.length - 1] === c) {
          stack.pop();
          depth--;
          if (depth === 0) return s.slice(start, i + 1);
        }
      } else if (c === ',' && depth >= 1) {
        safeEnd = i;
      }
    }
    let body = safeEnd > start ? s.slice(start, safeEnd) : s.slice(start);
    if (inString) body += '"';
    while (stack.length > 0) body += stack.pop();
    return body;
  };

  const scanBalancedObject = (s) => {
    const start = s.indexOf('{');
    if (start === -1) return null;
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < s.length; i++) {
      const c = s[i];
      if (escape) { escape = false; continue; }
      if (c === '\\' && inString) { escape = true; continue; }
      if (c === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) return s.slice(start, i + 1);
      }
    }
    return null;
  };

  const extractJsonObject = (text) => {
    const trimmed = text.trim();
    if (canParse(trimmed)) return trimmed;

    const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) {
      const inner = fence[1].trim();
      if (canParse(inner)) return inner;
      const r = tryRepairTruncatedJson(inner);
      if (r && canParse(r)) return r;
    }

    const open = trimmed.match(/```(?:json)?\s*([\s\S]*)$/);
    if (open) {
      const inner = open[1].trim();
      if (canParse(inner)) return inner;
      const r = tryRepairTruncatedJson(inner);
      if (r && canParse(r)) return r;
    }

    const scanned = scanBalancedObject(trimmed);
    if (scanned && canParse(scanned)) return scanned;

    const repaired = tryRepairTruncatedJson(trimmed);
    if (repaired && canParse(repaired)) return repaired;

    return trimmed;
  };

  // ─── Anthropic 호출 ────────────────────────────────────────────

  class LLMError extends Error {
    constructor(message, { status, isAuthError } = {}) {
      super(message);
      this.name = 'LLMError';
      this.status = status;
      this.isAuthError = !!isAuthError;
    }
  }

  const parseTicketDraft = (raw) => {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed?.title === 'string' && typeof parsed?.description === 'string') {
        return { title: parsed.title, description: parsed.description };
      }
    } catch (e) {
      console.error('[anthropic] 응답 JSON 파싱 실패:', raw);
    }
    return null;
  };

  const callAnthropic = async (systemPrompt, userPrompt) => {
    const apiKey = CONFIG.ANTHROPIC_API_KEY;
    const model = CONFIG.ANTHROPIC_MODEL;

    if (!apiKey) {
      throw new LLMError('ANTHROPIC_API_KEY 미설정 (config.js 확인)', { isAuthError: true });
    }

    let res;
    try {
      res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model,
          max_tokens: 4096,
          system: systemPrompt,
          messages: [{
            role: 'user',
            content: userPrompt + '\n\n응답은 반드시 유효한 JSON 객체 하나로만 출력하라. 마크다운 코드 펜스, 설명, 인사말 등 다른 텍스트를 절대 포함하지 마라.',
          }],
        }),
      });
    } catch (e) {
      throw new LLMError(`네트워크 오류: ${e.message}`);
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`[anthropic] HTTP ${res.status} body=${body.slice(0, 500)}`);
      if (res.status === 401 || res.status === 403) {
        throw new LLMError(`Anthropic 인증 실패 (${res.status}): API 키 확인`, {
          status: res.status,
          isAuthError: true,
        });
      }
      throw new LLMError(`Anthropic HTTP ${res.status}: ${body.slice(0, 200)}`, { status: res.status });
    }

    const data = await res.json();
    const block = (data.content || []).find((b) => b.type === 'text');
    if (!block || !block.text) {
      throw new LLMError('Anthropic 응답에 text 블록 없음');
    }
    return extractJsonObject(block.text);
  };

  // ─── 외부 노출 API ────────────────────────────────────────────

  global.LLMError = LLMError;

  global.summarizeViaLLM = async (text, ctx = {}) => {
    if (!text || !text.trim()) return null;

    const contextLines = [];
    if (ctx.assigneeName) {
      contextLines.push(`- 담당자: ${ctx.assigneeName}`);
      contextLines.push(
        `- 이 티켓은 "${ctx.assigneeName}" 가 해야 할 작업만 담아야 한다. 텍스트에 다른 사람의 작업이 섞여 있어도, 담당자의 작업만 추출하라. 담당자의 작업이 명확하지 않으면 본문에 "텍스트에서 담당자의 작업 범위를 특정하기 어려움"이라고 표시하라.`
      );
    }
    if (ctx.instructions) contextLines.push(`- 추가 지시사항: ${ctx.instructions}`);
    if (ctx.sourceUrl) contextLines.push(`- 원문 출처: ${ctx.sourceUrl}`);

    const system = buildSystemPrompt();
    const user = `${buildContextBlock(contextLines)}<선택한 텍스트>\n${text}\n</선택한 텍스트>`;

    const raw = await callAnthropic(system, user);
    const draft = parseTicketDraft(raw);
    if (!draft) throw new LLMError('Anthropic 응답 파싱 실패');
    return draft;
  };
})(window);
