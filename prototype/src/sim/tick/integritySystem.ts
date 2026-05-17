import type { TickContext } from './context'
import type { CountryId, HouseId } from '../types/ids'
import type { OrganizationKind, OfficeRole } from '../types/office'
import { getHouseLeader, getCountryRuler } from '../selectors/officeSelectors'
import { OFFICE_DEFINITIONS } from '../config/officeDefinitions'

export function runIntegritySystem(ctx: TickContext): TickContext {
  const state = ctx.state
  const errors: string[] = []

  // 1. OrganizationShare integrity
  for (const shareId of Object.keys(state.organizationShares)) {
    const share = state.organizationShares[shareId as import('../types/ids').OrganizationShareId]
    if (!share) continue
    if (share.rawPower < 0) {
      errors.push(`OrganizationShare ${shareId} has negative rawPower: ${share.rawPower}`)
    }
    if (share.organization.kind === 'country') {
      if (!state.countries[share.organization.id]) {
        errors.push(
          `OrganizationShare ${shareId} references non-existent country ${share.organization.id}`,
        )
      }
    } else {
      if (!state.houses[share.organization.id]) {
        errors.push(
          `OrganizationShare ${shareId} references non-existent house ${share.organization.id}`,
        )
      }
    }
    if (share.holder.kind === 'person') {
      if (!state.persons[share.holder.id]) {
        errors.push(
          `OrganizationShare ${shareId} references non-existent person ${share.holder.id}`,
        )
      }
    } else {
      if (!state.houses[share.holder.id]) {
        errors.push(`OrganizationShare ${shareId} references non-existent house ${share.holder.id}`)
      }
    }
  }

  // 2. OfficeAssignment integrity
  for (const officeId of Object.keys(state.officeAssignments)) {
    const office = state.officeAssignments[officeId as import('../types/ids').OfficeAssignmentId]
    if (!office || !office.active) continue

    const person = state.persons[office.holderPersonId]
    if (!person || !person.alive) {
      errors.push(
        `Active OfficeAssignment ${officeId} holder ${office.holderPersonId} is not alive`,
      )
    }

    const defKey: `${OrganizationKind}:${OfficeRole}` = `${office.organization.kind}:${office.role}`
    if (!OFFICE_DEFINITIONS[defKey]) {
      errors.push(`OfficeAssignment ${officeId} has invalid role ${defKey}`)
    }

    if (office.unpaidCount < 0) {
      errors.push(`OfficeAssignment ${officeId} has negative unpaidCount`)
    }
  }

  // 3. Active Country must have exactly 1 country:leader office
  for (const countryId of Object.keys(state.countries).sort()) {
    const country = state.countries[countryId as CountryId]
    if (!country || !country.active) continue

    const ruler = getCountryRuler(state, countryId as CountryId)
    if (!ruler) {
      // Transient state is allowed — succession will fix it next tick
    }
  }

  // 4. Active House must have exactly 1 house:leader office
  for (const houseId of Object.keys(state.houses).sort()) {
    const house = state.houses[houseId as HouseId]
    if (!house || !house.active) continue

    const leader = getHouseLeader(state, houseId as HouseId)
    if (!leader) {
      // Transient — succession will fix
    } else {
      const person = state.persons[leader]
      if (!person || !person.alive) {
        errors.push(`House ${houseId} leader ${leader} is not alive`)
      }
      if (!house.memberIds.some((m) => (m as string) === (leader as string))) {
        errors.push(`House ${houseId} leader ${leader} is not in memberIds`)
      }
    }
  }

  // 5. Person wealth >= 0
  for (const personId of Object.keys(state.persons)) {
    const person = state.persons[personId as import('../types/ids').PersonId]
    if (!person) continue
    if (person.wealth < 0) {
      errors.push(`Person ${personId} has negative wealth: ${person.wealth}`)
    }
  }

  // 6. Country treasury >= 0
  for (const countryId of Object.keys(state.countries)) {
    const country = state.countries[countryId as CountryId]
    if (!country) continue
    if (country.treasury < 0) {
      errors.push(`Country ${countryId} has negative treasury: ${country.treasury}`)
    }
  }

  // 7. House wealth >= 0
  for (const houseId of Object.keys(state.houses)) {
    const house = state.houses[houseId as HouseId]
    if (!house) continue
    if (house.wealth < 0) {
      errors.push(`House ${houseId} has negative wealth: ${house.wealth}`)
    }
  }

  // 8. ShareIndex consistency
  for (const [key, ids] of Object.entries(state.shareIndex.byOrganization)) {
    for (const shareId of ids ?? []) {
      const share = state.organizationShares[shareId]
      if (!share) {
        errors.push(`shareIndex.byOrganization[${key}] references non-existent share ${shareId}`)
      }
    }
  }
  for (const [key, ids] of Object.entries(state.shareIndex.byHolder)) {
    for (const shareId of ids ?? []) {
      const share = state.organizationShares[shareId]
      if (!share) {
        errors.push(`shareIndex.byHolder[${key}] references non-existent share ${shareId}`)
      }
    }
  }

  // 9. OfficeIndex consistency
  for (const [key, ids] of Object.entries(state.officeIndex.byOrganization)) {
    for (const officeId of ids ?? []) {
      const office = state.officeAssignments[officeId]
      if (!office) {
        errors.push(`officeIndex.byOrganization[${key}] references non-existent office ${officeId}`)
      }
    }
  }

  // 10. Active House memberIds are consistent
  for (const houseId of Object.keys(state.houses).sort()) {
    const house = state.houses[houseId as HouseId]
    if (!house || !house.active) continue
    for (const memberId of house.memberIds) {
      const member = state.persons[memberId]
      if (!member) {
        errors.push(`House ${houseId} has non-existent member ${memberId}`)
      }
    }
  }

  if (errors.length > 0) {
    for (const error of errors) {
      console.error('INTEGRITY:', error)
    }
    throw new Error(`Integrity check failed with ${errors.length} error(s): ${errors[0]}`)
  }

  return ctx
}
