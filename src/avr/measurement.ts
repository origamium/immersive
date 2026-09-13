import type { MeasurementContext } from "../acoustics/types";
import { type AvrControlClient, avrFresh, type ReceiverLease } from "./client";

/** Acquire before opening the microphone. Failure must not silently degrade to manual evidence. */
export async function acquireAvr(
  client: AvrControlClient,
  context: MeasurementContext,
  signal: AbortSignal
) {
  const binding = context.avrBinding;
  if (!binding) return null;
  const observation = await client.observation(binding.receiverId);
  if (!avrFresh(observation) || !observation)
    throw new Error(
      "AVR状態が古いため測定できません。Macの接続を確認してください"
    );
  if (observation.state.simulated)
    throw new Error("シミュレーターは実機測定の条件にできません");
  const channel = binding.channelMap[context.speakerId];
  if (
    !channel ||
    !observation.state.channels.some((c) => c.active && c.name === channel)
  )
    throw new Error("測定スピーカーとAVRチャンネルの対応を確認してください");
  if (Object.keys(observation.state.errors).length)
    throw new Error("AVR条件の読み取りに失敗しています");
  const measurementId = crypto.randomUUID();
  const result = await client.execute(
    binding.receiverId,
    observation.revision,
    "measurement-begin",
    { measurementId },
    signal
  );
  if (!result.measurement || result.measurement.interrupted)
    throw new Error(
      result.measurement?.reason ?? "AVR測定ロックを取得できません"
    );
  let lease = result.measurement;
  const apply = (value: ReceiverLease) => {
    lease = value;
    context.avrObservation = {
      receiverId: binding.receiverId,
      measurementId,
      before: value.before,
      after: value.after,
      interrupted: value.interrupted,
      reason: value.reason,
    };
  };
  apply(lease);
  return {
    async renew() {
      const response = await client.execute(
        binding.receiverId,
        observation.revision,
        "measurement-renew",
        { measurementId }
      );
      if (!response.measurement || response.measurement.interrupted)
        throw new Error(
          response.measurement?.reason ?? "AVR測定ロックを更新できません"
        );
      apply(response.measurement);
    },
    async finish() {
      try {
        const response = await client.execute(
          binding.receiverId,
          observation.revision,
          "measurement-end",
          { measurementId }
        );
        if (!response.measurement?.after)
          throw new Error("AVR測定後の条件を取得できません");
        apply(response.measurement);
      } catch (error) {
        apply({
          ...lease,
          interrupted: true,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
      if (!context.avrObservation) throw new Error("AVR観測記録がありません");
      return context.avrObservation;
    },
  };
}
