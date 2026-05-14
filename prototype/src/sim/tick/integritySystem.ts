import type { TickContext } from './context'
import type { RoleType } from '../types/role'
import type { CountryId, HouseId, ProvinceId, PersonId } from '../types/ids'

export function runIntegrityCheck(ctx: TickContext): TickContext {
  const state = ctx.state

  // 1. Dead persons do not hold roles
  for (const countryId of Object.keys(state.countries).sort()) {
    const country = state.countries[countryId as CountryId]
    if (!country) continue
    if (!country.active) continue

    for (const role of ['chancellor', 'general', 'treasurer'] as RoleType[]) {
      const personId = country.roleAssignments[role]
      if (personId === undefined) continue

      const person = state.persons[personId]
      if (person && !person.alive) {
        throw new Error('Dead person ' + personId + ' holds role ' + role)
      }
    }
  }

  // 2. Active house heads are alive
  for (const houseId of Object.keys(state.houses).sort()) {
    const house = state.houses[houseId as HouseId]
    if (!house || !house.active) continue

    const headPerson = state.persons[house.headId]
    if (!headPerson || !headPerson.alive) {
      throw new Error('Active house ' + houseId + ' head ' + house.headId + ' is not alive')
    }
  }

  // 3. House.provinceIds vs Province.ownerHouseId (bidirectional)
  for (const houseId of Object.keys(state.houses).sort()) {
    const house = state.houses[houseId as HouseId]
    if (!house) continue

    for (const pid of house.provinceIds) {
      const province = state.provinces[pid]
      if (!province || province.ownerHouseId !== house.id) {
        throw new Error('Province ' + pid + ' ownerHouseId mismatch with house ' + houseId)
      }
    }
  }

  for (const provinceId of Object.keys(state.provinces).sort()) {
    const province = state.provinces[provinceId as ProvinceId]
    if (!province) continue

    const house = state.houses[province.ownerHouseId]
    if (!house || !house.provinceIds.includes(province.id)) {
      throw new Error('House ' + province.ownerHouseId + ' missing province ' + provinceId)
    }
  }

  // 4. Province.countryId vs ownerHouse.countryId
  for (const provinceId of Object.keys(state.provinces).sort()) {
    const province = state.provinces[provinceId as ProvinceId]
    if (!province) continue

    const ownerHouse = state.houses[province.ownerHouseId]
    if (!ownerHouse) {
      throw new Error('Province ' + provinceId + ' has no owner house')
    }
    if (ownerHouse.countryId !== province.countryId) {
      throw new Error('Province ' + provinceId + ' countryId mismatch')
    }
  }

  // 5. Alive Person.countryId vs House.countryId
  for (const personId of Object.keys(state.persons).sort()) {
    const person = state.persons[personId as PersonId]
    if (!person || !person.alive) continue

    const house = state.houses[person.houseId]
    if (!house) {
      throw new Error('Person ' + personId + ' has no house')
    }
    if (house.countryId !== person.countryId) {
      throw new Error('Person ' + personId + ' countryId mismatch with house')
    }
  }

  // 6. Country.rulerHouseId points to active house
  for (const countryId of Object.keys(state.countries).sort()) {
    const country = state.countries[countryId as CountryId]
    if (!country) continue
    if (!country.active) continue

    const house = state.houses[country.rulerHouseId]
    if (!house || !house.active) {
      throw new Error(
        'Country ' + countryId + ' rulerHouseId ' + country.rulerHouseId + ' is not active',
      )
    }
  }

  return ctx
}
