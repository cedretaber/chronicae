import type { TickContext } from '../tick/context'
import { makeHouseId } from '../tick/context'
import type { PersonId, ProvinceId, HouseId, PolityId } from '../types/ids'
import type { House } from '../types/house'
import { pickUniqueName, houseNamePool, houseName } from '../worldgen/nameGenerators'
import { createOfficeAssignment } from './officeMutations'

export function createRevoltHouse(
  ctx: TickContext,
  params: {
    leaderId: PersonId
    polityId: PolityId
    seatProvinceId: ProvinceId
    parentHouseId?: HouseId
  },
): { house: House; ctx: TickContext } {
  const { id, ctx: ctx1 } = makeHouseId(ctx)

  // Collect used house names from current state
  const usedNames = new Set(
    Object.values(ctx1.state.houses)
      .filter((h): h is NonNullable<typeof h> => h !== undefined)
      .map((h) => h.name),
  )

  const houseIndex = ctx1.nextHouseIndex
  const { name, rng: rng1 } = pickUniqueName(
    houseNamePool(),
    usedNames,
    houseName,
    houseIndex,
    ctx1.rng,
  )
  const finalCtx = { ...ctx1, rng: rng1 }

  const house: House = {
    id,
    name,
    active: true,
    memberIds: [params.leaderId],
    founderId: params.leaderId,
    cadetHouseIds: [],
    legacyPrestige: finalCtx.config.revoltHouseInitialLegacyPrestige,
    wealth: finalCtx.config.revoltHouseInitialWealth,
    seatProvinceId: params.seatProvinceId,
    ...(params.parentHouseId !== undefined && { parentHouseId: params.parentHouseId }),
  }

  // Set up house leader office
  const stateWithLeader = createOfficeAssignment(
    finalCtx.state,
    { kind: 'house', id },
    'leader',
    params.leaderId,
  )

  return { house, ctx: { ...finalCtx, state: stateWithLeader } }
}
