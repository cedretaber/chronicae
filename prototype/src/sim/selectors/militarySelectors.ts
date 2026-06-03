import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { HouseId, PolityId } from '../types/ids'
import { clamp } from '../utils/math'
import { normalizedStat } from './personAbilityEffects'
import { getRoleScore } from './abilitySelectors'
import { getProvinceHouseManpowerBase } from './popEconomySelectors'
import { getHouseLoyaltyToPolity } from './statusSelectors'
import { getPolityLeaderHouse } from './officeSelectors'
import { getPolityHouseIds } from './polityRelations'
import { getHouseControlledProvinceIds } from './landContractSelectors'

export function calcHouseMilitaryPower(
  state: WorldState,
  config: SimulationConfig,
  houseId: HouseId,
): number {
  const house = state.houses[houseId]
  if (!house) return 0

  // levyPower: sum of house manpower from all controlled provinces, scaled by houseManpowerPowerFactor
  let levyPower = 0
  for (const pid of getHouseControlledProvinceIds(state, houseId)) {
    levyPower += getProvinceHouseManpowerBase(state, config, pid)
  }
  levyPower *= config.houseManpowerPowerFactor

  // mercenaryPower: log1p of available wealth, capped at levyPower * maxMercenaryPowerRatio
  const availableWarWealth = Math.max(0, house.wealth - config.houseMilitaryWealthReserve)
  const rawMercenaryPower = Math.log1p(availableWarWealth) * config.houseWealthMilitaryFactor
  const mercenaryPower = Math.min(rawMercenaryPower, levyPower * config.maxMercenaryPowerRatio)

  // commanderModifier: best martial stat of house members, normalized to -1..1
  const warScores = house.memberIds
    .filter((pid) => state.persons[pid]?.alive)
    .map((pid) => getRoleScore(state, pid, 'warCommand') / 10)
  const bestWarScore = warScores.length > 0 ? Math.max(...warScores) : 0
  const commanderModifier = clamp(
    1 + normalizedStat(bestWarScore) * config.houseCommanderMartialEffect,
    config.minCommanderModifier,
    config.maxCommanderModifier,
  )

  return (levyPower + mercenaryPower) * commanderModifier
}

export function calcPolityMilitaryPower(
  state: WorldState,
  config: SimulationConfig,
  countryId: PolityId,
): number {
  const polity = state.polities[countryId]
  if (!polity) return 0

  // §22.1: institutionalPower 概念。adminPower 由来の administrative contribution に
  // rank 別下限値を被せて、rank ≥ 4 (county-tier 以下) の小 Polity / Rebel Polity が
  // 即死しないようにする。
  const adminContribution = polity.adminPower * config.polityAdminMilitaryFactor
  const floor = config.institutionalPowerFloorByRank[polity.rank] ?? 0
  let total = Math.max(adminContribution, floor)

  const rulerHouseId = getPolityLeaderHouse(state, countryId)

  for (const houseId of getPolityHouseIds(state, countryId)) {
    const house = state.houses[houseId]
    if (!house || !house.active) continue

    const housePower = calcHouseMilitaryPower(state, config, houseId)

    if (rulerHouseId && houseId === rulerHouseId) {
      total += housePower
    } else {
      const loyaltyModifier = clamp(
        getHouseLoyaltyToPolity(state, houseId) / 100,
        config.minHouseMilitaryContribution,
        1,
      )
      total += housePower * loyaltyModifier
    }
  }

  return total
}
