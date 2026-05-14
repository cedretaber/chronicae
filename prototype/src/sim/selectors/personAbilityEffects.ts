import type { PersonId } from '../types/ids'
import type { WorldState } from '../types/world'
import type { Person } from '../types/person'
import type { Country } from '../types/country'
import type { House } from '../types/house'
import type { RoleType } from '../types/role'
import { clamp } from '../utils/math'
import type { SimulationConfig } from '../config/defaultConfig'

export function normalizedStat(value: number): number {
  return (value - 5) / 5
}

export function normalizedTrait(value: number): number {
  return value - 0.5
}

export function getAssignedLivingPerson(
  state: WorldState,
  country: Country,
  role: RoleType,
): Person | undefined {
  const personId = country.roleAssignments[role]
  if (!personId) return undefined
  const person = state.persons[personId]
  if (!person || !person.alive) return undefined
  return person
}

export function getLivingPerson(state: WorldState, personId: PersonId): Person | undefined {
  const person = state.persons[personId]
  if (!person || !person.alive) return undefined
  return person
}

export function calcChancellorControlGrowthModifier(
  state: WorldState,
  country: Country,
  config: SimulationConfig,
): number {
  if (!config.personAbilityEffectsEnabled) return 1
  const chancellor = getAssignedLivingPerson(state, country, 'chancellor')
  const admin = chancellor?.stats.admin ?? 5
  return 1 + normalizedStat(admin) * config.chancellorAdminControlGrowthEffect
}

export function calcChancellorControlMaxBonus(
  state: WorldState,
  country: Country,
  config: SimulationConfig,
): number {
  if (!config.personAbilityEffectsEnabled) return 0
  const chancellor = getAssignedLivingPerson(state, country, 'chancellor')
  const admin = chancellor?.stats.admin ?? 5
  return (admin - 5) * config.chancellorAdminControlMaxBonusPerAdmin
}

export function calcHouseHeadControlGrowthModifier(
  state: WorldState,
  house: House,
  config: SimulationConfig,
): number {
  if (!config.personAbilityEffectsEnabled) return 1
  const head = state.persons[house.headId]
  if (!head || !head.alive) {
    const admin = 5
    return 1 + normalizedStat(admin) * config.houseHeadAdminControlGrowthEffect
  }
  const admin = head.stats.admin
  return 1 + normalizedStat(admin) * config.houseHeadAdminControlGrowthEffect
}

export function calcHouseHeadControlMaxBonus(
  state: WorldState,
  house: House,
  config: SimulationConfig,
): number {
  if (!config.personAbilityEffectsEnabled) return 0
  const head = state.persons[house.headId]
  if (!head || !head.alive) {
    const admin = 5
    return (admin - 5) * config.houseHeadAdminControlMaxBonusPerAdmin
  }
  const admin = head.stats.admin
  return (admin - 5) * config.houseHeadAdminControlMaxBonusPerAdmin
}

export function calcTreasurerTaxEfficiency(
  state: WorldState,
  country: Country,
  config: SimulationConfig,
): number {
  if (!config.personAbilityEffectsEnabled) return 1
  const treasurer = getAssignedLivingPerson(state, country, 'treasurer')
  const admin = treasurer?.stats.admin ?? 5
  const caution = treasurer?.traits.caution ?? 0.5
  return clamp(
    1 +
      normalizedStat(admin) * config.treasurerAdminTaxEfficiencyEffect +
      normalizedTrait(caution) * config.treasurerCautionTaxEfficiencyEffect,
    config.treasurerTaxEfficiencyMin,
    config.treasurerTaxEfficiencyMax,
  )
}

export function calcTreasurerDevelopmentCostModifier(
  state: WorldState,
  country: Country,
  config: SimulationConfig,
): number {
  if (!config.personAbilityEffectsEnabled) return 1
  const treasurer = getAssignedLivingPerson(state, country, 'treasurer')
  const admin = treasurer?.stats.admin ?? 5
  return 1 - normalizedStat(admin) * config.treasurerAdminDevelopmentCostEffect
}

export function calcGeneralWarPowerModifier(
  state: WorldState,
  country: Country,
  config: SimulationConfig,
): number {
  if (!config.personAbilityEffectsEnabled) return 1
  const general = getAssignedLivingPerson(state, country, 'general')
  const martial = general?.stats.martial ?? 5
  return 1 + normalizedStat(martial) * config.generalMartialWarPowerEffect
}

export function calcGeneralDeclareThreshold(
  state: WorldState,
  country: Country,
  config: SimulationConfig,
): number {
  if (!config.personAbilityEffectsEnabled) return config.minAttackerWinChanceToDeclare
  const general = getAssignedLivingPerson(state, country, 'general')
  const ambition = general?.traits.ambition ?? 0.5
  const caution = general?.traits.caution ?? 0.5
  return clamp(
    config.minAttackerWinChanceToDeclare -
      normalizedTrait(ambition) * config.generalAmbitionDeclareThresholdEffect +
      normalizedTrait(caution) * config.generalCautionDeclareThresholdEffect,
    config.minWarDeclareThreshold,
    config.maxWarDeclareThreshold,
  )
}

export function calcChancellorMonumentScoreBonus(
  state: WorldState,
  country: Country,
  config: SimulationConfig,
): number {
  if (!config.personAbilityEffectsEnabled) return 0
  const chancellor = getAssignedLivingPerson(state, country, 'chancellor')
  const ambition = chancellor?.traits.ambition ?? 0.5
  const caution = chancellor?.traits.caution ?? 0.5
  return (
    normalizedTrait(ambition) * config.chancellorAmbitionMonumentScoreEffect -
    normalizedTrait(caution) * config.chancellorCautionMonumentScoreEffect
  )
}

export function calcChancellorLandDevelopmentScoreBonus(
  state: WorldState,
  country: Country,
  config: SimulationConfig,
): number {
  if (!config.personAbilityEffectsEnabled) return 0
  const chancellor = getAssignedLivingPerson(state, country, 'chancellor')
  const ambition = chancellor?.traits.ambition ?? 0.5
  const caution = chancellor?.traits.caution ?? 0.5
  return (
    normalizedTrait(caution) * config.chancellorCautionLandDevelopmentScoreEffect -
    normalizedTrait(ambition) * config.chancellorAmbitionLandDevelopmentScoreEffect
  )
}

export function calcHouseHeadDevelopmentChanceBonus(
  state: WorldState,
  house: House,
  config: SimulationConfig,
): number {
  if (!config.personAbilityEffectsEnabled) return 0
  const head = state.persons[house.headId]
  if (!head || !head.alive) {
    const admin = 5
    const caution = 0.5
    return (
      normalizedStat(admin) * config.houseHeadAdminDevelopmentChanceEffect +
      normalizedTrait(caution) * config.houseHeadCautionDevelopmentChanceEffect
    )
  }
  const admin = head.stats.admin
  const caution = head.traits.caution
  return (
    normalizedStat(admin) * config.houseHeadAdminDevelopmentChanceEffect +
    normalizedTrait(caution) * config.houseHeadCautionDevelopmentChanceEffect
  )
}
