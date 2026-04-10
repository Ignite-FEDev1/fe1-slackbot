import axios, { AxiosInstance } from 'axios';
import { JIRA_CONFIG } from '../constant';

/**
 * Ignite Jira REST API v3 공용 axios 인스턴스
 */
export const jiraClient: AxiosInstance = axios.create({
  baseURL: `${JIRA_CONFIG.BASE_URL}/rest/api/3`,
  auth: {
    username: JIRA_CONFIG.EMAIL,
    password: process.env.ATLASSIAN_TOKEN || '',
  },
  headers: {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  },
});

export const buildIssueUrl = (key: string) =>
  `${JIRA_CONFIG.BASE_URL}/browse/${key}`;
