const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
require('dotenv').config();

// Slack 봇 기능들 import (기존 코드 재사용)
const { 
  getFEHGEpicInfo, 
  createGWEpic, 
  updateFEHGTicketWithGWLink 
} = require('./src/external');

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  win.loadFile('index.html');
  
  // 개발 시에만 DevTools 열기
  if (process.env.NODE_ENV === 'development') {
    win.webContents.openDevTools();
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// IPC 핸들러들 (기존 Slack 봇 기능들)
ipcMain.handle('test-epic-creation', async () => {
  try {
    console.log('🧪 FEHG-1519 에픽 테스트 시작...');
    
    // 1. FEHG 에픽 조회
    const fehgEpic = await getFEHGEpicInfo(1519);
    if (!fehgEpic) {
      throw new Error('FEHG-1519 에픽을 찾을 수 없습니다.');
    }

    // 2. AUTOWAY 에픽 생성
    const gwEpic = await createGWEpic(fehgEpic);
    if (!gwEpic) {
      throw new Error('AUTOWAY 에픽 생성에 실패했습니다.');
    }

    // 3. FEHG 에픽에 링크 추가
    const gwEpicUrl = `https://jira.hmg-corp.io/browse/${gwEpic.key}`;
    const linkSuccess = await updateFEHGTicketWithGWLink(fehgEpic.key, gwEpicUrl);

    return {
      success: true,
      data: {
        fehgEpic: {
          key: fehgEpic.key,
          summary: fehgEpic.fields.summary,
          status: fehgEpic.fields.status.name,
          duedate: fehgEpic.fields.duedate,
          customfield_10015: fehgEpic.fields.customfield_10015
        },
        gwEpic: {
          key: gwEpic.key,
          url: gwEpicUrl
        },
        linkSuccess
      }
    };
  } catch (error) {
    console.error('에픽 생성 테스트 오류:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

ipcMain.handle('get-epic-list', async () => {
  const { FEHG_TARGET_EPICS } = require('./src/constant');
  return FEHG_TARGET_EPICS;
});
