import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useState } from "react";
import { download } from "../acoustics/export";
import type { MeasurementContext } from "../acoustics/types";
import {
  avrFresh,
  CloudAvrClient,
  LocalAvrClient,
  type Receiver,
  type ReceiverObservation,
  type ReceiverSnapshot,
} from "./client";
import "./avr.css";
const describe = (error: unknown) =>
  error && typeof error === "object" && "message" in error
    ? String(error.message)
    : String(error);
const floor = new Set(["FL", "FR", "C", "SL", "SR", "SBL", "SBR"]);
export function AvrPanel({
  client,
  workspace,
  context,
  onChange,
}: {
  client: SupabaseClient | null;
  workspace: string;
  context: MeasurementContext;
  onChange: (context: MeasurementContext) => void;
}) {
  const [localToken, setLocalToken] = useState(""),
    [draftToken, setDraftToken] = useState("");
  const localAllowed = ["127.0.0.1", "localhost"].includes(location.hostname);
  const avr = useMemo(
    () =>
      localToken
        ? new LocalAvrClient("http://127.0.0.1:8765", localToken)
        : client && workspace
          ? new CloudAvrClient(client, workspace)
          : null,
    [client, workspace, localToken]
  );
  const [receivers, setReceivers] = useState<Receiver[]>([]),
    [selected, setSelected] = useState(context.avrBinding?.receiverId ?? "");
  const [observation, setObservation] = useState<ReceiverObservation | null>(
      null
    ),
    [zone, setZone] = useState(1),
    [volume, setVolume] = useState(40);
  const [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false),
    [diagnostic, setDiagnostic] = useState("get_audio_info"),
    [raw, setRaw] = useState("");
  const [resolve, setResolve] = useState(false),
    [reset, setReset] = useState(false);
  const [snapshots, setSnapshots] = useState<ReceiverSnapshot[]>([]);
  useEffect(() => setSnapshots([]), [selected, avr]);
  async function loadSnapshots() {
    if (!(avr instanceof CloudAvrClient)) return;
    try { setSnapshots(await avr.snapshots(selected)); }
    catch (error) { setStatus(describe(error)); }
  }
  async function downloadSnapshot(snapshot: ReceiverSnapshot) {
    if (!(avr instanceof CloudAvrClient)) return;
    try {
      download(`avr-snapshot-${snapshot.id}.json`, await avr.snapshotFile(selected, snapshot));
      setStatus("SHA-256を検証し、診断原本を出力しました");
    } catch (error) { setStatus(describe(error)); }
  }
  const refresh = useCallback(async () => {
    if (avr && selected) setObservation(await avr.observation(selected));
  }, [avr, selected]);
  useEffect(() => {
    let active = true;
    setReceivers([]);
    setObservation(null);
    if (avr)
      void avr
        .receivers()
        .then((rows) => {
          if (active) {
            setReceivers(rows);
            setSelected((current) =>
              rows.some((r) => r.id === current) ? current : (rows[0]?.id ?? "")
            );
          }
        })
        .catch((error) => active && setStatus(describe(error)));
    return () => {
      active = false;
    };
  }, [avr]);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    setObservation(null);
    const poll = async () => {
      try {
        if (avr && selected) {
          const value = await avr.observation(selected);
          if (active) setObservation(value);
        }
      } catch (error) {
        if (active) setStatus(describe(error));
      }
      if (active) timer = setTimeout(poll, 2000);
    };
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [avr, selected]);
  const fresh = avrFresh(observation),
    locked = !!observation?.measurement,
    state = observation?.state,
    z = state?.zones[`zone${zone}`];
  async function execute(kind: string, body: Record<string, unknown> = {}) {
    if (!avr || !observation) return;
    setBusy(true);
    setStatus("操作を確認中…");
    try {
      const result = await avr.execute(selected, observation.revision, kind, {
        zone,
        ...body,
      });
      setStatus(
        `${result.status}${result.changes ? ` · ${result.changes.map((c) => `${c.command}: ${c.status}`).join(" / ")}` : ""}`
      );
      if (result.observation) setRaw(result.observation.raw);
      if (kind === "snapshot") setRaw(JSON.stringify(result, null, 2));
      await refresh();
    } catch (error) {
      setStatus(describe(error));
    } finally {
      setBusy(false);
    }
  }
  function group(names: string[], delta: number) {
    const levels = Object.fromEntries(
      (state?.channels ?? [])
        .filter(
          (c) => c.active && names.includes(c.name) && c.value !== undefined
        )
        .flatMap((c) =>
          c.value === undefined ? [] : [[c.name, c.value + delta]]
        )
    );
    if (Object.values(levels).some((value) => value < 0 || value > 48)) {
      setStatus("グループ内のチャンネルが調整範囲を超えます");
      return;
    }
    void execute("channel-levels", { levels });
  }
  const localConnection = localAllowed && (
    <details>
      <summary>Mac上のローカル接続</summary>
      <p>
        Mac
        Companionでローカル接続トークンをコピーしてください。トークンはこの画面のメモリ内だけで使います。
      </p>
      {localToken ? (
        <button type="button" onClick={() => setLocalToken("")}>
          ローカル接続を解除
        </button>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setLocalToken(draftToken);
            setDraftToken("");
          }}
        >
          <label>
            ローカル接続トークン
            <input
              type="password"
              value={draftToken}
              onChange={(event) => setDraftToken(event.target.value)}
              autoComplete="off"
            />
          </label>
          <button type="submit" disabled={!draftToken}>
            ローカル接続を開始
          </button>
        </form>
      )}
    </details>
  );
  if (!avr)
    return (
      <section className="panel">
        <h2>AVR Control</h2>
        <p>
          接続タブでログインし、Mac Companionの「AVR /
          HomeKit」でクラウド操作を開始してください。
        </p>
        {localConnection}
      </section>
    );
  return (
    <div className="avr-layout">
      <section className="panel">
        <h2>AVR Control</h2>
        <p>Mac経由で操作し、読み戻した実機状態を測定条件に保存します。</p>
        {localConnection}
        <label>
          AVR
          <select
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
          >
            <option value="">選択してください</option>
            {receivers.map((receiver) => (
              <option key={receiver.id} value={receiver.id}>
                {receiver.name}
              </option>
            ))}
          </select>
        </label>
        {!receivers.length && (
          <p>
            Mac
            CompanionでAVRのIPを設定し、「クラウド操作を開始」を選択すると表示されます。
          </p>
        )}
        <output className="avr-connection">
          {fresh ? "Mac接続中" : "オフライン / 状態未取得"}{" "}
          {locked && " · 測定ロック中"} ·{" "}
          {observation
            ? new Date(observation.observed_at).toLocaleTimeString()
            : "—"}
        </output>
        {state?.simulated && (
          <p>シミュレーター · 実機・実測データではありません</p>
        )}
        <p aria-live="polite">{status}</p>
        {state && (
          <>
            <div className="avr-zone">
              {[1, 2, 3].map((number) => (
                <button
                  type="button"
                  key={number}
                  aria-pressed={zone === number}
                  onClick={() => setZone(number)}
                >
                  {state.zones[`zone${number}`]?.name || `Zone ${number}`}
                </button>
              ))}
            </div>
            <p>
              {z?.power ?? "電源不明"} ·{" "}
              {z?.muted === undefined
                ? "ミュート不明"
                : z.muted
                  ? "ミュートON"
                  : "ミュートOFF"}{" "}
              · 音量 {z?.volume ?? "不明"} /{" "}
              {z?.volume === undefined ? "不明" : (z.volume - 80).toFixed(1)} dB
            </p>
            <div className="avr-actions">
              <button
                type="button"
                disabled={!fresh || busy || locked}
                onClick={() => void execute("power", { enabled: true })}
              >
                電源ON
              </button>
              <button
                type="button"
                disabled={!fresh || busy}
                onClick={() => void execute("power", { enabled: false })}
              >
                電源OFF
              </button>
              <button
                type="button"
                disabled={!fresh || busy}
                onClick={() => void execute("mute", { enabled: true })}
              >
                ミュートON
              </button>
              <button
                type="button"
                disabled={!fresh || busy || locked}
                onClick={() => void execute("mute", { enabled: false })}
              >
                ミュートOFF
              </button>
            </div>
            <fieldset disabled={!fresh || busy || locked}>
              <legend>音量・入力</legend>
              <label>
                設定音量 {volume}
                <input
                  type="range"
                  min="0"
                  max={z?.limit || 98}
                  step="0.5"
                  value={volume}
                  onChange={(event) => setVolume(Number(event.target.value))}
                />
              </label>
              <div className="avr-actions">
                <button
                  type="button"
                  onClick={() => void execute("volume-down")}
                >
                  −0.5
                </button>
                <button
                  type="button"
                  onClick={() => void execute("volume", { value: volume })}
                >
                  音量を適用
                </button>
                <button type="button" onClick={() => void execute("volume-up")}>
                  ＋0.5
                </button>
              </div>
              <label>
                入力
                <select
                  value={z?.source ?? ""}
                  onChange={(event) =>
                    void execute("source", { name: event.target.value })
                  }
                >
                  <option value="">不明</option>
                  {state.sources
                    .filter((s) => s.enabled)
                    .map((source) => (
                      <option key={source.function} value={source.function}>
                        {source.displayName || source.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                サウンドモード
                <select
                  disabled={zone !== 1}
                  value={state.surround ?? ""}
                  onChange={(event) =>
                    void execute("surround", { name: event.target.value })
                  }
                >
                  <option value={state.surround ?? ""}>
                    {state.surround ?? "不明"}
                  </option>
                  {state.modes
                    .filter((m) => m.name !== state.surround)
                    .map((mode) => (
                      <option key={mode.name}>{mode.name}</option>
                    ))}
                </select>
              </label>
            </fieldset>
          </>
        )}
      </section>
      {state && (
        <>
          <section className="panel">
            <h2>チャンネルレベル</h2>
            <p>
              0 dBを基準に−12〜＋12 dB、0.5
              dB刻み。グループ操作もチャンネルごとの結果を記録します。
            </p>
            <fieldset disabled={!fresh || busy || locked}>
              <div className="avr-actions">
                {["床面", "高さ", "サブ"].map((label) => {
                  const channels = state.channels
                    .filter((c) =>
                      label === "床面"
                        ? floor.has(c.name)
                        : label === "サブ"
                          ? c.name.startsWith("SW")
                          : !floor.has(c.name) && !c.name.startsWith("SW")
                    )
                    .map((c) => c.name);
                  return (
                    <span key={label}>
                      {label}{" "}
                      <button type="button" onClick={() => group(channels, -1)}>
                        −0.5
                      </button>{" "}
                      <button type="button" onClick={() => group(channels, 1)}>
                        ＋0.5
                      </button>
                    </span>
                  );
                })}
              </div>
              {state.channels
                .filter((c) => c.active)
                .map((channel) => (
                  <div className="avr-channel" key={channel.name}>
                    <strong>{channel.name}</strong>
                    <output>
                      {channel.value === undefined
                        ? "不明"
                        : `${((channel.value - 24) / 2).toFixed(1)} dB`}
                    </output>
                    <button
                      type="button"
                      disabled={
                        channel.value === undefined || channel.value === 0
                      }
                      aria-label={`${channel.name} -0.5 dB`}
                      onClick={() => group([channel.name], -1)}
                    >
                      −
                    </button>
                    <button
                      type="button"
                      disabled={
                        channel.value === undefined || channel.value === 48
                      }
                      aria-label={`${channel.name} +0.5 dB`}
                      onClick={() => group([channel.name], 1)}
                    >
                      ＋
                    </button>
                  </div>
                ))}
              <label>
                <input
                  type="checkbox"
                  checked={reset}
                  onChange={(event) => setReset(event.target.checked)}
                />
                全チャンネルを0 dBへ戻す
              </label>
              <button
                type="button"
                disabled={!reset}
                onClick={() => {
                  setReset(false);
                  void execute("reset-channels");
                }}
              >
                リセットを実行
              </button>
              <h3>センター +3 dB（旧Nolanプリセット）</h3>
              <p>
                作品や部屋に最適と保証する補正ではありません。適用前の値を保存し、比較測定に使えます。
              </p>
              <button
                type="button"
                disabled={!!observation?.preset}
                onClick={() => void execute("center-boost")}
              >
                保存して適用
              </button>
              <label>
                旧avconの保存値（JSON）を取り込む
                <input
                  type="file"
                  accept="application/json,.json"
                  disabled={!!observation?.preset}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    void file
                      .text()
                      .then((text) => {
                        const data = JSON.parse(text);
                        if (
                          data.v !== 1 ||
                          !data.saved ||
                          Object.keys(data.saved).join() !== "C" ||
                          !Number.isInteger(data.saved.C) ||
                          data.saved.C < 0 ||
                          data.saved.C > 48
                        )
                          throw new Error("旧avcon.nolan v1の保存値が必要です");
                        return execute("import-preset", { saved: data.saved });
                      })
                      .catch((error) => setStatus(describe(error)));
                    event.target.value = "";
                  }}
                />
              </label>
              <p>
                取り込みは保存値の登録だけです。復元操作を選ぶまでAVRは変更しません。
              </p>
              {observation?.preset && (
                <>
                  <p>
                    保存値 {JSON.stringify(observation.preset.before)} / 適用値{" "}
                    {JSON.stringify(observation.preset.applied)} ·{" "}
                    {observation.preset.outcome}
                  </p>
                  <label>
                    <input
                      type="checkbox"
                      checked={resolve}
                      onChange={(event) => setResolve(event.target.checked)}
                    />
                    適用後の変更との差分を確認し、保存値で上書きする
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      void execute("restore-preset", {
                        resolveConflicts: resolve,
                      })
                    }
                  >
                    保存値へ復元
                  </button>
                </>
              )}
            </fieldset>
          </section>
          <section className="panel">
            <h2>測定条件との対応</h2>
            {localToken && (
              <p>
                ローカル接続は調整・診断用です。自動測定にはMacのクラウド接続を使用してください。
              </p>
            )}
            <label>
              <input
                type="checkbox"
                disabled={!!localToken}
                checked={context.avrBinding?.receiverId === selected}
                onChange={(event) =>
                  onChange({
                    ...context,
                    avrBinding: event.target.checked
                      ? { receiverId: selected, channelMap: {} }
                      : undefined,
                  })
                }
              />
              このAVRの条件を測定前後に取得する
            </label>
            <p>
              AVRのFHLと測定のTFL、SWとLFEは自動的に同一視しません。実配線に合わせて指定してください。
            </p>
            {context.avrBinding?.receiverId === selected &&
              context.room.speakers.map((speaker) => (
                <label key={speaker.id}>
                  {speaker.id}
                  <select
                    value={context.avrBinding?.channelMap[speaker.id] ?? ""}
                    onChange={(event) =>
                      onChange({
                        ...context,
                        avrBinding: {
                          receiverId: selected,
                          channelMap: {
                            ...context.avrBinding?.channelMap,
                            [speaker.id]: event.target.value,
                          },
                        },
                      })
                    }
                  >
                    <option value="">未確認</option>
                    {state.channels
                      .filter((c) => c.active)
                      .map((channel) => (
                        <option key={channel.name}>{channel.name}</option>
                      ))}
                  </select>
                </label>
              ))}
          </section>
          <section className="panel">
            <h2>入力・出力と診断</h2>
            <h3>入力信号</h3>
            <div className="avr-indicators">
              {state.inputSignal.map((s, i) => (
                <span key={`${s.name}-${i}`}>
                  {s.name} <small>control {s.control ?? "?"}</small>
                </span>
              ))}
            </div>
            <h3>有効スピーカー</h3>
            <div className="avr-indicators">
              {state.activeSpeakers.map((s, i) => (
                <span key={`${s.name}-${i}`}>
                  {s.name} <small>control {s.control ?? "?"}</small>
                </span>
              ))}
            </div>
            <p>
              表示はAVRの申告値です。各スピーカーの実出音は測定で確認してください。
            </p>
            {Object.entries(state.details)
              .filter(([, fields]) => Object.keys(fields).length)
              .map(([method, fields]) => (
                <details key={method}>
                  <summary>{method}</summary>
                  <dl>
                    {Object.entries(fields).map(([name, value]) => (
                      <div key={name}>
                        <dt>{name}</dt>
                        <dd>
                          {value.value || "空応答"} · control{" "}
                          {value.control ?? "不明"}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </details>
              ))}
            {state.unknownConditions?.map((item) => (
              <p key={item}>未確認: {item}</p>
            ))}
            {Object.entries(state.errors).map(([method, error]) => (
              <p key={method}>
                {method}: {error}
              </p>
            ))}
            <label>
              取得メソッド
              <input
                value={diagnostic}
                onChange={(event) => setDiagnostic(event.target.value)}
              />
            </label>
            <div className="avr-actions">
              <button
                type="button"
                disabled={!fresh || busy || locked}
                onClick={() => void execute("read", { method: diagnostic })}
              >
                診断取得
              </button>
              <button
                type="button"
                disabled={!fresh || busy || locked}
                onClick={() => void execute("snapshot")}
              >
                スナップショットを保存
              </button>
              <button
                type="button"
                onClick={() =>
                  download(
                    "avr-observation.json",
                    new Blob([JSON.stringify(observation, null, 2)], {
                      type: "application/json",
                    })
                  )
                }
              >
                状態JSONを出力
              </button>
              {avr instanceof CloudAvrClient && <button type="button" onClick={() => void loadSnapshots()}>保存済み診断を一覧</button>}
            </div>
            {snapshots.map(snapshot => <p key={snapshot.id}><button type="button" onClick={() => void downloadSnapshot(snapshot)}>{new Date(snapshot.created_at).toLocaleString()} の診断原本を出力</button></p>)}
            {raw && <pre className="avr-raw">{raw}</pre>}
          </section>
        </>
      )}
      <section className="panel">
        <h2>HomeKit</h2>
        <p>
          Mac
          Companionの「HomeKitを開始」でQRコードを表示し、iPhoneのホームアプリから登録してください。ペアリング情報はMacだけに保存されます。
        </p>
      </section>
    </div>
  );
}
