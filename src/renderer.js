import { BridgeClient } from './bridge-client.js';
import { createControlUI, getTargetLanguage } from './control-ui.js';
import { clearLogs, getRecentLogs, logEvent } from './logger.js';
import { PcmCapture } from './pcm-capture.js';

const MAX_HISTORY_ITEMS = 8;
const RECORDER_TIMESLICE_MS = 2800;
const SILENCE_RMS_THRESHOLD = 0.009;

const state = {
  isListening: false,
  isProcessing: false,
  queue: [],
  history: [],
};

const bridge = new BridgeClient();
const ui = createControlUI();
const capture = new PcmCapture({
  chunkDurationMs: RECORDER_TIMESLICE_MS,
  onChunk: async (samples) => {
    await enqueueSamples(samples);
  },
});

function renderDiagnostics() {
  ui.renderDiagnostics(getRecentLogs());
}

function logAndRender(type, message) {
  logEvent(type, message);
  renderDiagnostics();
}

function formatClock() {
  return new Intl.DateTimeFormat('zh-TW', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date());
}

function computeRms(samples) {
  let sum = 0;

  for (let index = 0; index < samples.length; index += 1) {
    sum += samples[index] * samples[index];
  }

  return Math.sqrt(sum / samples.length);
}

function describeError(error) {
  if (!(error instanceof Error)) {
    return '發生未知錯誤。';
  }

  if (error.message.startsWith('Bridge method unavailable:')) {
    const methodName = error.message.replace('Bridge method unavailable: ', '');
    const meta = bridge.getMeta();
    return `Electron 橋接版本不一致或未完整載入。缺少方法：${methodName}。bridgeVersion=${meta.version}；methods=${meta.methods.join(', ') || 'unknown'}。請完全結束背景中的舊版 app 後再重開。`;
  }

  if (error.message.startsWith('Bridge version mismatch:')) {
    return `${error.message}。請完全關閉舊版 app 後再重開。`;
  }

  if (error.name === 'NotAllowedError') {
    return '麥克風權限被拒絕。請到系統設定允許這個 App 使用麥克風後再試一次。';
  }

  if (error.name === 'NotFoundError') {
    return '找不到可用的麥克風裝置。';
  }

  if (error.name === 'NotReadableError') {
    return '麥克風目前無法讀取，可能正被其他 App 佔用。';
  }

  if (error.name === 'AbortError') {
    return '麥克風初始化被中斷，請再試一次。';
  }

  return `${error.name ? `${error.name}: ` : ''}${error.message}`;
}

function appendHistory(item) {
  state.history.unshift(item);
  state.history = state.history.slice(0, MAX_HISTORY_ITEMS);
  ui.renderHistory(state.history);
}

async function syncDisplay(payload) {
  ui.setPreview(payload);
  await bridge.updateDisplay(payload);
}

async function syncSessionState(status) {
  await bridge.updateSessionState({
    isListening: state.isListening,
    status,
    sourceLanguage: ui.getSourceLanguage(),
    targetLanguage: getTargetLanguage(ui.getSourceLanguage()),
  });
}

async function processQueue() {
  if (state.isProcessing || state.queue.length === 0) {
    return;
  }

  state.isProcessing = true;

  try {
    const samples = state.queue.shift();

    if (computeRms(samples) < SILENCE_RMS_THRESHOLD) {
      return;
    }

    const sourceLanguage = ui.getSourceLanguage();
    const targetLanguage = getTargetLanguage(sourceLanguage);
    const response = await bridge.processAudio({
      samples: Array.from(samples),
      sourceLanguage,
      targetLanguage,
    });

    if (!response?.ok || response.skipped) {
      if (!response?.ok) {
        throw new Error(response?.error ?? 'Audio processing failed.');
      }
      return;
    }

    const payload = {
      ...response,
      time: formatClock(),
      isLive: true,
    };

    await syncDisplay(payload);
    appendHistory(payload);
  } finally {
    state.isProcessing = false;
    if (state.queue.length > 0) {
      void processQueue();
    }
  }
}

async function enqueueSamples(samples) {
  state.queue.push(samples);

  if (state.queue.length > 3) {
    state.queue.shift();
  }

  await processQueue();
}

async function warmupCurrentModels() {
  const sourceLanguage = ui.getSourceLanguage();
  const targetLanguage = getTargetLanguage(sourceLanguage);

  ui.setStatus('loading', '載入模型');
  ui.setRuntimeHint('模型預熱中，初次執行會比較久。');
  ui.setButtonsDisabled(true);
  await syncSessionState('loading');
  logAndRender('warmup', '開始模型預熱');

  try {
    const response = await bridge.warmupModels({
      sourceLanguage,
      targetLanguage,
    });

    if (!response?.ok) {
      throw new Error(response?.error ?? 'Model warmup failed.');
    }

    logAndRender('warmup', '模型預熱完成');
  } finally {
    ui.setButtonsDisabled(false);
  }
}

