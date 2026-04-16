const $ = (id) => document.getElementById(id);

const apiUrl = CONFIG.API_URL;
const apiKey = CONFIG.API_KEY;

let pendingTicket = null;
let currentMode = 'single'; // 'single' | 'batch'
let membersData = []; // [{ slackId, jiraAccountId, name }]

// ─── 유틸 ──────────────────────────────────────────────────────

const api = async (path, options = {}) => {
  const res = await fetch(`${apiUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
};

const show = (id) => { $(id).style.display = 'block'; };
const hide = (id) => { $(id).style.display = 'none'; };
const showStatus = (id, cls, text) => {
  const el = $(id);
  el.className = `status ${cls}`;
  el.innerHTML = text;
  el.style.display = 'block';
};

const ESTIMATE_PATTERN = /^(\d+\.?\d*)(d|m|w|h)$/i;

// ─── 모드 전환 ─────────────────────────────────────────────────

const switchMode = (mode) => {
  currentMode = mode;
  document.querySelectorAll('.mode-tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.mode === mode);
  });

  if (mode === 'single') {
    show('singleAssigneeGroup');
    hide('batchAssigneesGroup');
    $('submit').textContent = '생성';
  } else {
    hide('singleAssigneeGroup');
    show('batchAssigneesGroup');
    $('submit').textContent = '일괄 생성';
  }
};

document.querySelectorAll('.mode-tab').forEach((tab) => {
  tab.addEventListener('click', () => switchMode(tab.dataset.mode));
});

// ─── 체크박스 (일괄 담당자) ────────────────────────────────────

const buildCheckboxes = (members) => {
  const container = $('assigneesCheckboxes');
  container.innerHTML = '';
  members.forEach((m) => {
    const item = document.createElement('label');
    item.className = 'checkbox-item';
    item.innerHTML = `<input type="checkbox" value="${m.slackId}" checked> ${m.name || m.slackId}`;
    container.appendChild(item);
  });
};

$('selectAll').addEventListener('click', () => {
  $('assigneesCheckboxes').querySelectorAll('input').forEach((cb) => (cb.checked = true));
});
$('deselectAll').addEventListener('click', () => {
  $('assigneesCheckboxes').querySelectorAll('input').forEach((cb) => (cb.checked = false));
});

const getSelectedUsers = () =>
  Array.from($('assigneesCheckboxes').querySelectorAll('input:checked')).map((cb) => cb.value);

// ─── 초기화 ────────────────────────────────────────────────────

const init = async () => {
  // 모든 상태 숨기기
  ['noConfig', 'noText', 'loading', 'result'].forEach(hide);

  if (!apiUrl || !apiKey || apiUrl.includes('xxxxxxxxxx')) {
    show('noConfig');
    return;
  }

  const stored = await chrome.storage.local.get('pendingTicket');
  pendingTicket = stored.pendingTicket || null;

  if (!pendingTicket || !pendingTicket.text) {
    show('noText');
    return;
  }

  $('preview').textContent =
    pendingTicket.text.length > 300
      ? pendingTicket.text.slice(0, 300) + '…'
      : pendingTicket.text;

  show('form');
  $('modeTabs').style.display = 'flex';
  showStatus('loading', 'loading', '⏳ LLM으로 요약 중입니다...');
  setFormDisabled(true);

  try {
    const [epicsRes, membersRes, summarizeRes] = await Promise.all([
      api('/api/epics'),
      api('/api/members'),
      api('/api/summarize', {
        method: 'POST',
        body: JSON.stringify({
          text: pendingTicket.text,
          sourceUrl: pendingTicket.sourceUrl,
        }),
      }),
    ]);

    // 에픽
    const epicSelect = $('epic');
    epicSelect.innerHTML = '<option value="">에픽 선택</option>';
    (epicsRes.epics || []).forEach((e) => {
      const opt = document.createElement('option');
      opt.value = e.key;
      opt.textContent = `${e.key} ${e.summary}`.slice(0, 75);
      epicSelect.appendChild(opt);
    });

    // 멤버
    membersData = membersRes.members || [];
    const assigneeSelect = $('assignee');
    assigneeSelect.innerHTML = '<option value="">선택 안 함</option>';
    membersData.forEach((m) => {
      const opt = document.createElement('option');
      opt.value = m.slackId;
      opt.textContent = m.name || m.slackId;
      assigneeSelect.appendChild(opt);
    });
    buildCheckboxes(membersData);

    // LLM 요약
    if (summarizeRes.draft) {
      $('title').value = summarizeRes.draft.title || '';
      $('description').value = summarizeRes.draft.description || '';
    }

    hide('loading');
    setFormDisabled(false);
  } catch (e) {
    hide('loading');
    showStatus('result', 'error', `초기화 실패: ${e.message}`);
  }
};

const setFormDisabled = (disabled) => {
  ['title', 'description', 'epic', 'assignee', 'startDate', 'endDate', 'estimate', 'instructions'].forEach(
    (id) => ($(id).disabled = disabled)
  );
  $('assigneesCheckboxes').querySelectorAll('input').forEach((cb) => (cb.disabled = disabled));
  $('submit').disabled = disabled;
  $('resummarize').disabled = disabled;
};

// ─── 재요약 ────────────────────────────────────────────────────

$('resummarize').addEventListener('click', async () => {
  if (!pendingTicket) return;

  showStatus('loading', 'loading', '⏳ 재요약 중입니다...');
  setFormDisabled(true);

  try {
    const assigneeName =
      currentMode === 'single'
        ? ($('assignee').selectedOptions[0]?.textContent || undefined)
        : undefined;
    const instructions = $('instructions').value.trim() || undefined;

    const res = await api('/api/summarize', {
      method: 'POST',
      body: JSON.stringify({
        text: pendingTicket.text,
        sourceUrl: pendingTicket.sourceUrl,
        assigneeName: assigneeName === '선택 안 함' ? undefined : assigneeName,
        instructions,
      }),
    });

    if (res.draft) {
      $('title').value = res.draft.title || '';
      $('description').value = res.draft.description || '';
    }

    hide('loading');
    setFormDisabled(false);
  } catch (e) {
    hide('loading');
    setFormDisabled(false);
    showStatus('result', 'error', `재요약 실패: ${e.message}`);
    setTimeout(() => hide('result'), 3000);
  }
});

// ─── 티켓 생성 ─────────────────────────────────────────────────

$('submit').addEventListener('click', async () => {
  const title = $('title').value.trim();
  const epicKey = $('epic').value;
  const estimate = $('estimate').value.trim();
  const startDate = $('startDate').value;
  const endDate = $('endDate').value;

  if (!title) { alert('제목을 입력해주세요.'); return; }
  if (!epicKey) { alert('상위 에픽을 선택해주세요.'); return; }
  if (estimate && !ESTIMATE_PATTERN.test(estimate)) {
    alert('최초추정치 형식이 올바르지 않습니다. (예: 3d, 1w, 1.5h, 30m)');
    return;
  }
  if (startDate && endDate && startDate > endDate) {
    alert('종료일은 시작일 이후여야 합니다.');
    return;
  }

  if (currentMode === 'batch') {
    const selected = getSelectedUsers();
    if (selected.length === 0) {
      alert('담당자를 1명 이상 선택해주세요.');
      return;
    }
  }

  setFormDisabled(true);
  const originalText = $('submit').textContent;
  $('submit').textContent = currentMode === 'batch' ? '일괄 생성 중...' : '생성 중...';

  try {
    const common = {
      title,
      description: $('description').value.trim(),
      epicKey,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      estimate: estimate || undefined,
      sourceUrl: pendingTicket?.sourceUrl,
    };

    if (currentMode === 'single') {
      await api('/api/ticket', {
        method: 'POST',
        body: JSON.stringify({
          ...common,
          assigneeSlackId: $('assignee').value || undefined,
        }),
      });
    } else {
      await api('/api/batch-ticket', {
        method: 'POST',
        body: JSON.stringify({
          ...common,
          selectedUsers: getSelectedUsers(),
        }),
      });
    }

    hide('form');
    $('modeTabs').style.display = 'none';
    const msg = currentMode === 'batch'
      ? `✅ ${getSelectedUsers().length}명에게 일괄 티켓 생성이 요청되었습니다.\nSlack에서 결과를 확인하세요.`
      : '✅ 티켓 생성이 요청되었습니다.\nSlack에서 결과를 확인하세요.';
    showStatus('result', 'success', msg);

    chrome.storage.local.remove('pendingTicket');
  } catch (e) {
    setFormDisabled(false);
    $('submit').textContent = originalText;
    showStatus('result', 'error', `생성 실패: ${e.message}`);
  }
});

// ─── 시작 ──────────────────────────────────────────────────────

init();
