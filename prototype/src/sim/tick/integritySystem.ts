import type { TickContext } from './context'
import type { PolityId, HouseId, ProvinceId, PopGroupId } from '../types/ids'
import type { OrganizationKind, OfficeRole } from '../types/office'
import { getHouseLeader } from '../selectors/officeSelectors'
import { OFFICE_DEFINITIONS } from '../config/officeDefinitions'
import { ABILITY_KEYS, ABILITY_HARD_CAP } from '../constants/abilityConstants'
import type { SimError } from '../mutations/errors'
import type { WorldState } from '../types/world'

export function collectIntegrityErrors(state: WorldState): SimError[] {
  const errors: SimError[] = []

  // 1. OrganizationShare integrity
  for (const shareId of Object.keys(state.organizationShares)) {
    const share = state.organizationShares[shareId as import('../types/ids').OrganizationShareId]
    if (!share) continue
    if (share.rawPower < 0) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `OrganizationShare ${shareId} has negative rawPower: ${share.rawPower}`,
      })
    }
    if (share.organization.kind === 'polity') {
      if (!state.polities[share.organization.id]) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `OrganizationShare ${shareId} references non-existent polity ${share.organization.id}`,
        })
      }
    } else {
      if (!state.houses[share.organization.id]) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `OrganizationShare ${shareId} references non-existent house ${share.organization.id}`,
        })
      }
    }
    if (share.holder.kind === 'person') {
      if (!state.persons[share.holder.id]) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `OrganizationShare ${shareId} references non-existent person ${share.holder.id}`,
        })
      }
    } else {
      if (!state.houses[share.holder.id]) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `OrganizationShare ${shareId} references non-existent house ${share.holder.id}`,
        })
      }
    }
  }

  // 2. OfficeAssignment integrity
  for (const officeId of Object.keys(state.officeAssignments)) {
    const office = state.officeAssignments[officeId as import('../types/ids').OfficeAssignmentId]
    if (!office || !office.active) continue

    const person = state.persons[office.holderPersonId]
    if (!person || !person.alive) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Active OfficeAssignment ${officeId} holder ${office.holderPersonId} is not alive`,
      })
    }

    const defKey: `${OrganizationKind}:${OfficeRole}` = `${office.organization.kind}:${office.role}`
    if (!OFFICE_DEFINITIONS[defKey]) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `OfficeAssignment ${officeId} has invalid role ${defKey}`,
      })
    }

    if (office.unpaidCount < 0) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `OfficeAssignment ${officeId} has negative unpaidCount`,
      })
    }
  }

  // 3. Active House must have exactly 1 house:leader office
  for (const houseId of Object.keys(state.houses).sort()) {
    const house = state.houses[houseId as HouseId]
    if (!house || !house.active) continue

    const leader = getHouseLeader(state, houseId as HouseId)
    if (leader) {
      const person = state.persons[leader]
      if (!person || !person.alive) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `House ${houseId} leader ${leader} is not alive`,
        })
      }
      if (!house.memberIds.some((m) => (m as string) === (leader as string))) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `House ${houseId} leader ${leader} is not in memberIds`,
        })
      }
    }
  }

  // 4. Person wealth >= 0
  for (const personId of Object.keys(state.persons)) {
    const person = state.persons[personId as import('../types/ids').PersonId]
    if (!person) continue
    if (person.wealth < 0) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Person ${personId} has negative wealth: ${person.wealth}`,
      })
    }
  }

  // 5. Polity treasury >= 0
  for (const polityId of Object.keys(state.polities)) {
    const polity = state.polities[polityId as PolityId]
    if (!polity) continue
    if (polity.treasury < 0) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Polity ${polityId} has negative treasury: ${polity.treasury}`,
      })
    }
  }

  // 6. House wealth >= 0
  for (const houseId of Object.keys(state.houses)) {
    const house = state.houses[houseId as HouseId]
    if (!house) continue
    if (house.wealth < 0) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `House ${houseId} has negative wealth: ${house.wealth}`,
      })
    }
  }

  // 7. ShareIndex consistency
  for (const [key, ids] of Object.entries(state.shareIndex.byOrganization)) {
    for (const shareId of ids ?? []) {
      const share = state.organizationShares[shareId]
      if (!share) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `shareIndex.byOrganization[${key}] references non-existent share ${shareId}`,
        })
      }
    }
  }
  for (const [key, ids] of Object.entries(state.shareIndex.byHolder)) {
    for (const shareId of ids ?? []) {
      const share = state.organizationShares[shareId]
      if (!share) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `shareIndex.byHolder[${key}] references non-existent share ${shareId}`,
        })
      }
    }
  }

  // 8. OfficeIndex consistency
  for (const [key, ids] of Object.entries(state.officeIndex.byOrganization)) {
    for (const officeId of ids ?? []) {
      const office = state.officeAssignments[officeId]
      if (!office) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `officeIndex.byOrganization[${key}] references non-existent office ${officeId}`,
        })
      }
    }
  }

  // 9. Active House memberIds are consistent
  for (const houseId of Object.keys(state.houses).sort()) {
    const house = state.houses[houseId as HouseId]
    if (!house || !house.active) continue
    for (const memberId of house.memberIds) {
      const member = state.persons[memberId]
      if (!member) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `House ${houseId} has non-existent member ${memberId}`,
        })
      }
    }
  }

  // 10. ability <= aptitude and both in [0, ABILITY_HARD_CAP]
  for (const personId of Object.keys(state.persons)) {
    const person = state.persons[personId as import('../types/ids').PersonId]
    if (!person) continue
    for (const k of ABILITY_KEYS) {
      const ability = person.abilities[k]
      const aptitude = person.aptitudes[k]
      if (ability < 0 || ability > ABILITY_HARD_CAP) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Person ${personId} ability.${k}=${ability} is outside [0, ${ABILITY_HARD_CAP}]`,
        })
      }
      if (aptitude < 0 || aptitude > ABILITY_HARD_CAP) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Person ${personId} aptitude.${k}=${aptitude} is outside [0, ${ABILITY_HARD_CAP}]`,
        })
      }
      if (ability > aptitude) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Person ${personId} ability.${k}=${ability} exceeds aptitude.${k}=${aptitude}`,
        })
      }
    }
  }

  // 11. Dead person must have wealth === 0 (estate settled)
  for (const personId of Object.keys(state.persons)) {
    const person = state.persons[personId as import('../types/ids').PersonId]
    if (!person) continue
    if (!person.alive && person.wealth > 0) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Dead person ${personId} still has wealth=${person.wealth}`,
      })
    }
  }

  // 12. Province.polityId must point to an existing Polity
  for (const provinceId of Object.keys(state.provinces)) {
    const province = state.provinces[provinceId as ProvinceId]
    if (!province) continue
    if (!state.polities[province.polityId]) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Province ${provinceId} has polityId ${province.polityId} which does not exist`,
      })
    }
    if (!state.houses[province.ownerHouseId]) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Province ${provinceId} has ownerHouseId ${province.ownerHouseId} which does not exist`,
      })
    }
    const polity = state.polities[province.polityId]
    if (polity && !polity.active) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Province ${provinceId} has inactive polity ${province.polityId}`,
      })
    }
    const ownerHouse = state.houses[province.ownerHouseId]
    if (ownerHouse && !ownerHouse.active) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Province ${provinceId} has inactive ownerHouse ${province.ownerHouseId}`,
      })
    }
  }

  // 13. Polity.capitalProvinceId belongs to that polity.
  // v0.15 Stage B: PolityOwnerConsistencySystem (Phase 6) が capital を維持する設計だが、
  // Stage B では同 system が空骨格のため、capital が他 Polity に流出した状態は throw せず warn する。
  // Phase 4 で strict 復帰。
  for (const polityId of Object.keys(state.polities)) {
    const polity = state.polities[polityId as PolityId]
    if (!polity) continue
    const capital = state.provinces[polity.capitalProvinceId]
    if (!capital) {
      console.warn(
        `INTEGRITY (Stage B warn): Polity ${polityId} has capitalProvinceId ${polity.capitalProvinceId} which does not exist`,
      )
    } else if (capital.polityId !== polityId) {
      console.warn(
        `INTEGRITY (Stage B warn): Polity ${polityId} capitalProvinceId ${polity.capitalProvinceId} belongs to polity ${capital.polityId}`,
      )
    }
  }

  // 14. House.seatProvinceId is in house.provinceIds.
  // v0.15 Stage B: HouseExtinction や Province 喪失で seat が一時的に provinceIds 外になる経路は
  // PolityOwnerConsistencySystem (Phase 6) / HouseExtinction (Phase 9) で補正される設計のため warn のみ。
  // Phase 4 で strict 復帰。
  for (const houseId of Object.keys(state.houses)) {
    const house = state.houses[houseId as HouseId]
    if (!house) continue
    if (!house.provinceIds.includes(house.seatProvinceId)) {
      console.warn(
        `INTEGRITY (Stage B warn): House ${houseId} seatProvinceId ${house.seatProvinceId} is not in provinceIds`,
      )
    }
  }

  // 15. House.provinceIds and Province.ownerHouseId are bidirectionally consistent
  for (const houseId of Object.keys(state.houses)) {
    const house = state.houses[houseId as HouseId]
    if (!house) continue
    for (const provId of house.provinceIds) {
      const province = state.provinces[provId]
      if (province && province.ownerHouseId !== houseId) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `House ${houseId} lists province ${provId} but its ownerHouseId is ${province.ownerHouseId}`,
        })
      }
    }
  }
  for (const provinceId of Object.keys(state.provinces)) {
    const province = state.provinces[provinceId as ProvinceId]
    if (!province) continue
    const house = state.houses[province.ownerHouseId]
    if (house && !house.provinceIds.includes(provinceId as ProvinceId)) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Province ${provinceId} has ownerHouseId ${province.ownerHouseId} but that house does not list this province`,
      })
    }
  }

  // 16. OrganizationRef.kind is 'polity' | 'house' only (no 'country')
  for (const shareId of Object.keys(state.organizationShares)) {
    const share = state.organizationShares[shareId as import('../types/ids').OrganizationShareId]
    if (!share) continue
    const kind = share.organization.kind
    if (kind !== 'polity' && kind !== 'house') {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `OrganizationShare ${shareId} has invalid organization.kind '${String(kind)}' (must be 'polity' or 'house')`,
      })
    }
  }

  // 17. v0.15 §25.2: No attitude key starts with the legacy 'country:' prefix.
  // 新しい attitude key prefix は 'polity:' なので、'country:' が残っていたら v0.14 残骸の違反。
  for (const personId of Object.keys(state.persons)) {
    const person = state.persons[personId as import('../types/ids').PersonId]
    if (!person) continue
    for (const key of Object.keys(person.attitudes)) {
      if (key.startsWith('country:')) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Person ${personId} has legacy attitude key '${key}' starting with 'country:'`,
        })
      }
    }
  }
  for (const popGroupId of Object.keys(state.popGroups)) {
    const pop = state.popGroups[popGroupId as PopGroupId]
    if (!pop) continue
    for (const key of Object.keys(pop.attitudes)) {
      if (key.startsWith('country:')) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `PopGroup ${popGroupId} has legacy attitude key '${key}' starting with 'country:'`,
        })
      }
    }
  }

  // 18. Active Polity has active polity:leader Office (WARN)
  for (const polityId of Object.keys(state.polities)) {
    const polity = state.polities[polityId as PolityId]
    if (!polity || !polity.active) continue
    const leader = getHouseLeader(state, polity.ownerHouseId as HouseId)
    if (leader) {
      const officeKey = Object.keys(state.officeAssignments).find(
        (k) =>
          state.officeAssignments[k as import('../types/ids').OfficeAssignmentId]
            ?.holderPersonId === leader,
      )
      const office = officeKey
        ? state.officeAssignments[officeKey as import('../types/ids').OfficeAssignmentId]
        : undefined
      if (office && office.active) {
        console.warn(
          `Active Polity ${polityId} has active polity:leader Office via House ${polity.ownerHouseId}`,
        )
      }
    }
  }

  // 19. Active House has active house:leader Office (WARN)
  for (const houseId of Object.keys(state.houses)) {
    const house = state.houses[houseId as HouseId]
    if (!house || !house.active) continue
    const leader = getHouseLeader(state, houseId as HouseId)
    if (leader) {
      const officeKey = Object.keys(state.officeAssignments).find(
        (k) =>
          state.officeAssignments[k as import('../types/ids').OfficeAssignmentId]
            ?.holderPersonId === leader,
      )
      const office = officeKey
        ? state.officeAssignments[officeKey as import('../types/ids').OfficeAssignmentId]
        : undefined
      if (office && office.active) {
        console.warn(`Active House ${houseId} has active house:leader Office`)
      }
    }
  }

  return errors
}

export function runIntegritySystem(ctx: TickContext): TickContext {
  const errors = collectIntegrityErrors(ctx.state)

  if (errors.length > 0) {
    for (const error of errors) {
      console.error('INTEGRITY:', error.message)
    }
    throw new Error(`Integrity check failed with ${errors.length} error(s): ${errors[0]?.message}`)
  }

  return ctx
}
