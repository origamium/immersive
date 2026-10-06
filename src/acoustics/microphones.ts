import type { AnalysisResult, MeasurementContext } from "./types";

export function isSM58(context: MeasurementContext): boolean {
  return (
    context.microphoneProfile === "sm58" ||
    /\bSM\s*58\b/i.test(context.microphone)
  );
}

export function microphoneReasons(context: MeasurementContext): string[] {
  if (!isSM58(context)) return [];
  return [
    "SM58は単一指向性のボーカル用マイクです。向き・ゲインを固定した参考測定として評価します。",
    "SM58の公称帯域は50 Hz〜15 kHzです。帯域内も平坦性を保証せず、帯域外は仕様範囲外です。",
  ];
}

// Older Mac workers may label a calibrated SM58 capture as verified.
// Apply the microphone limitation at read/export boundaries as well.
export function microphoneQuality(result: AnalysisResult): AnalysisResult {
  if (!isSM58(result.context)) return result;
  return {
    ...result,
    quality: {
      ...result.quality,
      level: result.quality.level === "invalid" ? "invalid" : "relative",
      reasons: [
        ...new Set([
          ...result.quality.reasons,
          ...microphoneReasons(result.context),
        ]),
      ],
    },
  };
}
