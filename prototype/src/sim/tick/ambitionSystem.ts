import type { WorldState } from '../types/world'
import type { HouseId } from '../types/ids'
import { attitudeValueToScore, getAttitudeOrDefault } from '@sim/helpers/attitudeHelpers'
import { getPolityLegitimacy, getHouseLoyaltyToPolity } from '@sim/selectors/statusSelectors'
import { getHouseLeader } from '../selectors/officeSelectors'
import { getHousePrimaryPolityId } from '../selectors/polityRelations'
import { getHouseControlledProvinceIds } from '../selectors/landContractSelectors'

export type AmbitionScores = {
  rebellionTendency: number
  plotTendency: number
}

export function calcAmbitionScores(state: WorldState, houseId: HouseId): AmbitionScores {
  const house = state.houses[houseId]
  if (!house) return { rebellionTendency: 0, plotTendency: 0 }

  const primaryPolityId = getHousePrimaryPolityId(state, houseId)
  if (!primaryPolityId) return { rebellionTendency: 0, plotTendency: 0 }

  const polity = state.polities[primaryPolityId]
  if (!polity) return { rebellionTendency: 0, plotTendency: 0 }

  const headId = getHouseLeader(state, house.id)
  const head = headId ? state.persons[headId] : undefined
  if (!head) return { rebellionTendency: 0, plotTendency: 0 }

  const headPolityAtt = getAttitudeOrDefault(state, head, { kind: 'polity', id: primaryPolityId })
  const headPolityLoyalty =
    (attitudeValueToScore(headPolityAtt.affection) * 0.55 +
      attitudeValueToScore(headPolityAtt.respect) * 0.45) /
    100

  const houseLoyalty = getHouseLoyaltyToPolity(state, houseId)
  const legitimacy = getPolityLegitimacy(state, primaryPolityId)

  const rebellionTendency =
    house.legacyPrestige * 0.3 +
    getHouseControlledProvinceIds(state, house.id).length * 4 +
    head.traits.ambition * 30 +
    (100 - legitimacy) * 0.3 +
    (100 - houseLoyalty) * 0.4 +
    (1.0 - headPolityLoyalty) * 30 -
    head.traits.caution * 20 -
    polity.adminPower * 0.2

  const plotTendency =
    head.traits.ambition * 30 +
    house.legacyPrestige * 0.2 +
    (100 - houseLoyalty) * 0.3 +
    (1.0 - headPolityLoyalty) * 20 -
    head.traits.caution * 15 -
    polity.adminPower * 0.1

  return { rebellionTendency, plotTendency }
}
