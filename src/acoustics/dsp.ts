import type {
  AnalysisResult,
  DecayMetric,
  MeasurementContext,
  ResponsePoint,
} from "./types";

export const DSP_VERSION = "browser-dsp/1.0.0";
export interface SweepConfig {
  sampleRate: number;
  startHz: number;
  endHz: number;
  sweepSeconds: number;
  amplitudeDBFS: number;
}
type Samples = Float32Array | Float64Array;
export interface Spectrum {
  real: Float64Array;
  imaginary: Float64Array;
}

export function validateSweep(config: SweepConfig) {
  const {
    sampleRate: fs,
    startHz,
    endHz,
    sweepSeconds,
    amplitudeDBFS,
  } = config;
  if (
    ![fs, startHz, endHz, sweepSeconds, amplitudeDBFS].every(Number.isFinite) ||
    fs < 8000 ||
    fs > 48000 ||
    startHz < 10 ||
    endHz <= startHz ||
    endHz >= fs * 0.49 ||
    sweepSeconds < 1 ||
    sweepSeconds > 30 ||
    amplitudeDBFS < -80 ||
    amplitudeDBFS > -12
  )
    throw new Error("スイープ設定が対応範囲外です。");
}

/** The same ESS, fades and acoustic references as AcousticCore/Signal.swift. */
export function stimulusParts(config: SweepConfig) {
  validateSweep(config);
  const {
    sampleRate: fs,
    sweepSeconds,
    startHz,
    endHz,
    amplitudeDBFS,
  } = config;
  const n = Math.floor(fs * sweepSeconds),
    level = 10 ** (amplitudeDBFS / 20);
  const sweep = new Float32Array(n),
    logRatio = Math.log(endHz / startHz);
  const fade = Math.floor(fs * 0.02);
  for (let i = 0; i < n; i++) {
    const t = i / fs,
      edge = Math.min(1, Math.min(i, n - 1 - i) / fade);
    const phase =
      ((2 * Math.PI * startHz * sweepSeconds) / logRatio) *
      (Math.exp((t * logRatio) / sweepSeconds) - 1);
    sweep[i] = level * Math.sin(phase) * 0.5 * (1 - Math.cos(Math.PI * edge));
  }
  const marker = new Float32Array(Math.floor(fs * 0.08));
  const f1 = Math.min(2000, fs * 0.1),
    f2 = Math.min(8000, fs * 0.4);
  for (let i = 0; i < marker.length; i++) {
    const t = i / fs;
    marker[i] =
      level *
      Math.sin(2 * Math.PI * (f1 * t + ((f2 - f1) * t * t) / 0.16)) *
      Math.sin((Math.PI * i) / (marker.length - 1)) ** 2;
  }
  const firstMarker = Math.floor(fs),
    sweepStart = firstMarker + marker.length + Math.floor(fs * 0.5);
  const lastMarker = sweepStart + n + Math.floor(fs * 3);
  return {
    sweep,
    marker,
    firstMarker,
    sweepStart,
    lastMarker,
    frames: lastMarker + marker.length + Math.floor(fs * 0.5),
  };
}

export function generateStimulus(config: SweepConfig): Float32Array {
  const s = stimulusParts(config),
    output = new Float32Array(s.frames);
  output.set(s.marker, s.firstMarker);
  output.set(s.sweep, s.sweepStart);
  output.set(s.marker, s.lastMarker);
  return output;
}

export function fftSize(length: number) {
  let n = 1;
  while (n < length) n *= 2;
  return n;
}

