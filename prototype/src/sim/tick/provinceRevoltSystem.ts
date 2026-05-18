import type { TickContext } from './context'
import { makeEventId, makePersonId, makeHouseId } from './context'
import { clamp } from '../utils/math'
import { randomFloat, randomInt } from '../rng/rng'
import type { ProvinceId, HouseId, PolityId, PersonId } from '../types/ids'
import type { PopClass } from '../types/popGroup'
import type { SimEvent } from '../types/event'
import type { Person } from '../types/person'
import type { House } from '../types/house'
import { getProvincePopulationPressure } from '../selectors/popSelectors'
import { getPopWealthByClass } from '../selectors/popSelectors'
import { getProvinceProduction } from '../selectors/popEconomySelectors'
import {
  getProvinceManpowerBase,
  getProvinceHouseManpowerBase,
} from '../selectors/popEconomySelectors'
import {
  adjustProvincePopUnrestByClass,
  adjustProvincePopUnrest,
  adjustProvincePopWealthByClass,
} from '../mutations/popMutations'
import { transferProvinceToHouse } from '../mutations/provinceMutations'
import {
  pickNameBySex,
  pickUniqueName,
  houseNamePool,
  houseName as houseNameFn,
} from '../worldgen/nameGenerators'
import {
  getAttitudeOrDefault,
  attitudeValueToScore,
  adjustPolityLegacyPrestige,
} from '../helpers/attitudeHelpers'
import { adjustPopAttitude } from '../mutations/attitudeMutations'
import { getPolityLegitimacy, getPolityStability } from '../selectors/statusSelectors'
import { getPolityLeaderHouse } from '../selectors/officeSelectors'
import { getPolityHouseIds } from '../selectors/polityRelations'
import { createOfficeAssignment } from '../mutations/officeMutations'
import { foundRevoltCountry } from '../mutations/worldStructureMutations'
import { samplePerson } from '../helpers/personFactory'

type RevoltCandidate = {
  provinceId: ProvinceId
  rebelClass: PopClass
  revoltTendency: number
}

function calcRevoltTendency(
  ctx: TickContext,
  provinceId: ProvinceId,
  rebelClass: PopClass,
): number {
  const state = ctx.state
  const config = ctx.config

  const province = state.provinces[provinceId]
  if (!province) return 0

  const polity = state.polities[province.polityId]
  if (!polity) return 0

  const ownerHouse = state.houses[province.ownerHouseId]
  if (!ownerHouse) return 0

  const pop = (() => {
    for (const popId of province.popGroupIds) {
      const p = state.popGroups[popId]
      if (p && p.class === rebelClass) return p
    }
    return undefined
  })()
  if (!pop) return 0

  let tendency =
    pop.unrest * config.provinceRevoltUnrestFactor +
    (100 - province.houseControl) * config.provinceRevoltLowHouseControlFactor +
    (100 - province.polityControl) * config.provinceRevoltLowCountryControlFactor -
    getPolityStability(state, config, province.polityId) *
      config.provinceRevoltStabilitySuppressionFactor

  if (rebelClass === 'peasants') {
    if (pop.wealth < config.povertyWealthThreshold) {
      tendency += (config.povertyWealthThreshold - pop.wealth) * config.peasantRevoltPovertyFactor
    }
    tendency +=
      getProvincePopulationPressure(state, config, provinceId) * config.peasantRevoltPressureFactor
  } else if (rebelClass === 'townsmen') {
    const townsmenWealth = getPopWealthByClass(state, provinceId, 'townsmen')
    if (townsmenWealth < config.overExtractionWealthSafeThreshold) {
      tendency += config.townsmenRevoltExtractionFactor
      tendency +=
        Math.log1p(getProvinceProduction(state, config, provinceId)) *
        config.townsmenRevoltProductionFactor
    }
  } else if (rebelClass === 'nobles') {
    // Use the nobles pop's attitudes toward house and polity
    const a_house = getAttitudeOrDefault(state, pop, { kind: 'house', id: province.ownerHouseId })
    const a_polity = getAttitudeOrDefault(state, pop, { kind: 'polity', id: province.polityId })
    const houseScore =
      attitudeValueToScore(a_house.affection) * 0.6 + attitudeValueToScore(a_house.respect) * 0.4
    const polityScore =
      attitudeValueToScore(a_polity.affection) * 0.6 + attitudeValueToScore(a_polity.respect) * 0.4
    const nobleDisloyalty = 100 - (0.5 * houseScore + 0.5 * polityScore)
    tendency += nobleDisloyalty * config.nobleRevoltHouseDisloyaltyFactor
    tendency +=
      (100 - getPolityLegitimacy(state, province.polityId)) * config.nobleRevoltLowLegitimacyFactor
  }

  return tendency
}

