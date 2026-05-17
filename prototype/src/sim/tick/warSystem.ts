import type { TickContext } from './context'
import { makeEventId } from './context'
import { randomFloat, randomInt } from '../rng/rng'
import { clamp } from '../utils/math'
import {
  adjustCountryLegacyPrestige,
  adjustHouseLegacyPrestige,
  adjustPersonLegacyPrestige,
} from '../helpers/attitudeHelpers'
import { calcCountryMilitaryPower } from '../selectors/militarySelectors'
import {
  calcGeneralWarPowerModifier,
  calcGeneralDeclareThreshold,
} from '../selectors/personAbilityEffects'
import { transferProvinceToHouse } from '../mutations/provinceMutations'
import { annexCountry } from '../mutations/countryMutations'
import type { CountryId, HouseId, PersonId, ProvinceId } from '../types/ids'
import type { WorldState } from '../types/world'
import type { SimEvent } from '../types/event'
import {
  adjustProvincePopWealth,
  adjustProvincePopUnrest,
  adjustProvincePopSizeByClass,
} from '../mutations/popMutations'
import { getCountryRulerHouse, getActiveOfficeHolders } from '../selectors/officeSelectors'

function emitWarEvent(
  ctx: TickContext,
  type: 'WAR_DECLARED' | 'WAR_WON' | 'WAR_LOST',
  generalId: PersonId,
  attackerCountryId: CountryId,
  defenderCountryId: CountryId,
  summary: string,
): TickContext {
  const { id: eventId, ctx: eventCtx } = makeEventId(ctx)
  const event: SimEvent = {
    id: eventId,
    year: eventCtx.state.currentYear,
    month: eventCtx.state.currentMonth,
    type,
    importance: 'major',
    actorIds: [generalId],
    houseIds: [],
    countryIds: [attackerCountryId, defenderCountryId],
    provinceIds: [],
    summary,
    reasons: [],
    effects: [],
  }
  return { ...eventCtx, state: eventCtx.state, events: [...eventCtx.events, event] }
}

function emitProvinceConquered(
  ctx: TickContext,
  generalId: PersonId,
  attackerCountryId: CountryId,
  defenderCountryId: CountryId,
  rulerHouseId: HouseId,
  provinceId: ProvinceId,
  provinceName: string,
  attackerName: string,
): TickContext {
  const { id: eventId, ctx: eventCtx } = makeEventId(ctx)
  const event: SimEvent = {
    id: eventId,
    year: eventCtx.state.currentYear,
    month: eventCtx.state.currentMonth,
    type: 'PROVINCE_CONQUERED',
    importance: 'major',
    actorIds: [generalId],
    houseIds: [rulerHouseId],
    countryIds: [attackerCountryId, defenderCountryId],
    provinceIds: [provinceId],
    summary: `${provinceName} was conquered by ${attackerName}.`,
    reasons: [],
    effects: [],
  }
  return { ...eventCtx, state: eventCtx.state, events: [...eventCtx.events, event] }
}

function emitCountryAnnexed(
  ctx: TickContext,
  generalId: PersonId,
  attackerCountryId: CountryId,
  defenderCountryId: CountryId,
  defenderName: string,
  attackerName: string,
): TickContext {
  const { id: eventId, ctx: eventCtx } = makeEventId(ctx)
  const event: SimEvent = {
    id: eventId,
    year: eventCtx.state.currentYear,
    month: eventCtx.state.currentMonth,
    type: 'COUNTRY_ANNEXED',
    importance: 'critical',
    actorIds: [generalId],
    houseIds: [],
    countryIds: [attackerCountryId, defenderCountryId],
    provinceIds: [],
    summary: `${defenderName} has been annexed by ${attackerName}.`,
    reasons: [],
    effects: [],
  }
  return { ...eventCtx, state: eventCtx.state, events: [...eventCtx.events, event] }
}

