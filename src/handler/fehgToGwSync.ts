import { Block, KnownBlock } from '@slack/bolt';
import { 
  FEHG_TARGET_EPICS, 
  TicketMapping,
  GW_JIRA_CONFIG 
} from '../constant';
import {
  getFEHGEpicIssues,
  createLinkedGWTicket,
  getGWJiraIssue,
  updateGWJiraIssue,
  getFEHGEpicInfo,
  createGWEpic,
  updateFEHGTicketWithGWLink,
} from '../external';
import { FEHGEpicIssue, GWJiraIssue } from '../types/jira';

// 임시로 메모리에 매핑 정보 저장 (추후 DB나 파일로 변경 가능)
let ticketMappings: TicketMapping[] = [];

/**
 * 메인 FEHG → GW 동기화 메뉴 핸들러
 */
export const handleFEHGToGWSync = async ({ ack, respond }: any) => {
  await ack();
  
  try {
    const blocks: (Block | KnownBlock)[] = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `🔄 *FEHG → GW Jira 동기화*\n어떤 작업을 수행하시겠습니까?`,
        },
      },
      { type: 'divider' },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: '📋 에픽 목록 확인' },
            value: 'show_epic_list',
            action_id: 'show_epic_list',
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: '🚀 티켓 생성 (전체 에픽)' },
            value: 'create_all_tickets',
            action_id: 'create_all_tickets',
            style: 'primary',
          },
        ],
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: '🔄 상태 동기화' },
            value: 'sync_ticket_status',
            action_id: 'sync_ticket_status',
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: '📊 매핑 현황 확인' },
            value: 'show_mapping_status',
            action_id: 'show_mapping_status',
          },
        ],
      },
      { type: 'divider' },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*🧪 테스트 기능*',
        },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: '🧪 에픽 생성 테스트 (FEHG-1519)' },
            value: 'test_epic_creation',
            action_id: 'test_epic_creation',
            style: 'danger',
          },
        ],
      },
    ];

    await respond({ blocks });
  } catch (error) {
    console.error('FEHG → GW 동기화 메뉴 오류:', error);
    await respond({
      text: '❌ 메뉴를 불러오는 중 오류가 발생했습니다.',
    });
  }
};

/**
 * FEHG 에픽 목록 표시 핸들러
 */
export const handleShowEpicList = async ({ ack, respond }: any) => {
  await ack();
  
  try {
    const epicListText = FEHG_TARGET_EPICS.map((epicId, index) => 
      `${index + 1}. FEHG-${epicId}`
    ).join('\n');

    const blocks: (Block | KnownBlock)[] = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `📋 *대상 FEHG 에픽 목록* (총 ${FEHG_TARGET_EPICS.length}개)\n\n\`\`\`\n${epicListText}\n\`\`\``,
        },
      },
      { type: 'divider' },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '특정 에픽만 처리하려면 아래 버튼을 사용하세요:',
        },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: '🎯 특정 에픽 선택' },
            value: 'select_specific_epic',
            action_id: 'select_specific_epic',
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: '🔙 메인 메뉴' },
            value: 'fehg_gw_sync_main',
            action_id: 'fehg_gw_sync_main',
          },
        ],
      },
    ];

    await respond({ blocks });
  } catch (error) {
    console.error('에픽 목록 표시 오류:', error);
    await respond({
      text: '❌ 에픽 목록을 불러오는 중 오류가 발생했습니다.',
    });
  }
};

/**
 * 전체 에픽 티켓 생성 핸들러
 */
