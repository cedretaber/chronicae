import type { ActorIntentId, ProvinceId, PolityId, LandContractId } from './ids'
import type { PoliticalActorRef } from './actor'

// v0.18 Stage A §6.2 / §6.3

export type ActiveActorIntentStatus = 'active'

export type TerminalActorIntentStatus = 'converted' | 'expired' | 'cancelled'

export type ActorIntentStatus = ActiveActorIntentStatus | TerminalActorIntentStatus

export const TERMINAL_ACTOR_INTENT_STATUSES: ReadonlyArray<TerminalActorIntentStatus> = [
  'converted',
  'expired',
  'cancelled',
]

export type ActorIntentKind =
  | 'acquire_land'
  | 'sell_land'
  | 'improve_contract_terms'
  | 'demand_tax_increase'
  | 'suppress_unrest'
  | 'revolt'

export type IntentRationale =
  | 'expand_territory'
  | 'secure_border'
  | 'raise_revenue'
  | 'reduce_tribute'
  | 'increase_tribute'
  | 'weaken_rival'
  | 'recover_lost_land'
  | 'pacify_unrest'
  | 'popular_grievance'

export type ActorIntent = {
  id: ActorIntentId
  actor: PoliticalActorRef
  kind: ActorIntentKind

  targetActor?: PoliticalActorRef
  targetProvinceId?: ProvinceId
  targetLandContractId?: LandContractId

  // House actor の場合、この Polity に土地を編入する。
  // v0.18 では House actor の Intent 生成自体が無効化されているため、現状は未使用 (将来用)。
  beneficiaryPolityId?: PolityId

  priority: number
  rationale: IntentRationale

  status: ActorIntentStatus

  createdWeek: number
  expiresWeek: number
}
