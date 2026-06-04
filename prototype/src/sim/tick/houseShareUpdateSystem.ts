import type { TickContext } from './context'
import type { PersonId, HouseId } from '@sim/types/ids'
import type { WorldState } from '@sim/types/world'
import type { SimulationConfig } from '@sim/config/defaultConfig'
import type { OrganizationRef } from '@sim/types/office'
import {
  removeOrganizationShare,
  transferShareRawPower,
  upsertOrganizationShare,
  createOrganizationShare,
} from '@sim/mutations/shareMutations'
import { getOrganizationShares } from '@sim/selectors/shareSelectors'
import { getHouseLeader } from '@sim/selectors/officeSelectors'
import { getOfficeAssignments } from '@sim/selectors/officeSelectors'
import { getRoleScore } from '@sim/selectors/abilitySelectors'
import { getHousePrimaryPolityId } from '@sim/selectors/polityRelations'

export function runHouseShareUpdateSystem(ctx: TickContext): TickContext {
  let state = ctx.state
  const config = ctx.config

  // v0.42c: Polity share 枝は削除 (Polity Influence は influenceSelectors の read-model)。
  // 2. Update House Shares for each House
  for (const houseId of Object.keys(state.houses).sort() as HouseId[]) {
    const house = state.houses[houseId]
    if (!house || !house.active) continue
    if (house.kind === 'system') continue

    const houseRef: OrganizationRef = { kind: 'house', id: houseId }
    const existingShares = getOrganizationShares(state, houseRef)

    const leaderId = getHouseLeader(state, houseId)

    // Handle dead persons: transfer 50% of their share to the leader, delete the rest
    for (const share of existingShares) {
      if (share.holder.kind !== 'person') continue
      const person = state.persons[share.holder.id]
      if (!person || person.alive) continue

      // Person is dead
      if (leaderId && leaderId !== share.holder.id) {
        state = transferShareRawPower(
          state,
          { kind: 'person', id: share.holder.id },
          { kind: 'person', id: leaderId },
          houseRef,
          0.5,
        )
      }
      // Delete remaining share for dead person
      const updatedShare = state.organizationShares[share.id]
      if (updatedShare) {
        state = removeOrganizationShare(state, share.id)
      }
    }

    // Update living persons
    for (const personId of house.memberIds) {
      const person = state.persons[personId]
      if (!person || !person.alive) continue

      const isLeader = personId === leaderId
      const newRawPower = computeHouseShareRawPower(state, config, houseId, personId, isLeader)

      const upsertResult = upsertOrganizationShare(state, {
        organization: houseRef,
        holder: { kind: 'person', id: personId },
        rawPower: newRawPower,
      })
      if (upsertResult.ok) state = upsertResult.value
    }
  }

  return { ...ctx, state }
}

export function computeHouseShareRawPower(
  state: WorldState,
  config: SimulationConfig,
  houseId: HouseId,
  personId: PersonId,
  isLeader: boolean,
): number {
  const person = state.persons[personId]
  if (!person) return 0

  const houseRef: OrganizationRef = { kind: 'house', id: houseId }
  const houseOfficeAssignments = getOfficeAssignments(state, houseRef)
  const hasOffice =
    houseOfficeAssignments.some((o) => o.active && o.holderPersonId === personId) ||
    (() => {
      const housePrimaryPolityId = getHousePrimaryPolityId(state, houseId)
      if (!housePrimaryPolityId) return false
      return getOfficeAssignments(state, { kind: 'polity', id: housePrimaryPolityId }).some(
        (o) => o.active && o.holderPersonId === personId,
      )
    })()

  return (
    config.houseShareBase +
    (isLeader ? config.houseShareLeaderBonus : 0) +
    (hasOffice ? config.houseShareOfficeBonus : 0) +
    person.legacyPrestige * config.houseSharePrestigeFactor +
    person.wealth * config.houseShareWealthFactor +
    (getRoleScore(state, person.id, 'governance') / 10 +
      getRoleScore(state, person.id, 'warCommand') / 10) *
      config.houseShareStatFactor
  )
}

export function initializeHouseShares(
  state: WorldState,
  config: SimulationConfig,
  houseId: HouseId,
): WorldState {
  const house = state.houses[houseId]
  if (!house) return state

  const leaderId = getHouseLeader(state, houseId)
  let current = state
  for (const personId of house.memberIds) {
    const person = current.persons[personId]
    if (!person || !person.alive) continue
    const isLeader = personId === leaderId
    const rawPower = computeHouseShareRawPower(current, config, houseId, personId, isLeader)
    current = createOrganizationShare(
      current,
      { kind: 'house', id: houseId },
      { kind: 'person', id: personId },
      rawPower,
    )
  }
  return current
}
