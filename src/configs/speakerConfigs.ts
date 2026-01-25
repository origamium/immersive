export interface SpeakerConfig {
  id: string
  label: string
  angle: number // degrees from front center
  elevation: number // degrees from horizontal (0 = floor level, positive = ceiling)
  distance: number // distance from listener
  color: string
}

export interface SurroundConfig {
  name: string
  label: string
  speakers: SpeakerConfig[]
}

// Color palette for speakers
const colors = {
  // Floor speakers
  frontLeft: "#e74c3c",
  center: "#2ecc71",
  frontRight: "#3498db",
  sideLeft: "#9b59b6",
  sideRight: "#e67e22",
  rearLeft: "#1abc9c",
  rearRight: "#f1c40f",
  wideLeft: "#e91e63",
  wideRight: "#00bcd4",
  // Ceiling speakers
  topFrontLeft: "#ff7043",
  topFrontRight: "#42a5f5",
  topMiddleLeft: "#ab47bc",
  topMiddleRight: "#66bb6a",
  topRearLeft: "#26a69a",
  topRearRight: "#ffa726",
}

// Standard speaker positions based on ITU-R BS.2051 and Dolby guidelines
const floorDistance = 2.5
const ceilingDistance = 2.2

// Base speaker definitions
const FL: SpeakerConfig = { id: "FL", label: "FL", angle: -30, elevation: 0, distance: floorDistance, color: colors.frontLeft }
const FR: SpeakerConfig = { id: "FR", label: "FR", angle: 30, elevation: 0, distance: floorDistance, color: colors.frontRight }
const C: SpeakerConfig = { id: "C", label: "C", angle: 0, elevation: 0, distance: floorDistance, color: colors.center }
const SL: SpeakerConfig = { id: "SL", label: "SL", angle: -90, elevation: 0, distance: floorDistance, color: colors.sideLeft }
const SR: SpeakerConfig = { id: "SR", label: "SR", angle: 90, elevation: 0, distance: floorDistance, color: colors.sideRight }
const RL: SpeakerConfig = { id: "RL", label: "RL", angle: -135, elevation: 0, distance: floorDistance, color: colors.rearLeft }
const RR: SpeakerConfig = { id: "RR", label: "RR", angle: 135, elevation: 0, distance: floorDistance, color: colors.rearRight }
const WL: SpeakerConfig = { id: "WL", label: "WL", angle: -60, elevation: 0, distance: floorDistance, color: colors.wideLeft }
const WR: SpeakerConfig = { id: "WR", label: "WR", angle: 60, elevation: 0, distance: floorDistance, color: colors.wideRight }

// Ceiling speakers (elevation angle typically 30-45 degrees for Atmos)
const ceilingElevation = 45

const TFL: SpeakerConfig = { id: "TFL", label: "TFL", angle: -45, elevation: ceilingElevation, distance: ceilingDistance, color: colors.topFrontLeft }
const TFR: SpeakerConfig = { id: "TFR", label: "TFR", angle: 45, elevation: ceilingElevation, distance: ceilingDistance, color: colors.topFrontRight }
const TML: SpeakerConfig = { id: "TML", label: "TML", angle: -90, elevation: ceilingElevation, distance: ceilingDistance, color: colors.topMiddleLeft }
const TMR: SpeakerConfig = { id: "TMR", label: "TMR", angle: 90, elevation: ceilingElevation, distance: ceilingDistance, color: colors.topMiddleRight }
const TRL: SpeakerConfig = { id: "TRL", label: "TRL", angle: -135, elevation: ceilingElevation, distance: ceilingDistance, color: colors.topRearLeft }
const TRR: SpeakerConfig = { id: "TRR", label: "TRR", angle: 135, elevation: ceilingElevation, distance: ceilingDistance, color: colors.topRearRight }

// Surround configurations
// Label format: "Total.LFE ch (Base.LFE.Height)"
export const surroundConfigs: SurroundConfig[] = [
  {
    name: "5.1",
    label: "5.1ch",
    speakers: [FL, C, FR, SL, SR],
  },
  {
    name: "7.1",
    label: "7.1ch",
    speakers: [FL, C, FR, SL, SR, RL, RR],
  },
  {
    name: "5.1.2",
    label: "7.1ch (5.1.2ch)",
    speakers: [FL, C, FR, SL, SR, TML, TMR],
  },
  {
    name: "5.1.4",
    label: "9.1ch (5.1.4ch)",
    speakers: [FL, C, FR, SL, SR, TFL, TFR, TRL, TRR],
  },
  {
    name: "7.1.2",
    label: "9.1ch (7.1.2ch)",
    speakers: [FL, C, FR, SL, SR, RL, RR, TML, TMR],
  },
  {
    name: "7.1.4",
    label: "11.1ch (7.1.4ch)",
    speakers: [FL, C, FR, SL, SR, RL, RR, TFL, TFR, TRL, TRR],
  },
  {
    name: "9.1.4",
    label: "13.1ch (9.1.4ch)",
    speakers: [FL, C, FR, WL, WR, SL, SR, RL, RR, TFL, TFR, TRL, TRR],
  },
  {
    name: "9.1.6",
    label: "15.1ch (9.1.6ch)",
    speakers: [FL, C, FR, WL, WR, SL, SR, RL, RR, TFL, TFR, TML, TMR, TRL, TRR],
  },
]

// Convert spherical coordinates (angle, elevation, distance) to Cartesian (x, y, z)
export const sphericalToCartesian = (
  angleDegrees: number,
  elevationDegrees: number,
  distance: number
): [number, number, number] => {
  const angleRadians = (angleDegrees * Math.PI) / 180
  const elevationRadians = (elevationDegrees * Math.PI) / 180

  const horizontalDistance = distance * Math.cos(elevationRadians)
  const x = horizontalDistance * Math.sin(angleRadians)
  const y = distance * Math.sin(elevationRadians)
  const z = -horizontalDistance * Math.cos(angleRadians) // negative because forward is -Z in Three.js

  return [x, y, z]
}

// Calculate speaker Y rotation to face the center (listener position)
// Only Y rotation is used - speakers stay parallel to floor/ceiling
export const getSpeakerRotationY = (angleDegrees: number): number => {
  return (-angleDegrees * Math.PI) / 180
}

// Helper to check if a speaker is a ceiling speaker
export const isCeilingSpeaker = (speaker: SpeakerConfig): boolean => {
  return speaker.elevation > 0
}
