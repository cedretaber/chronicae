import type { TickContext } from '../tick/context'
import { makeCountryId } from '../tick/context'
import type { ProvinceId, HouseId, CountryId, PersonId } from '../types/ids'
import type { PopClass } from '../types/popGroup'
import type { Country } from '../types/country'
import { generateCountryName } from '../selectors/countryNamingService'
import { createOfficeAssignment } from './officeMutations'

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

  // Add country to state
  const stateWithCountry = {
    ...finalCtx.state,
    countries: { ...finalCtx.state.countries, [id]: country },
  }

  // Set up leader office assignment
  const leaderPersonId = params.founderPersonId
  const stateWithLeader = leaderPersonId
    ? createOfficeAssignment(stateWithCountry, { kind: 'country', id }, 'leader', leaderPersonId)
    : stateWithCountry

  return { country, ctx: { ...finalCtx, state: stateWithLeader } }
}
