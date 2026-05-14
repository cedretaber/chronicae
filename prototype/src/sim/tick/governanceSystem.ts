import type { TickContext } from './context'
import type { CountryId } from '../types/ids'
import type { Country } from '../types/country'
import { clamp, clamp100 } from '../utils/math'

function getRoleAdminPower(
  country: Country,
  role: 'chancellor' | 'treasurer',
  state: TickContext['state'],
): number {
  const personId = country.roleAssignments[role]
  if (!personId) return 0
  const person = state.persons[personId]
  if (!person || !person.alive) return 0
  return person.stats.admin
}

export function runGovernanceSystem(ctx: TickContext): TickContext {
  if (ctx.state.currentMonth !== 1) {
    return ctx
  }

  let currentCtx = ctx

  const countryIds = Object.keys(currentCtx.state.countries).sort()
  const newCountries: Record<CountryId, Country> = { ...currentCtx.state.countries }

  for (const countryId of countryIds) {
    const country = currentCtx.state.countries[countryId as CountryId]
    if (!country) continue

    const chancellorAdmin = getRoleAdminPower(country, 'chancellor', currentCtx.state)
    const treasurerAdmin = getRoleAdminPower(country, 'treasurer', currentCtx.state)

    const rulerHouse = currentCtx.state.houses[country.rulerHouseId]
    const rulerHousePrestige = rulerHouse ? rulerHouse.prestige : 0

    const treasuryBonus = clamp(country.treasury / 100, 0, 10)

    const adminPower = clamp100(
      30 +
        chancellorAdmin * 3 +
        treasurerAdmin * 2 +
        country.stability * 0.2 +
        rulerHousePrestige * 0.1 +
        treasuryBonus,
    )

    newCountries[countryId as CountryId] = {
      ...country,
      adminPower,
    }
  }

  currentCtx = { ...currentCtx, state: { ...currentCtx.state, countries: newCountries } }

  return currentCtx
}