export function runWarSystem(ctx: TickContext): TickContext {
  if (!ctx.config.warEnabled) {
    return ctx
  }

  let warsThisTick = 0
  let currentCtx = ctx
  let currentState = currentCtx.state

  const countryIds = Object.keys(currentState.countries).sort() as CountryId[]

  for (const attackerCountryId of countryIds) {
    if (warsThisTick >= currentCtx.config.maxWarsPerTick) {
      break
    }

    currentState = currentCtx.state
    const attackerCountry = currentState.countries[attackerCountryId]
    if (!attackerCountry || !attackerCountry.active) {
      continue
    }

    const currentAbsoluteMonth = currentState.currentYear * 12 + currentState.currentMonth
    if (attackerCountry.lastWarMonth !== undefined) {
      if (
        currentAbsoluteMonth - attackerCountry.lastWarMonth <
        currentCtx.config.warCooldownMonths
      ) {
        continue
      }
    }

    const militaryHolders = getActiveOfficeHolders(
      currentState,
      { kind: 'country', id: attackerCountryId },
      'military',
    )
    const generalId = militaryHolders[0]
    if (generalId === undefined) {
      continue
    }

    currentState = currentCtx.state
    const general = currentState.persons[generalId]
    if (!general || !general.alive) {
      continue
    }

    if (attackerCountry.treasury < currentCtx.config.warCostPerProvince) {
      continue
    }

    const attackerPower =
      calcCountryMilitaryPower(currentState, currentCtx.config, attackerCountryId) *
      calcGeneralWarPowerModifier(currentState, attackerCountryId, currentCtx.config)

    const attackerProvinceSet = new Set<ProvinceId>()
    for (const houseId of attackerCountry.houseIds) {
      currentState = currentCtx.state
      const house = currentState.houses[houseId]
      if (!house) {
        continue
      }
      for (const provinceId of house.provinceIds) {
        attackerProvinceSet.add(provinceId)
      }
    }

    for (const defenderCountryId of countryIds) {
      if (defenderCountryId === attackerCountryId) {
        continue
      }

      currentState = currentCtx.state
      const defenderCountry = currentState.countries[defenderCountryId]
      if (!defenderCountry || !defenderCountry.active) {
        continue
      }

      const borderProvinceIds: ProvinceId[] = []
      for (const provinceIdStr of Object.keys(currentState.provinces)) {
        const provinceId = provinceIdStr as ProvinceId
        const province = currentState.provinces[provinceId]
        if (!province || province.countryId !== defenderCountryId) {
          continue
        }
        const ownerHouse = currentState.houses[province.ownerHouseId]
        if (ownerHouse && ownerHouse.seatProvinceId === provinceId) {
          continue
        }
        if (province.neighbors.some((nid) => attackerProvinceSet.has(nid))) {
          borderProvinceIds.push(provinceId)
        }
      }

      if (borderProvinceIds.length === 0) {
        continue
      }

      const defenderCountryObj = currentState.countries[defenderCountryId]
      const defenderPower =
        calcCountryMilitaryPower(currentState, currentCtx.config, defenderCountryId) *
        (defenderCountryObj
          ? calcGeneralWarPowerModifier(currentState, defenderCountryId, currentCtx.config)
          : 1)
      const winChance = attackerPower / (attackerPower + defenderPower + 1)

      const declareThreshold = calcGeneralDeclareThreshold(
        currentState,
        attackerCountryId,
        currentCtx.config,
      )
      if (winChance < declareThreshold) {
        continue
      }

      warsThisTick++

      const updatedAttacker = { ...attackerCountry, lastWarMonth: currentAbsoluteMonth }
      currentCtx = {
        ...currentCtx,
        state: {
          ...currentCtx.state,
          countries: { ...currentCtx.state.countries, [attackerCountryId]: updatedAttacker },
        },
      }

      currentCtx = emitWarEvent(
        currentCtx,
        'WAR_DECLARED',
        generalId,
        attackerCountryId,
        defenderCountryId,
        `${attackerCountry.name} declared war on ${defenderCountry.name}!`,
      )

      const { value: warRoll, rng: warRng } = randomFloat(currentCtx.rng)
      currentCtx = { ...currentCtx, rng: warRng }

      if (warRoll < winChance) {
        const maxToTake = Math.min(
          currentCtx.config.maxProvincesPerWar,
          borderProvinceIds.length,
          Math.floor(attackerCountry.treasury / currentCtx.config.warCostPerProvince),
        )
        const effectiveMaxToTake = maxToTake < 1 ? 1 : maxToTake
        const { value: numToTake, rng: intRng } = randomInt(currentCtx.rng, 1, effectiveMaxToTake)
        currentCtx = { ...currentCtx, rng: intRng }

        const provincesToTake = borderProvinceIds.slice(0, numToTake)
        const totalCost = provincesToTake.length * currentCtx.config.warCostPerProvince

        const newAttackerTreasury = Math.max(0, attackerCountry.treasury - totalCost)
        const treasuryUpdatedAttacker = { ...attackerCountry, treasury: newAttackerTreasury }
        currentCtx = {
          ...currentCtx,
          state: {
            ...currentCtx.state,
            countries: {
              ...currentCtx.state.countries,
              [attackerCountryId]: treasuryUpdatedAttacker,
            },
          },
        }

        const rulerHouseId =
          getCountryRulerHouse(currentState, attackerCountryId) ?? attackerCountry.houseIds[0]
        if (!rulerHouseId) {
          continue
        }

        const remainingBorderProvinceIds = borderProvinceIds.filter(
          (id) => !provincesToTake.includes(id),
        )

        {
          const devastatedProvinces = { ...currentCtx.state.provinces }
          for (const pid of provincesToTake) {
            const p = devastatedProvinces[pid]
            if (!p) continue
            devastatedProvinces[pid] = {
              ...p,
              development: clamp(
                p.development - currentCtx.config.warConqueredProvinceDevastation,
                -100,
                100,
              ),
            }
          }
          for (const pid of remainingBorderProvinceIds) {
            const p = devastatedProvinces[pid]
            if (!p) continue
            devastatedProvinces[pid] = {
              ...p,
              development: clamp(
                p.development - currentCtx.config.warBorderProvinceDevastation,
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

        let stateWithPopEffects = currentCtx.state
        for (const pid of provincesToTake) {
          stateWithPopEffects = adjustProvincePopWealth(
            stateWithPopEffects,
            pid,
            -currentCtx.config.warWealthDamage,
          )
          stateWithPopEffects = adjustProvincePopUnrest(
            stateWithPopEffects,
            pid,
            currentCtx.config.warUnrestDamage,
          )
          stateWithPopEffects = adjustProvincePopSizeByClass(
            stateWithPopEffects,
            pid,
            'peasants',
            -currentCtx.config.warPeasantSizeDamage,
          )
          stateWithPopEffects = adjustProvincePopSizeByClass(
            stateWithPopEffects,
            pid,
            'townsmen',
            -currentCtx.config.warTownsmanSizeDamage,
          )
        }
        currentCtx = { ...currentCtx, state: stateWithPopEffects }

        for (const provinceId of provincesToTake) {
          currentState = currentCtx.state
          const province = currentState.provinces[provinceId]
          if (!province) {
            continue
          }

          // v013-residual: transferProvinceToHouse used instead of transferProvinceToCountry;
          // the latter adds country-ownership validation that fails in edge cases where
          // attackerCountry.houseIds[0] fallback has stale countryId, causing >10% digest divergence
          const tResult = transferProvinceToHouse(currentCtx.state, provinceId, rulerHouseId)
          if (!tResult.ok) continue
          currentCtx = { ...currentCtx, state: tResult.value }

          const provinceName = currentState.provinces[provinceId]?.name ?? provinceId
          currentCtx = emitProvinceConquered(
            currentCtx,
            generalId,
            attackerCountryId,
            defenderCountryId,
            rulerHouseId,
            provinceId,
            provinceName,
            attackerCountry.name,
          )
        }

        {
          let winnerState = currentCtx.state
          winnerState = adjustCountryLegacyPrestige(winnerState, attackerCountryId, 3)
          const winnerRulerHouseId = getCountryRulerHouse(winnerState, attackerCountryId)
          if (winnerRulerHouseId) {
            winnerState = adjustHouseLegacyPrestige(winnerState, winnerRulerHouseId, 2)
          }
          winnerState = adjustPersonLegacyPrestige(winnerState, generalId, 4)
          currentCtx = { ...currentCtx, state: winnerState }
        }

        {
          const defenderCheck = currentCtx.state.countries[defenderCountryId]
          if (defenderCheck) {
            const capProv = currentCtx.state.provinces[defenderCheck.capitalProvinceId]
            if (!capProv || capProv.countryId !== defenderCountryId) {
              const newCap = Object.values(currentCtx.state.provinces).find(
                (p) => p.countryId === defenderCountryId,
              )
              currentCtx = {
                ...currentCtx,
                state: {
                  ...currentCtx.state,
                  countries: {
                    ...currentCtx.state.countries,
                    [defenderCountryId]: {
                      ...defenderCheck,
                      capitalProvinceId: newCap?.id ?? ('' as ProvinceId),
                    },
                  },
                },
              }
            }
          }
        }

        currentState = currentCtx.state
        const defenderAfterTransfers = currentState.countries[defenderCountryId]
        if (defenderAfterTransfers) {
          const defenderNonSeatProvinceCount = Object.values(currentState.provinces).filter((p) => {
            if (p.countryId !== defenderCountryId) return false
            const ownerHouse = currentState.houses[p.ownerHouseId]
            return ownerHouse?.seatProvinceId !== p.id
          }).length
          if (defenderNonSeatProvinceCount === 0) {
            currentCtx = {
              ...currentCtx,
              state: annexCountry(currentCtx.state, defenderCountryId, attackerCountryId),
            }

            const attackerName =
              currentCtx.state.countries[attackerCountryId]?.name ?? attackerCountry.name
            const defenderName = defenderAfterTransfers.name
            currentCtx = emitCountryAnnexed(
              currentCtx,
              generalId,
              attackerCountryId,
              defenderCountryId,
              defenderName,
              attackerName,
            )
          }
        }

        currentCtx = emitWarEvent(
          currentCtx,
          'WAR_WON',
          generalId,
          attackerCountryId,
          defenderCountryId,
          `${attackerCountry.name} won the war against ${defenderCountry.name}.`,
        )

        break
      } else {
        {
          const currentAttacker = currentCtx.state.countries[attackerCountryId]
          if (currentAttacker) {
            const newTreasury = Math.max(
              0,
              currentAttacker.treasury - currentCtx.config.warCostPerProvince,
            )
            let loserState: WorldState = {
              ...currentCtx.state,
              countries: {
                ...currentCtx.state.countries,
                [attackerCountryId]: { ...currentAttacker, treasury: newTreasury },
              },
            }
            loserState = adjustCountryLegacyPrestige(loserState, attackerCountryId, -3)
            const loserRulerHouseId = getCountryRulerHouse(loserState, attackerCountryId)
            if (loserRulerHouseId) {
              loserState = adjustHouseLegacyPrestige(loserState, loserRulerHouseId, -2)
            }
            loserState = adjustPersonLegacyPrestige(loserState, generalId, -4)
            currentCtx = { ...currentCtx, state: loserState }
          }
        }

        {
          const defenderProvinceSet = new Set<ProvinceId>()
          for (const houseId of defenderCountry.houseIds) {
            const h = currentCtx.state.houses[houseId]
            if (!h) continue
            for (const pid of h.provinceIds) {
              defenderProvinceSet.add(pid)
            }
          }
          const attackerBorderProvinces: ProvinceId[] = []
          for (const pid of Object.keys(currentCtx.state.provinces)) {
            const p = currentCtx.state.provinces[pid as ProvinceId]
            if (!p || p.countryId !== attackerCountryId) continue
            if (p.neighbors.some((nid) => defenderProvinceSet.has(nid))) {
              attackerBorderProvinces.push(pid as ProvinceId)
            }
          }
          const devastatedProvinces = { ...currentCtx.state.provinces }
          for (const pid of attackerBorderProvinces) {
            const p = devastatedProvinces[pid]
            if (!p) continue
            devastatedProvinces[pid] = {
              ...p,
              development: clamp(
                p.development - currentCtx.config.failedWarBorderDevastation,
                -100,
                100,
              ),
            }
          }
          currentCtx = {
            ...currentCtx,
            state: { ...currentCtx.state, provinces: devastatedProvinces },
          }

          let stateWithPopEffectsLost = currentCtx.state
          for (const pid of attackerBorderProvinces) {
            stateWithPopEffectsLost = adjustProvincePopWealth(
              stateWithPopEffectsLost,
              pid,
              -currentCtx.config.warWealthDamage,
            )
            stateWithPopEffectsLost = adjustProvincePopUnrest(
              stateWithPopEffectsLost,
              pid,
              currentCtx.config.warUnrestDamage,
            )
          }
          currentCtx = { ...currentCtx, state: stateWithPopEffectsLost }
        }

        currentCtx = emitWarEvent(
          currentCtx,
          'WAR_LOST',
          generalId,
          attackerCountryId,
          defenderCountryId,
          `${attackerCountry.name} lost the war against ${defenderCountry.name}.`,
        )

        break
      }
    }
  }

  return currentCtx
}
