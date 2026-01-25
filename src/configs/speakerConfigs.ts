export interface SpeakerConfig {
  id: string
  label: string
  angle: number // degrees from front center
  distance: number // distance from listener
  height: number // height from floor
  color: string
}

// 7.0ch configuration (floor level only)
// Based on ITU-R BS.775-3 and Dolby guidelines
export const config7ch: SpeakerConfig[] = [
  {
    id: "FL",
    label: "FL",
    angle: -30,
    distance: 2.5,
    height: 0,
    color: "#e74c3c", // Red
  },
  {
    id: "FC",
    label: "C",
    angle: 0,
    distance: 2.5,
    height: 0,
    color: "#2ecc71", // Green
  },
  {
    id: "FR",
    label: "FR",
    angle: 30,
    distance: 2.5,
    height: 0,
    color: "#3498db", // Blue
  },
  {
    id: "SL",
    label: "SL",
    angle: -90,
    distance: 2.5,
    height: 0,
    color: "#9b59b6", // Purple
  },
  {
    id: "SR",
    label: "SR",
    angle: 90,
    distance: 2.5,
    height: 0,
    color: "#e67e22", // Orange
  },
  {
    id: "RL",
    label: "RL",
    angle: -150,
    distance: 2.5,
    height: 0,
    color: "#1abc9c", // Teal
  },
  {
    id: "RR",
    label: "RR",
    angle: 150,
    distance: 2.5,
    height: 0,
    color: "#f1c40f", // Yellow
  },
]

// Convert polar coordinates (angle, distance) to Cartesian (x, z)
export const polarToCartesian = (
  angleDegrees: number,
  distance: number
): [number, number] => {
  const angleRadians = (angleDegrees * Math.PI) / 180
  const x = distance * Math.sin(angleRadians)
  const z = -distance * Math.cos(angleRadians) // negative because forward is -Z in Three.js
  return [x, z]
}

// Calculate speaker rotation to face the center (listener position)
export const getSpeakerRotation = (angleDegrees: number): [number, number, number] => {
  // Speaker faces toward center: rotate by negative of its position angle
  const angleRadians = (-angleDegrees * Math.PI) / 180
  return [0, angleRadians, 0]
}
