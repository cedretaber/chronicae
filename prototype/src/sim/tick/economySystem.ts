import type { TickContext } from './context'
import type { ProvinceId, HouseId, CountryId } from '../types/ids'
import { getEffectiveProvinceTax } from '../selectors/developmentSelectors'

export function runEconomySystem(ctx: TickContext): TickContext {
  const wealthDeltas = new Map<HouseId, number>()
  const treasuryDeltas = new Map<CountryId, number>()

  for (const provinceId of Object.keys(ctx.state.provinces).sort()) {
    const province = ctx.state.provinces[provinceId as ProvinceId]
    if (!province) continue

    const effectiveTax = getEffectiveProvinceTax(province)

    const houseKey = province.ownerHouseId
    wealthDeltas.set(houseKey, (wealthDeltas.get(houseKey) ?? 0) + effectiveTax * 0.6)

    const countryKey = province.countryId
    treasuryDeltas.set(countryKey, (treasuryDeltas.get(countryKey) ?? 0) + effectiveTax * 0.4)
  }

  const newHouses = { ...ctx.state.houses }
  for (const houseId of Object.keys(ctx.state.houses).sort()) {
    const house = newHouses[houseId as HouseId]
    if (!house) continue
    const delta = wealthDeltas.get(houseId as HouseId) ?? 0
    newHouses[houseId as HouseId] = { ...house, wealth: Math.max(0, house.wealth + delta) }
  }

  const newCountries = { ...ctx.state.countries }
  for (const countryId of Object.keys(ctx.state.countries).sort()) {
    const country = newCountries[countryId as CountryId]
    if (!country) continue
    if (!country.active) continue
    const delta = treasuryDeltas.get(countryId as CountryId) ?? 0
    newCountries[countryId as CountryId] = { ...country, treasury: country.treasury + delta }
  }

  return {
    ...ctx,
    state: {
      ...ctx.state,
      houses: newHouses,
      countries: newCountries,
    },
  }
}
