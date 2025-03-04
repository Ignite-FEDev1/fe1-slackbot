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
