import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import axios, { AxiosError, AxiosHeaders } from 'axios';
import {
  Advisory, advisoryNews, collectNews, fetchAdvisories, fetchNodeNews, formatNewsError,
  NewsPost, NewsState, nodeArticleNews, nodeFeedArticles, SecurityNews, sendNews,
} from './news';

const articleUrl = 'https://nodejs.org/en/blog/vulnerability/november-2026-security-releases';
const advisory = (overrides: Partial<Advisory> = {}): Advisory => ({
  ghsa_id: 'GHSA-p4f5-76q4-ffq7',
  severity: 'critical',
  summary: 'Remote code execution in dev server',
  withdrawn_at: null,
  vulnerabilities: [{
    package: { ecosystem: 'npm', name: 'vite' },
    vulnerable_version_range: '<=8.3.6',
    first_patched_version: '8.3.7',
  }],
  ...overrides,
});
const news = (id: string, version = 'v1'): SecurityNews => ({
  id, fingerprint: version, severity: 'high',
  summary: 'vite: A & B <@UINJECTED>\nsummary', url: `https://github.com/advisories/${id}`,
});
const rss = (url = articleUrl, date = 'Wed, 11 Nov 2026 00:00:00 GMT') =>
  `<rss><channel><item><link><![CDATA[${url}]]></link><pubDate>${date}</pubDate></item></channel></rss>`;
const markdown = `# Security releases available

### Remote crash (CVE-2026-123863) - (high)

First paragraph.

Affected versions: 24.x, 26.x.

### Memory disclosure (CVE-2026-123864) - (critical)

Details.

### Minor bug (CVE-2026-123865) - (low)

Details.
`;

