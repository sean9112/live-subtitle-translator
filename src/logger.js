const LOG_KEY = 'live-subtitle-translator.logs';
const MAX_LOG_ENTRIES = 120;

function readLogs() {
  try {
    return JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
  } catch {
    return [];
  }
}

function writeLogs(entries) {
  localStorage.setItem(LOG_KEY, JSON.stringify(entries.slice(-MAX_LOG_ENTRIES)));
}

export function logEvent(type, message, extra = undefined) {
  const entries = readLogs();
  entries.push({
    time: new Date().toISOString(),
    type,
    message,
    extra,
  });
  writeLogs(entries);
}

export function getRecentLogs() {
  return readLogs().slice().reverse();
}

export function clearLogs() {
  localStorage.removeItem(LOG_KEY);
}
