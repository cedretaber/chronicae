import type { TickContext } from '../tick/context'
import { makeCountryId } from '../tick/context'
import type { HouseId, CountryId, PersonId, ProvinceId } from '../types/ids'
import type { PopClass } from '../types/popGroup'
import type { Country } from '../types/country'
import type { WorldState } from '../types/world'
import type { StateResult, CtxResult } from './result'
import { ok, err } from './result'

export type CreateCountryInput = {
  name: string
  capitalProvinceId?: ProvinceId
  treasury?: number
  legacyPrestige?: number
  adminPower?: number
}

export function createCountry(
  ctx: TickContext,
  input: CreateCountryInput,
): CtxResult<{ countryId: CountryId }> {
  const { id: countryId, ctx: ctxWithId } = makeCountryId(ctx)

  const newCountry: Country = {
    id: countryId,
    name: input.name,
    houseIds: [],
    treasury: input.treasury ?? 0,
    adminPower: input.adminPower ?? 0,
    legacyPrestige: input.legacyPrestige ?? 0,
    active: true,
    capitalProvinceId: input.capitalProvinceId ?? ('' as ProvinceId),
  }

  const newState = {
    ...ctxWithId.state,
    countries: { ...ctxWithId.state.countries, [countryId]: newCountry },
  }
  return ok({ ctx: { ...ctxWithId, state: newState }, value: { countryId } })
}

export function deactivateCountry(
  state: WorldState,
  countryId: CountryId,
  options?: { deactivateHouses?: boolean },
): StateResult {
  const country = state.countries[countryId]
  if (!country)
    return err({
      code: 'COUNTRY_NOT_FOUND',
      message: 'deactivateCountry: country not found: ' + countryId,
    })

  if (!country.active) return ok(state)

  let newState = {
    ...state,
    countries: { ...state.countries, [countryId]: { ...country, active: false } },
  }

  if (options?.deactivateHouses) {
    const newHouses = { ...newState.houses }
    for (const houseId of country.houseIds) {
      const house = newHouses[houseId]
      if (house && house.active) {
        newHouses[houseId] = { ...house, active: false }
      }
    }
    newState = { ...newState, houses: newHouses }
  }

  return ok(newState)
}
import { defaultConfig } from '../config/defaultConfig'
import { clamp } from '../utils/math'
import { createOfficeAssignment } from './officeMutations'
import { getHouseLeader, getCountryRulerHouse } from '../selectors/officeSelectors'
import { generateCountryName } from '../selectors/countryNamingService'

export function moveHouseToCountry(
  state: WorldState,
  houseId: HouseId,
  newCountryId: CountryId,
): StateResult {
  const house = state.houses[houseId]
  if (!house) return err({ code: 'HOUSE_NOT_FOUND', message: 'House not found: ' + houseId })

  const oldCountry = state.countries[house.countryId]
  if (!oldCountry)
    return err({ code: 'COUNTRY_NOT_FOUND', message: 'Old country not found: ' + house.countryId })

  const newCountry = state.countries[newCountryId]
  if (!newCountry)
    return err({ code: 'COUNTRY_NOT_FOUND', message: 'New country not found: ' + newCountryId })

  const newHouses = { ...state.houses }
  newHouses[house.id] = {
    ...house,
    countryId: newCountryId,
  }

  const newCountries = { ...state.countries }
  newCountries[oldCountry.id] = {
    ...oldCountry,
    houseIds: oldCountry.houseIds.filter((id) => id !== houseId),
  }
  newCountries[newCountry.id] = {
    ...newCountry,
    houseIds: newCountry.houseIds.includes(houseId)
      ? newCountry.houseIds
      : [...newCountry.houseIds, houseId],
  }

  const newProvinces = { ...state.provinces } as typeof state.provinces
  for (const provinceId of Object.keys(state.provinces).sort()) {
    const province = state.provinces[provinceId as ProvinceId]
    if (!province) continue
    if (province.ownerHouseId === houseId) {
      newProvinces[provinceId as ProvinceId] = {
        ...province,
        countryId: newCountryId,
      }
    }
  }

  const newPersons = { ...state.persons } as typeof state.persons
  for (const personId of Object.keys(state.persons).sort()) {
    const person = state.persons[personId as PersonId]
    if (!person) continue
    if (person.houseId === houseId) {
      newPersons[personId as PersonId] = {
        ...person,
        countryId: newCountryId,
      }
    }
  }

  return ok({
    ...state,
    houses: newHouses,
    countries: newCountries,
    provinces: newProvinces,
    persons: newPersons,
  })
}

