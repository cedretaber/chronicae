import type { TickContext } from './context'
import { makeEventId } from './context'
import { randomFloat } from '../rng/rng'
import { clamp100 } from '../utils/math'
import type { CountryId, ProvinceId } from '../types/ids'
import type { SimEvent } from '../types/event'

export function runPublicSpendingSystem(ctx: TickContext): TickContext {
  if (!ctx.config.publicSpendingEnabled) return ctx
  if (ctx.state.currentMonth !== 1) return ctx

  let currentCtx = ctx

  for (const countryId of Object.keys(ctx.state.countries).sort()) {
    const country = currentCtx.state.countries[countryId as CountryId]
    if (!country || !country.active) continue

    const rulerHouse = currentCtx.state.houses[country.rulerHouseId]
    if (!rulerHouse) continue

    const rulerHead = currentCtx.state.persons[rulerHouse.headId]
    if (!rulerHead || !rulerHead.alive) continue

    const chancellorId = country.roleAssignments.chancellor
    const treasurerId = country.roleAssignments.treasurer
    const chancellorAdmin = chancellorId
      ? (currentCtx.state.persons[chancellorId]?.stats.admin ?? 0)
      : 0
    const treasurerAdmin = treasurerId
      ? (currentCtx.state.persons[treasurerId]?.stats.admin ?? 0)
      : 0

    const countryProvinces = Object.values(currentCtx.state.provinces).filter(
      (p) => p.countryId === countryId,
    )
    const avgUnrest =
      countryProvinces.length > 0
        ? countryProvinces.reduce((sum, p) => sum + p.unrest, 0) / countryProvinces.length
        : 0

    const treasurySurplus = Math.max(0, country.treasury - ctx.config.monumentBaseCost)
    const treasuryShortage = Math.max(0, ctx.config.almsBaseCost - country.treasury)

    const monumentScore =
      (100 - country.legitimacy) * 0.3 +
      rulerHead.traits.ambition * 30 +
      rulerHouse.prestige * 0.1 +
      treasurySurplus -
      rulerHead.traits.caution * 25 +
      treasurerAdmin * 2

    const almsScore =
      (100 - country.stability) * 0.4 +
      avgUnrest * 0.5 +
      rulerHead.traits.loyaltyToCountry * 20 +
      rulerHead.traits.caution * 10 -
      treasuryShortage +
      chancellorAdmin * 2

    const { value: roll, rng: nextRng } = randomFloat(currentCtx.rng)
    currentCtx = { ...currentCtx, rng: nextRng }

    if (roll >= ctx.config.publicSpendingYearlyChance) continue

    const currentState = currentCtx.state

    if (monumentScore > almsScore) {
      if (country.treasury < ctx.config.monumentBaseCost) continue

      const currentCountries = currentCtx.state.countries
      const updatedCountry = {
        ...country,
        treasury: country.treasury - ctx.config.monumentBaseCost,
        legitimacy: clamp100(country.legitimacy + 10),
      }
      const currentHouse = currentCtx.state.houses[country.rulerHouseId]
      if (!currentHouse) continue
      const updatedHouse = { ...currentHouse, prestige: clamp100(currentHouse.prestige + 5) }

      currentCtx = {
        ...currentCtx,
        state: {
          ...currentState,
          countries: { ...currentCountries, [countryId]: updatedCountry },
          houses: { ...currentCtx.state.houses, [country.rulerHouseId]: updatedHouse },
        },
      }

      const { id: eventId, ctx: eventCtx } = makeEventId(currentCtx)
      const event: SimEvent = {
        id: eventId,
        year: eventCtx.state.currentYear,
        month: eventCtx.state.currentMonth,
        type: 'MONUMENT_BUILT',
        importance: 'major',
        actorIds: [],
        houseIds: [country.rulerHouseId],
        countryIds: [countryId],
        provinceIds: [],
        summary: `${country.name} built a great monument.`,
        reasons: [],
        effects: [],
      }
      currentCtx = {
        ...eventCtx,
        state: currentCtx.state,
        events: [...eventCtx.events, event],
      }
    } else {
      if (country.treasury < ctx.config.almsBaseCost) continue

      const newProvinces = { ...currentCtx.state.provinces }
      for (const pid of Object.keys(currentCtx.state.provinces)) {
        const province = currentCtx.state.provinces[pid as ProvinceId]
        if (!province || province.countryId !== countryId) continue
        newProvinces[pid as ProvinceId] = {
          ...province,
          unrest: Math.max(0, province.unrest - 5),
        }
      }

      const currentCountries = currentCtx.state.countries
      const updatedCountry = {
        ...country,
        treasury: country.treasury - ctx.config.almsBaseCost,
        stability: clamp100(country.stability + 8),
      }

      currentCtx = {
        ...currentCtx,
        state: {
          ...currentState,
          provinces: newProvinces,
          countries: { ...currentCountries, [countryId]: updatedCountry },
        },
      }

      const { id: eventId, ctx: eventCtx } = makeEventId(currentCtx)
      const event: SimEvent = {
        id: eventId,
        year: eventCtx.state.currentYear,
        month: eventCtx.state.currentMonth,
        type: 'ALMS_DISTRIBUTED',
        importance: 'normal',
        actorIds: [],
        houseIds: [],
        countryIds: [countryId],
        provinceIds: [],
        summary: `${country.name} distributed alms to its people.`,
        reasons: [],
        effects: [],
      }
      currentCtx = {
        ...eventCtx,
        state: currentCtx.state,
        events: [...eventCtx.events, event],
      }
    }
  }

  return currentCtx
}
