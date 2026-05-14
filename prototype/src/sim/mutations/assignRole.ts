import type { CountryId, PersonId } from '../types/ids'
import type { RoleType } from '../types/role'
import type { WorldState } from '../types/world'

const ALL_ROLES: RoleType[] = ['chancellor', 'general', 'treasurer']

export function assignRole(
  state: WorldState,
  countryId: CountryId,
  role: RoleType,
  personId: PersonId,
): WorldState {
  const person = state.persons[personId]
  if (!person) throw new Error('Person not found')
  if (!person.alive) throw new Error('Person is not alive')

  if (person.countryId !== countryId) {
    throw new Error('Person is not in the specified country')
  }

  const house = state.houses[person.houseId]
  if (!house) throw new Error('House not found')
  if (!house.active) throw new Error('House is not active')

  for (const country of Object.values(state.countries)) {
    for (const r of ALL_ROLES) {
      if (country.roleAssignments[r] === personId) {
        throw new Error('Person already has a role in a country')
      }
    }
  }

  const newCountries = { ...state.countries }
  const country = newCountries[countryId]
  if (!country) throw new Error('Country not found')
  newCountries[countryId] = {
    ...country,
    roleAssignments: { ...country.roleAssignments, [role]: personId },
  }

  return {
    ...state,
    countries: newCountries,
  }
}

export function revokeRole(state: WorldState, countryId: CountryId, role: RoleType): WorldState {
  const country = state.countries[countryId]
  if (!country) throw new Error('Country not found')

  const remaining = { ...country.roleAssignments }
  delete remaining[role]

  const newCountries = { ...state.countries }
  newCountries[countryId] = {
    ...country,
    roleAssignments: remaining,
  }

  return {
    ...state,
    countries: newCountries,
  }
}
