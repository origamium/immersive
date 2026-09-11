import { captureTabId, getLocal, putLocal } from "./local";
import type { LocalCapture, MeasurementContext } from "./types";

export class Recorder {
  private context?: AudioContext;
  private stream?: MediaStream;
  private node?: AudioWorkletNode;
  private saving = Promise.resolve();
  private capture?: LocalCapture;
  private ending = false;
  private completion?: Promise<LocalCapture | undefined>;
  private fault?: string;
  private stopped?: () => void;
  private timer?: ReturnType<typeof setTimeout>;
  private wakeLock?: WakeLockSentinel;
  private expectedFrame = 0;
  private count = 0;
  private onLevel: (db: number) => void;
  private onInterrupted: (reason: string) => void;
  constructor(
    onLevel: (db: number) => void,
    onInterrupted: (reason: string) => void
  ) {
    this.onLevel = onLevel;
    this.onInterrupted = onInterrupted;
  }
  private visibility = () => {
    if (document.visibilityState !== "visible")
      this.interrupt("画面が非表示になりました");
  };
  private deviceChange = () => this.interrupt("音声デバイスが変更されました");
  private interrupt(reason: string) {
    if (this.ending || !this.capture) return;
    this.fault = reason;
    this.onInterrupted(reason);
    void this.stop(reason).catch(() => {});
  }
  async start(
    input: MeasurementContext,
    deviceId?: string
  ): Promise<LocalCapture> {
    if (!isSecureContext || !navigator.mediaDevices?.getUserMedia)
      throw new Error("録音にはHTTPSとマイク対応ブラウザーが必要です。");
    if (this.capture) throw new Error("録音中です。");
    this.ending = false;
    this.completion = undefined;
    this.fault = undefined;
    this.expectedFrame = 0;
    this.count = 0;
    this.saving = Promise.resolve();
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          channelCount: { ideal: 1 },
          echoCancellation: false,
          autoGainControl: false,
          noiseSuppression: false,
        },
        video: false,
      });
      const track = this.stream.getAudioTracks()[0];
      const settings = track.getSettings();
      this.context = new AudioContext({
        sampleRate: settings.sampleRate ?? 48000,
      });
      await this.context.resume();
      await this.context.audioWorklet.addModule("/pcm-recorder.js");
      const context = structuredClone(input);
      context.microphone = track.label || input.microphone;
      context.processing = {
        echoCancellation: settings.echoCancellation ?? null,
        autoGainControl: settings.autoGainControl ?? null,
        noiseSuppression: settings.noiseSuppression ?? null,
      };
      context.timingVerified = false;
      this.capture = {
        ownerTabId: captureTabId(),
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        context,
        sampleRate: this.context.sampleRate,
        frames: 0,
        chunkCount: 0,
        status: "recording",
      };
      await putLocal("captures", this.capture.id, this.capture);
      this.node = new AudioWorkletNode(this.context, "pcm-recorder", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      this.node.port.onmessage = ({ data }) => {
        if (data.type === "stopped") {
          this.stopped?.();
          return;
        }
        if (data.type === "missing-input") {
          this.interrupt("入力音声が途切れました");
          return;
        }
        if (data.type !== "pcm" || !this.capture) return;
        const samples: Float32Array = data.samples;
        if (data.startFrame !== this.expectedFrame)
          this.fault = "PCMに欠落があります";
        this.expectedFrame = data.startFrame + samples.length;
        const key = `${this.capture.id}:${this.count++}`;
        let peak = 0;
        for (const x of samples) peak = Math.max(peak, Math.abs(x));
        this.onLevel(20 * Math.log10(Math.max(peak, 1e-8)));
        this.capture.frames = this.expectedFrame;
        this.capture.chunkCount = this.count;
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
        if (peak >= 0.999)
          this.interrupt(
            "クリッピングを検出しました。入力ゲインまたは再生音量を下げてください。"
          );
      };
      this.context
        .createMediaStreamSource(this.stream)
        .connect(this.node)
        .connect(this.context.destination);
      track.onended = () => this.interrupt("マイクが切断されました");
      track.onmute = () => this.interrupt("マイク入力が中断されました");
      this.context.onstatechange = () => {
        if (this.context?.state === "suspended")
          this.interrupt("録音がOSに中断されました");
      };
      document.addEventListener("visibilitychange", this.visibility);
      navigator.mediaDevices.addEventListener(
        "devicechange",
        this.deviceChange
      );
      try {
        this.wakeLock = await navigator.wakeLock?.request("screen");
      } catch {
        /* foreground capture remains valid */
      }
      this.timer = setTimeout(
        () => this.interrupt("録音上限の120秒に到達しました"),
        120000
      );
      return structuredClone(this.capture);
    } catch (error) {
      if (this.capture) {
        this.capture.status = "interrupted";
        this.capture.reason = "録音準備中に失敗しました";
        await putLocal("captures", this.capture.id, this.capture).catch(
          () => {}
        );
      }
      await this.cleanup();
      this.capture = undefined;
      throw error;
    }
  }
  stop(reason?: string): Promise<LocalCapture | undefined> {
    if (this.completion) return this.completion;
    this.completion = this.finish(reason);
    return this.completion;
  }
  private async finish(reason?: string): Promise<LocalCapture | undefined> {
    if (!this.capture) return undefined;
    this.ending = true;
    if (reason) this.fault = reason;
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        this.fault ??= "録音終端を確認できませんでした";
        resolve();
      }, 2000);
      this.stopped = () => {
        clearTimeout(timeout);
        resolve();
      };
      this.node?.port.postMessage("stop");
    });
    await this.saving;
    this.capture.status = this.fault ? "interrupted" : "complete";
    this.capture.reason = this.fault;
    const result = structuredClone(this.capture);
    try {
      await putLocal("captures", result.id, result);
      return result;
    } finally {
      await this.cleanup();
      this.capture = undefined;
    }
  }
  private async cleanup() {
    clearTimeout(this.timer);
    document.removeEventListener("visibilitychange", this.visibility);
    navigator.mediaDevices?.removeEventListener(
      "devicechange",
      this.deviceChange
    );
    this.node?.disconnect();
    this.stream?.getTracks().forEach((t) => {
      t.onended = null;
      t.onmute = null;
      t.stop();
    });
    if (this.context) {
      this.context.onstatechange = null;
      if (this.context.state !== "closed") await this.context.close();
    }
    await this.wakeLock?.release().catch(() => {});
    this.context = undefined;
    this.node = undefined;
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
