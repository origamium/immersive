import type { AnalysisResult, ResponsePoint, RoomModel } from "./types";

export function parseResponse(text: string): ResponsePoint[] {
  const points: ResponsePoint[] = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const trimmed = line.trim();
    if (
      !trimmed ||
      /^[*#;"%]/.test(trimmed) ||
      /^(frequency|freq|hz)/i.test(trimmed)
    )
      continue;
    const values = trimmed.split(/[\s,\t]+/).map(Number);
    if (
      values.length < 2 ||
      !Number.isFinite(values[0]) ||
      !Number.isFinite(values[1]) ||
      values[0] <= 0 ||
      values[0] > 192000 ||
      Math.abs(values[1]) > 300
    )
      throw new Error(
        `${index + 1}行目: 周波数[Hz]とレベル[dB]を確認してください。`
      );
    if (values[2] !== undefined && !Number.isFinite(values[2]))
      throw new Error(`${index + 1}行目: 位相が不正です。`);
    points.push({
      hz: values[0],
      db: values[1],
      ...(values[2] !== undefined ? { phase: values[2] } : {}),
    });
  }
  points.sort((a, b) => a.hz - b.hz);
  if (points.length < 3) throw new Error("3点以上の周波数応答が必要です。");
  if (points.length > 100000)
    throw new Error("応答は100,000点以下にしてください。");
  if (points.some((p, i) => i > 0 && p.hz === points[i - 1].hz))
    throw new Error("同じ周波数が重複しています。");
  return points;
}
export function interpolate(
  points: ResponsePoint[],
  hz: number
): number | null {
  if (!points.length || hz < points[0].hz || hz > points[points.length - 1].hz)
    return null;
  let low = 0,
    high = points.length - 1;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (points[mid].hz <= hz) low = mid;
    else high = mid;
  }
  if (low === high) return points[low].db;
  const ratio =
    Math.log(hz / points[low].hz) / Math.log(points[high].hz / points[low].hz);
  return points[low].db + ratio * (points[high].db - points[low].db);
}
export function smooth(
  points: ResponsePoint[],
  octaveFraction: number
): ResponsePoint[] {
  if (!octaveFraction) return points;
  return points.map((p) => {
    let energy = 0,
      count = 0;
    for (let i = -4; i <= 4; i++) {
      const db = interpolate(points, p.hz * 2 ** (i / (8 * octaveFraction)));
      if (db !== null) {
        energy += 10 ** (db / 10);
        count++;
      }
    }
    return { ...p, db: count ? 10 * Math.log10(energy / count) : p.db };
  });
}
export function roomModes(room: RoomModel) {
  const c = 331.3 + 0.606 * room.temperature;
  const modes: { hz: number; indices: string; kind: string }[] = [];
  if (
    [room.width, room.depth, room.height].some(
      (x) => !Number.isFinite(x) || x <= 0
    )
  )
    return modes;
  for (let x = 0; x <= 8; x++)
    for (let y = 0; y <= 8; y++)
      for (let z = 0; z <= 8; z++) {
        const axes = Number(x > 0) + Number(y > 0) + Number(z > 0);
        if (!axes) continue;
        const hz =
          (c / 2) *
          Math.sqrt(
            (x / room.width) ** 2 +
              (y / room.depth) ** 2 +
              (z / room.height) ** 2
          );
        if (hz <= 300)
          modes.push({
            hz,
            indices: `${x},${y},${z}`,
            kind: ["", "軸", "接線", "斜め"][axes],
          });
      }
  return modes.sort((a, b) => a.hz - b.hz);
}
export function comparisonWarnings(
  a: AnalysisResult,
  b: AnalysisResult
): string[] {
  const warnings: string[] = [];
  const fields = [
    "microphone",
    "inputGain",
    "amplifierVolume",
    "orientation",
    "speakerId",
  ] as const;
  for (const field of fields)
    if (a.context[field] !== b.context[field])
      warnings.push(`${field}が異なります`);
  if (a.context.calibration?.sha256 !== b.context.calibration?.sha256)
    warnings.push("校正ファイルが異なります");
  if (JSON.stringify(a.context.position) !== JSON.stringify(b.context.position))
    warnings.push("測定位置が異なります");
  if (
    JSON.stringify(a.context.processing) !==
    JSON.stringify(b.context.processing)
  )
    warnings.push("録音処理の設定が異なります");
  if (
    JSON.stringify(a.context.profile.settings) !==
      JSON.stringify(b.context.profile.settings) ||
    a.context.profile.route !== b.context.profile.route
  )
    warnings.push("再生経路・アンプ設定が異なります");
  if (
    a.context.microphone === "未登録" ||
    a.context.inputGain === "未確認" ||
    a.context.amplifierVolume === "未確認"
  )
    warnings.push("測定条件に未確認の項目があります");
  if (a.quality.level === "invalid" || b.quality.level === "invalid")
    warnings.push("品質判定が無効の測定を含みます");
  return warnings;
}
export function responseDistance(a: ResponsePoint[], b: ResponsePoint[]) {
  const diffs: number[] = [];
  for (let f = 20; f <= 20000; f *= 2 ** (1 / 12)) {
    const av = interpolate(a, f),
      bv = interpolate(b, f);
    if (av !== null && bv !== null) diffs.push(av - bv);
  }
  if (diffs.length < 12) return null;
  const offset = diffs.reduce((s, x) => s + x, 0) / diffs.length;
  return {
    rms: Math.sqrt(diffs.reduce((s, x) => s + x * x, 0) / diffs.length),
    shapeRMS: Math.sqrt(
      diffs.reduce((s, x) => s + (x - offset) ** 2, 0) / diffs.length
    ),
    offset,
  };
}
export function eqSuggestions(result: AnalysisResult) {
  if (
    result.quality.level !== "verified" ||
    !result.context.calibration ||
    !result.context.profile.target.length
  )
    return [];
  const points = smooth(result.response, 12);
  const peaks: { hz: number; gainDB: number; q: number; reason: string }[] = [];
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i],
      target = interpolate(result.context.profile.target, p.hz);
    if (
      p.hz < 20 ||
      p.hz > 300 ||
      target === null ||
      p.db - target < 2 ||
      p.db <= points[i - 1].db ||
      p.db <= points[i + 1].db
    )
      continue;
    let left = i,
      right = i;
    while (left > 0 && points[left].db > p.db - 3) left--;
    while (right < points.length - 1 && points[right].db > p.db - 3) right++;
    peaks.push({
      hz: p.hz,
      gainDB: -Math.min(6, p.db - target),
      q: Math.min(
        8,
        Math.max(0.5, p.hz / Math.max(1, points[right].hz - points[left].hz))
      ),
      reason: "目標を超える低域ピーク。汎用PEQ候補／再測定が必要",
    });
  }
  const selected: typeof peaks = [];
  for (const p of peaks.sort((a, b) => a.gainDB - b.gainDB))
    if (
      selected.length < 8 &&
      !selected.some((s) => Math.abs(Math.log2(s.hz / p.hz)) < 1 / 6)
    )
      selected.push(p);
  return selected;
}
export function repeatability(results: AnalysisResult[]) {
  if (results.length < 2) return [];
  const points: { hz: number; mean: number; sd: number; n: number }[] = [];
  for (let hz = 20; hz <= 20000; hz *= 2 ** (1 / 12)) {
    const values = results
      .map((r) => interpolate(r.response, hz))
      .filter((v): v is number => v !== null);
    if (values.length !== results.length) continue;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    points.push({
      hz,
      mean,
      sd: Math.sqrt(
        values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1)
      ),
      n: values.length,
    });
  }
  return points;
}
