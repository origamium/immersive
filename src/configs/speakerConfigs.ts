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
  surroundBackLeft: "#1abc9c",
  surroundBackRight: "#f1c40f",
  frontWideLeft: "#e91e63",
  frontWideRight: "#00bcd4",
  // Height speakers (wall-mounted, Auro-3D style 30° elevation)
  frontHeightLeft: "#ff5722",
  frontHeightRight: "#2196f3",
  surroundHeightLeft: "#9c27b0",
  surroundHeightRight: "#4caf50",
  rearHeightLeft: "#009688",
  rearHeightRight: "#ff9800",
  centerHeight: "#795548",
  // Top speakers (ceiling-mounted, Dolby Atmos style 45° elevation)
  topFrontLeft: "#ff7043",
  topFrontRight: "#42a5f5",
  topMiddleLeft: "#ab47bc",
  topMiddleRight: "#66bb6a",
  topRearLeft: "#26a69a",
  topRearRight: "#ffa726",
  topSurround: "#8d6e63",
}

// ===== Speaker distances =====
const floorDistance = 2.5
const heightDistance = 2.5 // Wall-mounted height speakers
const topDistance = 2.2    // Ceiling-mounted speakers

// ===== Elevation angles =====
const heightElevation = 30 // Auro-3D style wall-mounted (30° above ear level)
const topElevation = 45    // Dolby Atmos ceiling-mounted (45° for good overhead perception)

// ===== Floor Speakers (elevation = 0) =====
// Based on Denon AVC-A1H manual and ITU-R BS.2051

// Front Left/Right: ±30°
const FL: SpeakerConfig = { id: "FL", label: "FL", angle: -30, elevation: 0, distance: floorDistance, color: colors.frontLeft }
const FR: SpeakerConfig = { id: "FR", label: "FR", angle: 30, elevation: 0, distance: floorDistance, color: colors.frontRight }

// Center: 0°
const C: SpeakerConfig = { id: "C", label: "C", angle: 0, elevation: 0, distance: floorDistance, color: colors.center }

// Surround/Side Left/Right: ±110° (per Denon diagrams, wider than 90°)
const SL: SpeakerConfig = { id: "SL", label: "SL", angle: -110, elevation: 0, distance: floorDistance, color: colors.sideLeft }
const SR: SpeakerConfig = { id: "SR", label: "SR", angle: 110, elevation: 0, distance: floorDistance, color: colors.sideRight }

// Surround Back Left/Right: ±150° (rear surrounds)
const SBL: SpeakerConfig = { id: "SBL", label: "SBL", angle: -150, elevation: 0, distance: floorDistance, color: colors.surroundBackLeft }
const SBR: SpeakerConfig = { id: "SBR", label: "SBR", angle: 150, elevation: 0, distance: floorDistance, color: colors.surroundBackRight }

// Front Wide Left/Right: ±60° (between front and surround)
const FWL: SpeakerConfig = { id: "FWL", label: "FWL", angle: -60, elevation: 0, distance: floorDistance, color: colors.frontWideLeft }
const FWR: SpeakerConfig = { id: "FWR", label: "FWR", angle: 60, elevation: 0, distance: floorDistance, color: colors.frontWideRight }

// ===== Height Speakers (wall-mounted, 30° elevation) =====
// Positioned directly ABOVE their corresponding floor speakers

// Front Height Left/Right: ±30° at 30° elevation (above FL/FR)
const FHL: SpeakerConfig = { id: "FHL", label: "FHL", angle: -30, elevation: heightElevation, distance: heightDistance, color: colors.frontHeightLeft }
const FHR: SpeakerConfig = { id: "FHR", label: "FHR", angle: 30, elevation: heightElevation, distance: heightDistance, color: colors.frontHeightRight }

// Surround Height Left/Right: ±110° at 30° elevation (above SL/SR) - used in Auro-3D
const SHL: SpeakerConfig = { id: "SHL", label: "SHL", angle: -110, elevation: heightElevation, distance: heightDistance, color: colors.surroundHeightLeft }
const SHR: SpeakerConfig = { id: "SHR", label: "SHR", angle: 110, elevation: heightElevation, distance: heightDistance, color: colors.surroundHeightRight }

