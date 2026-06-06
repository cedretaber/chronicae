import type { WorldState } from '../types/world'
import type {
  War,
  WarGoal,
  WarParticipant,
  WarSide,
  WarSideKey,
  PopularRevoltIndependenceWarGoal,
} from '../types/war'
import type { WarId, DiplomaticPlayId, HoldingId, PolityId, ProvinceId } from '../types/ids'
import type { OrganizationRef } from '../types/office'
import type { DiplomaticPlay } from '../types/diplomaticPlay'
import { createWarId } from '../types/ids'
import { politicalActorKey } from '../selectors/actorSelectors'
import { getHoldingTerminalPolityId } from '../selectors/landContractSelectors'

// v0.34: War entity の生成・index 管理・参照 helper。
//   projectMutations の add/removeProjectToIndexMut パターン (空配列は delete で purge) に倣う。
//   Phase A 時点では tick から呼ばれない (War は生成されない)。配線は Phase B。

// --- index ---

// byParticipant に attacker / defender 双方の participant を登録、
// originDiplomaticPlayId があれば byOriginDiplomaticPlay に登録する。
export function addWarToIndexMut(ws: WorldState, war: War): void {
  for (const side of [war.attacker, war.defender]) {
    for (const p of side.participants) {
      const key = politicalActorKey(p.actor)
      ws.warIndex.byParticipant[key] = [...(ws.warIndex.byParticipant[key] ?? []), war.id]
    }
  }
  if (war.originDiplomaticPlayId !== undefined) {
    ws.warIndex.byOriginDiplomaticPlay[war.originDiplomaticPlayId] = war.id
  }
}

export function removeWarFromIndexMut(ws: WorldState, war: War): void {
  for (const side of [war.attacker, war.defender]) {
    for (const p of side.participants) {
      const key = politicalActorKey(p.actor)
      const ids = ws.warIndex.byParticipant[key]
      if (!ids) continue
      const filtered = ids.filter((id) => (id as string) !== (war.id as string))
      if (filtered.length > 0) {
        ws.warIndex.byParticipant[key] = filtered
      } else {
        delete ws.warIndex.byParticipant[key]
      }
    }
  }
  if (war.originDiplomaticPlayId !== undefined) {
    delete ws.warIndex.byOriginDiplomaticPlay[war.originDiplomaticPlayId]
  }
}

// --- creation ---

// v0.43: War 生成時に各 side へ追加する supporter (primary 以外の participant) の入力。
//   contributionScore は §5.1a の前方宣言 — v0.43 では呼び出し側が渡さず常に undefined。
export type WarSupporterInput = {
  actor: OrganizationRef
  contributionScore?: number
}

export type CreateWarInput = {
  attacker: OrganizationRef
  defender: OrganizationRef
  warGoals: WarGoal[]
  targetWarScore: number
  startedWeek: number
  originDiplomaticPlayId?: DiplomaticPlayId
  // v0.43: 各 side の supporters (省略 = 空)。重複・active 検査は呼び出し側 (copy filter §10.3a) の責務。
  attackerSupporters?: WarSupporterInput[]
  defenderSupporters?: WarSupporterInput[]
}

// supporter 入力 → WarParticipant (primary: false)。
//   exactOptionalPropertyTypes: contributionScore は条件 spread (undefined を明示代入しない)。
function toSupporterParticipant(input: WarSupporterInput, startedWeek: number): WarParticipant {
  return {
    actor: input.actor,
    joinedWeek: startedWeek,
    primary: false,
    ...(input.contributionScore !== undefined
      ? { contributionScore: input.contributionScore }
      : {}),
  }
}

// War を生成し、records / counter / index をすべて更新する単一エントリ。
//   diplomaticPlayCreation (createId(ws.nextId) -> ws.records[id]=v -> ws.nextId++) に倣う。
export function createWar(ws: WorldState, input: CreateWarInput): War {
  const id = createWarId(ws.nextWarId)
  const war: War = {
    id,
    status: 'active',
    attacker: {
      key: 'attacker',
      // v0.43: primary + supporters。primary が先頭 (object 形は v0.34 から不変)。
      participants: [
        { actor: input.attacker, joinedWeek: input.startedWeek, primary: true },
        ...(input.attackerSupporters ?? []).map((s) =>
          toSupporterParticipant(s, input.startedWeek),
        ),
      ],
      // v0.35: 総大将/指揮官は WarManeuver が lazy 選出するため生成時は空。
      commanderPersonIds: [],
      avoidanceCount: 0,
    },
    defender: {
      key: 'defender',
      participants: [
        { actor: input.defender, joinedWeek: input.startedWeek, primary: true },
        ...(input.defenderSupporters ?? []).map((s) =>
          toSupporterParticipant(s, input.startedWeek),
        ),
      ],
      commanderPersonIds: [],
      avoidanceCount: 0,
    },
    warGoals: input.warGoals,
    warScore: 0,
    targetWarScore: input.targetWarScore,
    startedWeek: input.startedWeek,
    // exactOptionalPropertyTypes: undefined を明示代入しないよう条件 spread。
    ...(input.originDiplomaticPlayId !== undefined
      ? { originDiplomaticPlayId: input.originDiplomaticPlayId }
      : {}),
  }
  ws.wars[id] = war
  ws.nextWarId++
  addWarToIndexMut(ws, war)
  return war
}

