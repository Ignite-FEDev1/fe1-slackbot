import { createHash } from 'node:crypto';
import axios, { AxiosInstance } from 'axios';

export const FE_PACKAGES = [
  'react', 'react-dom', 'react-server-dom-webpack', 'react-server-dom-parcel',
  'react-server-dom-turbopack', 'react-router', 'react-router-dom',
  '@remix-run/react', '@remix-run/node', '@remix-run/server-runtime',
  'next', 'vite', 'vite-plus', '@vitejs/plugin-react', '@vitejs/plugin-react-swc',
  'webpack', 'webpack-dev-server', 'esbuild', 'rollup', 'rolldown', '@rollup/plugin-commonjs',
  '@babel/core', '@babel/runtime', '@babel/traverse', '@babel/helpers',
  'typescript', 'vitest', '@vitest/browser', '@vitest/ui',
  'storybook', '@storybook/core', 'axios', 'lodash',
];

export interface SecurityNews {
  id: string;
  fingerprint: string;
  severity: 'high' | 'critical';
  summary: string;
  url: string;
}

export interface NewsState {
  version: 1;
  lastCheckedAt?: string;
  sent: Record<string, string>;
  digest?: { date: string; ts: string; count: number };
}

export interface Advisory {
  ghsa_id: string;
  severity: string;
  summary: string;
  withdrawn_at: string | null;
  vulnerabilities: {
    package: { ecosystem: string; name: string };
    vulnerable_version_range: string;
    first_patched_version: string | null;
  }[];
}

const DAY_MS = 86400000;
const highSeverity = (value: string): value is SecurityNews['severity'] =>
  value === 'high' || value === 'critical';
const fingerprint = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const oneLine = (text: string): string => text.replace(/[\r\n\t ]+/g, ' ').trim();
const escapeSlack = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const advisoryNews = (advisories: Advisory[]): SecurityNews[] =>
  advisories.flatMap((advisory) => {
    if (advisory.withdrawn_at || !highSeverity(advisory.severity)) return [];
    const packages = advisory.vulnerabilities
      .filter(({ package: pkg }) => pkg.ecosystem === 'npm' && FE_PACKAGES.includes(pkg.name))
      .sort((a, b) => a.package.name.localeCompare(b.package.name));
    if (!packages.length) return [];
    return [{
      id: advisory.ghsa_id,
      severity: advisory.severity,
      fingerprint: fingerprint([advisory.severity, advisory.summary, packages]),
      summary: `${[...new Set(packages.map(({ package: pkg }) => pkg.name))].join(', ')}: ${oneLine(advisory.summary)}`,
      url: `https://github.com/advisories/${advisory.ghsa_id}`,
    }];
  });

export const fetchAdvisories = async (
  since: string,
  client: AxiosInstance = axios
): Promise<SecurityNews[]> => {
  const news: SecurityNews[] = [];
  const sinceDate = new Date(since).toISOString().slice(0, 10);
  for (const severity of ['critical', 'high']) {
    let after: string | undefined;
    const seen = new Set<string>();
    do {
      const { data, headers } = await client.get<Advisory[]>('https://api.github.com/advisories', {
        params: {
          type: 'reviewed', ecosystem: 'npm', severity,
          // Filter packages locally; use a date-only search range without fractional seconds.
          modified: `>=${sinceDate}`,
          per_page: 100, sort: 'updated', direction: 'desc',
          ...(after ? { after } : {}),
        },
        headers: { Accept: 'application/vnd.github+json' },
        timeout: 30000,
      });
      news.push(...advisoryNews(data));
      const next = String(headers.link ?? '').match(/<([^>]+)>;\s*rel="next"/)?.[1];
      if (!next) break;
      after = new URL(next).searchParams.get('after') ?? undefined;
      if (!after || seen.has(after)) throw new Error('Invalid GitHub advisory pagination cursor');
      seen.add(after);
    } while (after);
  }
  return news;
};

export const formatNewsError = (error: unknown): string => {
  if (!axios.isAxiosError(error)) {
    return error instanceof Error ? error.message : 'Security news failed';
  }
  const { config, response } = error;
  let endpoint = 'HTTP request';
  if (config?.url) {
    const url = new URL(config.url, config.baseURL);
    endpoint = `${config.method?.toUpperCase() ?? 'GET'} ${url.origin}${url.pathname}`;
  }
  const message = typeof response?.data?.message === 'string'
    ? response.data.message.slice(0, 500) : error.message;
  const fields = Array.isArray(response?.data?.errors)
    ? response.data.errors.map((item: { field?: string; code?: string; message?: string } | string) =>
      typeof item === 'string' ? item :
        [item?.field, item?.code, item?.message]
          .filter((value) => typeof value === 'string').join(':')
    ).filter(Boolean).join(', ').slice(0, 500)
    : '';
  return `${endpoint}: ${response ? `HTTP ${response.status}: ` : ''}${message}` +
    (fields ? ` (${fields})` : '');
};

const xmlText = (text: string): string =>
  text.replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&');

