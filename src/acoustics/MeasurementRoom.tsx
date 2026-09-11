import { Html, OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import type { RoomModel } from "./types";

export default function MeasurementRoom({
  room,
  selected,
}: {
  room: RoomModel;
  selected: string;
}) {
  return (
    <div
      className="room-view"
      role="img"
      aria-label="登録した座標による部屋の3D表示"
    >
      <Canvas camera={{ position: [7, 6, 9], fov: 45 }} frameloop="demand">
        <ambientLight intensity={1.2} />
        <directionalLight position={[5, 8, 4]} />
        <mesh position={[0, room.height / 2, 0]}>
          <boxGeometry args={[room.width, room.height, room.depth]} />
          <meshBasicMaterial color="#37615c" wireframe />
        </mesh>
        <gridHelper
          args={[Math.max(room.width, room.depth), 12, "#31554f", "#223632"]}
        />
        {room.speakers.map((s) => (
          <mesh key={s.id} position={s.position}>
            <sphereGeometry args={[s.id === selected ? 0.13 : 0.09, 16, 16]} />
            <meshStandardMaterial
              color={
                s.id === selected
                  ? "#62e3c3"
                  : s.inputChannel === null
                    ? "#ffb86b"
                    : "#8fa3b0"
              }
            />
            <Html distanceFactor={10} position={[0, 0.25, 0]} center>
              <span className="speaker-label">{s.id}</span>
            </Html>
          </mesh>
        ))}
        <mesh position={room.listener}>
          <sphereGeometry args={[0.13, 16, 16]} />
          <meshStandardMaterial color="#a3b5ff" />
          <Html distanceFactor={10} position={[0, 0.3, 0]} center>
            <span className="speaker-label">LISTENER</span>
          </Html>
        </mesh>
        <OrbitControls makeDefault minDistance={2} maxDistance={20} />
      </Canvas>
    </div>
  );
}
