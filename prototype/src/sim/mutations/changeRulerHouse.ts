import type { CountryId, HouseId } from '../types/ids'
import type { WorldState } from '../types/world'
import {
  adjustCountryLegacyPrestige,
  adjustHouseLegacyPrestige,
  adjustAttitude,
  countryAttitudeKey,
  houseAttitudeKey,
} from '../helpers/attitudeHelpers'

export function changeRulerHouse(
  state: WorldState,
  countryId: CountryId,
  newRulerHouseId: HouseId,
): WorldState {
  const country = state.countries[countryId]
  if (!country) throw new Error('Country not found')

  const oldRulerHouse = state.houses[country.rulerHouseId]
  if (!oldRulerHouse) throw new Error('Old ruler house not found')

  const newRulerHouse = state.houses[newRulerHouseId]
  if (!newRulerHouse) throw new Error('New ruler house not found')

  // Apply legacyPrestige changes
  let newState = adjustHouseLegacyPrestige(state, oldRulerHouse.id, -10)
  newState = adjustHouseLegacyPrestige(newState, newRulerHouse.id, 10)
  newState = adjustCountryLegacyPrestige(newState, countryId, -5)

  // Apply attitude changes for old ruler house members
  const newPersons = { ...newState.persons }
  const countryKey = countryAttitudeKey(countryId)
  const newHouseKey = houseAttitudeKey(newRulerHouseId)
  for (const memberId of oldRulerHouse.memberIds) {
    const member = newPersons[memberId]
    if (!member || !member.alive) continue

    let memberAttitudes = member.attitudes
    memberAttitudes = adjustAttitude(memberAttitudes, countryKey, { affection: -12, respect: -8 })
    memberAttitudes = adjustAttitude(memberAttitudes, newHouseKey, { affection: -15, respect: 5 })
    newPersons[memberId] = { ...member, attitudes: memberAttitudes }
  }

  const newCountries = { ...newState.countries }
  const targetCountry = newCountries[countryId]
  if (!targetCountry) throw new Error('Country not found after adjustment')
  newCountries[countryId] = {
    ...targetCountry,
    rulerHouseId: newRulerHouseId,
    roleAssignments: {},
  }

  return {
    ...newState,
    countries: newCountries,
    persons: newPersons,
  }
}
