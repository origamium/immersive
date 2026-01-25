import { useRef } from "react"
import { useFrame } from "@react-three/fiber"
import { Sphere, Text } from "@react-three/drei"
import type { Mesh, MeshStandardMaterial, MeshBasicMaterial } from "three"
import { soundPositionStore } from "../stores/soundPositions"

interface SpeakerProps {
  position: [number, number, number]
  rotationY: number // Only Y rotation for facing center
  label: string
  color?: string
  angle: number
  elevation: number
  isCeiling: boolean
  hasCeilingSpeakers: boolean
}

// Calculate intensity for this speaker based on sound positions
// Supports downmixing when ceiling speakers are not available
const calculateIntensity = (
  speakerAngle: number,
  speakerElevation: number,
  isCeiling: boolean,
  hasCeilingSpeakers: boolean,
  soundPositions: [number, number, number][]
): number => {
  if (soundPositions.length === 0) return 0

  let totalIntensity = 0

  for (const [sx, sy, sz] of soundPositions) {
    // Calculate angle and elevation of sound from center
    const horizontalDist = Math.sqrt(sx * sx + sz * sz)
    const soundAngle = (Math.atan2(sx, -sz) * 180) / Math.PI
    const soundElevation = (Math.atan2(sy, horizontalDist) * 180) / Math.PI

    // Calculate 3D distance from center (for amplitude)
    const soundDistance = Math.sqrt(sx * sx + sy * sy + sz * sz)
    const maxDistance = 2.5
    const distanceFactor = Math.min(1, soundDistance / maxDistance)

    // Angular difference (horizontal)
    let angleDiff = soundAngle - speakerAngle
    while (angleDiff > 180) angleDiff -= 360
    while (angleDiff < -180) angleDiff += 360

    // Elevation difference
    const elevationDiff = soundElevation - speakerElevation

    // Spread values for intensity calculation
    const horizontalSpread = 60
    let verticalSpread = 45

    // Downmix: If no ceiling speakers and this is a floor speaker,
    // reduce the impact of elevation difference (sound from above goes to floor speakers)
    if (!hasCeilingSpeakers && !isCeiling) {
      // Widen vertical spread significantly so floor speakers catch elevated sounds
      verticalSpread = 120
    }

    const normalizedAngleDiff = Math.abs(angleDiff) / horizontalSpread
    const normalizedElevationDiff = Math.abs(elevationDiff) / verticalSpread

    // Calculate base intensity from angular proximity
    let angleIntensity = Math.max(0, 1 - Math.sqrt(normalizedAngleDiff ** 2 + normalizedElevationDiff ** 2))

    // Fallback: ensure speakers always have some minimum response
    // based on horizontal angle alone (for when sound is far from all speakers)
    const horizontalOnlyIntensity = Math.max(0, 1 - normalizedAngleDiff)
    const minIntensity = horizontalOnlyIntensity * 0.3 // 30% of horizontal-only calculation

    // Use the higher of the two intensities
    angleIntensity = Math.max(angleIntensity, minIntensity)

    totalIntensity += angleIntensity * distanceFactor
  }

  return Math.min(1, totalIntensity)
}

export const Speaker = ({
  position,
  rotationY,
  label,
  color = "#333333",
  angle,
  elevation,
  isCeiling,
  hasCeilingSpeakers,
}: SpeakerProps) => {
  const meshRef = useRef<Mesh>(null)
  const materialRef = useRef<MeshStandardMaterial>(null)
  const glowRef = useRef<Mesh>(null)
  const glowMaterialRef = useRef<MeshBasicMaterial>(null)

  // Box dimensions: floor = tall, ceiling = flat
  const boxArgs: [number, number, number] = isCeiling
    ? [0.4, 0.1, 0.3]  // Flat for ceiling
    : [0.2, 0.5, 0.15] // Tall for floor (towerboy style)

  // Update material emissive and glow sphere based on intensity
  useFrame(() => {
    const positions = soundPositionStore.getAllPositions()
    const intensity = calculateIntensity(angle, elevation, isCeiling, hasCeilingSpeakers, positions)

    if (materialRef.current) {
      materialRef.current.emissive.setHex(0xff6b6b)
      materialRef.current.emissiveIntensity = intensity * 0.8
    }

    // Update glow sphere scale and opacity
    if (glowRef.current && glowMaterialRef.current) {
      const scale = 0.3 + intensity * 0.7
      glowRef.current.scale.setScalar(scale)
      glowRef.current.visible = intensity > 0.05
      glowMaterialRef.current.opacity = intensity * 0.5
    }
  })

  // Glow sphere position offset
  const glowOffset: [number, number, number] = isCeiling
    ? [0, -0.15, 0]  // Below ceiling speaker
    : [0, 0, 0.15]   // In front of floor speaker

  return (
    <group position={position}>
      {/* Speaker body - rotates to face center, but ceiling stays flat */}
      <group rotation={[0, rotationY, 0]}>
        <mesh ref={meshRef}>
          <boxGeometry args={boxArgs} />
          <meshStandardMaterial ref={materialRef} color={color} />
        </mesh>

        {/* Glow sphere indicating speaker activity */}
        <Sphere ref={glowRef} args={[0.5, 16, 16]} position={glowOffset} visible={false}>
          <meshBasicMaterial
            ref={glowMaterialRef}
            color="#ff6b6b"
            transparent
            opacity={0}
          />
        </Sphere>
      </group>

      {/* Label - always horizontal for readability */}
      <Text
        position={[0, isCeiling ? -0.2 : 0.35, 0]}
        fontSize={0.12}
        color="#ffffff"
        anchorX="center"
        anchorY={isCeiling ? "top" : "bottom"}
        outlineWidth={0.008}
        outlineColor="#000000"
      >
        {label}
      </Text>
    </group>
  )
}
