import type { TickContext } from './context'
import { makeEventId, makePersonId, makeHouseId, makeCountryId } from './context'
import { clamp, clamp100 } from '../utils/math'
import { randomFloat, randomInt } from '../rng/rng'
import type { ProvinceId, HouseId, CountryId, PersonId } from '../types/ids'
import type { PopClass } from '../types/popGroup'
import type { SimEvent } from '../types/event'
import type { Person } from '../types/person'
import type { House } from '../types/house'
import type { Country } from '../types/country'
import type { WorldState } from '../types/world'
import { getProvincePopulationPressure } from '../selectors/popSelectors'
import { getPopWealthByClass } from '../selectors/popSelectors'
import { getProvinceProduction } from '../selectors/popEconomySelectors'
import {
  getProvinceCountryManpowerBase,
  getProvinceHouseManpowerBase,
} from '../selectors/popEconomySelectors'
import {
  adjustProvincePopUnrestByClass,
  adjustProvincePopUnrest,
  adjustProvincePopWealthByClass,
} from '../mutations/popMutations'
import { transferProvinceToHouse } from '../mutations/transferProvince'
import {
  pickNameBySex,
  pickUniqueName,
  houseNamePool,
  houseName as houseNameFn,
} from '../worldgen/nameGenerators'
import { generateCountryName } from '../selectors/countryNamingService'

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

  const country = state.countries[province.countryId]
  if (!country) return 0

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
    (100 - province.countryControl) * config.provinceRevoltLowCountryControlFactor -
    country.stability * config.provinceRevoltStabilitySuppressionFactor

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
    tendency += (100 - ownerHouse.loyaltyToCountry) * config.nobleRevoltHouseDisloyaltyFactor
    tendency += (100 - country.legitimacy) * config.nobleRevoltLowLegitimacyFactor
  }

  return tendency
}

function collectCandidates(ctx: TickContext): RevoltCandidate[] {
  const candidates: RevoltCandidate[] = []
  const config = ctx.config

  for (const provinceId of Object.keys(ctx.state.provinces).sort()) {
    const province = ctx.state.provinces[provinceId as ProvinceId]
    if (!province) continue

    const country = ctx.state.countries[province.countryId]
    if (!country || !country.active) continue

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

  const country = ctx.state.countries[province.countryId]
  if (!country || !country.active) return ctx

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
    countryIds: [province.countryId],
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

  const countryPower =
    getProvinceCountryManpowerBase(ctx.state, config, provinceId) *
    config.provinceRevoltCountrySuppressionFactor

  let suppressionPower = ownerHousePower + countryPower
  suppressionPower += Math.log1p(country.treasury) * config.provinceRevoltTreasurySuppressionFactor
  suppressionPower +=
    Math.log1p(ownerHouse.wealth) * config.provinceRevoltHouseWealthSuppressionFactor

  // Success roll
  const successChance = popRevoltPower / (popRevoltPower + suppressionPower + 1)
  const { value: successRoll, rng: rng2 } = randomFloat(ctx.rng)
  ctx = { ...ctx, rng: rng2 }

  if (successRoll >= successChance) {
    // Revolt FAILED
    return resolveRevoltFailure(ctx, provinceId, rebelClass, province.countryId)
  }

  // Revolt SUCCEEDED — determine outcome
  const successMargin = successChance - successRoll

  const canBecomeIndependent =
    rebelClass === 'nobles' &&
    province.countryControl <= config.provinceRevoltIndependenceCountryControlMax &&
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
      province.countryId,
      province.ownerHouseId,
    )
  } else if (outcome === 'lordship_change') {
    return resolveRevoltLordshipChange(ctx, provinceId, rebelClass, province.countryId)
  } else {
    return resolveRevoltIndependence(ctx, provinceId, rebelClass, province.countryId)
  }
}

