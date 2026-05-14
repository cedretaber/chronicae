import type { TickContext } from './context'
import { makeEventId } from './context'
import { revokeRole } from '../mutations/assignRole'
import { assignRole } from '../mutations/assignRole'
import { getPersonRole } from '../selectors/roleSelectors'
import type { PersonId, CountryId } from '../types/ids'
import type { RoleType } from '../types/role'
import type { SimEvent } from '../types/event'
import type { WorldState } from '../types/world'

const ALL_ROLES: readonly RoleType[] = ['chancellor', 'general', 'treasurer']

function computeScore(
  person: NonNullable<WorldState['persons']>[PersonId],
  role: RoleType,
): number {
  switch (role) {
    case 'chancellor':
      return (
        person.stats.admin * 8 +
        person.traits.loyaltyToCountry * 20 +
        person.prestige * 0.3 -
        person.traits.ambition * 10
      )
    case 'general':
      return person.stats.martial * 8 + person.prestige * 0.3 + person.traits.ambition * 5
    case 'treasurer':
      return (
        person.stats.admin * 7 +
        person.traits.loyaltyToCountry * 25 +
        person.traits.caution * 10 -
        person.traits.ambition * 15
      )
  }
}

export function runAppointmentSystem(ctx: TickContext): TickContext {
  let currentCtx = ctx

  const countryIds = Object.keys(currentCtx.state.countries).sort()

  for (const countryId of countryIds) {
    const country = currentCtx.state.countries[countryId as CountryId]
    if (!country) continue

    for (const role of ALL_ROLES) {
      // Always read fresh country state from currentCtx
      const currentCountry = currentCtx.state.countries[countryId as CountryId]
      if (!currentCountry) continue

      const currentHolderId = currentCountry.roleAssignments[role]

      // Step 3a: If current role holder exists but is dead, revoke
      if (currentHolderId !== undefined) {
        const holder = currentCtx.state.persons[currentHolderId]
        if (!holder || !holder.alive) {
          const newState = revokeRole(currentCtx.state, countryId as CountryId, role)
          currentCtx = { ...currentCtx, state: newState }
        }
      }

      // Re-read country after potential revoke
      const updatedCountry = currentCtx.state.countries[countryId as CountryId]
      if (!updatedCountry) continue

      const currentRoleHolderId = updatedCountry.roleAssignments[role]

      // Step 3b: Find candidates
      const candidateIds: string[] = []
      for (const personId of Object.keys(currentCtx.state.persons).sort()) {
        const person = currentCtx.state.persons[personId as PersonId]
        if (!person) continue
        if (person.countryId !== updatedCountry.id) continue
        if (!person.alive) continue
        const house = currentCtx.state.houses[person.houseId]
        if (!house || !house.active) continue
        const existingRole = getPersonRole(currentCtx.state, person.id)
        if (existingRole !== null) continue
        candidateIds.push(personId)
      }

      // Compute scores for candidates
      let bestCandidateId: PersonId | null = null
      let bestCandidateScore = -Infinity

      for (const candidateId of candidateIds) {
        const candidate = currentCtx.state.persons[candidateId as PersonId]
        if (!candidate) continue
        const score = computeScore(candidate, role)
        if (score > bestCandidateScore) {
          bestCandidateScore = score
          bestCandidateId = candidate.id
        }
      }

      // Step 3c: If role is vacant, assign best candidate
      if (currentRoleHolderId === undefined) {
        if (bestCandidateId !== null) {
          const candidate = currentCtx.state.persons[bestCandidateId]
          if (candidate) {
            const newState = assignRole(
              currentCtx.state,
              countryId as CountryId,
              role,
              bestCandidateId,
            )
            currentCtx = { ...currentCtx, state: newState }
            const house = currentCtx.state.houses[candidate.houseId]
            if (house) {
              const { id: eventId, ctx: eventCtx } = makeEventId(currentCtx)
              const event: SimEvent = {
                id: eventId,
                year: currentCtx.state.currentYear,
                month: currentCtx.state.currentMonth,
                type: 'ROLE_ASSIGNED',
                importance: 'normal',
                actorIds: [bestCandidateId],
                houseIds: [candidate.houseId],
                countryIds: [countryId as CountryId],
                provinceIds: [],
                summary: `${candidate.name} was appointed as ${role} of ${updatedCountry.name}.`,
                reasons: [],
                effects: [],
              }
              currentCtx = {
                ...eventCtx,
                state: currentCtx.state,
                events: [...eventCtx.events, event],
              }
            }
          }
        }
      } else {
        // Step 3d: If role is occupied AND it's January, check replacement threshold
        if (currentCtx.state.currentMonth === 1) {
          const currentHolder = currentCtx.state.persons[currentRoleHolderId]
          if (currentHolder) {
            const currentHolderScore = computeScore(currentHolder, role)
            if (
              bestCandidateId !== null &&
              bestCandidateScore - currentHolderScore >= currentCtx.config.replacementThreshold
            ) {
              const bestCandidate = currentCtx.state.persons[bestCandidateId]
              if (bestCandidate) {
                const newState1 = revokeRole(currentCtx.state, countryId as CountryId, role)
                currentCtx = { ...currentCtx, state: newState1 }
                const revokedPerson = currentCtx.state.persons[currentRoleHolderId]
                if (revokedPerson) {
                  const revokedHouse = currentCtx.state.houses[revokedPerson.houseId]
                  if (revokedHouse) {
                    const { id: revokedEventId, ctx: revokedEventCtx } = makeEventId(currentCtx)
                    const revokedEvent: SimEvent = {
                      id: revokedEventId,
                      year: currentCtx.state.currentYear,
                      month: currentCtx.state.currentMonth,
                      type: 'ROLE_REVOKED',
                      importance: 'normal',
                      actorIds: [currentRoleHolderId],
                      houseIds: [revokedPerson.houseId],
                      countryIds: [countryId as CountryId],
                      provinceIds: [],
                      summary: `${revokedPerson.name} was removed from the role of ${role}.`,
                      reasons: [],
                      effects: [],
                    }
                    currentCtx = {
                      ...revokedEventCtx,
                      state: currentCtx.state,
                      events: [...revokedEventCtx.events, revokedEvent],
                    }
                  }
                }
                const newState2 = assignRole(
                  currentCtx.state,
                  countryId as CountryId,
                  role,
                  bestCandidateId,
                )
                currentCtx = { ...currentCtx, state: newState2 }
                const newCandidate = currentCtx.state.persons[bestCandidateId]
                if (newCandidate) {
                  const newHouse = currentCtx.state.houses[newCandidate.houseId]
                  if (newHouse) {
                    const { id: assignedEventId, ctx: assignedEventCtx } = makeEventId(currentCtx)
                    const assignedEvent: SimEvent = {
                      id: assignedEventId,
                      year: currentCtx.state.currentYear,
                      month: currentCtx.state.currentMonth,
                      type: 'ROLE_ASSIGNED',
                      importance: 'normal',
                      actorIds: [bestCandidateId],
                      houseIds: [newCandidate.houseId],
                      countryIds: [countryId as CountryId],
                      provinceIds: [],
                      summary: `${newCandidate.name} was appointed as ${role} of ${updatedCountry.name}.`,
                      reasons: [],
                      effects: [],
                    }
                    currentCtx = {
                      ...assignedEventCtx,
                      state: currentCtx.state,
                      events: [...assignedEventCtx.events, assignedEvent],
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  return currentCtx
}
