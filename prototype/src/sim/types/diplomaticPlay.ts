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

// v0.18 Stage F: land_purchase + land_transfer_demand を land_claim に統合。
//   外交劇は中立な「土地請求」として開始し、交渉プロセスと outcome (補償あり妥協 /
//   補償なし妥協 / 武力奪取) で結果の色を表現する。
//   counterDemand.kind === 'pay_wealth' の amount > 0 で「平和的購入」、なしで「威圧要求」を表現。
export type DiplomaticPlayKind = 'land_claim' | 'contract_tax_revision' | 'revolt_negotiation'

// v0.18 Stage D 更新:
//   'escalated' を ActiveDiplomaticPlayStatus に追加。
//   この status は diplomaticPlaySystem が tension >= escalationThreshold を検出したとき
//   設定する非進行中間状態。同 tick 内の ConflictResolutionSystem が拾い上げ、
//   'resolved_by_conflict' (terminal) に置換する。maxConflictsResolvedPerTick の
//   上限で resolve 漏れがあった場合、'escalated' は次 tick に持ち越される (それでも
//   IntegrityCheck §20 を通る非 terminal 扱い)。
export type ActiveDiplomaticPlayStatus = 'active' | 'escalated'

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

export type DiplomaticDemand =
  | {
      kind: 'transfer_land_contract'
      provinceId: ProvinceId
      toPolityId: PolityId
      beneficiaryActor?: PoliticalActorRef
    }
  | {
      kind: 'change_contract_tax_rate'
      provinceId: ProvinceId
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
