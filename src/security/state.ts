import axios, { AxiosInstance } from 'axios';
import { NewsState } from './news';

const BRANCH = 'security-news-state';

export const parseState = (text: string): NewsState => {
  const state = JSON.parse(text);
  if (state.version !== 1 || !state.sent || typeof state.sent !== 'object' ||
      Array.isArray(state.sent) ||
      Object.values(state.sent).some((value) => typeof value !== 'string') ||
      (state.lastCheckedAt !== undefined && !Number.isFinite(Date.parse(state.lastCheckedAt))) ||
      (state.digest !== undefined &&
        (typeof state.digest.date !== 'string' || typeof state.digest.ts !== 'string' ||
          !Number.isSafeInteger(state.digest.count) || state.digest.count < 0))) {
    throw new Error('Invalid security news state');
  }
  return state;
};

export class GitHubNewsState {
  private sha?: string;
  private branchExists = false;
  private readonly path: string;

  constructor(
    private readonly client: AxiosInstance,
    channel: string,
    private readonly baseSha: string
  ) {
    if (!/^[A-Z0-9]+$/.test(channel)) throw new Error('Invalid Slack channel ID');
    this.path = `/contents/security-news/${channel}.json`;
  }

  async load(): Promise<NewsState> {
    try {
      await this.client.get(`/git/ref/heads/${BRANCH}`);
      this.branchExists = true;
    } catch (error) {
      if (!axios.isAxiosError(error) || error.response?.status !== 404) throw error;
      return { version: 1, sent: {} };
    }
    try {
      const { data } = await this.client.get(this.path, { params: { ref: BRANCH } });
      this.sha = data.sha;
      return parseState(Buffer.from(data.content, 'base64').toString('utf8'));
    } catch (error) {
      if (!axios.isAxiosError(error) || error.response?.status !== 404) throw error;
      return { version: 1, sent: {} };
    }
  }

  async save(state: NewsState): Promise<void> {
    if (!this.branchExists) {
      await this.client.post('/git/refs', {
        ref: `refs/heads/${BRANCH}`, sha: this.baseSha,
      });
      this.branchExists = true;
    }
    const { data } = await this.client.put(this.path, {
      message: 'chore: checkpoint security news delivery',
      branch: BRANCH,
      content: Buffer.from(JSON.stringify(state, null, 2) + '\n').toString('base64'),
      ...(this.sha ? { sha: this.sha } : {}),
    });
    this.sha = data.content.sha;
  }
}
