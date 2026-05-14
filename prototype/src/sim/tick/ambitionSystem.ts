import type { TickContext } from './context'
import type { WorldState } from '../types/world'
import type { HouseId } from '../types/ids'

export type AmbitionScores = {
  rebellionTendency: number
  plotTendency: number
}

export function calcAmbitionScores(state: WorldState, houseId: HouseId): AmbitionScores {
  const house = state.houses[houseId]
  if (!house) return { rebellionTendency: 0, plotTendency: 0 }

  const country = state.countries[house.countryId]
  if (!country) return { rebellionTendency: 0, plotTendency: 0 }

  const head = state.persons[house.headId]
  if (!head) return { rebellionTendency: 0, plotTendency: 0 }

  const rebellionTendency =
    house.prestige * 0.3 +
    house.provinceIds.length * 4 +
    head.traits.ambition * 30 +
    (100 - country.legitimacy) * 0.3 +
    (100 - house.loyaltyToCountry) * 0.4 +
    (1.0 - head.traits.loyaltyToCountry) * 30 -
    head.traits.caution * 20 -
    country.adminPower * 0.2

  const plotTendency =
    head.traits.ambition * 30 +
    house.prestige * 0.2 +
    (100 - house.loyaltyToCountry) * 0.3 +
    (1.0 - head.traits.loyaltyToCountry) * 20 -
    head.traits.caution * 15 -
    country.adminPower * 0.1

  return { rebellionTendency, plotTendency }
}

export function runAmbitionSystem(ctx: TickContext): TickContext {
  return ctx
}
