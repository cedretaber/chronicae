import type {
  DiplomaticPlayId,
  ActorIntentId,
  ProvinceId,
  PolityId,
  LandContractId,
  PopGroupId,
} from './ids'
import type { PoliticalActorRef } from './actor'

// v0.18 Stage A §6.4 / §6.5

export type DiplomaticPlayKind =
  | 'land_purchase'
  | 'land_transfer_demand'
  | 'contract_tax_revision'
  | 'revolt_negotiation'

export type ActiveDiplomaticPlayStatus = 'active'

export type TerminalDiplomaticPlayStatus =
  | 'settled'
  | 'failed'
  | 'resolved_by_conflict'
  | 'cancelled'

export type DiplomaticPlayStatus = ActiveDiplomaticPlayStatus | TerminalDiplomaticPlayStatus

export const TERMINAL_DIPLOMATIC_PLAY_STATUSES: ReadonlyArray<TerminalDiplomaticPlayStatus> = [
  'settled',
  'failed',
  'resolved_by_conflict',
  'cancelled',
]

// 注: status === 'escalated' は §10.2 で言及される中間状態だが、それは
// ConflictResolution に渡す直前の一時状態として扱い、Record 上では
// 'resolved_by_conflict' に置換されることを想定。型 union には含めない。

export type DiplomaticDemand =
  | {
      kind: 'transfer_land_contract'
      provinceId: ProvinceId
      toPolityId: PolityId
      beneficiaryActor?: PoliticalActorRef
    }
  | {
      kind: 'change_contract_tax_rate'
      landContractId: LandContractId
      newTaxRateToGrantor: number
    }
  | {
      kind: 'pay_wealth'
      from: PoliticalActorRef
      to: PoliticalActorRef
      amount: number
    }
  | {
      kind: 'revolt_concession'
      provinceId: ProvinceId
      popGroupId: PopGroupId
      concessionLevel: 'minor' | 'major'
    }
  | { kind: 'status_quo' }

export type DiplomaticPlay = {
  id: DiplomaticPlayId
  kind: DiplomaticPlayKind

  initiator: PoliticalActorRef
  target: PoliticalActorRef

  originIntentId?: ActorIntentId

  primaryDemand: DiplomaticDemand
  counterDemand?: DiplomaticDemand

  status: DiplomaticPlayStatus

  startedYear: number
  startedMonth: number
  deadlineYear: number
  deadlineMonth: number

  progress: number // 0..100
  tension: number // 0..100
}