export const nodeFeedArticles = (rss: string, since: string): string[] => {
  if (!/<rss[\s>]/.test(rss)) throw new Error('Invalid Node.js security RSS');
  const urls = new Set<string>();
  for (const match of rss.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const link = match[1].match(/<link>([\s\S]*?)<\/link>/)?.[1];
    const published = match[1].match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1];
    if (!link || !published || !Number.isFinite(Date.parse(published))) {
      throw new Error('Invalid Node.js security RSS item');
    }
    if (Date.parse(published) < Date.parse(since)) continue;
    const url = new URL(xmlText(link.trim()));
    if (url.origin !== 'https://nodejs.org' ||
        !/^\/en\/blog\/vulnerability\/[a-z0-9-]+\/?$/.test(url.pathname)) {
      throw new Error('Unexpected Node.js security article URL');
    }
    urls.add(url.href.replace(/\/$/, ''));
  }
  return [...urls];
};

export const nodeArticleNews = (markdown: string, url: string): SecurityNews[] => {
  const news: SecurityNews[] = [];
  for (const section of markdown.matchAll(/^#{2,3} ([^\r\n]+)\r?\n([\s\S]*?)(?=^#{1,3} |(?![\s\S]))/gm)) {
    const title = oneLine(section[1]);
    const severity = title.match(/\((high|critical)\)\s*$/i)?.[1].toLowerCase();
    if (!severity || !highSeverity(severity)) continue;
    const cve = title.match(/CVE-\d{4}-\d+/i)?.[0].toUpperCase();
    const summary = title.replace(/\s*-\s*\((high|critical)\)\s*$/i, '')
      .replace(/`/g, '');
    news.push({
      id: cve ?? `node:${url}:${fingerprint(summary)}`,
      severity,
      fingerprint: fingerprint([title, oneLine(section[2])]),
      summary: `Node.js: ${summary}`,
      url,
    });
  }
  // Fail rather than silently dropping alerts if upstream changes the heading format.
  if (!news.length && /^# Security releases available\s*$/mi.test(markdown) &&
      /(?:high|critical)\s+severity|\((?:high|critical)\)/i.test(markdown)) {
    throw new Error(`Unrecognized Node.js security article format: ${url}`);
  }
  return news;
};

export const fetchNodeNews = async (
  since: string,
  client: AxiosInstance = axios
): Promise<SecurityNews[]> => {
  const { data: rss } = await client.get<string>('https://nodejs.org/en/feed/vulnerability.xml', {
    timeout: 30000, responseType: 'text',
  });
  const news: SecurityNews[] = [];
  for (const url of nodeFeedArticles(rss, since)) {
    const slug = new URL(url).pathname.split('/').pop();
    const { data } = await client.get<string>(
      `https://raw.githubusercontent.com/nodejs/nodejs.org/main/apps/site/pages/en/blog/vulnerability/${slug}.md`,
      { timeout: 30000, responseType: 'text' }
    );
    news.push(...nodeArticleNews(data, url));
  }
  return news;
};

export const collectNews = async (
  state: NewsState,
  now: Date,
  github: AxiosInstance = axios,
  node: AxiosInstance = axios
): Promise<SecurityNews[]> => {
  const initialSince = new Date(now.getTime() - 14 * DAY_MS).toISOString();
  const since = state.lastCheckedAt
    ? new Date(Date.parse(state.lastCheckedAt) - DAY_MS).toISOString()
    : initialSince;
  const results = await Promise.all([
    fetchAdvisories(since, github),
    fetchNodeNews(
      new Date(Math.min(Date.parse(since), Date.parse(initialSince))).toISOString(), node
    ),
  ]);
  const unique = new Map(results.flat().map((item) => [item.id, item]));
  return [...unique.values()]
    .filter((item) => state.sent[item.id] !== item.fingerprint)
    .sort((a, b) => Number(b.severity === 'critical') - Number(a.severity === 'critical') ||
      a.id.localeCompare(b.id));
};

export interface NewsPost {
  text: string;
  thread_ts?: string;
  client_msg_id: string;
}

const messageId = (value: unknown): string => {
  const hash = fingerprint(value);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
};

export const sendNews = async (
  items: SecurityNews[],
  date: string,
  state: NewsState,
  post: (message: NewsPost) => Promise<{ ts?: string }>,
  save: (state: NewsState) => Promise<void>
): Promise<number> => {
  const pending = items.filter((item) => state.sent[item.id] !== item.fingerprint);
  if (!pending.length) return 0;
  if (state.digest?.date !== date) {
    const { ts } = await post({
      text: `${date} FrontEnd 보안 뉴스`,
      client_msg_id: messageId(['digest', date]),
    });
    if (!ts) throw new Error('Slack did not return the digest timestamp');
    state.digest = { date, ts, count: 0 };
    await save(state);
  }
  const digest = state.digest!;
  let offset = 0;
  while (offset < pending.length) {
    let text = '';
    const batch: SecurityNews[] = [];
    for (let index = offset; index < pending.length; index++) {
      const item = pending[index];
      const line = `${digest.count + batch.length + 1}. ` +
        `[${item.severity === 'critical' ? 'Critical' : 'High'}] ` +
        `${escapeSlack(oneLine(item.summary).slice(0, 400))} <${item.url}|링크>`;
      // Slack truncates text over 40,000 characters; keep each list below it.
      if (text.length + line.length + 1 > 35000) break;
      text += `${text ? '\n' : ''}${line}`;
      batch.push(item);
    }
    const { ts } = await post({
      text, thread_ts: digest.ts,
      client_msg_id: messageId([date, batch.map(({ id, fingerprint: hash }) => [id, hash])]),
    });
    if (!ts) throw new Error('Slack did not return the reply timestamp');
    for (const item of batch) state.sent[item.id] = item.fingerprint;
    digest.count += batch.length;
    offset += batch.length;
    await save(state);
  }
  return pending.length;
};
