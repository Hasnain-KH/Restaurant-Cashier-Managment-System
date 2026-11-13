'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const http = require('http');
const {
  app,
  BrowserWindow,
  Menu,
  dialog,
  ipcMain,
  session,
  shell,
} = require('electron');

const { createDatabase } = require('../server/db');
const { createApp } = require('../server/app');
const { APP_TIME_ZONE, dayKey, fileStamp } = require('../server/time');

const isPractice =
  process.argv.includes('--practice') || process.env.JOONA_PRACTICE === '1';
const appDisplayName = isPractice ? 'Joona Biryani Practice' : 'Joona Biryani';
app.setName(appDisplayName);

// Practice mode must never share the real shop database. A separate Windows
// profile is used so backups, settings and sales are completely isolated.
if (process.env.JOONA_USER_DATA_DIR) {
  app.setPath('userData', process.env.JOONA_USER_DATA_DIR);
} else if (isPractice) {
  app.setPath('userData', path.join(app.getPath('appData'), 'Joona Biryani Practice'));
}

const isDev = process.env.JOONA_DEV === '1';
const isSmoke = process.env.JOONA_SMOKE === '1';
const openDevTools = process.env.JOONA_DEVTOOLS === '1';

let mainWindow = null;
let httpServer = null;
let database = null;
let apiBase = '';
const apiToken = crypto.randomBytes(32).toString('hex');

const dataDir = path.join(app.getPath('userData'), 'data');
const backupsDir = path.join(app.getPath('userData'), 'backups');
const dbPath = path.join(dataDir, 'joona-biryani.sqlite');
const iconPath = path.join(__dirname, '..', 'build', 'icon.png');

function listen(expressApp) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(expressApp);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({ server, port: address.port });
    });
  });
}

function isTrustedSender(event) {
  if (!mainWindow || !event || !event.sender) return false;
  if (event.sender !== mainWindow.webContents) return false;
  const url = event.senderFrame ? event.senderFrame.url : event.sender.getURL();
  if (!url) return false;
  if (isDev) return url.startsWith('http://127.0.0.1:5173');
  return url.startsWith('file://');
}

function requireTrusted(event) {
  if (!isTrustedSender(event)) {
    throw new Error('This action is only available from the Joona Biryani window.');
  }
}

