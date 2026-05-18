import type { TickContext } from './context'
import { makeEventId } from './context'
import { randomFloat, randomInt } from '../rng/rng'
import { clamp } from '../utils/math'
import {
  adjustPolityLegacyPrestige,
  adjustHouseLegacyPrestige,
  adjustPersonLegacyPrestige,
} from '../helpers/attitudeHelpers'
import { calcPolityMilitaryPower } from '../selectors/militarySelectors'
import {
  calcGeneralWarPowerModifier,
  calcGeneralDeclareThreshold,
} from '../selectors/personAbilityEffects'
import { transferProvinceToPolity } from '../mutations/provinceMutations'
import { annexPolity } from '../mutations/polityMutations'
import type { PolityId, HouseId, PersonId, ProvinceId } from '../types/ids'
import type { WorldState } from '../types/world'
import type { SimEvent } from '../types/event'
import {
  adjustProvincePopWealth,
  adjustProvincePopUnrest,
  adjustProvincePopSizeByClass,
} from '../mutations/popMutations'
import { getPolityLeaderHouse, getActiveOfficeHolders } from '../selectors/officeSelectors'
import { getPolityHouseIds } from '../selectors/polityRelations'

function emitWarEvent(
  ctx: TickContext,
  type: 'WAR_DECLARED' | 'WAR_WON' | 'WAR_LOST',
  generalId: PersonId,
  attackerPolityId: PolityId,
  defenderPolityId: PolityId,
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
    polityIds: [attackerPolityId, defenderPolityId],
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
  attackerPolityId: PolityId,
  defenderPolityId: PolityId,
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
    polityIds: [attackerPolityId, defenderPolityId],
    provinceIds: [provinceId],
    summary: `${provinceName} was conquered by ${attackerName}.`,
    reasons: [],
    effects: [],
  }
  return { ...eventCtx, state: eventCtx.state, events: [...eventCtx.events, event] }
}