function resolveRevoltFailure(
  ctx: TickContext,
  provinceId: ProvinceId,
  rebelClass: PopClass,
  countryId: CountryId,
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

  // Country gains legitimacy
  const country = newState.countries[countryId]
  if (country) {
    newState = {
      ...newState,
      countries: {
        ...newState.countries,
        [countryId]: {
          ...country,
          legitimacy: clamp100(country.legitimacy + config.provinceRevoltSuppressionLegitimacyGain),
        },
      },
    }
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
    countryIds: [countryId],
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
  countryId: CountryId,
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
          countryControl: clamp(
            province.countryControl - config.provinceRevoltConcessionCountryControlLoss,
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

  // Country loses legitimacy
  const country = newState.countries[countryId]
  if (country) {
    newState = {
      ...newState,
      countries: {
        ...newState.countries,
        [countryId]: {
          ...country,
          legitimacy: clamp100(country.legitimacy - config.provinceRevoltConcessionLegitimacyLoss),
        },
      },
    }
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
    countryIds: [countryId],
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
  countryId: CountryId,
): TickContext {
  const config = ctx.config
  const state = ctx.state

  const province = state.provinces[provinceId]
  if (!province) return ctx

  const oldOwnerHouseId = province.ownerHouseId
  const oldOwnerHouse = state.houses[oldOwnerHouseId]
  if (!oldOwnerHouse) return ctx

  const country = state.countries[countryId]
  if (!country) return ctx

  // Pre-generate IDs for the new leader and house
  const { id: newPersonId, ctx: ctx1 } = makePersonId(ctx)
  const { id: newHouseId, ctx: ctx2 } = makeHouseId(ctx1)

  // Generate leader name
  const { name: leaderName, rng: rng1 } = pickNameBySex('male', ctx2.rng)
  ctx = { ...ctx2, rng: rng1 }

  // Generate leader stats by class
  let adminMin: number, adminMax: number, martialMin: number, martialMax: number
  if (rebelClass === 'peasants') {
    adminMin = 2
    adminMax = 6
    martialMin = 2
    martialMax = 6
  } else if (rebelClass === 'townsmen') {
    adminMin = 4
    adminMax = 8
    martialMin = 2
    martialMax = 5
  } else {
    adminMin = 3
    adminMax = 7
    martialMin = 4
    martialMax = 8
  }

  const { value: age, rng: rng2 } = randomInt(ctx.rng, 20, 45)
  ctx = { ...ctx, rng: rng2 }
  const { value: admin, rng: rng3 } = randomInt(ctx.rng, adminMin, adminMax)
  ctx = { ...ctx, rng: rng3 }
  const { value: martial, rng: rng4 } = randomInt(ctx.rng, martialMin, martialMax)
  ctx = { ...ctx, rng: rng4 }
  const { value: ambition, rng: rng5 } = randomInt(ctx.rng, 7, 10)
  ctx = { ...ctx, rng: rng5 }
  const { value: loyalty, rng: rng6 } = randomInt(ctx.rng, 0, 30)
  ctx = { ...ctx, rng: rng6 }
  const { value: caution, rng: rng7 } = randomInt(ctx.rng, 2, 7)
  ctx = { ...ctx, rng: rng7 }
  const { value: prestige, rng: rng8 } = randomInt(ctx.rng, 5, 20)
  ctx = { ...ctx, rng: rng8 }

  const newLeader: Person = {
    id: newPersonId,
    name: leaderName,
    sex: 'male',
    age,
    alive: true,
    houseId: newHouseId,
    countryId,
    childIds: [],
    birthStatus: 'unknown',
    stats: { admin, martial },
    traits: {
      ambition: ambition / 10,
      loyaltyToCountry: loyalty / 100,
      caution: caution / 10,
    },
    prestige,
  }

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
    countryId,
    provinceIds: [provinceId],
    memberIds: [newPersonId],
    headId: newPersonId,
    founderId: newPersonId,
    cadetHouseIds: [],
    prestige: config.revoltHouseInitialPrestige,
    cohesion: config.revoltHouseInitialCohesion,
    loyaltyToCountry: config.revoltHouseInitialLoyaltyToCountry,
    wealth: config.revoltHouseInitialWealth,
    seatProvinceId: provinceId,
  }

  // Add new entities to state
  let newState: typeof ctx.state = {
    ...ctx.state,
    persons: { ...ctx.state.persons, [newPersonId]: newLeader },
    houses: { ...ctx.state.houses, [newHouseId]: newHouse },
    countries: {
      ...ctx.state.countries,
      [countryId]: {
        ...country,
        houseIds: [...country.houseIds, newHouseId],
      },
    },
  }

  // Transfer province to new house
  newState = transferProvinceToHouse(newState, provinceId, newHouseId)

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
          countryControl: Math.max(
            updatedProvince.countryControl - config.provinceRevoltLordshipChangeCountryControlLoss,
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
    const isOldOwnerRuler = (oldOwnerHouseId as string) === (country.rulerHouseId as string)
    const targetHouseId = isOldOwnerRuler ? newHouseId : country.rulerHouseId
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

    const updatedCountry = newState.countries[countryId]
    newState = {
      ...newState,
      persons: updatedPersons,
      houses: updatedHouses,
      countries: updatedCountry
        ? {
            ...newState.countries,
            [countryId]: {
              ...updatedCountry,
              rulerHouseId: isOldOwnerRuler ? newHouseId : updatedCountry.rulerHouseId,
              houseIds: updatedCountry.houseIds.filter(
                (hid) => (hid as string) !== (oldOwnerHouseId as string),
              ),
            },
          }
        : newState.countries,
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
      countryIds: [countryId],
      provinceIds: [provinceId],
      summary: `${oldOwnerHouse.name} has fallen from power after losing all lands.`,
      reasons: [],
      effects: [],
    }
    ctx = { ...ctxE, events: [...ctxE.events, extinctEvent] }
  } else {
    ctx = { ...ctx, state: newState }
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
    countryIds: [countryId],
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
  oldCountryId: CountryId,
): TickContext {
  const config = ctx.config
  const state = ctx.state

  const province = state.provinces[provinceId]
  if (!province) return ctx

  const oldCountry = state.countries[oldCountryId]
  if (!oldCountry) return ctx

  const oldOwnerHouseId = province.ownerHouseId
  const oldOwnerHouse = state.houses[oldOwnerHouseId]

  // Pre-generate IDs
  const { id: newCountryId, ctx: ctx1 } = makeCountryId(ctx)
  const { id: newPersonId, ctx: ctx2 } = makePersonId(ctx1)
  const { id: newHouseId, ctx: ctx3 } = makeHouseId(ctx2)
  ctx = ctx3

  // Generate country name
  const { name: newCountryName, rng: rng0 } = generateCountryName(ctx.state, ctx.config, ctx.rng, {
    origin: 'province_revolt_independence',
    provinceIds: [provinceId],
    capitalProvinceId: provinceId,
    rulingHouseId: newHouseId,
    founderPersonId: newPersonId,
    sourceCountryId: oldCountryId,
    rebelClass,
  })
  ctx = { ...ctx, rng: rng0 }

  // Generate leader name
  const { name: leaderName, rng: rng1 } = pickNameBySex('male', ctx.rng)
  ctx = { ...ctx, rng: rng1 }

  // Generate leader stats by class
  let adminMin: number, adminMax: number, martialMin: number, martialMax: number
  if (rebelClass === 'peasants') {
    adminMin = 2
    adminMax = 6
    martialMin = 2
    martialMax = 6
  } else if (rebelClass === 'townsmen') {
    adminMin = 4
    adminMax = 8
    martialMin = 2
    martialMax = 5
  } else {
    adminMin = 3
    adminMax = 7
    martialMin = 4
    martialMax = 8
  }

  const { value: age, rng: rng2 } = randomInt(ctx.rng, 20, 45)
  ctx = { ...ctx, rng: rng2 }
  const { value: admin, rng: rng3 } = randomInt(ctx.rng, adminMin, adminMax)
  ctx = { ...ctx, rng: rng3 }
  const { value: martial, rng: rng4 } = randomInt(ctx.rng, martialMin, martialMax)
  ctx = { ...ctx, rng: rng4 }
  const { value: ambition, rng: rng5 } = randomInt(ctx.rng, 7, 10)
  ctx = { ...ctx, rng: rng5 }
  const { value: loyalty, rng: rng6 } = randomInt(ctx.rng, 0, 30)
  ctx = { ...ctx, rng: rng6 }
  const { value: caution, rng: rng7 } = randomInt(ctx.rng, 2, 7)
  ctx = { ...ctx, rng: rng7 }
  const { value: prestige, rng: rng8 } = randomInt(ctx.rng, 5, 20)
  ctx = { ...ctx, rng: rng8 }

  const newLeader: Person = {
    id: newPersonId,
    name: leaderName,
    sex: 'male',
    age,
    alive: true,
    houseId: newHouseId,
    countryId: newCountryId,
    childIds: [],
    birthStatus: 'unknown',
    stats: { admin, martial },
    traits: {
      ambition: ambition / 10,
      loyaltyToCountry: loyalty / 100,
      caution: caution / 10,
    },
    prestige,
  }

  // Generate house name
  const usedHouseNames = new Set(
    Object.values(ctx.state.houses)
      .filter((h): h is NonNullable<typeof h> => h !== undefined && h.active)
      .map((h) => h.name),
  )
  const { name: newHouseName, rng: rng9 } = pickUniqueName(
    houseNamePool(),
    usedHouseNames,
    houseNameFn,
    ctx.nextHouseIndex,
    ctx.rng,
  )
  ctx = { ...ctx, rng: rng9 }

  const newHouse: House = {
    id: newHouseId,
    name: newHouseName,
    active: true,
    countryId: newCountryId,
    provinceIds: [provinceId],
    memberIds: [newPersonId],
    headId: newPersonId,
    founderId: newPersonId,
    cadetHouseIds: [],
    prestige: config.revoltHouseInitialPrestige,
    cohesion: config.revoltHouseInitialCohesion,
    loyaltyToCountry: config.revoltHouseInitialLoyaltyToCountry,
    wealth: config.revoltHouseInitialWealth,
    seatProvinceId: provinceId,
  }

  const newCountry: Country = {
    id: newCountryId,
    name: newCountryName,
    rulerHouseId: newHouseId,
    houseIds: [newHouseId],
    treasury: config.revoltCountryInitialTreasury,
    legitimacy: config.revoltCountryInitialLegitimacy,
    adminPower: config.revoltCountryInitialAdminPower,
    stability: config.revoltCountryInitialStability,
    roleAssignments: {},
    active: true,
    capitalProvinceId: provinceId,
  }

  // Update province ownership manually (can't use transferProvinceToHouse here due to state ordering)
  const updatedProvince: typeof province = {
    ...province,
    ownerHouseId: newHouseId,
    countryId: newCountryId,
    countryControl: config.provinceRevoltNewCountryControl,
    houseControl: config.provinceRevoltNewHouseControl,
  }

  // Remove province from old owner house
  const updatedOldOwnerHouse = oldOwnerHouse
    ? {
        ...oldOwnerHouse,
        provinceIds: oldOwnerHouse.provinceIds.filter(
          (pid) => (pid as string) !== (provinceId as string),
        ),
        seatProvinceId:
          oldOwnerHouse.seatProvinceId === provinceId
            ? ((oldOwnerHouse.provinceIds.filter(
                (pid) => (pid as string) !== (provinceId as string),
              )[0] ?? '') as ProvinceId)
            : oldOwnerHouse.seatProvinceId,
      }
    : undefined

  // Remove old owner house from old country houseIds if it becomes landless
  const oldOwnerIsRuler = (oldOwnerHouseId as string) === (oldCountry.rulerHouseId as string)
  const remainingHouseIds = oldCountry.houseIds.filter(
    (hid) => (hid as string) !== (oldOwnerHouseId as string),
  )

  // Fix capitalProvinceId if the revolting province was the old country's capital
  const newOldCapProvinceId: ProvinceId =
    oldCountry.capitalProvinceId === provinceId
      ? ((Object.values(state.provinces).find(
          (p) => p !== undefined && p.countryId === oldCountryId && p.id !== provinceId,
        )?.id ?? '') as ProvinceId)
      : oldCountry.capitalProvinceId

  const updatedOldCountry =
    updatedOldOwnerHouse && updatedOldOwnerHouse.provinceIds.length === 0
      ? {
          ...oldCountry,
          houseIds: remainingHouseIds,
          // If ruler becomes landless, transfer to first remaining house; deactivate if none left
          rulerHouseId: oldOwnerIsRuler
            ? (remainingHouseIds[0] ?? oldCountry.rulerHouseId)
            : oldCountry.rulerHouseId,
          active: !oldOwnerIsRuler || remainingHouseIds.length > 0,
          legitimacy: clamp100(
            oldCountry.legitimacy - config.provinceRevoltConcessionLegitimacyLoss,
          ),
          capitalProvinceId: newOldCapProvinceId,
        }
      : {
          ...oldCountry,
          legitimacy: clamp100(
            oldCountry.legitimacy - config.provinceRevoltConcessionLegitimacyLoss,
          ),
          capitalProvinceId: newOldCapProvinceId,
        }

  // Apply all state changes
  let newState: WorldState = {
    ...ctx.state,
    provinces: { ...ctx.state.provinces, [provinceId]: updatedProvince },
    persons: { ...ctx.state.persons, [newPersonId]: newLeader },
    houses: {
      ...ctx.state.houses,
      [newHouseId]: newHouse,
      ...(updatedOldOwnerHouse ? { [oldOwnerHouseId]: updatedOldOwnerHouse } : {}),
    },
    countries: {
      ...ctx.state.countries,
      [newCountryId]: newCountry,
      [oldCountryId]: updatedOldCountry,
    },
  }

  // If old owner house became landless, deactivate and move members
  if (updatedOldOwnerHouse && updatedOldOwnerHouse.provinceIds.length === 0 && oldOwnerHouse) {
    const deactivatedOldHouse = { ...updatedOldOwnerHouse, active: false }
    const rulerHouse = newState.houses[updatedOldCountry.rulerHouseId]
    const updatedPersons: Record<PersonId, Person> = { ...newState.persons }
    const rulerMemberIds = rulerHouse ? [...rulerHouse.memberIds] : []

    for (const memberId of oldOwnerHouse.memberIds) {
      const member = updatedPersons[memberId]
      if (member && member.alive) {
        updatedPersons[memberId] = {
          ...member,
          houseId: updatedOldCountry.rulerHouseId,
          countryId: oldCountryId,
        }
        rulerMemberIds.push(memberId)
      }
    }

    const updatedHouses: Record<HouseId, House> = { ...newState.houses }
    updatedHouses[oldOwnerHouseId] = deactivatedOldHouse
    if (rulerHouse) {
      updatedHouses[updatedOldCountry.rulerHouseId] = { ...rulerHouse, memberIds: rulerMemberIds }
    }

    newState = {
      ...newState,
      persons: updatedPersons,
      houses: updatedHouses,
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
      countryIds: [oldCountryId],
      provinceIds: [provinceId],
      summary: `${oldOwnerHouse.name} has fallen after losing its last province.`,
      reasons: [],
      effects: [],
    }
    ctx = { ...ctxE, events: [...ctxE.events, extinctEvent] }
  } else {
    ctx = { ...ctx, state: newState }
  }

  // Emit REVOLT_COUNTRY_FOUNDED event
  const { id: eventId, ctx: ctx4 } = makeEventId(ctx)
  const event: SimEvent = {
    id: eventId,
    year: ctx4.state.currentYear,
    month: ctx4.state.currentMonth,
    type: 'REVOLT_COUNTRY_FOUNDED',
    importance: 'critical',
    actorIds: [newPersonId],
    houseIds: [newHouseId],
    countryIds: [newCountryId, oldCountryId],
    provinceIds: [provinceId],
    summary: `${newCountry.name} has been founded by ${newLeader.name} through revolt in ${province.name}!`,
    reasons: [],
    effects: [],
  }
  return { ...ctx4, events: [...ctx4.events, event] }
}

export function runProvinceRevoltSystem(ctx: TickContext): TickContext {
  const candidates = collectCandidates(ctx)

  for (const candidate of candidates) {
    ctx = resolveRevolt(ctx, candidate)
  }

  return ctx
}
