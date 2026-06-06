import type { TickContext } from './context'
import type { WorldState } from '../types/world'
import type {
  DiplomaticPlay,
  DiplomaticPlayStatus,
  DiplomaticPlaySupporter,
} from '../types/diplomaticPlay'
import type { DiplomaticPlayId, PolityId, WarId } from '../types/ids'
import type { War, WarGoal, WarSideKey } from '../types/war'
import {
  createWar,
  createWarGoalFromDiplomaticPlay,
  type WarSupporterInput,
} from '../mutations/warMutations'
import { canTransferLandContract } from '../mutations/landContractMutations'
import { emitWarDeclared, emitWarAverted, emitWarParticipantJoined } from './warEvents'
import { estimateAttackerWinChance } from '../selectors/warEstimateSelectors'
import { calcGeneralDeclareThreshold } from '../selectors/personAbilityEffects'
import { isPolityInActiveWar } from '../selectors/diplomaticSupportSelectors'
import { politicalActorKey } from '../selectors/actorSelectors'
import { createLogger } from '../debug/logger'
import type { OrganizationRef } from '../types/office'

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

// v0.43 §10.3a: War 化時の supporter 再検証 (copy filter)。
//   supporter 追加時の §8.1 exclude は追加時点の検査にすぎないため、コピー直前に再検証する。
//   acceptedKeys は primary 2 件で初期化し、採用順に追記する (両 side 跨ぎ・primary 重複を防ぐ)。
//   落ちた supporter は無音 (宣言イベントは取り消さない — §10.3a)。
function collectWarSupporters(
  ws: WorldState,
  supporters: DiplomaticPlaySupporter[],
  acceptedKeys: Set<string>,
): WarSupporterInput[] {
  const result: WarSupporterInput[] = []
  for (const s of supporters) {
    if (s.actor.kind !== 'polity') continue
    const key = politicalActorKey(s.actor)
    if (acceptedKeys.has(key)) continue
    if (ws.polities[s.actor.id]?.active !== true) continue
    if (isPolityInActiveWar(ws, s.actor.id)) continue
    acceptedKeys.add(key)
    result.push({ actor: s.actor })
  }
  return result
}

// §14.5 integrity 前提を満たすか (満たさない WarGoal で War を作ると integrity throw するため事前に弾く)。
function isWarGoalApplicable(ws: WorldState, goal: WarGoal): boolean {
  if (goal.requiredWarScore <= 0) return false
  if (goal.kind === 'transfer_land_contract') {
    if (!ws.holdings[goal.holdingId]) return false
    if (goal.fromPolityId === goal.toPolityId) return false
    const from = ws.polities[goal.fromPolityId]
    const to = ws.polities[goal.toPolityId]
    if (!from || !from.active || !to || !to.active) return false
    // §6.5: warScore で勝っても feudal chain の rank invariant を満たせない transfer は
    //   settleAttackerWon が適用できず白紙和平に倒れ、同じ戦争を永久に再宣戦する (winning→white_peace
    //   ループ)。適用可否を applyLandContractTransferGoal と同一ロジック (planLandContractTransfer) で
    //   開戦前に検証し、構造上勝ち取れない戦争を宣戦させない。
    return canTransferLandContract(ws, goal.holdingId, goal.fromPolityId, goal.toPolityId)
  }
  if (goal.kind === 'popular_revolt_independence') {
    if (goal.holdingIds.length === 0) return false
    if (goal.holdingIds.some((hid) => !ws.holdings[hid])) return false
    const cw = ws.polities[goal.commonwealthPolityId]
    const orig = ws.polities[goal.originalHolderPolityId]
    return !!cw && cw.active && !!orig && orig.active
  }
  // change_contract_tax_rate
  if (!ws.holdings[goal.holdingId]) return false
  const contract = ws.landContracts[goal.landContractId]
  if (!contract || contract.holdingId !== goal.holdingId) return false
  return goal.newTaxRateToGrantor >= 0 && goal.newTaxRateToGrantor <= 1
}

