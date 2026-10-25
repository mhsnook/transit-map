import handler from '@tanstack/react-start/server-entry'
import { getServerByName, routePartykitRequest } from 'partyserver'
import { COLLECTOR_ROOM } from './live/collections'

export { Collector } from './collector/collector'

export default {
  async fetch(request: Request, env: Env) {
    return (await routePartykitRequest(request, env)) ?? handler.fetch(request)
  },
  // A watchdog: restarts the collector's alarm loop if it ever stops.
  async scheduled(_controller: ScheduledController, env: Env) {
    const collector = await getServerByName(env.COLLECTOR, COLLECTOR_ROOM)
    await collector.ensurePolling()
  },
} satisfies ExportedHandler<Env>
