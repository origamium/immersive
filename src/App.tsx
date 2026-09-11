import { Canvas } from "@react-three/fiber";
import { useCallback, useState } from "react";
import { ControlPanel } from "./components/ControlPanel";
import { Scene } from "./components/Scene";
import { type SurroundConfig, surroundConfigs } from "./configs/speakerConfigs";

export const App = () => {
  const [selectedConfig, setSelectedConfig] = useState<SurroundConfig>(
    surroundConfigs[0]
  );
  const [soundObjectCount, setSoundObjectCount] = useState(1);

  const handleConfigChange = useCallback((config: SurroundConfig) => {
    setSelectedConfig(config);
  }, []);

  const handleSoundObjectCountChange = useCallback((count: number) => {
    setSoundObjectCount(count);
  }, []);

  return (
    <div className="w-screen h-screen relative">
      <Canvas camera={{ position: [0, 6, 6], fov: 50 }} className="bg-gray-900">
        <Scene
          speakers={selectedConfig.speakers}
          soundObjectCount={soundObjectCount}
        />
      </Canvas>

      <ControlPanel
        configs={surroundConfigs}
        selectedConfig={selectedConfig}
        onConfigChange={handleConfigChange}
        soundObjectCount={soundObjectCount}
        onSoundObjectCountChange={handleSoundObjectCountChange}
      />

      <div className="absolute bottom-4 left-4 bg-white/90 p-3 rounded-lg shadow-lg text-sm">
        <p className="text-gray-600">
          Drag to rotate • Scroll to zoom • Right-click to pan
        </p>
      </div>
    </div>
  );
};
