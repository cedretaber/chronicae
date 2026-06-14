import type { PersonId, PolityId } from '../types/ids'
import type { WorldState } from '../types/world'
import type { Person } from '../types/person'
import type { House } from '../types/house'
import type { OfficeRole, OrganizationRef } from '../types/office'
import { getRoleScore, abilityOutputFactor } from './abilitySelectors'
import { getActiveOfficeHolders, getHouseLeader } from './officeSelectors'
import { clamp } from '../utils/math'
import type { SimulationConfig } from '../config/defaultConfig'

export function normalizedStat(value: number): number {
  return (value - 5) / 5
}

export function normalizedTrait(value: number): number {
  return value - 0.5
}

function getFirstActiveLivingOfficeHolder(
  state: WorldState,
  polityId: PolityId,
  role: OfficeRole,
): Person | undefined {
  const polityRef: OrganizationRef = { kind: 'polity', id: polityId }
  const holderIds = getActiveOfficeHolders(state, polityRef, role)
  for (const id of holderIds) {
    const p = state.persons[id]
    if (p && p.alive) return p
  }
  return undefined
}

export function getLivingPerson(state: WorldState, personId: PersonId): Person | undefined {
  const person = state.persons[personId]
  if (!person || !person.alive) return undefined
  return person
}

export function calcChancellorControlGrowthModifier(
  state: WorldState,
  polityId: PolityId,
  config: SimulationConfig,
): number {
  if (!config.personAbilityEffectsEnabled) return 1
  const administrator = getFirstActiveLivingOfficeHolder(state, polityId, 'administrator')
  const score = administrator ? getRoleScore(state, administrator.id, 'governance') : 50
  return abilityOutputFactor(score, config)
}

export function calcChancellorControlMaxBonus(
  state: WorldState,
  polityId: PolityId,
  config: SimulationConfig,
): number {
  if (!config.personAbilityEffectsEnabled) return 0
  const administrator = getFirstActiveLivingOfficeHolder(state, polityId, 'administrator')
  const admin = administrator ? getRoleScore(state, administrator.id, 'governance') / 10 : 5
  return (admin - 5) * config.chancellorAdminControlMaxBonusPerAdmin
}

export function calcHouseHeadControlGrowthModifier(
  state: WorldState,
  house: House,
  config: SimulationConfig,
): number {
  if (!config.personAbilityEffectsEnabled) return 1
  const headId = getHouseLeader(state, house.id)
  const head = headId ? state.persons[headId] : undefined
  if (!head || !head.alive) {
    return abilityOutputFactor(50, config)
  }
  const score = getRoleScore(state, head.id, 'governance')
  return abilityOutputFactor(score, config)
}

export function calcHouseHeadControlMaxBonus(
  state: WorldState,
  house: House,
  config: SimulationConfig,
): number {
  if (!config.personAbilityEffectsEnabled) return 0
  const headId = getHouseLeader(state, house.id)
  const head = headId ? state.persons[headId] : undefined
  if (!head || !head.alive) {
    const admin = 5
    return (admin - 5) * config.houseHeadAdminControlMaxBonusPerAdmin
  }
  const admin = getRoleScore(state, head.id, 'governance') / 10
  return (admin - 5) * config.houseHeadAdminControlMaxBonusPerAdmin
}

export function calcTreasurerTaxEfficiency(
  state: WorldState,
  polityId: PolityId,
  config: SimulationConfig,
): number {
  if (!config.personAbilityEffectsEnabled) return 1
  const treasurer = getFirstActiveLivingOfficeHolder(state, polityId, 'treasurer')
  const score = treasurer ? getRoleScore(state, treasurer.id, 'stewardship') : 50
  const caution = treasurer?.traits.caution ?? 0.5
  return clamp(
    abilityOutputFactor(score, config) *
      (1 + normalizedTrait(caution) * config.treasurerCautionTaxEfficiencyEffect),
    config.treasurerTaxEfficiencyMin,
    config.treasurerTaxEfficiencyMax,
  )
}

export function calcTreasurerDevelopmentCostModifier(
  state: WorldState,
  polityId: PolityId,
  config: SimulationConfig,
): number {
  if (!config.personAbilityEffectsEnabled) return 1
  const treasurer = getFirstActiveLivingOfficeHolder(state, polityId, 'treasurer')
  const score = treasurer ? getRoleScore(state, treasurer.id, 'stewardship') : 50
  // 有能ほど開発コスト減。factor>1 でコスト<1。下限 0.2 で過剰割引を防ぐ。
  return clamp(2 - abilityOutputFactor(score, config), 0.2, 2)
}

export function calcGeneralWarPowerModifier(
  state: WorldState,
  polityId: PolityId,
  config: SimulationConfig,
): number {
  if (!config.personAbilityEffectsEnabled) return 1
  const military = getFirstActiveLivingOfficeHolder(state, polityId, 'military')
  const score = military ? getRoleScore(state, military.id, 'warCommand') : 50
  return abilityOutputFactor(score, config)
}

export function calcGeneralDeclareThreshold(
  state: WorldState,
  polityId: PolityId,
  config: SimulationConfig,
): number {
  if (!config.personAbilityEffectsEnabled) return config.minAttackerWinChanceToDeclare
  const military = getFirstActiveLivingOfficeHolder(state, polityId, 'military')
  const ambition = military?.traits.ambition ?? 0.5
  const caution = military?.traits.caution ?? 0.5
  return clamp(
    config.minAttackerWinChanceToDeclare -
      normalizedTrait(ambition) * config.generalAmbitionDeclareThresholdEffect +
      normalizedTrait(caution) * config.generalCautionDeclareThresholdEffect,
    config.minWarDeclareThreshold,
    config.maxWarDeclareThreshold,
  )
}

export function calcChancellorLandDevelopmentScoreBonus(
  state: WorldState,
  polityId: PolityId,
  config: SimulationConfig,
): number {
  if (!config.personAbilityEffectsEnabled) return 0
  const administrator = getFirstActiveLivingOfficeHolder(state, polityId, 'administrator')
  const ambition = administrator?.traits.ambition ?? 0.5
  const caution = administrator?.traits.caution ?? 0.5
  return (
    normalizedTrait(caution) * config.chancellorCautionLandDevelopmentScoreEffect -
    normalizedTrait(ambition) * config.chancellorAmbitionLandDevelopmentScoreEffect
  )
}
