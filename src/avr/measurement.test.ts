import { describe, expect, it, vi } from "vitest";
import { initialContext } from "../acoustics/defaults";
import { type AvrControlClient, avrFresh, type ReceiverState } from "./client";
import { acquireAvr } from "./measurement";

const state: ReceiverState = {
  schemaVersion: 1,
  observedAt: new Date().toISOString(),
  zones: {},
  channels: [{ name: "FHL", active: true, value: 24 }],
  sources: [],
  modes: [],
  inputSignal: [],
  activeSpeakers: [],
  details: {},
  errors: {},
};
function fixture() {
  const context = initialContext();
  context.speakerId = "TFL";
  context.avrBinding = { receiverId: "avr", channelMap: { TFL: "FHL" } };
  const observation = {
    receiver_id: "avr",
    observed_at: new Date().toISOString(),
    received_at: new Date().toISOString(),
    revision: "a".repeat(64),
    state,
    measurement: null,
    preset: null,
  };
  const client: AvrControlClient = {
    receivers: vi.fn(),
    observation: vi.fn().mockResolvedValue(observation),
    execute: vi.fn(async (_r, _rev, kind, body) => ({
      status: "succeeded",
      measurement: {
        id: String(body?.measurementId),
        before: state,
        after: kind === "measurement-end" ? state : undefined,
        expiresAt: new Date(Date.now() + 15000).toISOString(),
        interrupted: false,
      },
    })),
  };
  return { context, client, observation };
}
describe("AVR measurement evidence", () => {
  it("requires fresh state and explicit physical mapping before acquiring", async () => {
    const { context, client, observation } = fixture();
    context.avrBinding = { receiverId: "avr", channelMap: {} };
    await expect(
      acquireAvr(client, context, new AbortController().signal)
    ).rejects.toThrow("対応");
    expect(client.execute).not.toHaveBeenCalled();
    expect(avrFresh({ ...observation, received_at: "2000-01-01" })).toBe(false);
  });
  it("retains both observations and uses one measurement ID for the lease", async () => {
    const { context, client } = fixture();
    const guard = await acquireAvr(
      client,
      context,
      new AbortController().signal
    );
    if (!guard) throw new Error("Missing lease");
    expect(context.avrObservation?.before).toEqual(state);
    await guard.renew();
    const result = await guard.finish();
    expect(result.after).toEqual(state);
    expect(result.interrupted).toBe(false);
    const calls = vi.mocked(client.execute).mock.calls;
    expect(new Set(calls.map((call) => call[3]?.measurementId)).size).toBe(1);
  });
  it("marks missing post-observation invalid without discarding pre-observation", async () => {
    const { context, client } = fixture();
    const guard = await acquireAvr(
      client,
      context,
      new AbortController().signal
    );
    if (!guard) throw new Error("Missing lease");
    vi.mocked(client.execute).mockRejectedValue(new Error("offline"));
    const result = await guard.finish();
    expect(result.interrupted).toBe(true);
    expect(result.before).toEqual(state);
    expect(result.reason).toBe("offline");
  });
  it("retains manual legacy contexts without claiming AVR verification", async () => {
    const { context, client } = fixture();
    delete context.avrBinding;
    expect(
      await acquireAvr(client, context, new AbortController().signal)
    ).toBeNull();
    expect(context.avrObservation).toBeUndefined();
    expect(client.execute).not.toHaveBeenCalled();
  });
});
