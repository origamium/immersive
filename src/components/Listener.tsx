import { Sphere } from "@react-three/drei"

export const Listener = () => {
  return (
    <group position={[0, 0, 0]}>
      {/* Head */}
      <Sphere args={[0.15, 16, 16]} position={[0, 0.15, 0]}>
        <meshStandardMaterial color="#f5c6a5" />
      </Sphere>

      {/* Body */}
      <mesh position={[0, -0.2, 0]}>
        <cylinderGeometry args={[0.12, 0.18, 0.4, 16]} />
        <meshStandardMaterial color="#4a90d9" />
      </mesh>

      {/* Direction indicator (facing forward) */}
      <mesh position={[0, 0.15, 0.2]} rotation={[Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.05, 0.15, 8]} />
        <meshStandardMaterial color="#ff9500" />
      </mesh>
    </group>
  )
}
