import { Block, KnownBlock } from '@slack/bolt';
import axios from 'axios';
import { getUserId } from '..';
import {
  JIRA_BOARD_IDS,
  SLACK_JIRA_USER_MAP,
  SYNC_FIELD_CONFIG,
  SyncType,
  findMatchingSprint,
  SPRINT_CACHE_CONFIG,
} from '../constant';
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

// 스프린트 캐시 시스템
interface SprintCache {
  [boardId: number]: {
    sprints: Array<{ name: string; id: number }>;
    timestamp: number;
    ttl: number; // 캐시 유효 시간 (밀리초)
  };
}

const sprintCache: SprintCache = {};
const CACHE_TTL = SPRINT_CACHE_CONFIG.TTL; // 5분 캐시

// 캐시된 스프린트 조회 함수
const getCachedBoardSprints = async (
  boardId: number
): Promise<Array<{ name: string; id: number }>> => {
  const now = Date.now();
  const cached = sprintCache[boardId];

  // 캐시가 있고 유효한 경우
  if (cached && now - cached.timestamp < cached.ttl) {
    console.log(`📦 캐시된 스프린트 데이터 사용 (보드 ${boardId})`);
    return cached.sprints;
  }

  // 캐시가 없거나 만료된 경우 새로 조회 (재시도 로직 포함)
  console.log(`🔄 스프린트 데이터 새로 조회 (보드 ${boardId})`);

  let lastError: any;
  for (let attempt = 1; attempt <= SPRINT_CACHE_CONFIG.MAX_RETRIES; attempt++) {
    try {
      const sprints = await getBoardSprints(boardId);

      // 캐시에 저장
      sprintCache[boardId] = {
        sprints,
        timestamp: now,
        ttl: CACHE_TTL,
      };

      console.log(
        `💾 스프린트 데이터 캐시 저장 (보드 ${boardId}, ${sprints.length}개)`
      );
      return sprints;
    } catch (error) {
      lastError = error;
      console.warn(
        `⚠️ 스프린트 조회 실패 (시도 ${attempt}/${SPRINT_CACHE_CONFIG.MAX_RETRIES}):`,
        error
      );

      if (attempt < SPRINT_CACHE_CONFIG.MAX_RETRIES) {
        await new Promise((resolve) =>
          setTimeout(resolve, SPRINT_CACHE_CONFIG.RETRY_DELAY)
        );
      }
    }
  }

  // 모든 재시도 실패 시 에러 발생
  console.error(`❌ 스프린트 조회 최종 실패 (보드 ${boardId}):`, lastError);
  throw lastError;
};

// 캐시 무효화 함수 (필요시 사용)
export const invalidateSprintCache = (boardId?: number) => {
  if (boardId) {
    delete sprintCache[boardId];
    console.log(`🗑️ 스프린트 캐시 무효화 (보드 ${boardId})`);
  } else {
    Object.keys(sprintCache).forEach(
      (key) => delete sprintCache[parseInt(key)]
    );
    console.log('🗑️ 모든 스프린트 캐시 무효화');
  }
};

// 캐시 상태 확인 함수
export const getSprintCacheStatus = () => {
  const now = Date.now();
  const status: { [boardId: string]: any } = {};

  Object.entries(sprintCache).forEach(([boardId, cache]) => {
    const isValid = now - cache.timestamp < cache.ttl;
    const remainingTime = Math.max(0, cache.ttl - (now - cache.timestamp));

    status[boardId] = {
      hasCache: true,
      isValid,
      remainingTime: Math.round(remainingTime / 1000), // 초 단위
      sprintCount: cache.sprints.length,
      lastUpdated: new Date(cache.timestamp).toLocaleString('ko-KR'),
    };
  });

  return status;
};

