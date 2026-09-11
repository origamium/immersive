import { repeatability } from "./analysis";
import { ResponseChart } from "./Charts";
import type { AnalysisResult } from "./types";
export function RepeatabilityPanel({
  current,
  results,
}: {
  current: AnalysisResult;
  results: AnalysisResult[];
}) {
  const matching = results
    .filter(
      (r) =>
        r.quality.level !== "invalid" &&
        r.source === current.source &&
        JSON.stringify(r.context) === JSON.stringify(current.context)
    )
    .slice(0, 10);
  const stats = repeatability(matching);
  if (stats.length === 0)
    return (
      <section className="panel">
        <h2>繰り返しの再現性</h2>
        <p className="muted">
          同一条件の有効な測定が2件以上あると、周波数ごとの平均と標準偏差を表示します。
        </p>
      </section>
    );
  const worst = stats.reduce((a, b) => (a.sd > b.sd ? a : b));
  return (
    <section className="panel">
      <h2>繰り返しの再現性 · {matching.length}回</h2>
      <ResponseChart
        curves={[
          {
            name: "平均",
            points: stats.map((p) => ({ hz: p.hz, db: p.mean })),
          },
          {
            name: "+1 SD",
            points: stats.map((p) => ({ hz: p.hz, db: p.mean + p.sd })),
          },
          {
            name: "−1 SD",
            points: stats.map((p) => ({ hz: p.hz, db: p.mean - p.sd })),
          },
        ]}
      />
      <p>
        標準偏差の最大値: <strong>{worst.sd.toFixed(2)} dB</strong> /{" "}
        {worst.hz.toFixed(0)} Hz
      </p>
      <p className="muted">
        同一の保存条件・同じ入力形式で直近10件まで比較。標準偏差は測定のばらつきで、校正誤差や精度保証を表す値ではありません。
      </p>
    </section>
  );
}
