import { describe, expect, it } from "vitest";
import {
  comparisonWarnings,
  eqSuggestions,
  interpolate,
  parseResponse,
  responseDistance,
  roomModes,
  smooth,
} from "./analysis";
import { initialContext } from "./defaults";
import type { AnalysisResult } from "./types";

const result = (): AnalysisResult => ({
  schemaVersion: 1,
  id: "a",
  sessionId: "s",
  createdAt: "",
  version: "test",
  title: "test",
  source: "frequency-import",
  context: initialContext(),
  response: [],
  quality: {
    level: "relative",
    reasons: [],
    snrDB: null,
    clippedSamples: 0,
    driftPPM: null,
  },
  delaySeconds: null,
  rawArtifactId: null,
});
describe("measurement methodology", () => {
  it("imports REW-style headers and preserves phase", () => {
    expect(
      parseResponse(
        "* REW export\nFrequency SPL Phase\n20 70 -10\n40,72,15\n80\t71\t30"
      )
    ).toEqual([
      { hz: 20, db: 70, phase: -10 },
      { hz: 40, db: 72, phase: 15 },
      { hz: 80, db: 71, phase: 30 },
    ]);
  });
  it("rejects non-finite, duplicate, truncated and malformed data", () => {
    for (const text of [
      "20 30\n20 40\n40 50",
      "20 30\n40 NaN\n80 40",
      "20 30\n40 40",
      "20 30\n40 40\ninvalid",
    ])
      expect(() => parseResponse(text)).toThrow();
  });
  it("interpolates on a logarithmic axis without extrapolating", () => {
    const p = [
      { hz: 20, db: 0 },
      { hz: 80, db: 10 },
    ];
    expect(interpolate(p, 40)).toBeCloseTo(5);
    expect(interpolate(p, 10)).toBeNull();
    expect(interpolate(p, 80)).toBeCloseTo(10);
  });
  it("preserves flat response through energy smoothing", () => {
    const p = Array.from({ length: 241 }, (_, i) => ({
      hz: 20 * 2 ** (i / 24),
      db: -6,
    }));
    expect(smooth(p, 12).every((x) => Math.abs(x.db + 6) < 1e-10)).toBe(true);
  });
  it("separates overall gain from spectral shape", () => {
    const a = [
        { hz: 20, db: 70 },
        { hz: 20000, db: 70 },
      ],
      b = a.map((p) => ({ ...p, db: p.db + 4 }));
    expect(responseDistance(a, b)?.rms).toBeCloseTo(4);
    expect(responseDistance(a, b)?.shapeRMS).toBeCloseTo(0);
    expect(
      responseDistance(a, [
        { hz: 21, db: 0 },
        { hz: 22, db: 0 },
      ])
    ).toBeNull();
  });
  it("predicts axial modes from physical dimensions and temperature", () => {
    const c = initialContext();
    c.room.width = 343.42 / 100;
    expect(
      roomModes(c.room).find((m) => m.indices === "1,0,0")?.hz
    ).toBeCloseTo(50);
    c.room.height = 0;
    expect(roomModes(c.room)).toEqual([]);
  });
  it("blocks EQ recommendations without calibration and a target", () => {
    const r = result();
    expect(eqSuggestions(r)).toEqual([]);
    r.quality.level = "invalid";
    expect(eqSuggestions(r)).toEqual([]);
  });
  it("detects context changes before drawing causal conclusions", () => {
    const a = result(),
      b = result();
    b.context.position[0] = 0.2;
    b.context.profile.settings.Audyssey = "off";
    const warnings = comparisonWarnings(a, b);
    expect(warnings.some((w) => w.includes("位置"))).toBe(true);
    expect(warnings.some((w) => w.includes("アンプ"))).toBe(true);
    expect(warnings.some((w) => w.includes("未確認"))).toBe(true);
  });
});