/** Complex radix-2 FFT: forward unscaled, inverse scaled by 1/N. */
export function transform(
  real: Float64Array,
  imaginary: Float64Array,
  inverse = false
) {
  const n = real.length;
  if (imaginary.length !== n || n < 1 || n & (n - 1))
    throw new Error("Invalid FFT size");
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    while (j & bit) {
      j ^= bit;
      bit >>= 1;
    }
    j ^= bit;
    if (i < j) {
      const re = real[i],
        im = imaginary[i];
      real[i] = real[j];
      imaginary[i] = imaginary[j];
      real[j] = re;
      imaginary[j] = im;
    }
  }
  for (let size = 2; size <= n; size *= 2) {
    const angle = ((inverse ? 2 : -2) * Math.PI) / size;
    const stepR = Math.cos(angle),
      stepI = Math.sin(angle),
      half = size / 2;
    for (let start = 0; start < n; start += size) {
      let wr = 1,
        wi = 0;
      for (let j = 0; j < half; j++) {
        const a = start + j,
          b = a + half;
        const tr = wr * real[b] - wi * imaginary[b],
          ti = wr * imaginary[b] + wi * real[b];
        real[b] = real[a] - tr;
        imaginary[b] = imaginary[a] - ti;
        real[a] += tr;
        imaginary[a] += ti;
        const next = wr * stepR - wi * stepI;
        wi = wr * stepI + wi * stepR;
        wr = next;
      }
    }
  }
  if (inverse)
    for (let i = 0; i < n; i++) {
      real[i] /= n;
      imaginary[i] /= n;
    }
}

export function fft(samples: Samples, count = samples.length): Spectrum {
  const real = new Float64Array(fftSize(Math.max(samples.length, count))),
    imaginary = new Float64Array(real.length);
  real.set(samples);
  transform(real, imaginary);
  return { real, imaginary };
}

export function convolve(a: Samples, b: Samples): Float64Array {
  const n = fftSize(a.length + b.length - 1),
    x = fft(a, n),
    y = fft(b, n);
  for (let i = 0; i < n; i++) {
    const re = x.real[i] * y.real[i] - x.imaginary[i] * y.imaginary[i];
    x.imaginary[i] = x.real[i] * y.imaginary[i] + x.imaginary[i] * y.real[i];
    x.real[i] = re;
  }
  transform(x.real, x.imaginary, true);
  return x.real.subarray(0, a.length + b.length - 1);
}

export function frequencyResponse(
  ir: Samples,
  sampleRate: number,
  minHz = 20,
  maxHz = 20000
): ResponsePoint[] {
  const x = fft(ir),
    n = x.real.length,
    points: ResponsePoint[] = [];
  for (
    let hz = minHz;
    hz <= Math.min(maxHz, sampleRate * 0.45);
    hz *= 2 ** (1 / 48)
  ) {
    const bin = (hz * n) / sampleRate,
      lo = Math.floor(bin),
      fraction = bin - lo;
    if (lo + 1 >= n / 2) break;
    const re = x.real[lo] * (1 - fraction) + x.real[lo + 1] * fraction;
    const im =
      x.imaginary[lo] * (1 - fraction) + x.imaginary[lo + 1] * fraction;
    const magnitude =
      Math.hypot(x.real[lo], x.imaginary[lo]) * (1 - fraction) +
      Math.hypot(x.real[lo + 1], x.imaginary[lo + 1]) * fraction;
    points.push({
      hz,
      db: 20 * Math.log10(Math.max(1e-15, magnitude)),
      phase: (Math.atan2(im, re) * 180) / Math.PI,
    });
  }
  return points;
}

export function bandpass(
  samples: Samples,
  fs: number,
  center: number
): Float64Array {
  const omega = (2 * Math.PI * center) / fs,
    alpha = Math.sin(omega) / (2 * Math.sqrt(2)),
    a0 = 1 + alpha;
  const b0 = alpha / a0,
    b2 = -alpha / a0,
    a1 = (-2 * Math.cos(omega)) / a0,
    a2 = (1 - alpha) / a0;
  const result = new Float64Array(samples.length);
  let x1 = 0,
    x2 = 0,
    y1 = 0,
    y2 = 0;
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i],
      y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    result[i] = y;
  }
  return result;
}