// 싱크 타입에 따른 업데이트 페이로드 생성
const createUpdatePayload = async (
  issue: JiraIssueDetail,
  syncType: SyncType,
  targetBoardId?: number
): Promise<JiraIssueUpdatePayload> => {
  const config = SYNC_FIELD_CONFIG[syncType];
  const fields: Partial<JiraIssueUpdatePayload['fields']> = {};

  for (const fieldName of config.fields) {
    switch (fieldName) {
      case 'summary':
        fields.summary = issue.fields.summary;
        break;
      case 'duedate':
        fields.duedate = issue.fields.duedate;
        break;
      case 'customfield_10015':
        fields.customfield_10015 = issue.fields.customfield_10015;
        break;
      case 'assignee':
        fields.assignee = issue.fields.assignee;
        break;
      case 'timetracking':
        fields.timetracking = issue.fields.timetracking;
        break;
      case 'customfield_10020':
        // 스프린트 매핑 처리
        if (targetBoardId && issue.fields.customfield_10020) {
          const sourceSprintField = issue.fields.customfield_10020;

          // 디버깅: 실제 데이터 구조 확인
          console.log(`🔍 Sprint field type: ${typeof sourceSprintField}`);
          console.log(`🔍 Sprint field value:`, sourceSprintField);

          // 스프린트 이름 추출
          let sourceSprintName: string | null = null;

          if (typeof sourceSprintField === 'string') {
            sourceSprintName = sourceSprintField;
          } else if (Array.isArray(sourceSprintField)) {
            // 배열인 경우 첫 번째 스프린트의 name 사용
            if (sourceSprintField.length > 0 && sourceSprintField[0].name) {
              sourceSprintName = sourceSprintField[0].name;
            }
          } else if (
            sourceSprintField &&
            typeof sourceSprintField === 'object'
          ) {
            const sprintObj = sourceSprintField as any;
            sourceSprintName = sprintObj.name || sprintObj.value || null;
          }

          if (!sourceSprintName) {
            console.warn(
              `⚠️ 스프린트 이름을 추출할 수 없음:`,
              sourceSprintField
            );
            continue; // 스프린트 필드 처리 건너뛰기
          }

          const targetSprints = await getCachedBoardSprints(targetBoardId);
          const matchingSprint = findMatchingSprint(
            sourceSprintName,
            targetSprints,
            syncType
          );

          if (matchingSprint) {
            // 스프린트 업데이트 시 ID를 사용
            fields.customfield_10020 = matchingSprint.id;
            console.log(
              `스프린트 매핑 성공: ${sourceSprintName} → ${matchingSprint.name} (ID: ${matchingSprint.id})`
            );
          } else {
            console.log(
              `스프린트 매핑 실패: ${sourceSprintName}에 대응하는 스프린트가 없습니다.`
            );
            // 매핑되는 스프린트가 없으면 스프린트 필드를 업데이트하지 않음
          }
        }
        break;
    }
  }

  return { fields };
};

