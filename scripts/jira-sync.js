#!/usr/bin/env node

/**
 * FEHG → GW Jira 연동 스크립트
 * VPN 환경에서 직접 실행 가능한 Node.js 스크립트
 */

require('dotenv').config();

// 빌드된 앱에서 함수들을 가져오기 위해 임시로 external 함수들을 직접 구현
const axios = require('axios');

// 상수들
const FEHG_TARGET_EPICS = [
  1519, 1637, 1617, 1618, 1619, 1620, 1621, 1622, 1623, 1624, 
  1625, 1626, 1627, 1628, 1629, 1630, 1631, 1632, 1633, 1634, 
  1635, 1640, 1748
];

const GW_JIRA_CONFIG = {
  BASE_URL: 'https://jira.hmg-corp.io',
  PROJECT_KEY: 'AUTOWAY',
  TOKEN: process.env.GW_JIRA_TOKEN || '',
};

const FEHG_LINK_FIELD = 'customfield_10306';

// FEHG Jira 인증
const fehgAuth = {
  username: 'ssj@ignite.co.kr',
  password: process.env.ATLASSIAN_TOKEN || '',
};

// GW Jira 인증 헤더
const gwJiraHeaders = {
  'Authorization': `Bearer ${GW_JIRA_CONFIG.TOKEN}`,
  'Content-Type': 'application/json; charset=UTF-8',
  'Accept': 'application/json',
};

// FEHG 에픽 정보 조회
async function getFEHGEpicInfo(epicId) {
  try {
    const jiraApiUrl = `https://ignitecorp.atlassian.net/rest/api/2/issue/FEHG-${epicId}`;
    const response = await axios.get(jiraApiUrl, { auth: fehgAuth });
    return response.data;
  } catch (error) {
    console.error(`FEHG 에픽 ${epicId} 조회 실패:`, error.message);
    return null;
  }
}

// GW 에픽 생성
async function createGWEpic(fehgEpic) {
  try {
    const fehgUrl = `https://ignitecorp.atlassian.net/browse/${fehgEpic.key}`;
    const gwDescription = `
[자동 생성] FEHG 에픽 연동

**원본 FEHG 에픽**: [${fehgEpic.key}](${fehgUrl})

**원본 설명**:
${fehgEpic.fields.description || '설명 없음'}

---
*이 에픽은 FEHG-${fehgEpic.key}와 연동됩니다.*
    `.trim();

    const createPayload = {
      fields: {
        project: { key: GW_JIRA_CONFIG.PROJECT_KEY },
        issuetype: { name: 'Epic' },
        summary: `[FEHG] ${fehgEpic.fields.summary}`,
        description: gwDescription,
      }
    };

    // duedate 매핑 (있는 경우에만)
    if (fehgEpic.fields.duedate) {
      createPayload.fields.duedate = fehgEpic.fields.duedate;
    }

    // customfield_10015 → customfield_11209 매핑 (있는 경우에만)
    if (fehgEpic.fields.customfield_10015) {
      createPayload.fields.customfield_11209 = fehgEpic.fields.customfield_10015;
    }

    const url = `${GW_JIRA_CONFIG.BASE_URL}/rest/api/2/issue`;
    const response = await axios.post(url, createPayload, { headers: gwJiraHeaders });
    return response.data;
  } catch (error) {
    console.error('GW 에픽 생성 실패:', error.message);
    return null;
  }
}

// FEHG 티켓에 GW 링크 추가
async function updateFEHGTicketWithGWLink(fehgKey, gwTicketUrl) {
  try {
    const url = `https://ignitecorp.atlassian.net/rest/api/2/issue/${fehgKey}`;
    const payload = {
      fields: {
        [FEHG_LINK_FIELD]: gwTicketUrl
      }
    };

    await axios.put(url, payload, { auth: fehgAuth });
    return true;
  } catch (error) {
    console.error(`FEHG 티켓 ${fehgKey} 링크 업데이트 실패:`, error.message);
    return false;
  }
}

// 콘솔 색상 헬퍼
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSuccess(message) {
  log(`✅ ${message}`, 'green');
}

function logError(message) {
  log(`❌ ${message}`, 'red');
}

function logInfo(message) {
  log(`ℹ️  ${message}`, 'blue');
}

function logWarning(message) {
  log(`⚠️  ${message}`, 'yellow');
}

/**
 * 에픽 생성 테스트 (FEHG-1519)
 */
