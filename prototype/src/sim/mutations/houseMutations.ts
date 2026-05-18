import type { TickContext } from '../tick/context'
import { makeHouseId } from '../tick/context'
import type { HouseId, PolityId, ProvinceId, PersonId } from '../types/ids'
import type { House } from '../types/house'
import type { WorldState } from '../types/world'
import type { StateResult, CtxResult } from './result'
import { ok, err } from './result'
import { getHousePrimaryPolityId, getPolityHouseIds } from '../selectors/polityRelations'

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
    provinceIds: [],
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

  const polity = ctxWithId.state.polities[input.polityId]!
  const houseIds = getPolityHouseIds(ctxWithId.state, input.polityId)
  const newPolities = {
    ...ctxWithId.state.polities,
    [input.polityId]: { ...polity, houseIds: [...houseIds, houseId] },
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
      const newState = { ...ctxWithId.state, houses: newHouses, polities: newPolities }
      return ok({ ctx: { ...ctxWithId, state: newState }, value: { houseId } })
    }
  }

  const newState = {
    ...ctxWithId.state,
    houses: { ...ctxWithId.state.houses, [houseId]: houseWithOptionals },
    polities: newPolities,
  }
  return ok({ ctx: { ...ctxWithId, state: newState }, value: { houseId } })
}

export function deactivateHouse(
  state: WorldState,
  houseId: HouseId,
  options?: { removeFromPolity?: boolean },
): StateResult {
  const house = state.houses[houseId]
  if (!house)
    return err({
      code: 'HOUSE_NOT_FOUND',
      message: 'deactivateHouse: house not found: ' + houseId,
    })

  if (!house.active) return ok(state)

  const newHouses = { ...state.houses, [houseId]: { ...house, active: false } }

  if (options?.removeFromPolity) {
    const housePolityId = getHousePrimaryPolityId(state, houseId)
    if (housePolityId) {
      const polity = state.polities[housePolityId]
      if (polity) {
        const houseIds = getPolityHouseIds(state, housePolityId)
        const newPolities = {
          ...state.polities,
          [housePolityId]: {
            ...polity,
            houseIds: houseIds.filter((id) => id !== houseId),
          },
        }
        return ok({ ...state, houses: newHouses, polities: newPolities })
      }
    }
  }

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
