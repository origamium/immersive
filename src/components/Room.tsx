import { Grid } from "@react-three/drei";

export const Room = () => {
  return (
    <group>
      {/* Floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.5, 0]}>
        <planeGeometry args={[8, 8]} />
        <meshStandardMaterial color="#2a2a2a" />
      </mesh>

      {/* Grid for reference */}
      <Grid
        position={[0, -0.49, 0]}
        args={[8, 8]}
        cellSize={0.5}
        cellThickness={0.5}
        cellColor="#444444"
        sectionSize={1}
        sectionThickness={1}
        sectionColor="#666666"
        fadeDistance={10}
        infiniteGrid={false}
      />
    </group>
  );
};
