import { ResponseChart } from "./Charts";
import { download, observationCSV } from "./export";
import { isSM58 } from "./microphones";
import type { AmbientObservation } from "./types";

export function ObservationsPanel({
  observations,
}: {
  observations: AmbientObservation[];
}) {
  return (
    <section className="panel">
      <h2>暗騒音の記録</h2>
      <p className="muted">
        入力回路の雑音を含む相対評価です。dBFSは音圧レベルではありません。同じ機器・チャンネル・向き・ゲインで比較してください。
      </p>
      {!observations.length && (
        <p className="empty">「暗騒音を10秒測定」から記録できます。</p>
      )}
      {observations.map((o) => (
        <details key={o.id}>
          <summary>
            {o.context.positionName || "測定点"} ·{" "}
            {new Date(o.createdAt).toLocaleString()} · RMS{" "}
            {o.rmsDBFS.toFixed(1)} dBFS
          </summary>
          <p>
            {o.durationSeconds.toFixed(1)}秒 / Peak {o.peakDBFS.toFixed(1)} dBFS
            / {o.context.microphone} / {o.context.input?.label} ch{" "}
            {o.context.input?.channel ?? 1}
          </p>
          <ResponseChart
            curves={[{ name: "平均パワースペクトル密度", points: o.spectrum }]}
            unit="dBFS/Hz"
            title="暗騒音の平均パワースペクトル密度 [dBFS/Hz]"
            supportedBand={isSM58(o.context) ? [50, 15000] : undefined}
          />
          <ul>
            {o.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() =>
              download(`${o.id}-ambient.csv`, observationCSV(o), "text/csv")
            }
          >
            暗騒音 CSV
          </button>
        </details>
      ))}
    </section>
  );
}
