import type { TickContext } from './context'
import type { CountryId, HouseId } from '@sim/types/ids'
import type { OrganizationRef } from '@sim/types/office'
import {
  createOrganizationShare,
  updateShareRawPower,
  deleteOrganizationShare,
  transferShareRawPower,
} from '@sim/mutations/shareMutations'
import { getOrganizationShares } from '@sim/selectors/shareSelectors'
import { getHouseLeader } from '@sim/selectors/officeSelectors'
import { getOfficeAssignments } from '@sim/selectors/officeSelectors'

export function runShareUpdateSystem(ctx: TickContext): TickContext {
  if (ctx.state.currentMonth !== 1) return ctx

  let state = ctx.state
  const config = ctx.config

  // 1. Update Country Shares for each Country
  for (const countryId of Object.keys(state.countries).sort() as CountryId[]) {
    const country = state.countries[countryId]
    if (!country || !country.active) continue

    const countryRef: OrganizationRef = { kind: 'country', id: countryId }
    const existingShares = getOrganizationShares(state, countryRef)

    // Build map of existing shares by house holder
    const shareByHouse = new Map<string, (typeof existingShares)[number]>()
    for (const share of existingShares) {
      if (share.holder.kind === 'house') {
        shareByHouse.set(share.holder.id, share)
      }
    }

    // Compute new rawPower for each house in this country
    for (const houseId of country.houseIds) {
      const house = state.houses[houseId]
      if (!house || !house.active) continue

      const isRulerHouse = (() => {
        const countryLeaders = getOfficeAssignments(state, countryRef).filter(
          (o) => o.active && o.role === 'leader',
        )
        return countryLeaders.some((o) => {
          const p = state.persons[o.holderPersonId]
          return p && p.houseId === houseId
        })
      })()

      // Count non-leader offices held by persons of this house
      const countryOfficeCount = getOfficeAssignments(state, countryRef)
        .filter((o) => o.active && o.role !== 'leader')
        .filter((o) => {
          const p = state.persons[o.holderPersonId]
          return p && p.houseId === houseId
        }).length

      const militaryProxy = house.provinceIds.length * 10
      const housePrestige = house.legacyPrestige

      const calculatedRawPower =
        config.countryShareBase +
        house.provinceIds.length * config.countryShareProvinceFactor +
        militaryProxy * config.countryShareMilitaryFactor +
        house.wealth * config.countryShareWealthFactor +
        housePrestige * config.countrySharePrestigeFactor +
        (isRulerHouse ? config.countryShareRulerHouseBonus : 0) +
        countryOfficeCount * config.countryShareOfficeFactor

      const newRawPower = calculatedRawPower * config.shareYearlyRetentionRate

      const existing = shareByHouse.get(houseId)
      if (existing) {
        if (newRawPower <= 0) {
          state = deleteOrganizationShare(state, existing.id)
        } else {
          state = updateShareRawPower(state, existing.id, newRawPower)
        }
      } else if (newRawPower > 0) {
        state = createOrganizationShare(
          state,
          countryRef,
          { kind: 'house', id: houseId },
          newRawPower,
        )
      }
    }

    // Delete shares for houses that are no longer in this country
    const currentHouseIds = new Set(country.houseIds)
    for (const share of existingShares) {
      if (share.holder.kind === 'house' && !currentHouseIds.has(share.holder.id)) {
        state = deleteOrganizationShare(state, share.id)
      }
    }
  }

  // 2. Update House Shares for each House
  for (const houseId of Object.keys(state.houses).sort() as HouseId[]) {
    const house = state.houses[houseId]
    if (!house || !house.active) continue

    const houseRef: OrganizationRef = { kind: 'house', id: houseId }
    const existingShares = getOrganizationShares(state, houseRef)

    const shareByPerson = new Map<string, (typeof existingShares)[number]>()
    for (const share of existingShares) {
      if (share.holder.kind === 'person') {
        shareByPerson.set(share.holder.id, share)
      }
    }

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
        state = deleteOrganizationShare(state, share.id)
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
        getOfficeAssignments(state, { kind: 'country', id: house.countryId }).some(
          (o) => o.active && o.holderPersonId === personId,
        )

      const newRawPower =
        config.houseShareBase +
        (isLeader ? config.houseShareLeaderBonus : 0) +
        (hasOffice ? config.houseShareOfficeBonus : 0) +
        person.legacyPrestige * config.houseSharePrestigeFactor +
        person.wealth * config.houseShareWealthFactor +
        (person.stats.admin + person.stats.martial) * config.houseShareStatFactor

      const existing = shareByPerson.get(personId)
      if (existing) {
        if (newRawPower <= 0) {
          state = deleteOrganizationShare(state, existing.id)
        } else {
          state = updateShareRawPower(state, existing.id, newRawPower)
        }
      } else if (newRawPower > 0) {
        state = createOrganizationShare(
          state,
          houseRef,
          { kind: 'person', id: personId },
          newRawPower,
        )
      }
    }
  }

  return { ...ctx, state }
}
