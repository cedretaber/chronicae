import type { TickContext } from './context'
import { makeEventId } from './context'
import { transferProvinceToHouse } from '../mutations/transferProvince'
import type { HouseId, PersonId } from '../types/ids'
import type { SimEvent } from '../types/event'

export function runSuccessionSystem(ctx: TickContext): TickContext {
  let currentCtx = ctx

  for (const houseId of Object.keys(ctx.state.houses).sort()) {
    const house = currentCtx.state.houses[houseId as HouseId]
    if (!house || !house.active) continue

    const headPerson = currentCtx.state.persons[house.headId]
    if (headPerson && headPerson.alive) continue

    const candidates = house.memberIds
      .filter((id: PersonId) => currentCtx.state.persons[id]?.alive === true)
      .sort()

    if (candidates.length === 0) {
      const country = currentCtx.state.countries[house.countryId]
      if (!country) continue

      const rulerHouseId = country.rulerHouseId
      const sortedProvinceIds = house.provinceIds.slice().sort()

      let chainState = currentCtx.state
      for (const pid of sortedProvinceIds) {
        chainState = transferProvinceToHouse(chainState, pid, rulerHouseId)
      }

      const newHouses = { ...chainState.houses }
      const extinctHouse = newHouses[house.id]
      if (!extinctHouse) continue
      newHouses[house.id] = { ...extinctHouse, active: false }

      const newCountries = { ...chainState.countries }
      const targetCountry = newCountries[house.countryId]
      if (targetCountry) {
        newCountries[house.countryId] = {
          ...targetCountry,
          houseIds: targetCountry.houseIds.filter((id: HouseId) => id !== house.id),
        }
      }

      const newState = { ...chainState, houses: newHouses, countries: newCountries }

      const { id: eventId, ctx: eventCtx } = makeEventId({ ...currentCtx, state: newState })
      const event: SimEvent = {
        id: eventId,
        year: newState.currentYear,
        month: newState.currentMonth,
        type: 'HOUSE_EXTINCT',
        importance: 'major',
        actorIds: [],
        houseIds: [house.id],
        countryIds: [house.countryId],
        provinceIds: [...house.provinceIds],
        summary: house.name + ' has become extinct.',
        reasons: [],
        effects: [],
      }

      currentCtx = { ...eventCtx, state: newState, events: [...eventCtx.events, event] }
      continue
    }

    let bestCandidate: PersonId | null = null
    let bestScore = -Infinity

    for (const candidateId of candidates) {
      const candidate = currentCtx.state.persons[candidateId]
      if (!candidate) continue

      const score =
        candidate.age * 0.2 +
        candidate.prestige * 0.5 +
        candidate.stats.admin * 2 +
        candidate.stats.martial * 2 +
        candidate.traits.ambition * 5

      if (score > bestScore) {
        bestScore = score
        bestCandidate = candidateId
      }
    }

    if (bestCandidate !== null) {
      const bestPerson = currentCtx.state.persons[bestCandidate]
      if (!bestPerson) continue

      const newHouses = { ...currentCtx.state.houses }
      const updatedHouse = newHouses[house.id]
      if (!updatedHouse) continue
      newHouses[house.id] = { ...updatedHouse, headId: bestCandidate }

      const newState = { ...currentCtx.state, houses: newHouses }

      const { id: eventId, ctx: eventCtx } = makeEventId({ ...currentCtx, state: newState })
      const event: SimEvent = {
        id: eventId,
        year: newState.currentYear,
        month: newState.currentMonth,
        type: 'HOUSE_HEAD_CHANGED',
        importance: 'normal',
        actorIds: [bestCandidate],
        houseIds: [house.id],
        countryIds: [house.countryId],
        provinceIds: [],
        summary: bestPerson.name + ' has become the new head of ' + house.name + '.',
        reasons: [],
        effects: [],
      }

      currentCtx = { ...eventCtx, state: newState, events: [...eventCtx.events, event] }
    }
  }

  return currentCtx
}
