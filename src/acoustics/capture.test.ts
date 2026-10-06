import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InputMonitor, Recorder } from "./capture";
import { initialContext } from "./defaults";
import { putLocal } from "./local";

vi.mock("./local", () => ({
  captureTabId: () => "test-tab",
  putLocal: vi.fn(async () => {}),
  getLocal: vi.fn(),
}));

class FakeNode {
  disconnect = vi.fn();
  connect = vi.fn((node: FakeNode) => {
    if (node instanceof FakeWorklet)
      queueMicrotask(() =>
        node.message({ type: "ready", channelCount: observedChannels })
      );
    return node;
  });
}
let observedChannels = 2;
class FakeWorklet extends FakeNode {
  static instances: FakeWorklet[] = [];
  options: AudioWorkletNodeOptions;
  onprocessorerror: (() => void) | null = null;
  port = {
    onmessage: null as
      | null
      | ((event: { data: Record<string, unknown> }) => void),
    close: vi.fn(),
    postMessage: vi.fn((type: string) => {
      if (type === "stop")
        queueMicrotask(() => this.message({ type: "stopped" }));
    }),
  };
  constructor(
    _context: unknown,
    _name: string,
    options: AudioWorkletNodeOptions
  ) {
    super();
    this.options = options;
    FakeWorklet.instances.push(this);
  }
  message(data: Record<string, unknown>) {
    this.port.onmessage?.({ data });
  }
}
class FakeContext extends EventTarget {
  static instances: FakeContext[] = [];
  sampleRate = 48000;
  state = "running";
  destination = new FakeNode();
  audioWorklet = { addModule: vi.fn(async () => {}) };
  close = vi.fn(async () => {
    this.state = "closed";
  });
  resume = vi.fn(async () => {});
  createMediaStreamSource = vi.fn(() => new FakeNode());
  createChannelSplitter = vi.fn(() => new FakeNode());
  createGain = vi.fn(() =>
    Object.assign(new FakeNode(), { gain: { value: 1 } })
  );
  createAnalyser = vi.fn(() =>
    Object.assign(new FakeNode(), {
      fftSize: 32768,
      frequencyBinCount: 16384,
      getFloatFrequencyData: (data: Float32Array) => data.fill(-100),
      getFloatTimeDomainData: (data: Float32Array) => data.fill(0.1),
    })
  );
  constructor() {
    super();
    FakeContext.instances.push(this);
  }
}
function makeStream() {
  const track = {
    label: "Steinberg UR12",
    muted: false,
    readyState: "live",
    onended: null as null | (() => void),
    onmute: null as null | (() => void),
    getSettings: () => ({
      deviceId: "ur12",
      sampleRate: 192000,
      channelCount: 2,
      echoCancellation: false,
      autoGainControl: false,
      noiseSuppression: false,
    }),
    stop: vi.fn(),
  };
  return { track, getAudioTracks: () => [track], getTracks: () => [track] };
}
let stream: ReturnType<typeof makeStream>;
let media: EventTarget & { getUserMedia: ReturnType<typeof vi.fn> };
beforeEach(() => {
  vi.clearAllMocks();
  observedChannels = 2;
  FakeContext.instances = [];
  FakeWorklet.instances = [];
  stream = makeStream();
  media = Object.assign(new EventTarget(), {
    getUserMedia: vi.fn(async () => stream),
  });
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("navigator", { mediaDevices: media });
  vi.stubGlobal(
    "document",
    Object.assign(new EventTarget(), { visibilityState: "visible" })
  );
  vi.stubGlobal("AudioContext", FakeContext);
  vi.stubGlobal("AudioWorkletNode", FakeWorklet);
});
afterEach(() => vi.unstubAllGlobals());

