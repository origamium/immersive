import { useId } from "react";
import type { AnalysisResult, ResponsePoint } from "./types";

const colors = ["#62e3c3", "#ffb86b", "#a3b5ff", "#ed8cd3"];
export function ResponseChart({
  curves,
  phase = false,
  minHz = 20,
  maxHz = 20000,
  unit = "dB",
  title,
  markers = [],
  supportedBand,
}: {
  curves: { name: string; points: ResponsePoint[] }[];
  phase?: boolean;
  minHz?: number;
  maxHz?: number;
  unit?: string;
  title?: string;
  markers?: { hz: number; label: string; selected?: boolean }[];
  supportedBand?: [number, number];
}) {
  const id = useId();
  let low = -10,
    high = 10;
  for (const curve of curves)
    for (const point of curve.points) {
      const value = phase ? point.phase : point.db;
      if (
        point.hz < minHz ||
        point.hz > maxHz ||
        value === undefined ||
        !Number.isFinite(value)
      )
        continue;
      low = Math.min(low, value);
      high = Math.max(high, value);
    }
  const min = phase ? -180 : Math.floor(low / 10) * 10 - 10;
  const max = phase ? 180 : Math.ceil(high / 10) * 10 + 10;
  const x = (hz: number) =>
    56 + (Math.log(hz / minHz) / Math.log(maxHz / minHz)) * 704;
  const y = (db: number) => 240 - ((db - min) / (max - min)) * 216;
  return (
    <figure className="chart">
      <svg viewBox="0 0 800 280" role="img" aria-labelledby={id}>
        <title id={id}>
          {title ??
            (phase
              ? "位相 [度]、時間基準の検証が必要"
              : "周波数応答 [dB]、20 Hz〜20 kHz")}
        </title>
        {supportedBand && (
          <>
            {supportedBand[0] > minHz && (
              <rect
                x={56}
                y={24}
                width={x(Math.min(maxHz, supportedBand[0])) - 56}
                height={216}
                fill="#ffb86b"
                opacity=".09"
              />
            )}
            {supportedBand[1] < maxHz && (
              <rect
                x={x(Math.max(minHz, supportedBand[1]))}
                y={24}
                width={760 - x(Math.max(minHz, supportedBand[1]))}
                height={216}
                fill="#ffb86b"
                opacity=".09"
              />
            )}
          </>
        )}
        {[20, 50, 100, 200, 300, 500, 1000, 2000, 5000, 10000, 20000]
          .filter(
            (hz) => hz >= minHz && hz <= maxHz && (hz !== 300 || maxHz === 300)
          )
          .map((hz) => (
            <g key={hz}>
              <line x1={x(hz)} x2={x(hz)} y1="24" y2="240" />
              <text x={x(hz)} y="263" textAnchor="middle">
                {hz >= 1000 ? `${hz / 1000}k` : hz}
              </text>
            </g>
          ))}
        {[0, 1, 2, 3, 4].map((i) => {
          const db = min + ((max - min) * i) / 4;
          return (
            <g key={i}>
              <line x1="56" x2="760" y1={y(db)} y2={y(db)} />
              <text x="46" y={y(db) + 4} textAnchor="end">
                {db.toFixed(0)}
              </text>
            </g>
          );
        })}
        {markers
          .filter((m) => m.hz >= minHz && m.hz <= maxHz)
          .map((m) => (
            <g key={m.label}>
              <title>
                {m.label}: {m.hz.toFixed(1)} Hz
              </title>
              <path
                d={`M${x(m.hz)},24 V240`}
                stroke={m.selected ? "#ffb86b" : "#657266"}
                strokeDasharray="3 4"
                strokeWidth={m.selected ? 2 : 0.6}
              />
            </g>
          ))}
        {curves.map((c, i) => (
          <path
            key={c.name}
            stroke={colors[i % colors.length]}
            d={c.points
              .filter(
                (p) =>
                  p.hz >= minHz &&
                  p.hz <= maxHz &&
                  Number.isFinite(phase ? p.phase : p.db)
              )
              .map(
                (p, j) =>
                  `${j ? "L" : "M"}${x(p.hz)},${y(phase ? p.phase! : p.db)}`
              )
              .join(" ")}
            fill="none"
            strokeWidth="1.8"
          />
        ))}
      </svg>
      <figcaption>
        {curves.map((c, i) => (
          <span key={c.name} style={{ color: colors[i % colors.length] }}>
            ● {c.name}{" "}
          </span>
        ))}
        <span className="muted">{phase ? "度 / Hz" : `${unit} / Hz`}</span>
        {supportedBand && (
          <span className="muted">薄い橙色: マイクの仕様範囲外</span>
        )}
      </figcaption>
    </figure>
  );
}
export function ImpulseChart({
  points,
  etc = false,
}: {
  points: NonNullable<AnalysisResult["impulse"]>;
  etc?: boolean;
}) {
  const max = Math.max(...points.map((p) => Math.abs(p.value)), 1e-12);
  const start = points[0]?.seconds ?? 0,
    end = points.at(-1)?.seconds ?? 1;
  const x = (t: number) =>
    50 + ((t - start) / Math.max(0.0001, end - start)) * 710;
  const y = (v: number) =>
    etc
      ? 20 -
        Math.max(-80, 20 * Math.log10(Math.max(1e-15, Math.abs(v) / max))) * 2.4
      : 116 - (v / max) * 95;
  return (
    <figure className="chart">
      <svg
        viewBox="0 0 800 250"
        role="img"
        aria-label={etc ? "ETC、ピーク基準 dB" : "インパルス応答"}
      >
        <line x1="50" x2="760" y1="116" y2="116" />
        <path
          d={points
            .map((p, i) => `${i ? "L" : "M"}${x(p.seconds)},${y(p.value)}`)
            .join(" ")}
          fill="none"
          stroke="#62e3c3"
          strokeWidth="1"
        />
        <text x="50" y="240">
          {(start * 1000).toFixed(0)} ms
        </text>
        <text x="680" y="240">
          {(end * 1000).toFixed(0)} ms
        </text>
      </svg>
      <figcaption>
        {etc
          ? "ETC · ピーク基準、表示用ピーク包絡"
          : "IR · 表示用ピーク保持縮約（元PCMは保存）"}
      </figcaption>
    </figure>
  );
}
export function Waterfall({
  slices,
}: {
  slices: NonNullable<AnalysisResult["waterfall"]>;
}) {
  const max = Math.max(
    ...slices.flatMap((s) => s.response.map((p) => p.db)),
    -100
  );
  return (
    <figure className="chart">
      <svg
        viewBox="0 0 800 340"
        role="img"
        aria-label="低域の時間別スペクトル、0〜500 ms"
      >
        <text x="30" y="20">
          20 Hz → 1 kHz · 色: 相対レベル 0〜−60 dB
        </text>
        {slices.map((s, row) => (
          <g key={s.seconds}>
            <text x="8" y={40 + row * 13}>
              {(s.seconds * 1000).toFixed(0)}
            </text>
            {s.response
              .filter((p) => p.hz <= 1000)
              .map((p) => (
                <rect
                  key={p.hz}
                  x={52 + (Math.log(p.hz / 20) / Math.log(50)) * 708}
                  y={30 + row * 13}
                  width="4"
                  height="12"
                  fill={`hsl(${165 + Math.min(1, Math.max(0, (max - p.db) / 60)) * 75} 65% ${60 - Math.min(1, Math.max(0, (max - p.db) / 60)) * 52}%)`}
                />
              ))}
          </g>
        ))}
      </svg>
      <figcaption>
        各時刻から0.5秒の窓。低域の周波数分解能は約2
        Hz。小部屋では帯域ごとの減衰を比較します。
      </figcaption>
    </figure>
  );
}
