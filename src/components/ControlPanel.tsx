import type { SurroundConfig } from "../configs/speakerConfigs";
import { isCeilingSpeaker } from "../configs/speakerConfigs";

interface ControlPanelProps {
  configs: SurroundConfig[];
  selectedConfig: SurroundConfig;
  onConfigChange: (config: SurroundConfig) => void;
  soundObjectCount: number;
  onSoundObjectCountChange: (count: number) => void;
}

export const ControlPanel = ({
  configs,
  selectedConfig,
  onConfigChange,
  soundObjectCount,
  onSoundObjectCountChange,
}: ControlPanelProps) => {
  const floorSpeakers = selectedConfig.speakers.filter(
    (s) => !isCeilingSpeaker(s)
  );
  const ceilingSpeakers = selectedConfig.speakers.filter((s) =>
    isCeilingSpeaker(s)
  );

  return (
    <div className="absolute top-4 left-4 bg-white/90 p-4 rounded-lg shadow-lg max-w-xs">
      <h2 className="text-lg font-bold mb-3">Immersive Audio Visualizer</h2>

      {/* Surround Configuration Selector */}
      <div className="mb-4">
        <label
          htmlFor="visualizer-configuration"
          className="block text-sm font-medium text-gray-700 mb-2"
        >
          Configuration
        </label>
        <select
          id="visualizer-configuration"
          value={selectedConfig.name}
          onChange={(e) => {
            const config = configs.find((c) => c.name === e.target.value);
            if (config) onConfigChange(config);
          }}
          className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        >
          {configs.map((config) => (
            <option key={config.name} value={config.name}>
              {config.label}
            </option>
          ))}
        </select>
      </div>

      {/* Sound Object Count Slider */}
      <div className="mb-4">
        <label
          htmlFor="visualizer-object-count"
          className="block text-sm font-medium text-gray-700 mb-2"
        >
          Sound Objects: {soundObjectCount}
        </label>
        <input
          id="visualizer-object-count"
          type="range"
          min="1"
          max="6"
          value={soundObjectCount}
          onChange={(e) => onSoundObjectCountChange(Number(e.target.value))}
          className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
        />
        <div className="flex justify-between text-xs text-gray-500 mt-1">
          <span>1</span>
          <span>6</span>
        </div>
      </div>

      <p className="text-sm text-gray-600 mb-4">
        Sound objects move in random trajectories. Nearby speakers light up
        based on proximity.
      </p>

      {/* Speaker Layout Info */}
      <div className="pt-4 border-t border-gray-200">
        <h3 className="text-sm font-semibold mb-2">
          Floor Speakers ({floorSpeakers.length})
        </h3>
        <div className="grid grid-cols-3 gap-1 text-xs text-gray-600 mb-3">
          {floorSpeakers.map((speaker) => (
            <div key={speaker.id} className="flex items-center gap-1">
              <span
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: speaker.color }}
              />
              <span>{speaker.label}</span>
            </div>
          ))}
        </div>

        {ceilingSpeakers.length > 0 && (
          <>
            <h3 className="text-sm font-semibold mb-2">
              Ceiling Speakers ({ceilingSpeakers.length})
            </h3>
            <div className="grid grid-cols-3 gap-1 text-xs text-gray-600">
              {ceilingSpeakers.map((speaker) => (
                <div key={speaker.id} className="flex items-center gap-1">
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: speaker.color }}
                  />
                  <span>{speaker.label}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