describe("discrete microphone capture", () => {
  it("previews without saving audio and closes its own resources", async () => {
    const update = vi.fn();
    const monitor = new InputMonitor(update, vi.fn());
    const preview = await monitor.start(initialContext(), "ur12", 2);
    expect(preview.channelCount).toBe(2);
    expect(preview.deviceLabel).toBe("Steinberg UR12");
    expect(preview.inputSampleRate).toBe(192000);
    expect(preview.sampleRate).toBe(48000);
    expect(preview.peakDBFS).toBeCloseTo(-20);
    expect(preview.rmsDBFS).toBeCloseTo(-20);
    expect(update).toHaveBeenCalled();
    expect(putLocal).not.toHaveBeenCalled();
    expect(FakeWorklet.instances[0].options).toMatchObject({
      channelCountMode: "max",
      channelInterpretation: "discrete",
      processorOptions: { inputChannel: 2 },
    });
    expect(media.getUserMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        audio: expect.objectContaining({
          channelCount: { ideal: 2 },
          echoCancellation: false,
        }),
      })
    );
    await monitor.stop();
    expect(stream.track.stop).toHaveBeenCalledOnce();
    expect(FakeContext.instances[0].close).toHaveBeenCalledOnce();
  });

  it("keeps microphone model, track-reported rate and selected-channel PCM metadata distinct", async () => {
    const shared = new FakeContext();
    const context = initialContext();
    context.microphone = "SHURE SM58";
    const recorder = new Recorder(vi.fn(), vi.fn());
    const capture = await recorder.start(context, "ur12", {
      audioContext: shared as unknown as AudioContext,
      inputChannel: 1,
      purpose: "sweep",
      analysisOwner: "browser",
    });
    expect(capture.context.microphone).toBe("SHURE SM58");
    expect(capture.context.input).toEqual({
      deviceId: "ur12",
      label: "Steinberg UR12",
      channel: 1,
      channelCount: 2,
      sampleRate: 192000,
    });
    expect(capture.sampleRate).toBe(48000);
    const node = FakeWorklet.instances[0];
    const samples = new Float32Array([0.1, -0.2, 0.3]);
    node.message({ type: "pcm", samples, startFrame: 0 });
    const completed = await recorder.stop();
    expect(completed).toMatchObject({
      frames: 3,
      chunkCount: 1,
      status: "complete",
      purpose: "sweep",
      analysisOwner: "browser",
    });
    expect(putLocal).toHaveBeenCalledWith(
      "chunks",
      `${capture.id}:0`,
      samples.buffer
    );
    expect(shared.close).not.toHaveBeenCalled();
    expect(stream.track.stop).toHaveBeenCalledOnce();
  });

  it("rejects an unavailable channel based on worklet input, not optimistic track settings", async () => {
    observedChannels = 1;
    const monitor = new InputMonitor(vi.fn(), vi.fn());
    await expect(monitor.start(initialContext(), "ur12", 2)).rejects.toThrow(
      "実入力 1"
    );
    expect(stream.track.stop).toHaveBeenCalledOnce();
    expect(putLocal).not.toHaveBeenCalled();
  });

  it("cancels pending permission and releases a stream arriving after stop", async () => {
    let grant!: (value: typeof stream) => void;
    media.getUserMedia.mockImplementation(
      () =>
        new Promise((resolve) => {
          grant = resolve;
        })
    );
    const recorder = new Recorder(vi.fn(), vi.fn());
    const start = recorder.start(initialContext(), "ur12");
    const rejected = expect(start).rejects.toThrow("停止");
    expect(await recorder.stop("ユーザー停止")).toBeUndefined();
    await rejected;
    grant(stream);
    await Promise.resolve();
    expect(stream.track.stop).toHaveBeenCalledOnce();
    expect(putLocal).not.toHaveBeenCalled();
    expect(FakeContext.instances).toHaveLength(0);
  });

  it("saves interrupted PCM and releases input on clipping", async () => {
    const interrupted = vi.fn();
    const recorder = new Recorder(vi.fn(), interrupted);
    await recorder.start(initialContext(), "ur12");
    const node = FakeWorklet.instances[0];
    node.message({
      type: "pcm",
      samples: new Float32Array([0.5, 1]),
      startFrame: 0,
    });
    node.message({ type: "clipping" });
    const saved = await recorder.stop();
    expect(saved).toMatchObject({ frames: 2, status: "interrupted" });
    expect(saved?.reason).toContain("クリッピング");
    expect(interrupted).toHaveBeenCalledOnce();
    expect(stream.track.stop).toHaveBeenCalledOnce();
  });

  it("cancels setup safely while owned-context close is still pending", async () => {
    let finishClose: (() => void) | undefined;
    const recorder = new Recorder(vi.fn(), vi.fn());
    const start = recorder.start(initialContext(), "ur12");
    const rejected = expect(start).rejects.toThrow("停止");
    // Suspend module preparation while the context already exists.
    await Promise.resolve();
    await Promise.resolve();
    const context = FakeContext.instances[0];
    context.close.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishClose = resolve;
        })
    );
    const stopping = recorder.stop("ユーザー停止");
    await rejected;
    finishClose?.();
    await expect(stopping).resolves.toBeUndefined();
    expect(stream.track.stop).toHaveBeenCalledOnce();
  });

  it("interrupts on mute and removes lifecycle listeners at stop", async () => {
    const interrupted = vi.fn();
    const recorder = new Recorder(vi.fn(), interrupted);
    await recorder.start(initialContext(), "ur12");
    FakeWorklet.instances[0].message({
      type: "pcm",
      samples: new Float32Array([0.1]),
      startFrame: 0,
    });
    stream.track.onmute?.();
    expect((await recorder.stop())?.status).toBe("interrupted");
    media.dispatchEvent(new Event("devicechange"));
    expect(interrupted).toHaveBeenCalledOnce();
    expect(stream.track.onmute).toBeNull();
  });
});
