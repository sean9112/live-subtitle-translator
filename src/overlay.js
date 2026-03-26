const subtitleShell = document.getElementById('subtitle-shell');
const overlayStatus = document.getElementById('overlay-status');
const overlayLanguage = document.getElementById('overlay-language');
const overlayTranslation = document.getElementById('overlay-translation');
const overlayOriginal = document.getElementById('overlay-original');

const languageNames = {
  en: 'English',
  'zh-TW': '中文（台灣）',
};

function renderDisplay(payload) {
  const sourceLanguage = payload.sourceLanguage || 'zh-TW';
  const targetLanguage = payload.targetLanguage || 'en';
  const isLive = Boolean(payload.isLive);

  subtitleShell.className = `subtitle-shell ${isLive ? 'live' : 'idle'}`;
  overlayStatus.textContent = isLive ? '即時翻譯' : '待機中';
  overlayLanguage.textContent =
    `${languageNames[sourceLanguage] || sourceLanguage} -> ${languageNames[targetLanguage] || targetLanguage}`;
  overlayTranslation.textContent =
    payload.translationText || '開始收音後，翻譯字幕會顯示在這裡。';
  overlayOriginal.textContent =
    payload.transcriptionText || '原文字幕會同步顯示在這裡。';
}

function applyOverlaySettings(settings = {}) {
  const nextOpacity = Number.isFinite(settings.opacity) ? settings.opacity : 0;
  const clampedOpacity = Math.min(1, Math.max(0, nextOpacity));
  document.documentElement.style.setProperty(
    '--overlay-darkness',
    String(clampedOpacity),
  );
}

async function bootstrap() {
  const runtimeInfo = await window.subtitleBridge.getRuntimeInfo();
  document.documentElement.dataset.platform = runtimeInfo.platform || 'unknown';
  document.documentElement.dataset.visualEffects =
    runtimeInfo.capabilities?.overlayVisualEffects === false ? 'disabled' : 'enabled';
  renderDisplay(runtimeInfo.displayState || {});
  applyOverlaySettings(runtimeInfo.overlaySettings || {});

  window.subtitleBridge.onDisplayUpdate((payload) => {
    renderDisplay(payload);
  });

  window.subtitleBridge.onOverlaySettingsUpdate((payload) => {
    applyOverlaySettings(payload);
  });
}

void bootstrap();
