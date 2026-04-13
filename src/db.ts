import { createClient } from '@supabase/supabase-js';

const dbUrl = process.env.NEXT_PUBLIC_DB_URL!;
const dbServiceKey = process.env.DB_SERVICE_ROLE_KEY!;

export const dbServer = createClient(dbUrl, dbServiceKey);

export interface DbUser {
  igniteAccountId: string;
  igniteJiraEmail: string;
  igniteJiraApiToken: string;
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