// Rear Height Left/Right: ±150° at 30° elevation (above SBL/SBR)
const RHL: SpeakerConfig = { id: "RHL", label: "RHL", angle: -150, elevation: heightElevation, distance: heightDistance, color: colors.rearHeightLeft }
const RHR: SpeakerConfig = { id: "RHR", label: "RHR", angle: 150, elevation: heightElevation, distance: heightDistance, color: colors.rearHeightRight }

// Center Height: 0° at 30° elevation (above C) - used in Auro-3D
const CH: SpeakerConfig = { id: "CH", label: "CH", angle: 0, elevation: heightElevation, distance: heightDistance, color: colors.centerHeight }

// ===== Top Speakers (ceiling-mounted, 45° elevation) =====
// Dolby Atmos overhead speakers

// Top Front Left/Right: ±45° at 45° elevation
const TFL: SpeakerConfig = { id: "TFL", label: "TFL", angle: -45, elevation: topElevation, distance: topDistance, color: colors.topFrontLeft }
const TFR: SpeakerConfig = { id: "TFR", label: "TFR", angle: 45, elevation: topElevation, distance: topDistance, color: colors.topFrontRight }

// Top Middle Left/Right: ±90° at 45° elevation (above side position)
const TML: SpeakerConfig = { id: "TML", label: "TML", angle: -90, elevation: topElevation, distance: topDistance, color: colors.topMiddleLeft }
const TMR: SpeakerConfig = { id: "TMR", label: "TMR", angle: 90, elevation: topElevation, distance: topDistance, color: colors.topMiddleRight }

// Top Rear Left/Right: ±135° at 45° elevation
const TRL: SpeakerConfig = { id: "TRL", label: "TRL", angle: -135, elevation: topElevation, distance: topDistance, color: colors.topRearLeft }
const TRR: SpeakerConfig = { id: "TRR", label: "TRR", angle: 135, elevation: topElevation, distance: topDistance, color: colors.topRearRight }

// Top Surround: 90° (or 0°) at 45° elevation - single overhead speaker
const TS: SpeakerConfig = { id: "TS", label: "TS", angle: 0, elevation: topElevation, distance: topDistance, color: colors.topSurround }

// ===== Surround Configurations =====
// Based on Denon AVC-A1H manual configurations
// Format: "Total.LFE ch" or "Total.LFE ch (Base.LFE.Height)"

