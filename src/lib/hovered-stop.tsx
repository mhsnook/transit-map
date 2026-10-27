import { createContext, useContext, useState } from 'react'

type HoveredStop = { stopId: string | null; setStopId: (stopId: string | null) => void }

const HoveredStopContext = createContext<HoveredStop>({ stopId: null, setStopId: () => {} })

// The bus stop under the pointer, on the map or in a list, so the other one
// can highlight it.
export function HoveredStopProvider({ children }: { children: React.ReactNode }) {
  const [stopId, setStopId] = useState<string | null>(null)
  return <HoveredStopContext.Provider value={{ stopId, setStopId }}>{children}</HoveredStopContext.Provider>
}

export function useHoveredStop() {
  return useContext(HoveredStopContext)
}

// Props for a list row naming a bus stop.
export function useStopHover(stopId: string) {
  const { stopId: hovered, setStopId } = useHoveredStop()
  return {
    highlighted: hovered === stopId,
    onPointerEnter: () => setStopId(stopId),
    onPointerLeave: () => setStopId(null),
  }
}
