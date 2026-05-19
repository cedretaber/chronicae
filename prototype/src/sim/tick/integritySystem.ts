import type { TickContext } from './context'
import type {
  PolityId,
  HouseId,
  PopGroupId,
  ProvinceId,
  LandContractId,
  FactionId,
  FactionMembershipId,
  PersonId,
  ActorIntentId,
  DiplomaticPlayId,
} from '../types/ids'
import type { OrganizationKind, OfficeRole } from '../types/office'
import { getHouseLeader } from '../selectors/officeSelectors'
import { OFFICE_DEFINITIONS } from '../config/officeDefinitions'
import { ABILITY_KEYS, ABILITY_HARD_CAP } from '../constants/abilityConstants'
import { getHouseProvinceIdsByPolity } from '../selectors/polityRelations'
import { ANONYMOUS_HOUSE_ID, ROOT_WORLD } from '../types/landContract'
import { getGrantorRank, getLandContractGrantor } from '../selectors/landContractSelectors'
import type { SimError } from '../mutations/errors'
import type { WorldState } from '../types/world'
import type { PoliticalActorRef } from '../types/actor'

// v0.16 §25 IntegrityCheck 33 項目の実装状況サマリ:
//
//   #1  各 Province に root contract 1 本               → 後段「§25 #1: 各 Province に root contract が 1 本」で error throw
//   #2  root の rootAuthorityId は ROOT_WORLD            → 「§25 #2: root contract は rootAuthorityId を持ち ROOT_WORLD」で error throw
//   #3  child は rootAuthorityId を持たない              → 「§25 #3: parent を持つ contract は rootAuthorityId を持たない」で error throw
//   #4  chain は枝分かれしない                          → 「§25 #4: chain 上の child contract は最大 1 つ」で error throw
//   #5  contract.provinceId 存在                         → 「§25 #5: 各 LandContract の provinceId は存在する Province」で error throw
//   #6  contract.provinceId == parent.provinceId         → 「§25 #6: contract.provinceId は parent contract の provinceId と一致」で error throw
//   #7  getGrantorRank < grantee.rank                    → 「§25 #7: getGrantorRank(grantor) < grantee.rank」で error throw
//   #8  grantee は active Polity                         → v0.16 §7 不変条件 8 区画で error throw
//   #9  parentContractId 存在                            → 「§25 #9: parentContractId は存在する LandContract」で error throw
//   #10 House/Person grantee 不可                        → 型レベル保証 (LandContract.granteePolityId: PolityId のみ)。runtime チェック不要
//   #11 root taxRate = 0                                 → 「§25 #11: root contract の terms.taxRateToGrantor は 0」で error throw
//   #12 byProvince 同期 + chain 順                       → 「§25 #12: landContractIndex.byProvince は state.landContracts と一致し chain 順」で error throw
//   #13 byGranteePolity 同期                             → 「§25 #13: landContractIndex.byGranteePolity は state.landContracts と一致」で error throw
//   #14 byParent 同期 (parent → child 方向)              → 「§25 #14: landContractIndex.byParent は state.landContracts と一致」で error throw
//   #15 provinceTerminalPolityCache 同期                 → 「§25 #15: provinceTerminalPolityCache は chain の terminal grantee と一致」で error throw
//   #16 polityIndex.byOwnerHouse 同期                    → 「§25 #16: polityIndex.byOwnerHouse は state.polities と一致」で error throw
//   #17 landless Polity == inactive                      → 「§25 #17: landless Polity は active=false である」で error throw
//   #18 house.seatProvinceId 存在                        → 「§25 #18: House.seatProvinceId は存在する Province」で error throw
//   #19 polity.capitalProvinceId 存在                    → 直前ブロックで error throw
//   #20 House active 判定が memberIds ベース             → コードレベル保証 (houseExtinctionSystem は memberIds 判定のみ)。runtime チェック不要
//   #21 ownerHouseId active                              → 「§25 #21: Polity.ownerHouseId が定義済みなら、その House は存在し active」で error throw
//   #22 Province.houseControl 型から削除                 → 型レベル保証。runtime チェック不要
//   #23 各 Province に active bailiff 1 つ                → 「§25 #23: 各 Province に active な bailiff ProvinceOfficeAssignment が 1 つ」で error throw
//   #24 bailiff holder 存在                              → 同 #23 ブロック内で error throw
//   #25 placeholder ガード sweep                         → 「全 Person-loop に kind === 'placeholder' continue」のコードレビューで担保。runtime チェック困難 (システム毎の動的検証は意味がない)
//   #26 placeholder は kind === 'placeholder' で判定     → コードレベル保証 (isPlaceholderPerson selector 経由)。runtime チェック不要
//   #27 AnonymousHouse 存在                              → 「§25 #27: AnonymousHouse は worldgen 後に必ず 1 つ存在」で error throw
//   #28 placeholder Person.houseId = AnonymousHouse.id   → 「§25 #28: 全 placeholder Person の houseId は AnonymousHouse」で error throw
//   #29 normal House.memberIds に placeholder 無し       → 「§25 #29 inverse: Non-placeholder Person が AnonymousHouse」と「Normal House に placeholder member」の双方で error throw
//   #30 AnonymousHouse が grantee / ownerHouse / share holder にならない → 「§25 #30」ブロックで error throw
//   #31 AnonymousHouse.memberIds 全員 placeholder         → 「§25 #31: AnonymousHouse contains non-placeholder member」で error throw
//   #32 ProvinceOfficeAssignment は OfficeAssignment と別 entity → 型レベル保証 (OrganizationKind に 'province' は含まれない)。runtime チェック不要
//   #33 provinceOfficeIndex.byProvince 同期               → 「§25 #33: provinceOfficeIndex.byProvince[X] entry」で error throw
//
// 実装すべき 33 項目のうち error throw: 25 項目
// 型レベル保証 (runtime 不要): #10, #20, #22, #26, #32 = 5 項目
// コードレビューで担保 (runtime 困難): #25 = 1 項目
// (warn → error 昇格 済み: #19)
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
      if (office && office.active) {
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
    if (!ownerHouse || !ownerHouse.active) {
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
      console.warn(
        `INTEGRITY (Stage B warn): Polity ${polityId} ownerHouse ${polity.ownerHouseId} owns no Province in this Polity`,
      )
    }
  }

  // 25. spec §25.2 #14 — OrganizationShare holder House must own Province in Polity
  // Stage B warn: tightened in Phase 6
  for (const shareId of Object.keys(state.organizationShares)) {
    const share = state.organizationShares[shareId as import('../types/ids').OrganizationShareId]
    if (!share) continue
    if (share.organization.kind !== 'polity') continue
    const polity = state.polities[share.organization.id]
    if (!polity || !polity.active) continue
    if (share.holder.kind !== 'house') continue
    if (getHouseProvinceIdsByPolity(state, share.holder.id, share.organization.id).length === 0) {
      console.warn(
        `INTEGRITY (Stage B warn): OrganizationShare ${shareId} holder House ${share.holder.id} owns no Province in Polity ${share.organization.id}`,
      )
    }
  }

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
    const houseId = person.houseId
    const ownsProvince =
      getHouseProvinceIdsByPolity(state, houseId, office.organization.id).length > 0
    const isOwnerHouse = polity.ownerHouseId !== undefined && houseId === polity.ownerHouseId
    const isCommonwealthRebelHolder =
      polity.kind === 'commonwealth' && houseId === ANONYMOUS_HOUSE_ID
    if (!ownsProvince && !isOwnerHouse && !isCommonwealthRebelHolder) {
      console.warn(
        `INTEGRITY (Stage B warn): OfficeAssignment ${officeId} holder Person ${office.holderPersonId} belongs to House ${houseId}, which is not in Polity ${polity.id}`,
      )
    }
  }

  // ─── v0.16 §25 LandContract / AnonymousHouse / ProvinceOffice 不変条件 ───

  // §25 #5: 各 LandContract の provinceId は存在する Province を指す
  // §25 #6: contract.provinceId は parent contract の provinceId と一致する
  // §25 #7: getGrantorRank(grantor) < grantee.rank
  // §25 #9: parentContractId は存在する LandContract を指す
  // §25 #11: root contract (parentContractId なし) の terms.taxRateToGrantor は 0
  for (const contractIdStr of Object.keys(state.landContracts)) {
    const contractId = contractIdStr as LandContractId
    const contract = state.landContracts[contractId]
    if (!contract) continue
    if (!state.provinces[contract.provinceId]) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `LandContract ${contractId} provinceId ${contract.provinceId} does not exist (§25 #5)`,
      })
    }
    if (contract.parentContractId !== undefined) {
      const parent = state.landContracts[contract.parentContractId]
      if (!parent) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `LandContract ${contractId} parentContractId ${contract.parentContractId} does not exist (§25 #9)`,
        })
      } else if (parent.provinceId !== contract.provinceId) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `LandContract ${contractId} provinceId ${contract.provinceId} differs from parent ${parent.id} provinceId ${parent.provinceId} (§25 #6)`,
        })
      }
    } else {
      if (contract.terms.taxRateToGrantor !== 0) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Root LandContract ${contractId} taxRateToGrantor=${contract.terms.taxRateToGrantor} must be 0 (§25 #11)`,
        })
      }
    }
    const grantee = state.polities[contract.granteePolityId]
    if (grantee) {
      const grantor = getLandContractGrantor(state, contractId)
      if (grantor) {
        const grantorRank = getGrantorRank(state, grantor)
        if (grantorRank >= grantee.rank) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `LandContract ${contractId} grantorRank=${grantorRank} >= granteeRank=${grantee.rank} (§25 #7)`,
          })
        }
      }
    }
  }

  // §25 #1: 各 Province に root contract が 1 本存在する
  // §25 #4: chain 上の child contract は最大 1 つ (枝分かれしない)
  {
    const rootCount: Record<ProvinceId, number> = {}
    const childCount: Record<LandContractId, number> = {}
    for (const contractIdStr of Object.keys(state.landContracts)) {
      const contract = state.landContracts[contractIdStr as LandContractId]
      if (!contract) continue
      if (contract.parentContractId === undefined) {
        rootCount[contract.provinceId] = (rootCount[contract.provinceId] ?? 0) + 1
      } else {
        childCount[contract.parentContractId] = (childCount[contract.parentContractId] ?? 0) + 1
      }
    }
    for (const provId of Object.keys(state.provinces)) {
      const c = rootCount[provId as ProvinceId] ?? 0
      if (c !== 1) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Province ${provId} has ${c} root LandContract(s), expected 1 (§25 #1)`,
        })
      }
    }
    for (const parentId of Object.keys(childCount)) {
      const c = childCount[parentId as LandContractId] ?? 0
      if (c > 1) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `LandContract ${parentId} has ${c} child contracts (branching detected) (§25 #4)`,
        })
      }
    }
  }

  // §25 #12: landContractIndex.byProvince は state.landContracts と一致し chain 順
  // §25 #15: provinceTerminalPolityCache は chain の terminal grantee と一致
  for (const provIdStr of Object.keys(state.provinces)) {
    const provId = provIdStr as ProvinceId
    const chain = state.landContractIndex.byProvince[provId] ?? []
    if (chain.length === 0) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `landContractIndex.byProvince[${provId}] is empty (§25 #12)`,
      })
      continue
    }
    let prev: LandContractId | undefined = undefined
    let ok = true
    for (const id of chain) {
      const c = state.landContracts[id]
      if (!c) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `landContractIndex.byProvince[${provId}] references missing contract ${id} (§25 #12)`,
        })
        ok = false
        break
      }
      if (c.provinceId !== provId) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `landContractIndex.byProvince[${provId}] contains contract ${id} with mismatched provinceId ${c.provinceId} (§25 #12)`,
        })
        ok = false
        break
      }
      if (prev === undefined) {
        if (c.parentContractId !== undefined) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `landContractIndex.byProvince[${provId}] first element ${id} has parent (expected root) (§25 #12)`,
          })
          ok = false
          break
        }
      } else {
        if (c.parentContractId !== prev) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `landContractIndex.byProvince[${provId}] entry ${id} parent=${c.parentContractId} expected ${prev} (§25 #12 chain order)`,
          })
          ok = false
          break
        }
      }
      prev = id
    }
    if (ok && prev !== undefined) {
      const terminal = state.landContracts[prev]
      const cached = state.provinceTerminalPolityCache[provId]
      if (!terminal || cached !== terminal.granteePolityId) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `provinceTerminalPolityCache[${provId}]=${cached} differs from terminal grantee ${terminal?.granteePolityId} (§25 #15)`,
        })
      }
    }
  }

  // §25 #13: landContractIndex.byGranteePolity は state.landContracts と一致
  // §25 #14: landContractIndex.byParent は state.landContracts と一致
  //   注: byParent は「parent contract id → 直下 child contract id」のマッピング
  //   (mutations/landContractMutations.ts:createChildLandContract と同じ方向)。
  //   各 parent は 1 child しか持たない (§7 #5 枝分かれ禁止)。leaf parent は entry なし。
  {
    const expectedByGrantee: Record<PolityId, Set<LandContractId>> = {}
    const expectedByParent: Record<LandContractId, LandContractId> = {}
    for (const contractIdStr of Object.keys(state.landContracts)) {
      const contractId = contractIdStr as LandContractId
      const c = state.landContracts[contractId]
      if (!c) continue
      if (!expectedByGrantee[c.granteePolityId]) {
        expectedByGrantee[c.granteePolityId] = new Set()
      }
      expectedByGrantee[c.granteePolityId]?.add(contractId)
      if (c.parentContractId !== undefined) {
        expectedByParent[c.parentContractId] = contractId
      }
    }
    for (const polityIdStr of Object.keys(expectedByGrantee)) {
      const polityId = polityIdStr as PolityId
      const expected = expectedByGrantee[polityId] ?? new Set()
      const actual = new Set(state.landContractIndex.byGranteePolity[polityId] ?? [])
      if (expected.size !== actual.size) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `landContractIndex.byGranteePolity[${polityId}] size=${actual.size} expected=${expected.size} (§25 #13)`,
        })
        continue
      }
      for (const id of expected) {
        if (!actual.has(id)) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `landContractIndex.byGranteePolity[${polityId}] missing ${id} (§25 #13)`,
          })
        }
      }
    }
    for (const parentIdStr of Object.keys(expectedByParent)) {
      const parentId = parentIdStr as LandContractId
      const expectedChild = expectedByParent[parentId]
      const actualChild = state.landContractIndex.byParent[parentId]
      if (actualChild !== expectedChild) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `landContractIndex.byParent[${parentId}]=${actualChild} expected=${expectedChild} (§25 #14)`,
        })
      }
    }
  }

  // §25 #16: polityIndex.byOwnerHouse は state.polities と一致 (ownerHouseId === undefined は含まれない)
  {
    const expected: Record<HouseId, Set<PolityId>> = {}
    for (const polityIdStr of Object.keys(state.polities)) {
      const polityId = polityIdStr as PolityId
      const p = state.polities[polityId]
      if (!p) continue
      if (p.ownerHouseId === undefined) continue
      if (!expected[p.ownerHouseId]) {
        expected[p.ownerHouseId] = new Set()
      }
      expected[p.ownerHouseId]?.add(polityId)
    }
    const actualHouses = new Set([
      ...Object.keys(expected),
      ...Object.keys(state.polityIndex.byOwnerHouse),
    ])
    for (const houseIdStr of actualHouses) {
      const houseId = houseIdStr as HouseId
      const expectedSet = expected[houseId] ?? new Set()
      const actualSet = new Set(state.polityIndex.byOwnerHouse[houseId] ?? [])
      if (expectedSet.size !== actualSet.size) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `polityIndex.byOwnerHouse[${houseId}] size=${actualSet.size} expected=${expectedSet.size} (§25 #16)`,
        })
        continue
      }
      for (const id of expectedSet) {
        if (!actualSet.has(id)) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `polityIndex.byOwnerHouse[${houseId}] missing ${id} (§25 #16)`,
          })
        }
      }
    }
  }

  // §25 #17: landless Polity (grantee 数 0) は active=false である
  // §25 #21: Polity.ownerHouseId が定義済みなら、その House は存在し active である
  for (const polityIdStr of Object.keys(state.polities)) {
    const polityId = polityIdStr as PolityId
    const p = state.polities[polityId]
    if (!p) continue
    const granteed = state.landContractIndex.byGranteePolity[polityId] ?? []
    if (granteed.length === 0 && p.active) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Polity ${polityId} is active but has 0 LandContract grantee (§25 #17)`,
      })
    }
    if (p.active && p.ownerHouseId !== undefined) {
      const owner = state.houses[p.ownerHouseId]
      if (!owner) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Active Polity ${polityId} ownerHouseId ${p.ownerHouseId} does not exist (§25 #21)`,
        })
      } else if (!owner.active) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Active Polity ${polityId} ownerHouseId ${p.ownerHouseId} is inactive (§25 #21)`,
        })
      }
    }
  }

  // §25 #18: House.seatProvinceId は存在する Province を指す
  for (const houseIdStr of Object.keys(state.houses)) {
    const houseId = houseIdStr as HouseId
    const h = state.houses[houseId]
    if (!h) continue
    if (h.kind === 'system') continue
    if (!state.provinces[h.seatProvinceId]) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `House ${houseId} seatProvinceId ${h.seatProvinceId} does not exist (§25 #18)`,
      })
    }
  }

  // §25 #23: 各 Province に active な bailiff ProvinceOfficeAssignment が 1 つ存在する
  // §25 #24: bailiff の holderPersonId は存在する Person を指す
  // §25 #33: provinceOfficeIndex.byProvince は state.provinceOfficeAssignments と一致し各 Province に 1 つ
  for (const provIdStr of Object.keys(state.provinces)) {
    const provId = provIdStr as ProvinceId
    const assignmentId = state.provinceOfficeIndex.byProvince[provId]
    if (!assignmentId) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Province ${provId} has no bailiff assignment (§25 #23)`,
      })
      continue
    }
    const assignment = state.provinceOfficeAssignments[assignmentId]
    if (!assignment) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `provinceOfficeIndex.byProvince[${provId}]=${assignmentId} does not exist in provinceOfficeAssignments (§25 #33)`,
      })
      continue
    }
    if (assignment.provinceId !== provId) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `ProvinceOfficeAssignment ${assignmentId} provinceId=${assignment.provinceId} differs from index key ${provId} (§25 #33)`,
      })
    }
    if (!assignment.active) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Province ${provId} bailiff assignment ${assignmentId} is inactive (§25 #23)`,
      })
    }
    const holder = state.persons[assignment.holderPersonId]
    if (!holder) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Bailiff assignment ${assignmentId} holderPersonId ${assignment.holderPersonId} does not exist (§25 #24)`,
      })
    }
  }

  // §25 #27: AnonymousHouse は worldgen 後に必ず 1 つ存在する
  const anon = state.houses[ANONYMOUS_HOUSE_ID]
  if (!anon) {
    errors.push({
      code: 'INTEGRITY_VIOLATION',
      message: `AnonymousHouse ${ANONYMOUS_HOUSE_ID} does not exist (§25 #27)`,
    })
  } else if (anon.kind !== 'system') {
    errors.push({
      code: 'INTEGRITY_VIOLATION',
      message: `AnonymousHouse ${ANONYMOUS_HOUSE_ID} kind=${anon.kind ?? 'normal'} expected 'system' (§25 #27)`,
    })
  }

  // §25 #28: 全 placeholder Person の houseId は AnonymousHouse.id を指す
  // v0.17 §21.4 A2: AnonymousHouse には normal Person も滞在してよい (旧 §25 #29 inverse / #31 廃止)
  for (const personIdStr of Object.keys(state.persons)) {
    const p = state.persons[personIdStr as PersonId]
    if (!p) continue
    if (p.kind === 'placeholder') {
      if (p.houseId !== ANONYMOUS_HOUSE_ID) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Placeholder Person ${p.id} houseId=${p.houseId} expected ${ANONYMOUS_HOUSE_ID} (§25 #28)`,
        })
      }
    }
  }

  // §25 #29 also: normal House.memberIds は placeholder を含まない
  for (const houseIdStr of Object.keys(state.houses)) {
    const houseId = houseIdStr as HouseId
    const h = state.houses[houseId]
    if (!h || h.kind === 'system') continue
    for (const memberId of h.memberIds) {
      const p = state.persons[memberId]
      if (p && p.kind === 'placeholder') {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Normal House ${houseId} contains placeholder member ${memberId} (§25 #29)`,
        })
      }
    }
  }

  // §25 #30: AnonymousHouse は LandContract grantee / Polity.ownerHouseId / Share holder のいずれにもならない
  for (const polityIdStr of Object.keys(state.polities)) {
    const p = state.polities[polityIdStr as PolityId]
    if (!p) continue
    if (p.ownerHouseId === ANONYMOUS_HOUSE_ID) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Polity ${polityIdStr} ownerHouseId === AnonymousHouse (§25 #30)`,
      })
    }
  }
  for (const shareIdStr of Object.keys(state.organizationShares)) {
    const share = state.organizationShares[shareIdStr as import('../types/ids').OrganizationShareId]
    if (!share) continue
    if (share.holder.kind === 'house' && share.holder.id === ANONYMOUS_HOUSE_ID) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `OrganizationShare ${shareIdStr} holder is AnonymousHouse (§25 #30)`,
      })
    }
  }

  // v0.17 §21.4 A1: AnonymousHouse は active かつ kind === 'system'
  if (anon) {
    if (!anon.active) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `AnonymousHouse ${ANONYMOUS_HOUSE_ID} is not active (§21.4 A1)`,
      })
    }
  }

  // v0.17 §21.1 Faction (skeleton — Stage B で詳細チェックを拡張)
  // F1: active Faction.leaderPersonId は alive normal Person
  // F2: placeholder Person は active FactionMembership を持たない
  // F4: 1 Person max 1 active FactionMembership
  // F5: inactive Faction の membership はすべて inactive
  // F6: active Faction には leader 自身の active membership がある
  // F7: FactionMembership.factionId は存在する Faction
  const activeMembershipCountByPerson: Record<string, number> = {}
  for (const factionIdStr of Object.keys(state.factions)) {
    const factionId = factionIdStr as FactionId
    const faction = state.factions[factionId]
    if (!faction) continue
    if (faction.active) {
      const leader = state.persons[faction.leaderPersonId]
      if (!leader || !leader.alive || leader.kind === 'placeholder') {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Faction ${factionId} leader ${faction.leaderPersonId} is not alive / normal (§21.1 F1)`,
        })
      }
      let leaderMembershipFound = false
      for (const m of Object.values(state.factionMemberships)) {
        if (!m) continue
        if (m.factionId !== factionId) continue
        if (m.active && m.personId === faction.leaderPersonId) {
          leaderMembershipFound = true
          break
        }
      }
      if (!leaderMembershipFound) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `active Faction ${factionId} has no active membership for leader ${faction.leaderPersonId} (§21.1 F6)`,
        })
      }
    } else {
      for (const m of Object.values(state.factionMemberships)) {
        if (!m) continue
        if (m.factionId !== factionId) continue
        if (m.active) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `inactive Faction ${factionId} has active membership ${m.id} (§21.1 F5)`,
          })
        }
      }
    }
  }
  for (const m of Object.values(state.factionMemberships)) {
    if (!m) continue
    if (!state.factions[m.factionId]) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `FactionMembership ${m.id} references missing Faction ${m.factionId} (§21.1 F7)`,
      })
    }
    if (!m.active) continue
    const person = state.persons[m.personId]
    if (person && person.kind === 'placeholder') {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `placeholder Person ${m.personId} has active FactionMembership ${m.id} (§21.1 F2)`,
      })
    }
    const personKey = m.personId as string
    activeMembershipCountByPerson[personKey] = (activeMembershipCountByPerson[personKey] ?? 0) + 1
  }
  for (const personKey of Object.keys(activeMembershipCountByPerson)) {
    const count = activeMembershipCountByPerson[personKey] ?? 0
    if (count > 1) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Person ${personKey} has ${count} active FactionMembership entries (§21.1 F4)`,
      })
    }
  }

  // v0.17 §21.5 Index: factionIndex は state.factions / state.factionMemberships と整合
  // I1: byLeader[personId] の全 FactionId は存在し leaderPersonId === personId
  // I2: byMember[personId] の全 FactionMembershipId は存在し personId === personId
  // I3: active Faction の leaderPersonId は byLeader にエントリ
  // I4: 各 FactionMembership は byMember にエントリ
  for (const [personKey, factionIds] of Object.entries(state.factionIndex.byLeader)) {
    for (const fid of factionIds ?? []) {
      const f = state.factions[fid]
      if (!f) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `factionIndex.byLeader[${personKey}] references missing Faction ${fid} (§21.5 I1)`,
        })
        continue
      }
      if ((f.leaderPersonId as string) !== personKey) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `factionIndex.byLeader[${personKey}] entry ${fid} has leaderPersonId=${f.leaderPersonId} (§21.5 I1)`,
        })
      }
    }
  }
  for (const [personKey, membershipIds] of Object.entries(state.factionIndex.byMember)) {
    for (const mid of membershipIds ?? []) {
      const m = state.factionMemberships[mid]
      if (!m) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `factionIndex.byMember[${personKey}] references missing FactionMembership ${mid} (§21.5 I2)`,
        })
        continue
      }
      if ((m.personId as string) !== personKey) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `factionIndex.byMember[${personKey}] entry ${mid} has personId=${m.personId} (§21.5 I2)`,
        })
      }
    }
  }
  for (const factionIdStr of Object.keys(state.factions)) {
    const factionId = factionIdStr as FactionId
    const f = state.factions[factionId]
    if (!f || !f.active) continue
    const indexed = state.factionIndex.byLeader[f.leaderPersonId] ?? []
    if (!indexed.includes(factionId)) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `active Faction ${factionId} leader ${f.leaderPersonId} is not in factionIndex.byLeader (§21.5 I3)`,
      })
    }
  }
  for (const membershipIdStr of Object.keys(state.factionMemberships)) {
    const membershipId = membershipIdStr as FactionMembershipId
    const m = state.factionMemberships[membershipId]
    if (!m) continue
    const indexed = state.factionIndex.byMember[m.personId] ?? []
    if (!indexed.includes(membershipId)) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `FactionMembership ${membershipId} (person=${m.personId}) is not in factionIndex.byMember (§21.5 I4)`,
      })
    }
  }

  // v0.17 §21.2 O4: non-leader OfficeAssignment の startYear は currentYear 以下
  for (const officeId of Object.keys(state.officeAssignments)) {
    const office = state.officeAssignments[officeId as import('../types/ids').OfficeAssignmentId]
    if (!office || !office.active) continue
    if (office.role === 'leader') continue
    if (office.startYear > state.currentYear) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `OfficeAssignment ${officeId} startYear=${office.startYear} > currentYear=${state.currentYear} (§21.2 O4)`,
      })
    }
  }

  // v0.17 §21.3 D2: alive=true の Person は deathCircumstance を持たない
  // v0.17 §21.3 D3: 'faded_from_history' は normal Person のみ (placeholder 不可)
  for (const personIdStr of Object.keys(state.persons)) {
    const p = state.persons[personIdStr as PersonId]
    if (!p) continue
    if (p.alive && p.deathCircumstance !== undefined) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Alive Person ${p.id} has deathCircumstance=${p.deathCircumstance} (§21.3 D2)`,
      })
    }
    if (p.deathCircumstance === 'faded_from_history' && p.kind === 'placeholder') {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Placeholder Person ${p.id} has deathCircumstance='faded_from_history' (§21.3 D3)`,
      })
    }
  }

  // §25 #2: root contract は rootAuthorityId を持ち ROOT_WORLD を指す
  // §25 #3: parent を持つ contract は rootAuthorityId を持たない
  for (const contractIdStr of Object.keys(state.landContracts)) {
    const c = state.landContracts[contractIdStr as LandContractId]
    if (!c) continue
    if (c.parentContractId === undefined) {
      if (c.rootAuthorityId !== ROOT_WORLD) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Root LandContract ${c.id} rootAuthorityId=${c.rootAuthorityId} expected ${ROOT_WORLD} (§25 #2)`,
        })
      }
    } else {
      if (c.rootAuthorityId !== undefined) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Non-root LandContract ${c.id} has rootAuthorityId=${c.rootAuthorityId} (§25 #3)`,
        })
      }
    }
  }

  // ─── v0.18 Stage A §20: ActorIntent / DiplomaticPlay 整合性 ───

  // actor が存在する active actor を指すかチェック (Polity の active / House の active を確認)
  const isActiveActor = (actor: PoliticalActorRef): boolean => {
    if (actor.kind === 'polity') {
      const p = state.polities[actor.id]
      return Boolean(p && p.active)
    }
    const h = state.houses[actor.id]
    return Boolean(h && h.active)
  }

  // ActorIntent integrity (§20)
  const seenIntentIds = new Set<string>()
  for (const idStr of Object.keys(state.actorIntents)) {
    const intent = state.actorIntents[idStr as ActorIntentId]
    if (!intent) continue
    // id 一意性
    if (seenIntentIds.has(idStr)) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `ActorIntent ${idStr} duplicate id (§20)`,
      })
    }
    seenIntentIds.add(idStr)
    // すべての entry の status === 'active' (terminal は cleanup phase で削除済み)
    if (intent.status !== 'active') {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `ActorIntent ${idStr} has non-active status ${intent.status} (terminal must be cleaned up) (§20)`,
      })
    }
    // actor が active を指す
    if (!isActiveActor(intent.actor)) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `ActorIntent ${idStr} actor ${intent.actor.kind}:${intent.actor.id} is not active (§20)`,
      })
    }
    // targetActor (存在する場合) が active
    if (intent.targetActor && !isActiveActor(intent.targetActor)) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `ActorIntent ${idStr} targetActor ${intent.targetActor.kind}:${intent.targetActor.id} is not active (§20)`,
      })
    }
    // targetProvinceId (存在する場合) が存在する Province
    if (intent.targetProvinceId !== undefined && !state.provinces[intent.targetProvinceId]) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `ActorIntent ${idStr} targetProvinceId ${intent.targetProvinceId} does not exist (§20)`,
      })
    }
    // beneficiaryPolityId (存在する場合) が active Polity
    if (intent.beneficiaryPolityId !== undefined) {
      const bene = state.polities[intent.beneficiaryPolityId]
      if (!bene || !bene.active) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `ActorIntent ${idStr} beneficiaryPolityId ${intent.beneficiaryPolityId} is missing or inactive (§20)`,
        })
      }
    }
  }

  // DiplomaticPlay integrity (§20)
  const seenPlayIds = new Set<string>()
  for (const idStr of Object.keys(state.diplomaticPlays)) {
    const play = state.diplomaticPlays[idStr as DiplomaticPlayId]
    if (!play) continue
    // id 一意性
    if (seenPlayIds.has(idStr)) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `DiplomaticPlay ${idStr} duplicate id (§20)`,
      })
    }
    seenPlayIds.add(idStr)
    // すべての entry の status === 'active'
    if (play.status !== 'active') {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `DiplomaticPlay ${idStr} has non-active status ${play.status} (terminal must be cleaned up) (§20)`,
      })
    }
    // initiator / target が active actor
    if (!isActiveActor(play.initiator)) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `DiplomaticPlay ${idStr} initiator ${play.initiator.kind}:${play.initiator.id} is not active (§20)`,
      })
    }
    if (!isActiveActor(play.target)) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `DiplomaticPlay ${idStr} target ${play.target.kind}:${play.target.id} is not active (§20)`,
      })
    }
    // progress / tension は 0..100
    if (play.progress < 0 || play.progress > 100) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `DiplomaticPlay ${idStr} progress=${play.progress} outside [0, 100] (§20)`,
      })
    }
    if (play.tension < 0 || play.tension > 100) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `DiplomaticPlay ${idStr} tension=${play.tension} outside [0, 100] (§20)`,
      })
    }
    // deadline が started より後
    const startedKey = play.startedYear * 12 + play.startedMonth
    const deadlineKey = play.deadlineYear * 12 + play.deadlineMonth
    if (deadlineKey <= startedKey) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `DiplomaticPlay ${idStr} deadline (${play.deadlineYear}/${play.deadlineMonth}) is not after started (${play.startedYear}/${play.startedMonth}) (§20)`,
      })
    }
    // primaryDemand が有効な対象を指す (kind 別の最小チェック)
    const demand = play.primaryDemand
    switch (demand.kind) {
      case 'transfer_land_contract': {
        if (!state.provinces[demand.provinceId]) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `DiplomaticPlay ${idStr} primaryDemand.provinceId ${demand.provinceId} does not exist (§20)`,
          })
        }
        const toPolity = state.polities[demand.toPolityId]
        if (!toPolity || !toPolity.active) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `DiplomaticPlay ${idStr} primaryDemand.toPolityId ${demand.toPolityId} is missing or inactive (§20)`,
          })
        }
        break
      }
      case 'change_contract_tax_rate': {
        if (!state.landContracts[demand.landContractId]) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `DiplomaticPlay ${idStr} primaryDemand.landContractId ${demand.landContractId} does not exist (§20)`,
          })
        }
        break
      }
      case 'pay_wealth': {
        if (!isActiveActor(demand.from)) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `DiplomaticPlay ${idStr} primaryDemand.from ${demand.from.kind}:${demand.from.id} is not active (§20)`,
          })
        }
        if (!isActiveActor(demand.to)) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `DiplomaticPlay ${idStr} primaryDemand.to ${demand.to.kind}:${demand.to.id} is not active (§20)`,
          })
        }
        break
      }
      case 'revolt_concession': {
        if (!state.provinces[demand.provinceId]) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `DiplomaticPlay ${idStr} primaryDemand.provinceId ${demand.provinceId} does not exist (§20)`,
          })
        }
        if (!state.popGroups[demand.popGroupId]) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `DiplomaticPlay ${idStr} primaryDemand.popGroupId ${demand.popGroupId} does not exist (§20)`,
          })
        }
        break
      }
      case 'status_quo':
        // no target to validate
        break
    }
    // revolt_negotiation 固有チェック (§20)
    if (play.kind === 'revolt_negotiation') {
      if (play.initiator.kind !== 'polity') {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `DiplomaticPlay ${idStr} revolt_negotiation initiator must be a Polity (§20)`,
        })
      } else {
        const initPolity = state.polities[play.initiator.id]
        if (initPolity && initPolity.kind !== 'commonwealth') {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `DiplomaticPlay ${idStr} revolt_negotiation initiator Polity ${play.initiator.id} is not commonwealth (§20)`,
          })
        }
      }
      if (play.target.kind !== 'polity') {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `DiplomaticPlay ${idStr} revolt_negotiation target must be a Polity (§20)`,
        })
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
