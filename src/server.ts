import handler from '@tanstack/react-start/server-entry'

export { Collector } from './collector/collector'

export default {
  fetch: handler.fetch,
}
