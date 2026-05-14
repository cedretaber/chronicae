import type { TickContext } from './context'
import { makeEventId } from './context'
import { randomFloat, randomInt } from '../rng/rng'
import { clamp, clamp100 } from '../utils/math'
import { calcCountryMilitaryPower } from '../selectors/militarySelectors'
import {
  calcGeneralWarPowerModifier,
  calcGeneralDeclareThreshold,
} from '../selectors/personAbilityEffects'
import { transferProvinceToHouse } from '../mutations/transferProvince'
import { annexCountry } from '../mutations/annexCountry'
import type { CountryId, HouseId, PersonId, ProvinceId } from '../types/ids'
import type { SimEvent } from '../types/event'

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

    const generalId = attackerCountry.roleAssignments.general
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
      calcCountryMilitaryPower(currentState, attackerCountryId) *
      calcGeneralWarPowerModifier(currentState, attackerCountry, currentCtx.config)

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
        calcCountryMilitaryPower(currentState, defenderCountryId) *
        (defenderCountryObj
          ? calcGeneralWarPowerModifier(currentState, defenderCountryObj, currentCtx.config)
          : 1)
      const winChance = attackerPower / (attackerPower + defenderPower + 1)

      const declareThreshold = calcGeneralDeclareThreshold(
        currentState,
        attackerCountry,
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

        const rulerHouseId = attackerCountry.rulerHouseId

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

        for (const provinceId of provincesToTake) {
          currentState = currentCtx.state
          const province = currentState.provinces[provinceId]
          if (!province) {
            continue
          }

          currentCtx = {
            ...currentCtx,
            state: transferProvinceToHouse(currentCtx.state, provinceId, rulerHouseId),
          }

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

        const currentAttacker = currentCtx.state.countries[attackerCountryId]
        if (currentAttacker) {
          const boostedLegitimacy = clamp100(currentAttacker.legitimacy + 5)
          currentCtx = {
            ...currentCtx,
            state: {
              ...currentCtx.state,
              countries: {
                ...currentCtx.state.countries,
                [attackerCountryId]: { ...currentAttacker, legitimacy: boostedLegitimacy },
              },
            },
          }
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
        const currentAttacker = currentCtx.state.countries[attackerCountryId]
        if (currentAttacker) {
          const newTreasury = Math.max(
            0,
            currentAttacker.treasury - currentCtx.config.warCostPerProvince,
          )
          const newStability = clamp100(currentAttacker.stability - 10)
          const newLegitimacy = clamp100(currentAttacker.legitimacy - 8)
          currentCtx = {
            ...currentCtx,
            state: {
              ...currentCtx.state,
              countries: {
                ...currentCtx.state.countries,
                [attackerCountryId]: {
                  ...currentAttacker,
                  treasury: newTreasury,
                  stability: newStability,
                  legitimacy: newLegitimacy,
                },
              },
            },
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
