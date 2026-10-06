import { useMemo, useState } from "react";
import { comparisonWarnings, interpolate, roomModes, smooth } from "./analysis";
import { ResponseChart } from "./Charts";
import { isSM58 } from "./microphones";
import type { AnalysisResult } from "./types";

export function StandingModesPanel({
  result,
  results,
}: {
  result: AnalysisResult;
  results: AnalysisResult[];
}) {
  const [compareId, setCompareId] = useState("");
  const [frequency, setFrequency] = useState(80);
  const modes = useMemo(
    () => roomModes(result.context.room),
    [result.context.room]
  );
  const comparison = results.find(
    (r) => r.id === compareId && r.id !== result.id
  );
  const curves = useMemo(
    () =>
      [result, ...(comparison ? [comparison] : [])].map((r) => ({
        name: `${r.context.positionName || "測定点"} · ${r.title}`,
        points: smooth(r.response, 48),
      })),
    [result, comparison]
  );
  const level = interpolate(result.response, frequency);
  const firstSlice = result.waterfall?.[0];
  const startLevel = firstSlice
    ? interpolate(firstSlice.response, frequency)
    : null;
  const decay =
    result.waterfall?.map((s) => ({
      seconds: s.seconds,
      db: interpolate(s.response, frequency),
    })) ?? [];
  const validDecay = decay.filter(
    (p): p is { seconds: number; db: number } => p.db !== null
  );
  const origin = startLevel ?? 0;
  const decayPath = validDecay
    .map(
      (p, i) =>
        `${i ? "L" : "M"}${52 + p.seconds * 1400},${26 + Math.min(60, Math.max(-5, origin - p.db)) * 3}`
    )
    .join(" ");
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>定在波を調べる</h2>
        <span className="badge">20–300 Hz</span>
      </div>
      <p className="muted">
        破線は部屋寸法と温度からの予測です。実測にはスピーカーの特性も含まれます。ピーク、減衰、位置による変化を合わせて確認してください。
      </p>
      <label>
        低域を比較する測定位置
        <select
          value={comparison?.id ?? ""}
          onChange={(e) => setCompareId(e.target.value)}
        >
          <option value="">比較なし</option>
          {results
            .filter((r) => r.id !== result.id && r.quality.level !== "invalid")
            .map((r) => (
              <option value={r.id} key={r.id}>
                {r.context.positionName || "測定点"} · {r.title}
              </option>
            ))}
        </select>
      </label>
      <ResponseChart
        curves={curves}
        maxHz={300}
        title="定在波の予測と低域実測"
        supportedBand={isSM58(result.context) ? [50, 15000] : undefined}
        markers={[
          ...modes.map((m) => ({
            hz: m.hz,
            label: `${m.kind} (${m.indices})`,
          })),
          { hz: frequency, label: "選択周波数", selected: true },
        ]}
      />
      <div className="fields">
        <label>
          予測モードを選択
          <select
            value=""
            onChange={(e) => {
              if (e.target.value) setFrequency(Number(e.target.value));
            }}
          >
            <option value="">周波数から選択</option>
            {modes.map((m) => (
              <option key={m.indices} value={m.hz}>
                {m.hz.toFixed(1)} Hz · {m.kind} ({m.indices})
              </option>
            ))}
          </select>
        </label>
        <label>
          確認する周波数 [Hz]
          <input
            type="number"
            min={20}
            max={300}
            step={0.1}
            value={Number(frequency.toFixed(1))}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n))
                setFrequency(Math.min(300, Math.max(20, n)));
            }}
          />
        </label>
      </div>
      <p>
        {frequency.toFixed(1)} Hz · 応答{" "}
        {level == null ? "帯域外" : `${level.toFixed(1)} dB（相対）`}
      </p>
      {isSM58(result.context) && frequency < 50 && (
        <p className="note">
          この周波数はSM58の仕様範囲外です。低いピークや暗騒音を正確に捉えられない可能性があります。
        </p>
      )}
      {validDecay.length > 1 && startLevel !== null ? (
        <figure className="chart">
          <svg
            viewBox="0 0 800 240"
            role="img"
            aria-label={`${frequency.toFixed(1)} Hzの時間別スペクトルの減衰`}
          >
            {[0, 20, 40, 60].map((db) => (
              <g key={db}>
                <line x1={52} x2={752} y1={26 + db * 3} y2={26 + db * 3} />
                <text x={8} y={30 + db * 3}>
                  −{db} dB
                </text>
              </g>
            ))}
            <path d={decayPath} fill="none" stroke="#62e3c3" strokeWidth={2} />
            <text x={52} y={231}>
              0 ms
            </text>
            <text x={710} y={231}>
              500 ms
            </text>
          </svg>
          <figcaption>
            選択周波数の最初の窓を0
            dBとした減衰。各時刻から0.5秒の窓、分解能は約2
            Hz。RT60ではありません。
          </figcaption>
        </figure>
      ) : (
        <p className="muted">
          この測定には減衰データがありません。スイープ測定で確認できます。
        </p>
      )}
      {comparison && comparisonWarnings(result, comparison).length > 0 && (
        <details>
          <summary>比較条件の違い</summary>
          <ul>
            {comparisonWarnings(result, comparison).map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </details>
      )}
      <p className="muted">
        測定位置: {result.context.positionName || "名称なし"} /{" "}
        {result.context.position.map((n) => n.toFixed(2)).join(", ")}{" "}
        m。直方体近似の予測であり、壁材・開口・家具による変化は含みません。
      </p>
    </section>
  );
}
