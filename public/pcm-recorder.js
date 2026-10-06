class PCMRecorder extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.inputChannel = (options?.processorOptions?.inputChannel ?? 1) - 1;
    this.buffer = new Float32Array(32768);
    this.offset = 0;
    this.frames = 0;
    this.stopped = false;
    this.recording = false;
    this.channelCount = 0;
    this.missingFrames = 0;
    this.faultReported = false;
    this.clipped = false;
    this.port.onmessage = (e) => {
      if (e.data === "record" && !this.stopped) {
        this.recording = true;
        this.frames = 0;
        this.offset = 0;
      } else if (e.data === "stop") {
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
    const channels = inputs[0] ?? [];
    if (channels.length > 0 && !this.channelCount) {
      this.channelCount = channels.length;
      this.port.postMessage({ type: "ready", channelCount: channels.length });
    } else if (channels.length > 0 && channels.length !== this.channelCount) {
      if (!this.faultReported)
        this.port.postMessage({ type: "channels-changed" });
      this.faultReported = true;
      return true;
    }
    if (channels.length > 0 && this.inputChannel >= channels.length) {
      if (!this.faultReported)
        this.port.postMessage({
          type: "unavailable-channel",
          channelCount: channels.length,
        });
      this.faultReported = true;
      return true;
    }
    const channel = channels[this.inputChannel];
    if (!channel) {
      this.missingFrames += outputs[0]?.[0]?.length ?? 128;
      if (
        (this.channelCount > 0 || this.missingFrames > sampleRate / 4) &&
        !this.faultReported
      ) {
        this.port.postMessage({ type: "missing-input" });
        this.faultReported = true;
      }
      return true;
    }
    this.missingFrames = 0;
    if (!this.recording) return true;
    for (let i = 0; i < channel.length; i++) {
      this.buffer[this.offset++] = channel[i];
      this.frames++;
      if (this.offset === this.buffer.length) this.flush();
      if (Math.abs(channel[i]) >= 0.999 && !this.clipped) {
        this.clipped = true;
        this.flush();
        this.port.postMessage({ type: "clipping" });
      }
    }
    return true;
  }
}
registerProcessor("pcm-recorder", PCMRecorder);
