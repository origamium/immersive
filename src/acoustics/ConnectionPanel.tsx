import type { SupabaseClient } from "@supabase/supabase-js";
import { useState } from "react";
import type { CloudDevice } from "./types";
export function ConnectionPanel({
  client,
  workspace,
  devices,
  url,
  publicKey,
  configure,
  refresh,
  task,
}: {
  client: SupabaseClient | null;
  workspace: string;
  devices: CloudDevice[];
  url: string;
  publicKey: string;
  configure: (url: string, key: string) => void;
  refresh: () => Promise<void>;
  task: (fn: () => Promise<void>) => void;
}) {
  const [endpoint, setEndpoint] = useState(url),
    [key, setKey] = useState(publicKey),
    [email, setEmail] = useState(""),
    [otp, setOTP] = useState(""),
    [code, setCode] = useState(""),
    [notice, setNotice] = useState("");
  return (
    <>
      <div className="section-heading">
        <div>
          <p className="eyebrow">CONNECTED DEVICES</p>
          <h1>端末をつなぐ</h1>
        </div>
        <span className="badge">
          {workspace ? "ログイン済み" : "端末内モード"}
        </span>
      </div>
      <div className="two-col">
        <section className="panel">
          <h2>Supabase</h2>
          <p className="muted">
            履歴・原音の保存先です。Macを終了しても保存済みの結果を閲覧できます。
          </p>
          <label>
            Project URL
            <input
              type="url"
              placeholder="https://your-project.supabase.co"
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
            />
          </label>
          <label>
            Publishable key
            <input
              type="password"
              autoComplete="off"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="sb_publishable_…"
            />
          </label>
          <button type="button" onClick={() => configure(endpoint, key)}>
            接続設定を保存
          </button>
          {client && (
            <>
              <hr />
              <label>
                オーナーのメールアドレス
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              <button
                type="button"
                disabled={!email}
                onClick={() =>
                  task(async () => {
                    const { error } = await client.auth.signInWithOtp({
                      email,
                      options: { emailRedirectTo: window.location.origin },
                    });
                    if (error) throw error;
                    setNotice(
                      "メールを送信しました。リンクを開くか、確認コードを入力してください。"
                    );
                  })
                }
              >
                ログインメールを送信
              </button>
              <label>
                確認コード
                <input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={otp}
                  onChange={(e) => setOTP(e.target.value)}
                />
              </label>
              <button
                type="button"
                disabled={!otp || !email}
                onClick={() =>
                  task(async () => {
                    const { error } = await client.auth.verifyOtp({
                      email,
                      token: otp,
                      type: "email",
                    });
                    if (error) throw error;
                    await refresh();
                    setNotice("ログインしました");
                  })
                }
              >
                コードでログイン
              </button>
              {workspace && (
                <button
                  type="button"
                  onClick={() =>
                    task(async () => {
                      await client.auth.signOut();
                      await refresh();
                    })
                  }
                >
                  ログアウト
                </button>
              )}
            </>
          )}
          <output aria-live="polite">{notice}</output>
        </section>
        <section className="panel">
          <h2>Mac / Apple TV を登録</h2>
          <ol>
            <li>ネイティブアプリに同じSupabase URLと公開キーを入力します。</li>
            <li>端末に表示された12桁のコードを下に入力します。</li>
            <li>Macで実際の出力デバイスを選び、受信を開始します。</li>
          </ol>
          <label>
            ペアリングコード
            <input
              value={code}
              onChange={(e) =>
                setCode(
                  e.target.value
                    .toUpperCase()
                    .replace(/[^A-F0-9]/g, "")
                    .slice(0, 12)
                )
              }
              placeholder="A1B2C3D4E5F6"
              autoComplete="off"
            />
          </label>
          <button
            type="button"
            disabled={!workspace || code.length !== 12}
            onClick={() =>
              task(async () => {
                const { error } = await client!.rpc("approve_pairing", {
                  w: workspace,
                  code,
                });
                if (error) throw error;
                setCode("");
                await refresh();
              })
            }
          >
            この端末を登録
          </button>
          <p className="note">
            コードは10分で失効します。音声は端末で再生し、通信は準備・開始・停止と保存を担当します。
          </p>
          <h3>再生能力の確認方針</h3>
          <p>
            Mac HDMI: 8 PCM chまで。PMA USB: 2 ch。Apple TV:
            Atmos素材の再生能力と、14個のスピーカーを個別に指定できる能力は別です。高さは素材・経路の検証を経て有効にします。
          </p>
          <a
            href="https://support.apple.com/ja-jp/102310"
            target="_blank"
            rel="noreferrer"
          >
            Appleのロスレス再生条件 ↗
          </a>
        </section>
      </div>
      <section className="panel">
        <h2>登録済みの端末</h2>
        {devices.length === 0 ? (
          <p className="empty">まだ端末が登録されていません。</p>
        ) : (
          devices.map((d) => (
            <article className="device" key={d.id}>
              <div>
                <h3>
                  {d.name} <span className="muted">{d.kind}</span>
                </h3>
                <p>
                  {d.revoked_at
                    ? "登録解除済み"
                    : d.last_seen
                      ? `最終接続 ${new Date(d.last_seen).toLocaleString()}`
                      : "接続待ち"}
                </p>
                {d.capabilities && (
                  <>
                    <p>
                      実測API:{" "}
                      {d.capabilities.actualRate?.toLocaleString() ?? "不明"} Hz
                      · {d.capabilities.channels} ch ·{" "}
                      {d.capabilities.physicalBits ?? "不明"} bit
                    </p>
                    <p className="muted">{d.capabilities.notes.join(" / ")}</p>
                    <details>
                      <summary>能力レポート</summary>
                      <pre>{JSON.stringify(d.capabilities, null, 2)}</pre>
                    </details>
                  </>
                )}
              </div>
              <button
                type="button"
                disabled={!!d.revoked_at}
                onClick={() =>
                  task(async () => {
                    const { error } = await client!.rpc("revoke_device", {
                      d: d.id,
                    });
                    if (error) throw error;
                    await refresh();
                  })
                }
              >
                登録解除
              </button>
            </article>
          ))
        )}
      </section>
    </>
  );
}
