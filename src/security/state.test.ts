import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import axios, { AxiosError, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { GitHubNewsState, parseState } from './state';

const missing = (config: InternalAxiosRequestConfig, status = 404): never => {
  throw new AxiosError('HTTP error', undefined, config, undefined, {
    status, config, headers: {}, data: {}, statusText: 'Error',
  } as AxiosResponse);
};

test('bootstraps a dedicated branch and checkpoints state per channel with SHA protection', async () => {
  const writes: { url: string; data: any }[] = [];
  const client = axios.create({ adapter: async (config) => {
    if (config.method === 'get') return missing(config);
    writes.push({ url: config.url!, data: JSON.parse(config.data) });
    return {
      config, status: 200, statusText: 'OK', headers: {},
      data: { content: { sha: `sha-${writes.length}` } },
    };
  } });
  const store = new GitHubNewsState(client, 'C0ALN3RU92R', 'source-sha');
  const state = await store.load();
  assert.deepEqual(state, { version: 1, sent: {} });
  await store.save(state);
  state.sent.example = 'fingerprint';
  await store.save(state);
  assert.deepEqual(writes[0], {
    url: '/git/refs',
    data: { ref: 'refs/heads/security-news-state', sha: 'source-sha' },
  });
  assert.equal(writes[1].url, '/contents/security-news/C0ALN3RU92R.json');
  assert.equal(writes[1].data.branch, 'security-news-state');
  assert.equal(writes[1].data.sha, undefined);
  assert.equal(writes[2].data.sha, 'sha-2');
  assert.deepEqual(parseState(Buffer.from(writes[2].data.content, 'base64').toString()), state);
});

test('loads existing checkpoints and never treats authentication failures as empty state', async () => {
  const state = { version: 1, sent: { old: 'fingerprint' } };
  const client = axios.create({ adapter: async (config) => ({
    config, status: 200, statusText: 'OK', headers: {},
    data: config.url!.includes('/contents/')
      ? { sha: 'existing', content: Buffer.from(JSON.stringify(state)).toString('base64') }
      : {},
  }) });
  assert.deepEqual(await new GitHubNewsState(client, 'C0ALN3RU92R', 'base').load(), state);
  const denied = axios.create({ adapter: async (config) => missing(config, 403) });
  await assert.rejects(new GitHubNewsState(denied, 'C0ALN3RU92R', 'base').load(), /HTTP error/);
});

test('fails closed on corrupted state instead of resending the full history', () => {
  for (const state of [
    { version: 2, sent: {} }, { version: 1, sent: [] },
    { version: 1, sent: { key: 42 } },
    { version: 1, sent: {}, lastCheckedAt: 'invalid' },
    { version: 1, sent: {}, digest: { date: '2026-11-19', ts: '1', count: -1 } },
  ]) {
    assert.throws(() => parseState(JSON.stringify(state)), /Invalid/);
  }
});
