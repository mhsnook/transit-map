import { ClientOnly, createFileRoute } from '@tanstack/react-router'
import { useLiveQuery } from '@tanstack/react-db'
import { useEffect, useState } from 'react'
import { getLiveDb } from '../live/db'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-3xl font-bold">Transit Map</h1>
      <p className="mt-2 text-gray-600">
        Charlottesville Area Transit buses, from each transit vehicle's newest
        position fix. The map comes next.
      </p>
      <ClientOnly fallback={<p className="mt-6">Connecting…</p>}>
        <TransitVehicles />
      </ClientOnly>
    </main>
  )
}

function useNow(intervalMs: number) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
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
            <td>
              {fix.on_schedule == null
                ? ''
                : fix.on_schedule < 0
                  ? `${-fix.on_schedule} min late`
                  : fix.on_schedule > 0
                    ? `${fix.on_schedule} min early`
                    : 'on time'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
