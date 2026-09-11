import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import {
  getLocal,
  localCaptures,
  localExperiments,
  localResults,
  putLocal,
  sha256,
} from "./local";
import type { AnalysisResult, Experiment, LocalCapture } from "./types";

export function download(
  name: string,
  data: Blob | string,
  type = "text/plain"
) {
  const url = URL.createObjectURL(
    typeof data === "string" ? new Blob([data], { type }) : data
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
const escapeHTML = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!
  );
export function resultCSV(result: AnalysisResult) {
  return `# Acoustic Lab ${result.version}\n# id ${result.id}\n# quality ${result.quality.level}\nfrequency_hz,level_db,phase_degrees\n${result.response.map((p) => `${p.hz},${p.db},${p.phase ?? ""}`).join("\n")}\n`;
}
export function reportHTML(result: AnalysisResult) {
  const finite = result.response.filter(
    (p) => p.hz >= 20 && p.hz <= 20000 && Number.isFinite(p.db)
  );
  const low = Math.min(...finite.map((p) => p.db), 0) - 5,
    high = Math.max(...finite.map((p) => p.db), 0) + 5;
  const path = finite
    .map(
      (p, i) =>
        `${i ? "L" : "M"}${40 + (Math.log10(p.hz / 20) / 3) * 720},${230 - ((p.db - low) / (high - low)) * 200}`
    )
    .join(" ");
  return `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHTML(result.title)}</title><style>body{font:16px system-ui;max-width:900px;margin:40px auto;padding:20px;color:#123}svg{width:100%;background:#f0f5f5}pre{white-space:pre-wrap;overflow-wrap:anywhere}td,th{padding:8px;border-bottom:1px solid #ddd;text-align:left}@media print{body{margin:0}}</style><h1>${escapeHTML(result.title)}</h1><p>${escapeHTML(result.createdAt)} · ${escapeHTML(result.version)} · ${escapeHTML(result.quality.level)}</p><p>${escapeHTML(result.quality.reasons.join(" / "))}</p><svg viewBox="0 0 800 270" role="img" aria-label="周波数応答"><path d="${path}" fill="none" stroke="#007965" stroke-width="2"/><text x="40" y="258">20 Hz</text><text x="700" y="258">20 kHz</text><text x="5" y="20">dB</text></svg><p>レベルは校正条件に依存します。感度校正なしの値は絶対SPLではありません。</p><h2>品質</h2><p>SNR: ${result.quality.snrDB ?? "未評価"} dB / drift: ${result.quality.driftPPM ?? "未評価"} ppm / clipping: ${result.quality.clippedSamples}</p><h2>帯域減衰 [s]</h2><table><tr><th>Hz</th><th>EDT</th><th>T20</th><th>T30</th><th>判定</th></tr>${(result.decay ?? []).map((d) => `<tr><td>${d.hz}</td><td>${d.edt?.toFixed(3) ?? "—"}</td><td>${d.t20?.toFixed(3) ?? "—"}</td><td>${d.t30?.toFixed(3) ?? "—"}</td><td>${escapeHTML(d.reason ?? "")}</td></tr>`).join("")}</table><h2>測定条件・再現情報</h2><pre>${escapeHTML(JSON.stringify(result.context, null, 2))}</pre><p>measurement ${escapeHTML(result.id)} / raw artifact ${escapeHTML(result.rawArtifactId ?? "未登録")}</p></html>`;
}
export async function exportBackup() {
  const [results, captures, experiments] = await Promise.all([
    localResults(),
    localCaptures(),
    localExperiments(),
  ]);
  const context = await getLocal("settings", "context");
  const files: Record<string, Uint8Array> = {
    "data.json": strToU8(
      JSON.stringify({ version: 1, results, captures, experiments, context })
    ),
  };
  for (const c of captures)
    for (let i = 0; i < c.chunkCount; i++) {
      const chunk = await getLocal<ArrayBuffer>("chunks", `${c.id}:${i}`);
      if (!chunk)
        throw new Error(`録音 ${c.id} のチャンク ${i} が欠落しています`);
      files[`pcm/${c.id}/${i}.f32`] = new Uint8Array(chunk);
    }
  const hashes: Record<string, string> = {};
  for (const [path, bytes] of Object.entries(files))
    hashes[path] = await sha256(bytes.slice().buffer);
  files["manifest.json"] = strToU8(
    JSON.stringify({
      version: 1,
      scope: "this-browser-cache",
      createdAt: new Date().toISOString(),
      hashes,
    })
  );
  download(
    `acoustic-backup-${new Date().toISOString().slice(0, 10)}.zip`,
    new Blob([zipSync(files, { level: 0 }).slice().buffer], {
      type: "application/zip",
    })
  );
}
export async function restoreBackup(file: File) {
  if (file.size > 512 * 1024 * 1024)
    throw new Error(
      "ブラウザーの復元上限は512 MiBです。大容量PCMはMacで復元してください。"
    );
  let total = 0;
  const files = unzipSync(new Uint8Array(await file.arrayBuffer()), {
    filter: (entry) => {
      total += entry.originalSize;
      if (total > 512 * 1024 * 1024)
        throw new Error("展開サイズが上限を超えています");
      return true;
    },
  });
  if (!files["manifest.json"] || !files["data.json"])
    throw new Error("バックアップ形式が異なります");
  const manifest = JSON.parse(strFromU8(files["manifest.json"]));
  if (manifest.version !== 1 || manifest.scope !== "this-browser-cache")
    throw new Error("対応していないバックアップです");
  for (const [path, hash] of Object.entries(manifest.hashes))
    if (!files[path] || (await sha256(files[path].slice().buffer)) !== hash)
      throw new Error(`整合性検証に失敗: ${path}`);
  const data = JSON.parse(strFromU8(files["data.json"])) as {
    version: number;
    results: AnalysisResult[];
    captures: LocalCapture[];
    experiments: Experiment[];
    context?: unknown;
  };
  if (
    data.version !== 1 ||
    !Array.isArray(data.results) ||
    !Array.isArray(data.captures) ||
    !Array.isArray(data.experiments)
  )
    throw new Error("データ形式が不正です");
  const uuid = /^[0-9a-f-]{36}$/i;
  for (const r of data.results)
    if (
      !uuid.test(r.id) ||
      r.schemaVersion !== 1 ||
      !Array.isArray(r.response) ||
      !r.context?.profile ||
      !r.quality
    )
      throw new Error("測定データが不正です");
  for (const c of data.captures) {
    if (
      !uuid.test(c.id) ||
      !Number.isSafeInteger(c.chunkCount) ||
      c.chunkCount < 0 ||
      c.chunkCount > 10000
    )
      throw new Error("録音情報が不正です");
    for (let i = 0; i < c.chunkCount; i++)
      if (
        !files[`pcm/${c.id}/${i}.f32`] ||
        !manifest.hashes[`pcm/${c.id}/${i}.f32`]
      )
        throw new Error("録音チャンクが不足しています");
  }
  // All hashes and references are checked before writing. Existing IDs remain immutable.
  for (const r of data.results)
    if (!(await getLocal("results", r.id))) await putLocal("results", r.id, r);
  for (const c of data.captures)
    if (!(await getLocal("captures", c.id))) {
      for (let i = 0; i < c.chunkCount; i++)
        await putLocal(
          "chunks",
          `${c.id}:${i}`,
          files[`pcm/${c.id}/${i}.f32`].slice().buffer
        );
      await putLocal("captures", c.id, {
        ...c,
        status: c.status === "recording" ? "interrupted" : c.status,
      });
    }
  for (const e of data.experiments)
    if (!(await getLocal("experiments", e.id)))
      await putLocal("experiments", e.id, e);
  if (data.context && !(await getLocal("settings", "context")))
    await putLocal("settings", "context", data.context);
}