// 진행중, 예정 상태의 티켓 조회 (보드별)
const getInProgressAndPlannedIssues = async (
  boardKey: keyof typeof JIRA_BOARD_IDS
): Promise<JiraIssueDetail[]> => {
  try {
    const jql = `assignee IN (${
      SLACK_JIRA_USER_MAP[getUserId()]
    }) AND status IN ("In Progress", "To Do")`;

    const jiraApiUrl = `${JIRA_BASE_URL}/rest/agile/1.0/board/${
      JIRA_BOARD_IDS[boardKey]
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

// 보드의 스프린트 목록 조회 (페이지네이션 처리)
const getBoardSprints = async (
  boardId: number
): Promise<Array<{ name: string; id: number }>> => {
  try {
    const allSprints: Array<{ name: string; id: number }> = [];
    let startAt = 0;
    const maxResults = 50; // JIRA API 기본 제한
    let isLast = false;

    while (!isLast) {
      const jiraApiUrl = `${JIRA_BASE_URL}/rest/agile/1.0/board/${boardId}/sprint?state=active,future,closed&maxResults=${maxResults}&startAt=${startAt}`;

      console.log(
        `📄 스프린트 조회 중... (시작: ${startAt}, 최대: ${maxResults})`
      );

      const response = await axios.get(jiraApiUrl, { auth });

      if (!response?.data?.values) {
        console.warn(`⚠️ 스프린트 데이터가 없습니다. (보드 ${boardId})`);
        break;
      }

      const sprints = response.data.values.map((sprint: any) => ({
        name: sprint.name,
        id: sprint.id,
      }));

      allSprints.push(...sprints);

      // 페이지네이션 정보 업데이트
      isLast = response.data.isLast;
      startAt += maxResults;

      console.log(`📊 현재까지 조회된 스프린트: ${allSprints.length}개`);

      // API 사용량 제한을 위한 짧은 지연
      if (!isLast) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    console.log(
      `✅ 총 ${allSprints.length}개의 스프린트 조회 완료 (보드 ${boardId})`
    );
    return allSprints;
  } catch (error) {
    console.error(`Error fetching sprints for board ${boardId}:`, error);
    return [];
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

// Blocks로 연결된 이슈들 찾기 (싱크 타입에 따라)
const findBlocksIssues = (
  issueLinks: JiraIssueLink[],
  syncType: SyncType
): string[] => {
  const blocksIssueKeys: string[] = [];

  // 싱크 타입에 따른 타겟 프로젝트 키 결정
  let targetProjectKey: string;
  switch (syncType) {
    case 'FEHG_TO_HB':
      targetProjectKey = 'HB';
      break;
    case 'FEHG_TO_KQ':
      targetProjectKey = 'KQ';
      break;
    default:
      console.warn(`⚠️ 알 수 없는 싱크 타입: ${syncType}`);
      return [];
  }

  issueLinks.forEach((link) => {
    // Blocks 관계 확인 (inward 또는 outward)
    if (
      link.type.name.toLowerCase().includes('blocks') ||
      link.type.inward.toLowerCase().includes('blocks') ||
      link.type.outward.toLowerCase().includes('blocks')
    ) {
      if (
        link.outwardIssue &&
        link.outwardIssue.key.startsWith(targetProjectKey)
      ) {
        blocksIssueKeys.push(link.outwardIssue.key);
      }
      // if (link.inwardIssue && link.inwardIssue.key.startsWith(targetProjectKey)) {
      //   blocksIssueKeys.push(link.inwardIssue.key);
      // }
    }
  });

  return [...new Set(blocksIssueKeys)]; // 중복 제거
};

// 싱크 맞추기 실행 (보드별)
const syncBlocksIssues = async (
  boardKey: keyof typeof JIRA_BOARD_IDS,
  targetBoard: string,
  syncType: SyncType
): Promise<{
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
    console.log(`🔄 ${boardKey} → ${targetBoard} 싱크 맞추기 시작...`);

    // 진행중, 예정 상태의 티켓들 조회
    const issues = await getInProgressAndPlannedIssues(boardKey);
    console.log(`📋 조회된 진행중/예정 티켓 수: ${issues.length}`);

    for (const issue of issues) {
      try {
        console.log(`\n🔍 처리 중: ${issue.key} - ${issue.fields.summary}`);

        // Blocks로 연결된 이슈들 찾기
        const blocksIssueKeys = findBlocksIssues(
          issue.fields.issuelinks || [],
          syncType
        );

        if (blocksIssueKeys.length === 0) {
          console.log(`  ⚠️  ${issue.key}에 Blocks 관계가 없습니다.`);
          continue; // Blocks 이슈가 없으면 건너뛰기
        }

        console.log(`  📎 Blocks 관계 발견: ${blocksIssueKeys.join(', ')}`);
        processedIssues++; // 실제로 업데이트를 시도하는 이슈 카운트

        // 싱크 타입에 따른 업데이트 페이로드 생성
        const targetBoardId = (() => {
          switch (syncType) {
            case 'FEHG_TO_HB':
              return JIRA_BOARD_IDS.HB;
            case 'FEHG_TO_KQ':
              return JIRA_BOARD_IDS.KQ;
            default:
              return undefined;
          }
        })();
        const updatePayload = await createUpdatePayload(
          issue,
          syncType,
          targetBoardId
        );

        console.log(
          `  📝 업데이트할 내용 (${syncType}):`,
          updatePayload.fields
        );

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

// FEHG → HB 싱크 핸들러
export const handleSyncIssuesFehgToHb = async ({ ack, respond }: any) => {
  await ack();

  try {
    console.log('🚀 FEHG → HB 싱크 맞추기 작업 시작...');

    const { success, failed, details, processedIssues, totalIssues } =
      await syncBlocksIssues('FEHG', 'HB', 'FEHG_TO_HB');

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
    const summaryText = `🎯 *FEHG → HB 싱크 작업 요약*\n• 총 조회된 이슈: ${totalIssues}개\n• Blocks 관계가 있는 이슈: ${processedIssues}개\n• 동기화 시도: ${
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
        text: `${summaryText} \n\n ✅ *FEHG → HB 싱크 맞추기 완료!* ${processedIssues}개의 이슈에서 ${success.length}개의 동기화가 성공했습니다.\n\n📋 *성공한 동기화 목록:*\n${allSuccessList}`,
      });
    } else if (failed.length > 0) {
      await respond({
        text: `${summaryText} \n\n ⚠️ *FEHG → HB 싱크 맞추기 완료* ${processedIssues}개의 이슈에서 모든 동기화가 실패했습니다. 상세 정보를 확인해주세요.`,
      });
    } else {
      await respond({
        text: `${summaryText} \n\n ℹ️ *FEHG → HB 싱크 맞추기 완료* ${totalIssues}개 이슈 중 Blocks 관계가 있는 이슈가 없었습니다.`,
      });
    }
  } catch (error) {
    console.error('Error in handleSyncIssuesFehgToHb:', error);
    await respond({
      text: '❌ *FEHG → HB 싱크 맞추기 중 오류가 발생했습니다.*\n오류를 확인하고 다시 시도해주세요.',
    });
  }
};

