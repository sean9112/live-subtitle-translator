import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  Tray,
  nativeImage,
  screen,
  session,
} from 'electron';
import {
  configureModelCache,
  processAudioChunk,
  warmupModels,
} from './translation-service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let controlWindow = null;
let overlayWindow = null;
let tray = null;
let isQuitting = false;
let uiStatePath = '';
let overlayBounds = null;
let persistUiStateTimer = null;
let trayAvailable = false;
const hasSingleInstanceLock = app.requestSingleInstanceLock();
const shouldHideOnClose = app.isPackaged;
const UI_STATE_VERSION = 2;
const OVERLAY_DEFAULT_SIZE = { width: 980, height: 220 };
const OVERLAY_MIN_SIZE = { width: 640, height: 160 };

function supportsOverlayClickThrough() {
  return process.platform !== 'linux';
}

function supportsOverlayVisualEffects() {
  return process.platform === 'darwin';
}

function shouldHideToTray() {
  return shouldHideOnClose && trayAvailable;
}

function showOverlayWindow() {
  if (!overlayWindow) {
    return;
  }

  if (process.platform === 'darwin') {
    overlayWindow.showInactive();
  } else {
    overlayWindow.show();
  }
}

function revealAppWindows() {
  if (overlaySettings.visible) {
    showOverlayWindow();
  }

  if (!controlWindow) {
    return;
  }

  controlWindow.show();
  controlWindow.focus();
}

const sessionState = {
  isListening: false,
  status: 'idle',
  sourceLanguage: 'zh-TW',
  targetLanguage: 'en',
};

const overlaySettings = {
  alwaysOnTop: true,
  visible: true,
  clickThrough: false,
  opacity: 0,
};

const displayState = {
  translationText: '',
  transcriptionText: '',
  sourceLanguage: 'zh-TW',
  targetLanguage: 'en',
  time: '',
  isLive: false,
};

function isAppOrigin(url = '') {
  return url.startsWith('file://');
}

function clampNumber(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function sanitizeOverlaySettings(rawSettings = {}) {
  const nextSettings = {};

  if (typeof rawSettings.alwaysOnTop === 'boolean') {
    nextSettings.alwaysOnTop = rawSettings.alwaysOnTop;
  }

  if (typeof rawSettings.visible === 'boolean') {
    nextSettings.visible = rawSettings.visible;
  }

  if (typeof rawSettings.clickThrough === 'boolean') {
    nextSettings.clickThrough = supportsOverlayClickThrough()
      ? rawSettings.clickThrough
      : false;
  }

  if (typeof rawSettings.opacity === 'number' && Number.isFinite(rawSettings.opacity)) {
    nextSettings.opacity = clampNumber(rawSettings.opacity, 0, 1);
  }

  return nextSettings;
}

function sanitizeOverlayBounds(rawBounds) {
  if (!rawBounds || typeof rawBounds !== 'object') {
    return null;
  }

  const { x, y, width, height } = rawBounds;
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height)
  ) {
    return null;
  }

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  };
}

function clampOverlayBounds(bounds) {
  const sanitized = sanitizeOverlayBounds(bounds);
  if (!sanitized) {
    return null;
  }

  const display = screen.getDisplayMatching(sanitized) || screen.getPrimaryDisplay();
  const { x, y, width, height } = display.workArea;
  const minimumWidth = Math.min(OVERLAY_MIN_SIZE.width, width);
  const minimumHeight = Math.min(OVERLAY_MIN_SIZE.height, height);
  const nextWidth = clampNumber(
    sanitized.width,
    minimumWidth,
    Math.max(minimumWidth, width),
  );
  const nextHeight = clampNumber(
    sanitized.height,
    minimumHeight,
    Math.max(minimumHeight, height),
  );

  return {
    x: clampNumber(sanitized.x, x, x + width - nextWidth),
    y: clampNumber(sanitized.y, y, y + height - nextHeight),
    width: nextWidth,
    height: nextHeight,
  };
}

