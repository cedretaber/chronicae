import type { TickContext } from './context'
import { makeEventId } from './context'
import { transferProvinceToHouse } from '../mutations/transferProvince'
import type { HouseId } from '../types/ids'
import type { SimEvent } from '../types/event'

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
        .sort((a, b) => b.prestige - a.prestige)[0]?.id ?? null)

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

  const extinctionUnrestGain = resultCtx.config.extinctionUnrestGain
  const inheritedControl = resultCtx.config.inheritedProvinceHouseControl

  let unrestChainState = chainState
  for (const pid of sortedProvinceIds) {
    const province = unrestChainState.provinces[pid]
    if (!province) continue
    const newUnrest = Math.min(100, province.unrest + extinctionUnrestGain)
    const newProvinces = { ...unrestChainState.provinces }
    newProvinces[pid] = { ...province, unrest: newUnrest }
    unrestChainState = { ...unrestChainState, provinces: newProvinces }
  }

  let controlChainState = unrestChainState
  for (const pid of sortedProvinceIds) {
    const province = controlChainState.provinces[pid]
    if (!province) continue
    const newProvinces = { ...controlChainState.provinces }
    newProvinces[pid] = { ...province, houseControl: inheritedControl }
    controlChainState = { ...controlChainState, provinces: newProvinces }
  }

  resultCtx = { ...resultCtx, state: controlChainState }

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

  const currentCountry = resultCtx.state.countries[house.countryId]
  if (!currentCountry) return resultCtx

  const newLegitimacy = Math.max(
    0,
    currentCountry.legitimacy - resultCtx.config.rulerHouseExtinctionLegitimacyLoss,
  )
  const newStability = Math.max(
    0,
    currentCountry.stability - resultCtx.config.rulerHouseExtinctionStabilityLoss,
  )

  const newCountries = { ...resultCtx.state.countries }
  newCountries[house.countryId] = {
    ...currentCountry,
    legitimacy: newLegitimacy,
    stability: newStability,
  }

  resultCtx = { ...resultCtx, state: { ...resultCtx.state, countries: newCountries } }

  const candidateHouses = Object.values(resultCtx.state.houses)
    .filter(
      (h): h is import('../types/house').House =>
        h !== null && h.active && h.countryId === house.countryId && h.id !== houseId,
    )
    .sort((a, b) => b.prestige - a.prestige)

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

    let unrestChainState = transferChainState
    for (const pid of sortedProvinceIds) {
      const province = unrestChainState.provinces[pid]
      if (!province) continue
      const newUnrest = Math.min(100, province.unrest + resultCtx.config.extinctionUnrestGain)
      const newProvinces = { ...unrestChainState.provinces }
      newProvinces[pid] = { ...province, unrest: newUnrest }
      unrestChainState = { ...unrestChainState, provinces: newProvinces }
    }

    const inheritedControl = resultCtx.config.inheritedProvinceHouseControl
    let controlChainState = unrestChainState
    for (const pid of sortedProvinceIds) {
      const province = controlChainState.provinces[pid]
      if (!province) continue
      const newProvinces = { ...controlChainState.provinces }
      newProvinces[pid] = { ...province, houseControl: inheritedControl }
      controlChainState = { ...controlChainState, provinces: newProvinces }
    }

    const newHouses = { ...controlChainState.houses }
    const houseToExtinct = newHouses[houseId]
    if (houseToExtinct) {
      newHouses[houseId] = { ...houseToExtinct, active: false, memberIds: [], provinceIds: [] }
    }

    const newCountry = controlChainState.countries[house.countryId]
    if (newCountry) {
      const newCountries2 = { ...controlChainState.countries }
      newCountries2[house.countryId] = {
        ...newCountry,
        houseIds: newCountry.houseIds.filter((id: HouseId) => id !== houseId),
      }
      const finalState = { ...controlChainState, houses: newHouses, countries: newCountries2 }

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