async function testEpicCreation() {
  log('\n🧪 FEHG-1519 에픽 생성 테스트를 시작합니다...', 'cyan');
  
  try {
    const testEpicId = 1519;
    
    // 1. FEHG 에픽 정보 조회
    logInfo(`FEHG-${testEpicId} 에픽 정보 조회 중...`);
    const fehgEpic = await getFEHGEpicInfo(testEpicId);
    
    if (!fehgEpic) {
      logError(`FEHG-${testEpicId} 에픽을 찾을 수 없습니다.`);
      return false;
    }

    // FEHG 에픽 정보 출력
    log('\n📋 FEHG 에픽 정보:', 'bright');
    console.log(`   제목: ${fehgEpic.fields.summary}`);
    console.log(`   상태: ${fehgEpic.fields.status.name}`);
    console.log(`   마감일: ${fehgEpic.fields.duedate || 'N/A'}`);
    console.log(`   커스텀필드 10015: ${fehgEpic.fields.customfield_10015 || 'N/A'}`);

    // 2. AUTOWAY에 동일한 에픽 생성
    logInfo('AUTOWAY 에픽 생성 중...');
    const gwEpic = await createGWEpic(fehgEpic);
    
    if (!gwEpic) {
      logError('AUTOWAY 에픽 생성에 실패했습니다.');
      return false;
    }

    const gwEpicUrl = `${GW_JIRA_CONFIG.BASE_URL}/browse/${gwEpic.key}`;
    logSuccess(`AUTOWAY 에픽 생성 완료: ${gwEpic.key}`);
    console.log(`   URL: ${gwEpicUrl}`);

    // 매핑된 필드들 확인
    log('\n📋 매핑된 필드들:', 'bright');
    console.log(`   summary: ✅`);
    console.log(`   duedate: ${fehgEpic.fields.duedate ? '✅' : '❌'}`);
    console.log(`   customfield_10015 → customfield_11209: ${fehgEpic.fields.customfield_10015 ? '✅' : '❌'}`);

    // 3. FEHG 에픽에 AUTOWAY 링크 추가
    logInfo('FEHG 에픽에 AUTOWAY 링크 추가 중...');
    const linkSuccess = await updateFEHGTicketWithGWLink(fehgEpic.key, gwEpicUrl);

    if (linkSuccess) {
      logSuccess('양방향 링크 연결 완료!');
      console.log(`\n🎉 테스트 완료!`);
      console.log(`   FEHG 에픽: https://ignitecorp.atlassian.net/browse/${fehgEpic.key}`);
      console.log(`   AUTOWAY 에픽: ${gwEpicUrl}`);
      console.log(`   연결 상태: FEHG-${fehgEpic.key}의 customfield_10306에 AUTOWAY URL 저장됨`);
    } else {
      logWarning('AUTOWAY 에픽은 생성되었지만 FEHG 링크 업데이트에 실패했습니다.');
      console.log(`   AUTOWAY 에픽: ${gwEpicUrl}`);
      console.log(`   수동으로 FEHG-${fehgEpic.key}에 링크를 추가해주세요.`);
    }

    return true;
  } catch (error) {
    logError(`테스트 중 오류 발생: ${error.message}`);
    console.error(error);
    return false;
  }
}

/**
 * 에픽 목록 표시
 */
async function showEpicList() {
  log('\n📋 대상 FEHG 에픽 목록', 'cyan');
  console.log(`총 ${FEHG_TARGET_EPICS.length}개 에픽:\n`);
  
  FEHG_TARGET_EPICS.forEach((epicId, index) => {
    console.log(`${(index + 1).toString().padStart(2, ' ')}. FEHG-${epicId}`);
  });
  
  console.log('');
}

/**
 * 특정 에픽의 하위 티켓들 처리 (준비 중)
 */
async function processEpicTickets(epicId) {
  log(`\n🔄 FEHG-${epicId} 에픽의 하위 티켓들 처리 중...`, 'cyan');
  
  try {
    const epicIssues = await getFEHGEpicIssues(epicId);
    
    if (!epicIssues || epicIssues.length === 0) {
      logWarning(`FEHG-${epicId}에 하위 티켓이 없습니다.`);
      return;
    }

    logInfo(`${epicIssues.length}개의 하위 티켓을 찾았습니다.`);
    
    // TODO: 각 티켓을 GW에 생성하는 로직 구현
    epicIssues.forEach((issue, index) => {
      console.log(`${index + 1}. ${issue.key}: ${issue.fields.summary}`);
    });
    
    logWarning('하위 티켓 생성 기능은 아직 구현되지 않았습니다.');
  } catch (error) {
    logError(`에픽 ${epicId} 처리 중 오류: ${error.message}`);
  }
}

/**
 * 메인 실행 함수
 */
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  log('🌉 FEHG → GW Jira 연동 도구', 'bright');
  log('=====================================', 'bright');

  // 환경변수 확인
  if (!process.env.ATLASSIAN_TOKEN) {
    logError('ATLASSIAN_TOKEN 환경변수가 설정되지 않았습니다.');
    process.exit(1);
  }

  if (!process.env.GW_JIRA_TOKEN) {
    logError('GW_JIRA_TOKEN 환경변수가 설정되지 않았습니다.');
    process.exit(1);
  }

  logSuccess('환경변수 확인 완료');

  switch (command) {
    case 'test':
    case 'test-epic':
      await testEpicCreation();
      break;
      
    case 'list':
    case 'epic-list':
      await showEpicList();
      break;
      
    case 'process':
      const epicId = parseInt(args[1]);
      if (isNaN(epicId)) {
        logError('에픽 ID를 입력해주세요. 예: npm run jira-sync process 1519');
        process.exit(1);
      }
      await processEpicTickets(epicId);
      break;
      
    default:
      log('\n사용법:', 'yellow');
      console.log('  npm run jira-sync test        # 에픽 생성 테스트 (FEHG-1519)');
      console.log('  npm run jira-sync list        # 대상 에픽 목록 확인');
      console.log('  npm run jira-sync process 1519 # 특정 에픽 처리 (준비 중)');
      console.log('');
      
      // 기본적으로 테스트 실행
      await testEpicCreation();
      break;
  }

  log('\n작업 완료! 🎉', 'green');
}

// 스크립트 실행
if (require.main === module) {
  main().catch(error => {
    logError(`실행 중 오류 발생: ${error.message}`);
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  testEpicCreation,
  showEpicList,
  processEpicTickets
};
