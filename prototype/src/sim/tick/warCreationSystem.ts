import type { TickContext } from './context'
import type { WorldState } from '../types/world'
import type { DiplomaticPlay, DiplomaticPlayStatus } from '../types/diplomaticPlay'
import type { DiplomaticPlayId, WarId } from '../types/ids'
import type { War, WarGoal } from '../types/war'
import { createWar, createWarGoalFromDiplomaticPlay } from '../mutations/warMutations'
import { emitWarDeclared } from './warEvents'

// v0.34 §6 WarCreationSystem
//
// status === 'escalated' な land_claim / contract_tax_revision の DiplomaticPlay を War entity に変換する。
// revolt_negotiation は触らない (legacy runConflictResolutionSystem が即時解決する。§6.2.1 kind-gate)。
//
// 二重処理防止は順序依存ではなく kind-gate で保証する (§11.3):
//   WarCreationSystem → land_claim / contract_tax_revision のみ
//   runConflictResolutionSystem → revolt_negotiation のみ
//
// War 化できなかった escalated play (dedup / 変換不能 / 非 polity) は cancelled に倒す。
// escalated のまま残すと cleanupTerminalDiplomacy が terminal しか消さず無限蓄積するため (§6.2.3/§6.2.4)。

function setPlayStatusMut(
  ws: WorldState,
  playId: DiplomaticPlayId,
  status: DiplomaticPlayStatus,
): void {
  const play = ws.diplomaticPlays[playId]
  if (play) ws.diplomaticPlays[playId] = { ...play, status }
}

// §6.2.4: 同一 issue を対象とする active War が既に存在するか。
//   warIndex は holding/contract 索引を持たないため active War を線形 scan する (件数が少なく問題なし)。
function hasActiveWarForIssue(ws: WorldState, play: DiplomaticPlay): boolean {
  const issue = play.issue
  if (!issue) return false
  for (const wid of Object.keys(ws.wars)) {
    const w = ws.wars[wid as WarId]
    if (!w || w.status !== 'active') continue
    for (const g of w.warGoals) {
      if (
        issue.kind === 'land_claim' &&
        g.kind === 'transfer_land_contract' &&
        g.holdingId === issue.holdingId
      ) {
        return true
      }
      if (
        issue.kind === 'contract_tax_revision' &&
        g.kind === 'change_contract_tax_rate' &&
        g.landContractId === issue.landContractId
      ) {
        return true
      }
    }
  }
  return false
}

// §14.5 integrity 前提を満たすか (満たさない WarGoal で War を作ると integrity throw するため事前に弾く)。
function isWarGoalApplicable(ws: WorldState, goal: WarGoal): boolean {
  if (goal.requiredWarScore <= 0) return false
  if (!ws.holdings[goal.holdingId]) return false
  if (goal.kind === 'transfer_land_contract') {
    if (goal.fromPolityId === goal.toPolityId) return false
    const from = ws.polities[goal.fromPolityId]
    const to = ws.polities[goal.toPolityId]
    return !!from && from.active && !!to && to.active
  }
  const contract = ws.landContracts[goal.landContractId]
  if (!contract || contract.holdingId !== goal.holdingId) return false
  return goal.newTaxRateToGrantor >= 0 && goal.newTaxRateToGrantor <= 1
}

export function runWarCreationSystem(ctx: TickContext): TickContext {
  if (!ctx.config.conflictResolutionEnabled) return ctx
  const config = ctx.config
  const absoluteWeek = ctx.state.absoluteWeek

  const candidates: DiplomaticPlay[] = []
  for (const id of Object.keys(ctx.state.diplomaticPlays).sort()) {
    const play = ctx.state.diplomaticPlays[id as DiplomaticPlayId]
    if (!play) continue
    if (play.status !== 'escalated') continue
    if (play.kind !== 'land_claim' && play.kind !== 'contract_tax_revision') continue
    candidates.push(play)
  }
  if (candidates.length === 0) return ctx

  const ws: WorldState = {
    ...ctx.state,
    wars: { ...ctx.state.wars },
    warIndex: {
      byParticipant: { ...ctx.state.warIndex.byParticipant },
      byOriginDiplomaticPlay: { ...ctx.state.warIndex.byOriginDiplomaticPlay },
    },
    diplomaticPlays: { ...ctx.state.diplomaticPlays },
  }

  const declared: { war: War; issueKind: DiplomaticPlay['kind'] }[] = []
  let created = 0

  for (const play of candidates) {
    // §6.2.2 polity 限定 (land/tax は生成時点で polity 同士だが防御的に確認)。
    if (play.initiator.kind !== 'polity' || play.target.kind !== 'polity') {
      setPlayStatusMut(ws, play.id, 'cancelled')
      continue
    }
    // §6.2.4 dedup。
    if (hasActiveWarForIssue(ws, play)) {
      setPlayStatusMut(ws, play.id, 'cancelled')
      continue
    }
    const requiredWarScore =
      play.kind === 'land_claim'
        ? config.defaultTransferLandWarScore
        : config.defaultChangeContractTaxWarScore
    const goal = createWarGoalFromDiplomaticPlay(ws, play, requiredWarScore)
    if (!goal || !isWarGoalApplicable(ws, goal)) {
      setPlayStatusMut(ws, play.id, 'cancelled')
      continue
    }
    // §6.2: 上限超過分は escalated のまま次 tick に回す (cancel しない)。
    if (created >= config.maxConflictsResolvedPerTick) break

    const war = createWar(ws, {
      attacker: play.initiator,
      defender: play.target,
      warGoals: [goal],
      targetWarScore: goal.requiredWarScore,
      startedWeek: absoluteWeek,
      originDiplomaticPlayId: play.id,
    })
    // §6.8: War 化成功 → 元 play は resolved_by_conflict (WAR_DECLARED のみ emit)。
    setPlayStatusMut(ws, play.id, 'resolved_by_conflict')
    declared.push({ war, issueKind: play.kind })
    created++
  }

  let next: TickContext = { ...ctx, state: ws }
  for (const d of declared) {
    next = emitWarDeclared(next, d.war, d.issueKind)
  }
  return next
}
