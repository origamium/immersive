import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialContext } from "./defaults";
import { analyzeLocalCapture } from "./localAnalysis";
import { runLocalMeasurement } from "./localMeasurement";
import type { AnalysisResult, LocalCapture, MeasurementContext } from "./types";

const calls = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
  create: vi.fn(),
}));
vi.mock("./capture", () => ({
  createCaptureAudioContext: calls.create,
  Recorder: class {
    start = calls.start;
    stop = calls.stop;
  },
}));
vi.mock("./dsp", () => ({
  generateStimulus: () => new Float32Array([0.1, 0.2]),
}));
vi.mock("./localAnalysis", () => ({ analyzeLocalCapture: vi.fn() }));
vi.mock("./local", () => ({ putLocal: vi.fn(async () => {}) }));

function fakeAudio() {
  const buffer = { duration: 0.01, copyToChannel: vi.fn() };
  const sources: {
    onended: (() => void) | null;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  }[] = [];
  return {
    sampleRate: 48000,
    state: "running",
    destination: { maxChannelCount: 2 },
    createBuffer: vi.fn(() => buffer),
    createBufferSource: vi.fn(() => {
      const source = {
        onended: null as null | (() => void),
        start: vi.fn(() => queueMicrotask(() => source.onended?.())),
        stop: vi.fn(),
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
      sources.push(source);
      return source;
    }),
    close: vi.fn(async () => {}),
    buffer,
    sources,
  };
}
let audio: ReturnType<typeof fakeAudio>;
let lastCapture: LocalCapture | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  audio = fakeAudio();
  calls.create.mockReturnValue(audio);
  lastCapture = undefined;
  calls.start.mockImplementation(async (context: MeasurementContext) => {
    lastCapture = {
      id: crypto.randomUUID(),
      createdAt: "",
      context,
      sampleRate: 48000,
      frames: 4,
      chunkCount: 1,
      status: "recording",
      purpose: "sweep",
      analysisOwner: "browser",
    };
    return lastCapture;
  });
  calls.stop.mockImplementation(async (reason?: string) =>
    lastCapture
      ? { ...lastCapture, status: reason ? "interrupted" : "complete", reason }
      : undefined
  );
  vi.mocked(analyzeLocalCapture).mockImplementation(
    async (capture) =>
      ({ id: capture.id, context: capture.context }) as AnalysisResult
  );
});
afterEach(() => vi.useRealTimers());

function options() {
  const context = initialContext();
  context.profile.repeats = 2;
  context.speakerId = "C";
  return {
    context,
    inputId: "ur12",
    inputChannel: 1,
    outputChannel: 2 as const,
    signal: new AbortController().signal,
    onState: vi.fn(),
    onLevel: vi.fn(),
    onCapture: vi.fn(),
    onResult: vi.fn(),
  };
}

describe("local measurement orchestration", () => {
  it("honors repeats and records the actual FR route while playing only the selected channel", async () => {
    const input = options();
    const running = runLocalMeasurement(input);
    await vi.runAllTimersAsync();
    await running;
    expect(calls.start).toHaveBeenCalledTimes(2);
    expect(input.onResult).toHaveBeenCalledTimes(2);
    expect(calls.start.mock.calls[0][0]).toMatchObject({
      speakerId: "FR",
      referenceSpeaker: null,
      acquisition: { mode: "browser", outputChannel: 2 },
      profile: { route: "browser", sampleRate: 48000, repeats: 2 },
    });
    expect(audio.createBuffer).toHaveBeenCalledWith(2, 2, 48000);
    expect(audio.buffer.copyToChannel).toHaveBeenCalledWith(
      expect.any(Float32Array),
      1
    );
    expect(audio.sources).toHaveLength(2);
    expect(audio.close).toHaveBeenCalledOnce();
  });

  it("waits for result persistence before starting the next repeat", async () => {
    const input = options();
    const events: string[] = [];
    input.onResult.mockImplementation(async () => {
      events.push("saving");
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      events.push("saved");
    });
    calls.start.mockImplementation(async (context: MeasurementContext) => {
      events.push("capture");
      lastCapture = {
        id: "capture",
        createdAt: "",
        context,
        sampleRate: 48000,
        frames: 4,
        chunkCount: 1,
        status: "recording",
      };
      return lastCapture;
    });
    const running = runLocalMeasurement(input);
    await vi.runAllTimersAsync();
    await running;
    expect(events).toEqual([
      "capture",
      "saving",
      "saved",
      "capture",
      "saving",
      "saved",
    ]);
  });

  it("stops a pending input acquisition immediately on abort and never emits playback", async () => {
    const input = options();
    const abort = new AbortController();
    input.signal = abort.signal;
    let rejectStart: ((error: Error) => void) | undefined;
    calls.start.mockImplementation(
      () =>
        new Promise((_, reject) => {
          rejectStart = reject;
        })
    );
    calls.stop.mockImplementation(async () => {
      rejectStart?.(new Error("停止"));
      return undefined;
    });
    const running = runLocalMeasurement(input);
    const rejected = expect(running).rejects.toThrow("停止");
    expect(calls.start).toHaveBeenCalledOnce();
    abort.abort();
    expect(calls.stop).toHaveBeenCalled();
    await rejected;
    expect(audio.sources).toHaveLength(0);
    expect(audio.close).toHaveBeenCalledOnce();
  });

  it("rejects unsupported output selection before opening the microphone", async () => {
    const input = { ...options(), outputId: "pma" };
    await expect(runLocalMeasurement(input)).rejects.toThrow(
      "再生デバイスの指定"
    );
    expect(calls.start).not.toHaveBeenCalled();
    expect(audio.close).toHaveBeenCalledOnce();
  });
});
