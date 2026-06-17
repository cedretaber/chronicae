import type { PolityId } from '../types/ids'
import type { WorldState } from '../types/world'
import type { Person } from '../types/person'
import type { OfficeRole, OrganizationRef } from '../types/office'
import { getRoleScore, abilityOutputFactor } from './abilitySelectors'
import { getActiveOfficeHolders } from './officeSelectors'
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
