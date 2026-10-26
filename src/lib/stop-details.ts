import { createServerFn } from '@tanstack/react-start'
import { env } from 'cloudflare:workers'
import { getServerByName } from 'partyserver'
import { z } from 'zod'
import type { ScheduledStop } from '../collector/schedule'
import type { ScheduledCallHistory } from '../collector/stop-details'
import { COLLECTOR_ROOM } from '../live/collections'

const stopInput = z.object({ stopId: z.string() })

const collector = () => getServerByName(env.COLLECTOR, COLLECTOR_ROOM)

// The return types are restated because RPC results are typed as Disposable
// stubs, which server functions refuse to serialize; these are plain data.

export const getStopSchedule = createServerFn({ method: 'GET' })
  .validator(stopInput)
  .handler(async ({ data }): Promise<ScheduledStop[]> => {
    const rows: ScheduledStop[] = await (await collector()).stopSchedule(data.stopId)
    return rows
  })

export const getStopHistory = createServerFn({ method: 'GET' })
  .validator(stopInput)
  .handler(async ({ data }): Promise<ScheduledCallHistory[]> => {
    const calls: ScheduledCallHistory[] = await (await collector()).stopHistory(data.stopId)
    return calls
  })