function emitPolityAnnexed(
  ctx: TickContext,
  generalId: PersonId,
  attackerPolityId: PolityId,
  defenderPolityId: PolityId,
  defenderName: string,
  attackerName: string,
): TickContext {
  const { id: eventId, ctx: eventCtx } = makeEventId(ctx)
  const event: SimEvent = {
    id: eventId,
    year: eventCtx.state.currentYear,
    month: eventCtx.state.currentMonth,
    type: 'POLITY_ANNEXED',
    importance: 'critical',
    actorIds: [generalId],
    houseIds: [],
    polityIds: [attackerPolityId, defenderPolityId],
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

  const polityIds = Object.keys(currentState.polities).sort() as PolityId[]

  for (const attackerPolityId of polityIds) {
    if (warsThisTick >= currentCtx.config.maxWarsPerTick) {
      break
    }

    currentState = currentCtx.state
    const attackerPolity = currentState.polities[attackerPolityId]
    if (!attackerPolity || !attackerPolity.active) {
      continue
    }

    const currentAbsoluteMonth = currentState.currentYear * 12 + currentState.currentMonth
    if (attackerPolity.lastWarMonth !== undefined) {
      if (
        currentAbsoluteMonth - attackerPolity.lastWarMonth <
        currentCtx.config.warCooldownMonths
      ) {
        continue
      }
    }

    const militaryHolders = getActiveOfficeHolders(
      currentState,
      { kind: 'polity', id: attackerPolityId },
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

    if (attackerPolity.treasury < currentCtx.config.warCostPerProvince) {
      continue
    }

    const attackerPower =
      calcPolityMilitaryPower(currentState, currentCtx.config, attackerPolityId) *
      calcGeneralWarPowerModifier(currentState, attackerPolityId, currentCtx.config)

    const attackerProvinceSet = new Set<ProvinceId>()
    for (const houseId of getPolityHouseIds(currentState, attackerPolityId)) {
      currentState = currentCtx.state
      const house = currentState.houses[houseId]
      if (!house) {
        continue
      }
      for (const provinceId of house.provinceIds) {
        attackerProvinceSet.add(provinceId)
      }
    }

    for (const defenderPolityId of polityIds) {
      if (defenderPolityId === attackerPolityId) {
        continue
      }

      currentState = currentCtx.state
      const defenderPolity = currentState.polities[defenderPolityId]
      if (!defenderPolity || !defenderPolity.active) {
        continue
      }

      const borderProvinceIds: ProvinceId[] = []
      for (const provinceIdStr of Object.keys(currentState.provinces)) {
        const provinceId = provinceIdStr as ProvinceId
        const province = currentState.provinces[provinceId]
        if (!province || province.polityId !== defenderPolityId) {
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

      const defenderPolityObj = currentState.polities[defenderPolityId]
      const defenderPower =
        calcPolityMilitaryPower(currentState, currentCtx.config, defenderPolityId) *
        (defenderPolityObj
          ? calcGeneralWarPowerModifier(currentState, defenderPolityId, currentCtx.config)
          : 1)
      const winChance = attackerPower / (attackerPower + defenderPower + 1)

      const declareThreshold = calcGeneralDeclareThreshold(
        currentState,
        attackerPolityId,
        currentCtx.config,
      )
      if (winChance < declareThreshold) {
        continue
      }

      warsThisTick++

      const updatedAttacker = { ...attackerPolity, lastWarMonth: currentAbsoluteMonth }
      currentCtx = {
        ...currentCtx,
        state: {
          ...currentCtx.state,
          polities: { ...currentCtx.state.polities, [attackerPolityId]: updatedAttacker },
        },
      }

      currentCtx = emitWarEvent(
        currentCtx,
        'WAR_DECLARED',
        generalId,
        attackerPolityId,
        defenderPolityId,
        `${attackerPolity.name} declared war on ${defenderPolity.name}!`,
      )

      const { value: warRoll, rng: warRng } = randomFloat(currentCtx.rng)
      currentCtx = { ...currentCtx, rng: warRng }

      if (warRoll < winChance) {
        const maxToTake = Math.min(
          currentCtx.config.maxProvincesPerWar,
          borderProvinceIds.length,
          Math.floor(attackerPolity.treasury / currentCtx.config.warCostPerProvince),
        )
        const effectiveMaxToTake = maxToTake < 1 ? 1 : maxToTake
        const { value: numToTake, rng: intRng } = randomInt(currentCtx.rng, 1, effectiveMaxToTake)
        currentCtx = { ...currentCtx, rng: intRng }

        const provincesToTake = borderProvinceIds.slice(0, numToTake)
        const totalCost = provincesToTake.length * currentCtx.config.warCostPerProvince

        const newAttackerTreasury = Math.max(0, attackerPolity.treasury - totalCost)
        const treasuryUpdatedAttacker = { ...attackerPolity, treasury: newAttackerTreasury }
        currentCtx = {
          ...currentCtx,
          state: {
            ...currentCtx.state,
            polities: {
              ...currentCtx.state.polities,
              [attackerPolityId]: treasuryUpdatedAttacker,
            },
          },
        }

        // v0.15 §17.3: 征服 Province の新 ownerHouse 選定
        // 1) attacker Polity の ownerHouseId
        // 2) attacker Polity leader が属する House
        // 3) attacker Polity 内で最大 Share の House
        // 4) Polity 内で Province 数最大の House
        const attackerOwnerHouseId = attackerPolity.ownerHouseId
        const rulerHouseId =
          (attackerOwnerHouseId && currentState.houses[attackerOwnerHouseId]?.active
            ? attackerOwnerHouseId
            : undefined) ??
          getPolityLeaderHouse(currentState, attackerPolityId) ??
          getPolityHouseIds(currentState, attackerPolityId)[0]
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

          const tResult = transferProvinceToPolity(
            currentCtx.state,
            provinceId,
            attackerPolityId,
            rulerHouseId,
          )
          if (!tResult.ok) continue
          currentCtx = { ...currentCtx, state: tResult.value }

          const provinceName = currentState.provinces[provinceId]?.name ?? provinceId
          currentCtx = emitProvinceConquered(
            currentCtx,
            generalId,
            attackerPolityId,
            defenderPolityId,
            rulerHouseId,
            provinceId,
            provinceName,
            attackerPolity.name,
          )
        }

        {
          let winnerState = currentCtx.state
          winnerState = adjustPolityLegacyPrestige(winnerState, attackerPolityId, 3)
          const winnerRulerHouseId = getPolityLeaderHouse(winnerState, attackerPolityId)
          if (winnerRulerHouseId) {
            winnerState = adjustHouseLegacyPrestige(winnerState, winnerRulerHouseId, 2)
          }
          winnerState = adjustPersonLegacyPrestige(winnerState, generalId, 4)
          currentCtx = { ...currentCtx, state: winnerState }
        }

        {
          const defenderCheck = currentCtx.state.polities[defenderPolityId]
          if (defenderCheck) {
            const capProv = currentCtx.state.provinces[defenderCheck.capitalProvinceId]
            if (!capProv || capProv.polityId !== defenderPolityId) {
              const newCap = Object.values(currentCtx.state.provinces).find(
                (p) => p?.polityId === defenderPolityId,
              )
              currentCtx = {
                ...currentCtx,
                state: {
                  ...currentCtx.state,
                  polities: {
                    ...currentCtx.state.polities,
                    [defenderPolityId]: {
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
        const defenderAfterTransfers = currentState.polities[defenderPolityId]
        if (defenderAfterTransfers) {
          const defenderNonSeatProvinceCount = Object.values(currentState.provinces).filter((p) => {
            if (p?.polityId !== defenderPolityId) return false
            const ownerHouse = currentState.houses[p.ownerHouseId]
            return ownerHouse?.seatProvinceId !== p.id
          }).length
          if (defenderNonSeatProvinceCount === 0) {
            currentCtx = {
              ...currentCtx,
              state: annexPolity(currentCtx.state, defenderPolityId, attackerPolityId),
            }

            const attackerName =
              currentCtx.state.polities[attackerPolityId]?.name ?? attackerPolity.name
            const defenderName = defenderAfterTransfers.name
            currentCtx = emitPolityAnnexed(
              currentCtx,
              generalId,
              attackerPolityId,
              defenderPolityId,
              defenderName,
              attackerName,
            )
          }
        }

        currentCtx = emitWarEvent(
          currentCtx,
          'WAR_WON',
          generalId,
          attackerPolityId,
          defenderPolityId,
          `${attackerPolity.name} won the war against ${defenderPolity.name}.`,
        )

        break
      } else {
        {
          const currentAttacker = currentCtx.state.polities[attackerPolityId]
          if (currentAttacker) {
            const newTreasury = Math.max(
              0,
              currentAttacker.treasury - currentCtx.config.warCostPerProvince,
            )
            let loserState: WorldState = {
              ...currentCtx.state,
              polities: {
                ...currentCtx.state.polities,
                [attackerPolityId]: { ...currentAttacker, treasury: newTreasury },
              },
            }
            loserState = adjustPolityLegacyPrestige(loserState, attackerPolityId, -3)
            const loserRulerHouseId = getPolityLeaderHouse(loserState, attackerPolityId)
            if (loserRulerHouseId) {
              loserState = adjustHouseLegacyPrestige(loserState, loserRulerHouseId, -2)
            }
            loserState = adjustPersonLegacyPrestige(loserState, generalId, -4)
            currentCtx = { ...currentCtx, state: loserState }
          }
        }

        {
          const defenderProvinceSet = new Set<ProvinceId>()
          for (const houseId of getPolityHouseIds(currentCtx.state, defenderPolityId)) {
            const h = currentCtx.state.houses[houseId]
            if (!h) continue
            for (const pid of h.provinceIds) {
              defenderProvinceSet.add(pid)
            }
          }
          const attackerBorderProvinces: ProvinceId[] = []
          for (const pid of Object.keys(currentCtx.state.provinces)) {
            const p = currentCtx.state.provinces[pid as ProvinceId]
            if (!p || p.polityId !== attackerPolityId) continue
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
          attackerPolityId,
          defenderPolityId,
          `${attackerPolity.name} lost the war against ${defenderPolity.name}.`,
        )

        break
      }
    }
  }

  return currentCtx
}
