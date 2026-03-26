const EMPTY_TRANSLATION = '按下「開始收音」後，翻譯字幕會顯示在這裡。';
const EMPTY_TRANSCRIPTION = '原文字幕會同步顯示在這裡。';

const targetLanguageMap = {
  en: 'English',
  'zh-TW': '中文（台灣）',
};

export function getTargetLanguage(sourceLanguage) {
  return sourceLanguage === 'zh-TW' ? 'en' : 'zh-TW';
}

export function createControlUI() {
  const refs = {
    sourceLanguageSelect: document.getElementById('source-language'),
    targetLanguageInput: document.getElementById('target-language'),
    overlayVisibleCheckbox: document.getElementById('overlay-visible'),
    alwaysOnTopCheckbox: document.getElementById('always-on-top'),
    clickThroughCheckbox: document.getElementById('click-through'),
    overlayOpacityInput: document.getElementById('overlay-opacity'),
    overlayOpacityValue: document.getElementById('overlay-opacity-value'),
    startStopButton: document.getElementById('start-stop-button'),
    refreshLogsButton: document.getElementById('refresh-logs-button'),
    clearLogsButton: document.getElementById('clear-logs-button'),
    statusBadge: document.getElementById('status-badge'),
    runtimeHint: document.getElementById('runtime-hint'),
    translationOutput: document.getElementById('translation-output'),
    transcriptionOutput: document.getElementById('transcription-output'),
    diagnosticList: document.getElementById('diagnostic-list'),
    historyList: document.getElementById('history-list'),
  };

  return {
    refs,
    getSourceLanguage() {
      return refs.sourceLanguageSelect.value;
    },
    updateTargetLanguage() {
      refs.targetLanguageInput.value =
        targetLanguageMap[getTargetLanguage(refs.sourceLanguageSelect.value)];
    },
    setStatus(kind, text) {
      refs.statusBadge.className = `status-badge ${kind}`;
      refs.statusBadge.textContent = text;
    },
    setButtonsDisabled(disabled) {
      refs.startStopButton.disabled = disabled;
    },
    setRuntimeHint(text) {
      refs.runtimeHint.textContent = text;
    },
    setPreview({ translationText = '', transcriptionText = '' }) {
      refs.translationOutput.textContent = translationText || EMPTY_TRANSLATION;
      refs.transcriptionOutput.textContent =
        transcriptionText || EMPTY_TRANSCRIPTION;
    },
    setListeningState(isListening) {
      refs.sourceLanguageSelect.disabled = isListening;
      refs.startStopButton.textContent = isListening ? '停止收音' : '開始收音';
    },
    renderHistory(history) {
      refs.historyList.innerHTML = '';

      if (history.length === 0) {
        const emptyState = document.createElement('div');
        emptyState.className = 'history-item';
        emptyState.textContent = '還沒有字幕紀錄。';
        refs.historyList.append(emptyState);
        return;
      }

      history.forEach((item) => {
        const card = document.createElement('div');
        card.className = 'history-item';

        const meta = document.createElement('div');
        meta.className = 'history-meta';
        meta.textContent = `${item.time}  ${item.sourceLanguage} -> ${item.targetLanguage}`;

        const translation = document.createElement('div');
        translation.className = 'history-translation';
        translation.textContent = item.translationText;

        const original = document.createElement('div');
        original.className = 'history-original';
        original.textContent = item.transcriptionText;

        card.append(meta, translation, original);
        refs.historyList.append(card);
      });
    },
    renderDiagnostics(logs) {
      refs.diagnosticList.innerHTML = '';

      if (logs.length === 0) {
        const emptyState = document.createElement('div');
        emptyState.className = 'diagnostic-item';
        emptyState.textContent = '目前沒有診斷紀錄。';
        refs.diagnosticList.append(emptyState);
        return;
      }

      logs.slice(0, 12).forEach((entry) => {
        const item = document.createElement('div');
        item.className = 'diagnostic-item';

        const time = document.createElement('div');
        time.className = 'diagnostic-time';
        time.textContent = `${entry.time}  ${entry.type}`;

        const message = document.createElement('div');
        message.className = 'diagnostic-message';
        message.textContent = entry.message;

        item.append(time, message);
        refs.diagnosticList.append(item);
      });
    },
    readOverlaySettings() {
      return {
        visible: refs.overlayVisibleCheckbox.checked,
        alwaysOnTop: refs.alwaysOnTopCheckbox.checked,
        clickThrough: refs.clickThroughCheckbox.checked,
        opacity: Number(refs.overlayOpacityInput.value) / 100,
      };
    },
    applyOverlaySettings(settings) {
      refs.overlayVisibleCheckbox.checked = settings.visible;
      refs.alwaysOnTopCheckbox.checked = settings.alwaysOnTop;
      refs.clickThroughCheckbox.checked = settings.clickThrough;
      refs.overlayOpacityInput.value = String(Math.round(settings.opacity * 100));
      refs.overlayOpacityValue.textContent = `${refs.overlayOpacityInput.value}%`;
    },
  };
}