export const handleCreateAllTickets = async ({ ack, respond }: any) => {
  await ack();
  
  await respond({
    text: '🚀 전체 에픽의 티켓 생성을 시작합니다... 시간이 오래 걸릴 수 있습니다.',
  });

  try {
    const results = {
      success: 0,
      failed: 0,
      skipped: 0,
      details: [] as string[]
    };

    for (const epicId of FEHG_TARGET_EPICS) {
      try {
        console.log(`🔍 에픽 FEHG-${epicId} 처리 중...`);
        
        // 에픽의 하위 티켓들 조회
        const epicIssues = await getFEHGEpicIssues(epicId);
        
        if (!epicIssues || epicIssues.length === 0) {
          results.skipped++;
          results.details.push(`⏭️ FEHG-${epicId}: 하위 티켓 없음`);
          continue;
        }

        // 각 하위 티켓에 대해 GW 티켓 생성
        for (const issue of epicIssues) {
          // 이미 매핑된 티켓인지 확인
          const existingMapping = ticketMappings.find(m => m.fehg_ticket_key === issue.key);
          if (existingMapping) {
            results.skipped++;
            results.details.push(`⏭️ ${issue.key}: 이미 매핑됨 (${existingMapping.gw_ticket_key})`);
            continue;
          }

          // GW 티켓 생성 및 연결
          const result = await createLinkedGWTicket(issue);
          if (result && result.gwIssue) {
            // 매핑 정보 저장
            const mapping: TicketMapping = {
              id: `${issue.key}_${result.gwIssue.key}`,
              fehg_ticket_key: issue.key,
              fehg_ticket_id: issue.id,
              fehg_epic_id: epicId.toString(),
              gw_ticket_key: result.gwIssue.key,
              gw_ticket_id: result.gwIssue.id,
              created_at: new Date().toISOString(),
              last_synced_at: new Date().toISOString(),
              sync_status: result.success ? 'active' : 'error',
              error_message: result.success ? undefined : '링크 업데이트 실패'
            };
            ticketMappings.push(mapping);

            results.success++;
            results.details.push(`✅ ${issue.key} → ${result.gwIssue.key}`);
          } else {
            results.failed++;
            results.details.push(`❌ ${issue.key}: 생성 실패`);
          }

          // API 호출 간 대기 (Rate Limiting 방지)
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch (error) {
        console.error(`에픽 FEHG-${epicId} 처리 중 오류:`, error);
        results.failed++;
        results.details.push(`❌ FEHG-${epicId}: 처리 실패`);
      }
    }

    // 결과 리포트 생성
    const summaryText = `
📊 *티켓 생성 완료 리포트*

✅ 성공: ${results.success}개
❌ 실패: ${results.failed}개  
⏭️ 건너뜀: ${results.skipped}개

📋 *상세 결과*:
${results.details.slice(0, 20).join('\n')}
${results.details.length > 20 ? `\n... 및 ${results.details.length - 20}개 더` : ''}
    `.trim();

    await respond({
      text: summaryText,
    });

  } catch (error) {
    console.error('전체 티켓 생성 오류:', error);
    await respond({
      text: '❌ 티켓 생성 중 심각한 오류가 발생했습니다.',
    });
  }
};

/**
 * 매핑 현황 확인 핸들러
 */
export const handleShowMappingStatus = async ({ ack, respond }: any) => {
  await ack();
  
  try {
    if (ticketMappings.length === 0) {
      await respond({
        text: '📭 아직 매핑된 티켓이 없습니다. 먼저 티켓을 생성해주세요.',
      });
      return;
    }

    const statusCounts = {
      active: ticketMappings.filter(m => m.sync_status === 'active').length,
      error: ticketMappings.filter(m => m.sync_status === 'error').length,
      paused: ticketMappings.filter(m => m.sync_status === 'paused').length,
      completed: ticketMappings.filter(m => m.sync_status === 'completed').length,
    };

    const recentMappings = ticketMappings
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 10)
      .map(m => `${m.fehg_ticket_key} ↔ ${m.gw_ticket_key} (${m.sync_status})`)
      .join('\n');

    const statusText = `
📊 *티켓 매핑 현황*

**전체**: ${ticketMappings.length}개
✅ 활성: ${statusCounts.active}개
❌ 오류: ${statusCounts.error}개
⏸️ 일시정지: ${statusCounts.paused}개
✅ 완료: ${statusCounts.completed}개

📋 *최근 매핑 (최대 10개)*:
\`\`\`
${recentMappings}
\`\`\`
    `.trim();

    await respond({
      text: statusText,
    });

  } catch (error) {
    console.error('매핑 현황 확인 오류:', error);
    await respond({
      text: '❌ 매핑 현황을 확인하는 중 오류가 발생했습니다.',
    });
  }
};

/**
 * 🧪 테스트: 1519 에픽 생성 및 연결
 */
export const handleTestEpicCreation = async ({ ack, respond }: any) => {
  await ack();
  
  await respond({
    text: '🧪 FEHG-1519 에픽 테스트를 시작합니다...',
  });

  try {
    const testEpicId = 1519;
    
    // 1. FEHG 에픽 정보 조회
    console.log(`🔍 FEHG-${testEpicId} 에픽 정보 조회 중...`);
    const fehgEpic = await getFEHGEpicInfo(testEpicId);
    
    if (!fehgEpic) {
      await respond({
        text: `❌ FEHG-${testEpicId} 에픽을 찾을 수 없습니다.`,
      });
      return;
    }

    // FEHG 에픽 정보 상세 출력
    const fehgInfo = [
      `**제목**: ${fehgEpic.fields.summary}`,
      `**상태**: ${fehgEpic.fields.status.name}`,
      `**마감일**: ${fehgEpic.fields.duedate || 'N/A'}`,
      `**커스텀필드 10015**: ${fehgEpic.fields.customfield_10015 || 'N/A'}`,
    ].join('\n');

    await respond({
      text: `✅ FEHG 에픽 조회 완료\n${fehgInfo}`,
    });

    // 2. AUTOWAY에 동일한 에픽 생성
    console.log('🚀 AUTOWAY 에픽 생성 중...');
    const gwEpic = await createGWEpic(fehgEpic);
    
    if (!gwEpic) {
      await respond({
        text: '❌ AUTOWAY 에픽 생성에 실패했습니다.',
      });
      return;
    }

    await respond({
      text: `✅ AUTOWAY 에픽 생성 완료\n**티켓**: ${gwEpic.key}\n**URL**: ${GW_JIRA_CONFIG.BASE_URL}/browse/${gwEpic.key}\n\n📋 **매핑된 필드들**:\n- summary ✅\n- duedate: ${fehgEpic.fields.duedate ? '✅' : '❌'}\n- customfield_10015 → customfield_11209: ${fehgEpic.fields.customfield_10015 ? '✅' : '❌'}`,
    });

    // 3. FEHG 에픽에 AUTOWAY 링크 추가
    console.log('🔗 FEHG 에픽에 AUTOWAY 링크 추가 중...');
    const gwEpicUrl = `${GW_JIRA_CONFIG.BASE_URL}/browse/${gwEpic.key}`;
    const linkSuccess = await updateFEHGTicketWithGWLink(fehgEpic.key, gwEpicUrl);

    if (linkSuccess) {
      await respond({
        text: `🎉 테스트 완료!\n\n**FEHG 에픽**: [${fehgEpic.key}](https://ignitecorp.atlassian.net/browse/${fehgEpic.key})\n**AUTOWAY 에픽**: [${gwEpic.key}](${gwEpicUrl})\n\n✅ **연결 완료**: FEHG-${fehgEpic.key}의 customfield_10306에 AUTOWAY URL 저장됨`,
      });

      // 매핑 정보 저장
      const mapping: TicketMapping = {
        id: `${fehgEpic.key}_${gwEpic.key}`,
        fehg_ticket_key: fehgEpic.key,
        fehg_ticket_id: fehgEpic.id,
        fehg_epic_id: testEpicId.toString(),
        gw_ticket_key: gwEpic.key,
        gw_ticket_id: gwEpic.id,
        created_at: new Date().toISOString(),
        last_synced_at: new Date().toISOString(),
        sync_status: 'active',
      };
      ticketMappings.push(mapping);

    } else {
      await respond({
        text: `⚠️ AUTOWAY 에픽은 생성되었지만 FEHG 티켓의 customfield_10306 업데이트에 실패했습니다.\n**AUTOWAY 에픽**: [${gwEpic.key}](${gwEpicUrl})\n\n❌ 수동으로 FEHG-${fehgEpic.key}에 링크를 추가해주세요.`,
      });
    }

  } catch (error) {
    console.error('테스트 에픽 생성 오류:', error);
    await respond({
      text: '❌ 테스트 중 오류가 발생했습니다. 로그를 확인해주세요.',
    });
  }
};

/**
 * 상태 동기화 핸들러
 */
export const handleSyncTicketStatus = async ({ ack, respond }: any) => {
  await ack();
  
  await respond({
    text: '🔄 티켓 상태 동기화를 시작합니다...',
  });

  try {
    const activeMappings = ticketMappings.filter(m => m.sync_status === 'active');
    
    if (activeMappings.length === 0) {
      await respond({
        text: '📭 동기화할 활성 매핑이 없습니다.',
      });
      return;
    }

    const results = {
      success: 0,
      failed: 0,
      details: [] as string[]
    };

    for (const mapping of activeMappings) {
      try {
        // FEHG 티켓 상태 조회 (기존 함수 활용)
        const fehgIssues = await getFEHGEpicIssues(parseInt(mapping.fehg_epic_id));
        const fehgIssue = fehgIssues?.find(issue => issue.key === mapping.fehg_ticket_key);
        
        if (!fehgIssue) {
          results.failed++;
          results.details.push(`❌ ${mapping.fehg_ticket_key}: FEHG 티켓 조회 실패`);
          continue;
        }

        // GW 티켓 조회
        const gwIssue = await getGWJiraIssue(mapping.gw_ticket_key);
        if (!gwIssue) {
          results.failed++;
          results.details.push(`❌ ${mapping.gw_ticket_key}: GW 티켓 조회 실패`);
          continue;
        }

        // 상태가 다른 경우에만 업데이트 (여기서는 summary만 동기화 예시)
        if (fehgIssue.fields.summary !== gwIssue.fields.summary.replace('[FEHG] ', '')) {
          const updateResult = await updateGWJiraIssue(mapping.gw_ticket_key, {
            fields: {
              summary: `[FEHG] ${fehgIssue.fields.summary}`,
            }
          });

          if (updateResult) {
            results.success++;
            results.details.push(`✅ ${mapping.fehg_ticket_key} → ${mapping.gw_ticket_key}: 제목 동기화`);
            
            // 매핑 정보 업데이트
            mapping.last_synced_at = new Date().toISOString();
          } else {
            results.failed++;
            results.details.push(`❌ ${mapping.fehg_ticket_key} → ${mapping.gw_ticket_key}: 업데이트 실패`);
          }
        } else {
          results.success++;
          results.details.push(`⏭️ ${mapping.fehg_ticket_key} → ${mapping.gw_ticket_key}: 변경사항 없음`);
        }

        // API 호출 간 대기
        await new Promise(resolve => setTimeout(resolve, 500));

      } catch (error) {
        console.error(`매핑 ${mapping.id} 동기화 오류:`, error);
        results.failed++;
        results.details.push(`❌ ${mapping.fehg_ticket_key} → ${mapping.gw_ticket_key}: 처리 실패`);
      }
    }

    const summaryText = `
📊 *상태 동기화 완료*

✅ 성공: ${results.success}개
❌ 실패: ${results.failed}개

📋 *상세 결과*:
${results.details.slice(0, 15).join('\n')}
${results.details.length > 15 ? `\n... 및 ${results.details.length - 15}개 더` : ''}
    `.trim();

    await respond({
      text: summaryText,
    });

  } catch (error) {
    console.error('상태 동기화 오류:', error);
    await respond({
      text: '❌ 상태 동기화 중 심각한 오류가 발생했습니다.',
    });
  }
};
