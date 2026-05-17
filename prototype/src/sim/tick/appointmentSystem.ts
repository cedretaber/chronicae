import type { TickContext } from './context'
import { makeEventId } from './context'
import { createOfficeAssignment, revokeOfficesByHolder } from '../mutations/officeMutations'
import {
  getActiveOfficeHolders,
  getCountryRuler,
  getHouseLeader,
} from '../selectors/officeSelectors'
import {
  getHouseCountrySharePercent,
  getPersonHouseSharePercent,
} from '../selectors/shareSelectors'
import { getPersonPrestige } from '../selectors/statusSelectors'
import { getAttitudeOrDefault, attitudeValueToScore } from '../helpers/attitudeHelpers'
import { OFFICE_DEFINITIONS } from '../config/officeDefinitions'
import type { PersonId, CountryId, HouseId } from '../types/ids'
import type { OfficeRole, OrganizationRef } from '../types/office'
import type { SimEvent } from '../types/event'
import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'

const COUNTRY_APPOINTABLE_ROLES: OfficeRole[] = [
  'administrator',
  'treasurer',
  'military',
  'advisor',
]
const HOUSE_APPOINTABLE_ROLES: OfficeRole[] = ['administrator', 'treasurer', 'military', 'advisor']

function getRelevantStat(state: WorldState, personId: PersonId, role: OfficeRole): number {
  const person = state.persons[personId]
  if (!person) return 0
  switch (role) {
    case 'military':
      return person.stats.martial
    default:
      return person.stats.admin
  }
}

function computeCountryScore(
  state: WorldState,
  config: SimulationConfig,
  countryId: CountryId,
  rulerId: PersonId,
  personId: PersonId,
  role: OfficeRole,
): number {
  const person = state.persons[personId]
  if (!person) return -Infinity
  const ruler = state.persons[rulerId]

  const prestige = getPersonPrestige(state, personId)
  const rulerRespect = ruler
    ? attitudeValueToScore(
        getAttitudeOrDefault(state, ruler, { kind: 'country', id: countryId }).respect,
      ) / 100
    : 0
  const countryAtt = getAttitudeOrDefault(state, person, { kind: 'country', id: countryId })
  const countryAffection = attitudeValueToScore(countryAtt.affection) / 100
  const houseSharePct = getHouseCountrySharePercent(state, countryId, person.houseId)
  const personSharePct = getPersonHouseSharePercent(state, person.houseId, personId)

  const currentOfficeCount = (state.officeIndex.byHolderPerson[personId as string] ?? []).length

  return (
    getRelevantStat(state, personId, role) * 1.0 +
    (prestige / 100) * 10 +
    rulerRespect * 5 +
    countryAffection * 3 +
    houseSharePct * 0.1 +
    personSharePct * 0.05 -
    config.concurrentOfficePenalty * currentOfficeCount
  )
}

function computeHouseScore(
  state: WorldState,
  config: SimulationConfig,
  houseId: HouseId,
  leaderId: PersonId,
  personId: PersonId,
  role: OfficeRole,
): number {
  const person = state.persons[personId]
  if (!person) return -Infinity
  const leader = state.persons[leaderId]

  const prestige = getPersonPrestige(state, personId)
  const leaderRespect = leader
    ? attitudeValueToScore(
        getAttitudeOrDefault(state, leader, { kind: 'house', id: houseId }).respect,
      ) / 100
    : 0
  const houseAtt = getAttitudeOrDefault(state, person, { kind: 'house', id: houseId })
  const houseAffection = attitudeValueToScore(houseAtt.affection) / 100
  const personSharePct = getPersonHouseSharePercent(state, houseId, personId)

  const currentOfficeCount = (state.officeIndex.byHolderPerson[personId as string] ?? []).length

  return (
    getRelevantStat(state, personId, role) * 1.0 +
    (prestige / 100) * 10 +
    leaderRespect * 5 +
    houseAffection * 3 +
    personSharePct * 0.1 -
    config.concurrentOfficePenalty * currentOfficeCount
  )
}

