import type { WorldState } from '../types/world'
import type { War, WarGoal, WarParticipant } from '../types/war'
import type { WarId, DiplomaticPlayId, HoldingId, PolityId, ProvinceId } from '../types/ids'
import type { PoliticalActorRef } from '../types/actor'
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

export type CreateWarInput = {
  attacker: PoliticalActorRef
  defender: PoliticalActorRef
  warGoals: WarGoal[]
  targetWarScore: number
  startedWeek: number
  originDiplomaticPlayId?: DiplomaticPlayId
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
      participants: [{ actor: input.attacker, joinedWeek: input.startedWeek, primary: true }],
    },
    defender: {
      key: 'defender',
      participants: [{ actor: input.defender, joinedWeek: input.startedWeek, primary: true }],
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

// status / warScore / endedWeek 等の更新用。participant は v0.34 では不変なので index 再構築は不要。
export function updateWar(ws: WorldState, warId: WarId, patch: Partial<War>): void {
  const war = ws.wars[warId]
  if (!war) return
  ws.wars[warId] = { ...war, ...patch }
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
export function createWarGoalFromDiplomaticPlay(
  state: WorldState,
  play: DiplomaticPlay,
  requiredWarScore: number,
): WarGoal | undefined {
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

export function describeWarGoal(state: WorldState, goal: WarGoal): WarGoalDescription {
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
