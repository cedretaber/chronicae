import type { WorldState } from '../types/world'
import type { War, WarGoal, WarParticipant } from '../types/war'
import type { WarId, DiplomaticPlayId } from '../types/ids'
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
  return {
    kind: 'change_contract_tax_rate',
    holdingId: issue.holdingId,
    landContractId: issue.landContractId,
    newTaxRateToGrantor: issue.desiredTaxRateToGrantor,
    requiredWarScore,
  }
}
