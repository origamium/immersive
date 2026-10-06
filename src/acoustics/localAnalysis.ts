import type { AnalysisRequest } from "./analysis.worker";
import type { analyzeAmbient } from "./dsp";
import { getLocal } from "./local";
import type { AnalysisResult, LocalCapture } from "./types";

/** Assemble a copy: transferring it to the Worker never detaches the saved PCM. */
export async function readCaptureSamples(
  capture: LocalCapture,
  signal: AbortSignal
): Promise<Float32Array> {
  signal.throwIfAborted();
  if (!["complete", "uploaded"].includes(capture.status))
    throw new Error("中断または録音中の原音は解析できません。");
  if (
    ![44100, 48000].includes(capture.sampleRate) ||
    !Number.isSafeInteger(capture.frames) ||
    capture.frames <= 0 ||
    capture.frames > capture.sampleRate * 120 ||
    !Number.isSafeInteger(capture.chunkCount) ||
    capture.chunkCount <= 0
  )
    throw new Error("録音情報が対応範囲外です（44.1/48 kHz、120秒以内）。");
  const samples = new Float32Array(capture.frames);
  let position = 0;
  for (let i = 0; i < capture.chunkCount; i++) {
    signal.throwIfAborted();
    const chunk = await getLocal<ArrayBuffer>("chunks", `${capture.id}:${i}`);
    if (
      !(chunk instanceof ArrayBuffer) ||
      chunk.byteLength === 0 ||
      chunk.byteLength % 4 !== 0
    )
      throw new Error(`録音チャンク${i + 1}が欠落または破損しています。`);
    const values = new Float32Array(chunk);
    if (position + values.length > samples.length)
      throw new Error("PCMのフレーム数が録音情報と一致しません。");
    samples.set(values, position);
    position += values.length;
  }
  signal.throwIfAborted();
  if (position !== capture.frames)
    throw new Error("PCMに欠落があります。原音は保存されています。");
  return samples;
}

async function runWorker<T>(
  capture: LocalCapture,
  mode: AnalysisRequest["mode"],
  signal: AbortSignal,
  onProgress?: (s: string) => void
): Promise<T> {
  onProgress?.("保存済みの原音を読み込み中…");
  const samples = await readCaptureSamples(capture, signal);
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const worker = new Worker(
      new URL("./analysis.worker.ts", import.meta.url),
      { type: "module" }
    );
    const cleanup = () => {
      signal.removeEventListener("abort", abort);
      worker.terminate();
    };
    const abort = () => {
      cleanup();
      reject(
        signal.reason ?? new DOMException("解析を中止しました", "AbortError")
      );
    };
    signal.addEventListener("abort", abort, { once: true });
    worker.onerror = () => {
      cleanup();
      reject(
        new Error(
          "解析ワーカーが停止しました。原音を保持したまま再解析できます。"
        )
      );
    };
    worker.onmessageerror = () => {
      cleanup();
      reject(new Error("解析結果を読み取れませんでした。"));
    };
    worker.onmessage = ({ data }) => {
      if (data.type === "progress") {
        onProgress?.(data.message);
        return;
      }
      cleanup();
      if (data.type === "result") resolve(data.result);
      else reject(new Error(data.message || "音響解析に失敗しました。"));
    };
    if (signal.aborted) {
      abort();
      return;
    }
    const request: AnalysisRequest = {
      mode,
      samples,
      sampleRate: capture.sampleRate,
      context: capture.context,
    };
    try {
      worker.postMessage(request, [samples.buffer]);
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

export async function analyzeLocalCapture(
  capture: LocalCapture,
  signal: AbortSignal,
  onProgress?: (s: string) => void
): Promise<AnalysisResult> {
  if (capture.purpose && capture.purpose !== "sweep")
    throw new Error("この原音はスイープ測定ではありません。");
  const result = await runWorker<AnalysisResult>(
    capture,
    "sweep",
    signal,
    onProgress
  );
  result.localCaptureId = capture.id;
  result.sessionId = capture.cloudSessionId ?? capture.id;
  return result;
}

export function analyzeLocalAmbientCapture(
  capture: LocalCapture,
  signal: AbortSignal,
  onProgress?: (s: string) => void
): Promise<ReturnType<typeof analyzeAmbient>> {
  if (capture.purpose && capture.purpose !== "ambient")
    return Promise.reject(new Error("この原音は暗騒音測定ではありません。"));
  return runWorker(capture, "ambient", signal, onProgress);
}
