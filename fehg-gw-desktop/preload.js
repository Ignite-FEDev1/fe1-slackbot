const { contextBridge, ipcRenderer } = require('electron');

// 안전한 API를 렌더러 프로세스에 노출
contextBridge.exposeInMainWorld('electronAPI', {
  // FEHG → GW 연동 기능들
  testEpicCreation: () => ipcRenderer.invoke('test-epic-creation'),
  getEpicList: () => ipcRenderer.invoke('get-epic-list'),
  
  // 추후 확장 가능한 기능들
  // createAllTickets: () => ipcRenderer.invoke('create-all-tickets'),
  // syncTicketStatus: () => ipcRenderer.invoke('sync-ticket-status'),
  // showMappingStatus: () => ipcRenderer.invoke('show-mapping-status'),
});