export function annexCountry(
  state: WorldState,
  defeatedCountryId: CountryId,
  winnerCountryId: CountryId,
): WorldState {
  const defeatedCountry = state.countries[defeatedCountryId]
  if (!defeatedCountry) return state

  const winnerCountry = state.countries[winnerCountryId]
  if (!winnerCountry || !winnerCountry.active) return state

  const winnerRulerHouseId = getCountryRulerHouse(state, winnerCountryId)
  const defeatedRulerHouseId = getCountryRulerHouse(state, defeatedCountryId)

  if (!winnerRulerHouseId || !defeatedRulerHouseId) return state

  const newProvinces = { ...state.provinces } as typeof state.provinces
  for (const provinceId of Object.keys(state.provinces).sort() as ProvinceId[]) {
    const province = state.provinces[provinceId]
    if (!province) continue
    if (province.countryId === defeatedCountryId) {
      newProvinces[provinceId] = {
        ...province,
        countryId: winnerCountryId,
        countryControl: defaultConfig.annexedCountryControl,
      }
    }
  }

  const newHouses = { ...state.houses } as typeof state.houses
  for (const houseId of Object.keys(state.houses).sort() as HouseId[]) {
    const house = state.houses[houseId]
    if (!house) continue
    if (house.countryId === defeatedCountryId) {
      newHouses[houseId] = { ...house, countryId: winnerCountryId }
    }
  }

  const defeatedRulerHouse = newHouses[defeatedRulerHouseId]
  if (defeatedRulerHouse) {
    const seatProvinceId = defeatedRulerHouse.seatProvinceId
    const seatProvince = newProvinces[seatProvinceId]
    if (seatProvince) {
      newProvinces[seatProvinceId] = {
        ...seatProvince,
        ownerHouseId: defeatedRulerHouseId,
      }
    }

    const winnerRulerHouse = newHouses[winnerRulerHouseId]
    if (winnerRulerHouse) {
      const newWinnerProvinceIds = [...winnerRulerHouse.provinceIds]
      const newDefeatedProvinceIds: ProvinceId[] = []

      for (const provinceId of defeatedRulerHouse.provinceIds) {
        const province = newProvinces[provinceId]
        if (!province) continue
        if (provinceId === seatProvinceId) {
          newDefeatedProvinceIds.push(provinceId)
        } else {
          newWinnerProvinceIds.push(provinceId)
          newProvinces[provinceId] = {
            ...province,
            ownerHouseId: winnerRulerHouseId,
            houseControl: defaultConfig.newRulerHouseControl,
          }
        }
      }

      newHouses[winnerRulerHouseId] = {
        ...winnerRulerHouse,
        provinceIds: newWinnerProvinceIds,
      }
      newHouses[defeatedRulerHouseId] = {
        ...defeatedRulerHouse,
        provinceIds: newDefeatedProvinceIds,
      }
    }
  }

  const newPersons = { ...state.persons }
  for (const personId of Object.keys(state.persons).sort() as PersonId[]) {
    const person = state.persons[personId]
    if (!person) continue
    if (person.countryId === defeatedCountryId) {
      newPersons[personId] = { ...person, countryId: winnerCountryId }
    }
  }

  const newWinnerHouseIds = [...new Set([...winnerCountry.houseIds, ...defeatedCountry.houseIds])]
  const newWinnerCountry = {
    ...winnerCountry,
    houseIds: newWinnerHouseIds,
  }

  const newDefeatedCountry = {
    ...defeatedCountry,
    active: false,
  }

  return {
    ...state,
    provinces: newProvinces,
    houses: newHouses,
    persons: newPersons,
    countries: {
      ...state.countries,
      [winnerCountryId]: newWinnerCountry,
      [defeatedCountryId]: newDefeatedCountry,
    },
  }
}

