import type { TickContext } from '../tick/context'
import { makeHouseId } from '../tick/context'
import type { HouseId, PolityId, ProvinceId, PersonId } from '../types/ids'
import type { House } from '../types/house'
import type { WorldState } from '../types/world'
import type { Person } from '../types/person'
import type { StateResult, CtxResult } from './result'
import { ok, err } from './result'

export type CreateHouseInput = {
  nameKey: string
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
    nameKey: input.nameKey,
    active: true,
    memberIds: [],
    deceasedMemberIds: [],
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

export type DispersePersonsToHouselessInput = {
  houseId: HouseId
  year: number
}

export function dispersePersonsToHouseless(
  state: WorldState,
  input: DispersePersonsToHouselessInput,
): StateResult {
  const sourceHouse = state.houses[input.houseId]
  if (!sourceHouse)
    return err({
      code: 'HOUSE_NOT_FOUND',
      message: 'dispersePersonsToHouseless: source house not found: ' + input.houseId,
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
    const copy: Record<string, unknown> = { ...p, lastHouseTransferYear: input.year }
    delete copy['houseId']
    newPersons[pid] = copy as typeof p
  }

  const transferSet = new Set<string>(transferIds.map((id) => id as string))
  const remainingSourceMembers = sourceHouse.memberIds.filter(
    (id) => !transferSet.has(id as string),
  )

  const newHouses = {
    ...state.houses,
    [input.houseId]: { ...sourceHouse, memberIds: remainingSourceMembers },
  }

  return ok({ ...state, persons: newPersons, houses: newHouses })
}

export function addHouselessPerson(state: WorldState, person: Person): StateResult {
  if (state.persons[person.id])
    return err({
      code: 'PERSON_ALREADY_EXISTS',
      message: 'addHouselessPerson: person already exists: ' + person.id,
    })
  if (person.houseId !== undefined)
    return err({
      code: 'HOUSE_MISMATCH',
      message: 'addHouselessPerson: person must not have houseId',
    })

  return ok({
    ...state,
    persons: { ...state.persons, [person.id]: person },
  })
}
