import type { PolityId, HouseId, PopGroupId, HoldingId } from '../types/ids'
import type { OrganizationKind, OfficeRole } from '../types/office'
import { getHouseLeader } from '../selectors/officeSelectors'
import { OFFICE_DEFINITIONS } from '../config/officeDefinitions'
import { ABILITY_KEYS, ABILITY_HARD_CAP } from '../constants/abilityConstants'
import { getHouseProvinceIdsByPolity } from '../selectors/polityRelations'
import type { SimError } from '../mutations/errors'
import type { WorldState } from '../types/world'
import { getPolityTerritorialStatus } from '../types/polity'
import { WEEKS_PER_YEAR } from '../utils/timeUtils'

export function checkCoreEntities(state: WorldState, errors: SimError[], debug: boolean): void {
  // §17.1 Time invariants (v0.19)
  if (state.currentWeekOfYear < 1 || state.currentWeekOfYear > WEEKS_PER_YEAR) {
    errors.push({
      code: 'INTEGRITY_VIOLATION',
      message: `currentWeekOfYear=${state.currentWeekOfYear} outside valid range [1, ${WEEKS_PER_YEAR}]`,
    })
  }
  if (state.absoluteWeek < 0) {
    errors.push({
      code: 'INTEGRITY_VIOLATION',
      message: `absoluteWeek=${state.absoluteWeek} is negative`,
    })
  }
  const expectedYear = Math.floor(state.absoluteWeek / WEEKS_PER_YEAR)
  const expectedWeek = (state.absoluteWeek % WEEKS_PER_YEAR) + 1
  if (state.currentYear !== expectedYear || state.currentWeekOfYear !== expectedWeek) {
    errors.push({
      code: 'INTEGRITY_VIOLATION',
      message: `Time fields inconsistent: absoluteWeek=${state.absoluteWeek} implies year=${expectedYear}/week=${expectedWeek}, but state has year=${state.currentYear}/week=${state.currentWeekOfYear}`,
    })
  }

  // 1. HouseShare integrity (v0.42c: 旧 OrganizationShare — polity share は型レベルで全廃)
  for (const shareId of Object.keys(state.houseShares)) {
    const share = state.houseShares[shareId as import('../types/ids').HouseShareId]
    if (!share) continue
    if (share.rawPower < 0) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `HouseShare ${shareId} has negative rawPower: ${share.rawPower}`,
      })
    }
    if (!state.houses[share.houseId]) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `HouseShare ${shareId} references non-existent house ${share.houseId}`,
      })
    }
    if (!state.persons[share.holderPersonId]) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `HouseShare ${shareId} references non-existent person ${share.holderPersonId}`,
      })
    }
    // Phase D §13.4: house share holder person must belong to that house
    const holderPerson = state.persons[share.holderPersonId]
    if (holderPerson && holderPerson.alive && holderPerson.houseId !== share.houseId) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `HouseShare ${shareId} holder Person ${share.holderPersonId} has houseId=${holderPerson.houseId ?? 'undefined'} but share house is ${share.houseId}`,
      })
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

    // v0.47 §19.2: titular Polity は leader 以外の active polity office を持たない
    if (office.organization.kind === 'polity' && office.role !== 'leader') {
      const op = state.polities[office.organization.id]
      if (op && getPolityTerritorialStatus(op) === 'titular') {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `OfficeAssignment ${officeId} role=${office.role} on titular Polity ${office.organization.id} (only leader allowed) (v0.47 §19.2)`,
        })
      }
    }

    // v0.42 slot 単位任命権: slotIndex は整数 >= 0。
    // effectiveMax 上限は課さない (縮小〜organizationConsistency 回収間の合法 transient)。
    if (!Number.isInteger(office.slotIndex) || office.slotIndex < 0) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `OfficeAssignment ${officeId} has invalid slotIndex ${office.slotIndex}`,
      })
    }
  }

  // 2b. v0.42 slot 単位任命権: active な同 (organization, role) 内で slotIndex は一意
  {
    const seenSlots = new Map<string, string>()
    for (const officeId of Object.keys(state.officeAssignments).sort()) {
      const office = state.officeAssignments[officeId as import('../types/ids').OfficeAssignmentId]
      if (!office || !office.active) continue
      const slotKey = `${office.organization.kind}:${office.organization.id}:${office.role}:${office.slotIndex}`
      const prev = seenSlots.get(slotKey)
      if (prev !== undefined) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `OfficeAssignment ${officeId} duplicates slotIndex ${office.slotIndex} of ${prev} (${office.organization.kind}:${office.organization.id} ${office.role})`,
        })
      } else {
        seenSlots.set(slotKey, officeId)
      }
    }
  }

  // 3. Active House must have exactly 1 house:leader office
  for (const houseId of Object.keys(state.houses).sort()) {
    const house = state.houses[houseId as HouseId]
    if (!house || !house.active) continue
    // v0.16: AnonymousHouse など system house は house:leader 要件を満たさなくてよい
    if (house.kind === 'system') continue

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
    } else {
      // 調査 §1.8: active な非 system House は house:leader office を 1 つ持たねばならない。
      // 旧コードは leader が undefined の場合に何も検査せず、headless house が year-end を
      // 迎えても見逃していた (memory: organizationConsistency が housed leader を headless 化
      // した実例が 300年 clean をすり抜けた前例あり)。else 節で違反として検出する。
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `House ${houseId} is active but has no house:leader office`,
      })
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

  // 7. HouseShareIndex consistency
  for (const [key, ids] of Object.entries(state.houseShareIndex.byHouse)) {
    for (const shareId of ids ?? []) {
      const share = state.houseShares[shareId]
      if (!share) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `houseShareIndex.byHouse[${key}] references non-existent share ${shareId}`,
        })
      }
    }
  }
  for (const [key, ids] of Object.entries(state.houseShareIndex.byHolderPerson)) {
    for (const shareId of ids ?? []) {
      const share = state.houseShares[shareId]
      if (!share) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `houseShareIndex.byHolderPerson[${key}] references non-existent share ${shareId}`,
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

  // v0.16 §7 不変条件 8: 各 LandContract の granteePolityId は active Polity を指す。
  // landless ↔ inactive の遷移は polityOwnerConsistencySystem に委ねるため、tick 末でこの不変条件が
  // 成立していなければ整合性エラー (誰かが defeated Polity への transfer を残した、または
  // polityOwnerConsistencySystem が走らないままここに到達した)。
  for (const contractIdStr of Object.keys(state.landContracts)) {
    const contract = state.landContracts[contractIdStr as import('../types/ids').LandContractId]
    if (!contract) continue
    const grantee = state.polities[contract.granteePolityId]
    if (!grantee) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `LandContract ${contractIdStr} grantee Polity ${contract.granteePolityId} does not exist`,
      })
    } else if (!grantee.active) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `LandContract ${contractIdStr} grantee Polity ${contract.granteePolityId} is inactive`,
      })
    }
  }

  // §25 #19: Polity.capitalProvinceId は存在する Province を指す (§10.1)
  //  当該 Polity が現在 terminal holder でなくてもよい (亡命政権・名目首都を許容)。
  for (const polityId of Object.keys(state.polities)) {
    const polity = state.polities[polityId as PolityId]
    if (!polity) continue
    if (!state.provinces[polity.capitalProvinceId]) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Polity ${polityId} capitalProvinceId ${polity.capitalProvinceId} does not exist (§25 #19)`,
      })
    }
  }

  // 16. (v0.42c 削除) organization.kind 検査 — HouseShare 化により型レベル保証

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

  // PopGroup merge key uniqueness: no duplicate (holdingId, class, occupation) combinations
  for (const holdingIdStr of Object.keys(state.popIndex.byHolding).sort()) {
    const holdingId = holdingIdStr as HoldingId
    const popIds = state.popIndex.byHolding[holdingId]
    if (!popIds) continue

    const seen = new Set<string>()
    for (const popId of popIds) {
      const pop = state.popGroups[popId]
      if (!pop) continue
      const mergeKey = `${pop.class}|${pop.occupation}`
      if (seen.has(mergeKey)) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `PopGroup merge key duplicate: holding=${holdingId} class=${pop.class} occupation=${pop.occupation} (popId=${popId as string})`,
        })
      }
      seen.add(mergeKey)
    }
  }

  // PopIndex.byHolding consistency: all referenced PopGroups exist and match holdingId
  for (const holdingIdStr of Object.keys(state.popIndex.byHolding).sort()) {
    const holdingId = holdingIdStr as HoldingId
    const popIds = state.popIndex.byHolding[holdingId]
    if (!popIds) continue

    for (const popId of popIds) {
      const pop = state.popGroups[popId]
      if (!pop) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `PopIndex references non-existent PopGroup: holding=${holdingId} popId=${popId as string}`,
        })
        continue
      }
      if ((pop.holdingId as string) !== (holdingId as string)) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `PopIndex holdingId mismatch: index has holding=${holdingId} but PopGroup.holdingId=${pop.holdingId as string} (popId=${popId as string})`,
        })
      }
    }
  }

  // PopGroup field validity checks (§17.2)
  const VALID_POP_CLASSES = ['peasants', 'townsmen', 'nobles']
  const VALID_POP_OCCUPATIONS = ['agriculture', 'urban_labor', 'elite_service', 'none']
  for (const popGroupId of Object.keys(state.popGroups).sort() as PopGroupId[]) {
    const pop = state.popGroups[popGroupId]
    if (!pop) continue

    // 1. holdingId exists
    if (!state.holdings[pop.holdingId]) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `PopGroup ${popGroupId} references non-existent Holding ${pop.holdingId}`,
      })
    }

    // 2. class is valid
    if (!VALID_POP_CLASSES.includes(pop.class)) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `PopGroup ${popGroupId} has invalid class '${pop.class}'`,
      })
    }

    // 3. occupation is valid
    if (!VALID_POP_OCCUPATIONS.includes(pop.occupation)) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `PopGroup ${popGroupId} has invalid occupation '${pop.occupation}'`,
      })
    }

    // 4. size >= 0
    if (pop.size < 0) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `PopGroup ${popGroupId} has negative size ${pop.size}`,
      })
    }

    // 5. wealth in [0, 100]
    if (pop.wealth < 0 || pop.wealth > 100) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `PopGroup ${popGroupId} has wealth ${pop.wealth} outside [0, 100]`,
      })
    }

    // 6. unrest in [0, 100]
    if (pop.unrest < 0 || pop.unrest > 100) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `PopGroup ${popGroupId} has unrest ${pop.unrest} outside [0, 100]`,
      })
    }

    // 7. Not an orphan
    const indexEntry = state.popIndex.byHolding[pop.holdingId]
    if (!indexEntry || !indexEntry.some((id) => id === pop.id)) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `PopGroup ${popGroupId} is orphaned: not found in popIndex.byHolding[${pop.holdingId}]`,
      })
    }
  }

  // Capacity over-exceed warnings (§17.2 item 8)
  if (debug) {
    // TODO: capacity over-exceed warning (§17.2 item 8) — requires selector import, deferred
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
      if (debug && office && office.active) {
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
    if (house.kind === 'system') continue
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
      if (debug && office && office.active) {
        console.warn(`Active House ${houseId} has active house:leader Office`)
      }
    }
  }

  // v0.16: 旧 Province.ownerHouseId / polityId 系の不変条件は廃止 (§8)。
  // 対応する v0.16 不変条件 (§25 の grantee active Polity / chain consistency など) は後続コミットで追加。

  // 23. spec §25.2 #8 — Active Polity ownerHouse must exist and be active (WARN)
  for (const polityId of Object.keys(state.polities)) {
    const polity = state.polities[polityId as PolityId]
    if (!polity || !polity.active) continue
    if (polity.ownerHouseId === undefined) continue
    const ownerHouse = state.houses[polity.ownerHouseId]
    if (debug && (!ownerHouse || !ownerHouse.active)) {
      console.warn(
        `INTEGRITY (Stage B warn): Polity ${polityId} ownerHouseId ${polity.ownerHouseId} is missing or inactive`,
      )
    }
  }

  // 24. spec §25.2 #9 — Active Polity ownerHouse must own a Province in that Polity (WARN)
  for (const polityId of Object.keys(state.polities)) {
    const polity = state.polities[polityId as PolityId]
    if (!polity || !polity.active) continue
    if (polity.ownerHouseId === undefined) continue
    if (
      getHouseProvinceIdsByPolity(state, polity.ownerHouseId, polityId as PolityId).length === 0
    ) {
      if (debug) {
        console.warn(
          `INTEGRITY (Stage B warn): Polity ${polityId} ownerHouse ${polity.ownerHouseId} owns no Province in this Polity`,
        )
      }
    }
  }

  // 25. (v0.42c 削除) polity share holder の Province 警告 — polity share 全廃

  // 26. spec §25.2 #15 — OfficeAssignment holder House must be in Polity
  // Stage B warn: tightened in Phase 6
  // v0.18-pre: commonwealth Polity の AnonymousHouse 所属 holder (rebel founder) は許容
  for (const officeId of Object.keys(state.officeAssignments)) {
    const office = state.officeAssignments[officeId as import('../types/ids').OfficeAssignmentId]
    if (!office || !office.active) continue
    if (office.organization.kind !== 'polity') continue
    const polity = state.polities[office.organization.id]
    if (!polity || !polity.active) continue
    const person = state.persons[office.holderPersonId]
    if (!person) continue
    if (!person.houseId) continue
    const houseId = person.houseId
    const isCommonwealthRebelHolder = polity.kind === 'commonwealth' && !houseId
    if (isCommonwealthRebelHolder) continue
    if (!houseId) continue
    const ownsProvince =
      getHouseProvinceIdsByPolity(state, houseId, office.organization.id).length > 0
    const isOwnerHouse = polity.ownerHouseId !== undefined && houseId === polity.ownerHouseId
    if (!ownsProvince && !isOwnerHouse) {
      if (debug) {
        console.warn(
          `INTEGRITY (Stage B warn): OfficeAssignment ${officeId} holder Person ${office.holderPersonId} belongs to House ${houseId}, which is not in Polity ${polity.id}`,
        )
      }
    }
  }
}