export function decayFit(
  samples: Samples,
  sampleRate: number,
  from: number,
  to: number
): { seconds: number; rSquared: number } | null {
  if (samples.length <= 32) return null;
  const energy = new Float64Array(samples.length);
  let sum = 0;
  for (let i = samples.length - 1; i >= 0; i--) {
    sum += samples[i] ** 2;
    energy[i] = sum;
  }
  if (sum <= 1e-20) return null;
  const noiseStart = Math.max(0, samples.length - Math.floor(sampleRate * 0.2));
  let noise = 0;
  for (let i = noiseStart; i < samples.length; i++) noise += samples[i] ** 2;
  noise /= samples.length - noiseStart;
  let count = 0,
    sx = 0,
    sy = 0,
    sxx = 0,
    sxy = 0,
    syy = 0,
    last = 0;
  for (let i = 0; i < energy.length; i++) {
    const db = 10 * Math.log10(Math.max(1e-30, energy[i] / sum));
    if (
      db <= from &&
      db >= to &&
      energy[i] > noise * (samples.length - i) * 10
    ) {
      const x = i / sampleRate;
      count++;
      sx += x;
      sy += db;
      sxx += x * x;
      sxy += x * db;
      syy += db * db;
      last = db;
    }
  }
  if (count < 20 || last > to + 0.5) return null;
  const xx = sxx - (sx * sx) / count,
    xy = sxy - (sx * sy) / count,
    yy = syy - (sy * sy) / count;
  if (xx <= 0 || yy <= 0 || xy >= 0) return null;
  const rSquared = (xy * xy) / (xx * yy);
  return rSquared >= 0.95 ? { seconds: (-60 * xx) / xy, rSquared } : null;
}

export function analyzeImpulse(ir: Samples, sampleRate: number) {
  let peak = 0;
  for (let i = 1; i < ir.length; i++)
    if (Math.abs(ir[i]) > Math.abs(ir[peak])) peak = i;
  const tail = ir.subarray(peak),
    decay: DecayMetric[] = [];
  for (const hz of [63, 125, 250, 500, 1000, 2000, 4000, 8000]) {
    if (hz >= sampleRate * 0.4) continue;
    const band = bandpass(tail, sampleRate, hz),
      edt = decayFit(band, sampleRate, 0, -10);
    const t20 = decayFit(band, sampleRate, -5, -25),
      t30 = decayFit(band, sampleRate, -5, -35);
    decay.push({
      hz,
      edt: edt?.seconds ?? null,
      t20: t20?.seconds ?? null,
      t30: t30?.seconds ?? null,
      rSquared: (t30 ?? t20 ?? edt)?.rSquared ?? null,
      reason: !t20
        ? "減衰幅・雑音余裕・直線性が不足"
        : hz < 250
          ? "小部屋低域: 帯域減衰の参考値（拡散音場の残響時間ではありません）"
          : undefined,
    });
  }
  const waterfall: NonNullable<AnalysisResult["waterfall"]> = [];
  for (let ms = 0; ms <= 500; ms += 25) {
    const start = peak + Math.floor((ms * sampleRate) / 1000);
    if (start >= ir.length) break;
    const window = Float64Array.from(
      ir.subarray(
        start,
        Math.min(ir.length, start + Math.floor(sampleRate * 0.5))
      )
    );
    const ramp = Math.min(64, window.length);
    if (ms > 0) for (let i = 0; i < ramp; i++) window[i] *= i / ramp;
    waterfall.push({
      seconds: ms / 1000,
      response: frequencyResponse(window, sampleRate, 20, 1000),
    });
  }
  return { peak, decay, waterfall };
}

/** Band-limited interpolation used both for clock correction and sub-sample timing. */
export function sincSample(
  samples: Samples,
  position: number,
  radius = 16,
  normalize = true
) {
  const center = Math.floor(position);
  let sum = 0,
    weights = 0;
  for (let k = center - radius; k <= center + radius; k++) {
    if (k < 0 || k >= samples.length) continue;
    const t = position - k;
    if (Math.abs(t) >= radius) continue;
    const sinc =
      Math.abs(t) < 1e-12 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t);
    const weight = sinc * 0.5 * (1 + Math.cos((Math.PI * t) / radius));
    sum += samples[k] * weight;
    weights += weight;
  }
  return normalize ? (weights === 0 ? 0 : sum / weights) : sum;
}

