import type { TickContext } from './context'
import { makeEventId } from './context'
import { transferProvinceToHouse } from '../mutations/transferProvince'
import type { HouseId } from '../types/ids'
import type { SimEvent } from '../types/event'
import type { WorldState } from '../types/world'
import { createLogger } from '../debug/logger'
import { adjustCountryLegacyPrestige } from '../helpers/attitudeHelpers'

function moveLivingMembersToHouse(
  state: WorldState,
  fromHouseId: HouseId,
  toHouseId: HouseId,
): WorldState {
  if (fromHouseId === toHouseId) return state

  const fromHouse = state.houses[fromHouseId]
  if (!fromHouse) return state

  const toHouse = state.houses[toHouseId]
  if (!toHouse) return state

  const livingMemberIds = fromHouse.memberIds.filter((id) => {
    const p = state.persons[id]
    return p && p.alive
  })

  if (livingMemberIds.length === 0) return state

  const newPersons = { ...state.persons }
  for (const pid of livingMemberIds) {
    const person = newPersons[pid]
    if (!person) continue
    newPersons[pid] = { ...person, houseId: toHouseId, countryId: toHouse.countryId }
  }

  const newHouses = { ...state.houses }
  newHouses[toHouseId] = {
    ...toHouse,
    memberIds: [...toHouse.memberIds, ...livingMemberIds],
  }

  return { ...state, persons: newPersons, houses: newHouses }
}

export function extinctHouseAfterFailedSuccession(ctx: TickContext, houseId: HouseId): TickContext {
  const house = ctx.state.houses[houseId]
  if (!house) return ctx

  const country = ctx.state.countries[house.countryId]
  if (!country) return ctx

  if (house.id === country.rulerHouseId) {
    return handleRulerHouseExtinction(ctx, houseId)
  }

  return handleNormalHouseExtinction(ctx, houseId)
}

function handleNormalHouseExtinction(ctx: TickContext, houseId: HouseId): TickContext {
  const house = ctx.state.houses[houseId]
  if (!house) return ctx

  const country = ctx.state.countries[house.countryId]
  if (!country) return ctx

  const rulerHouse = ctx.state.houses[country.rulerHouseId]
  const receiverHouseId = rulerHouse?.active
    ? country.rulerHouseId
    : (Object.values(ctx.state.houses)
        .filter(
          (h): h is import('../types/house').House =>
            h !== null && h.active && h.countryId === house.countryId && h.id !== houseId,
        )
        .sort((a, b) => b.legacyPrestige - a.legacyPrestige)[0]?.id ?? null)

  if (!receiverHouseId) {
    const newHouses = { ...ctx.state.houses }
    const extinctHouse = newHouses[houseId]
    if (!extinctHouse) return ctx
    newHouses[houseId] = { ...extinctHouse, active: false, memberIds: [] }
    const newCountries = { ...ctx.state.countries }
    const extinctCountry = newCountries[house.countryId]
    if (extinctCountry) {
      newCountries[house.countryId] = { ...extinctCountry, active: false }
    }
    return { ...ctx, state: { ...ctx.state, houses: newHouses, countries: newCountries } }
  }

  let resultCtx = ctx
  const sortedProvinceIds = [...house.provinceIds].sort()

  let chainState = resultCtx.state
  for (const pid of sortedProvinceIds) {
    chainState = transferProvinceToHouse(chainState, pid, receiverHouseId)
  }

  const inheritedControl = resultCtx.config.inheritedProvinceHouseControl

  let controlChainState = chainState
  for (const pid of sortedProvinceIds) {
    const province = controlChainState.provinces[pid]
    if (!province) continue
    const newProvinces = { ...controlChainState.provinces }
    newProvinces[pid] = { ...province, houseControl: inheritedControl }
    controlChainState = { ...controlChainState, provinces: newProvinces }
  }

  resultCtx = { ...resultCtx, state: controlChainState }

  const stateAfterMove = moveLivingMembersToHouse(resultCtx.state, houseId, receiverHouseId)
  resultCtx = { ...resultCtx, state: stateAfterMove }

  const newHouses = { ...resultCtx.state.houses }
  const extinctHouse = newHouses[houseId]
  if (!extinctHouse) return resultCtx
  newHouses[houseId] = {
    ...extinctHouse,
    active: false,
    memberIds: [],
    provinceIds: [],
  }

  const newCountries = { ...resultCtx.state.countries }
  const targetCountry = newCountries[house.countryId]
  if (targetCountry) {
    newCountries[house.countryId] = {
      ...targetCountry,
      houseIds: targetCountry.houseIds.filter((id: HouseId) => id !== houseId),
    }
  }

  const finalState = { ...resultCtx.state, houses: newHouses, countries: newCountries }

  const { id: eventId, ctx: eventCtx } = makeEventId({ ...resultCtx, state: finalState })
  const event: SimEvent = {
    id: eventId,
    year: finalState.currentYear,
    month: finalState.currentMonth,
    type: 'HOUSE_EXTINCT',
    importance: 'major',
    actorIds: [],
    houseIds: [houseId],
    countryIds: [house.countryId],
    provinceIds: [...house.provinceIds],
    summary: `${house.name} has become extinct.`,
    reasons: [],
    effects: [],
  }

  const log = createLogger(ctx.config.debug)
  log.log('HOUSE_EXTINCT', {
    year: finalState.currentYear,
    month: finalState.currentMonth,
    house: houseId,
    type: 'normal',
    receiver: receiverHouseId,
  })

  return { ...eventCtx, state: finalState, events: [...eventCtx.events, event] }
}

