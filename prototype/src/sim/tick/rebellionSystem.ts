import type { TickContext } from './context'
import { makeCountryId, makeEventId } from './context'
import { randomFloat } from '../rng/rng'
import { clamp } from '../utils/math'
import { adjustCountryLegacyPrestige, adjustHouseLegacyPrestige } from '../helpers/attitudeHelpers'
import { calcAmbitionScores } from './ambitionSystem'
import { getCountryRulerHouse, getHouseLeader } from '../selectors/officeSelectors'
import { getHouseLoyaltyToCountry } from '../selectors/statusSelectors'
import { createCountryFromHouse } from '../mutations/createCountry'
import { calcHouseMilitaryPower } from '../selectors/militarySelectors'
import { generateCountryName } from '../selectors/countryNamingService'
import {
  createOfficeAssignment,
  revokeAllOfficesForOrganization,
} from '../mutations/officeMutations'
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

      const activeHousesInCountry = currentCountry.houseIds.filter((hid) => {
        const h = currentCtx.state.houses[hid]
        return h && h.active
      })
      if (activeHousesInCountry.length <= 1) continue

      let { rebellionTendency } = calcAmbitionScores(currentCtx.state, houseId)

      // Rebellion suppression for the current ruling house
      const rulerHouseId = getCountryRulerHouse(currentCtx.state, countryId as CountryId)
      if (houseId === rulerHouseId) {
        rebellionTendency -= currentCtx.config.rulerHouseRebellionSuppression
      }

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

      {
        const penaltyState = adjustCountryLegacyPrestige(
          currentCtx.state,
          countryId as CountryId,
          -5,
        )
        currentCtx = { ...currentCtx, state: penaltyState }
      }

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
        const loyaltyModifier = Math.max(
          currentCtx.config.minHouseMilitaryContribution,
          Math.min(1, getHouseLoyaltyToCountry(currentCtx.state, otherHouseId) / 100),
        )
        loyalistPower += otherHousePower * loyaltyModifier
      }

      const { id: eventId, ctx: eventCtx } = makeEventId(currentCtx)
      const headId = getHouseLeader(eventCtx.state, houseId)
      const event: SimEvent = {
        id: eventId,
        year: eventCtx.state.currentYear,
        month: eventCtx.state.currentMonth,
        type: 'REBELLION_STARTED',
        importance: 'critical',
        actorIds: headId ? [headId] : [],
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
          const rebelHeadId = getHouseLeader(succeedEventCtx.state, houseId)
          const succeedEvent: SimEvent = {
            id: succeedEventId,
            year: succeedEventCtx.state.currentYear,
            month: succeedEventCtx.state.currentMonth,
            type: 'REBELLION_SUCCEEDED',
            importance: 'critical',
            actorIds: rebelHeadId ? [rebelHeadId] : [],
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
          const rebelLeaderId = getHouseLeader(currentCtx.state, houseId)
          if (rebelLeaderId) {
            let postState = revokeAllOfficesForOrganization(
              currentCtx.state,
              { kind: 'country', id: countryId as CountryId },
              'leader',
            )
            postState = createOfficeAssignment(
              postState,
              { kind: 'country', id: countryId as CountryId },
              'leader',
              rebelLeaderId,
            )
            // Also apply legacyPrestige adjustments
            postState = adjustHouseLegacyPrestige(postState, houseId, 8)
            const oldRulerHouseId = getCountryRulerHouse(currentCtx.state, countryId as CountryId)
            if (oldRulerHouseId && oldRulerHouseId !== houseId) {
              postState = adjustHouseLegacyPrestige(postState, oldRulerHouseId, -8)
            }
            currentCtx = { ...currentCtx, state: postState }
          }

          const updatedCountryAfter = currentCtx.state.countries[countryId as CountryId]
          const countryName = updatedCountryAfter?.name ?? updatedCountry.name

          const { id: succeedEventId, ctx: succeedEventCtx } = makeEventId(currentCtx)
          const rebelHeadId2 = getHouseLeader(succeedEventCtx.state, houseId)
          const succeedEvent: SimEvent = {
            id: succeedEventId,
            year: succeedEventCtx.state.currentYear,
            month: succeedEventCtx.state.currentMonth,
            type: 'REBELLION_SUCCEEDED',
            importance: 'critical',
            actorIds: rebelHeadId2 ? [rebelHeadId2] : [],
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
            type: 'RULER_CHANGED',
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
        const failState = currentCtx.state
        const failStateWithHouse = adjustHouseLegacyPrestige(failState, houseId, -8)
        const failStateFinal = adjustCountryLegacyPrestige(
          failStateWithHouse,
          countryId as CountryId,
          4,
        )
        const newState = failStateFinal

        const { id: failEventId, ctx: failEventCtx } = makeEventId({
          ...currentCtx,
          state: newState,
        })
        const failHeadId = getHouseLeader(failEventCtx.state, houseId)
        const failEvent: SimEvent = {
          id: failEventId,
          year: failEventCtx.state.currentYear,
          month: failEventCtx.state.currentMonth,
          type: 'REBELLION_FAILED',
          importance: 'major',
          actorIds: failHeadId ? [failHeadId] : [],
          houseIds: [houseId],
          countryIds: [countryId as CountryId],
          provinceIds: [],
          summary: `${house.name}'s rebellion against ${updatedCountry.name} has failed.`,
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