function collectCandidates(ctx: TickContext): RevoltCandidate[] {
  const candidates: RevoltCandidate[] = []
  const config = ctx.config

  for (const provinceId of Object.keys(ctx.state.provinces).sort()) {
    const province = ctx.state.provinces[provinceId as ProvinceId]
    if (!province) continue

    const polity = ctx.state.polities[province.polityId]
    if (!polity || !polity.active) continue

    const ownerHouse = ctx.state.houses[province.ownerHouseId]
    if (!ownerHouse || !ownerHouse.active) continue

    const classes: PopClass[] = ['peasants', 'townsmen', 'nobles']
    let bestClass: PopClass | undefined
    let bestTendency = -Infinity

    for (const cls of classes) {
      const tendency = calcRevoltTendency(ctx, provinceId as ProvinceId, cls)
      if (tendency > bestTendency) {
        bestTendency = tendency
        bestClass = cls
      }
    }

    if (bestClass === undefined || bestTendency < config.provinceRevoltThreshold) continue

    candidates.push({
      provinceId: provinceId as ProvinceId,
      rebelClass: bestClass,
      revoltTendency: bestTendency,
    })
  }

  return candidates
}

function resolveRevolt(ctx: TickContext, candidate: RevoltCandidate): TickContext {
  const { provinceId, rebelClass, revoltTendency } = candidate
  const config = ctx.config

  // Re-check province validity at resolution time
  const province = ctx.state.provinces[provinceId]
  if (!province) return ctx

  const polity = ctx.state.polities[province.polityId]
  if (!polity || !polity.active) return ctx

  const ownerHouse = ctx.state.houses[province.ownerHouseId]
  if (!ownerHouse || !ownerHouse.active) return ctx

  // Check revolt chance
  const revoltChance = clamp(
    revoltTendency / config.provinceRevoltChanceDivisor,
    0,
    config.provinceRevoltMaxChance,
  )

  const { value: roll1, rng: rng1 } = randomFloat(ctx.rng)
  ctx = { ...ctx, rng: rng1 }

  if (roll1 >= revoltChance) return ctx

  // Emit PROVINCE_REVOLT_STARTED event
  const { id: startEventId, ctx: ctx1 } = makeEventId(ctx)
  const startEvent: SimEvent = {
    id: startEventId,
    year: ctx1.state.currentYear,
    month: ctx1.state.currentMonth,
    type: 'PROVINCE_REVOLT_STARTED',
    importance: 'normal',
    actorIds: [],
    houseIds: [province.ownerHouseId],
    polityIds: [province.polityId],
    provinceIds: [provinceId],
    summary: `A ${rebelClass} revolt has started in ${province.name}!`,
    reasons: [],
    effects: [],
  }
  ctx = { ...ctx1, events: [...ctx1.events, startEvent] }

  // Revolt power
  const pop = (() => {
    for (const popId of province.popGroupIds) {
      const p = ctx.state.popGroups[popId]
      if (p && p.class === rebelClass) return p
    }
    return undefined
  })()
  if (!pop) return ctx

  const popRevoltPower =
    pop.size * config.popRevoltPowerFactorByClass[rebelClass] * (0.5 + pop.unrest / 100)

  // Suppression power
  const ownerHousePower =
    getProvinceHouseManpowerBase(ctx.state, config, provinceId) *
    config.provinceRevoltHouseSuppressionFactor

  const polityPower =
    getProvinceManpowerBase(ctx.state, config, provinceId) *
    config.provinceRevoltCountrySuppressionFactor

  let suppressionPower = ownerHousePower + polityPower
  suppressionPower += Math.log1p(polity.treasury) * config.provinceRevoltTreasurySuppressionFactor
  suppressionPower +=
    Math.log1p(ownerHouse.wealth) * config.provinceRevoltHouseWealthSuppressionFactor

  // Success roll
  const successChance = popRevoltPower / (popRevoltPower + suppressionPower + 1)
  const { value: successRoll, rng: rng2 } = randomFloat(ctx.rng)
  ctx = { ...ctx, rng: rng2 }

  if (successRoll >= successChance) {
    // Revolt FAILED
    return resolveRevoltFailure(ctx, provinceId, rebelClass, province.polityId)
  }

  // Revolt SUCCEEDED — determine outcome
  const successMargin = successChance - successRoll

  const canBecomeIndependent =
    rebelClass === 'nobles' &&
    province.polityControl <= config.provinceRevoltIndependenceCountryControlMax &&
    province.houseControl <= config.provinceRevoltIndependenceHouseControlMax &&
    successMargin >= config.provinceRevoltIndependenceSuccessMargin

  let outcome: 'concession' | 'lordship_change' | 'independence'
  if (canBecomeIndependent) {
    outcome = 'independence'
  } else if (rebelClass === 'nobles') {
    outcome = 'lordship_change'
  } else if (successMargin >= config.provinceRevoltLordshipChangeSuccessMargin) {
    outcome = 'lordship_change'
  } else {
    outcome = 'concession'
  }

  if (outcome === 'concession') {
    return resolveRevoltConcession(
      ctx,
      provinceId,
      rebelClass,
      province.polityId,
      province.ownerHouseId,
    )
  } else if (outcome === 'lordship_change') {
    return resolveRevoltLordshipChange(ctx, provinceId, rebelClass, province.polityId)
  } else {
    return resolveRevoltIndependence(ctx, provinceId, rebelClass, province.polityId)
  }
}