export function runAppointmentSystem(ctx: TickContext): TickContext {
  if (ctx.state.currentMonth !== 1) return ctx

  let currentCtx = ctx

  // Country offices
  for (const countryId of Object.keys(currentCtx.state.countries).sort()) {
    const country = currentCtx.state.countries[countryId as CountryId]
    if (!country || !country.active) continue

    const rulerId = getCountryRuler(currentCtx.state, countryId as CountryId)
    if (!rulerId) continue

    const countryRef: OrganizationRef = { kind: 'country', id: countryId as CountryId }

    for (const role of COUNTRY_APPOINTABLE_ROLES) {
      const def = OFFICE_DEFINITIONS[`country:${role}`]
      if (!def) continue

      // Get current active holders, revoke dead ones
      const currentHolders = getActiveOfficeHolders(currentCtx.state, countryRef, role)
      for (const holderId of currentHolders) {
        const holder = currentCtx.state.persons[holderId]
        if (!holder || !holder.alive) {
          currentCtx = {
            ...currentCtx,
            state: revokeOfficesByHolder(currentCtx.state, holderId),
          }
        }
      }

      // Re-check after revocations
      const activeHolders = getActiveOfficeHolders(currentCtx.state, countryRef, role)
      if (activeHolders.length >= def.maxHolders) continue

      // Find candidates: alive adults in this country, not already holding this role
      const alreadyHolding = new Set(activeHolders.map((id) => id as string))
      const candidates: PersonId[] = []
      for (const personId of Object.keys(currentCtx.state.persons).sort()) {
        const person = currentCtx.state.persons[personId as PersonId]
        if (!person || !person.alive) continue
        if (person.countryId !== countryId) continue
        if (person.age < currentCtx.config.adultAge) continue
        if (alreadyHolding.has(personId)) continue
        const house = currentCtx.state.houses[person.houseId]
        if (!house || !house.active) continue
        candidates.push(personId as PersonId)
      }

      if (candidates.length === 0) continue

      const scored = candidates
        .map((id) => ({
          id,
          score: computeCountryScore(
            currentCtx.state,
            currentCtx.config,
            countryId as CountryId,
            rulerId,
            id,
            role,
          ),
        }))
        .sort((a, b) => b.score - a.score)

      const best = scored[0]
      if (!best || best.score < currentCtx.config.minAppointmentScore) continue

      const newState = createOfficeAssignment(currentCtx.state, countryRef, role, best.id)
      currentCtx = { ...currentCtx, state: newState }

      const person = currentCtx.state.persons[best.id]
      if (person) {
        const house = currentCtx.state.houses[person.houseId]
        if (house) {
          const { id: eventId, ctx: eventCtx } = makeEventId(currentCtx)
          const event: SimEvent = {
            id: eventId,
            year: currentCtx.state.currentYear,
            month: currentCtx.state.currentMonth,
            type: 'OFFICE_ASSIGNED',
            importance: 'normal',
            actorIds: [best.id],
            houseIds: [person.houseId],
            countryIds: [countryId as CountryId],
            provinceIds: [],
            summary: `${person.name} was appointed as ${def.displayName} of ${country.name}.`,
            reasons: [],
            effects: [],
          }
          currentCtx = { ...eventCtx, state: currentCtx.state, events: [...eventCtx.events, event] }
        }
      }
    }
  }

  // House offices
  for (const houseId of Object.keys(currentCtx.state.houses).sort()) {
    const house = currentCtx.state.houses[houseId as HouseId]
    if (!house || !house.active) continue

    const leaderId = getHouseLeader(currentCtx.state, houseId as HouseId)
    if (!leaderId) continue

    const houseRef: OrganizationRef = { kind: 'house', id: houseId as HouseId }

    for (const role of HOUSE_APPOINTABLE_ROLES) {
      const def = OFFICE_DEFINITIONS[`house:${role}`]
      if (!def) continue

      const currentHolders = getActiveOfficeHolders(currentCtx.state, houseRef, role)
      for (const holderId of currentHolders) {
        const holder = currentCtx.state.persons[holderId]
        if (!holder || !holder.alive) {
          currentCtx = {
            ...currentCtx,
            state: revokeOfficesByHolder(currentCtx.state, holderId),
          }
        }
      }

      const activeHolders = getActiveOfficeHolders(currentCtx.state, houseRef, role)
      if (activeHolders.length >= def.maxHolders) continue

      const alreadyHolding = new Set(activeHolders.map((id) => id as string))
      const candidates: PersonId[] = []
      const currentHouse = currentCtx.state.houses[houseId as HouseId]
      if (!currentHouse) continue
      for (const memberId of currentHouse.memberIds) {
        const member = currentCtx.state.persons[memberId]
        if (!member || !member.alive) continue
        if (member.age < currentCtx.config.adultAge) continue
        if (alreadyHolding.has(memberId)) continue
        candidates.push(memberId)
      }

      if (candidates.length === 0) continue

      const scored = candidates
        .map((id) => ({
          id,
          score: computeHouseScore(
            currentCtx.state,
            currentCtx.config,
            houseId as HouseId,
            leaderId,
            id,
            role,
          ),
        }))
        .sort((a, b) => b.score - a.score)

      const best = scored[0]
      if (!best || best.score < currentCtx.config.minAppointmentScore) continue

      const newState = createOfficeAssignment(currentCtx.state, houseRef, role, best.id)
      currentCtx = { ...currentCtx, state: newState }

      const person = currentCtx.state.persons[best.id]
      if (person) {
        const { id: eventId, ctx: eventCtx } = makeEventId(currentCtx)
        const event: SimEvent = {
          id: eventId,
          year: currentCtx.state.currentYear,
          month: currentCtx.state.currentMonth,
          type: 'OFFICE_ASSIGNED',
          importance: 'normal',
          actorIds: [best.id],
          houseIds: [houseId as HouseId],
          countryIds: [house.countryId],
          provinceIds: [],
          summary: `${person.name} was appointed as ${def.displayName} of ${house.name}.`,
          reasons: [],
          effects: [],
        }
        currentCtx = { ...eventCtx, state: currentCtx.state, events: [...eventCtx.events, event] }
      }
    }
  }

  return currentCtx
}
