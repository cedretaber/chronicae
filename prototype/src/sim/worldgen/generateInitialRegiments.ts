import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { PolityId, HoldingId } from '../types/ids'
import type { PopType } from '../types/popGroup'
import { getPopStratum } from '../types/popGroup'
import { getPolityTerritorialStatus } from '../types/polity'
import type { RegimentSourceKind, RegimentTroopKind } from '../types/regiment'
import { createRng, randomFloat } from '../rng/rng'
import { calcPolityMilitaryPower } from '../selectors/militarySelectors'
import { createRegimentWithBarracksMut } from '../mutations/regimentMutations'
import {
  computeBarracksRequiredByPopType,
  selectCavalryBarracksHolding,
} from '../selectors/barracksSelectors'
import { addToOrCreatePopGroupMut } from '../mutations/popMutations'

const NOBLE_RETINUE_CHANCE = 0.25

export function generateInitialRegiments(
  state: WorldState,
  config: SimulationConfig,
  seedText: string,
): WorldState {
  const sortedHoldingIds = (Object.keys(state.holdings) as HoldingId[]).sort((a, b) =>
    (a as string) < (b as string) ? -1 : (a as string) > (b as string) ? 1 : 0,
  )

  const holdingsByPolity = new Map<PolityId, HoldingId[]>()
  for (const holdingId of sortedHoldingIds) {
    const terminalPolityId = state.holdingTerminalPolityCache[holdingId]
    if (terminalPolityId === undefined) continue
    if (state.polities[terminalPolityId] === undefined) continue
    const arr = holdingsByPolity.get(terminalPolityId) ?? []
    arr.push(holdingId)
    holdingsByPolity.set(terminalPolityId, arr)
  }

  const basePowerByPolity = new Map<PolityId, number>()
  for (const [polityId, holdingIds] of holdingsByPolity) {
    const count = holdingIds.length
    const polityPower = calcPolityMilitaryPower(state, config, polityId)
    basePowerByPolity.set(polityId, count > 0 ? polityPower / count : 0)
  }

  let rng = createRng(seedText + ':regiments-v0.36')

  for (const [polityId, holdingIds] of holdingsByPolity) {
    const basePower = basePowerByPolity.get(polityId) ?? 0
    for (const holdingId of holdingIds) {
      const holding = state.holdings[holdingId]
      if (holding === undefined) continue

      let sourceKind: RegimentSourceKind
      let troopKind: RegimentTroopKind

      if (holding.kind === 'city') {
        sourceKind = 'urban_militia'
        troopKind = 'infantry'
      } else {
        const roll = randomFloat(rng)
        rng = roll.rng
        troopKind = 'infantry'
        sourceKind = roll.value < NOBLE_RETINUE_CHANCE ? 'noble_retinue' : 'levy'
      }

      const requiredByPopType = computeBarracksRequiredByPopType(config, troopKind)

      const { barracks } = createRegimentWithBarracksMut(state, {
        owner: { kind: 'polity', id: polityId },
        sourceKind,
        troopKind,
        holdingId: holding.id,
        requiredByPopType,
        strength: config.regimentInitialStrength,
        organization: config.regimentInitialOrganization,
        morale: config.regimentInitialMorale,
        maxStrength: config.regimentMaxStrength,
        basePower,
        baselineOrganization: config.regimentBaselineOrganizationDefault,
        maxOrganization: config.regimentMaxOrganizationDefault,
        baselineMorale: config.regimentBaselineMoraleDefault,
        maxMorale: config.regimentMaxMoraleDefault,
        createdWeek: state.absoluteWeek,
      })

      const empRef = { kind: 'barracks' as const, id: barracks.id }
      for (const [pt, count] of Object.entries(requiredByPopType) as [PopType, number][]) {
        if (count <= 0) continue
        addToOrCreatePopGroupMut(state, {
          holdingId: holding.id,
          class: getPopStratum(pt),
          popType: pt,
          size: count,
          employerId: empRef,
        })
      }
    }
  }

  const sortedPolityIds = ([...holdingsByPolity.keys()] as PolityId[]).sort()
  for (const polityId of sortedPolityIds) {
    const polity = state.polities[polityId]
    if (!polity || !polity.active) continue
    if (getPolityTerritorialStatus(polity) === 'titular') continue
    const cavEntitlement = config.cavalryEntitlementByRank[polity.rank] ?? 0
    if (cavEntitlement <= 0) continue

    const cavHoldingId = selectCavalryBarracksHolding(state, polityId)
    if (cavHoldingId === undefined) continue

    const requiredByPopType = computeBarracksRequiredByPopType(config, 'cavalry')

    for (let i = 0; i < cavEntitlement; i++) {
      const { barracks } = createRegimentWithBarracksMut(state, {
        owner: { kind: 'polity', id: polityId },
        sourceKind: 'noble_retinue',
        troopKind: 'cavalry',
        holdingId: cavHoldingId,
        requiredByPopType,
        strength: config.regimentInitialStrength,
        organization: config.regimentInitialOrganization,
        morale: config.regimentInitialMorale,
        maxStrength: config.regimentMaxStrength,
        basePower: config.cavalryEntitlementBasePower,
        baselineOrganization: config.regimentBaselineOrganizationDefault,
        maxOrganization: config.regimentMaxOrganizationDefault,
        baselineMorale: config.regimentBaselineMoraleDefault,
        maxMorale: config.regimentMaxMoraleDefault,
        createdWeek: state.absoluteWeek,
      })

      const empRef = { kind: 'barracks' as const, id: barracks.id }
      for (const [pt, count] of Object.entries(requiredByPopType) as [PopType, number][]) {
        if (count <= 0) continue
        addToOrCreatePopGroupMut(state, {
          holdingId: cavHoldingId,
          class: getPopStratum(pt),
          popType: pt,
          size: count,
          employerId: empRef,
        })
      }
    }
  }

  return state
}
