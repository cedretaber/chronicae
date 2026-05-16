import type { TickContext } from './context'
import type { WorldState } from '../types/world'
import type { HouseId } from '../types/ids'
import {
  attitudeValueToScore,
  countryAttitudeKey,
  getAttitudeOrDefault,
} from '@sim/helpers/attitudeHelpers'
import { getCountryLegitimacy, getHouseLoyaltyToCountry } from '@sim/selectors/statusSelectors'

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

  const headCountryAtt = getAttitudeOrDefault(state, head, countryAttitudeKey(house.countryId))
  const headCountryLoyalty =
    (attitudeValueToScore(headCountryAtt.affection) * 0.55 +
      attitudeValueToScore(headCountryAtt.respect) * 0.45) /
    100

  const houseLoyalty = getHouseLoyaltyToCountry(state, houseId)
  const legitimacy = getCountryLegitimacy(state, house.countryId)

  const rebellionTendency =
    house.legacyPrestige * 0.3 +
    house.provinceIds.length * 4 +
    head.traits.ambition * 30 +
    (100 - legitimacy) * 0.3 +
    (100 - houseLoyalty) * 0.4 +
    (1.0 - headCountryLoyalty) * 30 -
    head.traits.caution * 20 -
    country.adminPower * 0.2

  const plotTendency =
    head.traits.ambition * 30 +
    house.legacyPrestige * 0.2 +
    (100 - houseLoyalty) * 0.3 +
    (1.0 - headCountryLoyalty) * 20 -
    head.traits.caution * 15 -
    country.adminPower * 0.1

  return { rebellionTendency, plotTendency }
}

export function runAmbitionSystem(ctx: TickContext): TickContext {
  return ctx
}
