import { Block, KnownBlock } from '@slack/bolt';
import axios from 'axios';
import { getUserId } from '..';
import { JIRA_BOARD_IDS, SLACK_JIRA_USER_MAP } from '../constant';
import {
  JiraIssueDetail,
  JiraIssueLink,
  JiraIssueUpdatePayload,
} from '../types/jira';

const auth = {
  username: 'ssj@ignite.co.kr',
  password: process.env.ATLASSIAN_TOKEN || '',
};

const JIRA_BASE_URL = 'https://ignitecorp.atlassian.net';

// 진행중, 예정 상태의 티켓 조회
const getInProgressAndPlannedIssues = async (): Promise<JiraIssueDetail[]> => {
  try {
    const jql = `assignee IN (${
      SLACK_JIRA_USER_MAP[getUserId()]
    }) AND status IN ("In Progress", "To Do")`;

    const jiraApiUrl = `${JIRA_BASE_URL}/rest/agile/1.0/board/${
      JIRA_BOARD_IDS['FEHG']
    }/issue?jql=${encodeURIComponent(jql)}&expand=issuelinks`;

    if (!auth.password) {
      throw new Error('ATLASSIAN_TOKEN이 설정되지 않았습니다.');
    }

    const response = await axios.get(jiraApiUrl, { auth });

    if (!response?.data?.issues || response.data.issues.length === 0) {
      return [];
    }

    return response.data.issues;
  } catch (error) {
    console.error('Error fetching in-progress and planned issues:', error);
    throw error;
  }
};

// 특정 이슈의 상세 정보 조회
const getIssueDetail = async (issueKey: string): Promise<JiraIssueDetail> => {
  try {
    const jiraApiUrl = `${JIRA_BASE_URL}/rest/api/3/issue/${issueKey}?expand=issuelinks`;

    const response = await axios.get<JiraIssueDetail>(jiraApiUrl, { auth });
    return response.data;
  } catch (error) {
    console.error(`Error fetching issue detail for ${issueKey}:`, error);
    throw error;
  }
};

// 이슈 업데이트 (API 사용량 제한 처리 포함)
const updateIssue = async (
  issueKey: string,
  updatePayload: JiraIssueUpdatePayload
): Promise<void> => {
  try {
    const jiraApiUrl = `${JIRA_BASE_URL}/rest/api/3/issue/${issueKey}`;

    await axios.put(jiraApiUrl, updatePayload, { auth });

    // API 사용량 제한을 위한 지연 (초당 10개 요청 제한)
    // timeout 문제를 해결하기 위해 지연 시간을 줄임
    await new Promise((resolve) => setTimeout(resolve, 50));
  } catch (error: any) {
    if (error.response?.status === 429) {
      console.error(`API 사용량 제한 도달: ${issueKey}`);
      throw new Error(`API 사용량 제한으로 인한 실패: ${issueKey}`);
    } else if (error.response?.status === 403) {
      console.error(`권한 없음: ${issueKey}`);
      throw new Error(`권한 없음: ${issueKey}`);
    } else if (error.response?.status === 400) {
      console.error(`Bad Request for ${issueKey}:`, {
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data,
        errors: error.response.data?.errors,
        errorMessages: error.response.data?.errorMessages,
      });
      throw new Error(
        `Bad Request for ${issueKey}: ${JSON.stringify(error.response.data)}`
      );
    } else {
      console.error(`Error updating issue ${issueKey}:`, error);
      throw error;
    }
  }
};

// Blocks로 연결된 이슈들 찾기 (HB 프로젝트만)
const findBlocksIssues = (issueLinks: JiraIssueLink[]): string[] => {
  const blocksIssueKeys: string[] = [];

  issueLinks.forEach((link) => {
    // Blocks 관계 확인 (inward 또는 outward)
    if (
      link.type.name.toLowerCase().includes('blocks') ||
      link.type.inward.toLowerCase().includes('blocks') ||
      link.type.outward.toLowerCase().includes('blocks')
    ) {
      if (link.outwardIssue && link.outwardIssue.key.startsWith('HB')) {
        blocksIssueKeys.push(link.outwardIssue.key);
      }
      if (link.inwardIssue && link.inwardIssue.key.startsWith('HB')) {
        blocksIssueKeys.push(link.inwardIssue.key);
      }
    }
  });

  return [...new Set(blocksIssueKeys)]; // 중복 제거
};