function markerPosition(correlation: Float64Array, start: number, end: number) {
  let peak = start;
  for (let i = start + 1; i < end; i++)
    if (Math.abs(correlation[i]) > Math.abs(correlation[peak])) peak = i;
  let low = peak - 0.7,
    high = peak + 0.7;
  for (let i = 0; i < 32; i++) {
    const a = low + (high - low) / 3,
      b = high - (high - low) / 3;
    if (
      Math.abs(sincSample(correlation, a, 32, false)) <
      Math.abs(sincSample(correlation, b, 32, false))
    )
      low = a;
    else high = b;
  }
  return { peak, refined: (low + high) / 2 };
}

export function recoverImpulse(
  recording: Float32Array,
  config: SweepConfig,
  onProgress?: (s: string) => void
) {
  const s = stimulusParts(config),
    fs = config.sampleRate,
    gap = s.lastMarker - s.firstMarker;
  if (recording.length < s.frames || recording.length > fs * 120)
    throw new Error("録音長が不足、または120秒を超えています。");
  let clippedSamples = 0;
  for (const x of recording) {
    if (!Number.isFinite(x)) throw new Error("PCMに無効な値があります。");
    if (Math.abs(x) >= 0.999) clippedSamples++;
  }
  onProgress?.("前後の音響マーカーを確認中…");
  const correlation = convolve(recording, s.marker.slice().reverse());
  const searchEnd = Math.min(correlation.length, recording.length - gap);
  const first = markerPosition(correlation, s.marker.length - 1, searchEnd);
  const low = Math.max(0, first.peak + gap - Math.floor(fs * 0.15));
  const high = Math.min(
    recording.length,
    first.peak + gap + Math.floor(fs * 0.15)
  );
  if (low >= high) throw new Error("後尾の音響マーカーがありません。");
  const last = markerPosition(correlation, low, high);
  let markerEnergy = 0;
  for (const x of s.marker) markerEnergy += x * x;
  for (const p of [first, last]) {
    const start = p.peak - s.marker.length + 1;
    let energy = 0;
    for (let i = start; i <= p.peak; i++) energy += recording[i] ** 2;
    const normalized =
      Math.abs(correlation[p.peak]) /
      Math.sqrt(Math.max(1e-30, markerEnergy * energy));
    if (
      !Number.isFinite(normalized) ||
      normalized < 0.12 ||
      Math.abs(correlation[p.peak]) < markerEnergy * 0.001
    )
      throw new Error(
        "音響マーカーを信頼できません。音量・入力・周囲の雑音を確認してください。"
      );
  }
  const ratio = (last.refined - first.refined) / gap,
    driftPPM = (ratio - 1) * 1e6;
  if (Math.abs(driftPPM) >= 1000)
    throw new Error("録音と再生の時計ずれが1000 ppm以上です。");
  const firstStart = first.refined - s.marker.length + 1;
  const preRoll = Math.floor(fs * 0.25),
    start = firstStart + (s.sweepStart - s.firstMarker - preRoll) * ratio;
  const aligned = new Float64Array(
    s.sweep.length + Math.floor(fs * 2.5) + preRoll
  );
  if (start < 0 || start + (aligned.length - 1) * ratio >= recording.length)
    throw new Error("スイープ前後の録音が欠けています。");
  onProgress?.("時計ずれを補正し、インパルス応答を算出中…");
  for (let i = 0; i < aligned.length; i++)
    aligned[i] = sincSample(recording, start + i * ratio);
  const n = fftSize(aligned.length + s.sweep.length),
    x = fft(s.sweep, n),
    y = fft(aligned, n);
  let maxPower = 0;
  for (let i = 0; i < n; i++)
    maxPower = Math.max(maxPower, x.real[i] ** 2 + x.imaginary[i] ** 2);
  for (let i = 0; i < n; i++) {
    const power = x.real[i] ** 2 + x.imaginary[i] ** 2,
      denominator = power + maxPower * 1e-10;
    const re =
      (y.real[i] * x.real[i] + y.imaginary[i] * x.imaginary[i]) / denominator;
    y.imaginary[i] =
      (y.imaginary[i] * x.real[i] - y.real[i] * x.imaginary[i]) / denominator;
    y.real[i] = re;
  }
  transform(y.real, y.imaginary, true);
  const ir = y.real.slice(0, Math.floor(fs * 2.5) + preRoll);
  const noiseCount = Math.min(
    Math.floor(fs * 0.5),
    Math.max(1, Math.floor(firstStart) - Math.floor(fs * 0.1))
  );
  let noise = 0,
    signal = 0;
  for (let i = 0; i < noiseCount; i++) noise += recording[i] ** 2;
  for (let i = preRoll; i < preRoll + s.sweep.length; i++)
    signal += aligned[i] ** 2;
  const snrDB =
    10 *
    Math.log10(
      Math.max(signal / s.sweep.length, 1e-30) /
        Math.max(noise / noiseCount, 1e-30)
    );
  return { ir, preRoll, driftPPM, snrDB, clippedSamples };
}