function registerIpc() {
  ipcMain.on('app:bootstrap', (event) => {
    if (!isTrustedSender(event)) {
      event.returnValue = null;
      return;
    }
    event.returnValue = {
      apiBase,
      apiToken,
      appVersion: app.getVersion(),
      packaged: app.isPackaged,
      platform: process.platform,
      practice: isPractice,
      appName: appDisplayName,
      timezone: APP_TIME_ZONE,
    };
  });

  ipcMain.handle('app:info', (event) => {
    requireTrusted(event);
    const storage = database.storageInfo();
    return {
      ...storage,
      appVersion: app.getVersion(),
      appName: appDisplayName,
      dataDir,
      backupsDir,
      userData: app.getPath('userData'),
      packaged: app.isPackaged,
      apiBase,
      practice: isPractice,
      timezone: APP_TIME_ZONE,
      today: dayKey(),
    };
  });

  ipcMain.handle('app:open-data-folder', async (event) => {
    requireTrusted(event);
    const error = await shell.openPath(dataDir);
    return { ok: !error, error: error || null };
  });

  ipcMain.handle('app:open-backups-folder', async (event) => {
    requireTrusted(event);
    fs.mkdirSync(backupsDir, { recursive: true });
    const error = await shell.openPath(backupsDir);
    return { ok: !error, error: error || null };
  });

  ipcMain.handle('app:verify', (event) => {
    requireTrusted(event);
    return database.verifyDatabase();
  });

  ipcMain.handle('backup:create', async (event) => {
    requireTrusted(event);
    const window = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    const defaultPath = path.join(
      app.getPath('documents'),
      `Joona-Biryani${isPractice ? '-Practice' : ''}-Backup-${fileStamp()}.sqlite`
    );

    const { canceled, filePath } = await dialog.showSaveDialog(window, {
      title: 'Save Joona Biryani backup',
      defaultPath,
      buttonLabel: 'Save backup',
      filters: [
        { name: 'Joona Biryani backup', extensions: ['sqlite'] },
        { name: 'All files', extensions: ['*'] },
      ],
    });

    if (canceled || !filePath) return { canceled: true };

    try {
      const result = database.backupTo(filePath);
      return { saved: true, ...result };
    } catch (error) {
      console.error('[joona] backup failed', error);
      throw new Error(error.message || 'Could not create the backup file.');
    }
  });

  ipcMain.handle('backup:restore', async (event) => {
    requireTrusted(event);
    const window = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    const { canceled, filePaths } = await dialog.showOpenDialog(window, {
      title: 'Choose a Joona Biryani backup to restore',
      buttonLabel: 'Open backup',
      properties: ['openFile'],
      filters: [
        { name: 'Joona Biryani backup', extensions: ['sqlite', 'db', 'bak'] },
        { name: 'All files', extensions: ['*'] },
      ],
    });

    if (canceled || !filePaths || !filePaths[0]) return { canceled: true };

    let validation;
    try {
      validation = database.validateBackupFile(filePaths[0]);
    } catch (error) {
      return { error: error.message };
    }

    if (!validation.valid) {
      return { error: validation.error || 'This is not a valid Joona Biryani backup.' };
    }

    const detailLines = [
      `Sales in this backup: ${validation.orders}`,
      validation.firstDate ? `First sale: ${validation.firstDate}` : null,
      validation.lastDate ? `Last sale: ${validation.lastDate}` : null,
      validation.isLegacySchema ? 'This is an older backup; it will be upgraded safely.' : null,
      '',
      'Your current data will be saved as a verified safety backup before restoring.',
    ].filter(Boolean);

    const confirmation = await dialog.showMessageBox(window, {
      type: 'warning',
      title: 'Restore backup',
      message: 'Replace the current sales data with this backup?',
      detail: detailLines.join('\n'),
      buttons: ['Restore backup', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });

    if (confirmation.response !== 0) return { canceled: true };

    try {
      const result = database.restoreFrom(filePaths[0]);
      return { restored: true, ...result };
    } catch (error) {
      console.error('[joona] restore failed', error);
      return { error: error.message || 'Restore failed.' };
    }
  });
}

function hardenSession(targetSession) {
  targetSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(false);
  });
  targetSession.setPermissionCheckHandler(() => false);
}

function createWindow() {
  const windowOptions = {
    width: 1440,
    height: 940,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    backgroundColor: '#faf5ec',
    title: isPractice ? 'Joona Biryani — Practice Mode' : 'Joona Biryani',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
      devTools: !app.isPackaged || openDevTools,
    },
  };

  if (fs.existsSync(iconPath)) windowOptions.icon = iconPath;

  mainWindow = new BrowserWindow(windowOptions);

  Menu.setApplicationMenu(null);

  mainWindow.once('ready-to-show', () => {
    if (!isSmoke) mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = isDev
      ? url.startsWith('http://127.0.0.1:5173')
      : url.startsWith('file://');
    if (!allowed) event.preventDefault();
  });

  mainWindow.webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });

  if (isDev) {
    mainWindow.loadURL('http://127.0.0.1:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'client', 'dist', 'index.html'));
  }

  if (openDevTools && !app.isPackaged) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (isSmoke) runSmokeTest();
}

