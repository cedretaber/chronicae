import type { TickContext } from './context'
import type { CountryId } from '../types/ids'
import type { Country } from '../types/country'
import { clamp100 } from '../utils/math'

export function runStabilitySystem(ctx: TickContext): TickContext {
  let currentCtx = ctx

  const countryIds = Object.keys(currentCtx.state.countries).sort()
  const newCountries: Record<CountryId, Country> = { ...currentCtx.state.countries }

  for (const countryId of countryIds) {
    const country = currentCtx.state.countries[countryId as CountryId]
    if (!country) continue
    if (!country.active) continue

    newCountries[countryId as CountryId] = {
      ...country,
      stability: clamp100(country.stability + 0.2),
      legitimacy: clamp100(country.legitimacy + 0.05),
    }
  }

  currentCtx = { ...currentCtx, state: { ...currentCtx.state, countries: newCountries } }

  return currentCtx
}
