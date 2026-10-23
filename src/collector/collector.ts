import { DurableObject } from 'cloudflare:workers'

export class Collector extends DurableObject<Env> {
  async hello(): Promise<string> {
    return 'Collector is alive'
  }
}
