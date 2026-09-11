import type { MeasurementContext, PlaybackProfile, RoomModel } from "./types";

export const defaultRoom: RoomModel = {
  name: "リスニングルーム",
  width: 4,
  depth: 6,
  height: 2.5,
  temperature: 20,
  listener: [0, 1.2, 0],
  speakers: [
    { id: "FL", label: "Front L", position: [-1.3, 1.2, -2], inputChannel: 0 },
    { id: "FR", label: "Front R", position: [1.3, 1.2, -2], inputChannel: 1 },
    { id: "C", label: "Center", position: [0, 0.7, -2], inputChannel: 2 },
    {
      id: "LFE",
      label: "Subwoofer",
      position: [-1.5, 0.3, -2],
      inputChannel: 3,
    },
    {
      id: "SL",
      label: "Surround L",
      position: [-1.8, 1.2, 0.5],
      inputChannel: 4,
    },
    {
      id: "SR",
      label: "Surround R",
      position: [1.8, 1.2, 0.5],
      inputChannel: 5,
    },
    {
      id: "SBL",
      label: "Surround Back L",
      position: [-1.3, 1.2, 2],
      inputChannel: 6,
    },
    {
      id: "SBR",
      label: "Surround Back R",
      position: [1.3, 1.2, 2],
      inputChannel: 7,
    },
    ...["TFL", "TFR", "TML", "TMR", "TRL", "TRR"].map((id, i) => ({
      id,
      label: id,
      position: [
        (i % 2 ? 1 : -1) * 1.3,
        2.4,
        (Math.floor(i / 2) - 1) * 1.6,
      ] as [number, number, number],
      inputChannel: null,
    })),
  ],
};
export const profiles: PlaybackProfile[] = [
  {
    id: "cinema",
    name: "AVC-A110 · Cinema",
    purpose: "cinema",
    route: "mac-hdmi",
    sampleRate: 48000,
    bitDepth: 24,
    amplitudeDBFS: -30,
    sweepSeconds: 10,
    startHz: 20,
    endHz: 20000,
    repeats: 3,
    settings: {
      Audyssey: "未確認",
      "Dynamic EQ": "未確認",
      "Dynamic Volume": "未確認",
      "Sound Mode": "未確認",
      Crossover: "未確認",
      "Distances / Levels": "未確認",
    },
    target: [],
  },
  {
    id: "music",
    name: "PMA-A110 · Music",
    purpose: "music",
    route: "mac-usb",
    sampleRate: 96000,
    bitDepth: 24,
    amplitudeDBFS: -30,
    sweepSeconds: 10,
    startHz: 20,
    endHz: 20000,
    repeats: 3,
    settings: { "Source Direct": "未確認", "Tone / Balance": "未確認" },
    target: [],
  },
];
export function initialContext(): MeasurementContext {
  return {
    room: structuredClone(defaultRoom),
    profile: structuredClone(profiles[0]),
    speakerId: "FL",
    position: [0, 1.2, 0],
    orientation: "上向き・固定",
    microphone: "未登録",
    calibration: null,
    inputGain: "未確認",
    amplifierVolume: "未確認",
    referenceSpeaker: null,
    timingVerified: false,
    processing: {
      echoCancellation: null,
      autoGainControl: null,
      noiseSuppression: null,
    },
  };
}