function readUiState() {
  if (!uiStatePath || !fs.existsSync(uiStatePath)) {
    return;
  }

  try {
    const raw = fs.readFileSync(uiStatePath, 'utf8').trim();
    if (!raw) {
      throw new Error('UI state file is empty.');
    }

    const parsed = JSON.parse(raw);
    if (parsed.overlaySettings) {
      Object.assign(overlaySettings, sanitizeOverlaySettings(parsed.overlaySettings));
    }
    if (!parsed.uiStateVersion || parsed.uiStateVersion < UI_STATE_VERSION) {
      overlaySettings.opacity = 0;
    }
    if (parsed.overlayBounds) {
      overlayBounds = sanitizeOverlayBounds(parsed.overlayBounds);
    }
  } catch (error) {
    console.warn('Failed to read UI state:', error);
    try {
      const corruptedPath = `${uiStatePath}.corrupt-${Date.now()}`;
      fs.renameSync(uiStatePath, corruptedPath);
      console.warn(`Moved corrupted UI state to ${corruptedPath}`);
    } catch (renameError) {
      console.warn('Failed to quarantine corrupted UI state:', renameError);
    }
  }

  if (!supportsOverlayClickThrough()) {
    overlaySettings.clickThrough = false;
  }
}

function persistUiState() {
  if (!uiStatePath) {
    return;
  }

  try {
    const tempPath = `${uiStatePath}.tmp`;
    fs.writeFileSync(
      tempPath,
      JSON.stringify(
        {
          uiStateVersion: UI_STATE_VERSION,
          overlaySettings,
          overlayBounds,
        },
        null,
        2,
      ),
    );
    fs.renameSync(tempPath, uiStatePath);
  } catch (error) {
    console.warn('Failed to persist UI state:', error);
  }
}

function scheduleUiStatePersist() {
  if (persistUiStateTimer) {
    clearTimeout(persistUiStateTimer);
  }

  persistUiStateTimer = setTimeout(() => {
    persistUiStateTimer = null;
    persistUiState();
  }, 120);
}

function createTrayIcon() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18">
      <rect x="1.5" y="2" width="15" height="10.5" rx="3" fill="white"/>
      <path d="M5 6h8M5 8.5h5.5" stroke="black" stroke-width="1.35" stroke-linecap="round"/>
      <path d="M7 12.5 5.4 15l3.2-1.8" fill="white"/>
    </svg>
  `.trim();
  const image = nativeImage.createFromDataURL(
    `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
  );
  image.setTemplateImage(true);
  return image;
}

function getPreloadPath() {
  return path.join(__dirname, 'preload.cjs');
}

function getWindowIconPath() {
  if (process.platform === 'darwin') {
    return undefined;
  }

  return path.join(__dirname, '../assets/icons/png/icon-512.png');
}

function sendToControl(channel, payload) {
  controlWindow?.webContents.send(channel, payload);
}

function sendToOverlay(channel, payload) {
  overlayWindow?.webContents.send(channel, payload);
}

function broadcastOverlaySettings() {
  const payload = { ...overlaySettings };
  sendToControl('subtitle:overlay-settings-updated', payload);
  sendToOverlay('subtitle:overlay-settings-updated', payload);
}

function broadcastDisplayState() {
  sendToOverlay('subtitle:display-updated', { ...displayState });
}

function broadcastTrayCommand(command) {
  sendToControl('subtitle:tray-command', { command });
}

function updateTrayMenu() {
  if (!tray) {
    return;
  }

  const template = [
    {
      label: sessionState.isListening ? '停止即時字幕' : '開始即時字幕',
      click: () => broadcastTrayCommand('toggle-listening'),
    },
    {
      label: overlaySettings.visible ? '隱藏字幕窗' : '顯示字幕窗',
      click: () => {
        overlaySettings.visible = !overlaySettings.visible;
        syncOverlayWindowState();
      },
    },
    {
      label: controlWindow?.isVisible() ? '隱藏控制面板' : '顯示控制面板',
      click: () => toggleControlWindow(),
    },
    { type: 'separator' },
    {
      label: `狀態：${sessionState.status}`,
      enabled: false,
    },
    {
      label: `${sessionState.sourceLanguage} -> ${sessionState.targetLanguage}`,
      enabled: false,
    },
    { type: 'separator' },
    {
      label: '結束',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ];

  tray.setContextMenu(Menu.buildFromTemplate(template));
  tray.setToolTip('Live Subtitle Translator');

  if (process.platform === 'darwin') {
    tray.setTitle(sessionState.isListening ? '字幕中' : '字幕');
  }
}

function positionOverlayWindow() {
  if (!overlayWindow) {
    return;
  }

  if (overlayBounds?.x != null && overlayBounds?.y != null) {
    const nextBounds = clampOverlayBounds(overlayBounds);
    if (nextBounds) {
      overlayWindow.setBounds(nextBounds);
      overlayBounds = nextBounds;
      scheduleUiStatePersist();
      return;
    }
  }

  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height, x, y } = primaryDisplay.workArea;
  const windowWidth = Math.min(OVERLAY_DEFAULT_SIZE.width, width);
  const windowHeight = Math.min(OVERLAY_DEFAULT_SIZE.height, height);
  overlayWindow.setSize(windowWidth, windowHeight);
  const nextX = Math.round(x + (width - windowWidth) / 2);
  const nextY = Math.round(y + height - windowHeight - 40);
  overlayWindow.setPosition(nextX, nextY);
  overlayBounds = overlayWindow.getBounds();
}

