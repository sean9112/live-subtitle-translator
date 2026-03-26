class PcmCaptureWorkletProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0]?.[0];

    if (input && input.length > 0) {
      this.port.postMessage(new Float32Array(input));
    }

    return true;
  }
}

registerProcessor('pcm-capture-worklet', PcmCaptureWorkletProcessor);
