import { createClient } from '@supabase/supabase-js';

const dbUrl = process.env.NEXT_PUBLIC_DB_URL!;
const dbServiceKey = process.env.DB_SERVICE_ROLE_KEY!;

export const dbServer = createClient(dbUrl, dbServiceKey);

export interface DbUser {
  igniteAccountId: string;
  igniteJiraEmail: string;
  igniteJiraApiToken: string;
}

export interface HmgDbUser {
  hmgJiraEmail: string;
  hmgJiraApiToken: string;
}

/**
 * SLACK_JIRA_USER_MAP 의 Jira accountId 로 Supabase users 테이블에서
 * 해당 사용자의 Jira 인증정보를 조회한다.
 */
export async function getJiraCredsByAccountId(
  igniteAccountId: string
): Promise<DbUser | null> {
  const { data } = await dbServer
    .from('users')
    .select('ignite_account_id, ignite_jira_email, ignite_jira_api_token')
    .eq('ignite_account_id', igniteAccountId)
    .single();

  if (!data) return null;

  return {
    igniteAccountId: data.ignite_account_id || '',
    igniteJiraEmail: data.ignite_jira_email || '',
    igniteJiraApiToken: data.ignite_jira_api_token || '',
  };
}

/**
 * Supabase settings 테이블에서 단일 설정값을 조회한다.
 * (예: 'hchat_api_key' — Chrome Extension 이 Lambda 통해 fetch)
 */
export async function getSetting(key: string): Promise<string | null> {
  const { data } = await dbServer
    .from('settings')
    .select('value')
    .eq('key', key)
    .single();
  if (!data) return null;
  return data.value || null;
}

/**
 * Supabase users 테이블에서 HMG Jira 인증정보를 조회한다.
 */
export async function getHmgCredsByAccountId(
  igniteAccountId: string
): Promise<HmgDbUser | null> {
  const { data } = await dbServer
    .from('users')
    .select('hmg_jira_email, hmg_jira_api_token')
    .eq('ignite_account_id', igniteAccountId)
    .single();

  if (!data) return null;

  return {
    hmgJiraEmail: data.hmg_jira_email || '',
    hmgJiraApiToken: data.hmg_jira_api_token || '',
  };
}
