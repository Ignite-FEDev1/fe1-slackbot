import axios from 'axios';

const auth = {
  username: 'ssj@ignite.co.kr',
  password: process.env.ATLASSIAN_TOKEN || '',
};

const JIRA_BASE_URL = 'https://ignitecorp.atlassian.net';

// 프로젝트의 모든 필드 정보 조회
export const getProjectFields = async (projectKey: string = 'FEHG') => {
  try {
    const url = `${JIRA_BASE_URL}/rest/api/3/issue/createmeta/${projectKey}/issuetypes`;

    const response = await axios.get(url, { auth });

    console.log('Available fields for project:', projectKey);
    console.log(JSON.stringify(response.data, null, 2));

    return response.data;
  } catch (error) {
    console.error('Error fetching project fields:', error);
    throw error;
  }
};

// 특정 이슈 타입의 필드 정보 조회
export const getIssueTypeFields = async (
  projectKey: string = 'FEHG',
  issueTypeId: string
) => {
  try {
    const url = `${JIRA_BASE_URL}/rest/api/3/issue/createmeta/${projectKey}/issuetypes/${issueTypeId}`;

    const response = await axios.get(url, { auth });

    console.log(`Available fields for issue type ${issueTypeId}:`);
    console.log(JSON.stringify(response.data, null, 2));

    return response.data;
  } catch (error) {
    console.error('Error fetching issue type fields:', error);
    throw error;
  }
};

// 모든 시스템 필드 조회
export const getAllFields = async () => {
  try {
    const url = `${JIRA_BASE_URL}/rest/api/3/field`;

    const response = await axios.get(url, { auth });

    console.log('All available fields:');
    response.data.forEach((field: any) => {
      console.log(
        `${field.id}: ${field.name} (${field.schema?.type || 'unknown'})`
      );
    });

    return response.data;
  } catch (error) {
    console.error('Error fetching all fields:', error);
    throw error;
  }
};

// JQL에서 사용 가능한 필드들만 필터링
export const getJqlFields = async () => {
  try {
    const allFields = await getAllFields();

    // JQL에서 사용 가능한 필드들 (일반적으로 검색 가능한 필드들)
    const jqlFields = allFields.filter((field: any) => {
      return (
        field.searchable === true ||
        field.orderable === true ||
        [
          'summary',
          'description',
          'status',
          'assignee',
          'reporter',
          'priority',
          'issuetype',
          'project',
        ].includes(field.id)
      );
    });

    console.log('JQL-compatible fields:');
    jqlFields.forEach((field: any) => {
      console.log(`${field.id}: ${field.name}`);
    });

    return jqlFields;
  } catch (error) {
    console.error('Error fetching JQL fields:', error);
    throw error;
  }
};
