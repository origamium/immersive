import { useRef, useMemo, useEffect } from "react"
import { useFrame } from "@react-three/fiber"
import { Sphere } from "@react-three/drei"
import type { Mesh } from "three"
import { soundPositionStore } from "../stores/soundPositions"

interface SoundObjectProps {
  id: number
  color: string
}

// Generate random parameters for each sound object's trajectory
const generateTrajectoryParams = (id: number) => {
  const seed = id * 12345
  const random = (offset: number) => {
    const x = Math.sin(seed + offset) * 10000
    return x - Math.floor(x)
  }

  return {
    // Lissajous curve parameters
    freqX: 0.3 + random(1) * 0.4,
    freqZ: 0.2 + random(2) * 0.3,
    phaseX: random(3) * Math.PI * 2,
    phaseZ: random(4) * Math.PI * 2,
    radiusX: 1.2 + random(5) * 1.0,
    radiusZ: 1.2 + random(6) * 1.0,
    // Vertical movement - large enough to reach ceiling speakers
    freqY: 0.15 + random(7) * 0.2,
    phaseY: random(8) * Math.PI * 2,
    baseY: 0.8,
    amplitudeY: 1.0 + random(9) * 0.5,
  }
}

export const SoundObject = ({ id, color }: SoundObjectProps) => {
  const meshRef = useRef<Mesh>(null)
  const params = useMemo(() => generateTrajectoryParams(id), [id])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      soundPositionStore.removePosition(id)
    }
  }, [id])

  useFrame(({ clock }) => {
    if (!meshRef.current) return

    const t = clock.getElapsedTime()

    // Lissajous-like trajectory
    const x = Math.sin(t * params.freqX + params.phaseX) * params.radiusX
    const z = Math.sin(t * params.freqZ + params.phaseZ) * params.radiusZ
    const y = params.baseY + Math.sin(t * params.freqY + params.phaseY) * params.amplitudeY

    // Update mesh position directly (no state)
    meshRef.current.position.set(x, y, z)

    // Store position for speakers to read (no state, just mutable store)
    soundPositionStore.setPosition(id, [x, y, z])
  })

  return (
    <Sphere ref={meshRef} args={[0.15, 16, 16]} position={[0, 0.3, 0]}>
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={0.5}
      />
    </Sphere>
  )
}
