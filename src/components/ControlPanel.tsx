import type { SpeakerConfig } from "../configs/speakerConfigs"

interface ControlPanelProps {
  speakers: SpeakerConfig[]
  activeSpeakers: string[]
  onToggleSpeaker: (id: string) => void
  onClearAll: () => void
  onSelectAll: () => void
}

export const ControlPanel = ({
  speakers,
  activeSpeakers,
  onToggleSpeaker,
  onClearAll,
  onSelectAll,
}: ControlPanelProps) => {
  return (
    <div className="absolute top-4 left-4 bg-white/90 p-4 rounded-lg shadow-lg max-w-xs">
      <h2 className="text-lg font-bold mb-3">7.0ch Configuration</h2>
      <p className="text-sm text-gray-600 mb-4">
        Click speakers to toggle sound visualization
      </p>

      <div className="grid grid-cols-3 gap-2 mb-4">
        {speakers.map((speaker) => {
          const isActive = activeSpeakers.includes(speaker.id)
          return (
            <button
              key={speaker.id}
              type="button"
              onClick={() => onToggleSpeaker(speaker.id)}
              className="px-3 py-2 rounded text-white text-sm font-medium transition-all"
              style={{
                backgroundColor: isActive ? speaker.color : "#cccccc",
                opacity: isActive ? 1 : 0.6,
              }}
            >
              {speaker.label}
            </button>
          )
        })}
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onSelectAll}
          className="flex-1 px-3 py-2 bg-blue-500 text-white rounded text-sm hover:bg-blue-600"
        >
          All On
        </button>
        <button
          type="button"
          onClick={onClearAll}
          className="flex-1 px-3 py-2 bg-gray-500 text-white rounded text-sm hover:bg-gray-600"
        >
          All Off
        </button>
      </div>

      <div className="mt-4 pt-4 border-t border-gray-200">
        <h3 className="text-sm font-semibold mb-2">Speaker Angles</h3>
        <div className="text-xs text-gray-600 space-y-1">
          {speakers.map((speaker) => (
            <div key={speaker.id} className="flex justify-between">
              <span>{speaker.label}:</span>
              <span>{speaker.angle}°</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
