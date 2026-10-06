import { analyzeAmbient, analyzeSweep } from "./dsp";
import type { MeasurementContext } from "./types";

export interface AnalysisRequest {
  mode: "sweep" | "ambient";
  samples: Float32Array;
  sampleRate: number;
  context: MeasurementContext;
}

// This module runs only inside a dedicated Worker. Keep its DOM-free DSP import
// independent so Vitest can exercise precisely the same algorithms.
self.onmessage = ({ data }: MessageEvent<AnalysisRequest>) => {
  try {
    const result =
      data.mode === "ambient"
        ? analyzeAmbient(data.samples, data.sampleRate, data.context)
        : analyzeSweep(data.samples, data.sampleRate, data.context, (message) =>
            self.postMessage({ type: "progress", message })
          );
    self.postMessage({ type: "result", result });
  } catch (error) {
    self.postMessage({
      type: "error",
      message:
        error instanceof Error ? error.message : "音響解析に失敗しました。",
    });
  }
};
