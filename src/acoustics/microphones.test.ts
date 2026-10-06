import { describe, expect, it } from "vitest";
import { comparisonWarnings, eqSuggestions } from "./analysis";
import { initialContext } from "./defaults";
import { microphoneQuality } from "./microphones";
import type { AnalysisResult } from "./types";

const result = (): AnalysisResult => ({
  schemaVersion: 1,
  id: "a",
  sessionId: "s",
  createdAt: "",
  version: "old-worker",
  source: "sweep",
  title: "SM58",
  context: {
    ...initialContext(),
    calibration: {
      name: "on-axis",
      sha256: "test",
      orientation: "0",
      splOffsetDB: null,
      points: [
        { hz: 20, db: 0 },
        { hz: 20000, db: 0 },
      ],
    },
  },
  response: [
    { hz: 20, db: 0 },
    { hz: 80, db: 9 },
    { hz: 300, db: 0 },
  ],
  quality: {
    level: "verified",
    reasons: [],
    snrDB: 45,
    driftPPM: 2,
    clippedSamples: 0,
  },
  delaySeconds: null,
  rawArtifactId: null,
});
describe("microphone-specific measurement limits", () => {
  it("downgrades old SM58 results even with a calibration file, and blocks EQ", () => {
    const r = result();
    r.context.profile.target = [
      { hz: 20, db: 0 },
      { hz: 20000, db: 0 },
    ];
    expect(microphoneQuality(r).quality.level).toBe("relative");
    expect(eqSuggestions(r)).toEqual([]);
    expect(r.quality.level).toBe("verified"); // no mutation of archived data
    expect(microphoneQuality(microphoneQuality(r)).quality.reasons).toEqual(
      microphoneQuality(r).quality.reasons
    );
  });
  it("never promotes invalid data and recognizes legacy model names", () => {
    const r = result();
    delete r.context.microphoneProfile;
    r.context.microphone = "Shure SM 58";
    r.quality.level = "invalid";
    expect(microphoneQuality(r).quality.level).toBe("invalid");
    expect(microphoneQuality(r).quality.reasons.join()).toContain("50 Hz");
    r.context.microphone = "calibrated omni";
    expect(microphoneQuality(r)).toBe(r);
  });
  it("warns about input channel and playback path changes", () => {
    const a = result(),
      b = result();
    a.context.input = {
      deviceId: "ur12",
      label: "UR12",
      channel: 1,
      channelCount: 2,
      sampleRate: 192000,
    };
    b.context.input = { ...a.context.input, channel: 2 };
    b.context.acquisition = { mode: "browser", outputChannel: 2 };
    expect(comparisonWarnings(a, b).join()).toContain("入力機器");
    expect(comparisonWarnings(a, b).join()).toContain("出力機器");
  });
});
