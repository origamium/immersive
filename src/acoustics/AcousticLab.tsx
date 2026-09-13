import type { SupabaseClient } from "@supabase/supabase-js";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  comparisonWarnings,
  eqSuggestions,
  parseResponse,
  responseDistance,
  smooth,
} from "./analysis";
import { ImpulseChart, ResponseChart, Waterfall } from "./Charts";
import { ConnectionPanel } from "./ConnectionPanel";
import { captureWav, Recorder } from "./capture";
import {
  cloudDevices,
  ensureWorkspace,
  fetchResults,
  makeCloud,
  syncCapture,
  syncResult,
  uploadFile,
} from "./cloud";
import { initialContext } from "./defaults";
import {
  download,
  exportBackup,
  reportHTML,
  restoreBackup,
  resultCSV,
} from "./export";
import {
  getLocal,
  localCaptures,
  localExperiments,
  localResults,
  putLocal,
  recoverCaptures,
  sha256,
} from "./local";
import { runMeasurement } from "./measurement";
import { RepeatabilityPanel } from "./RepeatabilityPanel";
import { RoomPanel } from "./RoomPanel";
import { StimulusPanel } from "./StimulusPanel";
import type {
  AnalysisResult,
  CloudDevice,
  Experiment,
  LocalCapture,
  MeasurementContext,
} from "./types";
import "./acoustics.css";
const AvrPanel = lazy(() =>
  import("../avr/AvrPanel").then((m) => ({ default: m.AvrPanel }))
);
const Visualizer = lazy(() =>
  import("../App").then((m) => ({ default: m.App }))
);
const tabs = [
  "測定",
  "解析",
  "比較・履歴",
  "部屋・機材",
  "AVR",
  "接続",
] as const;
type Tab = (typeof tabs)[number] | "演出";
const qualityName = {
  verified: "条件検証済み",
  relative: "相対評価",
  invalid: "測定無効",
};
const speakerMap: Record<string, [number, number]> = {
  FL: [23, 18],
  FR: [77, 18],
  C: [50, 15],
  LFE: [10, 34],
  SL: [12, 57],
  SR: [88, 57],
  SBL: [23, 85],
  SBR: [77, 85],
  TFL: [36, 33],
  TFR: [64, 33],
  TML: [36, 54],
  TMR: [64, 54],
  TRL: [36, 75],
  TRR: [64, 75],
};
const message = (error: unknown) =>
  error instanceof Error
    ? error.message
    : typeof error === "object" && error && "message" in error
      ? String(error.message)
      : String(error);

