import { useRef } from "react"
import { Cone, Text } from "@react-three/drei"
import type { Mesh } from "three"

interface SpeakerProps {
  position: [number, number, number]
  rotation: [number, number, number]
  label: string
  color?: string
  isActive?: boolean
}

export const Speaker = ({
  position,
  rotation,
  label,
  color = "#333333",
  isActive = false,
}: SpeakerProps) => {
  const meshRef = useRef<Mesh>(null)

  return (
    <group position={position} rotation={rotation}>
      {/* Speaker body */}
      <mesh ref={meshRef}>
        <boxGeometry args={[0.3, 0.5, 0.25]} />
        <meshStandardMaterial color={color} />
      </mesh>

      {/* Speaker cone */}
      <Cone args={[0.1, 0.15, 16]} position={[0, 0.1, 0.13]} rotation={[Math.PI / 2, 0, 0]}>
        <meshStandardMaterial color={isActive ? "#ff6b6b" : "#666666"} />
      </Cone>

      {/* Woofer */}
      <mesh position={[0, -0.1, 0.13]}>
        <circleGeometry args={[0.08, 16]} />
        <meshStandardMaterial color={isActive ? "#ff6b6b" : "#444444"} />
      </mesh>

      {/* Sound wave indicator when active */}
      {isActive && (
        <>
          <mesh position={[0, 0, 0.3]}>
            <ringGeometry args={[0.15, 0.18, 32]} />
            <meshBasicMaterial color="#ff6b6b" transparent opacity={0.6} />
          </mesh>
          <mesh position={[0, 0, 0.45]}>
            <ringGeometry args={[0.25, 0.28, 32]} />
            <meshBasicMaterial color="#ff6b6b" transparent opacity={0.4} />
          </mesh>
          <mesh position={[0, 0, 0.6]}>
            <ringGeometry args={[0.35, 0.38, 32]} />
            <meshBasicMaterial color="#ff6b6b" transparent opacity={0.2} />
          </mesh>
        </>
      )}

      {/* Label */}
      <Text
        position={[0, 0.45, 0]}
        fontSize={0.15}
        color="#ffffff"
        anchorX="center"
        anchorY="bottom"
        outlineWidth={0.01}
        outlineColor="#000000"
      >
        {label}
      </Text>
    </group>
  )
}
