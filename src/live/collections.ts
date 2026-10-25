import { definePartyCollection } from 'party-db'
import { createSelectSchema } from 'drizzle-zod'
import type { z } from 'zod'
import { newestPositionFixes } from '../collector/schema'

export const newestPositionFixSchema = createSelectSchema(newestPositionFixes)
export type NewestPositionFix = z.infer<typeof newestPositionFixSchema>

export const newestPositionFixCollection =
  definePartyCollection<NewestPositionFix>({
    name: 'newest_position_fixes',
    key: 'equipment_id',
    schema: newestPositionFixSchema,
    access: { read: 'public' },
  })

export const liveCollections = [newestPositionFixCollection]

export const COLLECTOR_PARTY = 'collector'
export const COLLECTOR_ROOM = 'cat'
