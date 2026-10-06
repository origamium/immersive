import { lazy, Suspense } from "react";
import { parseResponse, roomModes } from "./analysis";
import { profiles } from "./defaults";
import { sha256 } from "./local";
import { MicrophoneNotice } from "./MicrophoneNotice";
import { isSM58 } from "./microphones";
import type { MeasurementContext, PlaybackProfile, Point3 } from "./types";

const MeasurementRoom = lazy(() => import("./MeasurementRoom"));
type Props = {
  context: MeasurementContext;
  change: (context: MeasurementContext) => void;
  task: (run: () => Promise<void>) => void;
};
export function RoomPanel({ context: c, change, task }: Props) {
  const profile = (patch: Partial<PlaybackProfile>) =>
    change({ ...c, profile: { ...c.profile, ...patch } });
  return (
    <>
      <div className="section-heading">
        <div>
          <p className="eyebrow">ROOM & SIGNAL CHAIN</p>
          <h1>部屋と測定条件</h1>
        </div>
        <span className="badge">7.1.6 · 14 positions</span>
      </div>
      <div className="two-col">
        <section className="panel">
          <h2>空間を登録</h2>
          <p className="muted">
            初期寸法・座標は仮の値です。原点は床の中央、Xは右、Yは上、Zは後方。単位はm。
          </p>
          <div className="fields">
            {(["width", "depth", "height", "temperature"] as const).map(
              (key, i) => (
                <label key={key}>
                  {["幅 [m]", "奥行 [m]", "高さ [m]", "温度 [°C]"][i]}
                  <input
                    type="number"
                    min={key === "temperature" ? -10 : 0.1}
                    max={key === "temperature" ? 50 : 100}
                    step="0.1"
                    value={c.room[key]}
                    onChange={(e) =>
                      change({
                        ...c,
                        room: { ...c.room, [key]: Number(e.target.value) },
                      })
                    }
                  />
                </label>
              )
            )}
          </div>
          <Suspense fallback={<p>空間を読み込み中…</p>}>
            <MeasurementRoom room={c.room} selected={c.speakerId} />
          </Suspense>
          <h3>測定位置 / リスナー</h3>
          <div className="fields">
            {c.position.map((n, i) => (
              <label key={["x", "y", "z"][i]}>
                {["X", "Y", "Z"][i]} [m]
                <input
                  type="number"
                  step="0.05"
                  value={n}
                  onChange={(e) => {
                    const p = [...c.position] as Point3;
                    p[i] = Number(e.target.value);
                    change({
                      ...c,
                      position: p,
                      room: { ...c.room, listener: p },
                    });
                  }}
                />
              </label>
            ))}
          </div>
        </section>
        <section className="panel">
          <h2>再生プロファイル</h2>
          <label>
            用途
            <select
              value={c.profile.id}
              onChange={(e) => {
                const saved = profiles.find((p) => p.id === e.target.value)!;
                change({ ...c, profile: structuredClone(saved) });
              }}
            >
              <option value="cinema">映画 · AVC-A110</option>
              <option value="music">音楽 · PMA-A110</option>
            </select>
          </label>
          <label>
            出力経路
            <select
              value={c.profile.route}
              onChange={(e) =>
                profile({ route: e.target.value as PlaybackProfile["route"] })
              }
            >
              <option value="mac-hdmi">
                Mac HDMI → AVC-A110（最大8 PCM ch）
              </option>
              <option value="mac-usb">Mac USB → PMA-A110（2 ch）</option>
              <option value="apple-tv">
                Apple TV → AVC-A110（検証済みアセット）
              </option>
              <option value="external">外部再生 / 手動配線</option>
              <option value="browser">
                このMacのブラウザー（左右の個別測定）
              </option>
            </select>
          </label>
          <div className="fields">
            <label>
              要求サンプルレート
              <select
                value={c.profile.sampleRate}
                onChange={(e) =>
                  profile({ sampleRate: Number(e.target.value) })
                }
              >
                {[
                  44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000,
                ].map((n) => (
                  <option key={n} value={n}>
                    {n.toLocaleString()} Hz
                  </option>
                ))}
              </select>
            </label>
            <label>
              信号レベル [dBFS]
              <input
                type="number"
                min="-80"
                max="-12"
                value={c.profile.amplitudeDBFS}
                onChange={(e) =>
                  profile({ amplitudeDBFS: Number(e.target.value) })
                }
              />
            </label>
            <label>
              スイープ長 [s]
              <input
                type="number"
                min="1"
                max="30"
                value={c.profile.sweepSeconds}
                onChange={(e) =>
                  profile({ sweepSeconds: Number(e.target.value) })
                }
              />
            </label>
            <label>
              繰り返し回数
              <input
                type="number"
                min="1"
                max="10"
                value={c.profile.repeats}
                onChange={(e) => profile({ repeats: Number(e.target.value) })}
              />
            </label>
            <label>
              開始周波数 [Hz]
              <input
                type="number"
                min="10"
                value={c.profile.startHz}
                onChange={(e) => profile({ startHz: Number(e.target.value) })}
              />
            </label>
            <label>
              終了周波数 [Hz]
              <input
                type="number"
                max="40000"
                value={c.profile.endHz}
                onChange={(e) => profile({ endHz: Number(e.target.value) })}
              />
            </label>
          </div>
          <p className="note">
            要求値と実際の物理フォーマットは別に記録します。High-res対応やAtmos表示だけで、ビット完全性・高さチャンネルの分離は判定しません。
          </p>
          {Object.entries(c.profile.settings).map(([key, value]) => (
            <label key={key}>
              {key}
              <input
                value={value}
                onChange={(e) =>
                  profile({
                    settings: { ...c.profile.settings, [key]: e.target.value },
                  })
                }
              />
            </label>
          ))}
        </section>
      </div>
      <section className="panel">
        <h2>マイク・校正・時間基準</h2>
        <label>
          マイク種別
          <select
            value={c.microphoneProfile ?? (isSM58(c) ? "sm58" : "unknown")}
            onChange={(e) => {
              const microphoneProfile = e.target.value as NonNullable<
                MeasurementContext["microphoneProfile"]
              >;
              change({
                ...c,
                microphoneProfile,
                microphone:
                  microphoneProfile === "sm58" ? "SHURE SM58" : "未登録",
                calibration: null,
              });
            }}
          >
            <option value="sm58">SHURE SM58（参考測定）</option>
            <option value="measurement">測定用マイク</option>
            <option value="unknown">その他／内蔵マイク</option>
          </select>
        </label>
        <MicrophoneNotice context={c} />
        <div className="fields">
          {(
            [
              "microphone",
              "inputGain",
              "amplifierVolume",
              "orientation",
            ] as const
          ).map((key, i) => (
            <label key={key}>
              {
                [
                  "マイク名",
                  "入力ゲイン（位置・数値）",
                  "アンプ音量（表示値）",
                  "マイクの向き",
                ][i]
              }
              <input
                value={c[key]}
                onChange={(e) => change({ ...c, [key]: e.target.value })}
              />
            </label>
          ))}
          <label>
            時間基準スピーカー
            <select
              value={c.referenceSpeaker ?? ""}
              onChange={(e) =>
                change({ ...c, referenceSpeaker: e.target.value || null })
              }
            >
              <option value="">測定対象と同じ（チャンネル間比較不可）</option>
              {c.room.speakers
                .filter((s) => s.inputChannel !== null)
                .map((s) => (
                  <option key={s.id}>{s.id}</option>
                ))}
            </select>
          </label>
        </div>
        <div className="actions">
          <label className="file-button">
            周波数校正を読み込む
            <input
              type="file"
              accept=".txt,.cal,.csv,.frd"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f)
                  task(async () => {
                    const bytes = await f.arrayBuffer();
                    change({
                      ...c,
                      calibration: {
                        name: f.name,
                        sha256: await sha256(bytes),
                        points: parseResponse(new TextDecoder().decode(bytes)),
                        orientation: "other",
                        splOffsetDB: null,
                      },
                    });
                  });
              }}
            />
          </label>
          <label className="file-button">
            目標カーブを読み込む
            <input
              type="file"
              accept=".txt,.csv,.frd"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f)
                  task(async () =>
                    profile({ target: parseResponse(await f.text()) })
                  );
              }}
            />
          </label>
          {c.calibration && (
            <button
              type="button"
              onClick={() => change({ ...c, calibration: null })}
            >
              校正を解除
            </button>
          )}
        </div>
        <p className="muted">
          {c.calibration
            ? `校正: ${c.calibration.name} · SHA-256 ${c.calibration.sha256.slice(0, 12)}…`
            : "周波数校正なし。内蔵マイクでは位置・条件を固定した相対比較を中心に評価します。"}
        </p>
        {c.calibration && (
          <div className="fields">
            <label>
              校正ファイルの方向
              <select
                value={c.calibration.orientation}
                onChange={(e) =>
                  change({
                    ...c,
                    calibration: {
                      ...c.calibration!,
                      orientation: e.target.value as "0" | "90" | "other",
                    },
                  })
                }
              >
                <option value="other">未確認 / その他</option>
                <option value="0">0°</option>
                <option value="90">90°</option>
              </select>
            </label>
            <label>
              音圧校正オフセット [dB]（実測時のみ）
              <input
                type="number"
                placeholder="未校正"
                value={c.calibration.splOffsetDB ?? ""}
                onChange={(e) =>
                  change({
                    ...c,
                    calibration: {
                      ...c.calibration!,
                      splOffsetDB:
                        e.target.value === "" ? null : Number(e.target.value),
                    },
                  })
                }
              />
            </label>
          </div>
        )}
      </section>
      <section className="panel">
        <h2>スピーカー位置と出力マッピング</h2>
        <p className="muted">
          PCM番号は0始まり。初期配置は提案値です。チャンネル確認用の低レベル信号で実際の接続を検証してください。高さは、検証後の手動配線切り替えでも測定できます。
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Speaker</th>
                <th>X [m]</th>
                <th>Y [m]</th>
                <th>Z [m]</th>
                <th>PCM出力番号</th>
              </tr>
            </thead>
            <tbody>
              {c.room.speakers.map((s, i) => (
                <tr key={s.id}>
                  <th>{s.id}</th>
                  {s.position.map((n, axis) => (
                    <td key={["x", "y", "z"][axis]}>
                      <input
                        aria-label={`${s.id} ${["X", "Y", "Z"][axis]}`}
                        type="number"
                        step="0.1"
                        value={n}
                        onChange={(e) => {
                          const speakers = structuredClone(c.room.speakers);
                          speakers[i].position[axis] = Number(e.target.value);
                          change({ ...c, room: { ...c.room, speakers } });
                        }}
                      />
                    </td>
                  ))}
                  <td>
                    <input
                      aria-label={`${s.id} PCM`}
                      type="number"
                      min="0"
                      max="7"
                      placeholder="未対応"
                      value={s.inputChannel ?? ""}
                      onChange={(e) => {
                        const speakers = structuredClone(c.room.speakers);
                        speakers[i].inputChannel =
                          e.target.value === "" ? null : Number(e.target.value);
                        change({ ...c, room: { ...c.room, speakers } });
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel">
        <h2>寸法から予測する定在波</h2>
        <p className="muted">
          剛壁の直方体モデルによる予測。実測ピークと照合するための仮説で、測定結果ではありません。
        </p>
        <div className="mode-list">
          {roomModes(c.room)
            .slice(0, 24)
            .map((m) => (
              <span key={m.indices}>
                <strong>{m.hz.toFixed(1)} Hz</strong> {m.kind} ({m.indices})
              </span>
            ))}
        </div>
      </section>
    </>
  );
}
