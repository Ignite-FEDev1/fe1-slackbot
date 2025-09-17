// 로딩 표시/숨김 함수
function showLoading() {
    document.getElementById('loading').style.display = 'block';
    document.getElementById('result').innerHTML = '';
}

function hideLoading() {
    document.getElementById('loading').style.display = 'none';
}

// 결과 표시 함수
function showResult(content, type = 'info') {
    const resultDiv = document.getElementById('result');
    resultDiv.innerHTML = `<div class="result ${type}">${content}</div>`;
}

// 에픽 생성 테스트
async function testEpicCreation() {
    showLoading();
    
    try {
        const result = await window.electronAPI.testEpicCreation();
        hideLoading();
        
        if (result.success) {
            const { fehgEpic, gwEpic, linkSuccess } = result.data;
            
            const content = `
<h3>🎉 에픽 생성 테스트 완료!</h3>

<h4>📋 FEHG 에픽 정보:</h4>
<ul>
    <li><strong>티켓:</strong> ${fehgEpic.key}</li>
    <li><strong>제목:</strong> ${fehgEpic.summary}</li>
    <li><strong>상태:</strong> ${fehgEpic.status}</li>
    <li><strong>마감일:</strong> ${fehgEpic.duedate || 'N/A'}</li>
    <li><strong>커스텀필드 10015:</strong> ${fehgEpic.customfield_10015 || 'N/A'}</li>
</ul>

<h4>🚀 AUTOWAY 에픽 생성:</h4>
<ul>
    <li><strong>티켓:</strong> ${gwEpic.key}</li>
    <li><strong>URL:</strong> <a href="${gwEpic.url}" target="_blank">${gwEpic.url}</a></li>
</ul>

<h4>🔗 연결 상태:</h4>
<p>${linkSuccess ? '✅ FEHG 티켓에 AUTOWAY 링크 추가 완료' : '❌ FEHG 링크 업데이트 실패'}</p>

<h4>📋 매핑된 필드들:</h4>
<ul>
    <li>summary: ✅</li>
    <li>duedate: ${fehgEpic.duedate ? '✅' : '❌'}</li>
    <li>customfield_10015 → customfield_11209: ${fehgEpic.customfield_10015 ? '✅' : '❌'}</li>
</ul>
            `;
            
            showResult(content, 'success');
        } else {
            showResult(`❌ 오류 발생: ${result.error}`, 'error');
        }
    } catch (error) {
        hideLoading();
        showResult(`❌ 예상치 못한 오류: ${error.message}`, 'error');
    }
}

// 에픽 목록 표시
async function showEpicList() {
    showLoading();
    
    try {
        const epicList = await window.electronAPI.getEpicList();
        hideLoading();
        
        const content = `
<h3>📋 대상 FEHG 에픽 목록 (총 ${epicList.length}개)</h3>
<div style="columns: 3; column-gap: 20px; margin-top: 15px;">
    ${epicList.map((epicId, index) => 
        `<div style="break-inside: avoid; margin-bottom: 5px;">
            ${index + 1}. FEHG-${epicId}
        </div>`
    ).join('')}
</div>
        `;
        
        showResult(content, 'info');
    } catch (error) {
        hideLoading();
        showResult(`❌ 에픽 목록 조회 실패: ${error.message}`, 'error');
    }
}

// 페이지 로드 시 초기화
document.addEventListener('DOMContentLoaded', () => {
    console.log('FEHG → GW 연동 도구가 시작되었습니다.');
});