function updateOverlayBoundsFromWindow() {
  if (!overlayWindow) {
    return;
  }

  overlayBounds = clampOverlayBounds(overlayWindow.getBounds()) || overlayWindow.getBounds();
}

function syncOverlayWindowState() {
  if (!overlayWindow) {
    return;
  }

  if (process.platform === 'linux') {
    overlayWindow.setAlwaysOnTop(overlaySettings.alwaysOnTop);
  } else {
    overlayWindow.setAlwaysOnTop(overlaySettings.alwaysOnTop, 'screen-saver');
  }
  if (supportsOverlayClickThrough()) {
    overlayWindow.setIgnoreMouseEvents(overlaySettings.clickThrough, {
      forward: overlaySettings.clickThrough,
    });
  } else {
    overlayWindow.setIgnoreMouseEvents(false);
  }

  if (overlaySettings.visible) {
    showOverlayWindow();
  } else {
    overlayWindow.hide();
  }

  broadcastOverlaySettings();
  updateTrayMenu();
  scheduleUiStatePersist();
}

function createControlWindow() {
  controlWindow = new BrowserWindow({
    width: 460,
    height: 860,
    minWidth: 420,
    minHeight: 760,
    title: 'Live Subtitle Translator',
    autoHideMenuBar: true,
    backgroundColor: '#0d1117',
    acceptFirstMouse: true,
    show: false,
    icon: getWindowIconPath(),
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  controlWindow.loadFile(path.join(__dirname, 'index.html'));
  controlWindow.once('ready-to-show', () => controlWindow?.show());
  controlWindow.on('close', (event) => {
    if (!isQuitting && shouldHideToTray()) {
      event.preventDefault();
      controlWindow?.hide();
      updateTrayMenu();
    }
  });

  controlWindow.on('show', updateTrayMenu);
  controlWindow.on('hide', updateTrayMenu);
}

function createOverlayWindow() {
  overlayWindow = new BrowserWindow({
    width: 980,
    height: 220,
    minWidth: OVERLAY_MIN_SIZE.width,
    minHeight: OVERLAY_MIN_SIZE.height,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: true,
    movable: true,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: true,
    acceptFirstMouse: true,
    show: false,
    icon: getWindowIconPath(),
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  overlayWindow.loadFile(path.join(__dirname, 'overlay.html'));
  overlayWindow.once('ready-to-show', () => {
    positionOverlayWindow();
    syncOverlayWindowState();
    broadcastDisplayState();
  });

  overlayWindow.on('move', () => {
    if (!overlayWindow) {
      return;
    }
    updateOverlayBoundsFromWindow();
    scheduleUiStatePersist();
  });

  overlayWindow.on('resize', () => {
    if (!overlayWindow) {
      return;
    }
    updateOverlayBoundsFromWindow();
    scheduleUiStatePersist();
  });

  overlayWindow.on('close', (event) => {
    if (!isQuitting && shouldHideToTray()) {
      event.preventDefault();
      overlaySettings.visible = false;
      overlayWindow?.hide();
      broadcastOverlaySettings();
      updateTrayMenu();
      scheduleUiStatePersist();
    }
  });
}

function createTray() {
  try {
    tray = new Tray(createTrayIcon());
    trayAvailable = true;
    tray.on('click', () => toggleControlWindow());
    updateTrayMenu();
  } catch (error) {
    tray = null;
    trayAvailable = false;
    console.warn('Tray unavailable; falling back to control-window-only mode.', error);
  }
}

function toggleControlWindow() {
  if (!controlWindow) {
    return;
  }

  if (controlWindow.isVisible()) {
    controlWindow.hide();
  } else {
    controlWindow.show();
    controlWindow.focus();
  }
}

function applyOverlaySettings(nextSettings = {}) {
  if (typeof nextSettings.alwaysOnTop === 'boolean') {
    overlaySettings.alwaysOnTop = nextSettings.alwaysOnTop;
  }
  if (typeof nextSettings.visible === 'boolean') {
    overlaySettings.visible = nextSettings.visible;
  }
  if (typeof nextSettings.clickThrough === 'boolean') {
    overlaySettings.clickThrough = supportsOverlayClickThrough()
      ? nextSettings.clickThrough
      : false;
  }
  if (typeof nextSettings.opacity === 'number') {
    overlaySettings.opacity = Math.min(1, Math.max(0, nextSettings.opacity));
  }

  syncOverlayWindowState();
  return { ok: true, overlaySettings: { ...overlaySettings } };
}

function configureMediaPermissions() {
  session.defaultSession.setPermissionCheckHandler(
    (webContents, permission, requestingOrigin, details) => {
      if (permission !== 'media') {
        return false;
      }

      return isAppOrigin(
        requestingOrigin ||
          details?.requestingUrl ||
          details?.securityOrigin ||
          webContents?.getURL() ||
          '',
      );
    },
  );

  session.defaultSession.setPermissionRequestHandler(
    (webContents, permission, callback, details) => {
      if (permission !== 'media') {
        callback(false);
        return;
      }

      const mediaTypes = details?.mediaTypes || [];
      const origin =
        details?.requestingUrl ||
        details?.securityOrigin ||
        webContents?.getURL() ||
        '';

      const allow = isAppOrigin(origin) && mediaTypes.includes('audio');
      callback(allow);
    },
  );
}

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    revealAppWindows();
  });

  app.whenReady().then(() => {
    if (process.platform === 'darwin') {
      app.dock?.hide();
    }

    const modelCacheDir = path.join(app.getPath('userData'), 'models');
    uiStatePath = path.join(app.getPath('userData'), 'ui-state.json');
    configureModelCache(modelCacheDir);
    readUiState();
    configureMediaPermissions();

    ipcMain.handle('subtitle:get-runtime-info', () => ({
      modelCacheDir,
      platform: process.platform,
      overlaySettings: { ...overlaySettings },
      displayState: { ...displayState },
      sessionState: { ...sessionState },
      capabilities: {
        overlayVisualEffects: supportsOverlayVisualEffects(),
        overlayClickThrough: supportsOverlayClickThrough(),
        trayAvailable,
      },
    }));

    ipcMain.handle('subtitle:warmup-models', async (_event, payload) => {
      return warmupModels(payload);
    });

    ipcMain.handle('subtitle:process-audio', async (_event, payload) => {
      try {
        return await processAudioChunk(payload);
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    });

    ipcMain.handle('subtitle:update-display', (_event, payload) => {
      Object.assign(displayState, payload);
      broadcastDisplayState();
      return { ok: true };
    });

    ipcMain.handle('subtitle:update-session-state', (_event, payload) => {
      Object.assign(sessionState, payload);
      updateTrayMenu();
      sendToControl('subtitle:session-state-updated', { ...sessionState });
      return { ok: true };
    });

    ipcMain.handle('subtitle:set-overlay-settings', (_event, payload) => {
      return applyOverlaySettings(payload);
    });

    createTray();
    createControlWindow();
    createOverlayWindow();

    screen.on('display-metrics-changed', positionOverlayWindow);
    screen.on('display-added', positionOverlayWindow);
    screen.on('display-removed', positionOverlayWindow);

    app.on('activate', () => {
      if (!controlWindow) {
        createControlWindow();
      }
      controlWindow?.show();
    });
  });
}

app.on('before-quit', () => {
  isQuitting = true;
  if (persistUiStateTimer) {
    clearTimeout(persistUiStateTimer);
    persistUiStateTimer = null;
  }
  persistUiState();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