function calibrationOffset(points: ResponsePoint[], hz: number) {
  if (!points.length || hz < points[0].hz || hz > points[points.length - 1].hz)
    return null;
  for (let i = 0; i < points.length; i++) {
    if (points[i].hz === hz) return points[i].db;
    if (i && points[i].hz > hz) {
      const a = points[i - 1],
        b = points[i];
      return (
        a.db + ((b.db - a.db) * Math.log(hz / a.hz)) / Math.log(b.hz / a.hz)
      );
    }
  }
  return null;
}

export function analyzeSweep(
  samples: Float32Array,
  sampleRate: number,
  input: MeasurementContext,
  onProgress?: (s: string) => void
): AnalysisResult {
  if (![44100, 48000].includes(sampleRate))
    throw new Error("ブラウザー解析は44.1 kHzまたは48 kHzに対応しています。");
  const context = structuredClone(input),
    config: SweepConfig = { ...context.profile, sampleRate };
  const dsp = recoverImpulse(samples, config, onProgress);
  onProgress?.("周波数応答・帯域減衰・ウォーターフォールを計算中…");
  const { decay, waterfall } = analyzeImpulse(dsp.ir, sampleRate);
  const response = frequencyResponse(
    dsp.ir,
    sampleRate,
    config.startHz * 1.05,
    config.endHz * 0.95
  );
  const reasons: string[] = [],
    calibration = context.calibration;
  let covered = true;
  if (calibration?.points.length) {
    for (const point of response) {
      const offset = calibrationOffset(calibration.points, point.hz);
      if (offset === null) covered = false;
      else point.db -= offset;
    }
    if (!covered) reasons.push("校正ファイルの周波数範囲外を含みます");
  } else reasons.push("周波数校正なし: 相対評価");
  if (context.microphoneProfile === "sm58")
    reasons.push(
      "SHURE SM58: 指向性と周波数特性の影響を含む相対評価。50 Hz未満は特に不確かです。"
    );
  if (calibration?.orientation === "other")
    reasons.push("校正ファイルとマイクの方向を未確認");
  if (Object.values(context.processing).some((v) => v !== false))
    reasons.push(
      "入力のAGC・ノイズ抑制・エコー除去が停止していることを確認できません"
    );
  reasons.push(
    "ブラウザーの設定値だけでは機器内の音声処理の停止を保証できません。",
    "同じスピーカーの音響マーカーを時間原点とします。絶対遅延・チャンネル間位相の比較には使用しません。",
    "周波数応答は伝達ゲインです。絶対SPLではありません。"
  );
  if (dsp.clippedSamples) reasons.push("クリッピングあり");
  if (dsp.snrDB < 30) reasons.push("SNR 30 dB未満");
  context.timingVerified = false;
  for (const point of response)
    if (point.phase !== undefined)
      point.phase =
        ((((point.phase + (360 * point.hz * dsp.preRoll) / sampleRate + 180) %
          360) +
          360) %
          360) -
        180;
  const impulse: NonNullable<AnalysisResult["impulse"]> = [],
    stride = Math.max(1, Math.floor(dsp.ir.length / 4000));
  for (let i = 0; i < dsp.ir.length; i += stride) {
    let peak = i;
    for (let j = i + 1; j < Math.min(dsp.ir.length, i + stride); j++)
      if (Math.abs(dsp.ir[j]) > Math.abs(dsp.ir[peak])) peak = j;
    impulse.push({
      seconds: (peak - dsp.preRoll) / sampleRate,
      value: dsp.ir[peak],
    });
  }
  const date = new Date().toISOString();
  return {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    sessionId: crypto.randomUUID(),
    createdAt: date,
    version: DSP_VERSION,
    source: "sweep",
    title: `${context.speakerId} · ${context.positionName || "測定点"} · ${date}`,
    context,
    response,
    quality: {
      level:
        dsp.clippedSamples || dsp.snrDB < 30 || !response.length
          ? "invalid"
          : "relative",
      reasons,
      snrDB: dsp.snrDB,
      clippedSamples: dsp.clippedSamples,
      driftPPM: dsp.driftPPM,
    },
    impulse,
    decay,
    waterfall,
    delaySeconds: null,
    rawArtifactId: null,
  };
}

