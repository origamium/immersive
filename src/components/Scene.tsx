import { OrbitControls } from "@react-three/drei"
import { Speaker } from "./Speaker"
import { Listener } from "./Listener"
import { Room } from "./Room"
import {
  type SpeakerConfig,
  polarToCartesian,
  getSpeakerRotation,
} from "../configs/speakerConfigs"

interface SceneProps {
  speakers: SpeakerConfig[]
  activeSpeakers: string[]
}

export const Scene = ({ speakers, activeSpeakers }: SceneProps) => {
  return (
    <>
      {/* Lighting */}
      <ambientLight intensity={0.5} />
      <directionalLight position={[5, 10, 5]} intensity={1} castShadow />
      <pointLight position={[-5, 5, -5]} intensity={0.5} />

      {/* Camera controls */}
      <OrbitControls
        enablePan={true}
        enableZoom={true}
        enableRotate={true}
        minDistance={2}
        maxDistance={15}
        maxPolarAngle={Math.PI / 2}
      />

      {/* Room */}
      <Room />

      {/* Listener at center */}
      <Listener />

      {/* Speakers */}
      {speakers.map((speaker) => {
        const [x, z] = polarToCartesian(speaker.angle, speaker.distance)
        const rotation = getSpeakerRotation(speaker.angle)

        return (
          <Speaker
            key={speaker.id}
            position={[x, speaker.height, z]}
            rotation={rotation}
            label={speaker.label}
            color={speaker.color}
            isActive={activeSpeakers.includes(speaker.id)}
          />
        )
      })}
    </>
  )
}