async function startListening() {
  logAndRender('listen', '收到開始收音請求');

  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('這個平台目前無法在控制面板裡取得麥克風裝置。');
  }

  ui.setStatus('loading', '準備收音');
  ui.setRuntimeHint('正在初始化收音與本地辨識。');
  ui.setButtonsDisabled(true);

  try {
    const microphoneAccess = await bridge.ensureMicrophoneAccess();
    if (!microphoneAccess?.ok) {
      if (microphoneAccess?.status === 'denied') {
        throw new Error(
          '麥克風權限已被 macOS 拒絕。請到 System Settings > Privacy & Security > Microphone 開啟 Live Subtitle Translator，或執行 `tccutil reset Microphone com.sean9112.live-subtitle-translator` 後重試。',
        );
      }

      if (microphoneAccess?.status === 'restricted') {
        throw new Error('麥克風權限目前受系統限制，無法由這個 App 直接要求。');
      }

      throw new Error('麥克風權限被拒絕。請到系統設定允許這個 App 使用麥克風後再試一次。');
    }

    await warmupCurrentModels();
    logAndRender('listen', '準備呼叫 getUserMedia');
    await capture.start();
    logAndRender('audio', `收音後端：${capture.captureBackend}`);
    state.isListening = true;
    ui.setListeningState(true);
    ui.setStatus('live', '即時翻譯');
    ui.setRuntimeHint('收音中。字幕 overlay 會以約 2.8 秒為單位更新。');
    await syncSessionState('live');
    logAndRender('listen', '即時收音已開始');
  } finally {
    ui.setButtonsDisabled(false);
  }
}

async function stopListening() {
  await capture.stop();
  state.queue = [];
  state.isListening = false;

  ui.setListeningState(false);
  ui.setStatus('idle', '待機中');
  ui.setRuntimeHint('已停止收音。');
  await syncSessionState('idle');
  await bridge.updateDisplay({
    isLive: false,
    sourceLanguage: ui.getSourceLanguage(),
    targetLanguage: getTargetLanguage(ui.getSourceLanguage()),
  });
}

async function toggleListening() {
  ui.refs.startStopButton.disabled = true;

  try {
    if (state.isListening) {
      await stopListening();
    } else {
      await startListening();
    }
  } catch (error) {
    const message = describeError(error);
    logAndRender('error', message);
    ui.setStatus('idle', '錯誤');
    ui.setRuntimeHint(message);
    state.isListening = false;
    ui.setListeningState(false);

    try {
      await syncSessionState('error');
    } catch (syncError) {
      logAndRender('error', describeError(syncError));
    }
  } finally {
    ui.refs.startStopButton.disabled = false;
  }
}

async function syncOverlaySettings() {
  const response = await bridge.setOverlaySettings(ui.readOverlaySettings());

  if (response?.overlaySettings) {
    ui.applyOverlaySettings(response.overlaySettings);
  }
}