export function AcousticLab() {
  const [validationOnly, setValidationOnly] = useState(false);
  const [tab, setTab] = useState<Tab>("測定"),
    [context, setContext] = useState(initialContext),
    [loaded, setLoaded] = useState(false);
  const [results, setResults] = useState<AnalysisResult[]>([]),
    [captures, setCaptures] = useState<LocalCapture[]>([]),
    [experiments, setExperiments] = useState<Experiment[]>([]);
  const [selected, setSelected] = useState(""),
    [compareId, setCompareId] = useState(""),
    [fraction, setFraction] = useState(12);
  const [status, setStatus] = useState(
      "測定するスピーカーと再生端末を選択してください"
    ),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [recording, setRecording] = useState(false),
    [level, setLevel] = useState(-160);
  const [url, setURL] = useState(import.meta.env.VITE_SUPABASE_URL ?? ""),
    [publicKey, setPublicKey] = useState(
      import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? ""
    );
  const [workspace, setWorkspace] = useState(""),
    [devices, setDevices] = useState<CloudDevice[]>([]),
    [target, setTarget] = useState(""),
    [inputId, setInputId] = useState(""),
    [inputs, setInputs] = useState<MediaDeviceInfo[]>([]),
    [assetId, setAssetId] = useState("");
  const [hypothesis, setHypothesis] = useState(""),
    [change, setChange] = useState(""),
    [notes, setNotes] = useState(""),
    [search, setSearch] = useState("");
  const abort = useRef<AbortController | null>(null),
    manual = useRef<Recorder | null>(null);
  const client = useMemo<SupabaseClient | null>(() => {
    if (!url || !publicKey) return null;
    try {
      return makeCloud(url, publicKey);
    } catch {
      return null;
    }
  }, [url, publicKey]);
  const refreshLocal = useCallback(async () => {
    const [r, c, e] = await Promise.all([
      localResults(),
      localCaptures(),
      localExperiments(),
    ]);
    setResults(r.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    setCaptures(c.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    setExperiments(e);
  }, []);
  const refresh = useCallback(async () => {
    await refreshLocal();
    if (!client) {
      setWorkspace("");
      setDevices([]);
      return;
    }
    const auth = await client.auth.getSession();
    if (!auth.data.session) {
      setWorkspace("");
      setDevices([]);
      return;
    }
    const w = await ensureWorkspace(client);
    setWorkspace(w);
    const [d, r, history] = await Promise.all([
      cloudDevices(client, w),
      fetchResults(client, w),
      client
        .from("experiments")
        .select("data")
        .eq("workspace_id", w)
        .order("created_at", { ascending: false })
        .limit(1000),
    ]);
    if (history.error) throw history.error;
    setDevices(d);
    await Promise.all(
      r.map((result) => putLocal("results", result.id, result))
    );
    await Promise.all(
      (history.data ?? []).map(({ data }) =>
        putLocal("experiments", data.id, data)
      )
    );
    await refreshLocal();
  }, [client, refreshLocal]);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [c, cloud] = await Promise.all([
          getLocal<MeasurementContext>("settings", "context"),
          getLocal<{ url: string; key: string }>("settings", "cloud"),
        ]);
        if (!active) return;
        if (c) setContext(c);
        if (cloud) {
          setURL(cloud.url);
          setPublicKey(cloud.key);
        }
        await refreshLocal();
        await recoverCaptures();
        await refreshLocal();
        setLoaded(true);
      } catch (e) {
        setError(message(e));
      }
    })();
    return () => {
      active = false;
    };
  }, [refreshLocal]);
  useEffect(() => {
    if (loaded)
      void putLocal("settings", "context", context).catch((e) =>
        setError(message(e))
      );
  }, [context, loaded]);
  useEffect(() => {
    void refresh().catch((e) => setError(message(e)));
    if (!client) return;
    const { data } = client.auth.onAuthStateChange(() => {
      setTimeout(() => {
        void refresh().catch((e) => setError(message(e)));
      }, 0);
    });
    return () => data.subscription.unsubscribe();
  }, [client, refresh]);
  useEffect(() => {
    if (!client || !workspace) return;
    const channel = client
      .channel(`acoustic:${workspace}`, { config: { private: true } })
      .on("broadcast", { event: "changed" }, () => {
        void refresh().catch((e) => setError(message(e)));
      })
      .subscribe();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible" && !recording)
        void refresh().catch(() => {});
    }, 15000);
    return () => {
      clearInterval(timer);
      void client.removeChannel(channel);
    };
  }, [client, workspace, refresh, recording]);
  useEffect(
    () => () => {
      abort.current?.abort();
      void manual.current?.stop("画面を終了しました");
    },
    []
  );
  useEffect(() => {
    if (!selected && results[0]) setSelected(results[0].id);
  }, [selected, results]);
  const task = (fn: () => Promise<void>) => {
    setError("");
    setBusy(true);
    void fn()
      .catch((e) => setError(message(e)))
      .finally(() => setBusy(false));
  };
  const result = results.find((r) => r.id === selected),
    comparison = results.find((r) => r.id === compareId);
  const usableDevices = devices.filter(
    (d) =>
      !d.revoked_at &&
      d.kind === (context.profile.route === "apple-tv" ? "tv" : "mac")
  );
  const requireCloud = () => {
    if (!client || !workspace)
      throw new Error("接続タブでSupabaseにログインしてください");
    return { client, workspace };
  };
  const saveResult = async (r: AnalysisResult) => {
    await putLocal("results", r.id, r);
    setSelected(r.id);
    setTab("解析");
    await refreshLocal();
    if (client && workspace) await syncResult(client, workspace, r);
  };
  const importResponse = async (file: File) => {
    if (file.size > 20 * 1024 * 1024)
      throw new Error("応答ファイルは20 MiB以下にしてください");
    const bytes = await file.arrayBuffer(),
      text = new TextDecoder().decode(bytes),
      digest = await sha256(bytes);
    const r: AnalysisResult = {
      schemaVersion: 1,
      id: crypto.randomUUID(),
      sessionId: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      version: "web-import/1.0.0",
      source: "frequency-import",
      title: file.name,
      context: structuredClone(context),
      response: parseResponse(text),
      quality: {
        level: "relative",
        reasons: [
          "外部周波数応答。原音・時刻基準・入力処理を検証していません。",
          `SHA-256 ${digest}`,
        ],
        snrDB: null,
        clippedSamples: 0,
        driftPPM: null,
      },
      delaySeconds: null,
      rawArtifactId: null,
    };
    await saveResult(r);
  };
  const start = () =>
    task(async () => {
      const cloud = requireCloud();
      const controller = new AbortController();
      abort.current = controller;
      setRecording(true);
      try {
        await runMeasurement({
          ...cloud,
          target,
          context,
          url,
          key: publicKey,
          inputId,
          assetId,
          validationOnly,
          signal: controller.signal,
          onState: setStatus,
          onLevel: setLevel,
          onCapture: () => {
            void refreshLocal();
          },
        });
      } finally {
        setRecording(false);
        abort.current = null;
        await refresh();
      }
    });
  const stop = () => {
    abort.current?.abort();
    if (manual.current)
      task(async () => {
        const saved = await manual.current?.stop();
        manual.current = null;
        setRecording(false);
        if (saved)
          setStatus(
            saved.status === "complete"
              ? "原音を端末に保存しました"
              : (saved.reason ?? "録音中断")
          );
        await refreshLocal();
      });
  };
  const startManual = () =>
    task(async () => {
      const recorder = new Recorder(setLevel, (reason) => {
        setError(reason);
        setStatus(`収録を中断しました: ${reason}`);
        setRecording(false);
        setTimeout(() => {
          void refreshLocal();
        }, 2300);
      });
      manual.current = recorder;
      await recorder.start(context, inputId);
      setRecording(true);
      setStatus("原音を収録中 · 完了したら停止してください");
    });
  return (
    <div className="acoustic-app">
      <aside className="sidebar">
        <a
          className="brand"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            setTab("測定");
          }}
        >
          <span className="brand-mark">◉</span>
          <span>
            IMMERSIVE<small>ACOUSTIC LAB</small>
          </span>
        </a>
        <nav aria-label="メインナビゲーション">
          {tabs.map((name, i) => (
            <button
              type="button"
              key={name}
              className={tab === name ? "active" : ""}
              aria-current={tab === name ? "page" : undefined}
              disabled={recording && name !== "測定"}
              onClick={() => setTab(name)}
            >
              <span className="nav-icon">
                {["◎", "∿", "≋", "⌑", "⏻", "⌁"][i]}
              </span>
              {name}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className={`connection-dot ${workspace ? "online" : ""}`} />
          {workspace ? "Cloud connected" : "Local storage"}
          <p>
            7.1.6 room study
            <br />
            Music & Cinema
          </p>
          <button
            type="button"
            disabled={recording}
            onClick={() => setTab("演出")}
          >
            ビジュアライザー ↗
          </button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span>
            WORKSPACE <strong>{context.room.name}</strong>
          </span>
          <span className="muted">
            {results.length} measurements <span className="separator">/</span>{" "}
            {context.profile.purpose.toUpperCase()}
          </span>
        </header>
        <main>
          {error && (
            <div className="alert" role="alert">
              <span>{error}</span>
              <button
                type="button"
                aria-label="エラーを閉じる"
                onClick={() => setError("")}
              >
                ×
              </button>
            </div>
          )}
          {tab === "測定" && (
            <>
              <div className="section-heading">
                <div>
                  <p className="eyebrow">LISTEN. MEASURE. REFINE.</p>
                  <h1>部屋の音を、読み解く。</h1>
                  <p className="muted">
                    信号経路と測定条件を揃え、変化を確かめる。
                  </p>
                </div>
                <span className="badge">{context.profile.name}</span>
              </div>
              <div className="measurement-grid">
                <section className="panel speaker-panel">
                  <div className="panel-heading">
                    <h2>測定するスピーカー</h2>
                    <span className="muted">{context.speakerId}</span>
                  </div>
                  <div className="speaker-map">
                    <div className="screen-line">FRONT</div>
                    {context.room.speakers.map((s) => (
                      <button
                        type="button"
                        key={s.id}
                        disabled={recording}
                        className={`speaker ${s.id === context.speakerId ? "selected" : ""} ${s.inputChannel === null ? "height" : ""}`}
                        style={{
                          left: `${speakerMap[s.id]?.[0] ?? 50}%`,
                          top: `${speakerMap[s.id]?.[1] ?? 50}%`,
                        }}
                        onClick={() =>
                          setContext({ ...context, speakerId: s.id })
                        }
                        aria-pressed={s.id === context.speakerId}
                      >
                        {s.id}
                        <small>
                          {s.id.startsWith("T")
                            ? "HEIGHT"
                            : s.id === "LFE"
                              ? "SUB"
                              : "BED"}
                        </small>
                      </button>
                    ))}
                    <span
                      role="img"
                      className="listener-symbol"
                      aria-label="リスナー"
                    >
                      ◉
                    </span>
                  </div>
                  <p className="muted">
                    ● 床面レイヤー <span className="amber">● 高さレイヤー</span>{" "}
                    · 選択用の模式図。実座標は「部屋・機材」で確認
                  </p>
                </section>
                <section className="panel capture-panel">
                  <p className="eyebrow">MEASUREMENT SESSION</p>
                  <h2>
                    {context.speakerId}{" "}
                    <span className="muted">
                      / {context.profile.repeats} passes
                    </span>
                  </h2>
                  <dl className="stats">
                    <div>
                      <dt>ESS</dt>
                      <dd>
                        {context.profile.sweepSeconds}
                        <small> s</small>
                      </dd>
                    </div>
                    <div>
                      <dt>要求レート</dt>
                      <dd>
                        {context.profile.sampleRate / 1000}
                        <small> kHz</small>
                      </dd>
                    </div>
                    <div>
                      <dt>信号レベル</dt>
                      <dd>
                        {context.profile.amplitudeDBFS}
                        <small> dBFS</small>
                      </dd>
                    </div>
                  </dl>
                  <label>
                    再生端末
                    <select
                      disabled={recording}
                      value={target}
                      onChange={(e) => setTarget(e.target.value)}
                    >
                      <option value="">接続済み端末を選択</option>
                      {usableDevices.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    録音入力
                    <select
                      disabled={recording}
                      value={inputId}
                      onChange={(e) => setInputId(e.target.value)}
                    >
                      <option value="">この端末の既定マイク</option>
                      {inputs.map((d) => (
                        <option value={d.deviceId} key={d.deviceId}>
                          {d.label || "マイク"}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="text-button"
                    disabled={busy || recording}
                    onClick={() =>
                      task(async () => {
                        const stream =
                          await navigator.mediaDevices.getUserMedia({
                            audio: true,
                          });
                        stream.getTracks().forEach((t) => {
                          t.stop();
                        });
                        setInputs(
                          (
                            await navigator.mediaDevices.enumerateDevices()
                          ).filter((d) => d.kind === "audioinput")
                        );
                      })
                    }
                  >
                    マイク一覧を更新
                  </button>
                  {context.profile.route === "apple-tv" && (
                    <>
                      <label>
                        検証済みアセットID
                        <input
                          value={assetId}
                          onChange={(e) => setAssetId(e.target.value)}
                        />
                      </label>
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          disabled={recording}
                          checked={validationOnly}
                          onChange={(e) => setValidationOnly(e.target.checked)}
                        />
                        素材のチャンネル検証モード（調整提案は無効）
                      </label>
                    </>
                  )}
                  <meter
                    className="level-meter"
                    aria-label="入力ピーク dBFS"
                    min={-80}
                    max={0}
                    value={Math.max(-80, Math.min(0, level))}
                  >
                    <i
                      style={{
                        width: `${Math.max(0, Math.min(100, ((level + 80) / 80) * 100))}%`,
                      }}
                    />
                  </meter>
                  <p className="meter-label">
                    INPUT PEAK{" "}
                    <span>{level <= -150 ? "—" : level.toFixed(1)} dBFS</span>
                  </p>
                  <button
                    type="button"
                    className={recording ? "danger primary" : "primary"}
                    disabled={!recording && (busy || !loaded)}
                    onClick={recording ? stop : start}
                  >
                    {recording ? "■ 測定を停止" : "◎ 測定を開始"}
                  </button>
                  <output className="status" aria-live="polite">
                    {status}
                  </output>
                  <details>
                    <summary>手動で原音だけを収録</summary>
                    <p className="muted">
                      外部で同じESSと時間基準信号を再生する場合に使います。任意の音楽や環境音から室内IRは算出しません。
                    </p>
                    <button
                      type="button"
                      disabled={recording || busy}
                      onClick={startManual}
                    >
                      原音の収録を開始
                    </button>
                  </details>
                </section>
              </div>
              <div className="three-col">
                <article className="panel compact">
                  <p className="eyebrow">01 / CAPTURE</p>
                  <h3>原音を残す</h3>
                  <p>
                    無圧縮PCMをまず端末に保存。通信が戻ればアップロードを再開できます。
                  </p>
                </article>
                <article className="panel compact">
                  <p className="eyebrow">02 / UNDERSTAND</p>
                  <h3>信頼できる範囲を示す</h3>
                  <p>
                    クリップ、SNR、時刻基準、校正の有無を結果と一緒に保存します。
                  </p>
                </article>
                <article className="panel compact">
                  <p className="eyebrow">03 / REFINE</p>
                  <h3>一つ変えて、再測定</h3>
                  <p>
                    配置・吸音・設定の変更と主観評価を、前後の応答に結び付けます。
                  </p>
                </article>
              </div>
              <section className="panel">
                <h2>既存の測定を取り込む</h2>
                <div className="actions">
                  <label className="file-button">
                    周波数応答 TXT / FRD / CSV
                    <input
                      type="file"
                      accept=".txt,.csv,.frd"
                      disabled={busy || recording}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) task(() => importResponse(f));
                        e.target.value = "";
                      }}
                    />
                  </label>
                  <label className="file-button">
                    インパルス応答 WAV
                    <input
                      type="file"
                      accept=".wav"
                      disabled={busy || recording}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f)
                          task(async () => {
                            const cloud = requireCloud();
                            await uploadFile(
                              cloud.client,
                              cloud.workspace,
                              context,
                              f,
                              "impulse",
                              url,
                              publicKey,
                              (p) => setStatus(`IRを保存中 ${p.toFixed(0)}%`)
                            );
                            setStatus("IRを保存しました · Macで解析待ち");
                          });
                        e.target.value = "";
                      }}
                    />
                  </label>
                </div>
                <p className="muted">
                  REWのテキスト応答・モノラルIR
                  WAVに対応。校正済みの外部応答には校正を二重適用しません。
                </p>
              </section>
            </>
          )}
          {tab === "解析" && (
            <>
              <div className="section-heading">
                <div>
                  <p className="eyebrow">MEASUREMENT INSIGHT</p>
                  <h1>音響を解析</h1>
                </div>
                <select
                  aria-label="解析する測定"
                  value={selected}
                  onChange={(e) => setSelected(e.target.value)}
                >
                  <option value="">測定を選択</option>
                  {results.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.title}
                    </option>
                  ))}
                </select>
              </div>
              {result ? (
                <>
                  <div className="analysis-summary">
                    <span className={`badge ${result.quality.level}`}>
                      {qualityName[result.quality.level]}
                    </span>
                    <span>{new Date(result.createdAt).toLocaleString()}</span>
                    <span>
                      {result.context.speakerId} · {result.version}
                    </span>
                  </div>
                  <section className="panel">
                    <div className="panel-heading">
                      <h2>周波数応答</h2>
                      <label>
                        平滑化
                        <select
                          value={fraction}
                          onChange={(e) => setFraction(Number(e.target.value))}
                        >
                          <option value="0">なし</option>
                          {[48, 24, 12, 6, 3].map((n) => (
                            <option value={n} key={n}>
                              1/{n} octave
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <ResponseChart
                      curves={[
                        {
                          name: result.title,
                          points: smooth(result.response, fraction),
                        },
                        ...(result.context.profile.target.length
                          ? [
                              {
                                name: "Target",
                                points: result.context.profile.target,
                              },
                            ]
                          : []),
                      ]}
                    />
                    <p className="muted">
                      相対レベル / 伝達ゲイン。絶対SPLとしては使用できません。
                    </p>
                  </section>
                  <div className="two-col">
                    <section className="panel">
                      <h2>測定の信頼性</h2>
                      <dl className="quality-grid">
                        <dt>SNR</dt>
                        <dd>{result.quality.snrDB?.toFixed(1) ?? "—"} dB</dd>
                        <dt>Clock drift</dt>
                        <dd>
                          {result.quality.driftPPM?.toFixed(2) ?? "—"} ppm
                        </dd>
                        <dt>Clipped samples</dt>
                        <dd>{result.quality.clippedSamples}</dd>
                        <dt>基準との到達差</dt>
                        <dd>
                          {result.delaySeconds == null
                            ? "未検証"
                            : `${(result.delaySeconds * 1000).toFixed(3)} ms`}
                        </dd>
                      </dl>
                      <ul>
                        {result.quality.reasons.map((reason) => (
                          <li key={reason}>{reason}</li>
                        ))}
                      </ul>
                    </section>
                    <section className="panel">
                      <h2>改善の候補</h2>
                      {eqSuggestions(result).length ? (
                        <>
                          <p>
                            低域のカット候補です。反映後は同じ条件で再測定してください。
                          </p>
                          <table>
                            <thead>
                              <tr>
                                <th>Hz</th>
                                <th>Gain</th>
                                <th>Q</th>
                              </tr>
                            </thead>
                            <tbody>
                              {eqSuggestions(result).map((p) => (
                                <tr key={p.hz}>
                                  <td>{p.hz.toFixed(1)}</td>
                                  <td>{p.gainDB.toFixed(1)} dB</td>
                                  <td>{p.q.toFixed(2)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </>
                      ) : (
                        <p>
                          PEQ候補には、品質確認済みの測定・周波数校正・同じレベル基準の目標カーブが必要です。まず配置を一つ変え、低域ピークと減衰の変化を比較してください。
                        </p>
                      )}
                      <p className="note">
                        深いディップはブーストしません。測定位置を前後左右に移し、干渉と定在波の仮説を確認します。
                      </p>
                    </section>
                  </div>
                  <RepeatabilityPanel current={result} results={results} />
                  {result.impulse && (
                    <section className="panel">
                      <h2>時間応答</h2>
                      <ImpulseChart points={result.impulse} />
                      <ImpulseChart points={result.impulse} etc />
                    </section>
                  )}
                  {result.waterfall && (
                    <section className="panel">
                      <h2>低域の減衰</h2>
                      <Waterfall slices={result.waterfall} />
                    </section>
                  )}
                  {result.decay && (
                    <section className="panel">
                      <h2>帯域減衰 [s]</h2>
                      <div className="table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>Hz</th>
                              <th>EDT</th>
                              <th>T20</th>
                              <th>T30</th>
                              <th>R²</th>
                              <th>判定</th>
                            </tr>
                          </thead>
                          <tbody>
                            {result.decay.map((d) => (
                              <tr key={d.hz}>
                                <td>{d.hz}</td>
                                <td>{d.edt?.toFixed(3) ?? "—"}</td>
                                <td>{d.t20?.toFixed(3) ?? "—"}</td>
                                <td>{d.t30?.toFixed(3) ?? "—"}</td>
                                <td>{d.rSquared?.toFixed(3) ?? "—"}</td>
                                <td>{d.reason ?? "有効範囲内"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  )}
                  <details className="panel">
                    <summary>位相と再現情報</summary>
                    <ResponseChart
                      curves={[{ name: "Phase", points: result.response }]}
                      phase
                    />
                    <p>
                      位相・遅延は時間基準と時計補正を検証した場合だけ比較できます。
                    </p>
                    <pre>{JSON.stringify(result.context, null, 2)}</pre>
                  </details>
                  <div className="actions">
                    <button
                      type="button"
                      onClick={() =>
                        download(
                          `${result.id}.csv`,
                          resultCSV(result),
                          "text/csv"
                        )
                      }
                    >
                      応答 CSV
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        download(
                          `${result.id}.json`,
                          JSON.stringify(result, null, 2),
                          "application/json"
                        )
                      }
                    >
                      全解析 JSON
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        download(
                          `${result.id}.html`,
                          reportHTML(result),
                          "text/html"
                        )
                      }
                    >
                      レポート HTML / 印刷PDF
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setContext(structuredClone(result.context));
                        setTab("測定");
                      }}
                    >
                      この条件で再測定
                    </button>
                    <button
                      type="button"
                      disabled={!workspace || busy}
                      onClick={() =>
                        task(async () => {
                          const cloud = requireCloud();
                          await syncResult(
                            cloud.client,
                            cloud.workspace,
                            result
                          );
                          setStatus("結果をクラウドに保存しました");
                        })
                      }
                    >
                      クラウドに保存
                    </button>
                  </div>
                </>
              ) : (
                <div className="panel empty">
                  <h2>まだ測定結果がありません</h2>
                  <p>
                    スイープを収録するか、外部の測定応答を取り込んでください。
                  </p>
                  <button type="button" onClick={() => setTab("測定")}>
                    測定へ
                  </button>
                </div>
              )}
            </>
          )}
          {tab === "比較・履歴" && (
            <>
              <div className="section-heading">
                <div>
                  <p className="eyebrow">EXPERIMENT LOG</p>
                  <h1>変化を確かめる</h1>
                </div>
                <span className="badge">{results.length} measurements</span>
              </div>
              <section className="panel">
                <div className="fields">
                  <label>
                    変更前
                    <select
                      value={selected}
                      onChange={(e) => setSelected(e.target.value)}
                    >
                      <option value="">選択</option>
                      {results.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    変更後
                    <select
                      value={compareId}
                      onChange={(e) => setCompareId(e.target.value)}
                    >
                      <option value="">選択</option>
                      {results
                        .filter((r) => r.id !== selected)
                        .map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.title}
                          </option>
                        ))}
                    </select>
                  </label>
                </div>
                {result && comparison ? (
                  <>
                    <ResponseChart
                      curves={[
                        {
                          name: `Before · ${result.title}`,
                          points: smooth(result.response, fraction),
                        },
                        {
                          name: `After · ${comparison.title}`,
                          points: smooth(comparison.response, fraction),
                        },
                      ]}
                    />
                    {(() => {
                      const d = responseDistance(
                        result.response,
                        comparison.response
                      );
                      return d ? (
                        <p>
                          差のRMS <strong>{d.rms.toFixed(2)} dB</strong> ·
                          レベル差を除いた形状の差{" "}
                          <strong>{d.shapeRMS.toFixed(2)} dB</strong> ·
                          平均レベル差 {d.offset.toFixed(2)} dB
                        </p>
                      ) : (
                        <p>共通する周波数範囲が不足しています。</p>
                      );
                    })()}
                    {comparisonWarnings(result, comparison).length > 0 && (
                      <div className="note">
                        条件差があるため、変更の因果関係は断定できません。
                        <ul>
                          {comparisonWarnings(result, comparison).map((w) => (
                            <li key={w}>{w}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <div className="fields">
                      <label>
                        仮説
                        <input
                          value={hypothesis}
                          onChange={(e) => setHypothesis(e.target.value)}
                          placeholder="例: 後壁から離すと80 Hzのピークが減る"
                        />
                      </label>
                      <label>
                        変更した内容
                        <input
                          value={change}
                          onChange={(e) => setChange(e.target.value)}
                          placeholder="一つの変更を具体的に"
                        />
                      </label>
                    </div>
                    <label>
                      聴感メモ
                      <textarea
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="試聴曲・音量・聞こえ方"
                      />
                    </label>
                    <button
                      type="button"
                      disabled={busy || !change}
                      onClick={() =>
                        task(async () => {
                          const e: Experiment = {
                            id: crypto.randomUUID(),
                            name: `${result.context.speakerId} / ${change}`,
                            beforeId: result.id,
                            afterId: comparison.id,
                            hypothesis,
                            change,
                            listeningNotes: notes,
                            createdAt: new Date().toISOString(),
                          };
                          await putLocal("experiments", e.id, e);
                          if (client && workspace) {
                            const { error } = await client
                              .from("experiments")
                              .insert({
                                id: e.id,
                                workspace_id: workspace,
                                data: e,
                              });
                            if (error) throw error;
                          }
                          await refreshLocal();
                        })
                      }
                    >
                      比較と変更内容を保存
                    </button>
                  </>
                ) : (
                  <p className="empty">
                    2つの測定を選ぶと、周波数応答と測定条件を比較できます。
                  </p>
                )}
              </section>
              {result && (
                <section className="panel">
                  <h2>似た応答パターン</h2>
                  <p className="muted">
                    1/12オクターブの共通帯域で平均レベル差を除いて比較。原因の自動断定には使いません。
                  </p>
                  {results
                    .filter(
                      (r) => r.id !== result.id && r.quality.level !== "invalid"
                    )
                    .map((r) => ({
                      r,
                      d: responseDistance(result.response, r.response),
                    }))
                    .filter((x) => x.d)
                    .sort((a, b) => a.d!.shapeRMS - b.d!.shapeRMS)
                    .slice(0, 5)
                    .map(({ r, d }) => (
                      <button
                        type="button"
                        className="pattern-row"
                        key={r.id}
                        onClick={() => setCompareId(r.id)}
                      >
                        <span>
                          {r.title} · {r.context.speakerId}
                        </span>
                        <strong>{d!.shapeRMS.toFixed(2)} dB</strong>
                      </button>
                    ))}
                </section>
              )}
              <section className="panel">
                <h2>測定履歴</h2>
                <label>
                  履歴を検索
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="ファイル名・スピーカー・用途"
                  />
                </label>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>測定</th>
                        <th>日時</th>
                        <th>経路</th>
                        <th>品質</th>
                      </tr>
                    </thead>
                    <tbody>
                      {results
                        .filter((r) =>
                          `${r.title} ${r.context.speakerId} ${r.context.profile.purpose}`
                            .toLowerCase()
                            .includes(search.toLowerCase())
                        )
                        .map((r) => (
                          <tr key={r.id}>
                            <td>
                              <button
                                type="button"
                                className="text-button"
                                onClick={() => {
                                  setSelected(r.id);
                                  setTab("解析");
                                }}
                              >
                                {r.title}
                              </button>
                            </td>
                            <td>{new Date(r.createdAt).toLocaleString()}</td>
                            <td>
                              {r.context.speakerId} / {r.context.profile.route}
                            </td>
                            <td>{qualityName[r.quality.level]}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
                {results.length === 0 && (
                  <p className="empty">測定はまだありません。</p>
                )}
              </section>
              <section className="panel">
                <h2>原音と保存状況</h2>
                {captures.length === 0 && (
                  <p className="muted">
                    このブラウザーに原音は保存されていません。
                  </p>
                )}
                {captures.map((c) => (
                  <div className="capture-row" key={c.id}>
                    <div>
                      <strong>
                        {c.context.speakerId} ·{" "}
                        {(c.frames / c.sampleRate).toFixed(1)} s
                      </strong>
                      <p className="muted">
                        {new Date(c.createdAt).toLocaleString()} ·{" "}
                        {c.sampleRate} Hz · {c.status}
                        {c.reason ? ` · ${c.reason}` : ""}
                      </p>
                    </div>
                    <div className="actions">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          task(async () =>
                            download(`${c.id}.wav`, await captureWav(c))
                          )
                        }
                      >
                        WAV
                      </button>
                      <button
                        type="button"
                        disabled={
                          busy ||
                          !workspace ||
                          c.status === "uploaded" ||
                          c.status === "recording"
                        }
                        onClick={() =>
                          task(async () => {
                            const cloud = requireCloud();
                            await syncCapture(
                              cloud.client,
                              cloud.workspace,
                              c,
                              url,
                              publicKey,
                              (p) => setStatus(`保存中 ${p.toFixed(0)}%`)
                            );
                            await refreshLocal();
                          })
                        }
                      >
                        保存 / 再開
                      </button>
                    </div>
                  </div>
                ))}
              </section>
              <section className="panel">
                <h2>改善ログ</h2>
                {experiments.map((e) => (
                  <details key={e.id}>
                    <summary>{e.name}</summary>
                    <p>仮説: {e.hypothesis}</p>
                    <p>変更: {e.change}</p>
                    <p>聴感: {e.listeningNotes}</p>
                    <button
                      type="button"
                      onClick={() => {
                        setSelected(e.beforeId);
                        setCompareId(e.afterId);
                      }}
                    >
                      比較を開く
                    </button>
                  </details>
                ))}
                {!experiments.length && (
                  <p className="muted">
                    変更前後の測定を選び、実験を記録してください。
                  </p>
                )}
              </section>
              <section className="panel">
                <h2>バックアップ</h2>
                <p className="muted">
                  このブラウザーの結果・原音・改善ログをSHA-256付きZIPに保存します。クラウド全体のバックアップはMacのbackupコマンドを使ってください。
                </p>
                <div className="actions">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => task(exportBackup)}
                  >
                    端末データをZIPに保存
                  </button>
                  <label className="file-button">
                    ZIPから復元
                    <input
                      type="file"
                      accept=".zip"
                      disabled={busy}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f)
                          task(async () => {
                            await restoreBackup(f);
                            await refreshLocal();
                          });
                      }}
                    />
                  </label>
                </div>
              </section>
            </>
          )}
          {tab === "部屋・機材" && (
            <RoomPanel context={context} change={setContext} task={task} />
          )}
          {tab === "AVR" && (
            <Suspense fallback={<p>AVRを読み込み中…</p>}>
              <AvrPanel
                client={client}
                workspace={workspace}
                context={context}
                onChange={setContext}
              />
            </Suspense>
          )}
          {tab === "接続" && (
            <>
              <ConnectionPanel
                client={client}
                workspace={workspace}
                devices={devices}
                url={url}
                publicKey={publicKey}
                refresh={refresh}
                task={task}
                configure={(u, k) =>
                  task(async () => {
                    makeCloud(u, k);
                    await putLocal("settings", "cloud", { url: u, key: k });
                    setURL(u);
                    setPublicKey(k);
                  })
                }
              />
              <StimulusPanel
                client={client}
                workspace={workspace}
                context={context}
                url={url}
                publicKey={publicKey}
                task={task}
              />
            </>
          )}
          {tab === "演出" && (
            <>
              <div className="section-heading">
                <div>
                  <p className="eyebrow">VISUAL EXPERIENCE</p>
                  <h1>ビジュアライザー</h1>
                  <p className="muted">
                    音の演出表示です。音響測定や伝搬シミュレーションの結果ではありません。
                  </p>
                </div>
                <button type="button" onClick={() => setTab("測定")}>
                  測定に戻る
                </button>
              </div>
              <div className="visualizer-wrap">
                <Suspense fallback={<p>読み込み中…</p>}>
                  <Visualizer />
                </Suspense>
              </div>
            </>
          )}
        </main>
        <footer>
          IMMERSIVE ACOUSTIC LAB <span>Evidence before adjustment.</span>
        </footer>
      </div>
    </div>
  );
}
