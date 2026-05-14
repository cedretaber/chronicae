import type { WorldState } from '../types/world'
import type { HouseId } from '../types/ids'
import type { PlotType } from '../types/plot'
import type { EventReason, EventEffect } from '../types/event'

export function explainPlot(
  state: WorldState,
  plotType: PlotType,
  houseId: HouseId,
): { reasons: EventReason[]; effects: EventEffect[] } {
  const house = state.houses[houseId]
  if (!house) return { reasons: [], effects: [] }

  const country = state.countries[house.countryId]
  if (!country) return { reasons: [], effects: [] }

  const head = state.persons[house.headId]
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

  const prestigeContribution = house.prestige * 0.2
  if (prestigeContribution > 2.0) {
    reasons.push({
      label: 'House prestige',
      value: house.prestige,
      contribution: prestigeContribution,
    })
  }

  const loyaltyContribution = (100 - house.loyaltyToCountry) * 0.3
  if (loyaltyContribution > 2.0) {
    reasons.push({
      label: 'Low house loyalty',
      value: house.loyaltyToCountry,
      contribution: loyaltyContribution,
    })
  }

  const leaderLoyaltyContribution = (1.0 - head.traits.loyaltyToCountry) * 20
  if (leaderLoyaltyContribution > 2.0) {
    reasons.push({
      label: 'Low leader loyalty',
      value: head.traits.loyaltyToCountry,
      contribution: leaderLoyaltyContribution,
    })
  }

  reasons.sort((a, b) => (b.contribution ?? 0) - (a.contribution ?? 0))

  const effects: EventEffect[] = (() => {
    switch (plotType) {
      case 'replace_house_head':
        return [{ label: 'Targeting house leadership' }]
      case 'seize_role':
        return [{ label: 'Targeting a government role' }]
      case 'prepare_rebellion':
        return [{ label: 'Preparing for rebellion' }]
    }
  })()

  return { reasons, effects }
}
