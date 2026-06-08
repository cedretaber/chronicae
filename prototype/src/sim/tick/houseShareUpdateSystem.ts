import type { TickContext } from './context'
import type { PersonId, HouseId } from '@sim/types/ids'
import type { WorldState } from '@sim/types/world'
import type { SimulationConfig } from '@sim/config/defaultConfig'
import type { OrganizationRef } from '@sim/types/office'
import {
  removeHouseShare,
  transferShareRawPower,
  upsertHouseShare,
  createHouseShare,
} from '@sim/mutations/shareMutations'
import { getHouseShares } from '@sim/selectors/shareSelectors'
import { getHouseLeader } from '@sim/selectors/officeSelectors'
import { getOfficeAssignments } from '@sim/selectors/officeSelectors'
import { getRoleScore } from '@sim/selectors/abilitySelectors'
import { getHousePrimaryPolityId } from '@sim/selectors/polityRelations'
import { getPersonOrganizationReputationSum } from '@sim/selectors/personReputationSelectors'

export function runHouseShareUpdateSystem(ctx: TickContext): TickContext {
  let state = ctx.state
  const config = ctx.config

  // v0.42c: Polity share 枝は削除 (Polity Influence は influenceSelectors の read-model)。
  // 2. Update House Shares for each House
  for (const houseId of Object.keys(state.houses).sort() as HouseId[]) {
    const house = state.houses[houseId]
    if (!house || !house.active) continue
    if (house.kind === 'system') continue

    const existingShares = getHouseShares(state, houseId)

    const leaderId = getHouseLeader(state, houseId)

    // Handle dead persons: transfer 50% of their share to the leader, delete the rest
    for (const share of existingShares) {
      const person = state.persons[share.holderPersonId]
      if (!person || person.alive) continue

      // Person is dead
      if (leaderId && leaderId !== share.holderPersonId) {
        state = transferShareRawPower(state, share.holderPersonId, leaderId, houseId, 0.5)
      }
      // Delete remaining share for dead person
      const updatedShare = state.houseShares[share.id]
      if (updatedShare) {
        state = removeHouseShare(state, share.id)
      }
    }

    // Update living persons
    for (const personId of house.memberIds) {
      const person = state.persons[personId]
      if (!person || !person.alive) continue

      const isLeader = personId === leaderId
      const newRawPower = computeHouseShareRawPower(state, config, houseId, personId, isLeader)

      const upsertResult = upsertHouseShare(state, {
        houseId,
        holderPersonId: personId,
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

  // 影響力個人中心化 Phase 1a: house-tag 評判の成果項。功績 (house owned project 完遂 / 戦功で
  // 自家が陣営の戦争) で家内 Share を上げる。getPersonOrganizationReputationSum が 0 床済み
  // (rawPower >= 0 invariant を破らない — integrityCoreChecks:38 / R17)。
  const reputationTerm =
    getPersonOrganizationReputationSum(state, config, person.id, { kind: 'house', id: houseId }) *
    config.houseShareReputationFactor

  return (
    config.houseShareBase +
    (isLeader ? config.houseShareLeaderBonus : 0) +
    (hasOffice ? config.houseShareOfficeBonus : 0) +
    person.legacyPrestige * config.houseSharePrestigeFactor +
    person.wealth * config.houseShareWealthFactor +
    (getRoleScore(state, person.id, 'governance') / 10 +
      getRoleScore(state, person.id, 'warCommand') / 10) *
      config.houseShareStatFactor +
    reputationTerm
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
    current = createHouseShare(current, houseId, personId, rawPower)
  }
  return current
}
