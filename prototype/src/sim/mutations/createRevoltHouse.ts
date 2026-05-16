import type { TickContext } from '../tick/context'
import { makeHouseId } from '../tick/context'
import type { PersonId, CountryId, ProvinceId, HouseId } from '../types/ids'
import type { House } from '../types/house'
import { pickUniqueName, houseNamePool, houseName } from '../worldgen/nameGenerators'

export function createRevoltHouse(
  ctx: TickContext,
  params: {
    leaderId: PersonId
    countryId: CountryId
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
    countryId: params.countryId,
    provinceIds: [params.seatProvinceId],
    memberIds: [params.leaderId],
    headId: params.leaderId,
    founderId: params.leaderId,
    cadetHouseIds: [],
    legacyPrestige: finalCtx.config.revoltHouseInitialLegacyPrestige,
    wealth: finalCtx.config.revoltHouseInitialWealth,
    seatProvinceId: params.seatProvinceId,
    ...(params.parentHouseId !== undefined && { parentHouseId: params.parentHouseId }),
  }

  return { house, ctx: finalCtx }
}
