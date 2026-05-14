import type { TickContext } from './context'
import { makeEventId, makePersonId } from './context'
import { randomFloat, randomInt } from '../rng/rng'
import { personNamePool, pickName } from '../worldgen/nameGenerators'
import type { Person } from '../types/person'
import type { PersonId, HouseId, CountryId } from '../types/ids'
import type { SimEvent } from '../types/event'

function createPerson(
  ctx: TickContext,
  name: string,
  age: number,
  admin: number,
  martial: number,
  prestige: number,
  ambition: number,
  loyalty: number,
  caution: number,
  houseId: HouseId,
  countryId: CountryId,
): { person: Person; personId: PersonId; updatedCtx: TickContext } {
  const { id: personId, ctx: updatedCtx } = makePersonId(ctx)

  const person: Person = {
    id: personId,
    name,
    age,
    alive: true,
    houseId,
    countryId,
    prestige,
    stats: { admin, martial },
    traits: {
      ambition,
      loyaltyToCountry: loyalty,
      caution,
    },
  }

  return { person, personId, updatedCtx }
}

export function runEmergenceSystem(ctx: TickContext): TickContext {
  let currentCtx = ctx
  let currentState = ctx.state

  // SUB-PHASE A: Immediate replenishment for houses with 0 living members
  for (const houseId of Object.keys(ctx.state.houses).sort()) {
    const house = currentState.houses[houseId as HouseId]
    if (!house || !house.active) continue

    const livingCount = house.memberIds.filter(
      (id: PersonId) => currentState.persons[id]?.alive === true,
    ).length
    if (livingCount !== 0) continue

    const { value: rngAge, rng: rng1 } = randomInt(currentCtx.rng, 25, 45)
    const { value: rngAdmin, rng: rng2 } = randomInt(rng1, 1, 8)
    const { value: rngMartial, rng: rng3 } = randomInt(rng2, 1, 8)
    const { value: rngAmbition, rng: rng4 } = randomFloat(rng3)
    const { value: rngLoyalty, rng: rng5 } = randomFloat(rng4)
    const { value: rngCautious, rng: rng6 } = randomFloat(rng5)
    const { value: rngPrestige, rng: rng7 } = randomInt(rng6, 10, 25)
    const { name, rng: rng8 } = pickName(personNamePool(), rng7)

    const {
      person,
      personId,
      updatedCtx: updatedCtx1,
    } = createPerson(
      { ...currentCtx, rng: rng8 },
      name,
      rngAge,
      rngAdmin,
      rngMartial,
      rngPrestige,
      rngAmbition,
      rngLoyalty,
      rngCautious,
      house.id,
      house.countryId,
    )

    const newPersons = { ...currentState.persons }
    newPersons[personId] = person

    const newHouses = { ...currentState.houses }
    newHouses[house.id] = { ...house, memberIds: [...house.memberIds, personId] }

    currentState = { ...currentState, persons: newPersons, houses: newHouses }
    currentCtx = { ...updatedCtx1, state: currentState, rng: rng7 }

    const { id: eventId, ctx: eventCtx } = makeEventId(currentCtx)
    const event = {
      id: eventId,
      year: currentState.currentYear,
      month: currentState.currentMonth,
      type: 'PERSON_EMERGED' as const,
      importance: 'minor' as const,
      actorIds: [personId],
      houseIds: [house.id],
      countryIds: [house.countryId],
      provinceIds: [],
      summary: name + ' has emerged in house ' + house.name + '.',
      reasons: [],
      effects: [],
    }

    const newEvents = [...currentCtx.events, event] as SimEvent[]
    currentState = { ...currentState }
    currentCtx = { ...eventCtx, state: currentState, events: newEvents }
  }

  // SUB-PHASE B: Normal replenishment (January only)
  if (currentState.currentMonth === 1) {
    for (const houseId of Object.keys(currentState.houses).sort()) {
      const house = currentState.houses[houseId as HouseId]
      if (!house || !house.active) continue

      const livingCount = house.memberIds.filter(
        (id: PersonId) => currentState.persons[id]?.alive === true,
      ).length
      if (livingCount >= ctx.config.minLivingMembersPerHouse) continue

      const deficit = ctx.config.minLivingMembersPerHouse - livingCount
      const toAdd = Math.min(deficit, ctx.config.maxNewPersonsPerHousePerYear)

      for (let i = 0; i < toAdd; i++) {
        const { value: rngAge, rng: rng1 } = randomInt(currentCtx.rng, 16, 30)
        const { value: rngAdmin, rng: rng2 } = randomInt(rng1, 0, 10)
        const { value: rngMartial, rng: rng3 } = randomInt(rng2, 0, 10)
        const { value: rngAmbition, rng: rng4 } = randomFloat(rng3)
        const { value: rngLoyalty, rng: rng5 } = randomFloat(rng4)
        const { value: rngCautious, rng: rng6 } = randomFloat(rng5)
        const { value: rngPrestige, rng: rng7 } = randomInt(rng6, 0, 10)
        const { name, rng: rng8 } = pickName(personNamePool(), rng7)

        const {
          person,
          personId,
          updatedCtx: updatedCtx1,
        } = createPerson(
          { ...currentCtx, rng: rng8 },
          name,
          rngAge,
          rngAdmin,
          rngMartial,
          rngPrestige,
          rngAmbition,
          rngLoyalty,
          rngCautious,
          house.id,
          house.countryId,
        )

        const newPersons = { ...currentState.persons }
        newPersons[personId] = person

        // Re-read house from currentState to get updated memberIds
        const currentHouse = currentState.houses[house.id] ?? house
        const newHouses = { ...currentState.houses }
        newHouses[house.id] = { ...currentHouse, memberIds: [...currentHouse.memberIds, personId] }

        currentState = { ...currentState, persons: newPersons, houses: newHouses }
        currentCtx = { ...updatedCtx1, state: currentState, rng: rng7 }

        const { id: eventId, ctx: eventCtx } = makeEventId(currentCtx)
        const event = {
          id: eventId,
          year: currentState.currentYear,
          month: currentState.currentMonth,
          type: 'PERSON_EMERGED' as const,
          importance: 'minor' as const,
          actorIds: [personId],
          houseIds: [house.id],
          countryIds: [house.countryId],
          provinceIds: [],
          summary: name + ' has emerged in house ' + house.name + '.',
          reasons: [],
          effects: [],
        }

        currentState = { ...currentState }
        const newEvents = [...currentCtx.events, event] as SimEvent[]
        currentCtx = { ...eventCtx, state: currentState, events: newEvents }
      }
    }
  }

  return currentCtx
}
