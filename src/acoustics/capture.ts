import { captureTabId, getLocal, putLocal } from "./local";
import type { LocalCapture, MeasurementContext, ResponsePoint } from "./types";

export interface InputPreview {
  peakDBFS: number;
  rmsDBFS: number;
  spectrum: ResponsePoint[];
  /** AudioContext PCM processing rate. */
  sampleRate: number;
  /** Browser track-reported rate; this does not verify the hardware clock. */
  inputSampleRate: number;
  channelCount: number;
  processing: MeasurementContext["processing"];
  deviceLabel: string;
}

export interface CaptureOptions {
  audioContext?: AudioContext;
  inputChannel?: number;
  purpose?: "sweep" | "ambient" | "manual";
  analysisOwner?: "browser" | "cloud";
  onPreview?: (preview: InputPreview) => void;
}

export function createCaptureAudioContext(): AudioContext {
  try {
    return new AudioContext({ sampleRate: 48000 });
  } catch {
    return new AudioContext({ sampleRate: 44100 });
  }
}

const cancellation = () => new Error("マイク入力を停止しました");
const clippingMessage =
  "クリッピングを検出しました。入力ゲインまたは再生音量を下げてください。";

/** One discrete input channel. The only connection to the output is silent. */
class InputSession {
  context?: AudioContext;
  measurement?: MeasurementContext;
  private ownContext = false;
  private stream?: MediaStream;
  private source?: MediaStreamAudioSourceNode;
  private splitter?: ChannelSplitterNode;
  private analyser?: AnalyserNode;
  private silence?: GainNode;
  private node?: AudioWorkletNode;
  private closed = false;
  private running = false;
  private recording = false;
  private previewTimer?: ReturnType<typeof setInterval>;
  private rejectStart?: (error: Error) => void;
  private ready?: (channels: number) => void;
  private flushed?: () => void;
  private channelCount = 0;
  private onPCM?: (samples: Float32Array, startFrame: number) => void;
  private onFault: (reason: string) => void;
  private onPreview?: (preview: InputPreview) => void;
  constructor(
    onFault: (reason: string) => void,
    onPreview?: (preview: InputPreview) => void
  ) {
    this.onFault = onFault;
    this.onPreview = onPreview;
  }
  private fail(reason: string) {
    if (this.closed) return;
    this.rejectStart?.(new Error(reason));
    if (this.running) this.onFault(reason);
  }
  private visibility = () => {
    if (document.visibilityState !== "visible")
      this.fail("画面が非表示になりました");
  };
  private deviceChange = () => this.fail("音声デバイスが変更されました");
  private stateChange = () => {
    if (this.context?.state !== "running")
      this.fail("マイク入力がOSに中断されました");
  };
  async start(
    input: MeasurementContext,
    deviceId?: string,
    inputChannel = 1,
    sharedContext?: AudioContext
  ): Promise<InputPreview> {
    if (!globalThis.isSecureContext || !navigator.mediaDevices?.getUserMedia)
      throw new Error("録音にはHTTPSとマイク対応ブラウザーが必要です。");
    if (
      !Number.isInteger(inputChannel) ||
      inputChannel < 1 ||
      inputChannel > 32
    )
      throw new Error("入力チャンネルを1〜32で指定してください");
    const cancelled = new Promise<never>((_, reject) => {
      this.rejectStart = reject;
    });
    let readyTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      const streamRequest = navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          // UR12 exposes its microphone and instrument inputs as separate channels.
          channelCount: { ideal: Math.max(2, inputChannel) },
          echoCancellation: false,
          autoGainControl: false,
          noiseSuppression: false,
        },
        video: false,
      });
      void streamRequest.then(
        (stream) => {
          if (this.closed)
            stream.getTracks().forEach((track) => {
              track.stop();
            });
        },
        () => {}
      );
      this.stream = await Promise.race([streamRequest, cancelled]);
      const track = this.stream.getAudioTracks()[0];
      if (!track) throw new Error("音声入力トラックがありません");
      const settings = track.getSettings();
      this.context = sharedContext ?? createCaptureAudioContext();
      this.ownContext = !sharedContext;
      await Promise.race([this.context.resume(), cancelled]);
      await Promise.race([
        this.context.audioWorklet.addModule("/pcm-recorder.js"),
        cancelled,
      ]);
      if (this.closed) throw cancellation();
      const context = structuredClone(input);
      // A USB interface label is not the microphone model.
      context.input = {
        deviceId: settings.deviceId || deviceId || "default",
        label: track.label || "音声入力",
        channel: inputChannel,
        channelCount: settings.channelCount ?? 0,
        sampleRate: settings.sampleRate ?? this.context.sampleRate,
      };
      context.processing = {
        echoCancellation: settings.echoCancellation ?? null,
        autoGainControl: settings.autoGainControl ?? null,
        noiseSuppression: settings.noiseSuppression ?? null,
      };
      context.timingVerified = false;
      this.measurement = context;
      this.node = new AudioWorkletNode(this.context, "pcm-recorder", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        channelCountMode: "max",
        channelInterpretation: "discrete",
        processorOptions: { inputChannel },
      });
      const ready = new Promise<number>((resolve, reject) => {
        this.ready = resolve;
        readyTimer = setTimeout(
          () =>
            reject(
              new Error(
                "入力音声を確認できません。入力デバイスとチャンネルを確認してください。"
              )
            ),
          5000
        );
      });
      this.node.port.onmessage = ({ data }) => {
        if (this.closed) return;
        if (data.type === "ready") {
          this.channelCount = data.channelCount;
          this.ready?.(data.channelCount);
        } else if (data.type === "stopped") this.flushed?.();
        else if (data.type === "unavailable-channel")
          this.fail(
            `入力 ${inputChannel} は利用できません（実入力 ${data.channelCount} チャンネル）`
          );
        else if (data.type === "missing-input")
          this.fail("入力音声が途切れました");
        else if (data.type === "channels-changed")
          this.fail("入力チャンネル構成が変わりました");
        else if (data.type === "pcm" && this.recording)
          this.onPCM?.(data.samples, data.startFrame);
        else if (data.type === "clipping" && this.recording)
          this.fail(clippingMessage);
      };
      this.node.onprocessorerror = () =>
        this.fail("音声収録処理が停止しました");
      this.source = this.context.createMediaStreamSource(this.stream);
      this.source.connect(this.node).connect(this.context.destination);
      track.onended = () => this.fail("マイクが切断されました");
      track.onmute = () => this.fail("マイク入力が中断されました");
      const channels = await Promise.race([ready, cancelled]);
      clearTimeout(readyTimer);
      if (inputChannel > channels)
        throw new Error(
          `入力 ${inputChannel} は利用できません（実入力 ${channels} チャンネル）`
        );
      context.input.channelCount = channels;
      this.splitter = this.context.createChannelSplitter(channels);
      this.splitter.channelInterpretation = "discrete";
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 32768;
      this.analyser.smoothingTimeConstant = 0.4;
      this.analyser.minDecibels = -160;
      this.analyser.maxDecibels = 0;
      this.silence = this.context.createGain();
      this.silence.gain.value = 0;
      this.source.connect(this.splitter);
      this.splitter.connect(this.analyser, inputChannel - 1);
      this.analyser.connect(this.silence).connect(this.context.destination);
      this.context.addEventListener("statechange", this.stateChange);
      document.addEventListener("visibilitychange", this.visibility);
      navigator.mediaDevices.addEventListener(
        "devicechange",
        this.deviceChange
      );
      if (
        document.visibilityState !== "visible" ||
        track.muted ||
        track.readyState === "ended"
      )
        throw new Error(
          "マイク入力が中断されています。画面と入力を確認してください。"
        );
      this.running = true;
      this.previewTimer = setInterval(
        () => this.onPreview?.(this.preview()),
        150
      );
      const preview = this.preview();
      this.onPreview?.(preview);
      return preview;
    } catch (error) {
      await this.close();
      throw error;
    } finally {
      clearTimeout(readyTimer);
      this.rejectStart = undefined;
      this.ready = undefined;
    }
  }
  preview(): InputPreview {
    const analyser = this.analyser;
    const rate = this.context?.sampleRate ?? 48000;
    let peak = 0,
      sum = 0;
    const spectrum: ResponsePoint[] = [];
    if (analyser) {
      const samples = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(samples);
      for (const sample of samples) {
        peak = Math.max(peak, Math.abs(sample));
        sum += sample * sample;
      }
      const bins = new Float32Array(analyser.frequencyBinCount);
      analyser.getFloatFrequencyData(bins);
      const maxHz = Math.min(20000, rate / 2);
      for (let i = 0; i < 240; i++) {
        const hz = 20 * (maxHz / 20) ** (i / 239);
        const bin = Math.min(
          bins.length - 1,
          Math.max(1, Math.round((hz * analyser.fftSize) / rate))
        );
        spectrum.push({ hz, db: Math.max(-160, bins[bin]) });
      }
      sum /= samples.length;
    }
    return {
      peakDBFS: 20 * Math.log10(Math.max(peak, 1e-8)),
      rmsDBFS: 10 * Math.log10(Math.max(sum, 1e-16)),
      spectrum,
      sampleRate: rate,
      inputSampleRate: this.measurement?.input?.sampleRate ?? rate,
      channelCount: this.channelCount,
      processing: this.measurement?.processing ?? {
        echoCancellation: null,
        autoGainControl: null,
        noiseSuppression: null,
      },
      deviceLabel: this.measurement?.input?.label ?? "音声入力",
    };
  }
  record(onPCM: (samples: Float32Array, frame: number) => void) {
    if (this.closed || !this.running) throw cancellation();
    this.onPCM = onPCM;
    this.recording = true;
    this.node?.port.postMessage("record");
  }
  async flush(): Promise<boolean> {
    if (!this.node || !this.recording) return true;
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.flushed = undefined;
        this.recording = false;
        resolve(false);
      }, 1500);
      this.flushed = () => {
        clearTimeout(timeout);
        this.flushed = undefined;
        this.recording = false;
        resolve(true);
      };
      this.node?.port.postMessage("stop");
    });
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    this.running = false;
    this.rejectStart?.(cancellation());
    clearInterval(this.previewTimer);
    document.removeEventListener("visibilitychange", this.visibility);
    navigator.mediaDevices?.removeEventListener(
      "devicechange",
      this.deviceChange
    );
    this.context?.removeEventListener("statechange", this.stateChange);
    for (const node of [
      this.source,
      this.splitter,
      this.analyser,
      this.silence,
      this.node,
    ])
      node?.disconnect();
    if (this.node) {
      this.node.port.onmessage = null;
      this.node.onprocessorerror = null;
      this.node.port.close();
    }
    this.stream?.getTracks().forEach((track) => {
      track.onended = null;
      track.onmute = null;
      track.stop();
    });
    if (this.ownContext && this.context?.state !== "closed")
      await this.context?.close().catch(() => {});
  }
}