export function createCountryFromHouse(
  state: WorldState,
  rebelHouseId: HouseId,
  newCountryId: CountryId,
  name?: string,
): WorldState {
  const rebelHouse = state.houses[rebelHouseId]
  if (!rebelHouse) return state

  const oldCountry = state.countries[rebelHouse.countryId]
  if (!oldCountry) return state

  const countryName = name ?? rebelHouse.name + '領'

  const newCountry: Country = {
    id: newCountryId,
    name: countryName,
    houseIds: [rebelHouseId],
    treasury: Math.floor(rebelHouse.wealth * 0.5),
    legacyPrestige: 20,
    adminPower: 0,
    active: true,
    capitalProvinceId: rebelHouse.seatProvinceId,
  }

  const countriesWithNew = { ...state.countries, [newCountryId]: newCountry }
  const stateWithNew = { ...state, countries: countriesWithNew }

  const leaderId =
    getHouseLeader(stateWithNew, rebelHouseId) ??
    rebelHouse.memberIds.find((id) => {
      const p = stateWithNew.persons[id]
      return p && p.alive
    })
  const stateWithLeader = leaderId
    ? createOfficeAssignment(
        stateWithNew,
        { kind: 'country', id: newCountryId },
        'leader',
        leaderId,
      )
    : stateWithNew

  const moveResult = moveHouseToCountry(stateWithLeader, rebelHouseId, newCountryId)
  const movedState: WorldState = moveResult.ok ? moveResult.value : stateWithLeader

  const updatedOldCountry = movedState.countries[oldCountry.id]
  if (!updatedOldCountry) return movedState

  const penalizedOldCountry = {
    ...updatedOldCountry,
    legacyPrestige: clamp(updatedOldCountry.legacyPrestige - 10, 0, 100),
    adminPower: clamp(updatedOldCountry.adminPower - 5, 0, 100),
  }

  const capProv = movedState.provinces[penalizedOldCountry.capitalProvinceId]
  const finalOldCountry: Country =
    penalizedOldCountry.capitalProvinceId !== ('' as ProvinceId) &&
    (!capProv || capProv.countryId !== oldCountry.id)
      ? {
          ...penalizedOldCountry,
          capitalProvinceId: (Object.values(movedState.provinces).find(
            (p) => p !== undefined && p.countryId === oldCountry.id,
          )?.id ?? '') as ProvinceId,
        }
      : penalizedOldCountry

  const hasActiveHouses = finalOldCountry.houseIds.some((hid) => {
    const h = movedState.houses[hid]
    return h && h.active
  })
  const resolvedOldCountry = hasActiveHouses
    ? finalOldCountry
    : { ...finalOldCountry, active: false }

  return {
    ...movedState,
    countries: {
      ...movedState.countries,
      [oldCountry.id]: resolvedOldCountry,
    },
  }
}

export function createCountryFromProvinces(
  ctx: TickContext,
  params: {
    provinceIds: ProvinceId[]
    rulerHouseId: HouseId
    capitalProvinceId: ProvinceId
    sourceCountryId: CountryId
    founderPersonId?: PersonId
    rebelClass?: PopClass
  },
): { country: Country; ctx: TickContext } {
  const { id, ctx: ctx1 } = makeCountryId(ctx)

  const { name, rng: rng1 } = generateCountryName(ctx1.state, ctx1.config, ctx1.rng, {
    origin: 'province_revolt_independence',
    capitalProvinceId: params.capitalProvinceId,
    rulingHouseId: params.rulerHouseId,
    sourceCountryId: params.sourceCountryId,
    ...(params.provinceIds !== undefined && { provinceIds: params.provinceIds }),
    ...(params.founderPersonId !== undefined && { founderPersonId: params.founderPersonId }),
    ...(params.rebelClass !== undefined && { rebelClass: params.rebelClass }),
  })
  const finalCtx = { ...ctx1, rng: rng1 }

  const country: Country = {
    id,
    name,
    houseIds: [params.rulerHouseId],
    treasury: finalCtx.config.revoltCountryInitialTreasury,
    legacyPrestige: finalCtx.config.revoltCountryInitialLegacyPrestige,
    adminPower: 0,
    active: true,
    capitalProvinceId: params.capitalProvinceId,
  }

  const stateWithCountry = {
    ...finalCtx.state,
    countries: { ...finalCtx.state.countries, [id]: country },
  }

  const leaderPersonId = params.founderPersonId
  const stateWithLeader = leaderPersonId
    ? createOfficeAssignment(stateWithCountry, { kind: 'country', id }, 'leader', leaderPersonId)
    : stateWithCountry

  return { country, ctx: { ...finalCtx, state: stateWithLeader } }
}