// v0.43 §11.2 / §15.3: supporter participant を War から除去し byParticipant index も更新する。
//   primary は除去しない (reject = false 返却)。primary inactive は War cancel 経路 (§15.2) の責務。
//   呼び出し側は ws.wars / ws.warIndex.byParticipant を clone 済みの mutable draft であること。
export function removeWarParticipantMut(
  ws: WorldState,
  warId: WarId,
  actor: OrganizationRef,
): boolean {
  const war = ws.wars[warId]
  if (!war) return false
  const key = politicalActorKey(actor)
  for (const sideKey of ['attacker', 'defender'] as const) {
    const side = war[sideKey]
    const idx = side.participants.findIndex((p) => politicalActorKey(p.actor) === key)
    if (idx === -1) continue
    if (side.participants[idx]!.primary) return false
    const participants = side.participants.filter((_, i) => i !== idx)
    ws.wars[warId] = { ...war, [sideKey]: { ...side, participants } }
    const ids = ws.warIndex.byParticipant[key]
    if (ids) {
      const filtered = ids.filter((id) => (id as string) !== (warId as string))
      if (filtered.length > 0) {
        ws.warIndex.byParticipant[key] = filtered
      } else {
        delete ws.warIndex.byParticipant[key]
      }
    }
    return true
  }
  return false
}

// status / warScore / endedWeek 等の更新用。participant は v0.34 では不変なので index 再構築は不要。
export function updateWar(ws: WorldState, warId: WarId, patch: Partial<War>): void {
  const war = ws.wars[warId]
  if (!war) return
  ws.wars[warId] = { ...war, ...patch }
}

// v0.35: 指定 side の captainGeneral / commander / avoidanceCount 等を更新する。
//   updateWar と同規約の mutating / void。WarManeuverSystem が clone-once → mutate-in-loop で使う。
//   participants は更新しない (war index に影響しないので index 再構築不要)。
export function updateWarSideMut(
  ws: WorldState,
  warId: WarId,
  sideKey: WarSideKey,
  patch: Partial<WarSide>,
): void {
  const war = ws.wars[warId]
  if (!war) return
  const side = sideKey === 'attacker' ? war.attacker : war.defender
  updateWar(ws, warId, { [sideKey]: { ...side, ...patch } })
}

// --- accessors ---

export function getWarPrimaryAttacker(war: War): WarParticipant | undefined {
  return war.attacker.participants.find((p) => p.primary)
}

export function getWarPrimaryDefender(war: War): WarParticipant | undefined {
  return war.defender.participants.find((p) => p.primary)
}

// --- WarGoal 変換 (純関数) ---

// DiplomaticPlay.issue から WarGoal を 1 件構築する (spec §6.4-6.6)。
//   offer / currentOfferId / primaryDemand は使わない。issue だけで完全再構築する。
//   requiredWarScore は呼び出し側 (Phase B の WarCreationSystem) が config から渡す
//   (§6.7。config キーは B-1 で追加されるため Phase A の本関数は config に依存しない)。
//   issue 不在 / land_claim で initiator が polity でない / from polity 不明 の場合は
//   undefined を返し、呼び出し側で War 作成を skip する。

function createWarGoalFromRevoltPlay(
  state: WorldState,
  play: DiplomaticPlay,
  requiredWarScore: number,
): PopularRevoltIndependenceWarGoal | undefined {
  if (play.initiator.kind !== 'polity') return undefined
  const commonwealth = state.polities[play.initiator.id]
  if (!commonwealth?.revoltState || commonwealth.revoltState.kind !== 'revolting') return undefined
  const origin = commonwealth.origin
  if (!origin || origin.kind !== 'popular_revolt') return undefined
  if (play.target.kind !== 'polity') return undefined
  return {
    kind: 'popular_revolt_independence',
    commonwealthPolityId: play.initiator.id,
    originalHolderPolityId: play.target.id,
    holdingIds: origin.holdingIds,
    revoltSeizureContractIds: commonwealth.revoltState.revoltSeizureContractIds,
    leaderPersonId: origin.leaderPersonId,
    requiredWarScore,
  }
}