function resolveRevoltFailure(
  ctx: TickContext,
  provinceId: ProvinceId,
  rebelClass: PopClass,
  polityId: PolityId,
): TickContext {
  const config = ctx.config

  // Reduce rebel class unrest
  let newState = adjustProvincePopUnrestByClass(
    ctx.state,
    provinceId,
    rebelClass,
    -config.provinceRevoltFailedUnrestReduction,
  )

  // Devastate development
  const province = newState.provinces[provinceId]
  if (province) {
    newState = {
      ...newState,
      provinces: {
        ...newState.provinces,
        [provinceId]: {
          ...province,
          development: clamp(
            province.development - config.provinceRevoltFailedDevastation,
            -100,
            100,
          ),
        },
      },
    }
  }

  // Penalize rebel class wealth
  newState = adjustProvincePopWealthByClass(
    newState,
    provinceId,
    rebelClass,
    -config.provinceRevoltFailedWealthPenalty,
  )

  // Collateral unrest for other classes
  newState = adjustProvincePopUnrest(
    newState,
    provinceId,
    config.provinceRevoltSuppressionCollateralUnrestGain,
  )

  // Polity gains legacyPrestige
  const polity = newState.polities[polityId]
  if (polity) {
    const stateWithLegitimacy = adjustPolityLegacyPrestige(newState, polityId, 1)
    newState = stateWithLegitimacy
  }

  ctx = { ...ctx, state: newState }

  // Emit PROVINCE_REVOLT_FAILED event
  const { id: failEventId, ctx: ctx1 } = makeEventId(ctx)
  const province2 = ctx1.state.provinces[provinceId]
  const failEvent: SimEvent = {
    id: failEventId,
    year: ctx1.state.currentYear,
    month: ctx1.state.currentMonth,
    type: 'PROVINCE_REVOLT_FAILED',
    importance: 'normal',
    actorIds: [],
    houseIds: [],
    polityIds: [polityId],
    provinceIds: [provinceId],
    summary: `The ${rebelClass} revolt in ${province2?.name ?? provinceId} has been suppressed.`,
    reasons: [],
    effects: [],
  }
  return { ...ctx1, events: [...ctx1.events, failEvent] }
}

