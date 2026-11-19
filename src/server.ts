import handler from '@tanstack/react-start/server-entry'
import { getServerByName, routePartykitRequest } from 'partyserver'
import { COLLECTOR_ROOM } from './live/collections'

import { collectorEnabled } from './collector/collector'

export { Collector } from './collector/collector'

export default {
  async fetch(request: Request, env: Env) {
    return (await routePartykitRequest(request, env)) ?? handler.fetch(request)
  },
  // A watchdog: restarts the collector's alarm loop if it ever stops. It
  // checks the var here so a collector that is off is not woken every minute.
  async scheduled(_controller: ScheduledController, env: Env) {
    if (!collectorEnabled(env)) return
    const collector = await getServerByName(env.COLLECTOR, COLLECTOR_ROOM)
    await collector.ensurePolling()
  },
} satisfies ExportedHandler<Env>
