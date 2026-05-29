import type { WarId, DiplomaticPlayId, HoldingId, PolityId, LandContractId } from './ids'
import type { PoliticalActorRef } from './actor'

// v0.34: DiplomaticPlay の escalation を、複数 tick かけて warScore で進行する War entity に置換する。
//   WarCreationSystem → WarProgressSystem → PeaceSettlementSystem → cleanupWarSystem。
//   (spec docs/drafts/spec-v034-update.md §4)

// §4.2 WarStatus
//   white_peace はデッド enum にせず v0.34 で正式に使う:
//     - timeout 終結 (§8.2.1)
//     - WarGoal stale 時の安全終結 (§8.8)
export type WarStatus = 'active' | 'attacker_won' | 'defender_won' | 'white_peace' | 'cancelled'

// §4.3 WarSideKey
export type WarSideKey = 'attacker' | 'defender'

// §4.5 WarParticipant
//   v0.34 では各 side の participants は 1 件・primary=true 固定。
export type WarParticipant = {
  actor: PoliticalActorRef
  joinedWeek: number
  primary: boolean
}

// §4.4 WarSide
export type WarSide = {
  key: WarSideKey
  participants: WarParticipant[]
}

// §4.7 WarGoal
//   和平時に DiplomaticPlay / DiplomaticOffer が cleanup 済みでも実行できるよう、
//   実行に必要な情報をすべてコピーして保持する。
export type WarGoal = TransferLandContractWarGoal | ChangeContractTaxRateWarGoal

// §4.7.1
export type TransferLandContractWarGoal = {
  kind: 'transfer_land_contract'
  holdingId: HoldingId
  // applyLandContractTransferGoal に渡すための明示的な PolityId (PoliticalActorRef ではない)。
  fromPolityId: PolityId
  toPolityId: PolityId
  requiredWarScore: number
}

// §4.7.2
export type ChangeContractTaxRateWarGoal = {
  kind: 'change_contract_tax_rate'
  holdingId: HoldingId
  landContractId: LandContractId
  newTaxRateToGrantor: number
  requiredWarScore: number
}

// §4.6 War
export type War = {
  id: WarId

  /**
   * 履歴用 weak reference。
   * 元 DiplomaticPlay は resolved_by_conflict 化後 cleanup で削除されるため、
   * この ID が state.diplomaticPlays に存在しないことを許容する (§5.1 / §14.6)。
   */
  originDiplomaticPlayId?: DiplomaticPlayId

  status: WarStatus

  attacker: WarSide
  defender: WarSide

  warGoals: WarGoal[]

  /**
   * -100..100 を想定。
   * 正なら attacker 優勢、負なら defender 優勢。
   */
  warScore: number

  /**
   * 決着に必要な絶対値。
   * warScore >= targetWarScore で attacker 勝利。
   * warScore <= -targetWarScore で defender 勝利。
   */
  targetWarScore: number

  startedWeek: number
  endedWeek?: number
}
