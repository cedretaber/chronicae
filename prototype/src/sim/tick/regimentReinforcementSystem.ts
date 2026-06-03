// v0.36 補充・再編成 RegimentReinforcementSystem
//
// 月次 (tick 登録 intervalWeeks=4) に走り、persistent Regiment を 2 系統で手当てする:
//   A. active かつ strength < maxStrength → strength を silent 補充 (organization recovery と同じく
//      イベント無し)。平時/戦時/動員中の係数・home POP の厚み・cavalry 補正を掛け、owner Polity の
//      treasury を上限 (cap) として支払う。
//   B. destroyed かつ reform 遅延を満たす → active に再編成 (reform)。本拠地の terminal Polity が
//      現 owner と一致し owner が active・POP が足り treasury が足りる場合のみ。REGIMENT_REFORMED を emit。
//
// owner が Polity でない / homeHolding 無しは skip (v0.36 では worldgen が Polity owner のみ生成)。
// homeControlFactor は二値 (terminal==owner ? 1 : 0)。占領/封臣/段階的支配は future。
// treasury は Polity 共有なので RegimentId 昇順 (worldgen と同じ比較) で決定的に処理する。
//
// 配線位置: RegimentMaintenanceSystem の直後。maintenance が active regiment の owner を terminal に
//   揃え・home 消失/owner 失効を disband 済なので、本 system は整合した owner/home を前提にできる。
//
// perf: recovery/maintenance と同じ lazy clone-once。変更が出るまで draft を clone しない。

import type { TickContext } from './context'
import { createSimEvent } from './context'
import type { WorldState } from '../types/world'
import type { Regiment } from '../types/regiment'
import type { RegimentId } from '../types/ids'
import type { SimulationConfig } from '../config/defaultConfig'
import type { EventEntityRef, EventMessageParams } from '../types/event'
import { nameParam, entityRef } from '../types/event'
import { clamp } from '../utils/math'
import { updateRegimentMut, reformRegimentMut } from '../mutations/regimentMutations'
import { getRegimentHomeRecruitmentFactor } from '../selectors/regimentSelectors'
import { politicalActorKey, isActorActive } from '../selectors/actorSelectors'
import { getPolityNameRefForEmit } from '../selectors/nameRefSelectors'

// homeHolding の terminal Polity が現 owner Polity と一致するか (二値)。holding 消失・terminal 不明・
//   owner 不一致はすべて 0 (= 補充/reform 不可)。
function homeControlFactor(ws: WorldState, r: Regiment): number {
  if (r.owner.kind !== 'polity') return 0
  if (r.homeHoldingId === undefined) return 0
  if (!ws.holdings[r.homeHoldingId]) return 0
  const terminal = ws.holdingTerminalPolityCache[r.homeHoldingId]
  if (terminal === undefined) return 0
  return terminal === r.owner.id ? 1 : 0
}

// 平時/戦時/動員中の補充速度係数。mobilized = この Regiment が現に戦争動員されている。
//   ownerAtWar = owner Polity が active War に参加中 (未動員でも後方が戦時負荷を受ける)。
function warStateFactor(ws: WorldState, config: SimulationConfig, r: Regiment): number {
  if (r.currentWarId !== undefined) {
    return (
      config.regimentReinforcementWarMultiplier * config.regimentReinforcementMobilizedMultiplier
    )
  }
  const warIds = ws.warIndex.byParticipant[politicalActorKey(r.owner)] ?? []
  for (const wid of warIds) {
    const war = ws.wars[wid]
    if (war && war.status === 'active') return config.regimentReinforcementWarMultiplier
  }
  return config.regimentReinforcementPeaceMultiplier
}

