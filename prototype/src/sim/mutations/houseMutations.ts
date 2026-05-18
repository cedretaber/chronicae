import type { TickContext } from '../tick/context'
import { makeHouseId } from '../tick/context'
import type { HouseId, PolityId, ProvinceId, PersonId } from '../types/ids'
import type { House } from '../types/house'
import type { WorldState } from '../types/world'
import type { Person } from '../types/person'
import { ANONYMOUS_HOUSE_ID } from '../types/landContract'
import type { StateResult, CtxResult } from './result'
import { ok, err } from './result'

export type CreateHouseInput = {
  name: string
  polityId: PolityId
  seatProvinceId?: ProvinceId
  founderId?: PersonId
  parentHouseId?: HouseId
  legacyPrestige?: number
  wealth?: number
}

export function createHouse(
  ctx: TickContext,
  input: CreateHouseInput,
): CtxResult<{ houseId: HouseId }> {
  if (!ctx.state.polities[input.polityId])
    return err({
      code: 'POLITY_NOT_FOUND',
      message: 'createHouse: polity not found: ' + input.polityId,
    })

  const { id: houseId, ctx: ctxWithId } = makeHouseId(ctx)

  const houseBase: House = {
    id: houseId,
    name: input.name,
    active: true,
    memberIds: [],
    cadetHouseIds: [],
    legacyPrestige: input.legacyPrestige ?? 0,
    wealth: input.wealth ?? 0,
    seatProvinceId: input.seatProvinceId ?? ('' as ProvinceId),
  }
  const houseWithOptionals: House = {
    ...houseBase,
    ...(input.founderId !== undefined && { founderId: input.founderId }),
    ...(input.parentHouseId !== undefined && { parentHouseId: input.parentHouseId }),
  }

  if (input.parentHouseId !== undefined) {
    const parentHouse = ctxWithId.state.houses[input.parentHouseId]
    if (parentHouse) {
      const newHouses = {
        ...ctxWithId.state.houses,
        [houseId]: houseWithOptionals,
        [input.parentHouseId]: {
          ...parentHouse,
          cadetHouseIds: [...parentHouse.cadetHouseIds, houseId],
        },
      }
      const newState = { ...ctxWithId.state, houses: newHouses }
      return ok({ ctx: { ...ctxWithId, state: newState }, value: { houseId } })
    }
  }

  const newState = {
    ...ctxWithId.state,
    houses: { ...ctxWithId.state.houses, [houseId]: houseWithOptionals },
  }
  return ok({ ctx: { ...ctxWithId, state: newState }, value: { houseId } })
}

export function deactivateHouse(state: WorldState, houseId: HouseId): StateResult {
  const house = state.houses[houseId]
  if (!house)
    return err({
      code: 'HOUSE_NOT_FOUND',
      message: 'deactivateHouse: house not found: ' + houseId,
    })

  if (!house.active) return ok(state)

  const newHouses = { ...state.houses, [houseId]: { ...house, active: false } }
  return ok({ ...state, houses: newHouses })
}

export function addHouseWealth(state: WorldState, houseId: HouseId, delta: number): StateResult {
  const house = state.houses[houseId]
  if (!house)
    return err({
      code: 'HOUSE_NOT_FOUND',
      message: 'addHouseWealth: house not found: ' + houseId,
    })
  return ok({
    ...state,
    houses: {
      ...state.houses,
      [houseId]: { ...house, wealth: Math.max(0, house.wealth + delta) },
    },
  })
}

export type DispersePersonsToAnonymousHouseInput = {
  houseId: HouseId
  year: number
}

// Moves all living, non-placeholder members of `houseId` into the AnonymousHouse.
// - Each transferred person.houseId becomes ANONYMOUS_HOUSE_ID
// - Each transferred person.lastHouseTransferYear becomes input.year
// - The source house.memberIds is filtered to remove transferred persons (dead/placeholder members are left in place)
// - The AnonymousHouse.memberIds gets the transferred persons appended (no duplicates)
// Fails if source house or AnonymousHouse doesn't exist. No-op (ok) if no living member to disperse.
export function dispersePersonsToAnonymousHouse(
  state: WorldState,
  input: DispersePersonsToAnonymousHouseInput,
): StateResult {
  const sourceHouse = state.houses[input.houseId]
  if (!sourceHouse)
    return err({
      code: 'HOUSE_NOT_FOUND',
      message: 'dispersePersonsToAnonymousHouse: source house not found: ' + input.houseId,
    })
  if (input.houseId === ANONYMOUS_HOUSE_ID) {
    return ok(state) // nothing to do
  }
  const anon = state.houses[ANONYMOUS_HOUSE_ID]
  if (!anon)
    return err({
      code: 'HOUSE_NOT_FOUND',
      message: 'dispersePersonsToAnonymousHouse: AnonymousHouse missing',
    })

  const transferIds: PersonId[] = []
  for (const memberId of sourceHouse.memberIds) {
    const p = state.persons[memberId]
    if (!p) continue
    if (!p.alive) continue
    if (p.kind === 'placeholder') continue
    transferIds.push(memberId)
  }

  if (transferIds.length === 0) return ok(state)

  const newPersons = { ...state.persons }
  for (const pid of transferIds) {
    const p = newPersons[pid]
    if (!p) continue
    newPersons[pid] = {
      ...p,
      houseId: ANONYMOUS_HOUSE_ID,
      lastHouseTransferYear: input.year,
    }
  }

  const transferSet = new Set<string>(transferIds.map((id) => id as string))
  const remainingSourceMembers = sourceHouse.memberIds.filter(
    (id) => !transferSet.has(id as string),
  )
  const anonExisting = new Set<string>(anon.memberIds.map((id) => id as string))
  const anonAppended = transferIds.filter((id) => !anonExisting.has(id as string))

  const newHouses = {
    ...state.houses,
    [input.houseId]: { ...sourceHouse, memberIds: remainingSourceMembers },
    [ANONYMOUS_HOUSE_ID]: { ...anon, memberIds: [...anon.memberIds, ...anonAppended] },
  }

  return ok({ ...state, persons: newPersons, houses: newHouses })
}

export type AddPersonToAnonymousHouseInput = {
  person: Person
}

// v0.17 §5.4.2: Atomically add an already-built Person to AnonymousHouse.
// person.houseId must already be set to ANONYMOUS_HOUSE_ID by the caller.
export function addPersonToAnonymousHouse(
  state: WorldState,
  input: AddPersonToAnonymousHouseInput,
): StateResult {
  const anon = state.houses[ANONYMOUS_HOUSE_ID]
  if (!anon)
    return err({
      code: 'HOUSE_NOT_FOUND',
      message: 'addPersonToAnonymousHouse: AnonymousHouse missing',
    })
  if (state.persons[input.person.id])
    return err({
      code: 'PERSON_ALREADY_EXISTS',
      message: 'addPersonToAnonymousHouse: person already exists: ' + input.person.id,
    })
  if (input.person.houseId !== ANONYMOUS_HOUSE_ID)
    return err({
      code: 'HOUSE_MISMATCH',
      message: 'addPersonToAnonymousHouse: person.houseId must be ANONYMOUS_HOUSE_ID',
    })

  return ok({
    ...state,
    persons: { ...state.persons, [input.person.id]: input.person },
    houses: {
      ...state.houses,
      [ANONYMOUS_HOUSE_ID]: { ...anon, memberIds: [...anon.memberIds, input.person.id] },
    },
  })
}
