import { useEffect, useRef, useState } from "react";
import { ResponseChart } from "./Charts";
import { InputMonitor, type InputPreview, Recorder } from "./capture";
import { getLocal, putLocal } from "./local";
import { analyzeLocalAmbientCapture } from "./localAnalysis";
import { runLocalMeasurement } from "./localMeasurement";
import { MicrophoneNotice } from "./MicrophoneNotice";
import { isSM58, microphoneReasons } from "./microphones";
import type {
  AmbientObservation,
  AnalysisResult,
  MeasurementContext,
  Point3,
} from "./types";

interface Props {
  context: MeasurementContext;
  change: (context: MeasurementContext) => void;
  onActivity: (active: boolean) => void;
  onResult: (result: AnalysisResult) => Promise<void>;
  onSaved: () => Promise<void>;
  onFinished: () => void;
  disabled: boolean;
}
interface Selection {
  inputId: string;
  inputChannel: number;
  outputId: string;
  outputLabel: string;
}
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
function waitFor(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(new Error("測定を停止しました"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}

export function BrowserMeasurementPanel({
  context,
  change,
  onActivity,
  onResult,
  onSaved,
  onFinished,
  disabled,
}: Props) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selection, setSelection] = useState<Selection>({
    inputId: "",
    inputChannel: 1,
    outputId: "",
    outputLabel: "",
  });
  const [loaded, setLoaded] = useState(false);
  const [active, setActive] = useState<"preview" | "ambient" | "sweep" | null>(
    null
  );
  const [scanning, setScanning] = useState(false);
  const [preview, setPreview] = useState<InputPreview | null>(null);
  const [peak, setPeak] = useState(-160);
  const [status, setStatus] = useState(
    "UR12を選び、入力を確認してください。ログインは不要です。"
  );
  const [error, setError] = useState("");
  const [outputConfirmed, setOutputConfirmed] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const busy = disabled || active !== null || scanning;
  const sinkSelection =
    typeof AudioContext !== "undefined" &&
    "setSinkId" in AudioContext.prototype;
  const inputs = devices.filter((d) => d.kind === "audioinput");
  const outputs = devices.filter((d) => d.kind === "audiooutput");
  useEffect(() => {
    mounted.current = true;
    void getLocal<Selection>("settings", "browser-audio")
      .then((s) => {
        if (!mounted.current) return;
        if (s) setSelection(s);
        setLoaded(true);
      })
      .catch((e) => {
        if (mounted.current) {
          setError(errorText(e));
          setLoaded(true);
        }
      });
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (loaded)
      void putLocal("settings", "browser-audio", selection).catch((e) =>
        setError(errorText(e))
      );
  }, [selection, loaded]);
  const scan = async () => {
    setScanning(true);
    setError("");
    try {
      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error(
          "HTTPSまたはlocalhostで、マイク対応ブラウザーを使用してください。"
        );
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          autoGainControl: false,
          noiseSuppression: false,
        },
        video: false,
      });
      stream.getTracks().forEach((t) => {
        t.stop();
      });
      const list = await navigator.mediaDevices.enumerateDevices();
      setDevices(list);
      const ur12 = list.find(
        (d) => d.kind === "audioinput" && /UR12/i.test(d.label)
      );
      if (!selection.inputId && ur12)
        setSelection((s) => ({
          ...s,
          inputId: ur12.deviceId,
          inputChannel: 1,
        }));
      setStatus(
        ur12
          ? "UR12を検出しました。入力1にSM58を接続してください。"
          : "一覧から使用する入力を選んでください。UR12がなければUSB接続を確認してください。"
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setScanning(false);
    }
  };
  const run = async (
    kind: NonNullable<typeof active>,
    work: (signal: AbortSignal) => Promise<void>
  ) => {
    if (controller.current) return;
    const abort = new AbortController();
    controller.current = abort;
    setError("");
    setActive(kind);
    onActivity(true);
    let complete = false;
    try {
      await work(abort.signal);
      complete = true;
    } catch (e) {
      if (mounted.current) {
        if (
          abort.signal.aborted &&
          !(
            abort.signal.reason instanceof Error &&
            abort.signal.reason.name !== "AbortError"
          )
        )
          setStatus("停止しました。保存済みの原音は履歴に残ります。");
        else setError(errorText(e));
      }
    } finally {
      controller.current = null;
      if (mounted.current) setActive(null);
      onActivity(false);
      try {
        await onSaved();
      } catch (e) {
        if (mounted.current) setError(errorText(e));
      }
      if (complete && kind === "sweep" && mounted.current) onFinished();
    }
  };
  const startPreview = () =>
    void run("preview", async (signal) => {
      let interruption: string | undefined;
      const monitor = new InputMonitor(
        (p) => {
          setPreview(p);
          setPeak(p.peakDBFS);
        },
        (reason) => {
          interruption = reason;
          controller.current?.abort(new Error(reason));
        }
      );
      const stopMonitor = () => {
        void monitor.stop();
      };
      signal.addEventListener("abort", stopMonitor, { once: true });
      try {
        if (signal.aborted) throw new Error("測定を停止しました");
        setStatus("入力を準備中…");
        const p = await monitor.start(
          context,
          selection.inputId,
          selection.inputChannel
        );
        setPreview(p);
        setStatus(
          "入力を確認中 · 原音は保存していません。停止してから測定できます。"
        );
        if (!signal.aborted)
          await new Promise<void>((resolve) =>
            signal.addEventListener("abort", () => resolve(), { once: true })
          );
        if (interruption) throw new Error(interruption);
        setStatus("入力確認を終了しました。");
      } finally {
        signal.removeEventListener("abort", stopMonitor);
        await monitor.stop();
      }
    });
  const startAmbient = () =>
    void run("ambient", async (signal) => {
      let interruption: string | undefined;
      const recorder = new Recorder(setPeak, (reason) => {
        interruption = reason;
        controller.current?.abort(new Error(reason));
      });
      const stopRecorder = () => {
        void recorder
          .stop(interruption ?? "測定を停止しました")
          .catch(() => {});
      };
      signal.addEventListener("abort", stopRecorder, { once: true });
      try {
        if (signal.aborted) throw new Error("測定を停止しました");
        setStatus("暗騒音の入力を準備中…");
        await recorder.start(
          { ...structuredClone(context), acquisition: { mode: "browser" } },
          selection.inputId,
          {
            inputChannel: selection.inputChannel,
            purpose: "ambient",
            analysisOwner: "browser",
          }
        );
        if (signal.aborted) throw new Error("測定を停止しました");
        setStatus("暗騒音を10秒収録中 · 測定音は再生しません。");
        await waitFor(10000, signal);
        const capture = await recorder.stop();
        if (!capture || capture.status !== "complete")
          throw new Error(capture?.reason ?? "録音を保存できませんでした");
        const analysis = await analyzeLocalAmbientCapture(
          capture,
          signal,
          setStatus
        );
        if (signal.aborted) throw new Error("測定を停止しました");
        const observation: AmbientObservation = {
          schemaVersion: 1,
          id: crypto.randomUUID(),
          createdAt: capture.createdAt,
          context: capture.context,
          localCaptureId: capture.id,
          durationSeconds: capture.frames / capture.sampleRate,
          sampleRate: capture.sampleRate,
          spectrumUnit: "dBFS/Hz",
          ...analysis,
          reasons: [
            "入力回路の雑音を含むdBFSの相対評価。絶対音圧ではありません。",
            ...microphoneReasons(capture.context),
            ...(Object.values(capture.context.processing).some(
              (v) => v !== false
            )
              ? [
                  "入力のAGC・ノイズ抑制・エコー除去が停止していることを確認できません。",
                ]
              : []),
          ],
        };
        await putLocal("observations", observation.id, observation);
        setStatus(
          "暗騒音を保存しました。「比較・履歴」でスペクトルと原音を確認できます。"
        );
      } catch (e) {
        await recorder.stop(interruption ?? errorText(e));
        throw interruption ? new Error(interruption) : e;
      } finally {
        signal.removeEventListener("abort", stopRecorder);
      }
    });
  const startSweep = () =>
    void run("sweep", (signal) =>
      runLocalMeasurement({
        context,
        inputId: selection.inputId,
        inputChannel: selection.inputChannel,
        outputId: selection.outputId || undefined,
        outputLabel: selection.outputLabel,
        outputChannel: context.speakerId === "FR" ? 2 : 1,
        signal,
        onState: setStatus,
        onLevel: setPeak,
        onCapture: onSaved,
        onResult,
      })
    );
  return (
    <>
      <div className="measurement-grid browser-measurement">
        <section className="panel">
          <p className="eyebrow">01 / MICROPHONE</p>
          <h2>マイクと入力を確認</h2>
          <label>
            使用マイク
            <select
              disabled={busy}
              value={
                context.microphoneProfile ??
                (isSM58(context) ? "sm58" : "unknown")
              }
              onChange={(e) => {
                const profile = e.target.value as NonNullable<
                  MeasurementContext["microphoneProfile"]
                >;
                change({
                  ...context,
                  microphoneProfile: profile,
                  microphone: profile === "sm58" ? "SHURE SM58" : "未登録",
                  calibration: null,
                });
              }}
            >
              <option value="sm58">SHURE SM58（参考測定）</option>
              <option value="measurement">測定用マイク</option>
              <option value="unknown">その他／内蔵マイク</option>
            </select>
          </label>
          {!isSM58(context) && (
            <label>
              マイクのモデル名
              <input
                disabled={busy}
                value={context.microphone}
                onChange={(e) =>
                  change({ ...context, microphone: e.target.value })
                }
              />
            </label>
          )}
          <label>
            USB録音入力
            <select
              disabled={busy}
              value={selection.inputId}
              onChange={(e) => {
                setSelection({ ...selection, inputId: e.target.value });
                setPreview(null);
                change({ ...context, calibration: null, inputGain: "未確認" });
              }}
            >
              <option value="">入力を選択してください</option>
              {selection.inputId &&
                !inputs.some((d) => d.deviceId === selection.inputId) && (
                  <option value={selection.inputId}>
                    保存済み入力（一覧を更新して接続確認）
                  </option>
                )}
              {inputs.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || "音声入力"}
                </option>
              ))}
            </select>
          </label>
          <button type="button" disabled={busy} onClick={() => void scan()}>
            {scanning ? "機器を確認中…" : "入出力機器を更新"}
          </button>
          <div className="fields">
            <label>
              録音チャンネル
              <select
                disabled={busy}
                value={selection.inputChannel}
                onChange={(e) => {
                  setSelection({
                    ...selection,
                    inputChannel: Number(e.target.value),
                  });
                  setPreview(null);
                  change({
                    ...context,
                    calibration: null,
                    inputGain: "未確認",
                  });
                }}
              >
                <option value={1}>1 · UR12 MIC</option>
                <option value={2}>2 · UR12 HI-Z</option>
              </select>
            </label>
            <label>
              入力ゲイン（つまみ位置）
              <input
                disabled={busy}
                value={context.inputGain}
                onChange={(e) =>
                  change({ ...context, inputGain: e.target.value })
                }
                placeholder="例: INPUT 1 GAIN 3時"
              />
            </label>
          </div>
          <label>
            マイクの向き
            <input
              disabled={busy}
              value={context.orientation}
              onChange={(e) =>
                change({ ...context, orientation: e.target.value })
              }
            />
          </label>
          <MicrophoneNotice context={context} />
          <button
            type="button"
            disabled={busy || !selection.inputId}
            onClick={startPreview}
          >
            入力・スペクトルを確認
          </button>
          <meter
            className="level-meter"
            aria-label="ローカル入力ピーク dBFS"
            min={-80}
            max={0}
            value={Math.max(-80, Math.min(0, peak))}
          />
          <p className="meter-label">
            INPUT PEAK <span>{peak <= -150 ? "—" : peak.toFixed(1)} dBFS</span>
          </p>
          {preview && (
            <p className="muted">
              {preview.deviceLabel} · {preview.channelCount}入力 · 解析{" "}
              {preview.sampleRate / 1000} kHz / 入力報告値{" "}
              {preview.inputSampleRate / 1000} kHz
              <br />
              RMS {preview.rmsDBFS.toFixed(1)} dBFS · AEC{" "}
              {String(preview.processing.echoCancellation ?? "不明")} / AGC{" "}
              {String(preview.processing.autoGainControl ?? "不明")} / NS{" "}
              {String(preview.processing.noiseSuppression ?? "不明")}
            </p>
          )}
        </section>
        <section className="panel">
          <p className="eyebrow">02 / ROOM MEASUREMENT</p>
          <h2>このMacで測定</h2>
          <p className="muted">
            入力はUR12、出力はPMA／AVCなどへ独立して設定できます。左右を1本ずつ測定します。
          </p>
          <label>
            測定音の出力先
            <select
              disabled={busy || !sinkSelection}
              value={selection.outputId}
              onChange={(e) => {
                const device = outputs.find(
                  (d) => d.deviceId === e.target.value
                );
                setSelection({
                  ...selection,
                  outputId: e.target.value,
                  outputLabel: device?.label ?? "",
                });
                setOutputConfirmed(false);
              }}
            >
              <option value="">Macの現在の出力</option>
              {selection.outputId &&
                !outputs.some((d) => d.deviceId === selection.outputId) && (
                  <option value={selection.outputId}>
                    保存済み出力（接続を確認）
                  </option>
                )}
              {outputs.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || "音声出力"}
                </option>
              ))}
            </select>
          </label>
          {!sinkSelection && (
            <p className="muted">
              このブラウザーでは出力機器を選択できません。Macのサウンド設定でPMA／AVCへの出力を選んでください。
            </p>
          )}
          <label>
            出力経路の記録
            <input
              disabled={busy}
              value={selection.outputLabel}
              onChange={(e) => {
                setSelection({ ...selection, outputLabel: e.target.value });
                setOutputConfirmed(false);
              }}
              placeholder="例: Mac USB → PMA-A110"
            />
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              disabled={busy}
              checked={outputConfirmed}
              onChange={(e) => setOutputConfirmed(e.target.checked)}
            />
            接続先とアンプ音量を確認した
          </label>
          <div className="fields">
            <label>
              ローカル測定スピーカー
              <select
                disabled={busy}
                value={context.speakerId === "FR" ? "FR" : "FL"}
                onChange={(e) =>
                  change({ ...context, speakerId: e.target.value })
                }
              >
                <option value="FL">左 / FL</option>
                <option value="FR">右 / FR</option>
              </select>
            </label>
            <label>
              アンプ音量
              <input
                disabled={busy}
                value={context.amplifierVolume}
                onChange={(e) =>
                  change({ ...context, amplifierVolume: e.target.value })
                }
                placeholder="例: −40 dB"
              />
            </label>
          </div>
          <div className="fields">
            <label>
              スイープ時間 [秒]
              <select
                disabled={busy}
                value={context.profile.sweepSeconds}
                onChange={(e) =>
                  change({
                    ...context,
                    profile: {
                      ...context.profile,
                      sweepSeconds: Number(e.target.value),
                    },
                  })
                }
              >
                {[5, 10, 20, 30].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label>
              信号レベル [dBFS]
              <input
                disabled={busy}
                type="number"
                min={-80}
                max={-12}
                step={1}
                value={context.profile.amplitudeDBFS}
                onChange={(e) =>
                  change({
                    ...context,
                    profile: {
                      ...context.profile,
                      amplitudeDBFS: Number(e.target.value),
                    },
                  })
                }
              />
            </label>
            <label>
              繰り返し回数
              <select
                disabled={busy}
                value={context.profile.repeats}
                onChange={(e) =>
                  change({
                    ...context,
                    profile: {
                      ...context.profile,
                      repeats: Number(e.target.value),
                    },
                  })
                }
              >
                {[1, 2, 3].map((n) => (
                  <option value={n} key={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="muted">
            {context.profile.startHz} Hz〜{context.profile.endHz / 1000}{" "}
            kHz。ブラウザー処理は48
            kHzを要求し、入力の報告値と解析レートを記録します。機器の物理レートはMacのAudio
            MIDI設定で確認してください。
          </p>
          <label>
            測定位置の名前
            <input
              disabled={busy}
              value={context.positionName ?? ""}
              onChange={(e) =>
                change({ ...context, positionName: e.target.value })
              }
              placeholder="リスニング位置 / 前方20 cm"
            />
          </label>
          <div className="fields position-fields">
            {["左右 X", "高さ Y", "前後 Z"].map((name, i) => (
              <label key={name}>
                {name} [m]
                <input
                  disabled={busy}
                  type="number"
                  step={0.01}
                  value={context.position[i]}
                  onChange={(e) => {
                    const p = [...context.position] as Point3;
                    p[i] = Number(e.target.value);
                    change({ ...context, position: p });
                  }}
                />
              </label>
            ))}
          </div>
          <button
            type="button"
            className="primary"
            disabled={
              busy ||
              !selection.inputId ||
              !outputConfirmed ||
              !selection.outputLabel.trim()
            }
            onClick={startSweep}
          >
            スイープ測定を開始
          </button>
          <button
            type="button"
            className="ambient-button"
            disabled={busy || !selection.inputId}
            onClick={startAmbient}
          >
            暗騒音を10秒測定
          </button>
          {active && (
            <button
              type="button"
              className="primary danger"
              onClick={() => controller.current?.abort()}
            >
              ■ {active === "preview" ? "入力確認" : "ローカル測定"}を停止
            </button>
          )}
          <output className="status" aria-live="polite">
            {status}
          </output>
          {error && (
            <p className="alert" role="alert">
              {error}
            </p>
          )}
        </section>
      </div>
      {preview && active === "preview" && (
        <section className="panel">
          <h2>リアルタイム入力スペクトル</h2>
          <ResponseChart
            curves={[{ name: "入力スペクトル", points: preview.spectrum }]}
            unit="dBFS"
            title="リアルタイム入力スペクトル [dBFS]"
            supportedBand={isSM58(context) ? [50, 15000] : undefined}
          />
          <p className="muted">
            入力信号の観測です。スピーカーから部屋への周波数応答ではありません。絶対音圧やRT60は算出しません。
          </p>
        </section>
      )}
    </>
  );
}
