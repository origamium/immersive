class PCMRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(32768);
    this.offset = 0;
    this.frames = 0;
    this.stopped = false;
    this.port.onmessage = (e) => {
      if (e.data === "stop") {
        this.flush();
        this.stopped = true;
        this.port.postMessage({ type: "stopped", frames: this.frames });
      }
    };
  }
  flush() {
    if (!this.offset) return;
    const samples = this.buffer.slice(0, this.offset);
    this.port.postMessage(
      { type: "pcm", startFrame: this.frames - this.offset, samples },
      [samples.buffer]
    );
    this.offset = 0;
  }
  process(inputs, outputs) {
    // The output is always silent: monitoring is never connected to the speakers.
    for (const output of outputs) for (const channel of output) channel.fill(0);
    if (this.stopped) return false;
    const channel = inputs[0]?.[0];
    if (!channel) {
      this.port.postMessage({ type: "missing-input" });
      return true;
    }
    for (let i = 0; i < channel.length; i++) {
      this.buffer[this.offset++] = channel[i];
      this.frames++;
      if (this.offset === this.buffer.length) this.flush();
    }
    return true;
  }
}
registerProcessor("pcm-recorder", PCMRecorder);
