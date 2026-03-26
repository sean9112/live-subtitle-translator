const TARGET_SAMPLE_RATE = 16000;
const WORKLET_PROCESSOR_NAME = 'pcm-capture-worklet';

export function resampleAudio(samples, inputRate, outputRate) {
  if (inputRate === outputRate) {
    return samples;
  }

  const ratio = inputRate / outputRate;
  const outputLength = Math.round(samples.length / ratio);
  const output = new Float32Array(outputLength);

  for (let index = 0; index < outputLength; index += 1) {
    const position = index * ratio;
    const before = Math.floor(position);
    const after = Math.min(before + 1, samples.length - 1);
    const weight = position - before;
    output[index] = samples[before] * (1 - weight) + samples[after] * weight;
  }

  return output;
}

export function concatFloat32Arrays(chunks, totalLength) {
  const merged = new Float32Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }

  return merged;
}

export class PcmCapture {
  constructor({ chunkDurationMs, onChunk, onDebug = () => {} }) {
    this.chunkDurationMs = chunkDurationMs;
    this.onChunk = onChunk;
    this.onDebug = onDebug;
    this.audioContext = null;
    this.mediaStream = null;
    this.mediaStreamSource = null;
    this.captureNode = null;
    this.silentGain = null;
    this.captureBuffer = [];
    this.captureSampleCount = 0;
    this.inputSampleRate = TARGET_SAMPLE_RATE;
    this.chunkSampleTarget = Math.round(
      TARGET_SAMPLE_RATE * (chunkDurationMs / 1000),
    );
    this.isRunning = false;
    this.captureBackend = 'unknown';
    this.workletModulePromise = null;
    this.debugSampleFrames = 0;
    this.hasLoggedFirstSamples = false;
  }

  resetCaptureGraph() {
    this.captureNode?.disconnect();
    this.captureNode?.port?.close?.();
    this.mediaStreamSource?.disconnect();
    this.silentGain?.disconnect();
    this.mediaStream?.getTracks().forEach((track) => track.stop());

    this.captureNode = null;
    this.mediaStreamSource = null;
    this.silentGain = null;
    this.mediaStream = null;
    this.captureBuffer = [];
    this.captureSampleCount = 0;
    this.captureBackend = 'unknown';
    this.debugSampleFrames = 0;
    this.hasLoggedFirstSamples = false;
  }

  async ensureAudioContext() {
    if (!this.audioContext || this.audioContext.state === 'closed') {
      this.audioContext = new AudioContext();
    }

    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    return this.audioContext;
  }

  handleSamples(input) {
    if (!this.isRunning || !input?.length) {
      return;
    }

    this.debugSampleFrames += input.length;
    if (!this.hasLoggedFirstSamples) {
      this.hasLoggedFirstSamples = true;
      let peak = 0;
      let sum = 0;

      for (let index = 0; index < input.length; index += 1) {
        const value = Math.abs(input[index]);
        peak = Math.max(peak, value);
        sum += input[index] * input[index];
      }

      const rms = Math.sqrt(sum / input.length);
      this.onDebug(
        `收到第一批樣本：frames=${input.length} peak=${peak.toFixed(4)} rms=${rms.toFixed(4)}`,
      );
    }

    const copy = new Float32Array(input.length);
    copy.set(input);
    this.captureBuffer.push(copy);
    this.captureSampleCount += copy.length;

    if (this.captureSampleCount >= this.chunkSampleTarget) {
      void this.flush();
    }
  }

  async ensureWorkletModule(audioContext) {
    if (!audioContext.audioWorklet || typeof AudioWorkletNode !== 'function') {
      throw new Error('AudioWorklet unavailable');
    }

    if (!this.workletModulePromise) {
      const workletUrl = new URL('./pcm-capture-worklet.js', import.meta.url);
      this.workletModulePromise = audioContext.audioWorklet.addModule(workletUrl);
    }

    await this.workletModulePromise;
  }

