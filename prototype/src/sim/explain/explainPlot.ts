import type { WorldState } from '../types/world'
import type { HouseId } from '../types/ids'
import type { PlotType } from '../types/plot'
import type { EventReason, EventEffect } from '../types/event'
import { getHouseLoyaltyToCountry } from '../selectors/statusSelectors'
import { getHouseLeader } from '../selectors/officeSelectors'
import {
  getAttitudeOrDefault,
  attitudeValueToScore,
  countryAttitudeKey,
} from '../helpers/attitudeHelpers'

export function explainPlot(
  state: WorldState,
  plotType: PlotType,
  houseId: HouseId,
): { reasons: EventReason[]; effects: EventEffect[] } {
  const house = state.houses[houseId]
  if (!house) return { reasons: [], effects: [] }

  const country = state.countries[house.countryId]
  if (!country) return { reasons: [], effects: [] }

  const headId = getHouseLeader(state, house.id)
  if (!headId) return { reasons: [], effects: [] }
  const head = state.persons[headId]
  if (!head) return { reasons: [], effects: [] }

  const reasons: EventReason[] = []

  const ambitionContribution = head.traits.ambition * 30
  if (ambitionContribution > 2.0) {
    reasons.push({
      label: 'Leader ambition',
      value: head.traits.ambition,
      contribution: ambitionContribution,
    })
  }

  const prestigeContribution = house.legacyPrestige * 0.2
  if (prestigeContribution > 2.0) {
    reasons.push({
      label: 'House prestige',
      value: house.legacyPrestige,
      contribution: prestigeContribution,
    })
  }

  const houseLoyalty = getHouseLoyaltyToCountry(state, houseId)
  const loyaltyContribution = (100 - houseLoyalty) * 0.3
  if (loyaltyContribution > 2.0) {
    reasons.push({
      label: 'Low house loyalty',
      value: houseLoyalty,
      contribution: loyaltyContribution,
    })
  }

  const headCountryAtt = getAttitudeOrDefault(state, head, countryAttitudeKey(house.countryId))
  const headCountryLoyalty =
    (attitudeValueToScore(headCountryAtt.affection) * 0.55 +
      attitudeValueToScore(headCountryAtt.respect) * 0.45) /
    100
  const leaderLoyaltyContribution = (1.0 - headCountryLoyalty) * 20
  if (leaderLoyaltyContribution > 2.0) {
    reasons.push({
      label: 'Low leader loyalty',
      value: headCountryLoyalty,
      contribution: leaderLoyaltyContribution,
    })
  }

  reasons.sort((a, b) => (b.contribution ?? 0) - (a.contribution ?? 0))

  const effects: EventEffect[] = (() => {
    switch (plotType) {
      case 'replace_house_leader':
        return [{ label: 'Targeting house leadership' }]
      case 'seize_office':
        return [{ label: 'Targeting a government office' }]
      case 'prepare_rebellion':
        return [{ label: 'Preparing for rebellion' }]
    }
  })()

  return { reasons, effects }
}