// 싱크 맞추기 실행
const syncBlocksIssues = async (): Promise<{
  success: Array<{
    sourceKey: string;
    sourceSummary: string;
    targetKey: string;
  }>;
  failed: string[];
  details: string[];
  processedIssues: number;
  totalIssues: number;
}> => {
  const success: Array<{
    sourceKey: string;
    sourceSummary: string;
    targetKey: string;
  }> = [];
  const failed: string[] = [];
  const details: string[] = [];
  let processedIssues = 0; // 실제로 업데이트를 시도한 이슈 수

  try {
    console.log('🔄 싱크 맞추기 시작...');

    // 진행중, 예정 상태의 티켓들 조회
    const issues = await getInProgressAndPlannedIssues();
    console.log(`📋 조회된 진행중/예정 티켓 수: ${issues.length}`);

    for (const issue of issues) {
      try {
        console.log(`\n🔍 처리 중: ${issue.key} - ${issue.fields.summary}`);

        // Blocks로 연결된 이슈들 찾기
        const blocksIssueKeys = findBlocksIssues(issue.fields.issuelinks || []);

        if (blocksIssueKeys.length === 0) {
          console.log(`  ⚠️  ${issue.key}에 Blocks 관계가 없습니다.`);
          continue; // Blocks 이슈가 없으면 건너뛰기
        }

        console.log(`  📎 Blocks 관계 발견: ${blocksIssueKeys.join(', ')}`);
        processedIssues++; // 실제로 업데이트를 시도하는 이슈 카운트

        // 현재 이슈의 정보로 업데이트할 페이로드 생성
        const updatePayload: JiraIssueUpdatePayload = {
          fields: {
            summary: issue.fields.summary,
            duedate: issue.fields.duedate,
            customfield_10015: issue.fields.customfield_10015,
            assignee: issue.fields.assignee,
            timetracking: issue.fields.timetracking,
          },
        };

        console.log(`  📝 업데이트할 내용:`, {
          summary: issue.fields.summary,
          duedate: issue.fields.duedate,
          customfield_10015: issue.fields.customfield_10015,
          assignee: issue.fields.assignee,
          timetracking: issue.fields.timetracking,
        });

        // Blocks 이슈들 업데이트
        for (const blocksKey of blocksIssueKeys) {
          try {
            console.log(`    🔄 ${blocksKey} 업데이트 중...`);
            await updateIssue(blocksKey, updatePayload);
            success.push({
              sourceKey: issue.key,
              sourceSummary: issue.fields.summary,
              targetKey: blocksKey,
            });
            console.log(`    ✅ ${blocksKey} 업데이트 성공`);
          } catch (error) {
            console.error(`    ❌ Failed to update ${blocksKey}:`, error);
            failed.push(`${issue.key} → ${blocksKey}`);
            details.push(`실패: ${blocksKey} - ${error}`);
          }
        }
      } catch (error) {
        console.error(`❌ Error processing issue ${issue.key}:`, error);
        failed.push(issue.key);
        details.push(`처리 실패: ${issue.key} - ${error}`);
      }
    }

    console.log(
      `\n🎉 싱크 맞추기 완료! 처리된 이슈: ${processedIssues}개, 성공: ${success.length}, 실패: ${failed.length}`
    );
    return {
      success,
      failed,
      details,
      processedIssues,
      totalIssues: issues.length,
    };
  } catch (error) {
    console.error('❌ Error in syncBlocksIssues:', error);
    throw error;
  }
};