export function runWarCreationSystem(ctx: TickContext): TickContext {
  if (!ctx.config.conflictResolutionEnabled) return ctx
  const config = ctx.config
  const absoluteWeek = ctx.state.absoluteWeek
  const log = createLogger(config.debug)

  const candidates: DiplomaticPlay[] = []
  for (const id of Object.keys(ctx.state.diplomaticPlays).sort()) {
    const play = ctx.state.diplomaticPlays[id as DiplomaticPlayId]
    if (!play) continue
    if (play.status !== 'escalated') continue
    if (
      play.kind !== 'land_claim' &&
      play.kind !== 'contract_tax_revision' &&
      play.kind !== 'revolt_negotiation'
    )
      continue
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

  const declared: {
    war: War
    issueKind: DiplomaticPlay['kind']
    joinedSupporters: { sideKey: WarSideKey; polityId: PolityId }[]
  }[] = []
  const averted: {
    attacker: OrganizationRef
    defender: OrganizationRef
    winChance: number
    threshold: number
  }[] = []
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
        : play.kind === 'revolt_negotiation'
          ? config.defaultPopularRevoltWarScore
          : config.defaultChangeContractTaxWarScore
    const goal = createWarGoalFromDiplomaticPlay(ws, play, requiredWarScore)
    if (!goal || !isWarGoalApplicable(ws, goal)) {
      setPlayStatusMut(ws, play.id, 'cancelled')
      continue
    }
    // v0.42 §6 開戦ゲート: 勝率 × 指導者性格で「勝てない戦争」を見送る。
    //   revolt_negotiation は除外 (叛乱は計算的開戦ではなく、cancel すると revoltState.warId が宙に浮く)。
    //   推定戦力は動員可能連隊で算出 (warEstimateSelectors)。winChance < threshold なら撤退し、
    //   既存の cancelled 経路で escalated を終結させる (createWar はスキップ)。
    if (config.winChanceWarGateEnabled && play.kind !== 'revolt_negotiation') {
      const winChance = estimateAttackerWinChance(ws, config, play.initiator, play.target)
      const threshold = calcGeneralDeclareThreshold(ws, play.initiator.id, config)
      if (winChance < threshold) {
        setPlayStatusMut(ws, play.id, 'cancelled')
        averted.push({
          attacker: play.initiator,
          defender: play.target,
          winChance,
          threshold,
        })
        continue
      }
    }
    // §6.2: 上限超過分は escalated のまま次 tick に回す (cancel しない)。
    if (created >= config.maxConflictsResolvedPerTick) break

    // v0.43 §10.3a: supporter copy filter。play は 1 件ずつ処理し、createWar (= byParticipant
    //   登録) 完了後に次の play を評価するため、同一 supporter の 2 war 同時参戦レースは起きない。
    const acceptedKeys = new Set<string>([
      politicalActorKey(play.initiator),
      politicalActorKey(play.target),
    ])
    const attackerSupporters = collectWarSupporters(ws, play.initiatorSupporters, acceptedKeys)
    const defenderSupporters = collectWarSupporters(ws, play.targetSupporters, acceptedKeys)

    const war = createWar(ws, {
      attacker: play.initiator,
      defender: play.target,
      warGoals: [goal],
      targetWarScore: goal.requiredWarScore,
      startedWeek: absoluteWeek,
      originDiplomaticPlayId: play.id,
      ...(attackerSupporters.length > 0 ? { attackerSupporters } : {}),
      ...(defenderSupporters.length > 0 ? { defenderSupporters } : {}),
    })
    log.log('WAR_PARTICIPANTS', {
      warId: war.id,
      attackers: war.attacker.participants.map((p) => politicalActorKey(p.actor)).join(','),
      defenders: war.defender.participants.map((p) => politicalActorKey(p.actor)).join(','),
      droppedSupporters:
        play.initiatorSupporters.length +
        play.targetSupporters.length -
        attackerSupporters.length -
        defenderSupporters.length,
    })
    // v0.39: revolt_negotiation の場合、revoltState.warId を補完
    if (play.kind === 'revolt_negotiation' && play.initiator.kind === 'polity') {
      const cw = ws.polities[play.initiator.id]
      if (cw?.revoltState?.kind === 'revolting') {
        ws.polities[play.initiator.id] = {
          ...cw,
          revoltState: { ...cw.revoltState, warId: war.id },
        }
      }
    }
    // §6.8: War 化成功 → 元 play は resolved_by_conflict (WAR_DECLARED のみ emit)。
    setPlayStatusMut(ws, play.id, 'resolved_by_conflict')
    declared.push({
      war,
      issueKind: play.kind,
      joinedSupporters: [
        // collectWarSupporters は polity actor のみ通すため id は PolityId。
        ...attackerSupporters.map((s) => ({
          sideKey: 'attacker' as const,
          polityId: s.actor.id as PolityId,
        })),
        ...defenderSupporters.map((s) => ({
          sideKey: 'defender' as const,
          polityId: s.actor.id as PolityId,
        })),
      ],
    })
    created++
  }

  let next: TickContext = { ...ctx, state: ws }
  for (const d of declared) {
    next = emitWarDeclared(next, d.war, d.issueKind)
    // v0.43 §10.4: copy filter 通過 supporter ごとに WAR_PARTICIPANT_JOINED。
    for (const j of d.joinedSupporters) {
      next = emitWarParticipantJoined(next, d.war, j.sideKey, j.polityId)
    }
  }
  for (const a of averted) {
    next = emitWarAverted(next, a.attacker, a.defender, a.winChance, a.threshold)
  }
  return next
}
