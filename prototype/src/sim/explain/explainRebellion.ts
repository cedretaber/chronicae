import type { WorldState } from '../types/world'
import type { HouseId } from '../types/ids'
import type { EventReason, EventEffect } from '../types/event'

export function explainRebellion(
  state: WorldState,
  houseId: HouseId,
  rebelPower: number,
  loyalistPower: number,
): { reasons: EventReason[]; effects: EventEffect[] } {
  const house = state.houses[houseId]
  if (!house) return { reasons: [], effects: [] }

  const country = state.countries[house.countryId]
  if (!country) return { reasons: [], effects: [] }

  const head = state.persons[house.headId]
  if (!head) return { reasons: [], effects: [] }

  const reasons: EventReason[] = []

  const prestigeContribution = house.prestige * 0.3
  if (prestigeContribution > 2.0) {
    reasons.push({
      label: 'House prestige',
      value: house.prestige,
      contribution: prestigeContribution,
    })
  }

  const provinceContribution = house.provinceIds.length * 4
  if (provinceContribution > 2.0) {
    reasons.push({
      label: 'Province count',
      value: house.provinceIds.length,
      contribution: provinceContribution,
    })
  }

  const ambitionContribution = head.traits.ambition * 30
  if (ambitionContribution > 2.0) {
    reasons.push({
      label: 'Leader ambition',
      value: head.traits.ambition,
      contribution: ambitionContribution,
    })
  }

  const legitimacyContribution = (100 - country.legitimacy) * 0.3
  if (legitimacyContribution > 2.0) {
    reasons.push({
      label: 'Low country legitimacy',
      value: country.legitimacy,
      contribution: legitimacyContribution,
    })
  }

  const loyaltyContribution = (100 - house.loyaltyToCountry) * 0.4
  if (loyaltyContribution > 2.0) {
    reasons.push({
      label: 'Low house loyalty',
      value: house.loyaltyToCountry,
      contribution: loyaltyContribution,
    })
  }

  const leaderLoyaltyContribution = (1.0 - head.traits.loyaltyToCountry) * 30
  if (leaderLoyaltyContribution > 2.0) {
    reasons.push({
      label: 'Low leader loyalty',
      value: head.traits.loyaltyToCountry,
      contribution: leaderLoyaltyContribution,
    })
  }

  reasons.sort((a, b) => (b.contribution ?? 0) - (a.contribution ?? 0))

  const effects: EventEffect[] = [
    { label: 'Rebel military power', value: rebelPower },
    { label: 'Loyalist military power', value: loyalistPower },
    { label: 'Country stability', value: -10 },
    { label: 'Country legitimacy', value: -5 },
  ]

  return { reasons, effects }
}
