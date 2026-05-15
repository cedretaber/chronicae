import type { TickContext } from './context'
import { makeCountryId, makeEventId } from './context'
import { randomFloat } from '../rng/rng'
import { clamp, clamp100 } from '../utils/math'
import { calcAmbitionScores } from './ambitionSystem'
import { changeRulerHouse } from '../mutations/changeRulerHouse'
import { createCountryFromHouse } from '../mutations/createCountry'
import { calcHouseMilitaryPower } from '../selectors/militarySelectors'
import { generateCountryName } from '../selectors/countryNamingService'
import type { CountryId, ProvinceId } from '../types/ids'
import type { SimEvent } from '../types/event'
import { getPopUnrestByClass } from '../selectors/popSelectors'
import { getProvinceUnrest } from '../selectors/popSelectors'

export function runRebellionSystem(ctx: TickContext): TickContext {
  let currentCtx = ctx

  for (const countryId of Object.keys(currentCtx.state.countries).sort()) {
    const country = currentCtx.state.countries[countryId as CountryId]
    if (!country) continue
    if (!country.active) continue

    const houseIdsSnapshot = country.houseIds
      .filter((hid) => hid !== country.rulerHouseId)
      .filter((hid) => {
        const house = currentCtx.state.houses[hid]
        return house && house.active
      })
      .sort((a, b) => a.localeCompare(b))

    for (const houseId of houseIdsSnapshot) {
      const currentCountry = currentCtx.state.countries[countryId as CountryId]
      if (!currentCountry) continue

      const house = currentCtx.state.houses[houseId]
      if (!house || !house.active) continue

      if (house.countryId !== countryId) continue

      if (house.provinceIds.length === 0) continue

      let { rebellionTendency } = calcAmbitionScores(currentCtx.state, houseId)

      // POP-based rebellion modifiers
      const houseForPop = currentCtx.state.houses[houseId]
      if (houseForPop && houseForPop.provinceIds.length > 0) {
        const provinceIds = houseForPop.provinceIds
        const avgNoblesUnrest =
          provinceIds.reduce(
            (sum, pid) => sum + getPopUnrestByClass(currentCtx.state, pid, 'nobles'),
            0,
          ) / provinceIds.length
        const avgProvinceUnrest =
          provinceIds.reduce((sum, pid) => sum + getProvinceUnrest(currentCtx.state, pid), 0) /
          provinceIds.length
        const avgCountryControl =
          provinceIds.reduce((sum, pid) => {
            const p = currentCtx.state.provinces[pid]
            return sum + (p?.countryControl ?? 0)
          }, 0) / provinceIds.length

        rebellionTendency += avgNoblesUnrest * currentCtx.config.houseRebellionNobleUnrestFactor
        rebellionTendency +=
          avgProvinceUnrest * currentCtx.config.houseRebellionProvinceUnrestFactor
        rebellionTendency +=
          (100 - avgCountryControl) * currentCtx.config.houseRebellionLowControlFactor
      }

      if (rebellionTendency < currentCtx.config.rebellionThreshold) continue

      const { value: roll1, rng: rng1 } = randomFloat(currentCtx.rng)
      currentCtx = { ...currentCtx, rng: rng1 }

      const rebelChance = clamp(rebellionTendency / 200, 0, 1)
      if (roll1 >= rebelChance) continue

      const penalizedCountry = {
        ...currentCountry,
        stability: clamp100(currentCountry.stability - 10),
        legitimacy: clamp100(currentCountry.legitimacy - 5),
      }
      const stateWithPenalties = {
        ...currentCtx.state,
        countries: {
          ...currentCtx.state.countries,
          [countryId as CountryId]: penalizedCountry,
        },
      }
      currentCtx = { ...currentCtx, state: stateWithPenalties }

      const rebelPower = calcHouseMilitaryPower(currentCtx.state, currentCtx.config, house.id)

      const updatedCountry = currentCtx.state.countries[countryId as CountryId]
      if (!updatedCountry) continue

      let loyalistPower =
        (updatedCountry.adminPower ?? 0) * currentCtx.config.countryAdminMilitaryFactor
      loyalistPower +=
        (updatedCountry.treasury ?? 0) / currentCtx.config.rebellionTreasuryPowerDivisor

      for (const otherHouseId of currentCountry.houseIds) {
        if (otherHouseId === houseId) continue // skip the rebel house
        const otherHouse = currentCtx.state.houses[otherHouseId]
        if (!otherHouse || !otherHouse.active) continue
        const otherHousePower = calcHouseMilitaryPower(
          currentCtx.state,
          currentCtx.config,
          otherHouseId,
        )
        if (otherHouseId === currentCountry.rulerHouseId) {
          loyalistPower += otherHousePower // ruler house contributes 100%
        } else {
          const loyaltyModifier = Math.max(
            currentCtx.config.minHouseMilitaryContribution,
            Math.min(1, otherHouse.loyaltyToCountry / 100),
          )
          loyalistPower += otherHousePower * loyaltyModifier
        }
      }

      const { id: eventId, ctx: eventCtx } = makeEventId(currentCtx)
      const event: SimEvent = {
        id: eventId,
        year: eventCtx.state.currentYear,
        month: eventCtx.state.currentMonth,
        type: 'REBELLION_STARTED',
        importance: 'critical',
        actorIds: [house.headId],
        houseIds: [houseId],
        countryIds: [countryId as CountryId],
        provinceIds: [],
        summary: `${house.name} has started a rebellion in ${updatedCountry.name}!`,
        reasons: [],
        effects: [],
      }
      currentCtx = {
        ...eventCtx,
        state: currentCtx.state,
        events: [...eventCtx.events, event],
      }

      const rebelProvinceIds: ProvinceId[] = [...house.provinceIds]

      {
        const devastatedProvinces = { ...currentCtx.state.provinces }
        for (const pid of rebelProvinceIds) {
          const p = devastatedProvinces[pid]
          if (!p) continue
          devastatedProvinces[pid] = {
            ...p,
            development: clamp(
              p.development - currentCtx.config.rebellionStartedDevastation,
              -100,
              100,
            ),
          }
        }
        currentCtx = {
          ...currentCtx,
          state: { ...currentCtx.state, provinces: devastatedProvinces },
        }
      }

      const { value: roll2, rng: rng2 } = randomFloat(currentCtx.rng)
      currentCtx = { ...currentCtx, rng: rng2 }

      const rebelSuccessChance = rebelPower / (rebelPower + loyalistPower + 1)
      const rebelWins = roll2 < rebelSuccessChance

      if (rebelWins) {
        const mode = currentCtx.config.rebellionSuccessMode

        if (mode === 'independence') {
          const { id: newCountryId, ctx: afterCountryCtx } = makeCountryId(currentCtx)
          currentCtx = afterCountryCtx

          const { name: newCountryName, rng: nameRng } = generateCountryName(
            currentCtx.state,
            currentCtx.config,
            currentCtx.rng,
            {
              origin: 'house_independence',
              rulingHouseId: houseId,
            },
          )
          currentCtx = { ...currentCtx, rng: nameRng }

          const newState = createCountryFromHouse(
            currentCtx.state,
            houseId,
            newCountryId,
            newCountryName,
          )
          currentCtx = { ...currentCtx, state: newState }

          const { id: succeedEventId, ctx: succeedEventCtx } = makeEventId(currentCtx)
          const succeedEvent: SimEvent = {
            id: succeedEventId,
            year: succeedEventCtx.state.currentYear,
            month: succeedEventCtx.state.currentMonth,
            type: 'REBELLION_SUCCEEDED',
            importance: 'critical',
            actorIds: [house.headId],
            houseIds: [houseId],
            countryIds: [countryId as CountryId, newCountryId],
            provinceIds: [],
            summary: `${house.name} successfully broke away from ${updatedCountry.name}!`,
            reasons: [],
            effects: [],
          }
          currentCtx = {
            ...succeedEventCtx,
            state: currentCtx.state,
            events: [...succeedEventCtx.events, succeedEvent],
          }

          const { id: splitEventId, ctx: splitEventCtx } = makeEventId(currentCtx)
          const splitEvent: SimEvent = {
            id: splitEventId,
            year: splitEventCtx.state.currentYear,
            month: splitEventCtx.state.currentMonth,
            type: 'COUNTRY_SPLIT',
            importance: 'critical',
            actorIds: [],
            houseIds: [houseId],
            countryIds: [countryId as CountryId, newCountryId],
            provinceIds: [],
            summary: `${house.name} has formed a new nation.`,
            reasons: [],
            effects: [],
          }
          currentCtx = {
            ...splitEventCtx,
            state: currentCtx.state,
            events: [...splitEventCtx.events, splitEvent],
          }

          {
            const devastatedProvinces = { ...currentCtx.state.provinces }
            for (const pid of rebelProvinceIds) {
              const p = devastatedProvinces[pid]
              if (!p) continue
              devastatedProvinces[pid] = {
                ...p,
                development: clamp(
                  p.development - currentCtx.config.rebellionSucceededDevastation,
                  -100,
                  100,
                ),
              }
            }
            currentCtx = {
              ...currentCtx,
              state: { ...currentCtx.state, provinces: devastatedProvinces },
            }
          }
        } else {
          const newState = changeRulerHouse(currentCtx.state, countryId as CountryId, houseId)
          currentCtx = { ...currentCtx, state: newState }

          const updatedCountryAfter = newState.countries[countryId as CountryId]
          const countryName = updatedCountryAfter?.name ?? updatedCountry.name

          const { id: succeedEventId, ctx: succeedEventCtx } = makeEventId(currentCtx)
          const succeedEvent: SimEvent = {
            id: succeedEventId,
            year: succeedEventCtx.state.currentYear,
            month: succeedEventCtx.state.currentMonth,
            type: 'REBELLION_SUCCEEDED',
            importance: 'critical',
            actorIds: [house.headId],
            houseIds: [houseId],
            countryIds: [countryId as CountryId],
            provinceIds: [],
            summary: `${house.name} has seized control of ${countryName}!`,
            reasons: [],
            effects: [],
          }
          currentCtx = {
            ...succeedEventCtx,
            state: currentCtx.state,
            events: [...succeedEventCtx.events, succeedEvent],
          }

          const { id: rulerEventId, ctx: rulerEventCtx } = makeEventId(currentCtx)
          const rulerEvent: SimEvent = {
            id: rulerEventId,
            year: rulerEventCtx.state.currentYear,
            month: rulerEventCtx.state.currentMonth,
            type: 'RULER_HOUSE_CHANGED',
            importance: 'critical',
            actorIds: [],
            houseIds: [houseId],
            countryIds: [countryId as CountryId],
            provinceIds: [],
            summary: `${house.name} is now the ruling house of ${countryName}.`,
            reasons: [],
            effects: [],
          }
          currentCtx = {
            ...rulerEventCtx,
            state: currentCtx.state,
            events: [...rulerEventCtx.events, rulerEvent],
          }

          {
            const devastatedProvinces = { ...currentCtx.state.provinces }
            for (const pid of rebelProvinceIds) {
              const p = devastatedProvinces[pid]
              if (!p) continue
              devastatedProvinces[pid] = {
                ...p,
                development: clamp(
                  p.development - currentCtx.config.rebellionSucceededDevastation,
                  -100,
                  100,
                ),
              }
            }
            currentCtx = {
              ...currentCtx,
              state: { ...currentCtx.state, provinces: devastatedProvinces },
            }
          }
        }
      } else {
        const currentState = currentCtx.state
        const updatedHouse = currentState.houses[houseId]
        if (!updatedHouse) continue

        const updatedCountryForPenalties = currentState.countries[countryId as CountryId]
        if (!updatedCountryForPenalties) continue

        const newHouse = {
          ...updatedHouse,
          prestige: clamp100(updatedHouse.prestige - 20),
          loyaltyToCountry: clamp100(updatedHouse.loyaltyToCountry - 20),
        }
        const newCountry = {
          ...updatedCountryForPenalties,
          stability: clamp100(updatedCountryForPenalties.stability + 5),
          legitimacy: clamp100(updatedCountryForPenalties.legitimacy + 3),
        }
        const newState = {
          ...currentState,
          houses: { ...currentState.houses, [houseId]: newHouse },
          countries: {
            ...currentState.countries,
            [countryId as CountryId]: newCountry,
          },
        }

        const { id: failEventId, ctx: failEventCtx } = makeEventId({
          ...currentCtx,
          state: newState,
        })
        const failEvent: SimEvent = {
          id: failEventId,
          year: failEventCtx.state.currentYear,
          month: failEventCtx.state.currentMonth,
          type: 'REBELLION_FAILED',
          importance: 'major',
          actorIds: [house.headId],
          houseIds: [houseId],
          countryIds: [countryId as CountryId],
          provinceIds: [],
          summary: `${house.name}'s rebellion against ${newCountry.name} has failed.`,
          reasons: [],
          effects: [],
        }
        currentCtx = {
          ...failEventCtx,
          state: newState,
          events: [...failEventCtx.events, failEvent],
        }

        {
          const devastatedProvinces = { ...currentCtx.state.provinces }
          for (const pid of rebelProvinceIds) {
            const p = devastatedProvinces[pid]
            if (!p) continue
            devastatedProvinces[pid] = {
              ...p,
              development: clamp(
                p.development - currentCtx.config.rebellionFailedDevastation,
                -100,
                100,
              ),
            }
          }
          currentCtx = {
            ...currentCtx,
            state: { ...currentCtx.state, provinces: devastatedProvinces },
          }
        }
      }
    }
  }

  return currentCtx
}