function runSmokeTest() {
  const writeSmokeResult = (result) => {
    const out = process.env.JOONA_SMOKE_OUT;
    if (out) {
      try {
        fs.writeFileSync(out, JSON.stringify(result, null, 2));
      } catch (error) {
        console.error('[joona] could not write smoke output:', error.message);
      }
    }
  };

  const fail = (result) => {
    writeSmokeResult(result);
    console.error('SMOKE_RESULT ' + JSON.stringify(result));
    app.exit(1);
  };

  const timeout = setTimeout(() => {
    fail({ ok: false, error: 'timeout' });
  }, 45000);

  mainWindow.webContents.on('render-process-gone', (event, details) => {
    clearTimeout(timeout);
    fail({ ok: false, error: 'renderer-gone', details });
  });

  mainWindow.webContents.on('did-fail-load', (event, code, description) => {
    clearTimeout(timeout);
    fail({ ok: false, error: 'did-fail-load', code, description });
  });

  mainWindow.webContents.on('console-message', (event) => {
    if (event && (event.level === 'error' || event.level === 'warning')) {
      console.error('[renderer]', event.message);
    }
  });

  mainWindow.webContents.once('did-finish-load', async () => {
    try {
      const result = await mainWindow.webContents.executeJavaScript(
        `(async () => {
          const waitFor = async (selector, attempts = 80) => {
            for (let i = 0; i < attempts; i += 1) {
              const node = document.querySelector(selector);
              if (node) return node;
              await new Promise((resolve) => setTimeout(resolve, 100));
            }
            return null;
          };
          const brand = await waitFor('.brand-name');
          const nav = await waitFor('.nav');
          const boot = window.joona && window.joona.bootstrap;
          const res = await fetch(boot.apiBase + '/api/health', {
            headers: { 'x-joona-token': boot.apiToken },
          });
          const health = await res.json();
          const bodyText = document.body.innerText;
          return {
            ok: Boolean(brand && nav && health.ok),
            brand: brand ? brand.textContent.trim() : null,
            navButtons: nav ? nav.querySelectorAll('button').length : 0,
            cashierVisible: bodyText.includes('Save') && bodyText.includes('Sale'),
            practice: boot.practice,
            health,
            apiBase: boot.apiBase,
            title: document.title,
          };
        })()`
      );

      clearTimeout(timeout);
      writeSmokeResult(result);
      console.log('SMOKE_RESULT ' + JSON.stringify(result));
      setTimeout(() => app.exit(result.ok ? 0 : 1), 300);
    } catch (error) {
      clearTimeout(timeout);
      fail({ ok: false, error: String(error) });
    }
  });
}

async function start() {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(backupsDir, { recursive: true });

    hardenSession(session.defaultSession);

    database = createDatabase(dbPath, { backupsDir });

    try {
      const auto = database.autoBackup();
      if (!auto.skipped) console.log('[joona] daily backup created:', auto.path);
    } catch (error) {
      console.warn('[joona] daily backup skipped:', error.message);
    }

    const expressApp = createApp({
      db: database,
      token: apiToken,
      practice: isPractice,
      version: app.getVersion(),
    });
    const started = await listen(expressApp);
    httpServer = started.server;
    apiBase = `http://127.0.0.1:${started.port}`;
    console.log(`[joona] ${isPractice ? 'PRACTICE ' : ''}local API ready on ${apiBase}`);
    console.log(`[joona] database: ${dbPath}`);

    registerIpc();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  } catch (error) {
    console.error('[joona] failed to start', error);
    dialog.showErrorBox(
      'Joona Biryani could not start',
      `The local database or service could not be started.\n\n${error.message}`
    );
    app.exit(1);
  }
}

const gotLock = isSmoke ? true : app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(start);

  app.on('window-all-closed', () => {
    app.quit();
  });

  app.on('before-quit', () => {
    if (database) {
      try {
        database.close();
      } catch (error) {
        console.warn('[joona] database close failed', error.message);
      }
      database = null;
    }
    if (httpServer) {
      try {
        httpServer.close();
      } catch {
        /* ignore */
      }
      httpServer = null;
    }
  });
}
