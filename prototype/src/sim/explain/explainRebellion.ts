import type { WorldState } from '../types/world'
import type { HouseId } from '../types/ids'
import type { EventReason, EventEffect } from '../types/event'
import { getPolityLegitimacy, getHouseLoyaltyToPolity } from '../selectors/statusSelectors'
import { getHouseLeader } from '../selectors/officeSelectors'
import { getAttitudeOrDefault, attitudeValueToScore } from '../helpers/attitudeHelpers'
import { getHousePrimaryPolityId } from '../selectors/polityRelations'
import { getHouseControlledProvinceIds } from '../selectors/landContractSelectors'

export function explainRebellion(
  state: WorldState,
  houseId: HouseId,
  rebelPower: number,
  loyalistPower: number,
): { reasons: EventReason[]; effects: EventEffect[] } {
  const house = state.houses[houseId]
  if (!house) return { reasons: [], effects: [] }

  const polityId = getHousePrimaryPolityId(state, house.id)
  if (!polityId) return { reasons: [], effects: [] }
  const polity = state.polities[polityId]
  if (!polity) return { reasons: [], effects: [] }

  const headId = getHouseLeader(state, house.id)
  if (!headId) return { reasons: [], effects: [] }
  const head = state.persons[headId]
  if (!head) return { reasons: [], effects: [] }

  const reasons: EventReason[] = []

  const prestigeContribution = house.legacyPrestige * 0.3
  if (prestigeContribution > 2.0) {
    reasons.push({
      label: 'House prestige',
      value: house.legacyPrestige,
      contribution: prestigeContribution,
    })
  }

  const provinceCount = getHouseControlledProvinceIds(state, house.id).length
  const provinceContribution = provinceCount * 4
  if (provinceContribution > 2.0) {
    reasons.push({
      label: 'Province count',
      value: provinceCount,
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

  const legitimacyContribution = (100 - getPolityLegitimacy(state, polityId)) * 0.3
  if (legitimacyContribution > 2.0) {
    reasons.push({
      label: 'Low polity legitimacy',
      value: getPolityLegitimacy(state, polityId),
      contribution: legitimacyContribution,
    })
  }

  const houseLoyalty = getHouseLoyaltyToPolity(state, houseId)
  const loyaltyContribution = (100 - houseLoyalty) * 0.4
  if (loyaltyContribution > 2.0) {
    reasons.push({
      label: 'Low house loyalty',
      value: houseLoyalty,
      contribution: loyaltyContribution,
    })
  }

  const headCountryAtt = getAttitudeOrDefault(state, head, { kind: 'polity', id: polityId })
  const headCountryLoyalty =
    (attitudeValueToScore(headCountryAtt.affection) * 0.55 +
      attitudeValueToScore(headCountryAtt.respect) * 0.45) /
    100
  const leaderLoyaltyContribution = (1.0 - headCountryLoyalty) * 30
  if (leaderLoyaltyContribution > 2.0) {
    reasons.push({
      label: 'Low leader loyalty',
      value: headCountryLoyalty,
      contribution: leaderLoyaltyContribution,
    })
  }

  reasons.sort((a, b) => (b.contribution ?? 0) - (a.contribution ?? 0))

  const effects: EventEffect[] = [
    { label: 'Rebel military power', value: rebelPower },
    { label: 'Loyalist military power', value: loyalistPower },
    { label: 'Polity stability', value: -10 },
    { label: 'Polity legitimacy', value: -5 },
  ]

  return { reasons, effects }
}
