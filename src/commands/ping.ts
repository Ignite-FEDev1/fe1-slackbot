import { Command } from './types';

const FE1_WEB_BASE_URL = 'https://fe1-jira-sync.vercel.app';
const VERCEL_BYPASS_SECRET = process.env.VERCEL_BYPASS_SECRET || '';

export const pingCommand: Command = {
  name: 'ping',
  description: 'fe1-web API 연결 테스트',

  register() {
    // 별도 리스너 없음
  },

  async runSlash({ respond }) {
    const endpoints = [
      { name: 'templates', url: `${FE1_WEB_BASE_URL}/api/deploy-room/templates` },
      { name: 'sessions', url: `${FE1_WEB_BASE_URL}/api/deploy-room/sessions` },
    ];

    const headers: Record<string, string> = {};
    if (VERCEL_BYPASS_SECRET) {
      headers['x-vercel-protection-bypass'] = VERCEL_BYPASS_SECRET;
    }

    const results: string[] = [];

    for (const ep of endpoints) {
      const start = Date.now();
      try {
        const res = await fetch(ep.url, { headers });
        const elapsed = Date.now() - start;
        const body = await res.text();
        const preview = body.substring(0, 200);
        results.push(`• \`${ep.name}\` → ${res.status} (${elapsed}ms)\n\`\`\`${preview}\`\`\``);
      } catch (err) {
        const elapsed = Date.now() - start;
        const msg = err instanceof Error ? err.message : String(err);
        results.push(`• \`${ep.name}\` → ❌ ${msg} (${elapsed}ms)`);
      }
    }

    const bypassStatus = VERCEL_BYPASS_SECRET ? '✅' : '❌ (미설정)';
    await respond(`*fe1-web API 연결 테스트*\nHost: ${FE1_WEB_BASE_URL}\nBypass: ${bypassStatus}\n\n${results.join('\n')}`);
  },
};
