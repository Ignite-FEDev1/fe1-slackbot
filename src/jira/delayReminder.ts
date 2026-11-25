import { AxiosInstance } from 'axios';
import { SLACK_JIRA_USER_MAP } from '../constant';
import { buildIssueUrl, jiraClient } from './client';

export interface DelayIssue {
  key: string;
  fields: {
    summary: string;
    status: { statusCategory: { key: string } };
    assignee: { accountId: string; displayName: string } | null;
    customfield_10015?: string | null;
    duedate?: string | null;
  };
}

interface SearchResponse {
  issues: DelayIssue[];
  nextPageToken?: string;
  isLast?: boolean;
}

export const fetchDelayedIssues = async (
  today: string,
  client: AxiosInstance = jiraClient,
  maxPages = Infinity
): Promise<DelayIssue[]> => {
  const jql =
    'project = FEHG AND statusCategory != Done AND (' +
    `(statusCategory = "To Do" AND cf[10015] < "${today}") ` +
    `OR duedate <= "${today}") ORDER BY assignee ASC, key ASC`;
  const issues: DelayIssue[] = [];
  const seenTokens = new Set<string>();
  let nextPageToken: string | undefined;

  for (let page = 1; ; page++) {
    const { data } = await client.get<SearchResponse>('/search/jql', {
      params: {
        jql,
        fields: 'summary,status,assignee,customfield_10015,duedate',
        maxResults: 100,
        ...(nextPageToken ? { nextPageToken } : {}),
      },
      timeout: 30000,
    });
    issues.push(...data.issues);
    if (data.isLast || !data.nextPageToken) break;
    if (page >= maxPages) {
      throw new Error('Jira pagination limit exceeded');
    }
    if (seenTokens.has(data.nextPageToken)) {
      throw new Error('Jira returned a repeated pagination token');
    }
    nextPageToken = data.nextPageToken;
    seenTokens.add(nextPageToken);
  }

  return issues;
};

const escapeSlack = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const jiraSlackUsers = new Map(
  Object.entries(SLACK_JIRA_USER_MAP).map(([slackId, jiraId]) => [jiraId, slackId])
);

// Slack truncates text above 40,000 characters. Repeat context on each chunk.
const MAX_MESSAGE_LENGTH = 35000;

export const buildDelayMessages = (
  issues: DelayIssue[],
  today: string
): string[] => {
  const openIssues = issues.filter(
    (issue) => issue.fields.status.statusCategory.key !== 'done'
  );
  const sections = [
    {
      title: '*[ 시작일이 지체되었어요 ]*',
      issues: openIssues.filter(
        ({ fields }) =>
          fields.status.statusCategory.key === 'new' &&
          fields.customfield_10015 &&
          fields.customfield_10015 < today
      ),
    },
    {
      title: '*[ 종료 현황을 확인해주세요 ]*',
      issues: openIssues.filter(
        ({ fields }) => fields.duedate && fields.duedate <= today
      ),
    },
  ];
  const messages: string[] = [];

  for (const section of sections) {
    const groups = new Map<string, { mention: string; issues: DelayIssue[] }>();
    for (const issue of section.issues) {
      const assignee = issue.fields.assignee;
      const groupKey = assignee?.accountId ?? '';
      let group = groups.get(groupKey);
      if (!group) {
        const slackId = assignee && jiraSlackUsers.get(assignee.accountId);
        group = {
          mention: slackId
            ? `<@${slackId}>`
            : escapeSlack(assignee?.displayName ?? '담당자 없음'),
          issues: [],
        };
        groups.set(groupKey, group);
      }
      group.issues.push(issue);
    }

    let text = section.title;
    for (const group of groups.values()) {
      let first = true;
      for (const issue of group.issues) {
        const line =
          `  • <${buildIssueUrl(issue.key)}|${issue.key}> ` +
          escapeSlack(issue.fields.summary.replace(/[\r\n]+/g, ' '));
        let addition = `${first ? `\n\n*${group.mention}*` : ''}\n${line}`;
        if (text.length + addition.length > MAX_MESSAGE_LENGTH) {
          messages.push(text);
          text = section.title;
          addition = `\n\n*${group.mention}*\n${line}`;
        }
        text += addition;
        first = false;
      }
    }
    if (text !== section.title) {
      const last = messages.length - 1;
      if (last >= 0 && messages[last].length + text.length + 2 <= MAX_MESSAGE_LENGTH) {
        messages[last] += `\n\n${text}`;
      } else {
        messages.push(text);
      }
    }
  }
  return messages;
};

export const sendDelayReminder = async (
  today: string,
  postMessage: (text: string) => Promise<unknown>,
  client: AxiosInstance = jiraClient
): Promise<number> => {
  const issues = await fetchDelayedIssues(today, client);
  const messages = buildDelayMessages(issues, today);
  for (const text of messages) {
    await postMessage(text);
  }
  return messages.length;
};