/** Preview requests input permission but never creates a stored capture. */
export class InputMonitor {
  private session?: InputSession;
  private onPreview: (preview: InputPreview) => void;
  private onInterrupted: (reason: string) => void;
  constructor(
    onPreview: (preview: InputPreview) => void,
    onInterrupted: (reason: string) => void
  ) {
    this.onPreview = onPreview;
    this.onInterrupted = onInterrupted;
  }
  async start(
    context: MeasurementContext,
    deviceId?: string,
    inputChannel = 1
  ) {
    if (this.session) throw new Error("入力を確認中です");
    const session = new InputSession((reason) => {
      void this.stop();
      this.onInterrupted(reason);
    }, this.onPreview);
    this.session = session;
    try {
      return await session.start(context, deviceId, inputChannel);
    } catch (error) {
      if (this.session === session) this.session = undefined;
      throw error;
    }
  }
  async stop() {
    const session = this.session;
    this.session = undefined;
    await session?.close();
  }
}

export class Recorder {
  private session?: InputSession;
  private capture?: LocalCapture;
  private starting?: Promise<LocalCapture>;
  private completion?: Promise<LocalCapture | undefined>;
  private saving = Promise.resolve();
  private ending = false;
  private fault?: string;
  private timer?: ReturnType<typeof setTimeout>;
  private wakeLock?: WakeLockSentinel;
  private onLevel: (db: number) => void;
  private onInterrupted: (reason: string) => void;
  constructor(
    onLevel: (db: number) => void,
    onInterrupted: (reason: string) => void
  ) {
    this.onLevel = onLevel;
    this.onInterrupted = onInterrupted;
  }
  private interrupt(reason: string) {
    if (this.ending) return;
    this.fault = reason;
    this.onInterrupted(reason);
    void this.stop(reason).catch(() => {});
  }
  start(
    input: MeasurementContext,
    deviceId?: string,
    options: CaptureOptions = {}
  ): Promise<LocalCapture> {
    if (this.session || this.starting)
      return Promise.reject(new Error("録音中です。"));
    this.ending = false;
    this.completion = undefined;
    this.fault = undefined;
    this.saving = Promise.resolve();
    this.session = new InputSession(
      (reason) => this.interrupt(reason),
      (preview) => {
        this.onLevel(preview.peakDBFS);
        options.onPreview?.(preview);
      }
    );
    this.starting = this.begin(input, deviceId, options);
    return this.starting;
  }
  private async begin(
    input: MeasurementContext,
    deviceId: string | undefined,
    options: CaptureOptions
  ): Promise<LocalCapture> {
    const session = this.session;
    if (!session) throw cancellation();
    try {
      await session.start(
        input,
        deviceId,
        options.inputChannel,
        options.audioContext
      );
      if (this.ending) throw cancellation();
      if (!session.measurement || !session.context)
        throw new Error("入力デバイスの情報を取得できませんでした");
      this.capture = {
        ownerTabId: captureTabId(),
        purpose: options.purpose ?? "manual",
        analysisOwner: options.analysisOwner ?? "cloud",
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        context: session.measurement,
        sampleRate: session.context.sampleRate,
        frames: 0,
        chunkCount: 0,
        status: "recording",
      };
      await putLocal("captures", this.capture.id, this.capture);
      if (this.ending) throw cancellation();
      session.record((samples, startFrame) => {
        if (!this.capture) return;
        if (startFrame !== this.capture.frames)
          this.interrupt("PCMに欠落があります");
        const key = `${this.capture.id}:${this.capture.chunkCount++}`;
        this.capture.frames = startFrame + samples.length;
        const snapshot = structuredClone(this.capture);
        this.saving = this.saving
          .then(async () => {
            await putLocal("chunks", key, samples.buffer);
            await putLocal("captures", snapshot.id, snapshot);
          })
          .catch(() => {
            this.fault = "端末にPCMを保存できませんでした";
            this.interrupt(this.fault);
          });
      });
      // A late wake-lock response must not outlive a stopped recorder.
      void navigator.wakeLock
        ?.request("screen")
        .then((lock) => {
          if (this.ending || this.session !== session) void lock.release();
          else this.wakeLock = lock;
        })
        .catch(() => {});
      this.timer = setTimeout(
        () => this.interrupt("録音上限の120秒に到達しました"),
        120000
      );
      return structuredClone(this.capture);
    } catch (error) {
      if (this.capture) {
        this.capture.status = "interrupted";
        this.capture.reason =
          this.fault ??
          (error instanceof Error ? error.message : "録音準備中に失敗しました");
        await putLocal("captures", this.capture.id, this.capture).catch(
          () => {}
        );
      }
      await session.close();
      if (!this.ending) {
        this.capture = undefined;
        this.session = undefined;
      }
      throw error;
    } finally {
      this.starting = undefined;
    }
  }
  stop(reason?: string): Promise<LocalCapture | undefined> {
    if (this.completion) return this.completion;
    this.ending = true;
    if (reason) this.fault = reason;
    this.completion = this.finish();
    return this.completion;
  }
  private async finish(): Promise<LocalCapture | undefined> {
    clearTimeout(this.timer);
    const starting = this.starting;
    if (starting) {
      await this.session?.close();
      await starting.catch(() => {});
    } else if (this.session && !(await this.session.flush())) {
      this.fault ??= "録音終端を確認できませんでした";
    }
    try {
      await this.saving;
      if (!this.capture) return undefined;
      this.capture.status =
        this.fault || this.capture.frames === 0 ? "interrupted" : "complete";
      this.capture.reason =
        this.fault ??
        (this.capture.frames === 0 ? "録音データがありません" : undefined);
      const result = structuredClone(this.capture);
      await putLocal("captures", result.id, result);
      return result;
    } finally {
      await this.session?.close();
      await this.wakeLock?.release().catch(() => {});
      this.wakeLock = undefined;
      this.session = undefined;
      this.capture = undefined;
    }
  }
}
export async function captureWav(capture: LocalCapture): Promise<Blob> {
  const header = new ArrayBuffer(44),
    view = new DataView(header);
  const bytes = capture.frames * 4;
  const label = (offset: number, s: string) =>
    [...s].forEach((c, i) => {
      view.setUint8(offset + i, c.charCodeAt(0));
    });
  label(0, "RIFF");
  view.setUint32(4, 36 + bytes, true);
  label(8, "WAVE");
  label(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 3, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, capture.sampleRate, true);
  view.setUint32(28, capture.sampleRate * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 32, true);
  label(36, "data");
  view.setUint32(40, bytes, true);
  const parts: BlobPart[] = [header];
  for (let i = 0; i < capture.chunkCount; i++) {
    const chunk = await getLocal<ArrayBuffer>("chunks", `${capture.id}:${i}`);
    if (!chunk) throw new Error(`PCMチャンク${i}がありません`);
    parts.push(chunk);
  }
  return new Blob(parts, { type: "audio/wav" });
}
