import type { TickContext } from './context'
import type { PolityId, HouseId } from '@sim/types/ids'
import type { OrganizationRef } from '@sim/types/office'
import {
  removeOrganizationShare,
  transferShareRawPower,
  upsertOrganizationShare,
} from '@sim/mutations/shareMutations'
import { getOrganizationShares } from '@sim/selectors/shareSelectors'
import { getHouseLeader } from '@sim/selectors/officeSelectors'
import { getOfficeAssignments } from '@sim/selectors/officeSelectors'
import { getRoleScore } from '@sim/selectors/abilitySelectors'
import {
  getHousePrimaryPolityId,
  getHouseProvinceIdsByPolity,
  getPolityHouseIds,
} from '@sim/selectors/polityRelations'

export function runShareUpdateSystem(ctx: TickContext): TickContext {
  if (ctx.state.currentMonth !== 1) return ctx

  let state = ctx.state
  const config = ctx.config

  // 1. Update Polity Shares for each Polity
  for (const polityId of Object.keys(state.polities).sort() as PolityId[]) {
    const polity = state.polities[polityId]
    if (!polity || !polity.active) continue

    const polityRef: OrganizationRef = { kind: 'polity', id: polityId }

    // v0.15 §12.3: 計算は対象 Polity 内の local power に限定する。
    // §12.2: 削除責任は OrganizationConsistencySystem に一本化されるためここでは扱わない。
    for (const houseId of getPolityHouseIds(state, polityId)) {
      const house = state.houses[houseId]
      if (!house || !house.active) continue

      const isOwnerHouse = polity.ownerHouseId === houseId

      // Polity Office count held by persons of this house
      const polityOfficeCount = getOfficeAssignments(state, polityRef)
        .filter((o) => o.active && o.role !== 'leader')
        .filter((o) => {
          const p = state.persons[o.holderPersonId]
          return p && p.houseId === houseId
        }).length

      // ownedProvinceCountInPolity と localMilitaryProxy を Polity 内に限定する。
      // 別 Polity の所領で当該 Polity の Share が膨らむのを防ぐ意図（§12.3）。
      const ownedProvinceIdsInPolity = getHouseProvinceIdsByPolity(state, houseId, polityId)
      const ownedProvinceCountInPolity = ownedProvinceIdsInPolity.length
      const localMilitaryProxy = ownedProvinceCountInPolity * 10
      const housePrestige = house.legacyPrestige

      const calculatedRawPower =
        config.polityShareBase +
        ownedProvinceCountInPolity * config.polityShareProvinceFactor +
        localMilitaryProxy * config.polityShareMilitaryFactor +
        house.wealth * config.polityShareWealthFactor +
        housePrestige * config.politySharePrestigeFactor +
        (isOwnerHouse ? config.polityShareOwnerHouseBonus : 0) +
        polityOfficeCount * config.polityShareOfficeFactor

      const newRawPower = calculatedRawPower * config.shareYearlyRetentionRate

      const upsertResult = upsertOrganizationShare(state, {
        organization: polityRef,
        holder: { kind: 'house', id: houseId },
        rawPower: newRawPower,
      })
      if (upsertResult.ok) state = upsertResult.value
    }
  }

  // 2. Update House Shares for each House
  for (const houseId of Object.keys(state.houses).sort() as HouseId[]) {
    const house = state.houses[houseId]
    if (!house || !house.active) continue

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
    const houseOfficeAssignments = getOfficeAssignments(state, houseRef)

    for (const personId of house.memberIds) {
      const person = state.persons[personId]
      if (!person || !person.alive) continue

      const isLeader = personId === leaderId
      const hasOffice =
        houseOfficeAssignments.some((o) => o.active && o.holderPersonId === personId) ||
        (() => {
          const housePrimaryPolityId = getHousePrimaryPolityId(state, houseId)
          if (!housePrimaryPolityId) return false
          return getOfficeAssignments(state, { kind: 'polity', id: housePrimaryPolityId }).some(
            (o) => o.active && o.holderPersonId === personId,
          )
        })()

      const newRawPower =
        config.houseShareBase +
        (isLeader ? config.houseShareLeaderBonus : 0) +
        (hasOffice ? config.houseShareOfficeBonus : 0) +
        person.legacyPrestige * config.houseSharePrestigeFactor +
        person.wealth * config.houseShareWealthFactor +
        (getRoleScore(state, person.id, 'governance') / 10 +
          getRoleScore(state, person.id, 'warCommand') / 10) *
          config.houseShareStatFactor

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
