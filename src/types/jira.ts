export interface JiraPageResponse {
  results: JiraPage[];
  start: number;
  limit: number;
  size: number;
  _links: JiraLinks;
}

export interface JiraPage {
  id: string;
  type: string;
  status: string;
  title: string;
  macroRenderedOutput: Record<string, unknown>;
  extensions: JiraPageExtensions;
  _expandable: JiraExpandable;
  _links: JiraPageLinks;
}

export interface JiraPageExtensions {
  position: number;
}

export interface JiraExpandable {
  container: string;
  metadata: string;
  restrictions: string;
  history: string;
  body: string;
  version: string;
  descendants: string;
  space: string;
  childTypes: string;
  schedulePublishInfo: string;
  operations: string;
  schedulePublishDate: string;
  children: string;
  ancestors: string;
}

export interface JiraPageLinks {
  self: string;
  tinyui: string;
  editui: string;
  webui: string;
  edituiv2: string;
}

export interface JiraLinks {
  base: string;
  context: string;
  self: string;
}

export interface ParsedJiraPage {
  name: string;
  url: string;
  id: string;
}

export interface JiraIssue {
  id: string;
  key: string;
  fields: {
    summary: string;
    startDate?: string;
    endDate?: string;
    status: { name: string };
    _links?: { webui?: string };
  };
}

export interface JiraIssueResponse {
  issues: JiraIssue[];
}

export interface ParsedJiraTask {
  name: string;
  url: string;
  id: string;
  key: string;
  status: string;
}

// 싱크 맞추기 기능을 위한 추가 타입들
export interface JiraIssueDetail {
  id: string;
  key: string;
  fields: {
    summary: string;
    description?: string;
    timeestimate?: number;
    timeoriginalestimate?: number;
    timetracking?: {
      originalEstimate?: string;
      remainingEstimate?: string;
      originalEstimateSeconds?: number;
      remainingEstimateSeconds?: number;
    };
    duedate?: string;
    customfield_10015?: any;
    customfield_10020?:
      | string
      | number
      | { name?: string; value?: string; [key: string]: any }
      | Array<{ name?: string; value?: string; [key: string]: any }>; // sprint 필드 (다양한 구조 지원)
    assignee?: {
      accountId?: string;
      emailAddress?: string;
      displayName?: string;
    } | null;
    status: { name: string };
    issuelinks?: JiraIssueLink[];
    _links?: { webui?: string };
  };
}

export interface JiraIssueLink {
  id: string;
  type: {
    id: string;
    name: string;
    inward: string;
    outward: string;
  };
  outwardIssue?: {
    id: string;
    key: string;
    fields: {
      summary: string;
      status: { name: string };
    };
  };
  inwardIssue?: {
    id: string;
    key: string;
    fields: {
      summary: string;
      status: { name: string };
    };
  };
}

export interface JiraIssueUpdatePayload {
  fields: {
    summary?: string;
    duedate?: string;
    customfield_10015?: any;
    customfield_10020?: string | number; // sprint 필드 (ID 또는 이름)
    assignee?: {
      accountId?: string;
      emailAddress?: string;
      displayName?: string;
    } | null;
    timetracking?: {
      originalEstimate?: string;
      remainingEstimate?: string;
    };
  };
}

// GW Jira 관련 타입 정의
export interface GWJiraIssue {
  id: string;
  key: string;
  fields: {
    summary: string;
    description?: string;
    status: { name: string };
    issuetype: { name: string };
    project: { key: string };
    created: string;
    updated: string;
    assignee?: {
      accountId?: string;
      emailAddress?: string;
      displayName?: string;
    } | null;
  };
}

export interface GWJiraCreatePayload {
  fields: {
    project: { key: string };
    issuetype: { name: string };
    summary: string;
    description?: string;
    assignee?: { accountId?: string } | null;
    duedate?: string; // 마감일
    customfield_10306?: string; // HMG Jira 링크 필드
    customfield_11209?: any; // AUTOWAY의 커스텀 필드 (FEHG의 customfield_10015와 매핑)
    [key: string]: any; // 추가적인 커스텀 필드들을 위한 인덱스 시그니처
  };
}

export interface GWJiraUpdatePayload {
  fields: {
    summary?: string;
    description?: string;
    customfield_10306?: string; // HMG Jira 링크 필드
  };
}

// FEHG Epic 관련 타입
export interface FEHGEpicIssue extends JiraIssueDetail {
  fields: JiraIssueDetail['fields'] & {
    parent?: {
      id: string;
      key: string;
      fields: {
        summary: string;
      };
    };
    duedate?: string; // Epic의 마감일
    customfield_10015?: any; // FEHG의 커스텀 필드
  };
}
