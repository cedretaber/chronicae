import type { TickContext, CreateSimEventInput } from './context'
import type { SimEvent } from '../types/event'
import { entityRef } from '../types/event'
import type { WorldState } from '../types/world'
import type { HoldingImprovement } from '../types/holdingImprovement'
import type { HoldingImprovementId, EventId } from '../types/ids'
import type { SimulationConfig } from '../config/defaultConfig'
import { getHoldingTerminalPolityId } from '../selectors/landContractSelectors'
import {
  getHoldingEmployedPopSizeByType,
  getHoldingPopTypeCapacity,
} from '../selectors/popSelectors'
import { getActiveBailiff } from '../selectors/bailiffSelectors'
import { clamp } from '../utils/math'
import { holdingNameParam } from '../selectors/nameRefSelectors'
import { removeCrisisMut } from '../mutations/crisisMutations'
import { spawnDisrepairCrisisMut, cancelActiveResponseProjectMut } from './crisisSystem'
import { IMPROVEMENT_DEFINITIONS } from '../config/improvementDefinitions'

// v0.48.1 §2: 設備維持管理システム。HoldingImprovement.condition 領域 (減衰・閾値発火・破壊) を所有する。
//   Crisis のライフサイクル (週次デバフ/attitude/owner 解決/severity 表示同期) は引き続き crisisSystem。
//   projectOutcomeSystem と同 interval(4)・同 offset で走り、登録は crisisSystem の後 (§2.5):
//   「同サイクルに完了した修理が先に condition を回復 → その後で減衰・破壊判定」を保証する。

// §2.3: condition 0 到達 improvement を破壊する。level-1。残れば condition reset (lower-level として
//   健全化)、0 なら improvement 削除 + index 除去。対応する active disrepair Crisis を purge し、進行中の
//   修理 Project を cancel してから FACILITY_BREAKDOWN を emit する (dangling 参照を残さない, §6)。
function degradeHoldingImprovementMut(
  ws: WorldState,
  config: SimulationConfig,
  imp: HoldingImprovement,
  emitEvent: (input: CreateSimEventInput) => void,
): void {
  const holdingId = imp.holdingId

  // 対応する active disrepair Crisis を探し、修理 Project を cancel してから Crisis を purge。
  //   cancel は responseProjectId を読むため removeCrisisMut より前に行う。snapshot 越しに走査
  //   (removeCrisisMut が byHolding 配列を張り替えるため)。
  const crisisIds = [...(ws.crisisIndex.byHolding[holdingId as string] ?? [])]
  for (const cid of crisisIds) {
    const c = ws.crises[cid]
    if (c && c.kind === 'disrepair' && (c.targetImprovementId as string) === (imp.id as string)) {
      cancelActiveResponseProjectMut(ws, c.id, 'target_destroyed')
      removeCrisisMut(ws, c.id)
    }
  }

  const newLevel = imp.level - 1
  let outcome: 'degraded' | 'destroyed'
  if (newLevel >= 1) {
    // 部分崩壊: lower-level として健全化 (condition を回復値に戻す)。per-object spread。
    ws.holdingImprovements[imp.id] = {
      ...imp,
      level: newLevel,
      condition: config.facilityRepairConditionRestore,
    }
    outcome = 'degraded'
  } else {
    // 全壊: improvement 削除 + index から除去 (filter 後に空配列なら key ごと delete)。
    delete ws.holdingImprovements[imp.id]
    const arr = ws.holdingImprovementIndex.byHolding[holdingId as string]
    if (arr) {
      const filtered = arr.filter((id) => (id as string) !== (imp.id as string))
      if (filtered.length === 0) {
        delete ws.holdingImprovementIndex.byHolding[holdingId as string]
      } else {
        ws.holdingImprovementIndex.byHolding[holdingId as string] = filtered
      }
    }
    outcome = 'destroyed'
  }

  emitEvent({
    type: 'FACILITY_BREAKDOWN',
    importance: 'normal',
    messageKey: 'facility.breakdown',
    messageParams: {
      holding: holdingNameParam(ws, holdingId),
      improvementKind: imp.kind,
      breakdownOutcome: outcome,
    },
    entityRefs: [entityRef('holding', holdingId, 'holding')],
  })
}

