import type { TickContext } from './context'
import { createSimEvent } from './context'
import type { PersonId } from '../types/ids'
import type { WorldState } from '../types/world'
import type { EventImportance } from '../types/event'
import { nameParam, entityRef } from '../types/event'
import { addPersonWealth, clearPersonWealth } from '../mutations/personMutations'
import { addHouseWealth } from '../mutations/houseMutations'
import { getPersonHouseSharePercent } from '../selectors/shareSelectors'
import { getHouseLeader } from '../selectors/officeSelectors'
import { clamp } from '../utils/math'
import { ESTATE_DISPUTE_HEIR_THRESHOLD } from '../constants/abilityConstants'

export function findHeirs(state: WorldState, deceased: PersonId): PersonId[] {
  const person = state.persons[deceased]
  if (!person) return []

  const candidates: PersonId[] = []

  // 1. Legitimate children (alive)
  for (const childId of person.childIds) {
    const child = state.persons[childId]
    if (child && child.alive && child.birthStatus === 'legitimate') {
      candidates.push(childId)
    }
  }
  if (candidates.length > 0) return sortHeirs(state, candidates)

  // 2. Spouse (alive)
  if (person.spouseId) {
    const spouse = state.persons[person.spouseId]
    if (spouse && spouse.alive) return [person.spouseId]
  }

  // 3. Siblings (alive, same houseId, same parents)
  if (!person.houseId) return []
  const house = state.houses[person.houseId]
  if (house) {
    const siblings: PersonId[] = []
    for (const memberId of house.memberIds) {
      if (memberId === deceased) continue
      const member = state.persons[memberId]
      if (!member || !member.alive) continue
      const sameParents = person.fatherId && member.fatherId && person.fatherId === member.fatherId
      if (sameParents) siblings.push(memberId)
    }
    if (siblings.length > 0) return sortHeirs(state, siblings)
  }

  // 4. House leader (alive)
  const leaderId = getHouseLeader(state, person.houseId)
  if (leaderId && leaderId !== deceased) {
    const leader = state.persons[leaderId]
    if (leader && leader.alive) return [leaderId]
  }

  return []
}

function sortHeirs(state: WorldState, ids: PersonId[]): PersonId[] {
  return [...ids].sort((a, b) => {
    const pa = state.persons[a]
    const pb = state.persons[b]
    const ageA = pa?.age ?? 0
    const ageB = pb?.age ?? 0
    if (ageB !== ageA) return ageB - ageA // age 降順
    return (a as string) < (b as string) ? -1 : 1 // id 昇順 tiebreak
  })
}

export function runEstateSettlementSystem(ctx: TickContext): TickContext {
  if (ctx.deathsThisTick.length === 0) return ctx

  let currentCtx = ctx

  for (const deceasedId of ctx.deathsThisTick) {
    const person = currentCtx.state.persons[deceasedId]
    if (!person || person.wealth <= 0) continue

    const wealth = person.wealth
    const house = person.houseId ? currentCtx.state.houses[person.houseId] : undefined

    // house なし → houseRecoveryRate = 0、全額相続人へ（§5.4）
    const share =
      house && person.houseId
        ? getPersonHouseSharePercent(currentCtx.state, person.houseId, deceasedId) / 100
        : 0
    const houseRecoveryRate = house
      ? clamp(
          currentCtx.config.estateBaseRecoveryRate -
            currentCtx.config.estateShareEffectStrength * share,
          currentCtx.config.estateRecoveryRateMin,
          currentCtx.config.estateRecoveryRateMax,
        )
      : 0

    const houseAmount = Math.floor(wealth * houseRecoveryRate)
    const remainingWealth = wealth - houseAmount

    const heirs = findHeirs(currentCtx.state, deceasedId)

    // Clear deceased wealth
    const clearResult = clearPersonWealth(currentCtx.state, deceasedId)
    if (!clearResult.ok) continue
    let newState = clearResult.value

    // Give house its share (only if house exists)
    if (houseAmount > 0 && house && person.houseId) {
      const houseResult = addHouseWealth(newState, person.houseId, houseAmount)
      if (houseResult.ok) newState = houseResult.value
    }

    // Distribute remaining to heirs
    let leftover = remainingWealth
    if (heirs.length > 0 && remainingWealth > 0) {
      const perHeirBase = Math.floor(remainingWealth / heirs.length)
      const remainder = remainingWealth - perHeirBase * heirs.length

      for (let i = 0; i < heirs.length; i++) {
        const heirId = heirs[i] as PersonId
        const amount = i === 0 ? perHeirBase + remainder : perHeirBase
        if (amount > 0) {
          const heirResult = addPersonWealth(newState, heirId, amount)
          if (heirResult.ok) newState = heirResult.value
          leftover -= amount
        }
      }
    }

    // Any leftover stays in house (only if house exists; otherwise vanishes per §5.5)
    if (leftover > 0 && house && person.houseId) {
      const houseResult = addHouseWealth(newState, person.houseId, leftover)
      if (houseResult.ok) newState = houseResult.value
    }

    const normalWealthThreshold =
      currentCtx.config.estateSettledNormalWealthRatio * (house?.wealth ?? 0)
    const roleInfo = currentCtx.deathRolesThisTick[deceasedId]
    let importance: EventImportance = 'minor'
    if (roleInfo?.wasPolityLeader) {
      importance = 'major'
    } else if (roleInfo?.wasHouseLeader || wealth >= normalWealthThreshold) {
      importance = 'normal'
    }

    // ESTATE_SETTLED は常に発火 (§5.7)
    const { event: settledEvent, ctx: ctxAfterSettled } = createSimEvent(
      {
        ...currentCtx,
        state: newState,
      },
      {
        type: 'ESTATE_SETTLED',
        importance,
        messageKey: 'estate.settled',
        messageParams: {
          person: nameParam('person', person.nameKey),
          wealth,
          houseAmount,
          heirAmount: remainingWealth - leftover,
        },
        entityRefs: [
          entityRef('person', deceasedId, 'deceased', person.nameKey),
          ...heirs.map((h) => entityRef('person', h, 'heir')),
        ],
      },
    )
    currentCtx = {
      ...ctxAfterSettled,
      state: newState,
      events: [...ctxAfterSettled.events, settledEvent],
    }

    // 争いがあれば ESTATE_DISPUTED を ESTATE_SETTLED と並んで追加発火 (§5.7)
    if (heirs.length >= ESTATE_DISPUTE_HEIR_THRESHOLD) {
      const { event: disputedEvent, ctx: ctxAfterDisputed } = createSimEvent(currentCtx, {
        type: 'ESTATE_DISPUTED',
        importance: 'minor',
        messageKey: 'estate.disputed',
        messageParams: {
          count: heirs.length,
          person: nameParam('person', person.nameKey),
        },
        entityRefs: [
          entityRef('person', deceasedId, 'deceased', person.nameKey),
          ...heirs.map((h) => entityRef('person', h, 'heir')),
        ],
        reasons: [{ label: 'Multiple heirs', value: heirs.length }],
      })
      currentCtx = {
        ...ctxAfterDisputed,
        events: [...ctxAfterDisputed.events, disputedEvent],
      }
    }
  }

  return currentCtx
}