function handleRulerHouseExtinction(ctx: TickContext, houseId: HouseId): TickContext {
  const house = ctx.state.houses[houseId]
  if (!house) return ctx

  const country = ctx.state.countries[house.countryId]
  if (!country) return ctx

  let resultCtx = ctx

  const { id: rulerEventId, ctx: rulerEventCtx } = makeEventId({
    ...resultCtx,
    state: resultCtx.state,
  })
  const rulerEvent: SimEvent = {
    id: rulerEventId,
    year: resultCtx.state.currentYear,
    month: resultCtx.state.currentMonth,
    type: 'RULER_HOUSE_EXTINCT',
    importance: 'major',
    actorIds: [],
    houseIds: [houseId],
    countryIds: [house.countryId],
    provinceIds: [...house.provinceIds],
    summary: `The ruler house ${house.name} has become extinct!`,
    reasons: [],
    effects: [],
  }
  resultCtx = {
    ...rulerEventCtx,
    state: resultCtx.state,
    events: [...rulerEventCtx.events, rulerEvent],
  }

  const log = createLogger(ctx.config.debug)
  log.log('HOUSE_EXTINCT', {
    year: resultCtx.state.currentYear,
    month: resultCtx.state.currentMonth,
    house: houseId,
    type: 'ruler',
    country: house.countryId,
  })

  const currentCountry = resultCtx.state.countries[house.countryId]
  if (!currentCountry) return resultCtx

  {
    const penaltyState = adjustCountryLegacyPrestige(
      resultCtx.state,
      house.countryId,
      -resultCtx.config.rulerHouseExtinctionPrestigeLoss,
    )
    resultCtx = { ...resultCtx, state: penaltyState }
  }

  const candidateHouses = Object.values(resultCtx.state.houses)
    .filter(
      (h): h is import('../types/house').House =>
        h !== null && h.active && h.countryId === house.countryId && h.id !== houseId,
    )
    .sort((a, b) => b.legacyPrestige - a.legacyPrestige)

  const newRulerHouse = candidateHouses[0]
  if (newRulerHouse) {
    let domesticState = resultCtx.state

    const newRulerHouseId = newRulerHouse.id
    const newDomesticCountries = { ...domesticState.countries }
    const updatedCountry = newDomesticCountries[house.countryId]
    if (updatedCountry) {
      newDomesticCountries[house.countryId] = {
        ...updatedCountry,
        rulerHouseId: newRulerHouseId,
      }
    }
    domesticState = { ...domesticState, countries: newDomesticCountries }

    const sortedProvinceIds = [...house.provinceIds].sort()
    let transferChainState = domesticState
    for (const pid of sortedProvinceIds) {
      transferChainState = transferProvinceToHouse(transferChainState, pid, newRulerHouseId)
    }

    const inheritedControl = resultCtx.config.inheritedProvinceHouseControl
    let controlChainState = transferChainState
    for (const pid of sortedProvinceIds) {
      const province = controlChainState.provinces[pid]
      if (!province) continue
      const newProvinces = { ...controlChainState.provinces }
      newProvinces[pid] = { ...province, houseControl: inheritedControl }
      controlChainState = { ...controlChainState, provinces: newProvinces }
    }

    const stateAfterMemberMove = moveLivingMembersToHouse(
      controlChainState,
      houseId,
      newRulerHouseId,
    )

    const newHouses = { ...stateAfterMemberMove.houses }
    const houseToExtinct = newHouses[houseId]
    if (houseToExtinct) {
      newHouses[houseId] = { ...houseToExtinct, active: false, memberIds: [], provinceIds: [] }
    }

    const newCountry = stateAfterMemberMove.countries[house.countryId]
    if (newCountry) {
      const newCountries2 = { ...stateAfterMemberMove.countries }
      newCountries2[house.countryId] = {
        ...newCountry,
        houseIds: newCountry.houseIds.filter((id: HouseId) => id !== houseId),
      }
      const finalState = { ...stateAfterMemberMove, houses: newHouses, countries: newCountries2 }

      const { id: extEventId, ctx: extEventCtx } = makeEventId({ ...resultCtx, state: finalState })
      const extEvent: SimEvent = {
        id: extEventId,
        year: finalState.currentYear,
        month: finalState.currentMonth,
        type: 'HOUSE_EXTINCT',
        importance: 'major',
        actorIds: [],
        houseIds: [houseId],
        countryIds: [house.countryId],
        provinceIds: [],
        summary: `${house.name} has become extinct.`,
        reasons: [],
        effects: [],
      }
      return { ...extEventCtx, state: finalState, events: [...extEventCtx.events, extEvent] }
    }
  }

  const defunctProvinceIds: import('../types/ids').ProvinceId[] = Object.values(
    resultCtx.state.provinces,
  )
    .filter((p): p is NonNullable<typeof p> => p !== null && p.countryId === house.countryId)
    .map((p) => p.id)

  const neighborCandidateMap = new Map<import('../types/ids').CountryId, number>()
  for (const province of defunctProvinceIds) {
    const prov = resultCtx.state.provinces[province]
    if (!prov) continue
    for (const neighborId of prov.neighbors) {
      const neighbor = resultCtx.state.provinces[neighborId]
      if (!neighbor) continue
      const neighborCountryId = neighbor.countryId
      if (neighborCountryId === house.countryId) continue
      const existing = neighborCandidateMap.get(neighborCountryId) ?? 0
      neighborCandidateMap.set(neighborCountryId, existing + 1)
    }
  }

  const defunctCountryId = house.countryId
  const defunctCountry = resultCtx.state.countries[defunctCountryId]
  if (!defunctCountry) {
    const collapseHouses = { ...resultCtx.state.houses }
    const collapseHouse = collapseHouses[houseId]
    if (collapseHouse) {
      collapseHouses[houseId] = { ...collapseHouse, active: false, memberIds: [] }
    }
    const collapseCountries = { ...resultCtx.state.countries }
    const collapseCountry = collapseCountries[house.countryId]
    if (collapseCountry) {
      collapseCountries[house.countryId] = { ...collapseCountry, active: false }
    }
    return {
      ...resultCtx,
      state: { ...resultCtx.state, houses: collapseHouses, countries: collapseCountries },
    }
  }

  const provinceCountByCountry = new Map<import('../types/ids').CountryId, number>()
  for (const province of Object.values(resultCtx.state.provinces)) {
    if (!province) continue
    const existing = provinceCountByCountry.get(province.countryId) ?? 0
    provinceCountByCountry.set(province.countryId, existing + 1)
  }

  let annexerCountryId: import('../types/ids').CountryId | null = null
  let annexerScore = -Infinity
  for (const [candidateId, sharedBorderCount] of neighborCandidateMap.entries()) {
    const candidateCountry = resultCtx.state.countries[candidateId]
    if (!candidateCountry || !candidateCountry.active) continue
    const totalProvinces = provinceCountByCountry.get(candidateId) ?? 0
    const score =
      sharedBorderCount * resultCtx.config.rulerExtinctionAnnexSharedBorderWeight +
      totalProvinces * resultCtx.config.rulerExtinctionAnnexPowerWeight +
      candidateCountry.legacyPrestige * resultCtx.config.rulerExtinctionAnnexPrestigeWeight
    if (score > annexerScore) {
      annexerScore = score
      annexerCountryId = candidateId
    }
  }

  if (annexerCountryId) {
    const annexerCountry = resultCtx.state.countries[annexerCountryId]
    if (!annexerCountry) {
      const collapseHouses = { ...resultCtx.state.houses }
      const collapseHouse = collapseHouses[houseId]
      if (collapseHouse) {
        collapseHouses[houseId] = { ...collapseHouse, active: false, memberIds: [] }
      }
      const collapseCountries = { ...resultCtx.state.countries }
      const collapseCountry = collapseCountries[house.countryId]
      if (collapseCountry) {
        collapseCountries[house.countryId] = { ...collapseCountry, active: false }
      }
      return {
        ...resultCtx,
        state: { ...resultCtx.state, houses: collapseHouses, countries: collapseCountries },
      }
    }

    let annexState = resultCtx

    // Transfer the defunct house's provinces to the annexer's ruler house
    const annexerRulerHouseId = annexerCountry.rulerHouseId
    const extinctHouseProvinceIds = [...house.provinceIds].sort()
    for (const pid of extinctHouseProvinceIds) {
      annexState = {
        ...annexState,
        state: transferProvinceToHouse(annexState.state, pid, annexerRulerHouseId),
      }
    }

    // Set countryControl on all provinces belonging to the defunct country
    const newProvinces = { ...annexState.state.provinces }
    for (const pid of defunctProvinceIds) {
      const province = newProvinces[pid]
      if (!province) continue
      newProvinces[pid] = {
        ...province,
        countryId: annexerCountryId,
        countryControl: resultCtx.config.annexByRulerExtinctionCountryControl,
      }
    }
    annexState = { ...annexState, state: { ...annexState.state, provinces: newProvinces } }

    // Move living members of the extinct house to the annexer's ruler house
    annexState = {
      ...annexState,
      state: moveLivingMembersToHouse(annexState.state, houseId, annexerRulerHouseId),
    }

    // Move all non-defunct houses from the defunct country to the annexer
    const newHouses: typeof annexState.state.houses = { ...annexState.state.houses }
    for (const houseObj of Object.values(annexState.state.houses)) {
      if (!houseObj || houseObj.countryId !== defunctCountryId) continue
      if (houseObj.id === houseId) {
        newHouses[houseObj.id] = {
          ...houseObj,
          active: false,
          memberIds: [],
          countryId: annexerCountryId,
        }
      } else {
        newHouses[houseObj.id] = { ...houseObj, countryId: annexerCountryId }
      }
    }
    annexState = { ...annexState, state: { ...annexState.state, houses: newHouses } }

    const newPersons: typeof annexState.state.persons = { ...annexState.state.persons }
    for (const person of Object.values(annexState.state.persons)) {
      if (!person || person.countryId !== defunctCountryId) continue
      if (person.alive) {
        newPersons[person.id] = { ...person, countryId: annexerCountryId }
      }
    }
    annexState = { ...annexState, state: { ...annexState.state, persons: newPersons } }

    const updatedDefunctCountry = annexState.state.countries[defunctCountryId]
    const newCountries1 = { ...annexState.state.countries }
    if (updatedDefunctCountry) {
      newCountries1[defunctCountryId] = { ...updatedDefunctCountry, active: false }
    }
    const updatedAnnexerCountry = annexState.state.countries[annexerCountryId]
    const newCountries2 = { ...newCountries1 }
    if (updatedAnnexerCountry) {
      newCountries2[annexerCountryId] = {
        ...updatedAnnexerCountry,
        houseIds: [
          ...updatedAnnexerCountry.houseIds,
          ...defunctCountry.houseIds.filter((id) => id !== houseId),
        ],
      }
    }
    annexState = { ...annexState, state: { ...annexState.state, countries: newCountries2 } }

    const { id: annexEventId, ctx: annexEventCtx } = makeEventId(annexState)
    const annexEvent: import('../types/event').SimEvent = {
      id: annexEventId,
      year: annexState.state.currentYear,
      month: annexState.state.currentMonth,
      type: 'COUNTRY_ANNEXED',
      importance: 'major',
      actorIds: [],
      houseIds: [],
      countryIds: [defunctCountryId, annexerCountryId],
      provinceIds: [],
      summary: `${defunctCountry.name} has been annexed by ${annexerCountry.name}.`,
      reasons: [],
      effects: [],
    }
    return {
      ...annexEventCtx,
      state: annexState.state,
      events: [...annexEventCtx.events, annexEvent],
    }
  }

  const collapseHouses = { ...resultCtx.state.houses }
  const collapseHouse = collapseHouses[houseId]
  if (collapseHouse) {
    collapseHouses[houseId] = { ...collapseHouse, active: false, memberIds: [] }
  }
  const collapseCountries = { ...resultCtx.state.countries }
  const collapseCountry = collapseCountries[house.countryId]
  if (collapseCountry) {
    collapseCountries[house.countryId] = { ...collapseCountry, active: false }
  }
  return {
    ...resultCtx,
    state: { ...resultCtx.state, houses: collapseHouses, countries: collapseCountries },
  }
}
