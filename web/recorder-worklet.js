// Capture exactly sampleRate mono frames, independent of UI timer scheduling.
class OneSecondRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = new Float32Array(sampleRate);
    this.offset = 0;
    this.done = false;
  }
  process(inputs) {
    if (this.done) return false;
    const channels = inputs[0];
    if (!channels?.length || !channels[0].length) return true;
    const count = Math.min(channels[0].length, this.samples.length - this.offset);
    for (let i = 0; i < count; i++) {
      let value = 0;
      for (const channel of channels) value += channel[i];
      this.samples[this.offset + i] = value / channels.length;
    }
    this.offset += count;
    if (this.offset === this.samples.length) {
      this.done = true;
      this.port.postMessage({ samples: this.samples, sampleRate }, [this.samples.buffer]);
      return false;
    }
    return true; // Output remains silent; microphone audio is never played back.
  }
}
registerProcessor('one-second-recorder', OneSecondRecorder);
