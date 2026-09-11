import type { SupabaseClient } from "@supabase/supabase-js";
import { useState } from "react";
import { uploadFile } from "./cloud";
import { download } from "./export";
import type { MeasurementContext } from "./types";
export function StimulusPanel({
  client,
  workspace,
  context,
  url,
  publicKey,
  task,
}: {
  client: SupabaseClient | null;
  workspace: string;
  context: MeasurementContext;
  url: string;
  publicKey: string;
  task: (fn: () => Promise<void>) => void;
}) {
  const [asset, setAsset] = useState(""),
    [method, setMethod] = useState(""),
    [route, setRoute] = useState(""),
    [markers, setMarkers] = useState(false),
    [status, setStatus] = useState("");
  return (
    <section className="panel">
      <h2>Apple TVの検証素材</h2>
      <p className="muted">
        選択中の {context.speakerId}{" "}
        に対応するテスト素材を登録します。作成時のスイープ設定・基準スピーカーを一致させてください。有料コーデックや外部素材は同梱しません。
      </p>
      <div className="actions">
        <button
          type="button"
          onClick={() =>
            download(
              "stimulus-context.json",
              JSON.stringify(context, null, 2),
              "application/json"
            )
          }
        >
          素材作成用の条件 JSON
        </button>
        <label className="file-button">
          MP4 / M4A / MOV / EC3 を登録
          <input
            type="file"
            accept=".mp4,.m4a,.mov,.ec3"
            disabled={!client || !workspace}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f && client)
                task(async () => {
                  const id = await uploadFile(
                    client,
                    workspace,
                    context,
                    f,
                    "stimulus",
                    url,
                    publicKey,
                    (p) => setStatus(`保存中 ${p.toFixed(0)}%`)
                  );
                  setAsset(id);
                  setStatus(
                    "素材を登録しました。測定画面の検証モードで割り当てを確認してください。"
                  );
                });
            }}
          />
        </label>
      </div>
      <label>
        アセットID
        <input value={asset} onChange={(e) => setAsset(e.target.value)} />
      </label>
      <label>
        検証した経路・設定
        <input
          value={route}
          onChange={(e) => setRoute(e.target.value)}
          placeholder="Apple TV → AVC-A110 / HDMI入力 / Sound Mode / Continuous Audio"
        />
      </label>
      <label>
        確認方法と結果（20文字以上）
        <textarea
          value={method}
          onChange={(e) => setMethod(e.target.value)}
          placeholder="対象スピーカーだけから再生されること、他chへの漏れ、AVR設定、マーカー再現性を記録"
        />
      </label>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={markers}
          onChange={(e) => setMarkers(e.target.checked)}
        />
        前後の時間基準マーカーと対象chの分離を実際に確認した
      </label>
      <button
        type="button"
        disabled={
          !client ||
          !workspace ||
          !asset ||
          method.length < 20 ||
          route.length < 5 ||
          !markers
        }
        onClick={() =>
          task(async () => {
            if (!client) return;
            const { error } = await client.rpc("validate_stimulus", {
              aid: asset,
              evidence: {
                speakers: [context.speakerId],
                method,
                route,
                markersVerified: markers,
              },
            });
            if (error) throw error;
            setStatus(
              `${context.speakerId} の検証記録を保存しました。経路・設定が変わったら再検証してください。`
            );
          })
        }
      >
        この経路での検証記録を保存
      </button>
      <output aria-live="polite">{status}</output>
    </section>
  );
}