function resolveRevoltConcession(
  ctx: TickContext,
  provinceId: ProvinceId,
  rebelClass: PopClass,
  polityId: PolityId,
  ownerHouseId: HouseId,
): TickContext {
  const config = ctx.config

  let newState = ctx.state

  // Reduce province control
  const province = newState.provinces[provinceId]
  if (province) {
    newState = {
      ...newState,
      provinces: {
        ...newState.provinces,
        [provinceId]: {
          ...province,
          polityControl: clamp(
            province.polityControl - config.provinceRevoltConcessionCountryControlLoss,
            0,
            100,
          ),
          houseControl: clamp(
            province.houseControl - config.provinceRevoltConcessionHouseControlLoss,
            0,
            100,
          ),
        },
      },
    }
  }

  // Reduce rebel unrest
  newState = adjustProvincePopUnrestByClass(
    newState,
    provinceId,
    rebelClass,
    -config.provinceRevoltConcessionUnrestReduction,
  )

  // Rebel POP → Polity: respect -4, affection +2
  const currentProvince = newState.provinces[provinceId]
  const rebelPop = (() => {
    for (const popId of currentProvince?.popGroupIds ?? []) {
      const p = newState.popGroups[popId]
      if (p && p.class === rebelClass) return p
    }
    return undefined
  })()
  if (rebelPop) {
    const r = adjustPopAttitude(
      newState,
      rebelPop.id,
      { kind: 'polity', id: polityId },
      { respect: -4, affection: 2 },
    )
    if (r.ok) newState = r.value
  }

  // Owner house loses wealth
  const ownerHouse = newState.houses[ownerHouseId]
  if (ownerHouse) {
    newState = {
      ...newState,
      houses: {
        ...newState.houses,
        [ownerHouseId]: {
          ...ownerHouse,
          wealth: Math.max(0, ownerHouse.wealth - config.provinceRevoltConcessionHouseWealthLoss),
        },
      },
    }
  }

  ctx = { ...ctx, state: newState }

  // Emit PROVINCE_REVOLT_SUCCEEDED event
  const { id: eventId, ctx: ctx1 } = makeEventId(ctx)
  const province2 = ctx1.state.provinces[provinceId]
  const event: SimEvent = {
    id: eventId,
    year: ctx1.state.currentYear,
    month: ctx1.state.currentMonth,
    type: 'PROVINCE_REVOLT_SUCCEEDED',
    importance: 'major',
    actorIds: [],
    houseIds: [ownerHouseId],
    polityIds: [polityId],
    provinceIds: [provinceId],
    summary: `${rebelClass} revolt in ${province2?.name ?? provinceId} forced concessions.`,
    reasons: [],
    effects: [],
  }
  return { ...ctx1, events: [...ctx1.events, event] }
}

