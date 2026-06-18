// v0.36: worldgen post-pass。完成 WorldState の各 Holding から persistent Regiment を 1 つ生成する。
//   owner = holding の terminal Polity。basePower = calcPolityMilitaryPower(polity) / その polity の Regiment 数
//   (2-pass。worldgen 直後は Σ Regiment basePower ≈ 旧 calcPolityMilitaryPower)。
//   noble_retinue/cavalry 振り分けは worldgen 本体の seedRng を消費しない sub-rng を内部で使う
//   (→ v0.36a の sim trajectory は v0.35 と bit 一致。spec §8)。

import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { PolityId, HoldingId } from '../types/ids'
import { getPolityTerritorialStatus } from '../types/polity'
import type { RegimentSourceKind, RegimentTroopKind } from '../types/regiment'
import { createRng, randomFloat } from '../rng/rng'
import { calcPolityMilitaryPower } from '../selectors/militarySelectors'
import { createRegiment } from '../mutations/regimentMutations'

// manor のうちこの割合を noble_retinue にする (残りは levy)。
//   troopKind は当面すべて infantry に固定する (騎兵は将来「特殊な連隊」として別途設計するため、
//   worldgen の自動騎兵生成を一旦止める)。sourceKind の noble_retinue/levy 区別と sub-rng 消費は
//   維持し、将来の騎兵改修で noble_retinue を再び cavalry に紐付けられるようにしておく。
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
        // troopKind は当面すべて infantry (騎兵の特殊化は将来)。roll は sourceKind の振り分けと
        //   RNG 軌道維持のため残す。
        troopKind = 'infantry'
        sourceKind = roll.value < NOBLE_RETINUE_CHANCE ? 'noble_retinue' : 'levy'
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

  // --- Pass 3: create cavalry regiments for rank-eligible polities ---
  const sortedPolityIds = ([...holdingsByPolity.keys()] as PolityId[]).sort()
  for (const polityId of sortedPolityIds) {
    const polity = state.polities[polityId]
    if (!polity || !polity.active) continue
    if (getPolityTerritorialStatus(polity) === 'titular') continue
    const cavEntitlement = config.cavalryEntitlementByRank[polity.rank] ?? 0
    if (cavEntitlement <= 0) continue

    for (let i = 0; i < cavEntitlement; i++) {
      createRegiment(state, {
        owner: { kind: 'polity', id: polityId },
        sourceKind: 'noble_retinue',
        troopKind: 'cavalry',
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
    }
  }

  return state
}