// 슬랙 응답 블록 생성
const createSyncResultBlocks = (
  success: Array<{
    sourceKey: string;
    sourceSummary: string;
    targetKey: string;
  }>,
  failed: string[],
  details: string[],
  processedIssues: number,
  totalIssues: number
): (Block | KnownBlock)[] => {
  const blocks: (Block | KnownBlock)[] = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `🔄 *Blocks 싱크 맞추기 완료!*\n• 총 조회된 이슈: ${totalIssues}개\n• Blocks 관계가 있는 이슈: ${processedIssues}개`,
      },
    },
    { type: 'divider' },
  ];

  if (success.length > 0) {
    // 성공한 동기화가 많을 경우 요약만 표시
    if (success.length <= 10) {
      // 10개 이하면 전체 목록 표시
      const successList = success
        .map(
          (item) =>
            `• <https://ignitecorp.atlassian.net/browse/${item.sourceKey}|${item.sourceSummary}> → <https://ignitecorp.atlassian.net/browse/${item.targetKey}|${item.targetKey}>`
        )
        .join('\n');

      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `✅ *성공한 동기화* (${success.length}개)\n${successList}`,
        },
      });
    } else {
      // 10개 초과하면 요약만 표시
      const targetKeys = success.map((item) => item.targetKey).join(', ');

      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `✅ *성공한 동기화* (${success.length}개)\n📋 *동기화된 HB 티켓:*\n${targetKeys}`,
        },
      });
    }
  }

  if (failed.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `❌ *실패한 동기화* (${failed.length}개)\n${failed
          .map((item) => `• ${item}`)
          .join('\n')}`,
      },
    });
  }

  if (details.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `📋 *상세 정보*\n${details
          .slice(0, 5) // 최대 5개만 표시
          .map((item) => `• ${item}`)
          .join('\n')}${details.length > 5 ? '\n...' : ''}`,
      },
    });
  }

  if (success.length === 0 && failed.length === 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: 'ℹ️ 동기화할 Blocks 이슈가 없습니다.',
      },
    });
  }

  return blocks;
};

// 메인 핸들러 함수
export const handleSyncIssues = async ({ ack, respond }: any) => {
  await ack();

  try {
    console.log('🚀 싱크 맞추기 작업 시작...');

    const { success, failed, details, processedIssues, totalIssues } =
      await syncBlocksIssues();

    console.log(
      `📊 작업 완료 - 총 이슈: ${totalIssues}개, 처리된 이슈: ${processedIssues}개, 성공: ${success.length}, 실패: ${failed.length}`
    );

    // Slack에 상세한 결과 전송
    const blocks = createSyncResultBlocks(
      success,
      failed,
      details,
      processedIssues,
      totalIssues
    );
    await respond({ blocks });

    // 작업 요약 정보 전송
    const summaryText = `🎯 *작업 요약*\n• 총 조회된 이슈: ${totalIssues}개\n• Blocks 관계가 있는 이슈: ${processedIssues}개\n• 동기화 시도: ${
      success.length + failed.length
    }개\n• 성공: ${success.length}개\n• 실패: ${
      failed.length
    }개\n• 완료 시간: ${new Date().toLocaleString('ko-KR')}`;

    // 성공한 동기화 목록 전송
    if (success.length > 0) {
      // 모든 성공한 동기화를 하나의 메시지로 통합
      const allSuccessList = success
        .map(
          (item) =>
            `• <https://ignitecorp.atlassian.net/browse/${item.targetKey}|${item.targetKey}>`
        )
        .join('\n');

      await respond({
        text: `${summaryText} \n\n ✅ *싱크 맞추기 완료!* ${processedIssues}개의 이슈에서 ${success.length}개의 동기화가 성공했습니다.\n\n📋 *성공한 동기화 목록:*\n${allSuccessList}`,
      });
    } else if (failed.length > 0) {
      await respond({
        text: `${summaryText} \n\n ⚠️ *싱크 맞추기 완료* ${processedIssues}개의 이슈에서 모든 동기화가 실패했습니다. 상세 정보를 확인해주세요.`,
      });
    } else {
      await respond({
        text: `${summaryText} \n\n ℹ️ *싱크 맞추기 완료* ${totalIssues}개 이슈 중 Blocks 관계가 있는 이슈가 없었습니다.`,
      });
    }
  } catch (error) {
    console.error('Error in handleSyncIssues:', error);
    await respond({
      text: '❌ *싱크 맞추기 중 오류가 발생했습니다.*\n오류를 확인하고 다시 시도해주세요.',
    });
  }
};