test('filters exact FE package names, severity and withdrawals without requiring a CVE', () => {
  const result = advisoryNews([
    advisory(),
    advisory({ ghsa_id: 'low', severity: 'low' }),
    advisory({ ghsa_id: 'withdrawn', withdrawn_at: '2026-11-18' }),
    advisory({ ghsa_id: 'irrelevant', vulnerabilities: [{
      package: { ecosystem: 'npm', name: 'vite-unrelated' },
      vulnerable_version_range: '*', first_patched_version: null,
    }] }),
    advisory({ ghsa_id: 'java', vulnerabilities: [{
      package: { ecosystem: 'maven', name: 'react' },
      vulnerable_version_range: '*', first_patched_version: null,
    }] }),
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'GHSA-p4f5-76q4-ffq7');
  assert.match(result[0].summary, /^vite:/);
  assert.notEqual(result[0].fingerprint,
    advisoryNews([advisory({ summary: 'Updated attack conditions' })])[0].fingerprint);
  const patched = advisory();
  patched.vulnerabilities[0].first_patched_version = '8.3.8';
  assert.notEqual(result[0].fingerprint, advisoryNews([patched])[0].fingerprint);
});

test('fetches both severities and follows GitHub cursor pagination', async () => {
  const calls: string[] = [];
  const client = axios.create({ adapter: async (config) => {
    const { severity, after } = config.params;
    calls.push(`${severity}:${after ?? ''}`);
    assert.equal(config.params.ecosystem, 'npm');
    assert.equal(config.params.modified, '>=2026-11-01');
    assert.equal(config.params.affects, undefined);
    return {
      config, status: 200, statusText: 'OK',
      headers: severity === 'critical' && !after
        ? { link: '<https://api.github.com/advisories?after=next-page>; rel="next"' } : {},
      data: [advisory({ ghsa_id: `${severity}-${after ?? 'first'}` })],
    };
  } });
  assert.equal((await fetchAdvisories('2026-11-01T00:00:00.123Z', client)).length, 3);
  assert.deepEqual(calls, ['critical:', 'critical:next-page', 'high:']);
});

test('reports API endpoint and validation details without request credentials or query values', () => {
  const config = {
    method: 'get', url: '/advisories?secret=hidden-query',
    baseURL: 'https://api.github.com',
    headers: new AxiosHeaders({ Authorization: 'Bearer hidden-token' }),
  };
  const error = new AxiosError('Request failed with status code 422', undefined,
    config, undefined, {
      status: 422, statusText: 'Unprocessable Entity', headers: {}, config,
      data: {
        message: 'Validation Failed',
        errors: [{ field: 'modified', code: 'invalid', message: 'Invalid date format' }],
      },
    });
  assert.equal(formatNewsError(error),
    'GET https://api.github.com/advisories: HTTP 422: Validation Failed (modified:invalid:Invalid date format)');
  assert.doesNotMatch(formatNewsError(error), /hidden-query|hidden-token|Authorization/);
  assert.equal(formatNewsError(new Error('Slack unavailable')), 'Slack unavailable');
});

test('rejects repeated pagination cursors instead of returning a partial report', async () => {
  const client = axios.create({ adapter: async (config) => ({
    config, status: 200, statusText: 'OK', data: [],
    headers: { link: '<https://api.github.com/advisories?after=same>; rel="next"' },
  }) });
  await assert.rejects(fetchAdvisories('2026-11-01', client), /pagination cursor/);
});

test('reads recent official RSS entries and rejects malformed or foreign links', () => {
  assert.deepEqual(nodeFeedArticles(rss(), '2026-11-10'), [articleUrl]);
  assert.deepEqual(nodeFeedArticles(rss(), '2026-11-12'), []);
  assert.throws(() => nodeFeedArticles(rss('https://example.com/evil'), '2026-11-01'),
    /Unexpected/);
  assert.throws(() => nodeFeedArticles('<html>error</html>', '2026-11-01'), /Invalid/);
});

test('extracts High and Critical Node.js vulnerabilities and detects body updates', () => {
  const result = nodeArticleNews(markdown, articleUrl);
  assert.deepEqual(result.map(({ id, severity }) => [id, severity]),
    [['CVE-2026-123863', 'high'], ['CVE-2026-123864', 'critical']]);
  assert.match(result[0].summary, /^Node.js: Remote crash/);
  const updated = nodeArticleNews(markdown.replace('24.x, 26.x', '22.x, 24.x, 26.x'), articleUrl);
  assert.notEqual(result[0].fingerprint, updated[0].fingerprint);
  assert.equal(result[1].fingerprint, updated[1].fingerprint);
  assert.deepEqual(nodeArticleNews('# Upcoming releases\n2 high severity issues', articleUrl), []);
  assert.throws(() => nodeArticleNews(
    '# Security releases available\nNew format (high)', articleUrl), /Unrecognized/);
});

test('fetches runtime advisories from Node.js source, not the npm node package', async () => {
  const urls: string[] = [];
  const client = axios.create({ adapter: async (config) => {
    urls.push(config.url!);
    return {
      config, status: 200, statusText: 'OK', headers: {},
      data: config.url!.endsWith('.xml') ? rss() : markdown,
    };
  } });
  assert.equal((await fetchNodeNews('2026-11-10', client)).length, 2);
  assert.deepEqual(urls, [
    'https://nodejs.org/en/feed/vulnerability.xml',
    'https://raw.githubusercontent.com/nodejs/nodejs.org/main/apps/site/pages/en/blog/vulnerability/november-2026-security-releases.md',
  ]);
});

test('overlaps collection windows, removes sent items and propagates source failures', async () => {
  const sent = advisoryNews([advisory()])[0];
  const state: NewsState = {
    version: 1, lastCheckedAt: '2026-11-18T00:00:00Z',
    sent: { [sent.id]: sent.fingerprint },
  };
  const github = axios.create({ adapter: async (config) => {
    assert.equal(config.params.modified, '>=2026-11-17');
    return { config, status: 200, statusText: 'OK', headers: {}, data: [advisory()] };
  } });
  const node = axios.create({ adapter: async (config) => ({
    config, status: 200, statusText: 'OK', headers: {},
    data: config.url!.endsWith('.xml') ? rss() : markdown,
  }) });
  const result = await collectNews(state, new Date('2026-11-19T00:00:00Z'), github, node);
  assert.equal(result.length, 2);
  assert.equal(result[0].severity, 'critical');
  const failing = axios.create({ adapter: async () => { throw new Error('source down'); } });
  await assert.rejects(collectNews(state, new Date(), failing, node), /source down/);
  assert.equal(state.lastCheckedAt, '2026-11-18T00:00:00Z');
});

test('posts only the date title to the channel and the numbered list in a thread reply', async () => {
  const state: NewsState = { version: 1, sent: {} };
  const posts: NewsPost[] = [];
  const saved: NewsState[] = [];
  const count = await sendNews([news('one'), news('two')], '2026-11-19', state,
    async (message) => {
      posts.push(message);
      return { ts: String(posts.length) };
    }, async (next) => { saved.push(structuredClone(next)); });
  assert.equal(count, 2);
  assert.equal(posts[0].text, '2026-11-19 FrontEnd 보안 뉴스');
  assert.equal(posts[0].thread_ts, undefined);
  assert.match(posts[1].text, /^1\. \[High\] vite: A &amp; B &lt;@UINJECTED&gt; summary /);
  assert.match(posts[1].text, /<https:\/\/github.com\/advisories\/one\|링크>\n2\. /);
  assert.match(posts[1].text, /\n2\. /);
  assert.equal(posts[1].thread_ts, '1');
  assert.equal(posts.length, 2);
  assert.equal(saved.length, 2);
  assert.deepEqual(saved[0].sent, {});
  assert.equal(saved[1].sent.one, 'v1');
  assert.equal(saved[1].sent.two, 'v1');
});

test('skips empty and duplicate digests, appends updates to the same daily thread', async () => {
  const state: NewsState = { version: 1, sent: {} };
  const posts: NewsPost[] = [];
  const post = async (message: NewsPost) => {
    posts.push(message);
    return { ts: String(posts.length) };
  };
  const save = async () => {};
  assert.equal(await sendNews([], '2026-11-19', state, post, save), 0);
  await sendNews([news('one')], '2026-11-19', state, post, save);
  assert.equal(await sendNews([news('one')], '2026-11-19', state, post, save), 0);
  await sendNews([news('one', 'v2')], '2026-11-19', state, post, save);
  assert.equal(posts.length, 3);
  assert.equal(posts[2].thread_ts, '1');
  assert.match(posts[2].text, /^2\. /);
  await sendNews([news('two')], '2026-11-20', state, post, save);
  assert.equal(posts[3].text, '2026-11-20 FrontEnd 보안 뉴스');
  assert.match(posts[4].text, /^1\. /);
});

test('checkpoints partial success and stops immediately on Slack or state failure', async () => {
  const state: NewsState = { version: 1, sent: {} };
  const items = Array.from({ length: 100 }, (_, index) => ({
    ...news(`item-${index}`), summary: 'x'.repeat(400),
  }));
  let calls = 0;
  await assert.rejects(sendNews(items, '2026-11-19', state,
    async (message) => {
      assert.ok(message.text.length <= 35000);
      if (++calls === 3) throw new Error('Slack unavailable');
      return { ts: String(calls) };
    }, async () => {}), /Slack unavailable/);
  const confirmed = Object.keys(state.sent).length;
  assert.ok(confirmed > 0 && confirmed < items.length);
  const resumed: NewsPost[] = [];
  await sendNews(items, '2026-11-19', state,
    async (message) => { resumed.push(message); return { ts: '4' }; }, async () => {});
  assert.equal(resumed.length, 1);
  assert.ok(resumed[0].text.startsWith(`${confirmed + 1}. `));
  assert.equal(resumed[0].thread_ts, '1');
  assert.equal(Object.keys(state.sent).length, items.length);

  let posted = 0;
  await assert.rejects(sendNews([news('one')], '2026-11-19', { version: 1, sent: {} },
    async () => { posted++; return { ts: '1' }; },
    async () => { throw new Error('state unavailable'); }), /state unavailable/);
  assert.equal(posted, 1);
});
