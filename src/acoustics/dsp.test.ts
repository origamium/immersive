import { describe, expect, it, vi } from "vitest";
import { initialContext } from "./defaults";
import {
  analyzeAmbient,
  analyzeImpulse,
  analyzeSweep,
  convolve,
  decayFit,
  fft,
  frequencyResponse,
  generateStimulus,
  recoverImpulse,
  type SweepConfig,
  sincSample,
  stimulusParts,
  transform,
} from "./dsp";
import { analyzeLocalCapture, readCaptureSamples } from "./localAnalysis";
import type { LocalCapture } from "./types";

const localRead = vi.hoisted(() => vi.fn());
vi.mock("./local", () => ({ getLocal: localRead }));

const config: SweepConfig = {
  sampleRate: 8000,
  sweepSeconds: 2,
  startHz: 40,
  endHz: 3000,
  amplitudeDBFS: -30,
};
const capture = (signal: Float32Array, gain = 0.4) => {
  const samples = new Float32Array(signal.length + 1300);
  for (let i = 0; i < signal.length; i++) samples[i + 300] = signal[i] * gain;
  return samples;
};

describe("browser acoustic DSP", () => {
  it("uses the native stimulus schedule and bounded settings", () => {
    const c = {
      ...config,
      sampleRate: 48000,
      sweepSeconds: 10,
      startHz: 20,
      endHz: 20000,
    };
    const parts = stimulusParts(c),
      signal = generateStimulus(c);
    expect(parts.firstMarker).toBe(48000);
    expect(parts.sweepStart).toBe(75840);
    expect(parts.lastMarker).toBe(699840);
    expect(signal.length).toBe(727680);
    // Independent golden samples emitted by AcousticMac `generate` (Float32 WAV,
    // 48 kHz / 10 s / 20–20000 Hz / −30 dBFS), including both timing references.
    const nativeFixture = [
      [48001, 5.48308998205016e-9],
      [48117, 0.00016662977577652782],
      [50000, 0.012049072422087193],
      [51838, -1.8344106678114258e-8],
      [75841, 2.2165021207332103e-10],
      [76000, 0.0008625339833088219],
      [123456, 0.0005098340334370732],
      [400000, -0.005825124215334654],
      [555838, 7.641769173005741e-8],
      [699841, 5.48308998205016e-9],
      [700123, 0.0009381130803376436],
      [703678, -1.8344106678114258e-8],
    ];
    for (const [index, value] of nativeFixture)
      expect(Math.abs(signal[index] - value)).toBeLessThan(1e-8);
    expect(signal[parts.sweepStart]).toBe(0);
    expect(Math.abs(signal[parts.sweepStart + parts.sweep.length - 1])).toBe(0);
    expect(
      signal.subarray(
        parts.firstMarker,
        parts.firstMarker + parts.marker.length
      )
    ).toEqual(parts.marker);
    expect(() => generateStimulus({ ...c, sweepSeconds: 31 })).toThrow();
    expect(() => generateStimulus({ ...c, amplitudeDBFS: -6 })).toThrow();
    expect(() => generateStimulus({ ...c, sampleRate: 96000 })).toThrow();
  });

  it("matches direct DFT, inverse scaling, convolution and impulse gain", () => {
    const samples = Float64Array.from([
      0.2, -0.3, 0.1, 0.8, -0.4, 0, 0.1, -0.6,
    ]);
    const spectrum = fft(samples);
    for (let k = 0; k < samples.length; k++) {
      let re = 0,
        im = 0;
      for (let j = 0; j < samples.length; j++) {
        re += samples[j] * Math.cos((-2 * Math.PI * j * k) / samples.length);
        im += samples[j] * Math.sin((-2 * Math.PI * j * k) / samples.length);
      }
      expect(spectrum.real[k]).toBeCloseTo(re, 10);
      expect(spectrum.imaginary[k]).toBeCloseTo(im, 10);
    }
    transform(spectrum.real, spectrum.imaginary, true);
    for (let i = 0; i < samples.length; i++)
      expect(spectrum.real[i]).toBeCloseTo(samples[i], 10);
    const convolution = convolve(
      Float64Array.from([1, 2, 3]),
      Float64Array.from([0.5, -0.25])
    );
    [0.5, 0.75, 1, -0.75].forEach((value, i) => {
      expect(convolution[i]).toBeCloseTo(value, 10);
    });
    const impulse = new Float64Array(48000);
    impulse[480] = 0.5;
    for (const point of frequencyResponse(impulse, 48000))
      expect(point.db).toBeCloseTo(-6.0206, 3);
  });

  it("reconstructs native test fixture gain without per-result normalization", () => {
    const result = recoverImpulse(capture(generateStimulus(config)), config);
    expect(result.driftPPM).toBeCloseTo(0, 0);
    for (const point of frequencyResponse(result.ir, 8000, 100, 2000))
      expect(Math.abs(point.db - 20 * Math.log10(0.4))).toBeLessThan(0.1);
  });

  it("corrects independent clocks in both directions", () => {
    const signal = generateStimulus(config);
    for (const ppm of [-100, 100]) {
      const ratio = 1 + ppm / 1e6;
      const stretched = new Float32Array(Math.floor(signal.length * ratio));
      for (let i = 0; i < stretched.length; i++)
        stretched[i] = sincSample(signal, i / ratio, 24);
      const result = recoverImpulse(capture(stretched), config);
      expect(Math.abs(result.driftPPM - ppm)).toBeLessThan(5);
      for (const point of frequencyResponse(result.ir, 8000, 100, 2000))
        expect(Math.abs(point.db - 20 * Math.log10(0.4))).toBeLessThan(0.15);
    }
  });

  it("recovers a resonant room with a discrete reflection", () => {
    const room = new Float64Array(8000);
    room[0] = 0.4;
    room[500] = 0.1;
    for (let i = 0; i < room.length; i++)
      room[i] +=
        0.002 *
        Math.exp((-Math.log(1000) * i) / 8000 / 0.6) *
        Math.sin((2 * Math.PI * 63 * i) / 8000);
    const measured = convolve(generateStimulus(config), room);
    const result = recoverImpulse(
      capture(Float32Array.from(measured), 1),
      config
    );
    const expectedIR = new Float64Array(result.ir.length);
    expectedIR.set(room);
    const expected = frequencyResponse(expectedIR, 8000, 50, 2000);
    const actual = frequencyResponse(result.ir, 8000, 50, 2000);
    for (let i = 0; i < expected.length; i++)
      expect(Math.abs(actual[i].db - expected[i].db)).toBeLessThan(0.3);
  });

  it("rejects missing references, unrelated noise, truncation and invalid PCM", () => {
    const parts = stimulusParts(config),
      signal = generateStimulus(config);
    expect(() =>
      recoverImpulse(new Float32Array(signal.length), config)
    ).toThrow(/マーカー/);
    for (const start of [parts.firstMarker, parts.lastMarker]) {
      const missing = signal.slice();
      missing.fill(0, start, start + parts.marker.length);
      expect(() => recoverImpulse(capture(missing), config)).toThrow();
    }
    let seed = 1234;
    const noise = Float32Array.from(signal, () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
      return (seed / 2147483648) * 0.1;
    });
    expect(() => recoverImpulse(noise, config)).toThrow();
    expect(() =>
      recoverImpulse(signal.slice(0, parts.lastMarker), config)
    ).toThrow(/録音長/);
    const invalid = capture(signal);
    invalid[100] = Number.NaN;
    expect(() => recoverImpulse(invalid, config)).toThrow(/PCM/);
    const wrongClock = signal.slice();
    wrongClock.fill(
      0,
      parts.lastMarker,
      parts.lastMarker + parts.marker.length
    );
    wrongClock.set(parts.marker, parts.lastMarker + 80);
    expect(() => recoverImpulse(capture(wrongClock), config)).toThrow(
      /時計ずれ/
    );
  });

  it("fits known decay and keeps one amplitude reference across waterfall time slices", () => {
    const fs = 8000,
      t60 = 0.6;
    const envelope = Float64Array.from({ length: fs * 2 }, (_, i) =>
      Math.exp((-Math.log(1000) * i) / fs / t60)
    );
    expect(decayFit(envelope, fs, -5, -35)?.seconds).toBeCloseTo(t60, 2);
    expect(decayFit(new Float64Array(fs * 2).fill(1), fs, -5, -35)).toBeNull();
    const resonant = envelope.map(
      (x, i) => x * Math.sin((2 * Math.PI * 63 * i) / fs)
    );
    const analysis = analyzeImpulse(resonant, fs);
    const initial = analysis.waterfall[0].response;
    const maximum = initial.reduce((a, b) => (a.db > b.db ? a : b));
    expect(Math.abs(maximum.hz - 63)).toBeLessThan(2);
    const late = analysis.waterfall.find((slice) => slice.seconds === 0.3);
    if (!late) throw new Error("Missing waterfall slice");
    const latePoint = late.response.reduce((a, b) =>
      Math.abs(a.hz - 63) < Math.abs(b.hz - 63) ? a : b
    );
    expect(latePoint.db - maximum.db).toBeLessThan(-25);
    expect(latePoint.db - maximum.db).toBeGreaterThan(-35);
  });

  it("returns complete SM58 analysis at both supported browser rates", () => {
    for (const sampleRate of [44100, 48000]) {
      const context = initialContext();
      Object.assign(context.profile, { sampleRate, sweepSeconds: 1 });
      context.microphoneProfile = "sm58";
      context.calibration = {
        name: "synthetic identity",
        sha256: "fixture",
        orientation: "0",
        splOffsetDB: 94,
        points: [
          { hz: 20, db: 0 },
          { hz: 20000, db: 0 },
        ],
      };
      context.processing = {
        echoCancellation: false,
        autoGainControl: false,
        noiseSuppression: false,
      };
      context.timingVerified = true;
      const result = analyzeSweep(
        capture(generateStimulus({ ...context.profile, sampleRate })),
        sampleRate,
        context
      );
      expect(result.source).toBe("sweep");
      expect(result.quality.level).toBe("relative");
      expect(
        result.quality.reasons.some((reason) => reason.includes("SM58"))
      ).toBe(true);
      expect(result.context.timingVerified).toBe(false);
      expect(result.delaySeconds).toBeNull();
      expect(result.impulse?.length).toBeGreaterThan(3000);
      expect(result.decay?.length).toBe(8);
      expect(result.waterfall?.length).toBe(21);
      for (const point of result.response) {
        expect(point.phase).toBeGreaterThanOrEqual(-180);
        expect(point.phase).toBeLessThan(180);
      }
      for (const point of result.response.filter(
        (p) => p.hz > 100 && p.hz < 10000
      ))
        expect(Math.abs(point.db - 20 * Math.log10(0.4))).toBeLessThan(0.3);
    }
  }, 20000);

  it("measures ambient digital levels without claiming SPL", () => {
    const samples = Float32Array.from(
      { length: 48000 },
      (_, i) => 0.1 * Math.sin((2 * Math.PI * 1000 * i) / 48000)
    );
    const result = analyzeAmbient(samples, 48000, initialContext());
    expect(result.rmsDBFS).toBeCloseTo(-23.0103, 3);
    expect(result.peakDBFS).toBeCloseTo(-20, 3);
    expect(result.clippedSamples).toBe(0);
    const peak = result.spectrum.reduce((a, b) => (a.db > b.db ? a : b));
    expect(Math.abs(peak.hz - 1000)).toBeLessThan(15);
    samples[42] = 1;
    expect(
      analyzeAmbient(samples, 48000, initialContext()).clippedSamples
    ).toBe(1);
  });
});

