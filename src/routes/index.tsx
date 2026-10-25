import { ClientOnly, createFileRoute } from '@tanstack/react-router'
import { useLiveQuery } from '@tanstack/react-db'
import { TransitMap } from '../components/TransitMap'
import { useNow } from '../lib/use-now'
import { getLiveDb } from '../live/db'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  return (
    <main className="mx-auto max-w-5xl p-4 sm:p-8">
      <h1 className="text-3xl font-bold">Transit Map</h1>
      <p className="mt-2 mb-4 text-gray-600">
        Charlottesville Area Transit buses at each transit vehicle's newest
        position fix. The label is the fix's age.
      </p>
      <ClientOnly fallback={<p className="mt-6">Connecting…</p>}>
        <TransitMap />
        <TransitVehicles />
      </ClientOnly>
    </main>
  )
}

function scheduleLabel(minutes: number | null) {
  if (minutes == null) return ''
  if (minutes === 0) return 'on time'
  return minutes < 0 ? `${-minutes} min late` : `${minutes} min early`
}

function TransitVehicles() {
  const { newestPositionFixes } = getLiveDb()
  const { data: fixes } = useLiveQuery((q) =>
    q
      .from({ fix: newestPositionFixes })
      .orderBy(({ fix }) => fix.route_id)
      .orderBy(({ fix }) => fix.equipment_id),
  )
  const now = useNow(1000)

  if (fixes.length === 0) {
    return <p className="mt-6">No transit vehicles in service right now.</p>
  }
  return (
    <table className="mt-6 w-full text-left text-sm">
      <thead>
        <tr className="border-b">
          <th className="py-1">Vehicle</th>
          <th>Route</th>
          <th>Fix age</th>
          <th>At stop</th>
          <th>Schedule</th>
        </tr>
      </thead>
      <tbody className="font-mono">
        {fixes.map((fix) => (
          <tr key={fix.equipment_id} className="border-b border-gray-100">
            <td className="py-1">{fix.equipment_id}</td>
            <td>{fix.route_id}</td>
            <td>{Math.round((now - fix.fix_time) / 1000)} s</td>
            <td>{fix.at_stop ? 'yes' : ''}</td>
            <td>{scheduleLabel(fix.on_schedule)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
