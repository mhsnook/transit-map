import type { BusRoute } from '../live/collections'

export function RouteChip({ route, size = 'sm' }: { route: BusRoute | undefined; size?: 'sm' | 'xs' }) {
  return (
    <span
      title={route?.name}
      className={`grid shrink-0 place-items-center rounded-full font-semibold text-white ${
        size === 'sm' ? 'size-7 text-xs' : 'size-5 text-[10px]'
      }`}
      style={{ background: route?.color ?? '#555' }}
    >
      {route?.short_name ?? '?'}
    </span>
  )
}
