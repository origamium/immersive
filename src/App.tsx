import { useState, useCallback } from "react"
import { Canvas } from "@react-three/fiber"
import { Scene } from "./components/Scene"
import { ControlPanel } from "./components/ControlPanel"
import { config7ch } from "./configs/speakerConfigs"

export const App = () => {
  const [activeSpeakers, setActiveSpeakers] = useState<string[]>([])

  const handleToggleSpeaker = useCallback((id: string) => {
    setActiveSpeakers((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    )
  }, [])

  const handleClearAll = useCallback(() => {
    setActiveSpeakers([])
  }, [])

  const handleSelectAll = useCallback(() => {
    setActiveSpeakers(config7ch.map((s) => s.id))
  }, [])

  return (
    <div className="w-screen h-screen relative">
      <Canvas
        camera={{ position: [0, 6, 6], fov: 50 }}
        className="bg-gray-900"
        frameloop="demand"
      >
        <Scene speakers={config7ch} activeSpeakers={activeSpeakers} />
      </Canvas>

      <ControlPanel
        speakers={config7ch}
        activeSpeakers={activeSpeakers}
        onToggleSpeaker={handleToggleSpeaker}
        onClearAll={handleClearAll}
        onSelectAll={handleSelectAll}
      />

      <div className="absolute bottom-4 left-4 bg-white/90 p-3 rounded-lg shadow-lg text-sm">
        <p className="text-gray-600">
          Drag to rotate • Scroll to zoom • Right-click to pan
        </p>
      </div>
    </div>
  )
}