function resolveRevoltLordshipChange(
  ctx: TickContext,
  provinceId: ProvinceId,
  rebelClass: PopClass,
  polityId: PolityId,
): TickContext {
  const config = ctx.config
  const state = ctx.state

  const province = state.provinces[provinceId]
  if (!province) return ctx

  const oldOwnerHouseId = province.ownerHouseId
  const oldOwnerHouse = state.houses[oldOwnerHouseId]
  if (!oldOwnerHouse) return ctx

  const polity = state.polities[polityId]
  if (!polity) return ctx

  // Pre-generate IDs for the new leader and house
  const { id: newPersonId, ctx: ctx1 } = makePersonId(ctx)
  const { id: newHouseId, ctx: ctx2 } = makeHouseId(ctx1)

  // Generate leader name
  const { name: leaderName, rng: rng1 } = pickNameBySex('male', ctx2.rng)
  ctx = { ...ctx2, rng: rng1 }

  const { value: age, rng: rng2 } = randomInt(ctx.rng, 20, 45)
  ctx = { ...ctx, rng: rng2 }
  const { value: ambition, rng: rng3 } = randomInt(ctx.rng, 7, 10)
  ctx = { ...ctx, rng: rng3 }
  const { value: caution, rng: rng4 } = randomInt(ctx.rng, 2, 7)
  ctx = { ...ctx, rng: rng4 }
  const { value: legacyPrestige, rng: rng5 } = randomInt(ctx.rng, 5, 20)
  ctx = { ...ctx, rng: rng5 }

  const { value: newLeader, rng: rngAfterLeader } = samplePerson(ctx.rng, ctx.config, {
    id: newPersonId,
    name: leaderName,
    sex: 'male',
    age,
    houseId: newHouseId,
    birthStatus: 'unknown',
    traits: { ambition: ambition / 10, caution: caution / 10 },
    legacyPrestige,
  })
  ctx = { ...ctx, rng: rngAfterLeader }

  // Generate house name
  const usedHouseNames = new Set(
    Object.values(ctx.state.houses)
      .filter((h): h is NonNullable<typeof h> => h !== undefined && h.active)
      .map((h) => h.name),
  )
  const { name: houseName2, rng: rng9 } = pickUniqueName(
    houseNamePool(),
    usedHouseNames,
    houseNameFn,
    ctx.nextHouseIndex,
    ctx.rng,
  )
  ctx = { ...ctx, rng: rng9 }

  const newHouse: House = {
    id: newHouseId,
    name: houseName2,
    active: true,
    provinceIds: [],
    memberIds: [newPersonId],
    founderId: newPersonId,
    cadetHouseIds: [],
    legacyPrestige: config.revoltHouseInitialLegacyPrestige,
    wealth: config.revoltHouseInitialWealth,
    seatProvinceId: provinceId,
  }

  // Add new entities to state
  let newState: typeof ctx.state = {
    ...ctx.state,
    persons: { ...ctx.state.persons, [newPersonId]: newLeader },
    houses: { ...ctx.state.houses, [newHouseId]: newHouse },
    polities: {
      ...ctx.state.polities,
      [polityId]: {
        ...polity,
        houseIds: [...getPolityHouseIds(ctx.state, polityId), newHouseId],
      },
    },
  }

  // Assign house leader office for the new rebel house
  newState = createOfficeAssignment(
    newState,
    { kind: 'house' as const, id: newHouseId },
    'leader',
    newPersonId,
  )

  // Transfer province to new house
  const transferResult = transferProvinceToHouse(newState, provinceId, newHouseId)
  if (transferResult.ok) newState = transferResult.value

  // Fix province controls
  const updatedProvince = newState.provinces[provinceId]
  if (updatedProvince) {
    newState = {
      ...newState,
      provinces: {
        ...newState.provinces,
        [provinceId]: {
          ...updatedProvince,
          houseControl: config.provinceRevoltNewHouseControl,
          polityControl: Math.max(
            updatedProvince.polityControl - config.provinceRevoltLordshipChangeCountryControlLoss,
            0,
          ),
        },
      },
    }
  }

  // Handle old owner house becoming landless
  const updatedOldHouse = newState.houses[oldOwnerHouseId]
  if (updatedOldHouse && updatedOldHouse.provinceIds.length === 0) {
    // If the old owner was the ruler, transfer rulership to the new house
    const isOldOwnerRuler = getPolityLeaderHouse(state, polityId) === oldOwnerHouseId
    const targetHouseId = isOldOwnerRuler ? newHouseId : getPolityLeaderHouse(state, polityId)
    if (targetHouseId === undefined) return ctx
    const targetHouse = newState.houses[targetHouseId]
    const updatedPersons: Record<PersonId, Person> = { ...newState.persons }
    const targetMemberIds = targetHouse ? [...targetHouse.memberIds] : []

    for (const memberId of updatedOldHouse.memberIds) {
      const member = updatedPersons[memberId]
      if (member && member.alive) {
        updatedPersons[memberId] = {
          ...member,
          houseId: targetHouseId,
        }
        targetMemberIds.push(memberId)
      }
    }

    const updatedHouses: Record<HouseId, House> = { ...newState.houses }
    updatedHouses[oldOwnerHouseId] = { ...updatedOldHouse, active: false }
    if (targetHouse) {
      updatedHouses[targetHouseId] = { ...targetHouse, memberIds: targetMemberIds }
    }

    const updatedPolity = newState.polities[polityId]
    newState = {
      ...newState,
      persons: updatedPersons,
      houses: updatedHouses,
      polities: updatedPolity
        ? {
            ...newState.polities,
            [polityId]: {
              ...updatedPolity,
              houseIds: getPolityHouseIds(newState, polityId).filter(
                (hid) => (hid as string) !== (oldOwnerHouseId as string),
              ),
            },
          }
        : newState.polities,
    }

    // Emit HOUSE_EXTINCT event
    ctx = { ...ctx, state: newState }
    const { id: extinctEventId, ctx: ctxE } = makeEventId(ctx)
    const extinctEvent: SimEvent = {
      id: extinctEventId,
      year: ctxE.state.currentYear,
      month: ctxE.state.currentMonth,
      type: 'HOUSE_EXTINCT',
      importance: 'major',
      actorIds: [],
      houseIds: [oldOwnerHouseId],
      polityIds: [polityId],
      provinceIds: [provinceId],
      summary: `${oldOwnerHouse.name} has fallen from power after losing all lands.`,
      reasons: [],
      effects: [],
    }
    ctx = { ...ctxE, events: [...ctxE.events, extinctEvent] }
  } else {
    ctx = { ...ctx, state: newState }
  }

  // Rebel POP → new house: affection +8, respect +5
  const rebelPopForAttitude = (() => {
    for (const popId of province.popGroupIds) {
      const p = ctx.state.popGroups[popId]
      if (p && p.class === rebelClass) return p
    }
    return undefined
  })()
  if (rebelPopForAttitude) {
    const r = adjustPopAttitude(
      ctx.state,
      rebelPopForAttitude.id,
      { kind: 'house', id: newHouseId },
      { affection: 8, respect: 5 },
    )
    if (r.ok) ctx = { ...ctx, state: r.value }
  }

  // Emit LORDSHIP_USURPED event
  const { id: eventId, ctx: ctx3 } = makeEventId(ctx)
  const currentProvince = ctx3.state.provinces[provinceId]
  const event: SimEvent = {
    id: eventId,
    year: ctx3.state.currentYear,
    month: ctx3.state.currentMonth,
    type: 'LORDSHIP_USURPED',
    importance: 'major',
    actorIds: [newPersonId],
    houseIds: [newHouseId, oldOwnerHouseId],
    polityIds: [polityId],
    provinceIds: [provinceId],
    summary: `${newHouse.name} has seized lordship of ${currentProvince?.name ?? provinceId} from ${oldOwnerHouse.name}.`,
    reasons: [],
    effects: [],
  }
  return { ...ctx3, events: [...ctx3.events, event] }
}

function resolveRevoltIndependence(
  ctx: TickContext,
  provinceId: ProvinceId,
  rebelClass: PopClass,
  oldPolityId: PolityId,
): TickContext {
  const result = foundRevoltCountry(ctx, { provinceId, rebelClass, oldPolityId })
  if (!result.ok) return ctx
  return result.value.ctx
}

export function runProvinceRevoltSystem(ctx: TickContext): TickContext {
  const candidates = collectCandidates(ctx)

  for (const candidate of candidates) {
    ctx = resolveRevolt(ctx, candidate)
  }

  return ctx
}
