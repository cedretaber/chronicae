// v0.38 Chronicle System — read-only historical archive types (see docs/drafts/spec-v038-update.md)
import type { ChronicleEntryId, PersonId, EventId } from './ids'
import type { EventType, EventImportance, EventMessageParams, EventEntityRef } from './event'

export type ChronicleCategory =
  | 'war'
  | 'battle'
  // v0.43: 外交 (支援宣言など War 化前の外交劇イベント)
  | 'diplomacy'
  | 'land'
  | 'house'
  | 'office'
  | 'faction'
  | 'revolt'
  | 'life'
  | 'development'
  | 'governance'
  | 'disaster'

export type BattleChronicleContext = {
  kind: 'battle'
  outnumberedVictory?: boolean
  decisiveVictory?: boolean
  commanderContributionSide?: 'attacker' | 'defender'
  decisiveCommanderId?: PersonId
  warScoreDelta?: number
}

export type ChronicleContext = BattleChronicleContext

export type ChronicleEntry = {
  id: ChronicleEntryId
  year: number
  weekOfYear: number
  category: ChronicleCategory
  importance: EventImportance
  sourceEventId: EventId
  sourceEventType: EventType
  templateKey: string
  params: EventMessageParams
  entityRefs: EventEntityRef[]
  context?: ChronicleContext
}

export type CreateChronicleEntryInput = {
  year: number
  weekOfYear: number
  category: ChronicleCategory
  importance: EventImportance
  sourceEventId: EventId
  sourceEventType: EventType
  templateKey: string
  params: EventMessageParams
  entityRefs: EventEntityRef[]
  context?: ChronicleContext
}

export type ChronicleIndex = {
  byPerson: Record<string, ChronicleEntryId[]>
  byHouse: Record<string, ChronicleEntryId[]>
  byPolity: Record<string, ChronicleEntryId[]>
  byProvince: Record<string, ChronicleEntryId[]>
  byHolding: Record<string, ChronicleEntryId[]>
}