export function createWarGoalFromDiplomaticPlay(
  state: WorldState,
  play: DiplomaticPlay,
  requiredWarScore: number,
): WarGoal | undefined {
  if (play.kind === 'revolt_negotiation') {
    return createWarGoalFromRevoltPlay(state, play, requiredWarScore)
  }
  const issue = play.issue
  if (!issue) return undefined

  if (issue.kind === 'land_claim') {
    // §6.5: toPolityId = 請求者 = play.initiator (attacker 側 polity)。
    //       fromPolityId = 対象 holding の chain 現 terminal grantee (原則 play.target)。
    if (play.initiator.kind !== 'polity') return undefined
    const toPolityId = play.initiator.id
    const fromPolityId =
      getHoldingTerminalPolityId(state, issue.holdingId) ??
      (play.target.kind === 'polity' ? play.target.id : undefined)
    if (!fromPolityId) return undefined
    return {
      kind: 'transfer_land_contract',
      holdingId: issue.holdingId,
      fromPolityId,
      toPolityId,
      requiredWarScore,
    }
  }

  // §6.6: contract_tax_revision。newTaxRateToGrantor <- issue.desiredTaxRateToGrantor。
  //   baseTaxRateToGrantor は「開戦時点の live 契約税率」を凍結する (歴史記述用)。
  //   交渉中に別経路で rate が動いていても honest な before を残せるよう issue 値コピーより live を優先。
  const liveRate = state.landContracts[issue.landContractId]?.terms.taxRateToGrantor
  return {
    kind: 'change_contract_tax_rate',
    holdingId: issue.holdingId,
    landContractId: issue.landContractId,
    baseTaxRateToGrantor: liveRate ?? issue.baseTaxRateToGrantor,
    newTaxRateToGrantor: issue.desiredTaxRateToGrantor,
    requiredWarScore,
  }
}

// --- WarGoal 記述 (歴史記述の共有 seam) ---

// v0.34: WarGoal を「対象 + before + after」のロケール中立な記述に正規化する。
//   WarDetail (UI) と warEvents (永続 Chronicle) が共用し、「元々どうで、どう変えようとしたか」を
//   live state に依存せず語れるようにする。新 WarGoal kind を足したらここ 1 箇所を更新すればよい。
//   tax の before/after は rate(0..1)、transfer は polity id (表示名は consumer 側で解決)。
export type WarGoalDescription =
  | {
      kind: 'transfer_land_contract'
      holdingId: HoldingId
      provinceId?: ProvinceId
      provinceNameKey?: string
      holdingKind?: string
      fromPolityId: PolityId
      toPolityId: PolityId
    }
  | {
      kind: 'change_contract_tax_rate'
      holdingId: HoldingId
      provinceId?: ProvinceId
      provinceNameKey?: string
      holdingKind?: string
      beforeRate: number
      afterRate: number
    }
  | {
      kind: 'popular_revolt_independence'
      holdingIds: HoldingId[]
      commonwealthPolityId: PolityId
      originalHolderPolityId: PolityId
    }

export function describeWarGoal(state: WorldState, goal: WarGoal): WarGoalDescription {
  if (goal.kind === 'popular_revolt_independence') {
    return {
      kind: 'popular_revolt_independence',
      holdingIds: goal.holdingIds,
      commonwealthPolityId: goal.commonwealthPolityId,
      originalHolderPolityId: goal.originalHolderPolityId,
    }
  }
  const holding = state.holdings[goal.holdingId]
  const provinceId = holding?.provinceId
  const provinceNameKey = provinceId ? state.provinces[provinceId]?.nameKey : undefined
  // exactOptionalPropertyTypes: undefined を明示代入しないよう条件 spread。
  const subject = {
    holdingId: goal.holdingId,
    ...(provinceId ? { provinceId } : {}),
    ...(provinceNameKey ? { provinceNameKey } : {}),
    ...(holding ? { holdingKind: holding.kind } : {}),
  }
  if (goal.kind === 'transfer_land_contract') {
    return {
      kind: 'transfer_land_contract',
      ...subject,
      fromPolityId: goal.fromPolityId,
      toPolityId: goal.toPolityId,
    }
  }
  return {
    kind: 'change_contract_tax_rate',
    ...subject,
    beforeRate: goal.baseTaxRateToGrantor,
    afterRate: goal.newTaxRateToGrantor,
  }
}