export const surroundConfigs: SurroundConfig[] = [
  // ========== Basic Floor Configurations ==========
  {
    name: "5.1",
    label: "5.1ch",
    speakers: [FL, C, FR, SL, SR],
  },
  {
    name: "7.1",
    label: "7.1ch",
    speakers: [FL, C, FR, SL, SR, SBL, SBR],
  },
  {
    name: "7.1-fw",
    label: "7.1ch (Front Wide)",
    speakers: [FL, C, FR, FWL, FWR, SL, SR],
  },
  {
    name: "9.1",
    label: "9.1ch",
    speakers: [FL, C, FR, FWL, FWR, SL, SR, SBL, SBR],
  },

  // ========== Height Speaker Configurations (Auro-3D style) ==========
  // Height speakers are wall-mounted above their floor counterparts

  // 5.1.2 - Basic 5.1 + Front Height
  {
    name: "5.1.2-height",
    label: "7.1ch (5.1.2) Height",
    speakers: [FL, C, FR, SL, SR, FHL, FHR],
  },

  // 5.1.4 - Basic 5.1 + Front Height + Rear Height
  {
    name: "5.1.4-height",
    label: "9.1ch (5.1.4) Height",
    speakers: [FL, C, FR, SL, SR, FHL, FHR, RHL, RHR],
  },

  // 7.1.2 - 7.1 (with SB) + Front Height
  {
    name: "7.1.2-height",
    label: "9.1ch (7.1.2) Height",
    speakers: [FL, C, FR, SL, SR, SBL, SBR, FHL, FHR],
  },

  // 7.1.4 - 7.1 (with SB) + Front Height + Rear Height
  {
    name: "7.1.4-height",
    label: "11.1ch (7.1.4) Height",
    speakers: [FL, C, FR, SL, SR, SBL, SBR, FHL, FHR, RHL, RHR],
  },

  // 9.1.4 - 9.1 (with FW + SB) + Front Height + Rear Height
  {
    name: "9.1.4-height",
    label: "13.1ch (9.1.4) Height",
    speakers: [FL, C, FR, FWL, FWR, SL, SR, SBL, SBR, FHL, FHR, RHL, RHR],
  },

  // 9.1.6 - 9.1 + Front Height + Top Middle + Rear Height
  {
    name: "9.1.6-height",
    label: "15.1ch (9.1.6) Height",
    speakers: [FL, C, FR, FWL, FWR, SL, SR, SBL, SBR, FHL, FHR, TML, TMR, RHL, RHR],
  },

  // ========== Top Speaker Configurations (Dolby Atmos style) ==========
  // Top speakers are ceiling-mounted overhead

  // 5.1.2 - Basic 5.1 + Top Middle
  {
    name: "5.1.2-top",
    label: "7.1ch (5.1.2) Top",
    speakers: [FL, C, FR, SL, SR, TML, TMR],
  },

  // 5.1.4 - Basic 5.1 + Top Front + Top Rear
  {
    name: "5.1.4-top",
    label: "9.1ch (5.1.4) Top",
    speakers: [FL, C, FR, SL, SR, TFL, TFR, TRL, TRR],
  },

  // 7.1.2 - 7.1 + Top Middle
  {
    name: "7.1.2-top",
    label: "9.1ch (7.1.2) Top",
    speakers: [FL, C, FR, SL, SR, SBL, SBR, TML, TMR],
  },

  // 7.1.4 - 7.1 + Top Front + Top Rear
  {
    name: "7.1.4-top",
    label: "11.1ch (7.1.4) Top",
    speakers: [FL, C, FR, SL, SR, SBL, SBR, TFL, TFR, TRL, TRR],
  },

  // 9.1.4 - 9.1 + Top Front + Top Rear
  {
    name: "9.1.4-top",
    label: "13.1ch (9.1.4) Top",
    speakers: [FL, C, FR, FWL, FWR, SL, SR, SBL, SBR, TFL, TFR, TRL, TRR],
  },

  // 9.1.6 - 9.1 + Top Front + Top Middle + Top Rear
  {
    name: "9.1.6-top",
    label: "15.1ch (9.1.6) Top",
    speakers: [FL, C, FR, FWL, FWR, SL, SR, SBL, SBR, TFL, TFR, TML, TMR, TRL, TRR],
  },

  // ========== Auro-3D Configurations ==========
  // Auro-3D uses Front Height + Surround Height + Center Height/Top Surround

  // Auro-3D 9.1 - 5.1 + Front Height + Surround Height
  {
    name: "auro-9.1",
    label: "9.1ch Auro-3D",
    speakers: [FL, C, FR, SL, SR, FHL, FHR, SHL, SHR],
  },

  // Auro-3D 11.1 - 5.1 + Front Height + Surround Height + Center Height + Top Surround
  {
    name: "auro-11.1",
    label: "11.1ch Auro-3D",
    speakers: [FL, C, FR, SL, SR, FHL, FHR, SHL, SHR, CH, TS],
  },

  // Auro-3D 13.1 - 7.1 + Front Height + Surround Height + Center Height + Top Surround
  {
    name: "auro-13.1",
    label: "13.1ch Auro-3D",
    speakers: [FL, C, FR, SL, SR, SBL, SBR, FHL, FHR, SHL, SHR, CH, TS],
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

// Helper to check if a speaker is a ceiling/height speaker
export const isCeilingSpeaker = (speaker: SpeakerConfig): boolean => {
  return speaker.elevation > 0
}

// Helper to check if a speaker is a "Top" type (ceiling-mounted, high elevation)
export const isTopSpeaker = (speaker: SpeakerConfig): boolean => {
  return speaker.elevation >= 40
}

// Helper to check if a speaker is a "Height" type (wall-mounted, moderate elevation)
export const isHeightSpeaker = (speaker: SpeakerConfig): boolean => {
  return speaker.elevation > 0 && speaker.elevation < 40
}