async function bootstrap() {
  logAndRender('bootstrap', '控制面板啟動');
  ui.updateTargetLanguage();
  ui.renderHistory(state.history);

  const meta = bridge.getMeta();
  logAndRender(
    'bootstrap',
    `bridgeVersion=${meta.version} methods=${meta.methods.join(',') || 'unknown'}`,
  );
  bridge.ensureVersion();

  const runtimeInfo = await bridge.getRuntimeInfo();
  const platformNotes = [
    `模型快取位置：${runtimeInfo.modelCacheDir}。`,
    '目前預設可直接拖曳整個字幕窗；開啟點擊穿透後才會放過滑鼠事件。',
  ];

  if (runtimeInfo.capabilities?.trayAvailable === false) {
    platformNotes.push('這個平台目前無法建立 system tray，請直接用控制面板操作。');
  }

  if (runtimeInfo.capabilities?.overlayVisualEffects === false) {
    platformNotes.push('非 macOS 平台會改用較保守的字幕視覺效果，優先降低透明與模糊帶來的相容性風險。');
  }

  if (runtimeInfo.platform === 'linux') {
    platformNotes.push('Linux 會自動關閉點擊穿透，避免字幕窗無法互動。');
  } else if (runtimeInfo.platform === 'win32') {
    platformNotes.push('Windows 仍保留透明 overlay，但實際重繪與焦點表現會受到顯示卡與 DWM 影響。');
  }

  ui.setRuntimeHint(platformNotes.join(' '));

  if (runtimeInfo.overlaySettings) {
    ui.applyOverlaySettings(runtimeInfo.overlaySettings);
  }

  if (runtimeInfo.capabilities?.overlayClickThrough === false) {
    ui.refs.clickThroughCheckbox.disabled = true;
    ui.setRuntimeHint(
      `${ui.refs.runtimeHint.textContent} 目前 Linux 桌面環境會自動停用點擊穿透，避免字幕窗無法互動。`,
    );
  }

  if (runtimeInfo.displayState) {
    ui.setPreview(runtimeInfo.displayState);
  }

  if (runtimeInfo.sessionState?.status === 'live') {
    state.isListening = true;
    ui.setListeningState(true);
    ui.setStatus('live', '即時翻譯');
  } else if (runtimeInfo.sessionState?.status === 'loading') {
    ui.setStatus('loading', '載入模型');
  } else {
    ui.setStatus('idle', '待機中');
    if (runtimeInfo.sessionState?.status === 'error') {
      try {
        await syncSessionState('idle');
      } catch (error) {
        logAndRender('error', describeError(error));
      }
    }
  }

  bridge.onOverlaySettingsUpdate((payload) => {
    ui.applyOverlaySettings(payload);
  });

  bridge.onTrayCommand(({ command }) => {
    if (command === 'toggle-listening') {
      void toggleListening();
    }
  });

  bridge.onSessionStateUpdate((payload) => {
    logAndRender('session', `狀態更新為 ${payload.status}`);
    if (payload.status === 'live') {
      ui.setStatus('live', '即時翻譯');
    } else if (payload.status === 'loading') {
      ui.setStatus('loading', '載入模型');
    } else if (payload.status === 'error') {
      ui.setStatus('idle', '錯誤');
    } else {
      ui.setStatus('idle', '待機中');
    }
  });

  ui.refs.sourceLanguageSelect.addEventListener('change', async () => {
    ui.updateTargetLanguage();
    if (!state.isListening) {
      ui.setRuntimeHint('語言方向已切換，下一次開始收音時會重用對應模型。');
      try {
        await syncSessionState('idle');
        await bridge.updateDisplay({
          sourceLanguage: ui.getSourceLanguage(),
          targetLanguage: getTargetLanguage(ui.getSourceLanguage()),
          isLive: false,
        });
      } catch (error) {
        logAndRender('error', describeError(error));
      }
    }
  });

  ui.refs.overlayVisibleCheckbox.addEventListener('change', () => {
    void syncOverlaySettings();
  });

  ui.refs.alwaysOnTopCheckbox.addEventListener('change', () => {
    void syncOverlaySettings();
  });

  ui.refs.clickThroughCheckbox.addEventListener('change', () => {
    void syncOverlaySettings();
  });

  ui.refs.overlayOpacityInput.addEventListener('input', () => {
    ui.refs.overlayOpacityValue.textContent = `${ui.refs.overlayOpacityInput.value}%`;
    void syncOverlaySettings();
  });

  ui.refs.startStopButton.addEventListener('click', () => {
    logAndRender('ui', '點擊開始/停止按鈕');
    void toggleListening();
  });

  ui.refs.refreshLogsButton.addEventListener('click', () => {
    renderDiagnostics();
  });

  ui.refs.clearLogsButton.addEventListener('click', () => {
    clearLogs();
    renderDiagnostics();
  });
}

window.addEventListener('unhandledrejection', async (event) => {
  const reason =
    event.reason instanceof Error ? event.reason : new Error(String(event.reason));
  const message = describeError(reason);
  logAndRender('unhandledrejection', message);
  ui.setStatus('idle', '錯誤');
  ui.setRuntimeHint(message);
  state.isListening = false;
  ui.setListeningState(false);

  try {
    await syncSessionState('error');
  } catch (error) {
    logAndRender('error', describeError(error));
  }
});

window.addEventListener('error', async (event) => {
  const reason =
    event.error instanceof Error
      ? event.error
      : new Error(event.message || 'Unknown renderer error');
  const message = describeError(reason);
  logAndRender('error', message);
  ui.setStatus('idle', '錯誤');
  ui.setRuntimeHint(message);
  state.isListening = false;
  ui.setListeningState(false);

  try {
    await syncSessionState('error');
  } catch (error) {
    logAndRender('error', describeError(error));
  }
});

void bootstrap().catch((error) => {
  const message = describeError(error);
  logAndRender('bootstrap-error', message);
  ui.setStatus('idle', '錯誤');
  ui.setRuntimeHint(message);
});
