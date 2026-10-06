import { createCaptureAudioContext, Recorder } from "./capture";
import { generateStimulus } from "./dsp";
import { putLocal } from "./local";
import { analyzeLocalCapture } from "./localAnalysis";
import type { AnalysisResult, LocalCapture, MeasurementContext } from "./types";

export interface LocalMeasurementOptions {
  context: MeasurementContext;
  inputId?: string;
  inputChannel?: number;
  outputId?: string;
  outputLabel?: string;
  outputChannel: 1 | 2;
  signal: AbortSignal;
  onState: (state: string) => void;
  onLevel: (db: number) => void;
  onCapture: (capture: LocalCapture) => void | Promise<void>;
  onResult: (result: AnalysisResult) => void | Promise<void>;
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(new Error("測定を停止しました"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}

/** Local capture and playback share one clock; no input audio is monitored. */
export async function runLocalMeasurement(options: LocalMeasurementOptions) {
  if (options.signal.aborted) throw new Error("測定を停止しました");
  if (!options.inputId)
    throw new Error("使用する入力デバイスを選択してください");
  if (options.outputChannel !== 1 && options.outputChannel !== 2)
    throw new Error("再生チャンネルをLまたはRから選択してください");
  const context = structuredClone(options.context);
  const repeats = context.profile.repeats;
  if (!Number.isInteger(repeats) || repeats < 1 || repeats > 3)
    throw new Error("測定回数を1〜3回から選択してください");
  context.profile.route = "browser";
  context.speakerId = options.outputChannel === 1 ? "FL" : "FR";
  context.referenceSpeaker = null;
  context.timingVerified = false;
  context.acquisition = {
    mode: "browser",
    outputDeviceId: options.outputId || "default",
    outputLabel: options.outputLabel || "システム既定出力",
    outputChannel: options.outputChannel,
  };
  // The local route does not acquire or verify the network AVR guard.
  delete context.avrObservation;
  delete context.avrBinding;
  const audio = createCaptureAudioContext();
  const controller = new AbortController();
  let interrupted: string | undefined;
  let playback: AudioBufferSourceNode | undefined;
  let capture: LocalCapture | undefined;
  const recorder = new Recorder(options.onLevel, (reason) => {
    interrupted = reason;
    stopAudio();
    controller.abort();
  });
  function stopAudio() {
    try {
      playback?.stop();
    } catch {
      /* Already ended. */
    }
    playback?.disconnect();
    playback = undefined;
  }
  const abort = () => {
    interrupted ??= "測定を停止しました";
    stopAudio();
    controller.abort();
    void recorder.stop(interrupted).catch(() => {});
  };
  options.signal.addEventListener("abort", abort, { once: true });
  const check = () => {
    if (options.signal.aborted || controller.signal.aborted || interrupted)
      throw new Error(interrupted ?? "測定を停止しました");
  };
  try {
    if (![44100, 48000].includes(audio.sampleRate))
      throw new Error(
        "ブラウザー測定には44.1 kHzまたは48 kHzの処理レートが必要です"
      );
    const sink = audio as AudioContext & {
      setSinkId?: (id: string) => Promise<void>;
    };
    if (options.outputId && options.outputId !== "default") {
      if (!sink.setSinkId)
        throw new Error(
          "このブラウザーは再生デバイスの指定に対応していません。システム既定出力を選択してください。"
        );
      await sink.setSinkId(options.outputId);
    }
    check();
    if (audio.destination.maxChannelCount < 2)
      throw new Error("L/Rを個別再生できるステレオ出力が必要です");
    audio.destination.channelCount = 2;
    audio.destination.channelCountMode = "explicit";
    audio.destination.channelInterpretation = "discrete";
    context.profile.sampleRate = audio.sampleRate;
    const stimulus = generateStimulus({
      sampleRate: audio.sampleRate,
      startHz: context.profile.startHz,
      endHz: context.profile.endHz,
      sweepSeconds: context.profile.sweepSeconds,
      amplitudeDBFS: context.profile.amplitudeDBFS,
    });
    const buffer = audio.createBuffer(2, stimulus.length, audio.sampleRate);
    buffer.copyToChannel(new Float32Array(stimulus), options.outputChannel - 1);
    for (let repeat = 0; repeat < repeats; repeat++) {
      check();
      capture = undefined;
      options.onState(`測定 ${repeat + 1}/${repeats} · 入力を準備`);
      capture = await recorder.start(context, options.inputId, {
        audioContext: audio,
        inputChannel: options.inputChannel ?? 1,
        purpose: "sweep",
        analysisOwner: "browser",
      });
      check();
      await wait(250, controller.signal);
      check();
      options.onState(
        `測定 ${repeat + 1}/${repeats} · ${options.outputChannel === 1 ? "L" : "R"} スイープ収録中`
      );
      const source = audio.createBufferSource();
      playback = source;
      source.buffer = buffer;
      source.channelInterpretation = "discrete";
      source.connect(audio.destination);
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          clearTimeout(timeout);
          source.onended = null;
          reject(new Error(interrupted ?? "測定を停止しました"));
        };
        const timeout = setTimeout(
          () => {
            controller.signal.removeEventListener("abort", onAbort);
            reject(new Error("スイープ再生が完了しませんでした"));
          },
          (buffer.duration + 5) * 1000
        );
        source.onended = () => {
          clearTimeout(timeout);
          controller.signal.removeEventListener("abort", onAbort);
          resolve();
        };
        controller.signal.addEventListener("abort", onAbort, { once: true });
        if (controller.signal.aborted) onAbort();
        else source.start();
      });
      check();
      stopAudio();
      await wait(500, controller.signal);
      check();
      const completed = await recorder.stop();
      if (!completed || completed.status !== "complete")
        throw new Error(completed?.reason ?? "録音が完了しませんでした");
      capture = completed;
      await options.onCapture(completed);
      check();
      options.onState(`測定 ${repeat + 1}/${repeats} · ブラウザーで解析中`);
      const result = await analyzeLocalCapture(
        completed,
        controller.signal,
        options.onState
      );
      check();
      await options.onResult(result);
      check();
      capture = undefined;
    }
    options.onState(`${repeats}回の測定と解析が完了しました`);
  } catch (error) {
    const reason =
      interrupted ?? (error instanceof Error ? error.message : String(error));
    stopAudio();
    const partial = await recorder.stop(reason).catch(() => undefined);
    // A complete recording remains valid if only the subsequent analysis was cancelled.
    if (partial && partial.status !== "complete") {
      capture = { ...partial, status: "interrupted", reason };
      await putLocal("captures", capture.id, capture);
      await options.onCapture(capture);
    }
    throw new Error(reason);
  } finally {
    options.signal.removeEventListener("abort", abort);
    stopAudio();
    await recorder.stop(interrupted).catch(() => {});
    if (audio.state !== "closed") await audio.close().catch(() => {});
  }
}
