// Global store for sound positions using refs (no React state)
// This allows useFrame to update positions without triggering re-renders

type SoundPosition = [number, number, number]

class SoundPositionStore {
  private positions: Map<number, SoundPosition> = new Map()

  setPosition(id: number, position: SoundPosition) {
    this.positions.set(id, position)
  }

  getPosition(id: number): SoundPosition | undefined {
    return this.positions.get(id)
  }

  getAllPositions(): SoundPosition[] {
    return Array.from(this.positions.values())
  }

  clear() {
    this.positions.clear()
  }

  removePosition(id: number) {
    this.positions.delete(id)
  }
}

export const soundPositionStore = new SoundPositionStore()
