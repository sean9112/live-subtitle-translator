export const EXPECTED_BRIDGE_VERSION = '2026-03-26-bridge-1';

export class BridgeClient {
  getBridge() {
    return window.subtitleBridge;
  }

  getMeta() {
    const bridge = this.getBridge();
    return {
      version: bridge?.bridgeVersion ?? 'missing',
      methods: Array.isArray(bridge?.bridgeMethods) ? bridge.bridgeMethods : [],
    };
  }

  ensureVersion() {
    const { version } = this.getMeta();
    if (version !== EXPECTED_BRIDGE_VERSION) {
      throw new Error(
        `Bridge version mismatch: expected ${EXPECTED_BRIDGE_VERSION}, got ${version}`,
      );
    }
  }

  requireMethod(methodName) {
    const bridge = this.getBridge();
    const method = bridge?.[methodName];

    if (typeof method !== 'function') {
      throw new Error(`Bridge method unavailable: ${methodName}`);
    }

    return method.bind(bridge);
  }

  async getRuntimeInfo() {
    return this.requireMethod('getRuntimeInfo')();
  }

  async warmupModels(payload) {
    return this.requireMethod('warmupModels')(payload);
  }

  async processAudio(payload) {
    return this.requireMethod('processAudio')(payload);
  }

  async updateDisplay(payload) {
    return this.requireMethod('updateDisplay')(payload);
  }

  async updateSessionState(payload) {
    return this.requireMethod('updateSessionState')(payload);
  }

  async setOverlaySettings(payload) {
    return this.requireMethod('setOverlaySettings')(payload);
  }

  onOverlaySettingsUpdate(callback) {
    this.getBridge()?.onOverlaySettingsUpdate?.(callback);
  }

  onTrayCommand(callback) {
    this.getBridge()?.onTrayCommand?.(callback);
  }

  onSessionStateUpdate(callback) {
    this.getBridge()?.onSessionStateUpdate?.(callback);
  }
}