  async createCaptureNode(audioContext) {
    try {
      await this.ensureWorkletModule(audioContext);
      const workletNode = new AudioWorkletNode(audioContext, WORKLET_PROCESSOR_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 1,
      });
      workletNode.port.onmessage = (event) => {
        this.handleSamples(event.data);
      };
      this.captureBackend = 'audio-worklet';
      return workletNode;
    } catch (error) {
      console.warn('Falling back to ScriptProcessorNode for PCM capture:', error);
    }

    const processorNode = audioContext.createScriptProcessor(4096, 1, 1);
    processorNode.onaudioprocess = (event) => {
      this.handleSamples(event.inputBuffer.getChannelData(0));
    };
    this.captureBackend = 'script-processor';
    return processorNode;
  }

  async start({ deviceId = '' } = {}) {
    if (this.isRunning) {
      return;
    }

    try {
      const audioConstraints = {
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      };

      if (deviceId) {
        audioConstraints.deviceId = { exact: deviceId };
      }

      const mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
        video: false,
      });

      const audioContext = await this.ensureAudioContext();
      const [audioTrack] = mediaStream.getAudioTracks();
      if (!audioTrack) {
        throw new Error('麥克風串流沒有 audio track。');
      }

      const trackSettings = audioTrack.getSettings?.() || {};
      this.onDebug(
        `getUserMedia 成功：track.readyState=${audioTrack.readyState} muted=${audioTrack.muted} enabled=${audioTrack.enabled} label=${audioTrack.label || 'unknown'} sampleRate=${trackSettings.sampleRate ?? 'unknown'} deviceId=${trackSettings.deviceId ? 'available' : 'missing'} requestedDevice=${deviceId || 'default'}`,
      );
      audioTrack.onmute = () => this.onDebug('麥克風 track 進入 muted 狀態');
      audioTrack.onunmute = () => this.onDebug('麥克風 track 恢復 unmuted 狀態');
      audioTrack.onended = () => this.onDebug('麥克風 track 已結束');

      this.inputSampleRate = audioContext.sampleRate;
      this.onDebug(`AudioContext 已建立：state=${audioContext.state} sampleRate=${audioContext.sampleRate}`);
      this.chunkSampleTarget = Math.round(
        this.inputSampleRate * (this.chunkDurationMs / 1000),
      );
      this.captureBuffer = [];
      this.captureSampleCount = 0;

      this.mediaStream = mediaStream;
      this.mediaStreamSource = audioContext.createMediaStreamSource(mediaStream);
      this.captureNode = await this.createCaptureNode(audioContext);
      this.silentGain = audioContext.createGain();
      this.silentGain.gain.value = 0;

      this.mediaStreamSource.connect(this.captureNode);
      this.captureNode.connect(this.silentGain);
      this.silentGain.connect(audioContext.destination);
      this.isRunning = true;
      this.onDebug(`PCM capture 已啟動：backend=${this.captureBackend}`);
    } catch (error) {
      this.isRunning = false;
      this.resetCaptureGraph();
      throw error;
    }
  }

  async flush() {
    if (this.captureSampleCount === 0) {
      return;
    }

    const merged = concatFloat32Arrays(this.captureBuffer, this.captureSampleCount);
    this.captureBuffer = [];
    this.captureSampleCount = 0;

    const resampled =
      this.inputSampleRate === TARGET_SAMPLE_RATE
        ? merged
        : resampleAudio(merged, this.inputSampleRate, TARGET_SAMPLE_RATE);

    this.onDebug(
      `送出音訊片段：inputFrames=${merged.length} outputFrames=${resampled.length} collectedFrames=${this.debugSampleFrames}`,
    );

    await this.onChunk(resampled);
  }

  async stop() {
    if (!this.isRunning && !this.mediaStream && this.captureSampleCount === 0) {
      return;
    }

    this.isRunning = false;
    try {
      await this.flush();
    } finally {
      this.resetCaptureGraph();
    }
  }
}