export function analyzeAmbient(
  samples: Float32Array,
  sampleRate: number,
  _context: MeasurementContext
) {
  if (
    ![44100, 48000].includes(sampleRate) ||
    !samples.length ||
    samples.length > sampleRate * 120
  )
    throw new Error("暗騒音の録音長またはサンプルレートが対応範囲外です。");
  let energy = 0,
    peak = 0,
    clippedSamples = 0;
  for (const x of samples) {
    if (!Number.isFinite(x)) throw new Error("PCMに無効な値があります。");
    energy += x * x;
    peak = Math.max(peak, Math.abs(x));
    if (Math.abs(x) >= 0.999) clippedSamples++;
  }
  // Welch power spectrum, Hann window and 50% overlap. Units are dBFS/Hz.
  const n = 16384,
    power = new Float64Array(n / 2),
    window = new Float64Array(n);
  let windowEnergy = 0;
  for (let i = 0; i < n; i++) {
    window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
    windowEnergy += window[i] ** 2;
  }
  let windows = 0;
  for (
    let start = 0;
    start + n <= samples.length || (!windows && start === 0);
    start += n / 2
  ) {
    const real = new Float64Array(n),
      imaginary = new Float64Array(n);
    for (let i = 0; i < n && start + i < samples.length; i++)
      real[i] = samples[start + i] * window[i];
    transform(real, imaginary);
    for (let i = 0; i < power.length; i++)
      power[i] +=
        ((real[i] ** 2 + imaginary[i] ** 2) * (i === 0 ? 1 : 2)) /
        (sampleRate * windowEnergy);
    windows++;
    if (samples.length < n) break;
  }
  const spectrum: ResponsePoint[] = [];
  for (let hz = 20; hz <= sampleRate * 0.45; hz *= 2 ** (1 / 48)) {
    const bin = (hz * n) / sampleRate,
      lo = Math.floor(bin),
      f = bin - lo;
    if (lo + 1 < power.length)
      spectrum.push({
        hz,
        db:
          10 *
          Math.log10(
            Math.max(1e-20, (power[lo] * (1 - f) + power[lo + 1] * f) / windows)
          ),
      });
  }
  return {
    spectrum,
    rmsDBFS: 10 * Math.log10(Math.max(1e-16, energy / samples.length)),
    peakDBFS: 20 * Math.log10(Math.max(1e-8, peak)),
    clippedSamples,
  };
}
