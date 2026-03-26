const { contextBridge, ipcRenderer } = require('electron');

const BRIDGE_VERSION = '2026-03-26-bridge-1';

const subtitleBridge = {
  bridgeVersion: BRIDGE_VERSION,
  bridgeMethods: [
    'getRuntimeInfo',
    'warmupModels',
    'processAudio',
    'updateDisplay',
    'updateSessionState',
    'setOverlaySettings',
    'onDisplayUpdate',
    'onOverlaySettingsUpdate',
    'onSessionStateUpdate',
    'onTrayCommand',
  ],
  getRuntimeInfo: () => ipcRenderer.invoke('subtitle:get-runtime-info'),
  warmupModels: (payload) => ipcRenderer.invoke('subtitle:warmup-models', payload),
  processAudio: (payload) => ipcRenderer.invoke('subtitle:process-audio', payload),
  updateDisplay: (payload) => ipcRenderer.invoke('subtitle:update-display', payload),
  updateSessionState: (payload) =>
    ipcRenderer.invoke('subtitle:update-session-state', payload),
  setOverlaySettings: (payload) =>
    ipcRenderer.invoke('subtitle:set-overlay-settings', payload),
  onDisplayUpdate: (callback) => {
    ipcRenderer.removeAllListeners('subtitle:display-updated');
    ipcRenderer.on('subtitle:display-updated', (_event, payload) => callback(payload));
  },
  onOverlaySettingsUpdate: (callback) => {
    ipcRenderer.removeAllListeners('subtitle:overlay-settings-updated');
    ipcRenderer.on('subtitle:overlay-settings-updated', (_event, payload) =>
      callback(payload),
    );
  },
  onSessionStateUpdate: (callback) => {
    ipcRenderer.removeAllListeners('subtitle:session-state-updated');
    ipcRenderer.on('subtitle:session-state-updated', (_event, payload) =>
      callback(payload),
    );
  },
  onTrayCommand: (callback) => {
    ipcRenderer.removeAllListeners('subtitle:tray-command');
    ipcRenderer.on('subtitle:tray-command', (_event, payload) => callback(payload));
  },
};

contextBridge.exposeInMainWorld('subtitleBridge', subtitleBridge);