describe("local analysis raw preservation", () => {
  const recording = (): LocalCapture => ({
    id: "local",
    createdAt: "",
    context: initialContext(),
    sampleRate: 48000,
    frames: 4,
    chunkCount: 2,
    status: "complete",
    purpose: "sweep",
    analysisOwner: "browser",
  });

  it("copies complete chunks and refuses missing or inconsistent frames", async () => {
    const first = Float32Array.from([0.1, 0.2]).buffer,
      second = Float32Array.from([0.3, 0.4]).buffer;
    localRead
      .mockReset()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const samples = await readCaptureSamples(
      recording(),
      new AbortController().signal
    );
    expect(samples).toEqual(Float32Array.from([0.1, 0.2, 0.3, 0.4]));
    samples[0] = 99;
    expect(new Float32Array(first)[0]).toBeCloseTo(0.1);
    localRead
      .mockReset()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(undefined);
    await expect(
      readCaptureSamples(recording(), new AbortController().signal)
    ).rejects.toThrow(/欠落/);
    localRead.mockReset().mockResolvedValue(first);
    await expect(
      readCaptureSamples(
        { ...recording(), frames: 5 },
        new AbortController().signal
      )
    ).rejects.toThrow(/欠落/);
    await expect(
      readCaptureSamples(
        { ...recording(), status: "interrupted" },
        new AbortController().signal
      )
    ).rejects.toThrow(/中断/);
  });

  it("terminates analysis immediately on cancellation without mutating saved PCM", async () => {
    const saved = Float32Array.from([0.1, 0.2]).buffer;
    localRead.mockReset().mockResolvedValue(saved);
    const terminated = vi.fn(),
      posted = vi.fn();
    class FakeWorker {
      onmessage = null;
      onerror = null;
      onmessageerror = null;
      terminate = terminated;
      postMessage = posted;
    }
    vi.stubGlobal("Worker", FakeWorker);
    try {
      const controller = new AbortController();
      const pending = analyzeLocalCapture(recording(), controller.signal);
      const assertion = expect(pending).rejects.toMatchObject({
        name: "AbortError",
      });
      await vi.waitFor(() => expect(posted).toHaveBeenCalledOnce());
      controller.abort();
      await assertion;
      expect(terminated).toHaveBeenCalledOnce();
      expect(new Float32Array(saved)).toEqual(Float32Array.from([0.1, 0.2]));
      await expect(
        analyzeLocalCapture(
          { ...recording(), purpose: "ambient" },
          new AbortController().signal
        )
      ).rejects.toThrow(/スイープ/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
