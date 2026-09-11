import { Text } from "@react-three/drei";

interface TVProps {
  position: [number, number, number];
}

export const TV = ({ position }: TVProps) => {
  return (
    <group position={position}>
      {/* TV Screen */}
      <mesh>
        <boxGeometry args={[1.6, 0.9, 0.05]} />
        <meshStandardMaterial color="#1a1a1a" />
      </mesh>

      {/* Screen surface (slightly in front) */}
      <mesh position={[0, 0, 0.026]}>
        <planeGeometry args={[1.5, 0.84]} />
        <meshStandardMaterial
          color="#2a2a3a"
          emissive="#1a1a2a"
          emissiveIntensity={0.3}
        />
      </mesh>

      {/* TV Stand */}
      <mesh position={[0, -0.55, 0.1]}>
        <boxGeometry args={[0.4, 0.1, 0.2]} />
        <meshStandardMaterial color="#333333" />
      </mesh>

      {/* Stand base */}
      <mesh position={[0, -0.62, 0.1]}>
        <boxGeometry args={[0.6, 0.04, 0.25]} />
        <meshStandardMaterial color="#333333" />
      </mesh>

      {/* Label */}
      <Text
        position={[0, 0.6, 0]}
        fontSize={0.12}
        color="#888888"
        anchorX="center"
        anchorY="bottom"
      >
        FRONT
      </Text>
    </group>
  );
};
