import { Resend } from 'resend';

let _resend: Resend | null = null;
const getResend = (): Resend => {
  if (_resend) return _resend;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY 미설정');
  _resend = new Resend(apiKey);
  return _resend;
};

const FROM = 'FE1 Tool <onboarding@resend.dev>';

interface MonthlyStats {
  slack: number;
  confluence: number;
}

interface SendMonthlyReportParams {
  to: string;
  userName: string;
  yearMonth: string;
  summaryMarkdown: string;
  stats: MonthlyStats;
}

/**
 * 마크다운 → HTML 간이 변환.
 * 공식 라이브러리 안 쓰고 슬랙봇에서 보내는 패턴만 처리:
 * - ## / ### / **bold** / 불릿(- ) / 빈 줄 → <p>
 * - URL 자동 링크
 */
const markdownToHtml = (md: string): string => {
  const escapeHtml = (s: string) =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

  const lines = md.split('\n');
  const out: string[] = [];
  let inUl = false;

  const closeUl = () => {
    if (inUl) {
      out.push('</ul>');
      inUl = false;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (!line.trim()) {
      closeUl();
      continue;
    }

    if (/^### /.test(line)) {
      closeUl();
      out.push(
        `<h3 style="margin:24px 0 8px;font-size:16px;color:#111;">${formatInline(escapeHtml(line.replace(/^### /, '')))}</h3>`
      );
      continue;
    }
    if (/^## /.test(line)) {
      closeUl();
      out.push(
        `<h2 style="margin:32px 0 12px;font-size:18px;color:#111;border-bottom:1px solid #ddd;padding-bottom:6px;">${formatInline(escapeHtml(line.replace(/^## /, '')))}</h2>`
      );
      continue;
    }
    if (/^- /.test(line) || /^• /.test(line)) {
      if (!inUl) {
        out.push('<ul style="margin:8px 0;padding-left:24px;color:#333;line-height:1.6;">');
        inUl = true;
      }
      out.push(`<li>${formatInline(escapeHtml(line.replace(/^[-•] /, '')))}</li>`);
      continue;
    }
    if (/^---+$/.test(line)) {
      closeUl();
      out.push('<hr style="border:none;border-top:1px solid #eee;margin:16px 0;" />');
      continue;
    }
    closeUl();
    out.push(
      `<p style="margin:8px 0;color:#333;line-height:1.6;">${formatInline(escapeHtml(line))}</p>`
    );
  }
  closeUl();
  return out.join('\n');
};

/**
 * 인라인 처리: **bold** + URL 자동링크
 */
const formatInline = (s: string): string => {
  let out = s.replace(
    /\*\*([^*]+)\*\*/g,
    '<strong>$1</strong>'
  );
  out = out.replace(
    /(https?:\/\/[^\s<)]+)/g,
    '<a href="$1" style="color:#1a73e8;text-decoration:none;">$1</a>'
  );
  return out;
};

export const sendMonthlyReportEmail = async (
  params: SendMonthlyReportParams
): Promise<void> => {
  const { to, userName, yearMonth, summaryMarkdown, stats } = params;

  const html = `<!doctype html>
<html lang="ko">
<head><meta charset="utf-8" /></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Apple SD Gothic Neo','Noto Sans KR',sans-serif;background:#f6f7f9;margin:0;padding:24px;">
  <div style="max-width:720px;margin:0 auto;background:#fff;border-radius:8px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
    <div style="margin-bottom:24px;">
      <h1 style="margin:0 0 4px;font-size:22px;color:#111;">📊 ${escape(userName)}의 ${yearMonth} 월간 성과</h1>
      <p style="margin:0;color:#666;font-size:13px;">Slack ${stats.slack}건 · Confluence ${stats.confluence}페이지</p>
    </div>
    ${markdownToHtml(summaryMarkdown)}
    <div style="margin-top:32px;padding-top:16px;border-top:1px solid #eee;color:#999;font-size:12px;">
      이 메일은 FE1 Tool slackbot 의 <code>/fe1 monthly-report</code> 결과입니다.
    </div>
  </div>
</body>
</html>`;

  const subject = `[FE1 Tool] ${userName}의 ${yearMonth} 월간 성과 보고`;

  const { error } = await getResend().emails.send({
    from: FROM,
    to,
    subject,
    html,
  });

  if (error) throw new Error(`Resend 발송 실패: ${JSON.stringify(error)}`);
};

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
