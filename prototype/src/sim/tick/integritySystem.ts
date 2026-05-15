import type { TickContext } from './context'
import type { RoleType } from '../types/role'
import type { CountryId, HouseId, ProvinceId, PersonId, PopGroupId } from '../types/ids'

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

  // 6. Province.development is in range -100..100
  for (const provinceId of Object.keys(state.provinces).sort()) {
    const province = state.provinces[provinceId as ProvinceId]
    if (!province) continue
    if (province.development < -100 || province.development > 100) {
      throw new Error(
        'Province ' + provinceId + ' development out of range: ' + province.development,
      )
    }
  }

  // 7. Country.rulerHouseId points to active house
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

  // 8. Country.capitalProvinceId belongs to that country
  for (const countryId of Object.keys(state.countries).sort()) {
    const country = state.countries[countryId as CountryId]
    if (!country || !country.active) continue
    if (country.capitalProvinceId === ('' as ProvinceId)) continue

    const province = state.provinces[country.capitalProvinceId]
    if (!province || province.countryId !== country.id) {
      throw new Error(
        'Country ' +
          countryId +
          ' capitalProvinceId ' +
          country.capitalProvinceId +
          ' does not belong to this country',
      )
    }
  }

  // 9. House.seatProvinceId is in house.provinceIds
  for (const houseId of Object.keys(state.houses).sort()) {
    const house = state.houses[houseId as HouseId]
    if (!house || !house.active) continue
    if (house.seatProvinceId === ('' as ProvinceId)) continue

    if (!house.provinceIds.includes(house.seatProvinceId)) {
      throw new Error(
        'House ' + houseId + ' seatProvinceId ' + house.seatProvinceId + ' not in provinceIds',
      )
    }
  }

  // 10. Province.countryControl is in 0..100
  for (const provinceId of Object.keys(state.provinces).sort()) {
    const province = state.provinces[provinceId as ProvinceId]
    if (!province) continue
    if (province.countryControl < 0 || province.countryControl > 100) {
      throw new Error(
        'Province ' + provinceId + ' countryControl out of range: ' + province.countryControl,
      )
    }
  }

  // 11. Province.houseControl is in 0..100
  for (const provinceId of Object.keys(state.provinces).sort()) {
    const province = state.provinces[provinceId as ProvinceId]
    if (!province) continue
    if (province.houseControl < 0 || province.houseControl > 100) {
      throw new Error(
        'Province ' + provinceId + ' houseControl out of range: ' + province.houseControl,
      )
    }
  }

  // 12. sex field is valid
  for (const personId of Object.keys(state.persons).sort()) {
    const person = state.persons[personId as PersonId]
    if (!person) continue
    if (person.sex !== 'male' && person.sex !== 'female') {
      throw new Error('Person ' + personId + ' has invalid sex: ' + (person.sex as string))
    }
  }

  // 13. spouse relationship is bidirectional and valid (alive persons only)
  for (const personId of Object.keys(state.persons).sort()) {
    const person = state.persons[personId as PersonId]
    if (!person || !person.alive || person.spouseId === undefined) continue

    if ((person.id as string) === (person.spouseId as string)) {
      throw new Error('Person ' + personId + ' is their own spouse')
    }
    const spouse = state.persons[person.spouseId]
    if (!spouse) {
      throw new Error('Person ' + personId + ' spouseId ' + person.spouseId + ' not found')
    }
    if ((spouse.spouseId as string | undefined) !== (person.id as string)) {
      throw new Error('Person ' + personId + ' spouse ' + person.spouseId + ' does not point back')
    }
  }

  // 14. living person's spouseId does not point to a dead person
  for (const personId of Object.keys(state.persons).sort()) {
    const person = state.persons[personId as PersonId]
    if (!person || !person.alive) continue
    if (person.spouseId === undefined) continue

    const spouse = state.persons[person.spouseId]
    if (spouse && !spouse.alive) {
      throw new Error('Alive person ' + personId + ' spouseId ' + person.spouseId + ' is dead')
    }
  }

  // 15. parent-child relationships are bidirectional
  for (const personId of Object.keys(state.persons).sort()) {
    const person = state.persons[personId as PersonId]
    if (!person) continue

    if (person.fatherId !== undefined) {
      const father = state.persons[person.fatherId]
      if (!father) {
        throw new Error('Person ' + personId + ' fatherId ' + person.fatherId + ' not found')
      }
      if (father.sex !== 'male') {
        throw new Error('Person ' + personId + ' father is not male')
      }
      if (!father.childIds.some((cid) => (cid as string) === (person.id as string))) {
        throw new Error('Father ' + person.fatherId + ' missing child ' + personId)
      }
    }

    if (person.motherId !== undefined) {
      const mother = state.persons[person.motherId]
      if (!mother) {
        throw new Error('Person ' + personId + ' motherId ' + person.motherId + ' not found')
      }
      if (mother.sex !== 'female') {
        throw new Error('Person ' + personId + ' mother is not female')
      }
      if (!mother.childIds.some((cid) => (cid as string) === (person.id as string))) {
        throw new Error('Mother ' + person.motherId + ' missing child ' + personId)
      }
    }
  }

  // 16. house cadet relationships are bidirectional
  for (const houseId of Object.keys(state.houses).sort()) {
    const house = state.houses[houseId as HouseId]
    if (!house || house.parentHouseId === undefined) continue

    const parent = state.houses[house.parentHouseId]
    if (!parent) {
      throw new Error('House ' + houseId + ' parentHouseId ' + house.parentHouseId + ' not found')
    }
    if (!parent.cadetHouseIds.some((cid) => (cid as string) === houseId)) {
      throw new Error('Parent house ' + house.parentHouseId + ' missing cadet ' + houseId)
    }
  }

  // POP-1: PopGroup.provinceId points to valid Province
  for (const popGroupId of Object.keys(state.popGroups).sort()) {
    const pop = state.popGroups[popGroupId as PopGroupId]
    if (!pop) continue
    const province = state.provinces[pop.provinceId]
    if (!province) {
      throw new Error('PopGroup ' + popGroupId + ' provinceId ' + pop.provinceId + ' not found')
    }
  }

  // POP-2 & POP-3: Province.popGroupIds <-> PopGroup.provinceId bidirectional
  for (const provinceId of Object.keys(state.provinces).sort()) {
    const province = state.provinces[provinceId as ProvinceId]
    if (!province) continue
    for (const popGroupId of province.popGroupIds) {
      const pop = state.popGroups[popGroupId]
      if (!pop) {
        throw new Error('Province ' + provinceId + ' popGroupId ' + popGroupId + ' not found')
      }
      if ((pop.provinceId as string) !== provinceId) {
        throw new Error(
          'PopGroup ' + popGroupId + ' provinceId mismatch with province ' + provinceId,
        )
      }
    }
  }

  // POP-4: Each Province has exactly one of each class
  for (const provinceId of Object.keys(state.provinces).sort()) {
    const province = state.provinces[provinceId as ProvinceId]
    if (!province) continue
    const classCounts: Record<string, number> = {}
    for (const popGroupId of province.popGroupIds) {
      const pop = state.popGroups[popGroupId]
      if (!pop) continue
      classCounts[pop.class] = (classCounts[pop.class] ?? 0) + 1
    }
    for (const cls of ['peasants', 'townsmen', 'nobles'] as const) {
      if (classCounts[cls] !== 1) {
        throw new Error(
          'Province ' +
            provinceId +
            ' has ' +
            (classCounts[cls] ?? 0) +
            ' ' +
            cls +
            ' pops, expected 1',
        )
      }
    }
  }

  // POP-5: PopGroup.size >= minPopSizeByClass
  for (const popGroupId of Object.keys(state.popGroups).sort()) {
    const pop = state.popGroups[popGroupId as PopGroupId]
    if (!pop) continue
    const minSize = ctx.config.minPopSizeByClass[pop.class]
    if (pop.size < minSize) {
      throw new Error('PopGroup ' + popGroupId + ' size ' + pop.size + ' below minimum ' + minSize)
    }
  }

  // POP-6: PopGroup.wealth in 0..100
  for (const popGroupId of Object.keys(state.popGroups).sort()) {
    const pop = state.popGroups[popGroupId as PopGroupId]
    if (!pop) continue
    if (pop.wealth < 0 || pop.wealth > 100) {
      throw new Error('PopGroup ' + popGroupId + ' wealth out of range: ' + pop.wealth)
    }
  }

  // POP-7: PopGroup.unrest in 0..100
  for (const popGroupId of Object.keys(state.popGroups).sort()) {
    const pop = state.popGroups[popGroupId as PopGroupId]
    if (!pop) continue
    if (pop.unrest < 0 || pop.unrest > 100) {
      throw new Error('PopGroup ' + popGroupId + ' unrest out of range: ' + pop.unrest)
    }
  }

  return ctx
}