export function runFacilityMaintenanceSystem(ctx: TickContext): TickContext {
  if (!ctx.config.facilityMaintenanceEnabled) return ctx

  const config = ctx.config
  const absoluteWeek = ctx.state.absoluteWeek

  // 1 tick 1 draft (§2.4): improvement slice (本システム固有) + Crisis slice + Project slice。
  //   condition 書込・破壊は holdingImprovements / holdingImprovementIndex.byHolding を、
  //   disrepair spawn / purge は crises / crisisIndex / projects / projectIndex を触る。
  //   index slice を欠くと in-place delete が共有 index を破壊し cross-tick 汚染になる (§13-B_det)。
  //   v0.48.2: 定期保守で owner polity の treasury を引くため polities slice も clone (per-object spread)。
  const ws: WorldState = {
    ...ctx.state,
    holdingImprovements: { ...ctx.state.holdingImprovements },
    holdingImprovementIndex: {
      byHolding: { ...ctx.state.holdingImprovementIndex.byHolding },
    },
    polities: { ...ctx.state.polities },
    crises: { ...ctx.state.crises },
    crisisIndex: {
      byHolding: { ...ctx.state.crisisIndex.byHolding },
      byProject: { ...ctx.state.crisisIndex.byProject },
    },
    projects: { ...ctx.state.projects },
    projectIndex: {
      byOwner: { ...ctx.state.projectIndex.byOwner },
      byAim: { ...ctx.state.projectIndex.byAim },
      byParentProject: { ...ctx.state.projectIndex.byParentProject },
      byCreatorPerson: { ...ctx.state.projectIndex.byCreatorPerson },
      bySupervisorPerson: { ...ctx.state.projectIndex.bySupervisorPerson },
      byRelatedEntity: { ...ctx.state.projectIndex.byRelatedEntity },
    },
  }

  const newEvents: SimEvent[] = []
  let nextEventIndex = ctx.nextEventIndex
  function emitEvent(input: CreateSimEventInput): void {
    const id = `e-${ws.absoluteWeek}-${nextEventIndex}` as EventId
    nextEventIndex++
    newEvents.push({
      id,
      year: ws.currentYear,
      weekOfYear: ws.currentWeekOfYear,
      type: input.type,
      importance: input.importance,
      messageKey: input.messageKey,
      messageParams: input.messageParams,
      entityRefs: input.entityRefs ?? [],
      reasons: input.reasons ?? [],
      effects: input.effects ?? [],
    })
  }

  let mutated = false

  // v0.57 §雇用細分化: 改善の労働者 (維持役) による減衰緩和の coverage を holding 単位で memo 化。
  //   coverage = employed laborers / laborer capacity (0..1)。holding ごとに 1 度だけ算出し
  //   (改善ループ中の condition 減衰に依存しない・perf も改善)、同 holding の全改善で共有する。
  const maintenanceCoverageByHolding = new Map<string, number>()
  const getMaintenanceCoverage = (holdingId: HoldingImprovement['holdingId']): number => {
    const key = holdingId as string
    const cached = maintenanceCoverageByHolding.get(key)
    if (cached !== undefined) return cached
    const laborerCap = getHoldingPopTypeCapacity(ws, config, holdingId, 'laborers')
    const coverage =
      laborerCap > 0
        ? clamp(getHoldingEmployedPopSizeByType(ws, holdingId, 'laborers') / laborerCap, 0, 1)
        : 0
    maintenanceCoverageByHolding.set(key, coverage)
    return coverage
  }

  // §2.1 減衰 → §2.2 閾値発火 → §2.3 破壊。走査は sort で順序固定 (採番決定性, §13-M_det)。
  for (const impIdStr of Object.keys(ws.holdingImprovements).sort()) {
    const impId = impIdStr as HoldingImprovementId
    const imp = ws.holdingImprovements[impId]
    if (!imp) continue

    // §2.1 condition 減衰 (level 比例)。必ず per-object spread で書く (Record clone だけでは
    //   オブジェクト本体が共有参照のまま → 前 tick state 破壊 → bit-identical 違反)。
    const maintenanceFactor =
      1 - config.facilityMaintenanceDecayReductionMax * getMaintenanceCoverage(imp.holdingId)
    const decay = config.facilityConditionDecayPerCyclePerLevel * imp.level * maintenanceFactor
    const newCondition = Math.max(0, imp.condition - decay)
    if (newCondition !== imp.condition) {
      ws.holdingImprovements[impId] = { ...imp, condition: newCondition }
      mutated = true
    }
    const decayed = ws.holdingImprovements[impId]
    if (!decayed) continue

    if (decayed.condition <= 0 && !IMPROVEMENT_DEFINITIONS[decayed.kind].critical) {
      // §2.3 破壊 (レベルダウン / 全壊) — critical infrastructure は破壊しない
      degradeHoldingImprovementMut(ws, config, decayed, emitEvent)
      mutated = true
    } else if (decayed.condition < config.facilityDisrepairThreshold) {
      // §2.2 閾値割れ → disrepair Crisis 発火 (active owner polity がある場合のみ)
      const ownerPolityId = getHoldingTerminalPolityId(ws, decayed.holdingId)
      if (ownerPolityId) {
        const ownerPolity = ws.polities[ownerPolityId]
        if (ownerPolity && ownerPolity.active) {
          const spawned = spawnDisrepairCrisisMut(
            ws,
            config,
            decayed.holdingId,
            decayed.id,
            ownerPolityId,
            absoluteWeek,
            emitEvent,
          )
          if (spawned) mutated = true
        }
      }
    } else if (decayed.condition < config.facilityMaintenanceThreshold) {
      // §6.6b 3 段モデル: 要保守帯 (disrepairThreshold 以上 maintenanceThreshold 未満)。
      //   active な代官 + owner polity の財政 (treasury ≥ 費用) が揃えば自動保守し condition を回復。
      //   どちらか欠ければ何もしない (減衰継続 → 50 割れで disrepair Crisis)。RNG は引かない。
      const bailiff = getActiveBailiff(ws, decayed.holdingId)
      if (bailiff) {
        const ownerPolityId = getHoldingTerminalPolityId(ws, decayed.holdingId)
        if (ownerPolityId) {
          const ownerPolity = ws.polities[ownerPolityId]
          const cost = config.facilityMaintenanceCostPerLevel * decayed.level
          // treasury は払える時だけ引く (treasury<0 integrity 違反を防ぐ, §C6)。
          if (ownerPolity && ownerPolity.active && ownerPolity.treasury >= cost) {
            ws.polities[ownerPolityId] = {
              ...ownerPolity,
              treasury: ownerPolity.treasury - cost,
            }
            ws.holdingImprovements[impId] = {
              ...decayed,
              condition: config.facilityMaintenanceConditionRestore,
            }
            emitEvent({
              type: 'FACILITY_MAINTAINED',
              importance: 'minor',
              messageKey: 'facility.maintained',
              messageParams: {
                holding: holdingNameParam(ws, decayed.holdingId),
                improvementKind: decayed.kind,
              },
              entityRefs: [entityRef('holding', decayed.holdingId, 'holding')],
            })
            mutated = true
          }
        }
      }
    }
  }

  // §6 防御: 対象 improvement が消滅した disrepair Crisis (dangling) を purge/tolerate する
  //   (throw でなく purge。transient window 誤検知回避, §13-OK_det)。通常は破壊時に purge 済みだが、
  //   別経路で improvement が消えた場合の belt-and-suspenders。
  for (const crisisIdStr of Object.keys(ws.crises).sort()) {
    const crisis = ws.crises[crisisIdStr as keyof typeof ws.crises]
    if (!crisis || crisis.kind !== 'disrepair') continue
    const impId = crisis.targetImprovementId
    if (!impId || !ws.holdingImprovements[impId]) {
      cancelActiveResponseProjectMut(ws, crisis.id, 'target_destroyed')
      removeCrisisMut(ws, crisis.id)
      mutated = true
    }
  }

  if (!mutated && newEvents.length === 0) return ctx

  return { ...ctx, state: ws, events: [...ctx.events, ...newEvents], nextEventIndex }
}
