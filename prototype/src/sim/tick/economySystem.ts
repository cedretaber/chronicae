import type { TickContext } from './context'
import type { ProvinceId, HouseId, CountryId } from '../types/ids'
import { getEffectiveProvinceTax } from '../selectors/developmentSelectors'
import { calcTreasurerTaxEfficiency } from '../selectors/personAbilityEffects'

export function runEconomySystem(ctx: TickContext): TickContext {
  const wealthDeltas = new Map<HouseId, number>()
  const treasuryDeltas = new Map<CountryId, number>()

  for (const provinceId of Object.keys(ctx.state.provinces).sort()) {
    const province = ctx.state.provinces[provinceId as ProvinceId]
    if (!province) continue

    const provinceIncome = getEffectiveProvinceTax(province)
    const cc = province.countryControl / 100
    const hc = province.houseControl / 100
    const totalControl = cc + hc

    if (totalControl <= 0) continue

    const countryIncome = provinceIncome * (cc / totalControl) * cc
    const houseIncome = provinceIncome * (hc / totalControl) * hc

    const houseKey = province.ownerHouseId
    wealthDeltas.set(houseKey, (wealthDeltas.get(houseKey) ?? 0) + houseIncome)

    const countryKey = province.countryId
    treasuryDeltas.set(countryKey, (treasuryDeltas.get(countryKey) ?? 0) + countryIncome)
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
    const taxEfficiency = calcTreasurerTaxEfficiency(ctx.state, country, ctx.config)
    const delta = treasuryDeltas.get(countryId as CountryId) ?? 0
    newCountries[countryId as CountryId] = {
      ...country,
      treasury: country.treasury + delta * taxEfficiency,
    }
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
