import type { WorldState } from '../types/world'
import type { Regiment, RegimentTroopKind } from '../types/regiment'
import type { PolityId, HoldingId, RegimentBarracksId } from '../types/ids'
import type { PopType } from '../types/popGroup'
import type { SimulationConfig } from '../config/defaultConfig'
import { clamp } from '../utils/math'
import {
  getWorkplaceEmployedPopSizeByType,
  type HoldingEmploymentMap,
  empMapLookup,
} from './popSelectors'

export function computeBarracksRequiredByPopType(
  config: SimulationConfig,
  troopKind: RegimentTroopKind,
): Partial<Record<PopType, number>> {
  const total = config.regimentBarracksRequiredTotalPopByTroopKind[troopKind]
  const ratios = config.regimentBarracksRequiredPopRatioByTroopKind[troopKind]
  const result: Partial<Record<PopType, number>> = {}
  for (const [pt, ratio] of Object.entries(ratios) as [PopType, number][]) {
    const count = Math.round(total * ratio)
    if (count > 0) {
      result[pt] = count
    }
  }
  return result
}

// v0.64 Task 9: fulfillment selectors

export type BarracksFulfillment = {
  overallFulfillment: number
  commandFulfillment: number
  byPopType: Partial<Record<PopType, number>>
}

export function getBarracksFulfillment(
  state: WorldState,
  barracksId: RegimentBarracksId,
  empMap?: HoldingEmploymentMap,
): BarracksFulfillment {
  const barracks = state.regimentBarracks[barracksId]
  if (!barracks) {
    return { overallFulfillment: 1, commandFulfillment: 1, byPopType: {} }
  }

  const required = barracks.requiredByPopType
  const entries = Object.entries(required) as [PopType, number][]
  const totalRequired = entries.reduce((sum, [, req]) => sum + req, 0)

  if (totalRequired === 0) {
    return { overallFulfillment: 1, commandFulfillment: 1, byPopType: {} }
  }

  const workplaceRef = { kind: 'barracks' as const, id: barracksId }
  const byPopType: Partial<Record<PopType, number>> = {}
  const actualByPopType: Partial<Record<PopType, number>> = {}
  let totalFulfilled = 0

  for (const [pt, req] of entries) {
    const employed = empMap
      ? empMapLookup(empMap, workplaceRef, pt)
      : getWorkplaceEmployedPopSizeByType(state, barracks.holdingId, workplaceRef, pt)
    actualByPopType[pt] = employed
    const fulfilled = Math.min(employed, req)
    byPopType[pt] = req > 0 ? fulfilled / req : 0
    totalFulfilled += fulfilled
  }

  const overallFulfillment = totalFulfilled / totalRequired

  const regiment = state.regiments[barracks.regimentId]
  let commandFulfillment = 1

  if (regiment) {
    const requiredSoldiers = required['soldiers'] ?? 0

    if (requiredSoldiers <= 0) {
      commandFulfillment = 1
    } else if (regiment.troopKind === 'infantry') {
      const requiredMinisteriales = required['ministeriales'] ?? 0
      const idealRatio = requiredMinisteriales / requiredSoldiers
      if (idealRatio <= 0) {
        commandFulfillment = 1
      } else {
        const actualSoldiers = actualByPopType['soldiers'] ?? 0
        const actualMinisteriales = actualByPopType['ministeriales'] ?? 0
        const actualRatio = actualMinisteriales / Math.max(actualSoldiers, 0.001)
        commandFulfillment = clamp(actualRatio / idealRatio, 0, 1)
      }
    } else if (regiment.troopKind === 'cavalry') {
      const requiredMinisteriales = required['ministeriales'] ?? 0
      const requiredNobles = required['nobles'] ?? 0
      const actualSoldiers = actualByPopType['soldiers'] ?? 0
      const actualMinisteriales = actualByPopType['ministeriales'] ?? 0
      const actualNobles = actualByPopType['nobles'] ?? 0

      const idealMinisterialRatio = requiredMinisteriales / requiredSoldiers
      const ministerialFulfillment =
        idealMinisterialRatio <= 0
          ? 1
          : clamp(
              actualMinisteriales / Math.max(actualSoldiers, 0.001) / idealMinisterialRatio,
              0,
              1,
            )

      const idealNobleRatio = requiredNobles / requiredSoldiers
      const nobleFulfillment =
        idealNobleRatio <= 0
          ? 1
          : clamp(actualNobles / Math.max(actualSoldiers, 0.001) / idealNobleRatio, 0, 1)

      commandFulfillment = Math.min(ministerialFulfillment, nobleFulfillment)
    }
  }

  return { overallFulfillment, commandFulfillment, byPopType }
}

export function getEffectiveMaxStrength(state: WorldState, regiment: Regiment): number {
  const fulfillment = getBarracksFulfillment(state, regiment.barracksId)
  return regiment.maxStrength * fulfillment.overallFulfillment
}

export function getEffectiveMaxOrganization(state: WorldState, regiment: Regiment): number {
  const fulfillment = getBarracksFulfillment(state, regiment.barracksId)
  return regiment.maxOrganization * fulfillment.commandFulfillment
}

export function getEffectiveBaselineOrganization(state: WorldState, regiment: Regiment): number {
  const fulfillment = getBarracksFulfillment(state, regiment.barracksId)
  return regiment.baselineOrganization * fulfillment.commandFulfillment
}

export function selectCavalryBarracksHolding(
  state: WorldState,
  polityId: PolityId,
): HoldingId | undefined {
  const polity = state.polities[polityId]
  if (!polity) return undefined
  if (polity.capitalProvinceId) {
    const province = state.provinces[polity.capitalProvinceId]
    if (province) {
      const holdingIds = (Object.keys(state.holdings) as HoldingId[])
        .filter((hId) => {
          const h = state.holdings[hId]
          return (
            h &&
            h.provinceId === polity.capitalProvinceId &&
            state.holdingTerminalPolityCache[hId] === polityId
          )
        })
        .sort()
      if (holdingIds.length > 0) {
        return holdingIds[0]
      }
    }
  }
  return undefined
}
