import type { WarId, DiplomaticPlayId, HoldingId, PolityId, LandContractId, PersonId } from './ids'
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
//   v0.35: 「誰が指揮するか」を side に持たせる。captainGeneral / commander は soft reference
//     (WarManeuver が毎週 lazy 再選出するため、participant のような hard invariant にはしない。§13)。
export type WarSide = {
  key: WarSideKey
  participants: WarParticipant[]

  // v0.35: この side 全体の総大将。soft reference。
  //   不在 (undefined) を許容し、WarManeuverSystem が毎週 lazy 選出/再選出する。
  captainGeneralPersonId?: PersonId

  // v0.35: 現場指揮官候補。soft reference。WarManeuver が毎週 lazy 再構築する。
  commanderPersonIds: PersonId[]

  // v0.35: この side が「戦闘回避を選択した」累積回数。単調増加 (reset しない)。
  avoidanceCount: number
}

// §6.1 BattlefieldKind
//   想定戦場の地形種別。Province.terrain を基本に features で特殊化する (§6.3)。
//   siege は型のみ用意し v0.35 では生成しない (要塞・包囲・占領が未実装のため future)。
export type BattlefieldKind =
  | 'open_field'
  | 'forest_battle'
  | 'hill_battle'
  | 'mountain_pass'
  | 'wetland_battle'
  | 'river_crossing'
  | 'coastal_battle'
  | 'siege'

// §10.5 BattleResult
export type BattleResult = 'attacker_victory' | 'defender_victory' | 'inconclusive'

// §11.1 BattleInitiationKind — Battle がどう発生したか (BATTLE_OCCURRED event に記録)。
export type BattleInitiationKind =
  | 'mutual_engagement'
  | 'attacker_avoidance_failed'
  | 'defender_avoidance_failed'

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
  // v0.34: 開戦時に凍結する「戦争前の税率」(0..1)。歴史記述用に before→after を語れるようにするための baseline。
  //   live な landContracts[...].terms.taxRateToGrantor とは意図的に乖離し得る
  //   (和平で newTaxRateToGrantor が適用されると現税率がこの値から target へ動くため)。
  //   integrity は 0..1 の range のみ検査し、live rate との一致は検査しない (§14.5)。
  baseTaxRateToGrantor: number
  newTaxRateToGrantor: number
  requiredWarScore: number
}

// v0.39: 民衆叛乱独立 WarGoal。Phase A では standalone export のみ。
//   Phase B で WarGoal union に追加しハンドラを実装する。
export type PopularRevoltIndependenceWarGoal = {
  kind: 'popular_revolt_independence'
  commonwealthPolityId: PolityId
  originalHolderPolityId: PolityId
  holdingIds: HoldingId[]
  revoltSeizureContractIds: LandContractId[]
  leaderPersonId: PersonId
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
