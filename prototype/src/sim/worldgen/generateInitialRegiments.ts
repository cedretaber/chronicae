// v0.36: worldgen post-pass。完成 WorldState の各 Holding から persistent Regiment を 1 つ生成する。
//   owner = holding の terminal Polity。basePower = calcPolityMilitaryPower(polity) / その polity の Regiment 数
//   (2-pass。worldgen 直後は Σ Regiment basePower ≈ 旧 calcPolityMilitaryPower)。
//   noble_retinue/cavalry 振り分けは worldgen 本体の seedRng を消費しない sub-rng を内部で使う
//   (→ v0.36a の sim trajectory は v0.35 と bit 一致。spec §8)。

import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { PolityId, HoldingId } from '../types/ids'
import type { RegimentSourceKind, RegimentTroopKind } from '../types/regiment'
import { createRng, randomFloat } from '../rng/rng'
import { calcPolityMilitaryPower } from '../selectors/militarySelectors'
import { createRegiment } from '../mutations/regimentMutations'

// manor のうちこの割合を noble_retinue / cavalry にする (残りは levy / infantry)。
const NOBLE_RETINUE_CHANCE = 0.25

export function generateInitialRegiments(
  state: WorldState,
  config: SimulationConfig,
  seedText: string,
): WorldState {
  // --- Pass 1: group holdings by their terminal Polity (deterministic, sorted) ---
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

  // --- basePower per polity = calcPolityMilitaryPower / regiment count ---
  const basePowerByPolity = new Map<PolityId, number>()
  for (const [polityId, holdingIds] of holdingsByPolity) {
    const count = holdingIds.length
    const polityPower = calcPolityMilitaryPower(state, config, polityId)
    basePowerByPolity.set(polityId, count > 0 ? polityPower / count : 0)
  }

  // --- Pass 2: create one Regiment per holding (sub-rng for noble/cavalry) ---
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
        if (roll.value < NOBLE_RETINUE_CHANCE) {
          sourceKind = 'noble_retinue'
          troopKind = 'cavalry'
        } else {
          sourceKind = 'levy'
          troopKind = 'infantry'
        }
      }

      createRegiment(state, {
        owner: { kind: 'polity', id: polityId },
        sourceKind,
        troopKind,
        homeHoldingId: holding.id,
        homeProvinceId: holding.provinceId,
        strength: config.regimentInitialStrength,
        organization: config.regimentInitialOrganization,
        morale: config.regimentInitialMorale,
        maxStrength: config.regimentMaxStrength,
        basePower,
        // §3 (v0.37): baseline / max を config 定数で設定 (RNG draw を増やさない → bit-identical)。
        baselineOrganization: config.regimentBaselineOrganizationDefault,
        maxOrganization: config.regimentMaxOrganizationDefault,
        baselineMorale: config.regimentBaselineMoraleDefault,
        maxMorale: config.regimentMaxMoraleDefault,
        createdWeek: state.absoluteWeek,
      })
    }
  }

  return state
}
