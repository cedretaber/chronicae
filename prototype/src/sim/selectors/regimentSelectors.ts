// v0.36: Regiment power selector。WarManeuver の battle power 入力 (getRegimentPowerForWarSide) と UI/debug 用。
import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { Regiment, RegimentSourceKind } from '../types/regiment'
import type { PopClass } from '../types/popGroup'
import type { War, WarSideKey } from '../types/war'
import type { OrganizationRef } from '../types/office'
import { clamp } from '../utils/math'
import { politicalActorKey } from './actorSelectors'
import { getActorMilitaryPower } from './actorSelectors'
import { getHoldingPopSizeByClass } from './popSelectors'

export function getRegimentEffectivePower(regiment: Regiment): number {
  if (regiment.status !== 'active') return 0
  const strengthFactor = clamp(regiment.strength / 100, 0, 1)
  const organizationFactor = 0.5 + 0.5 * clamp(regiment.organization / 100, 0, 1)
  return regiment.basePower * strengthFactor * organizationFactor
}

export function getRegimentsForActor(state: WorldState, actor: OrganizationRef): Regiment[] {
  const key = politicalActorKey(actor)
  const ids = state.regimentIndex.byOwner[key] ?? []
  const out: Regiment[] = []
  for (const id of ids) {
    const r = state.regiments[id]
    if (r) out.push(r)
  }
  return out
}

export function getRegimentsForWarSide(
  state: WorldState,
  warId: War['id'],
  side: WarSideKey,
): Regiment[] {
  const ids = state.regimentIndex.byWar[warId] ?? []
  const out: Regiment[] = []
  for (const id of ids) {
    const r = state.regiments[id]
    if (r && r.currentSide === side) out.push(r)
  }
  return out
}

export function getRegimentPowerForWarSide(
  state: WorldState,
  config: SimulationConfig,
  war: War,
  side: WarSideKey,
): number {
  const sideObj = side === 'attacker' ? war.attacker : war.defender

  // 1. 動員済み active Regiment があればその合算 (participant 不問 — byWar index ベース)。
  const mobilized = getRegimentsForWarSide(state, war.id, side).filter((r) => r.status === 'active')
  if (mobilized.length > 0) {
    return mobilized.reduce((sum, r) => sum + getRegimentEffectivePower(r), 0)
  }

  // 2. v0.43 §12.4: 動員 0 のときのみ participant ごとに fallback して合算。
  //    Regiment record が無い participant → nominal power / record はあるが未動員 → 0。
  //    participant 1 件 (primary のみ) の War では旧実装と同値。
  let total = 0
  for (const p of sideObj.participants) {
    const owned = state.regimentIndex.byOwner[politicalActorKey(p.actor)] ?? []
    if (owned.length === 0) {
      total += getActorMilitaryPower(state, config, p.actor)
    }
  }
  return total
}

// v0.36 補充・再編成: sourceKind が依拠する POP class。levy→peasants / urban_militia→townsmen /
//   noble_retinue→nobles。mercenary は v0.36 では非生成だが安全側で peasants を返す。
function recruitmentPopClassForSource(sourceKind: RegimentSourceKind): PopClass {
  switch (sourceKind) {
    case 'urban_militia':
      return 'middle'
    case 'noble_retinue':
      return 'upper'
    case 'levy':
    case 'local_levy':
    case 'mercenary':
      return 'lower'
  }
}

// v0.36 補充・再編成: homeHolding の該当 class POP を「補充源の厚み」係数に変換する。
//   class 間で POP スケールが大きく違うため per-class reference で正規化し、
//   [minPopFactor, maxPopFactor] に clamp する。homeHolding が無ければ 0 (補充不可)。
//   POP は減らさない (源の厚みとして読むだけ)。
export function getRegimentHomeRecruitmentFactor(
  state: WorldState,
  config: SimulationConfig,
  regiment: Regiment,
): number {
  if (regiment.homeHoldingId === undefined) return 0
  const popClass = recruitmentPopClassForSource(regiment.sourceKind)
  const classPop = getHoldingPopSizeByClass(state, regiment.homeHoldingId, popClass)
  const reference = config.regimentReinforcementReferencePopByClass[popClass]
  if (!(reference > 0)) return config.regimentReinforcementMinPopFactor
  return clamp(
    classPop / reference,
    config.regimentReinforcementMinPopFactor,
    config.regimentReinforcementMaxPopFactor,
  )
}
