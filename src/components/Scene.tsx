import { OrbitControls } from "@react-three/drei";
import {
  getSpeakerRotationY,
  isCeilingSpeaker,
  type SpeakerConfig,
  sphericalToCartesian,
} from "../configs/speakerConfigs";
import { Listener } from "./Listener";
import { Room } from "./Room";
import { SoundObject } from "./SoundObject";
import { Speaker } from "./Speaker";
import { TV } from "./TV";

// Sound object colors
const soundColors = [
  "#ff6b6b",
  "#4ecdc4",
  "#ffe66d",
  "#95e1d3",
  "#f38181",
  "#aa96da",
];

interface SceneProps {
  speakers: SpeakerConfig[];
  soundObjectCount: number;
}

export const Scene = ({ speakers, soundObjectCount }: SceneProps) => {
  // Check if this configuration has ceiling speakers
  const hasCeilingSpeakers = speakers.some((s) => isCeilingSpeaker(s));

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

      {/* TV at front (above center speaker position) */}
      <TV position={[0, 0.7, -2.5]} />

      {/* Listener at center */}
      <Listener />

      {/* Speakers */}
      {speakers.map((speaker) => {
        const position = sphericalToCartesian(
          speaker.angle,
          speaker.elevation,
          speaker.distance
        );
        const rotationY = getSpeakerRotationY(speaker.angle);
        const ceiling = isCeilingSpeaker(speaker);

        return (
          <Speaker
            key={speaker.id}
            position={position}
            rotationY={rotationY}
            label={speaker.label}
            color={speaker.color}
            angle={speaker.angle}
            elevation={speaker.elevation}
            isCeiling={ceiling}
            hasCeilingSpeakers={hasCeilingSpeakers}
          />
        );
      })}

      {/* Sound Objects */}
      {Array.from({ length: soundObjectCount }, (_, i) => (
        <SoundObject
          // biome-ignore lint/suspicious/noArrayIndexKey: The index is the permanent identity of an append-only sound slot.
          key={i}
          id={i}
          color={soundColors[i % soundColors.length]}
        />
      ))}
    </>
  );
};
