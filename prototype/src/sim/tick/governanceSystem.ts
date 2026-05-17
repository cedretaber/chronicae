import type { TickContext } from './context'
import type { CountryId } from '../types/ids'
import type { Country } from '../types/country'
import { getCountryAdminPower } from '@sim/selectors/statusSelectors'

export function runGovernanceSystem(ctx: TickContext): TickContext {
  if (ctx.state.currentMonth !== 1) {
    return ctx
  }

  let currentCtx = ctx

  // v013-residual: simple-batch — 全 country の adminPower 計算後の単一バッチ書き込み。将来 setCountryAdminPower() で代替可
  const countryIds = Object.keys(currentCtx.state.countries).sort()
  const newCountries: Record<CountryId, Country> = { ...currentCtx.state.countries }

  for (const countryId of countryIds) {
    const country = currentCtx.state.countries[countryId as CountryId]
    if (!country) continue
    if (!country.active) continue

    const adminPower = getCountryAdminPower(
      currentCtx.state,
      currentCtx.config,
      countryId as CountryId,
    )

    newCountries[countryId as CountryId] = {
      ...country,
      adminPower,
    }
  }

  currentCtx = { ...currentCtx, state: { ...currentCtx.state, countries: newCountries } }

  return currentCtx
}
