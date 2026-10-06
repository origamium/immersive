export type RouteKind =
  | "mac-usb"
  | "mac-hdmi"
  | "apple-tv"
  | "browser"
  | "external";
export type Point3 = [number, number, number];
export type QualityLevel = "verified" | "relative" | "invalid";
export interface SpeakerPosition {
  id: string;
  label: string;
  position: Point3;
  inputChannel: number | null;
}
export interface PlaybackProfile {
  id: string;
  name: string;
  purpose: "music" | "cinema";
  route: RouteKind;
  sampleRate: number;
  bitDepth: number;
  amplitudeDBFS: number;
  sweepSeconds: number;
  startHz: number;
  endHz: number;
  repeats: number;
  settings: Record<string, string>;
  target: ResponsePoint[];
}
export interface RoomModel {
  name: string;
  width: number;
  depth: number;
  height: number;
  temperature: number;
  listener: Point3;
  speakers: SpeakerPosition[];
}
export interface ResponsePoint {
  hz: number;
  db: number;
  phase?: number;
}
export interface Calibration {
  name: string;
  sha256: string;
  orientation: "0" | "90" | "other";
  points: ResponsePoint[];
  splOffsetDB: number | null;
}
export interface MeasurementContext {
  avrBinding?: { receiverId: string; channelMap: Record<string, string> };
  avrObservation?: {
    receiverId: string;
    measurementId: string;
    before: import("../avr/client").ReceiverState;
    after?: import("../avr/client").ReceiverState;
    interrupted: boolean;
    reason?: string;
  };
  room: RoomModel;
  profile: PlaybackProfile;
  speakerId: string;
  position: Point3;
  positionName?: string;
  orientation: string;
  microphone: string;
  microphoneProfile?: "sm58" | "measurement" | "unknown";
  input?: {
    deviceId: string;
    label: string;
    /** Physical input channel, numbered from 1. */
    channel: number;
    channelCount: number;
    sampleRate: number;
  };
  acquisition?: {
    mode: "browser" | "cloud";
    outputDeviceId?: string;
    outputLabel?: string;
    /** Playback channel, numbered from 1. */
    outputChannel?: number;
  };
  calibration: Calibration | null;
  inputGain: string;
  amplifierVolume: string;
  referenceSpeaker: string | null;
  timingVerified: boolean;
  processing: {
    echoCancellation: boolean | null;
    autoGainControl: boolean | null;
    noiseSuppression: boolean | null;
  };
}
export interface DeviceCapabilities {
  schemaVersion: 1;
  deviceId: string;
  name: string;
  platform: string;
  requestedRate: number | null;
  actualRate: number | null;
  channels: number;
  physicalBits: number | null;
  supportedRates: number[];
  verification: "specification" | "api" | "hardware";
  notes: string[];
}
export interface DecayMetric {
  hz: number;
  edt: number | null;
  t20: number | null;
  t30: number | null;
  rSquared: number | null;
  reason?: string;
}
export interface AnalysisResult {
  schemaVersion: 1;
  id: string;
  sessionId: string;
  createdAt: string;
  version: string;
  source: "frequency-import" | "impulse-import" | "sweep" | "example";
  title: string;
  context: MeasurementContext;
  response: ResponsePoint[];
  quality: {
    level: QualityLevel;
    reasons: string[];
    snrDB: number | null;
    clippedSamples: number;
    driftPPM: number | null;
  };
  impulse?: { seconds: number; value: number }[];
  decay?: DecayMetric[];
  waterfall?: { seconds: number; response: ResponsePoint[] }[];
  delaySeconds: number | null;
  rawArtifactId: string | null;
  localCaptureId?: string;
}
export interface AmbientObservation {
  schemaVersion: 1;
  id: string;
  createdAt: string;
  context: MeasurementContext;
  localCaptureId: string;
  durationSeconds: number;
  sampleRate: number;
  /** Input power spectral density, not a transfer response or calibrated SPL. */
  spectrumUnit: "dBFS/Hz";
  spectrum: ResponsePoint[];
  rmsDBFS: number;
  peakDBFS: number;
  clippedSamples: number;
  reasons: string[];
}
export interface Experiment {
  id: string;
  name: string;
  beforeId: string;
  afterId: string;
  hypothesis: string;
  change: string;
  listeningNotes: string;
  createdAt: string;
}
export interface LocalCapture {
  ownerTabId?: string;
  purpose?: "sweep" | "ambient" | "manual";
  analysisOwner?: "browser" | "cloud";
  id: string;
  createdAt: string;
  context: MeasurementContext;
  sampleRate: number;
  frames: number;
  chunkCount: number;
  status: "recording" | "complete" | "interrupted" | "uploaded";
  reason?: string;
  cloudSessionId?: string;
}
export interface CloudDevice {
  id: string;
  name: string;
  kind: "mac" | "recorder" | "tv";
  capabilities: DeviceCapabilities | null;
  last_seen: string | null;
  revoked_at: string | null;
}
export interface MeasurementSession {
  id: string;
  workspace_id: string;
  generation: number;
  state:
    | "draft"
    | "preparing"
    | "armed"
    | "playing"
    | "captured"
    | "analyzing"
    | "complete"
    | "interrupted";
  context: MeasurementContext;
}
export interface PlaybackCommand {
  id: string;
  session_id: string;
  target_device_id: string;
  generation: number;
  sequence: number;
  action: "prepare" | "start" | "stop" | "analyze";
  expires_at: string;
  lease_until: string;
  payload: Record<string, unknown>;
}
