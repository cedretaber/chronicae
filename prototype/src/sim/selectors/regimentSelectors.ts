// v0.36: Regiment power selector。WarManeuver の battle power 入力 (getRegimentPowerForWarSide) と UI/debug 用。
import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { Regiment, RegimentSourceKind } from '../types/regiment'
import type { PopClass } from '../types/popGroup'
import type { War, WarSideKey } from '../types/war'
import type { PoliticalActorRef } from '../types/actor'
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

export function getRegimentsForActor(state: WorldState, actor: PoliticalActorRef): Regiment[] {
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
  const primary = sideObj.participants.find((p) => p.primary)
  if (!primary) return 0

  const mobilized = getRegimentsForWarSide(state, war.id, side).filter((r) => r.status === 'active')
  if (mobilized.length > 0) {
    return mobilized.reduce((sum, r) => sum + getRegimentEffectivePower(r), 0)
  }

  const owned = state.regimentIndex.byOwner[politicalActorKey(primary.actor)] ?? []
  if (owned.length === 0) {
    return getActorMilitaryPower(state, config, primary.actor)
  }

  return 0
}

export function getActorRegimentPower(
  state: WorldState,
  _config: SimulationConfig,
  actor: PoliticalActorRef,
): number {
  const regiments = getRegimentsForActor(state, actor).filter((r) => r.status === 'active')
  return regiments.reduce((sum, r) => sum + getRegimentEffectivePower(r), 0)
}

// v0.36 補充・再編成: sourceKind が依拠する POP class。levy→peasants / urban_militia→townsmen /
//   noble_retinue→nobles。mercenary は v0.36 では非生成だが安全側で peasants を返す。
function recruitmentPopClassForSource(sourceKind: RegimentSourceKind): PopClass {
  switch (sourceKind) {
    case 'urban_militia':
      return 'townsmen'
    case 'noble_retinue':
      return 'nobles'
    case 'levy':
    case 'mercenary':
      return 'peasants'
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
