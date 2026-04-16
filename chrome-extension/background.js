// 컨텍스트 메뉴 등록
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'create-fehg-ticket',
    title: 'FEHG 티켓 만들기',
    contexts: ['selection'],
  });
});

// 컨텍스트 메뉴 클릭 핸들러
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'create-fehg-ticket') return;

  const selectedText = info.selectionText || '';
  const sourceUrl = tab?.url || '';

  // 선택한 텍스트와 URL을 storage에 저장 후 팝업 열기
  chrome.storage.local.set(
    { pendingTicket: { text: selectedText, sourceUrl } },
    () => {
      chrome.action.openPopup();
    }
  );
});
