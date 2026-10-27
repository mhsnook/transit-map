import { ClientOnly, createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { Drawer } from 'vaul'
import { z } from 'zod'
import { InfoPanel } from '../components/InfoPanel'
import { TransitMap } from '../components/TransitMap'
import { HoveredStopProvider } from '../lib/hovered-stop'
import { getStopHistory, getStopSchedule } from '../lib/stop-details'
import { useMediaQuery } from '../lib/use-media-query'

export const Route = createFileRoute('/')({
  // Bus stop and equipment ids are numeric strings; a number keeps the URL as
  // ?stop=16583 rather than ?stop=%2216583%22.
  validateSearch: z.object({
    stop: z.number().int().optional(),
    history: z.boolean().optional(),
    bus: z.union([z.number().int(), z.string()]).optional(),
  }),
  loaderDeps: ({ search }) => ({ stop: search.stop }),
  // Not awaited, so the bus stop opens on its live arrival predictions while
  // these load. History loads whether or not it is shown, so showing it
  // doesn't wait.
  loader: ({ deps }) => {
    if (deps.stop == null) return { schedule: null, history: null }
    const data = { stopId: String(deps.stop) }
    return { schedule: getStopSchedule({ data }), history: getStopHistory({ data }) }
  },
  staleTime: 5 * 60_000,
  component: Home,
})

const TITLE_CLASS = 'text-base font-bold tracking-tight'
const SNAP_PEEK = '164px'
const SNAP_HALF = 0.55
const SNAP_FULL = 0.94

function Home() {
  return (
    <main className="h-dvh w-full overflow-hidden bg-gray-100">
      <ClientOnly fallback={<p className="p-6 text-sm text-gray-500">Loading the map…</p>}>
        <HoveredStopProvider>
          <TransitApp />
        </HoveredStopProvider>
      </ClientOnly>
    </main>
  )
}

function TransitApp() {
  const [selectedRoute, setSelectedRoute] = useState<number | null>(null)
  const isDesktop = useMediaQuery('(min-width: 1024px)')
  const search = Route.useSearch()
  const [snap, setSnap] = useState<number | string | null>(
    search.stop == null && search.bus == null ? SNAP_PEEK : SNAP_HALF,
  )
  const navigate = Route.useNavigate()
  const selectedStop = search.stop == null ? null : String(search.stop)
  const selectedBus = search.bus == null ? null : String(search.bus)

  const selectRoute = (routeId: number | null) => {
    setSelectedRoute(routeId)
    if (routeId != null && (selectedStop != null || selectedBus != null)) {
      navigate({ search: (prev) => ({ ...prev, stop: undefined, history: undefined, bus: undefined }) })
    }
    if (!isDesktop) setSnap(routeId == null ? SNAP_PEEK : SNAP_HALF)
  }

  const selectBus = (equipmentId: string | null) => {
    navigate({
      search: (prev) => ({
        ...prev,
        stop: undefined,
        history: undefined,
        bus: equipmentId == null ? undefined : /^\d+$/.test(equipmentId) ? Number(equipmentId) : equipmentId,
      }),
    })
    if (!isDesktop && equipmentId != null) setSnap(SNAP_HALF)
  }

  // A bus stop opened from a bus keeps `bus`, so closing the bus stop goes back to it.
  const selectStop = (stopId: string | null) => {
    navigate({
      search: (prev) =>
        stopId == null ? { ...prev, stop: undefined, history: undefined } : { ...prev, stop: Number(stopId) },
    })
    if (!isDesktop && stopId != null) setSnap(SNAP_HALF)
  }

  const panel = (title: React.ReactNode) => (
    <InfoPanel
      selectedRoute={selectedRoute}
      onSelectRoute={selectRoute}
      selectedStop={selectedStop}
      onSelectStop={selectStop}
      selectedBus={selectedBus}
      onSelectBus={selectBus}
      title={title}
    />
  )

  const map = (
    <TransitMap
      selectedRoute={selectedRoute}
      onSelectRoute={selectRoute}
      selectedStop={selectedStop}
      onSelectStop={selectStop}
      selectedBus={selectedBus}
      onSelectBus={selectBus}
      fitPadding={
        isDesktop
          ? { top: 48, bottom: 48, left: 48, right: 48 }
          : { top: 32, left: 24, right: 24, bottom: Math.round(window.innerHeight * SNAP_HALF) + 16 }
      }
    />
  )

  if (isDesktop) {
    return (
      <div className="flex h-full">
        <div className="relative min-w-0 flex-1">{map}</div>
        <aside className="flex h-full w-[400px] shrink-0 flex-col border-l border-gray-200 bg-white pt-4">
          {panel(<h1 className={TITLE_CLASS}>Charlottesville buses</h1>)}
        </aside>
      </div>
    )
  }

  return (
    <div className="relative h-full">
      {map}
      <Drawer.Root
        open
        modal={false}
        dismissible={false}
        snapPoints={[SNAP_PEEK, SNAP_HALF, SNAP_FULL]}
        activeSnapPoint={snap}
        setActiveSnapPoint={setSnap}
      >
        <Drawer.Portal>
          <Drawer.Content
            aria-describedby={undefined}
            className="fixed inset-x-0 bottom-0 z-20 flex h-[94dvh] flex-col rounded-t-2xl bg-white shadow-[0_-4px_24px_rgba(0,0,0,0.12)] outline-none"
          >
            <Drawer.Handle className="mt-2 mb-2" />
            {panel(<Drawer.Title className={TITLE_CLASS}>Charlottesville buses</Drawer.Title>)}
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    </div>
  )
}