// FEHG → KQ 싱크 핸들러
export const handleSyncIssuesFehgToKq = async ({ ack, respond }: any) => {
  await ack();

  try {
    console.log('🚀 FEHG → KQ 싱크 맞추기 작업 시작...');

    const { success, failed, details, processedIssues, totalIssues } =
      await syncBlocksIssues('FEHG', 'KQ', 'FEHG_TO_KQ');

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
    const summaryText = `🎯 *FEHG → KQ 싱크 작업 요약*\n• 총 조회된 이슈: ${totalIssues}개\n• Blocks 관계가 있는 이슈: ${processedIssues}개\n• 동기화 시도: ${
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
        text: `${summaryText} \n\n ✅ *FEHG → KQ 싱크 맞추기 완료!* ${processedIssues}개의 이슈에서 ${success.length}개의 동기화가 성공했습니다.\n\n📋 *성공한 동기화 목록:*\n${allSuccessList}`,
      });
    } else if (failed.length > 0) {
      await respond({
        text: `${summaryText} \n\n ⚠️ *FEHG → KQ 싱크 맞추기 완료* ${processedIssues}개의 이슈에서 모든 동기화가 실패했습니다. 상세 정보를 확인해주세요.`,
      });
    } else {
      await respond({
        text: `${summaryText} \n\n ℹ️ *FEHG → KQ 싱크 맞추기 완료* ${totalIssues}개 이슈 중 Blocks 관계가 있는 이슈가 없었습니다.`,
      });
    }
  } catch (error) {
    console.error('Error in handleSyncIssuesFehgToKq:', error);
    await respond({
      text: '❌ *FEHG → KQ 싱크 맞추기 중 오류가 발생했습니다.*\n오류를 확인하고 다시 시도해주세요.',
    });
  }
};

// 기존 호환성을 위한 핸들러 (FEHG → HB로 기본 동작)
export const handleSyncIssues = async ({ ack, respond }: any) => {
  return handleSyncIssuesFehgToHb({ ack, respond });
};
