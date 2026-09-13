import type { SupabaseClient } from "@supabase/supabase-js";
import { CloudAvrClient } from "../avr/client";
import { acquireAvr } from "../avr/measurement";
import { Recorder } from "./capture";
import { createSession, issueCommand, syncCapture } from "./cloud";
import { putLocal } from "./local";
import type { LocalCapture, MeasurementContext } from "./types";

export const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("測定を停止しました"));
      return;
    }
    const abort = () => {
      clearTimeout(timer);
      reject(new Error("測定を停止しました"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
export async function runMeasurement(options: {
  client: SupabaseClient;
  workspace: string;
  target: string;
  context: MeasurementContext;
  url: string;
  key: string;
  inputId?: string;
  assetId?: string;
  validationOnly?: boolean;
  signal: AbortSignal;
  onState: (state: string) => void;
  onLevel: (db: number) => void;
  onCapture: (capture: LocalCapture) => void;
}) {
  const { client, workspace, target, signal, onState } = options;
  const context = structuredClone(options.context);
  if (context.profile.route === "apple-tv") {
    context.profile.settings["Asset mapping"] = options.validationOnly
      ? "trial"
      : "verified";
    context.profile.settings["Asset ID"] = options.assetId ?? "";
  }
  if (!target) throw new Error("接続済みの再生端末を選択してください");
  if (context.inputGain === "未確認" || context.amplifierVolume === "未確認")
    throw new Error("入力ゲインとアンプ音量を測定条件に記録してください");
  if (context.profile.route === "apple-tv" && !options.assetId)
    throw new Error("Apple TVには検証用アセットIDが必要です");
  let interrupted: string | undefined;
  const recorder = new Recorder(options.onLevel, (reason) => {
    interrupted = reason;
  });
  let sid: string | undefined,
    leaseTimer: ReturnType<typeof setInterval> | undefined,
    renewal = false;
  let capture: LocalCapture | undefined;
  let avrGuard: Awaited<ReturnType<typeof acquireAvr>> = null;
  let avrTimer: ReturnType<typeof setInterval> | undefined;
  let avrRenewal: Promise<void> | undefined;
  const finishAvr = async () => {
    clearInterval(avrTimer);
    await avrRenewal;
    if (!avrGuard) return;
    const observation = await avrGuard.finish();
    avrGuard = null;
    if (capture) capture.context.avrObservation = observation;
    if (observation.interrupted)
      interrupted = observation.reason ?? "AVR条件が変化しました";
  };
  try {
    for (let repeat = 0; repeat < context.profile.repeats; repeat++) {
      if (signal.aborted) throw new Error("測定を停止しました");
      onState(`測定 ${repeat + 1}/${context.profile.repeats} · AVR条件を確認`);
      avrGuard = await acquireAvr(
        new CloudAvrClient(client, workspace),
        context,
        signal
      );
      if (avrGuard)
        avrTimer = setInterval(() => {
          if (avrRenewal || !avrGuard || interrupted) return;
          avrRenewal = avrGuard
            .renew()
            .catch((error) => {
              interrupted =
                error instanceof Error ? error.message : String(error);
            })
            .finally(() => {
              avrRenewal = undefined;
            });
        }, 4000);
      onState(`測定 ${repeat + 1}/${context.profile.repeats} · マイク準備`);
      capture = await recorder.start(context, options.inputId);
      const session = await createSession(client, workspace, capture.context);
      sid = session.id;
      capture.cloudSessionId = sid;
      await putLocal("captures", capture.id, capture);
      onState(`測定 ${repeat + 1}/${context.profile.repeats} · 再生端末を準備`);
      const prepare = await issueCommand(client, sid, target, "prepare", {
        context: capture.context,
        assetId: options.assetId ?? null,
        validationOnly: options.validationOnly ?? false,
      });
      let ready = false;
      for (let i = 0; i < 30; i++) {
        await pause(500, signal);
        if (interrupted) throw new Error(interrupted);
        const { data, error } = await client
          .from("commands")
          .select("acknowledged_at,result")
          .eq("id", prepare.id)
          .single();
        if (error) throw error;
        if (data.acknowledged_at) {
          if (!data.result?.ready)
            throw new Error(data.result?.error ?? "再生端末を準備できません");
          ready = true;
          break;
        }
      }
      if (!ready) throw new Error("再生端末の準備がタイムアウトしました");
      const start = await issueCommand(client, sid, target, "start", {
        captureReady: true,
      });
      let leaseError: string | undefined;
      leaseTimer = setInterval(() => {
        if (renewal || signal.aborted || interrupted) return;
        renewal = true;
        void client.rpc("renew_lease", { cid: start.id }).then(({ error }) => {
          renewal = false;
          if (error) leaseError = error.message;
        });
      }, 1000);
      onState(`測定 ${repeat + 1}/${context.profile.repeats} · スイープ収録中`);
      // Playback must acknowledge start; preparation alone never proves emitted audio.
      let started = false;
      for (let i = 0; i < 8; i++) {
        await pause(500, signal);
        const ack = await client
          .from("commands")
          .select("acknowledged_at,result")
          .eq("id", start.id)
          .single();
        if (ack.error) throw ack.error;
        if (ack.data.acknowledged_at) {
          if (!ack.data.result?.playing)
            throw new Error(ack.data.result?.error ?? "再生開始に失敗");
          started = true;
          break;
        }
      }
      if (!started) throw new Error("再生開始の応答がありません");
      for (
        let i = 0;
        i < Math.ceil((context.profile.sweepSeconds + 7) * 2);
        i++
      ) {
        await pause(500, signal);
        if (interrupted || leaseError)
          throw new Error(interrupted ?? leaseError);
      }
      clearInterval(leaseTimer);
      const completed = await recorder.stop();
      if (completed) capture = { ...completed, cloudSessionId: sid };
      await finishAvr();
      if (interrupted) throw new Error(interrupted);
      if (!completed || completed.status !== "complete")
        throw new Error(completed?.reason ?? "録音が完了しませんでした");
      capture = { ...completed, cloudSessionId: sid };
      await putLocal("captures", capture.id, capture);
      options.onCapture(capture);
      await issueCommand(client, sid, target, "stop");
      sid = undefined;
      onState("クラウドへ原音を保存中");
      await syncCapture(
        client,
        workspace,
        capture,
        options.url,
        options.key,
        (p) => onState(`クラウドへ原音を保存中 · ${p.toFixed(0)}%`)
      );
      capture = undefined;
    }
    onState("収録完了 · Macの解析ワーカーが結果を作成します");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    clearInterval(leaseTimer);
    clearInterval(avrTimer);
    if (sid) await issueCommand(client, sid, target, "stop").catch(() => {});
    const partial = await recorder.stop(reason);
    if (partial) capture = partial;
    await finishAvr();
    if (capture) {
      const saved: LocalCapture = {
        ...capture,
        status: "interrupted",
        reason,
        cloudSessionId: sid ?? capture?.cloudSessionId,
      };
      await putLocal("captures", saved.id, saved);
      options.onCapture(saved);
    }
    throw error;
  } finally {
    clearInterval(leaseTimer);
    clearInterval(avrTimer);
    if (sid) await issueCommand(client, sid, target, "stop").catch(() => {});
  }
}