export function runRegimentReinforcementSystem(ctx: TickContext): TickContext {
  const ids = Object.keys(ctx.state.regiments)
  if (ids.length === 0) return ctx

  const config = ctx.config
  const week = ctx.state.absoluteWeek

  // RegimentId 昇順 (generateInitialRegiments と同じ文字列比較)。treasury 共有のため決定的順序にする。
  const sortedIds = [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)) as RegimentId[]

  let cur = ctx
  let ws: WorldState = ctx.state
  let cloned = false
  const ensureDraft = (): void => {
    if (cloned) return
    ws = {
      ...ctx.state,
      regiments: { ...ctx.state.regiments },
      polities: { ...ctx.state.polities },
    }
    cloned = true
  }

  const emitReformed = (regiment: Regiment): void => {
    const ownerId = regiment.owner.kind === 'polity' ? regiment.owner.id : undefined
    if (ownerId === undefined) return
    const ownerRef = getPolityNameRefForEmit(ws, ownerId)
    const ownerNameKey = ownerRef.nameKey
    const provinceId = regiment.homeProvinceId
    const provinceNameKey =
      provinceId !== undefined ? (ws.provinces[provinceId]?.nameKey ?? provinceId) : ''
    const messageParams: EventMessageParams = {
      owner: nameParam(ownerRef.category, ownerNameKey),
      province: nameParam('province', provinceNameKey),
    }
    const entityRefs: EventEntityRef[] = [entityRef('polity', ownerId, 'owner', ownerNameKey)]
    if (provinceId !== undefined) {
      entityRefs.push(entityRef('province', provinceId, 'province', provinceNameKey))
    }
    const { event, ctx: nextCtx } = createSimEvent(
      { ...cur, state: ws },
      {
        type: 'REGIMENT_REFORMED',
        importance: 'minor',
        messageKey: 'regiment.reformed',
        messageParams,
        entityRefs,
      },
    )
    cur = { ...nextCtx, events: [...nextCtx.events, event] }
  }

  for (const rid of sortedIds) {
    const r = ws.regiments[rid]
    if (!r) continue
    if (r.owner.kind !== 'polity') continue
    if (r.homeHoldingId === undefined) continue
    if (r.sourceKind === 'local_levy') continue

    // ── A. active strength 補充 (silent) ──
    if (r.status === 'active') {
      if (r.strength >= r.maxStrength) continue
      const homeControl = homeControlFactor(ws, r)
      if (homeControl <= 0) continue

      const popFactor = getRegimentHomeRecruitmentFactor(ws, config, r)
      const warState = warStateFactor(ws, config, r)
      const troopFactor =
        r.troopKind === 'cavalry' ? config.regimentCavalryReinforcementMultiplier : 1
      const desired = Math.min(
        config.regimentReinforcementBasePerMonth * popFactor * homeControl * warState * troopFactor,
        r.maxStrength - r.strength,
      )
      if (desired <= 0) continue

      const costPerStrength =
        config.regimentReinforcementCostPerStrength *
        (r.troopKind === 'cavalry' ? config.regimentCavalryReinforcementCostMultiplier : 1)
      const polity = ws.polities[r.owner.id]
      if (!polity) continue

      let gain = desired
      if (costPerStrength > 0) {
        const affordable = polity.treasury / costPerStrength
        gain = Math.min(desired, affordable)
      }
      if (gain <= 0) continue

      ensureDraft()
      updateRegimentMut(ws, rid, {
        strength: clamp(r.strength + gain, 0, r.maxStrength),
        lastReinforcedWeek: week,
      })
      const cost = gain * costPerStrength
      if (cost > 0) {
        const p = ws.polities[r.owner.id]
        if (p) ws.polities[r.owner.id] = { ...p, treasury: Math.max(0, p.treasury - cost) }
      }
      continue
    }

    // ── B. destroyed reform ──
    if (r.status === 'destroyed' && r.destroyedWeek !== undefined) {
      if (week - r.destroyedWeek < config.destroyedRegimentReformDelayWeeks) continue
      if (homeControlFactor(ws, r) <= 0) continue
      if (!isActorActive(ws, r.owner)) continue
      const popFactor = getRegimentHomeRecruitmentFactor(ws, config, r)
      if (popFactor < config.destroyedRegimentReformMinPopFactor) continue
      const polity = ws.polities[r.owner.id]
      if (!polity || polity.treasury < config.destroyedRegimentReformCost) continue

      ensureDraft()
      reformRegimentMut(
        ws,
        rid,
        {
          strength: config.destroyedRegimentReformInitialStrength,
          organization: config.destroyedRegimentReformInitialOrganization,
          morale: config.destroyedRegimentReformInitialMorale,
        },
        week,
      )
      const p = ws.polities[r.owner.id]
      if (p) {
        ws.polities[r.owner.id] = {
          ...p,
          treasury: Math.max(0, p.treasury - config.destroyedRegimentReformCost),
        }
      }
      // reform 後の最新 record を渡す (homeProvince 等は不変なので r でも可だが status=active を反映)。
      const reformed = ws.regiments[rid]
      if (reformed) emitReformed(reformed)
    }
  }

  if (!cloned) return cur
  return { ...cur, state: ws }
}
