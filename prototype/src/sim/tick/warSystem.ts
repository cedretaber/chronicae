import type { TickContext } from './context'
import { makeEventId } from './context'
import { randomFloat, randomInt } from '../rng/rng'
import { clamp100 } from '../utils/math'
import { calcCountryMilitaryPower } from '../selectors/militarySelectors'
import { transferProvinceToHouse } from '../mutations/transferProvince'
import { moveHouseToCountry } from '../mutations/moveHouse'
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

    const attackerPower = calcCountryMilitaryPower(currentState, attackerCountryId)

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
        if (province.neighbors.some((nid) => attackerProvinceSet.has(nid))) {
          borderProvinceIds.push(provinceId)
        }
      }

      if (borderProvinceIds.length === 0) {
        continue
      }

      const defenderPower = calcCountryMilitaryPower(currentState, defenderCountryId)
      const winChance = attackerPower / (attackerPower + defenderPower + 1)

      if (winChance < currentCtx.config.minAttackerWinChanceToDeclare) {
        continue
      }

      warsThisTick++

      const updatedAttacker = { ...attackerCountry, lastWarMonth: currentAbsoluteMonth }
      currentCtx.state = {
        ...currentCtx.state,
        countries: { ...currentCtx.state.countries, [attackerCountryId]: updatedAttacker },
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
        currentCtx.state = {
          ...currentCtx.state,
          countries: {
            ...currentCtx.state.countries,
            [attackerCountryId]: treasuryUpdatedAttacker,
          },
        }

        const rulerHouseId = attackerCountry.rulerHouseId

        for (const provinceId of provincesToTake) {
          currentState = currentCtx.state
          const province = currentState.provinces[provinceId]
          if (!province) {
            continue
          }

          currentCtx.state = transferProvinceToHouse(currentCtx.state, provinceId, rulerHouseId)

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
          currentCtx.state = {
            ...currentCtx.state,
            countries: {
              ...currentCtx.state.countries,
              [attackerCountryId]: { ...currentAttacker, legitimacy: boostedLegitimacy },
            },
          }
        }

        currentState = currentCtx.state
        const defenderAfterTransfers = currentState.countries[defenderCountryId]
        if (defenderAfterTransfers) {
          const defenderProvinceCount = Object.values(currentState.provinces).filter(
            (p) => p.countryId === defenderCountryId,
          ).length
          if (defenderProvinceCount === 0) {
            const defenderHouseIds = [...defenderAfterTransfers.houseIds]
            for (const houseId of defenderHouseIds) {
              currentState = currentCtx.state
              const defenderCountry = currentState.countries[defenderCountryId]
              if (!defenderCountry) {
                break
              }
              currentCtx.state = moveHouseToCountry(currentCtx.state, houseId, attackerCountryId)
            }

            currentState = currentCtx.state
            const finalDefender = currentState.countries[defenderCountryId]
            if (finalDefender) {
              currentCtx.state = {
                ...currentCtx.state,
                countries: {
                  ...currentCtx.state.countries,
                  [defenderCountryId]: { ...finalDefender, active: false },
                },
              }
            }

            const attackerName =
              currentCtx.state.countries[attackerCountryId]?.name ?? attackerCountry.name
            const defenderName = finalDefender?.name ?? defenderCountry.name
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
          currentCtx.state = {
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
