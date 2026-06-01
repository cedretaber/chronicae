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
  DiplomaticPlayId,
  WarId,
  StateRegionId,
  HoldingId,
  HoldingOfficeAssignmentId,
  HoldingImprovementId,
  ClanId,
  RegimentId,
  BattleId,
  ChronicleEntryId,
} from '../types/ids'
import type { OrganizationKind, OfficeRole } from '../types/office'
import { getHouseLeader } from '../selectors/officeSelectors'
import { OFFICE_DEFINITIONS } from '../config/officeDefinitions'
import { ABILITY_KEYS, ABILITY_HARD_CAP } from '../constants/abilityConstants'
import { getHouseProvinceIdsByPolity } from '../selectors/polityRelations'
import { ROOT_WORLD } from '../types/landContract'
import { getGrantorRank, getLandContractGrantor } from '../selectors/landContractSelectors'
import { politicalActorKey } from '../selectors/actorSelectors'
import type { SimError } from '../mutations/errors'
import type { WorldState } from '../types/world'
import type { PoliticalActorRef } from '../types/actor'
import { WEEKS_PER_YEAR } from '../utils/timeUtils'
import type { SimulationConfig } from '../config/defaultConfig'
import { isPlaceholderPerson } from '../selectors/landContractSelectors'
import { decisionSubjectKey } from '../types/goal'
import {
  getBailiffLocalExtractionRate,
  getBailiffCollectionEfficiency,
  getBailiffFeeRate,
  computeBailiffBurdenComponents,
  getRecentBailiffRevenueTaskStatus,
} from '../selectors/bailiffSelectors'
import { targetRefKey } from '../types/task'
import { IMPROVEMENT_DEFINITIONS } from '../config/improvementDefinitions'
import { getHoldingOccupationCapacity } from '../selectors/popSelectors'
import type { HoldingImprovementKind } from '../types/holdingImprovement'

const VALID_ABILITY_KEYS: ReadonlySet<string> = new Set(ABILITY_KEYS)

// v0.33 §5.3: IMPROVEMENT_DEFINITIONS のキーから導出し二重管理を解消
const VALID_HOLDING_IMPROVEMENT_KINDS: ReadonlySet<string> = new Set(
  Object.keys(IMPROVEMENT_DEFINITIONS),
)

// v0.33 §13.1: Province terrain / features の妥当性検証
const VALID_PROVINCE_TERRAINS: ReadonlySet<string> = new Set([
  'plains',
  'forest',
  'hills',
  'mountains',
  'wetlands',
])

const VALID_PROVINCE_FEATURES: ReadonlySet<string> = new Set(['coastal', 'major_river', 'lake'])

import { PROJECT_STAGE_SEQUENCES, getProjectStageType } from '../config/projectStageSequences'
import { isDiplomaticProjectKind } from '../mutations/projectMutations'
import type {
  LandClaimProject,
  ContractRevisionProject,
  RespondToPressureProject,
} from '../types/project'

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
//   #15 holdingTerminalPolityCache 同期                  → 「§25 #15: holdingTerminalPolityCache は chain の terminal grantee と一致」で error throw
//   #16 polityIndex.byOwnerHouse 同期                    → 「§25 #16: polityIndex.byOwnerHouse は state.polities と一致」で error throw
//   #17 landless Polity == inactive                      → 「§25 #17: landless Polity は active=false である」で error throw
//   #18 house.seatProvinceId 存在                        → 「§25 #18: House.seatProvinceId は存在する Province」で error throw
//   #19 polity.capitalProvinceId 存在                    → 直前ブロックで error throw
//   #20 House active 判定が memberIds ベース             → コードレベル保証 (houseExtinctionSystem は memberIds 判定のみ)。runtime チェック不要
//   #21 ownerHouseId active                              → 「§25 #21: Polity.ownerHouseId が定義済みなら、その House は存在し active」で error throw
//   #22 Province.houseControl 型から削除                 → 型レベル保証。runtime チェック不要
//   #23 各 Province に active bailiff 1 つ                → HoldingOffice に移行 (H1, H2, H3)
//   #24 bailiff holder 存在                              → HoldingOffice に移行 (H1, H2, H3)
//   #25 placeholder ガード sweep                         → 「全 Person-loop に kind === 'placeholder' continue」のコードレビューで担保。runtime チェック困難 (システム毎の動的検証は意味がない)
//   #26 placeholder は kind === 'placeholder' で判定     → コードレベル保証 (isPlaceholderPerson selector 経由)。runtime チェック不要
//   #27 AnonymousHouse 存在                              → 「§25 #27: AnonymousHouse は worldgen 後に必ず 1 つ存在」で error throw
//   #28 placeholder Person.houseId = AnonymousHouse.id   → 「§25 #28: 全 placeholder Person の houseId は AnonymousHouse」で error throw
//   #29 normal House.memberIds に placeholder 無し       → 「§25 #29 inverse: Non-placeholder Person が AnonymousHouse」と「Normal House に placeholder member」の双方で error throw
//   #30 AnonymousHouse が grantee / ownerHouse / share holder にならない → 「§25 #30」ブロックで error throw
//   #31 AnonymousHouse.memberIds 全員 placeholder         → 「§25 #31: AnonymousHouse contains non-placeholder member」で error throw
//   #32 HoldingOfficeAssignment は OfficeAssignment と別 entity → 型レベル保証 (OrganizationKind に 'holding' は含まれない)。runtime チェック不要
//   #33 holdingOfficeIndex.byHolding 同期                 → 「§25 H1: holdingOfficeIndex.byHolding[X] entry」で error throw
//
// 実装すべき 33 項目のうち error throw: 25 項目
// 型レベル保証 (runtime 不要): #10, #20, #22, #26, #32 = 5 項目
// コードレビューで担保 (runtime 困難): #25 = 1 項目
// (warn → error 昇格 済み: #19)
export function collectIntegrityErrors(
  state: WorldState,
  options?: { debug?: boolean; config?: SimulationConfig },
): SimError[] {
  const debug = options?.debug ?? false
  const config = options?.config
  const errors: SimError[] = []

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
    // Phase D §13.4: house share holder person must belong to that house
    if (share.organization.kind === 'house' && share.holder.kind === 'person') {
      const holderPerson = state.persons[share.holder.id]
      if (holderPerson && holderPerson.alive && holderPerson.houseId !== share.organization.id) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `OrganizationShare ${shareId} holder Person ${share.holder.id} has houseId=${holderPerson.houseId ?? 'undefined'} but share org is house:${share.organization.id}`,
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
      if (debug) {
        console.warn(
          `INTEGRITY (Stage B warn): OrganizationShare ${shareId} holder House ${share.holder.id} owns no Province in Polity ${share.organization.id}`,
        )
      }
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

  // ─── v0.16 §25 LandContract / AnonymousHouse / HoldingOffice 不変条件 ───

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

  // §25 #1: 各 Holding の byHolding chain 先頭が root contract (parentContractId === undefined)
  // §25 #4: chain 上の child contract は最大 1 つ (枝分かれしない)
  {
    for (const holdingIdStr of Object.keys(state.holdings)) {
      const holdingChain = state.landContractIndex.byHolding[holdingIdStr as HoldingId] ?? []
      if (holdingChain.length === 0) continue
      const rootContract = state.landContracts[holdingChain[0]!]
      if (rootContract && rootContract.parentContractId !== undefined) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Holding ${holdingIdStr} chain root ${holdingChain[0]} has parentContractId (not a true root) (§25 #1)`,
        })
      }
    }
    const childCount: Record<LandContractId, number> = {}
    for (const contractIdStr of Object.keys(state.landContracts)) {
      const contract = state.landContracts[contractIdStr as LandContractId]
      if (!contract) continue
      if (contract.parentContractId !== undefined) {
        childCount[contract.parentContractId] = (childCount[contract.parentContractId] ?? 0) + 1
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

  // v0.33 §13.1: 各 Province の terrain は有効値、features は有効値の重複なし配列
  for (const [provIdStr, prov] of Object.entries(state.provinces)) {
    if (!prov) continue
    if (!VALID_PROVINCE_TERRAINS.has(prov.terrain)) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Province ${provIdStr} has invalid terrain ${prov.terrain} (v0.33 §13.1)`,
      })
    }
    if (!Array.isArray(prov.features)) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Province ${provIdStr} features is not an array (v0.33 §13.1)`,
      })
    } else {
      const seen = new Set<string>()
      for (const f of prov.features) {
        if (!VALID_PROVINCE_FEATURES.has(f)) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `Province ${provIdStr} has invalid feature ${f} (v0.33 §13.1)`,
          })
        }
        if (seen.has(f)) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `Province ${provIdStr} has duplicate feature ${f} (v0.33 §13.1)`,
          })
        }
        seen.add(f)
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
    for (const id of chain) {
      const c = state.landContracts[id]
      if (!c) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `landContractIndex.byProvince[${provId}] references missing contract ${id} (§25 #12)`,
        })
        break
      }
      if (c.provinceId !== provId) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `landContractIndex.byProvince[${provId}] contains contract ${id} with mismatched provinceId ${c.provinceId} (§25 #12)`,
        })
        break
      }
      if (prev === undefined) {
        if (c.parentContractId !== undefined) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `landContractIndex.byProvince[${provId}] first element ${id} has parent (expected root) (§25 #12)`,
          })
          break
        }
      } else {
        if (c.parentContractId !== prev) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `landContractIndex.byProvince[${provId}] entry ${id} parent=${c.parentContractId} expected ${prev} (§25 #12 chain order)`,
          })
          break
        }
      }
      prev = id
    }
  }

  // §25 #15: holdingTerminalPolityCache は各 Holding の byHolding chain terminal grantee と一致
  for (const holdingIdStr of Object.keys(state.holdings)) {
    const hid = holdingIdStr as HoldingId
    const holdingChain = state.landContractIndex.byHolding[hid] ?? []
    if (holdingChain.length === 0) continue
    const terminalId = holdingChain[holdingChain.length - 1]!
    const terminal = state.landContracts[terminalId]
    if (!terminal) continue
    const cached = state.holdingTerminalPolityCache[hid]
    if (cached !== terminal.granteePolityId) {
      const holding = state.holdings[hid]
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `holdingTerminalPolityCache[${hid}]=${cached} differs from byHolding chain terminal grantee ${terminal.granteePolityId} for province ${holding?.provinceId} (§25 #15)`,
      })
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
      if (!(p.kind === 'commonwealth' && p.revoltState != null)) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Polity ${polityId} is active but has 0 LandContract grantee (§25 #17)`,
        })
      }
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
    if (p.revoltState != null) {
      if (p.kind !== 'commonwealth') {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Polity ${polityId} has revoltState but kind=${p.kind ?? 'undefined'} (v0.39 §17.2)`,
        })
      }
      if (p.revoltState.kind === 'established' && !p.active) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Polity ${polityId} established commonwealth must be active (v0.39 §17.2)`,
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

  // v0.31.1: livingPersonIds ↔ persons 整合性チェック
  const expectedLiving = (Object.keys(state.persons) as PersonId[])
    .filter((id) => state.persons[id]?.alive)
    .sort()
  const actualLiving = state.livingPersonIds
  if (expectedLiving.length !== actualLiving.length) {
    errors.push({
      code: 'INTEGRITY_VIOLATION',
      message: `livingPersonIds count mismatch: expected ${expectedLiving.length}, got ${actualLiving.length}`,
    })
  } else {
    for (let i = 0; i < expectedLiving.length; i++) {
      if (expectedLiving[i] !== actualLiving[i]) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `livingPersonIds[${i}] mismatch: expected ${expectedLiving[i]}, got ${actualLiving[i]}`,
        })
        break
      }
    }
  }

  // v0.31 §16.2: placeholder は houseId を持たない
  for (const personIdStr of Object.keys(state.persons)) {
    const p = state.persons[personIdStr as PersonId]
    if (!p) continue
    if (p.kind === 'placeholder' && p.houseId !== undefined) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Placeholder Person ${p.id} has houseId=${p.houseId}, expected undefined`,
      })
    }
  }

  // v0.31 §16.2: placeholder は House.memberIds に含まれてはならない
  for (const houseIdStr of Object.keys(state.houses)) {
    const houseId = houseIdStr as HouseId
    const h = state.houses[houseId]
    if (!h) continue
    for (const memberId of h.memberIds) {
      const p = state.persons[memberId]
      if (p && p.kind === 'placeholder') {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `House ${houseId} contains placeholder member ${memberId}`,
        })
      }
    }
  }

  // v0.31 §16.2: person.houseId ↔ House.memberIds 双方向整合 (alive person のみ)
  for (const personIdStr of Object.keys(state.persons)) {
    const p = state.persons[personIdStr as PersonId]
    if (!p || !p.alive) continue
    if (p.houseId) {
      const h = state.houses[p.houseId]
      if (h && !h.memberIds.includes(p.id)) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Person ${p.id} has houseId=${p.houseId} but is not in House.memberIds`,
        })
      }
    }
  }
  for (const houseIdStr of Object.keys(state.houses)) {
    const houseId = houseIdStr as HouseId
    const h = state.houses[houseId]
    if (!h) continue
    for (const memberId of h.memberIds) {
      const p = state.persons[memberId]
      if (p && p.houseId !== houseId) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `House ${houseId} memberIds contains ${memberId} but person.houseId=${p.houseId ?? 'undefined'}`,
        })
      }
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

  // v0.32 §17: Clan 整合性チェック
  // C1: House.clanId → Clan 存在 + memberHouseIds に含まれる
  for (const houseIdStr of Object.keys(state.houses)) {
    const houseId = houseIdStr as HouseId
    const h = state.houses[houseId]
    if (!h) continue
    if (h.clanId !== undefined) {
      const clan = state.clans[h.clanId]
      if (!clan) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `House ${houseId} has clanId=${h.clanId as string} but Clan not found (§17 C1)`,
        })
      } else if (!clan.memberHouseIds.includes(houseId)) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `House ${houseId} has clanId=${h.clanId as string} but not in Clan.memberHouseIds (§17 C1)`,
        })
      }
      // C7: system House は clanId を持ってはならない
      if (h.kind === 'system') {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `System House ${houseId} has clanId=${h.clanId as string} (§17 C7)`,
        })
      }
    }
  }
  // C2: Clan.memberHouseIds → House 存在 + house.clanId === clan.id
  for (const clanIdStr of Object.keys(state.clans)) {
    const clanId = clanIdStr as ClanId
    const clan = state.clans[clanId]
    if (!clan) continue
    for (const memberHouseId of clan.memberHouseIds) {
      const h = state.houses[memberHouseId]
      if (!h) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Clan ${clanId as string} memberHouseIds contains ${memberHouseId as string} but House not found (§17 C2)`,
        })
      } else if (h.clanId !== clanId) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Clan ${clanId as string} memberHouseIds contains ${memberHouseId as string} but house.clanId=${h.clanId as string | undefined} (§17 C2)`,
        })
      }
    }
    // C3: rootHouseId 存在 + memberHouseIds に含まれる
    if (!state.houses[clan.rootHouseId]) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Clan ${clanId as string} rootHouseId=${clan.rootHouseId as string} not found (§17 C3)`,
      })
    } else if (!clan.memberHouseIds.includes(clan.rootHouseId)) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Clan ${clanId as string} rootHouseId=${clan.rootHouseId as string} not in memberHouseIds (§17 C3)`,
      })
    }
    // C4: nameSourceHouseId 存在 + v0.32 では === rootHouseId
    if (!state.houses[clan.nameSourceHouseId]) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Clan ${clanId as string} nameSourceHouseId=${clan.nameSourceHouseId as string} not found (§17 C4)`,
      })
    }
    if (clan.nameSourceHouseId !== clan.rootHouseId) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Clan ${clanId as string} nameSourceHouseId=${clan.nameSourceHouseId as string} !== rootHouseId=${clan.rootHouseId as string} (§17 C4)`,
      })
    }
    // C5: memberHouseIds に重複がない
    const memberSet = new Set(clan.memberHouseIds.map((id) => id as string))
    if (memberSet.size !== clan.memberHouseIds.length) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Clan ${clanId as string} memberHouseIds has duplicates (§17 C5)`,
      })
    }
  }
  // C6: clanId を持つ House の normal cadet は同じ clanId を持つべき
  for (const houseIdStr of Object.keys(state.houses)) {
    const houseId = houseIdStr as HouseId
    const h = state.houses[houseId]
    if (!h || h.clanId === undefined || h.kind === 'system') continue
    for (const cadetId of h.cadetHouseIds) {
      const cadet = state.houses[cadetId]
      if (!cadet || cadet.kind === 'system') continue
      if (cadet.clanId !== h.clanId) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `House ${houseId} clanId=${h.clanId as string} but cadet ${cadetId as string} has clanId=${cadet.clanId === undefined ? 'undefined' : (cadet.clanId as string)} (§17 C6)`,
        })
      }
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

  // ─── §20: DiplomaticPlay 整合性 ───

  // actor が存在する active actor を指すかチェック (Polity の active / House の active を確認)
  const isActiveActor = (actor: PoliticalActorRef): boolean => {
    if (actor.kind === 'polity') {
      const p = state.polities[actor.id]
      return Boolean(p && p.active)
    }
    const h = state.houses[actor.id]
    return Boolean(h && h.active)
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
    // すべての entry は active or escalated (terminal は tick 末で削除される前提)
    // v0.18 Stage D: 'escalated' は ConflictResolutionSystem が同 tick 内で
    // 'resolved_by_conflict' に置換するが、maxConflictsResolvedPerTick 上限で
    // 持ち越される場合がある (非 terminal なので OK)。
    if (play.status !== 'active' && play.status !== 'escalated') {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `DiplomaticPlay ${idStr} has terminal status ${play.status} (must be cleaned up) (§20)`,
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
    if (play.deadlineWeek <= play.startedWeek) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `DiplomaticPlay ${idStr} deadlineWeek=${play.deadlineWeek} is not after startedWeek=${play.startedWeek} (§20)`,
      })
    }
    // v0.30: issue 存在・整合性チェック
    if (play.kind !== 'revolt_negotiation') {
      if (!play.issue) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `DiplomaticPlay ${idStr} (kind=${play.kind}) must have issue (§17)`,
        })
      } else if (play.issue.kind !== play.kind) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `DiplomaticPlay ${idStr} issue.kind=${play.issue.kind} does not match play.kind=${play.kind} (§17)`,
        })
      }
    }
    // v0.30: issue anchor 検証
    if (play.issue?.kind === 'land_claim') {
      if (!state.holdings[play.issue.holdingId]) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `DiplomaticPlay ${idStr} issue.holdingId ${play.issue.holdingId} does not exist (§17)`,
        })
      }
      if (!state.provinces[play.issue.provinceId]) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `DiplomaticPlay ${idStr} issue.provinceId ${play.issue.provinceId} does not exist (§17)`,
        })
      }
    }
    if (play.issue?.kind === 'contract_tax_revision') {
      if (!state.holdings[play.issue.holdingId]) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `DiplomaticPlay ${idStr} issue.holdingId ${play.issue.holdingId} does not exist (§17)`,
        })
      }
      if (!state.landContracts[play.issue.landContractId]) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `DiplomaticPlay ${idStr} issue.landContractId ${play.issue.landContractId} does not exist (§17)`,
        })
      }
    }
    // v0.30: offer 整合性チェック
    if (play.currentOfferId) {
      const offer = state.diplomaticOffers[play.currentOfferId]
      if (!offer) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `DiplomaticPlay ${idStr} currentOfferId ${play.currentOfferId as string} references missing offer (§17)`,
        })
      } else if (offer.playId !== play.id) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `DiplomaticPlay ${idStr} currentOfferId offer.playId=${offer.playId} mismatch (§17)`,
        })
      }
    }
    for (const offerId of play.offerHistoryIds) {
      const offer = state.diplomaticOffers[offerId]
      if (!offer) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `DiplomaticPlay ${idStr} offerHistoryIds references missing offer ${offerId as string} (§17)`,
        })
      } else if (offer.playId !== play.id) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `DiplomaticPlay ${idStr} offerHistoryIds offer ${offerId as string} playId=${offer.playId} mismatch (§17)`,
        })
      }
    }
    if (play.lastEvaluatedOfferId) {
      const inHistory = play.offerHistoryIds.includes(play.lastEvaluatedOfferId)
      const isCurrent = play.lastEvaluatedOfferId === play.currentOfferId
      if (!inHistory && !isCurrent) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `DiplomaticPlay ${idStr} lastEvaluatedOfferId ${play.lastEvaluatedOfferId as string} not in offerHistoryIds or currentOfferId (§17)`,
        })
      }
    }
    // accepted offer should not remain on active play (settlement should have fired)
    if (play.status === 'active' || play.status === 'escalated') {
      const allOfferIds = play.currentOfferId
        ? [...play.offerHistoryIds, play.currentOfferId]
        : play.offerHistoryIds
      for (const offerId of allOfferIds) {
        const offer = state.diplomaticOffers[offerId]
        if (offer?.status === 'accepted') {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `DiplomaticPlay ${idStr} has accepted offer ${offerId as string} but is still ${play.status} (§17)`,
          })
        }
      }
    }
    // primaryDemand: revolt_negotiation のみ存在必須、非 revolt には不要
    if (play.kind !== 'revolt_negotiation' && play.primaryDemand) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `DiplomaticPlay ${idStr} (kind=${play.kind}) should not have primaryDemand (§17)`,
      })
    }
    if (play.kind === 'revolt_negotiation') {
      if (!play.primaryDemand) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `DiplomaticPlay ${idStr} revolt_negotiation must have primaryDemand (§20)`,
        })
      } else if (play.primaryDemand.kind === 'revolt_concession') {
        const demand = play.primaryDemand
        if (!state.provinces[demand.provinceId]) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `DiplomaticPlay ${idStr} primaryDemand.provinceId ${demand.provinceId} does not exist (§20)`,
          })
        }
        const validPopClasses: string[] = ['peasants', 'townsmen', 'nobles']
        if (!validPopClasses.includes(demand.popClass)) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `DiplomaticPlay ${idStr} primaryDemand.popClass ${demand.popClass} is not a valid PopClass (§20)`,
          })
        }
      }
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

    // v0.23 Phase D: negotiation parameters range
    for (const field of [
      'initiatorPreparation',
      'initiatorLeverage',
      'initiatorCommitment',
      'targetPreparation',
      'targetLeverage',
      'targetCommitment',
    ] as const) {
      const val = play[field]
      if (val < 0 || val > 100) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `DiplomaticPlay ${idStr} ${field}=${val} outside [0, 100] (§10)`,
        })
      }
    }

    // v0.23 Phase D: activeTaskIds must reference valid active Tasks
    for (const taskId of play.initiatorActiveTaskIds) {
      const task = state.tasks[taskId]
      if (!task) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `DiplomaticPlay ${idStr}: initiatorActiveTaskIds references missing task ${taskId as string} (§10)`,
        })
      } else if (task.status !== 'active') {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `DiplomaticPlay ${idStr}: initiatorActiveTaskIds references non-active task ${taskId as string} (status=${task.status}) (§10)`,
        })
      }
    }
    for (const taskId of play.targetActiveTaskIds) {
      const task = state.tasks[taskId]
      if (!task) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `DiplomaticPlay ${idStr}: targetActiveTaskIds references missing task ${taskId as string} (§10)`,
        })
      } else if (task.status !== 'active') {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `DiplomaticPlay ${idStr}: targetActiveTaskIds references non-active task ${taskId as string} (status=${task.status}) (§10)`,
        })
      }
    }

    // v0.23 Phase D: delegate validity
    if (play.initiatorDelegatePersonId) {
      const person = state.persons[play.initiatorDelegatePersonId]
      if (!person || !person.alive || person.kind === 'placeholder') {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `DiplomaticPlay ${idStr}: initiatorDelegatePersonId ${play.initiatorDelegatePersonId as string} is not alive/normal (§10)`,
        })
      }
    }
    if (play.targetDelegatePersonId) {
      const person = state.persons[play.targetDelegatePersonId]
      if (!person || !person.alive || person.kind === 'placeholder') {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `DiplomaticPlay ${idStr}: targetDelegatePersonId ${play.targetDelegatePersonId as string} is not alive/normal (§10)`,
        })
      }
    }
  }

  // v0.30 §14: terminal play の offer が cleanup 後に残っていない
  for (const [offerIdStr, offer] of Object.entries(state.diplomaticOffers)) {
    if (!offer) continue
    const play = state.diplomaticPlays[offer.playId]
    if (!play) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `DiplomaticOffer ${offerIdStr} references missing play ${offer.playId as string} (§14)`,
      })
      continue
    }
    const isTerminal =
      play.status === 'settled' ||
      play.status === 'failed' ||
      play.status === 'resolved_by_conflict' ||
      play.status === 'cancelled'
    if (isTerminal) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `DiplomaticOffer ${offerIdStr} belongs to terminal play ${offer.playId as string} (status=${play.status}) — should have been cascade-deleted (§14)`,
      })
    }
  }

  // v0.30 §14: active play の currentOffer demands が issue anchor と矛盾しない (§5.4)
  for (const [idStr, play] of Object.entries(state.diplomaticPlays)) {
    if (!play || (play.status !== 'active' && play.status !== 'escalated')) continue
    if (!play.currentOfferId || !play.issue) continue
    const offer = state.diplomaticOffers[play.currentOfferId]
    if (!offer) continue
    for (const demand of offer.demands) {
      if (play.issue.kind === 'land_claim') {
        if (demand.kind === 'change_contract_tax_rate') {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `DiplomaticPlay ${idStr} (land_claim) currentOffer contains change_contract_tax_rate demand (§5.4)`,
          })
        }
        if (demand.kind === 'transfer_land_contract' && demand.holdingId !== play.issue.holdingId) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `DiplomaticPlay ${idStr} (land_claim) transfer_land_contract.holdingId=${demand.holdingId} !== issue.holdingId=${play.issue.holdingId} (§5.4)`,
          })
        }
      }
      if (play.issue.kind === 'contract_tax_revision') {
        if (demand.kind === 'transfer_land_contract') {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `DiplomaticPlay ${idStr} (contract_tax_revision) currentOffer contains transfer_land_contract demand (§5.4)`,
          })
        }
        if (
          demand.kind === 'change_contract_tax_rate' &&
          demand.landContractId !== play.issue.landContractId
        ) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `DiplomaticPlay ${idStr} (contract_tax_revision) change_contract_tax_rate.landContractId=${demand.landContractId} !== issue.landContractId=${play.issue.landContractId} (§5.4)`,
          })
        }
      }
    }
  }

  // v0.23 Phase D: active Tasks targeting diplomatic_play must reference existing active/escalated Play
  for (const [taskIdStr, task] of Object.entries(state.tasks)) {
    if (!task || task.status !== 'active') continue
    if (task.targetRef.kind !== 'diplomatic_play') continue
    const play = state.diplomaticPlays[task.targetRef.id]
    if (!play) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Task ${taskIdStr}: targets diplomatic_play ${task.targetRef.id as string} which does not exist (§10)`,
      })
    } else if (play.status !== 'active' && play.status !== 'escalated') {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Task ${taskIdStr}: targets diplomatic_play ${task.targetRef.id as string} which has terminal status ${play.status} (§10)`,
      })
    }
  }

  // ─── §14 (v0.34): War 整合性 ───
  const VALID_WAR_STATUSES = ['active', 'attacker_won', 'defender_won', 'white_peace', 'cancelled']
  const seenWarIds = new Set<string>()
  for (const idStr of Object.keys(state.wars)) {
    const war = state.wars[idStr as WarId]
    if (!war) continue

    // §14.2 基本検査
    if ((war.id as string) !== idStr) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `War ${idStr}: war.id=${war.id as string} does not match record key (§14.2)`,
      })
    }
    if (seenWarIds.has(idStr)) {
      errors.push({ code: 'INTEGRITY_VIOLATION', message: `War ${idStr} duplicate id (§14.2)` })
    }
    seenWarIds.add(idStr)
    if (!VALID_WAR_STATUSES.includes(war.status)) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `War ${idStr} has invalid status ${war.status} (§14.2)`,
      })
    }
    if (!Number.isFinite(war.startedWeek)) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `War ${idStr} startedWeek is not finite (§14.2)`,
      })
    }
    if (war.endedWeek !== undefined && war.endedWeek < war.startedWeek) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `War ${idStr} endedWeek=${war.endedWeek} < startedWeek=${war.startedWeek} (§14.2)`,
      })
    }
    if (!Number.isFinite(war.warScore)) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `War ${idStr} warScore is not finite (§14.2)`,
      })
    } else if (war.warScore < -100 || war.warScore > 100) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `War ${idStr} warScore=${war.warScore} out of range -100..100 (§14.2)`,
      })
    }
    if (!(war.targetWarScore > 0) || war.targetWarScore > 100) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `War ${idStr} targetWarScore=${war.targetWarScore} must be in 0<x<=100 (§14.2)`,
      })
    }

    // §14.3 active / terminal 整合
    if (war.status === 'active') {
      if (war.endedWeek !== undefined) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `War ${idStr} active but endedWeek=${war.endedWeek} is set (§14.3)`,
        })
      }
    } else if (war.endedWeek === undefined) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `War ${idStr} terminal (${war.status}) but endedWeek is undefined (§14.3)`,
      })
    }

    // §14.4 participant 検査
    if (war.attacker.key !== 'attacker') {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `War ${idStr} attacker.key=${war.attacker.key} (§14.4)`,
      })
    }
    if (war.defender.key !== 'defender') {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `War ${idStr} defender.key=${war.defender.key} (§14.4)`,
      })
    }
    const sides: Array<[string, typeof war.attacker]> = [
      ['attacker', war.attacker],
      ['defender', war.defender],
    ]
    for (const [sideName, side] of sides) {
      if (side.participants.length !== 1) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `War ${idStr} ${sideName} participants.length=${side.participants.length} must be 1 in v0.34 (§14.4)`,
        })
      }
      const primaryCount = side.participants.filter((p) => p.primary).length
      if (primaryCount !== 1) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `War ${idStr} ${sideName} has ${primaryCount} primary participants, must be 1 (§14.4)`,
        })
      }
      // active War のみ actor active を要求 (terminal War は retention 中の inactive 化を許容)。
      // この検査は cancelOrphanedWarsSystem (§7.9) が active War の participant 消滅を回収する前提。
      if (war.status === 'active') {
        for (const p of side.participants) {
          if (!isActiveActor(p.actor)) {
            errors.push({
              code: 'INTEGRITY_VIOLATION',
              message: `active War ${idStr} ${sideName} actor ${politicalActorKey(p.actor)} is not active (§14.4)`,
            })
          }
        }
        // v0.35 (§14.7): WarSide の作戦状態の不変条件。active War のみ検査する。
        //   captainGeneral / commander の ID は soft reference のため存在・生存は検査しない
        //   (WarManeuver が毎週 lazy 再選出する。terminal War は retention 中の aging を許容)。
        if (!Number.isFinite(side.avoidanceCount) || side.avoidanceCount < 0) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `active War ${idStr} ${sideName} avoidanceCount=${side.avoidanceCount} must be finite and >= 0 (§14.7)`,
          })
        }
        if (new Set(side.commanderPersonIds).size !== side.commanderPersonIds.length) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `active War ${idStr} ${sideName} commanderPersonIds has duplicates (§14.7)`,
          })
        }
      }
    }

    // §14 WarGoal 検査 (spec §6.24 v0.34 / §6.27c PeaceSettlementSystem)
    //   参照存在 (holding/polity/landContract) は active War のみ要求する (participant 検査と対称)。
    //   terminal War は cleanup されるまで参照不問 — retention 中に別システム (税率改定外交・併合など) が
    //   参照先を消すのを許容する (WarGoal は和平適用済みの凍結履歴データのため)。
    //   active War で参照先が消えた stale ケースは PeaceSettlementSystem が white_peace で安全終結させる。
    //   range/value 検査 (税率 0..1, requiredWarScore>0, from≠to) は凍結値の不変条件なので status 無関係。
    const checkWarGoalRefs = war.status === 'active'
    for (const goal of war.warGoals) {
      if (goal.kind === 'transfer_land_contract') {
        if (checkWarGoalRefs && !state.holdings[goal.holdingId]) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `War ${idStr} transfer goal references missing holding ${goal.holdingId as string} (§14.5)`,
          })
        }
        if (checkWarGoalRefs && !state.polities[goal.fromPolityId]) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `War ${idStr} transfer goal references missing fromPolityId ${goal.fromPolityId as string} (§14.5)`,
          })
        }
        if (checkWarGoalRefs && !state.polities[goal.toPolityId]) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `War ${idStr} transfer goal references missing toPolityId ${goal.toPolityId as string} (§14.5)`,
          })
        }
        if ((goal.fromPolityId as string) === (goal.toPolityId as string)) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `War ${idStr} transfer goal fromPolityId === toPolityId (§14.5)`,
          })
        }
        if (!(goal.requiredWarScore > 0)) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `War ${idStr} transfer goal requiredWarScore=${goal.requiredWarScore} must be > 0 (§14.5)`,
          })
        }
      } else if (goal.kind === 'change_contract_tax_rate') {
        if (checkWarGoalRefs) {
          if (!state.holdings[goal.holdingId]) {
            errors.push({
              code: 'INTEGRITY_VIOLATION',
              message: `War ${idStr} tax goal references missing holding ${goal.holdingId as string} (§14.5)`,
            })
          }
          const contract = state.landContracts[goal.landContractId]
          if (!contract) {
            errors.push({
              code: 'INTEGRITY_VIOLATION',
              message: `War ${idStr} tax goal references missing landContract ${goal.landContractId as string} (§14.5)`,
            })
          } else if ((contract.holdingId as string) !== (goal.holdingId as string)) {
            errors.push({
              code: 'INTEGRITY_VIOLATION',
              message: `War ${idStr} tax goal landContract.holdingId=${contract.holdingId as string} !== goal.holdingId=${goal.holdingId as string} (§14.5)`,
            })
          }
        }
        if (!(goal.newTaxRateToGrantor >= 0 && goal.newTaxRateToGrantor <= 1)) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `War ${idStr} tax goal newTaxRateToGrantor=${goal.newTaxRateToGrantor} out of range 0..1 (§14.5)`,
          })
        }
        // v0.34: baseTaxRateToGrantor は「開戦前の凍結 baseline」。0..1 の range のみ検査する。
        //   live 契約 rate との一致は検査しない (和平適用で乖離するのが正常挙動のため)。
        if (!(goal.baseTaxRateToGrantor >= 0 && goal.baseTaxRateToGrantor <= 1)) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `War ${idStr} tax goal baseTaxRateToGrantor=${goal.baseTaxRateToGrantor} out of range 0..1 (§14.5)`,
          })
        }
        if (!(goal.requiredWarScore > 0)) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `War ${idStr} tax goal requiredWarScore=${goal.requiredWarScore} must be > 0 (§14.5)`,
          })
        }
      } else if (goal.kind === 'popular_revolt_independence') {
        // v0.39: 叛乱独立 WarGoal の integrity 検査。
        if (checkWarGoalRefs) {
          if (!state.polities[goal.commonwealthPolityId]) {
            errors.push({
              code: 'INTEGRITY_VIOLATION',
              message: `War ${idStr} revolt goal references missing commonwealthPolityId ${goal.commonwealthPolityId as string}`,
            })
          }
          if (!state.polities[goal.originalHolderPolityId]) {
            errors.push({
              code: 'INTEGRITY_VIOLATION',
              message: `War ${idStr} revolt goal references missing originalHolderPolityId ${goal.originalHolderPolityId as string}`,
            })
          }
          for (const hid of goal.holdingIds) {
            if (!state.holdings[hid]) {
              errors.push({
                code: 'INTEGRITY_VIOLATION',
                message: `War ${idStr} revolt goal references missing holding ${hid as string}`,
              })
            }
          }
        }
        if (goal.holdingIds.length === 0) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `War ${idStr} revolt goal holdingIds is empty`,
          })
        }
        if (!(goal.requiredWarScore > 0)) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `War ${idStr} revolt goal requiredWarScore=${goal.requiredWarScore} must be > 0`,
          })
        }
      }
    }
    // §14.6 originDiplomaticPlayId は weak ref のため存在検査しない。
  }

  // warIndex 双方向 (§14.7, Faction index パターン踏襲)
  // forward: byParticipant[key] の各 warId は存在し、その War に key 一致の participant がいる
  for (const [participantKey, warIds] of Object.entries(state.warIndex.byParticipant)) {
    for (const wid of warIds ?? []) {
      const war = state.wars[wid]
      if (!war) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `warIndex.byParticipant[${participantKey}] references missing War ${wid as string} (§14.7)`,
        })
        continue
      }
      const keys = [...war.attacker.participants, ...war.defender.participants].map((p) =>
        politicalActorKey(p.actor),
      )
      if (!keys.includes(participantKey)) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `warIndex.byParticipant[${participantKey}] entry ${wid as string} has no matching participant (§14.7)`,
        })
      }
    }
  }
  // reverse: active War の各 participant key は byParticipant に warId を持つ
  for (const warIdStr of Object.keys(state.wars)) {
    const warId = warIdStr as WarId
    const war = state.wars[warId]
    if (!war || war.status !== 'active') continue
    for (const side of [war.attacker, war.defender]) {
      for (const p of side.participants) {
        const key = politicalActorKey(p.actor)
        const indexed = state.warIndex.byParticipant[key] ?? []
        if (!indexed.includes(warId)) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `active War ${warIdStr} participant ${key} is not in warIndex.byParticipant (§14.7)`,
          })
        }
      }
    }
  }
  // byOriginDiplomaticPlay forward: 指す War が存在し originDiplomaticPlayId が一致
  for (const [playIdStr, wid] of Object.entries(state.warIndex.byOriginDiplomaticPlay)) {
    if (wid === undefined) continue
    const war = state.wars[wid]
    if (!war) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `warIndex.byOriginDiplomaticPlay[${playIdStr}] references missing War ${wid as string} (§14.7)`,
      })
      continue
    }
    if ((war.originDiplomaticPlayId as string | undefined) !== playIdStr) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `warIndex.byOriginDiplomaticPlay[${playIdStr}] entry ${wid as string} has originDiplomaticPlayId=${(war.originDiplomaticPlayId as string | undefined) ?? 'undefined'} (§14.7)`,
      })
    }
  }

  // ─── §18 (v0.36): Regiment / Battle 整合性 ───
  //   値域・status・index↔record の構造整合のみ検査する。
  //   soft reference (currentWarId/currentSide が live war を指す / owner active / homeHolding 存在) は
  //   hard invariant にしない (§18.4。RegimentMaintenanceSystem が lazy 処理する)。
  const VALID_REGIMENT_STATUSES = ['active', 'disbanded', 'destroyed']
  const VALID_REGIMENT_SOURCE_KINDS = [
    'levy',
    'urban_militia',
    'noble_retinue',
    'mercenary',
    'local_levy',
  ]
  const VALID_REGIMENT_TROOP_KINDS = ['infantry', 'cavalry']
  for (const idStr of Object.keys(state.regiments)) {
    const regiment = state.regiments[idStr as RegimentId]
    if (!regiment) continue
    if ((regiment.id as string) !== idStr) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Regiment ${idStr}: regiment.id=${regiment.id as string} does not match record key (§18)`,
      })
    }
    if (!VALID_REGIMENT_STATUSES.includes(regiment.status)) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Regiment ${idStr} has invalid status ${regiment.status} (§18.2)`,
      })
    }
    if (!VALID_REGIMENT_SOURCE_KINDS.includes(regiment.sourceKind)) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Regiment ${idStr} has invalid sourceKind ${regiment.sourceKind} (§18)`,
      })
    }
    if (!VALID_REGIMENT_TROOP_KINDS.includes(regiment.troopKind)) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Regiment ${idStr} has invalid troopKind ${regiment.troopKind} (§18)`,
      })
    }
    if (!(regiment.maxStrength > 0)) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Regiment ${idStr} maxStrength=${regiment.maxStrength} must be > 0 (§18.1)`,
      })
    } else if (
      !Number.isFinite(regiment.strength) ||
      regiment.strength < 0 ||
      regiment.strength > regiment.maxStrength
    ) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Regiment ${idStr} strength=${regiment.strength} out of range 0..maxStrength(${regiment.maxStrength}) (§18.1)`,
      })
    }
    if (
      !Number.isFinite(regiment.organization) ||
      regiment.organization < 0 ||
      regiment.organization > regiment.maxOrganization
    ) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Regiment ${idStr} organization=${regiment.organization} out of range 0..maxOrganization(${regiment.maxOrganization}) (§18.1)`,
      })
    }
    if (
      !Number.isFinite(regiment.morale) ||
      regiment.morale < 0 ||
      regiment.morale > regiment.maxMorale
    ) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Regiment ${idStr} morale=${regiment.morale} out of range 0..maxMorale(${regiment.maxMorale}) (§18.1)`,
      })
    }
    // §3 (v0.37): baseline / max の構造整合。0 <= baseline <= max <= hardCap (hardCap は config 経由・任意)。
    const orgHardCap = config?.regimentMaxOrganizationHardCap
    if (
      !Number.isFinite(regiment.baselineOrganization) ||
      !Number.isFinite(regiment.maxOrganization) ||
      regiment.baselineOrganization < 0 ||
      regiment.baselineOrganization > regiment.maxOrganization ||
      (orgHardCap !== undefined && regiment.maxOrganization > orgHardCap)
    ) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Regiment ${idStr} organization baseline/max invalid: baseline=${regiment.baselineOrganization} max=${regiment.maxOrganization} (need 0<=baseline<=max<=hardCap) (§18.1)`,
      })
    }
    const moraleHardCap = config?.regimentMaxMoraleHardCap
    if (
      !Number.isFinite(regiment.baselineMorale) ||
      !Number.isFinite(regiment.maxMorale) ||
      regiment.baselineMorale < 0 ||
      regiment.baselineMorale > regiment.maxMorale ||
      (moraleHardCap !== undefined && regiment.maxMorale > moraleHardCap)
    ) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Regiment ${idStr} morale baseline/max invalid: baseline=${regiment.baselineMorale} max=${regiment.maxMorale} (need 0<=baseline<=max<=hardCap) (§18.1)`,
      })
    }
    if (!Number.isFinite(regiment.basePower) || regiment.basePower < 0) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Regiment ${idStr} basePower=${regiment.basePower} must be finite and >= 0 (§18.1)`,
      })
    }
    // currentWarId と currentSide は両方揃うか両方無いか (構造整合。war の liveness は検査しない)。
    if ((regiment.currentWarId === undefined) !== (regiment.currentSide === undefined)) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Regiment ${idStr} currentWarId/currentSide must both be set or both unset (§18)`,
      })
    }
    // v0.36 補充・再編成: destroyedWeek/lastReinforcedWeek は createdWeek..currentWeek の範囲。
    if (
      regiment.destroyedWeek !== undefined &&
      (!Number.isFinite(regiment.destroyedWeek) ||
        regiment.destroyedWeek < regiment.createdWeek ||
        regiment.destroyedWeek > state.absoluteWeek)
    ) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Regiment ${idStr} destroyedWeek=${regiment.destroyedWeek} out of range createdWeek(${regiment.createdWeek})..currentWeek(${state.absoluteWeek}) (§18.1)`,
      })
    }
    if (
      regiment.lastReinforcedWeek !== undefined &&
      (!Number.isFinite(regiment.lastReinforcedWeek) ||
        regiment.lastReinforcedWeek < regiment.createdWeek ||
        regiment.lastReinforcedWeek > state.absoluteWeek)
    ) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Regiment ${idStr} lastReinforcedWeek=${regiment.lastReinforcedWeek} out of range createdWeek(${regiment.createdWeek})..currentWeek(${state.absoluteWeek}) (§18.1)`,
      })
    }
    // destroyedWeek は status==='destroyed' のときだけ持つ (reform で消去される)。
    if (regiment.status !== 'destroyed' && regiment.destroyedWeek !== undefined) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Regiment ${idStr} has destroyedWeek but status=${regiment.status} (§18.2)`,
      })
    }
    if (regiment.sourceKind === 'local_levy') {
      if (regiment.disbandAfterWar !== true) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Regiment ${idStr} local_levy must have disbandAfterWar=true (v0.39 §17.3)`,
        })
      }
      if (regiment.homeHoldingId === undefined) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Regiment ${idStr} local_levy must have homeHoldingId (v0.39 §17.3)`,
        })
      }
    }
  }
  // index → record 整合 (§18.3)。liveness ではなく「index entry が指す Regiment が存在し key と一致するか」。
  for (const [ownerKey, ids] of Object.entries(state.regimentIndex.byOwner)) {
    for (const rid of ids) {
      const r = state.regiments[rid]
      if (!r) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `regimentIndex.byOwner[${ownerKey}] references missing Regiment ${rid as string} (§18.3)`,
        })
      } else if (politicalActorKey(r.owner) !== ownerKey) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `regimentIndex.byOwner[${ownerKey}] entry ${rid as string} has owner ${politicalActorKey(r.owner)} (§18.3)`,
        })
      }
    }
  }
  for (const [warIdStr, ids] of Object.entries(state.regimentIndex.byWar)) {
    for (const rid of ids) {
      const r = state.regiments[rid]
      if (!r) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `regimentIndex.byWar[${warIdStr}] references missing Regiment ${rid as string} (§18.3)`,
        })
      } else if ((r.currentWarId as string | undefined) !== warIdStr) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `regimentIndex.byWar[${warIdStr}] entry ${rid as string} has currentWarId=${(r.currentWarId as string | undefined) ?? 'undefined'} (§18.3)`,
        })
      }
    }
  }
  for (const [holdingIdStr, ids] of Object.entries(state.regimentIndex.byHomeHolding)) {
    for (const rid of ids) {
      const r = state.regiments[rid]
      if (!r) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `regimentIndex.byHomeHolding[${holdingIdStr}] references missing Regiment ${rid as string} (§18.3)`,
        })
      } else if ((r.homeHoldingId as string | undefined) !== holdingIdStr) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `regimentIndex.byHomeHolding[${holdingIdStr}] entry ${rid as string} home mismatch (§18.3)`,
        })
      }
    }
  }
  for (const [provinceIdStr, ids] of Object.entries(state.regimentIndex.byHomeProvince)) {
    for (const rid of ids) {
      const r = state.regiments[rid]
      if (!r) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `regimentIndex.byHomeProvince[${provinceIdStr}] references missing Regiment ${rid as string} (§18.3)`,
        })
      } else if ((r.homeProvinceId as string | undefined) !== provinceIdStr) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `regimentIndex.byHomeProvince[${provinceIdStr}] entry ${rid as string} home mismatch (§18.3)`,
        })
      }
    }
  }
  // Battle: id↔key + warScore 値域 + battleIndex↔record 整合。
  for (const idStr of Object.keys(state.battles)) {
    const battle = state.battles[idStr as BattleId]
    if (!battle) continue
    if ((battle.id as string) !== idStr) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Battle ${idStr}: battle.id=${battle.id as string} does not match record key (§18)`,
      })
    }
    if (!Number.isFinite(battle.warScoreAfter) || !Number.isFinite(battle.warScoreDelta)) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Battle ${idStr} warScore values must be finite (§18)`,
      })
    }

    // §18 (v0.37): Battle summary invariants (set されたフィールドのみ検査)。
    if (battle.frontage !== undefined && battle.frontage <= 0) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Battle ${idStr} frontage=${battle.frontage} must be > 0 (§18)`,
      })
    }
    if (
      battle.ticksElapsed !== undefined &&
      battle.maxTicks !== undefined &&
      battle.ticksElapsed > battle.maxTicks
    ) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Battle ${idStr} ticksElapsed=${battle.ticksElapsed} > maxTicks=${battle.maxTicks} (§18)`,
      })
    }
    const atkSet = new Set<RegimentId>(battle.attackerRegimentIds)
    const defSet = new Set<RegimentId>(battle.defenderRegimentIds)
    const unionSet = new Set<RegimentId>([
      ...battle.attackerRegimentIds,
      ...battle.defenderRegimentIds,
    ])
    const checkSubset = (
      ids: RegimentId[] | undefined,
      allowed: Set<RegimentId>,
      label: string,
    ): void => {
      if (!ids) return
      for (const id of ids) {
        if (!allowed.has(id)) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `Battle ${idStr} ${label} references ${id} not in side regiments (§18)`,
          })
        }
      }
    }
    checkSubset(battle.attackerInitialFrontlineIds, atkSet, 'attackerInitialFrontlineIds')
    checkSubset(battle.defenderInitialFrontlineIds, defSet, 'defenderInitialFrontlineIds')
    checkSubset(battle.attackerRoutedRegimentIds, atkSet, 'attackerRoutedRegimentIds')
    checkSubset(battle.defenderRoutedRegimentIds, defSet, 'defenderRoutedRegimentIds')
    for (const rr of battle.regimentResults) {
      if (!unionSet.has(rr.regimentId)) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Battle ${idStr} regimentResult references ${rr.regimentId} not in attacker∪defender (§18)`,
        })
      }
    }
    for (const ca of [
      ...(battle.attackerCommanderAssignments ?? []),
      ...(battle.defenderCommanderAssignments ?? []),
    ]) {
      if (!unionSet.has(ca.regimentId)) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Battle ${idStr} commanderAssignment references ${ca.regimentId} not in attacker∪defender (§18)`,
        })
      }
    }
  }
  for (const [warIdStr, ids] of Object.entries(state.battleIndex.byWar)) {
    for (const bid of ids) {
      const b = state.battles[bid]
      if (!b) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `battleIndex.byWar[${warIdStr}] references missing Battle ${bid as string} (§18.3)`,
        })
      } else if ((b.warId as string) !== warIdStr) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `battleIndex.byWar[${warIdStr}] entry ${bid as string} has warId=${b.warId as string} (§18.3)`,
        })
      }
    }
  }

  // ─── State-Province consistency checks (v0.20-a) ───

  // S1: Every Province.stateId points to an existing StateRegion
  for (const provIdStr of Object.keys(state.provinces)) {
    const prov = state.provinces[provIdStr as ProvinceId]
    if (!prov) continue
    if (!state.states[prov.stateId]) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Province ${provIdStr} has stateId=${prov.stateId as string} which does not exist in states`,
      })
    }
  }

  // S2: Every StateRegion.provinceIds entry points to existing Province with matching stateId
  for (const stateIdStr of Object.keys(state.states)) {
    const stateRegion = state.states[stateIdStr as StateRegionId]
    if (!stateRegion) continue
    if (stateRegion.provinceIds.length === 0) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `StateRegion ${stateIdStr} has no provinces`,
      })
    }
    for (const pid of stateRegion.provinceIds) {
      const prov = state.provinces[pid]
      if (!prov) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `StateRegion ${stateIdStr} references non-existent Province ${pid as string}`,
        })
      } else if ((prov.stateId as string) !== (stateRegion.id as string)) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `StateRegion ${stateIdStr} contains Province ${pid as string} whose stateId=${prov.stateId as string} does not match`,
        })
      }
    }
  }

  // S3: Every Province is in exactly one State's provinceIds (no orphans, no duplicates)
  {
    const provincesInStates = new Set<string>()
    for (const stateRegion of Object.values(state.states)) {
      if (!stateRegion) continue
      for (const pid of stateRegion.provinceIds) {
        if (provincesInStates.has(pid)) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `Province ${pid} appears in multiple StateRegions`,
          })
        }
        provincesInStates.add(pid)
      }
    }
    for (const provIdStr of Object.keys(state.provinces)) {
      if (!provincesInStates.has(provIdStr)) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Province ${provIdStr} is not in any StateRegion.provinceIds`,
        })
      }
    }
  }

  // S4: Province.neighbors must be bidirectional
  for (const prov of Object.values(state.provinces)) {
    if (!prov) continue
    for (const nid of prov.neighbors) {
      const neighbor = state.provinces[nid]
      if (!neighbor) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Province ${prov.id} has neighbor ${nid as string} which does not exist`,
        })
        continue
      }
      if (!neighbor.neighbors.includes(prov.id)) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Province ${prov.id} has neighbor ${nid as string} but the reverse is missing`,
        })
      }
    }
    if (prov.neighbors.includes(prov.id)) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Province ${prov.id} has itself as a neighbor`,
      })
    }
    if (prov.neighbors.length === 0) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Province ${prov.id} has no neighbors (isolated)`,
      })
    }
  }

  // H0: Every Province must have at least one Holding
  for (const province of Object.values(state.provinces)) {
    if (!province) continue
    if (province.holdingIds.length === 0) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Province ${province.id} has no Holdings`,
      })
    }
  }

  // H1: Every Province.holdingIds entry exists in state.holdings with matching provinceId
  for (const province of Object.values(state.provinces)) {
    if (!province) continue
    for (const hid of province.holdingIds) {
      const holding = state.holdings[hid]
      if (!holding) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Province ${province.id} references missing Holding ${hid}`,
        })
      } else if (holding.provinceId !== province.id) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Province ${province.id} lists Holding ${hid}, but Holding.provinceId is ${holding.provinceId}`,
        })
      }
    }
  }

  // H2: Every Holding.provinceId points to an existing Province that lists this Holding
  for (const holding of Object.values(state.holdings)) {
    if (!holding) continue
    const province = state.provinces[holding.provinceId]
    if (!province) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Holding ${holding.id} references missing Province ${holding.provinceId}`,
      })
    } else if (!province.holdingIds.includes(holding.id)) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Holding ${holding.id} belongs to Province ${holding.provinceId} but is not in holdingIds`,
      })
    }
  }

  // H3: holdingTerminalPolityCache consistent with per-Holding byHolding chain terminal
  for (const holding of Object.values(state.holdings)) {
    if (!holding) continue
    const holdingTerminal = state.holdingTerminalPolityCache[holding.id]
    const chain = state.landContractIndex.byHolding[holding.id] ?? []
    const terminalContractId = chain[chain.length - 1]
    const terminalContract = terminalContractId
      ? state.landContracts[terminalContractId]
      : undefined
    const expectedPolity = terminalContract?.granteePolityId
    if (holdingTerminal !== expectedPolity) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Holding ${holding.id} holdingTerminalPolityCache (${holdingTerminal}) != byHolding chain terminal grantee (${expectedPolity}) for province ${holding.provinceId}`,
      })
    }
  }

  // H4: Holding field range checks (§18.3)
  for (const holding of Object.values(state.holdings)) {
    if (!holding) continue
    if (holding.polityControl < 0 || holding.polityControl > 100) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Holding ${holding.id} polityControl=${holding.polityControl} out of range [0,100] (§18.3)`,
      })
    }
    if (holding.landQuality <= 0) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Holding ${holding.id} landQuality=${holding.landQuality} must be > 0 (§18.3)`,
      })
    }
    if (holding.weight <= 0) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Holding ${holding.id} weight=${holding.weight} must be > 0 (§18.3)`,
      })
    }
    if (holding.kind !== 'manor' && holding.kind !== 'city') {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Holding ${holding.id} kind=${String(holding.kind)} must be 'manor' or 'city' (§18.3)`,
      })
    }
  }

  // H5: HoldingOffice integrity (§18.5)
  for (const holdingIdStr of Object.keys(state.holdings)) {
    const hid = holdingIdStr as HoldingId
    const assignmentId = state.holdingOfficeIndex.byHolding[hid]
    if (!assignmentId) continue
    const assignment = state.holdingOfficeAssignments[assignmentId]
    if (!assignment) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `holdingOfficeIndex.byHolding[${hid}] references missing assignment ${assignmentId as string} (§18.5)`,
      })
      continue
    }
    if (!assignment.active) continue
    if (assignment.holdingId !== hid) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `HoldingOfficeAssignment ${assignmentId as string} holdingId=${assignment.holdingId as string} != indexed holding ${hid} (§18.5)`,
      })
    }
    const holder = state.persons[assignment.holderPersonId]
    if (!holder) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `HoldingOfficeAssignment ${assignmentId as string} holderPersonId=${assignment.holderPersonId as string} does not exist (§18.5)`,
      })
    }
    const terminalPolityId = state.holdingTerminalPolityCache[hid]
    if (
      terminalPolityId &&
      (assignment.appointingPolityId as string) !== (terminalPolityId as string)
    ) {
      if (debug) {
        console.warn(
          `INTEGRITY (§18.5 warn): HoldingOfficeAssignment ${assignmentId as string} appointingPolityId=${assignment.appointingPolityId as string} != terminal polity ${terminalPolityId as string} for holding ${hid}`,
        )
      }
    }
  }

  // H6: holdingOfficeIndex.byAppointingPolity consistency (§18.5)
  for (const polityIdStr of Object.keys(state.holdingOfficeIndex.byAppointingPolity)) {
    const polityId = polityIdStr as PolityId
    const hoaIds = state.holdingOfficeIndex.byAppointingPolity[polityId] ?? []
    for (const hoaId of hoaIds) {
      const hoa = state.holdingOfficeAssignments[hoaId]
      if (!hoa) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `holdingOfficeIndex.byAppointingPolity[${polityIdStr}] references missing assignment ${hoaId as string} (§18.5)`,
        })
      }
    }
  }

  // --- v0.25 §17.1: HoldingOfficeAssignment extended checks ---
  {
    const activeHoldingsByPerson: Record<string, HoldingOfficeAssignmentId[]> = {}
    const activeHoldingsByHolding: Record<string, HoldingOfficeAssignmentId[]> = {}

    for (const hoaIdStr of Object.keys(state.holdingOfficeAssignments)) {
      const hoaId = hoaIdStr as HoldingOfficeAssignmentId
      const hoa = state.holdingOfficeAssignments[hoaId]
      if (!hoa || !hoa.active) continue

      const holder = state.persons[hoa.holderPersonId]
      if (holder && !holder.alive && holder.kind !== 'placeholder') {
        if (debug) {
          console.warn(
            `INTEGRITY (§17.1 warn): HoldingOfficeAssignment ${hoaIdStr}: holder ${hoa.holderPersonId as string} is dead non-placeholder (transient: awaiting bailiffAppointmentSystem cleanup)`,
          )
        }
      }

      if (hoa.contractedRemittanceRate < 0 || hoa.contractedRemittanceRate > 1) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `HoldingOfficeAssignment ${hoaIdStr}: contractedRemittanceRate=${hoa.contractedRemittanceRate} outside [0, 1] (§17.1)`,
        })
      }
      if (hoa.expectedFeeRate < 0 || hoa.expectedFeeRate > 1) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `HoldingOfficeAssignment ${hoaIdStr}: expectedFeeRate=${hoa.expectedFeeRate} outside [0, 1] (§17.1)`,
        })
      }
      if (
        config &&
        hoa.contractedRemittanceRate + hoa.expectedFeeRate > config.maxLocalExtractionRate * 1.1
      ) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `HoldingOfficeAssignment ${hoaIdStr}: contractedRemittanceRate+expectedFeeRate=${(hoa.contractedRemittanceRate + hoa.expectedFeeRate).toFixed(3)} exceeds maxLocalExtractionRate*1.1=${(config.maxLocalExtractionRate * 1.1).toFixed(3)} (§17.1)`,
        })
      }

      const holdingKey = hoa.holdingId as string
      const holdingList = activeHoldingsByHolding[holdingKey] ?? []
      holdingList.push(hoaId)
      activeHoldingsByHolding[holdingKey] = holdingList

      if (holder && holder.kind !== 'placeholder') {
        const personKey = hoa.holderPersonId as string
        const personList = activeHoldingsByPerson[personKey] ?? []
        personList.push(hoaId)
        activeHoldingsByPerson[personKey] = personList
      }
    }

    for (const [holdingKey, hoaIds] of Object.entries(activeHoldingsByHolding)) {
      if (hoaIds.length > 1) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Holding ${holdingKey} has ${hoaIds.length} active bailiff assignments (§17.1)`,
        })
      }
    }

    for (const [personKey, hoaIds] of Object.entries(activeHoldingsByPerson)) {
      if (hoaIds.length > 1) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Normal person ${personKey} has ${hoaIds.length} active bailiff assignments (§17.1 no concurrency)`,
        })
      }
    }
  }

  // --- v0.27 §19.1: HoldingImprovement checks ---
  {
    const seenHoldingKindPairs = new Set<string>()
    const improvementsByHolding: Record<string, HoldingImprovementId[]> = {}

    for (const [idStr, imp] of Object.entries(state.holdingImprovements)) {
      if (!imp) continue
      const impId = idStr as HoldingImprovementId

      if (!idStr.startsWith('hi-')) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `HoldingImprovement ${idStr}: id does not start with 'hi-' (§19.1)`,
        })
      }

      const holding = state.holdings[imp.holdingId]
      if (!holding) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `HoldingImprovement ${idStr}: holdingId ${imp.holdingId as string} does not exist (§19.1)`,
        })
      }

      if (!VALID_HOLDING_IMPROVEMENT_KINDS.has(imp.kind)) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `HoldingImprovement ${idStr}: kind=${imp.kind} is not valid (§19.1)`,
        })
      }

      if (imp.level < 1) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `HoldingImprovement ${idStr}: level=${imp.level} must be >= 1 (§19.1)`,
        })
      }

      if (holding && config) {
        // v0.33 §13.2: access 反転 [kind][holdingKind] ?? 0。0（未定義含む）= 建設不可なので
        // level >= 1 の improvement が存在する時点で違反（imp.level > maxLevel で両ケースを表現）。
        const maxLevel = config.holdingImprovementMaxLevelByKind[imp.kind][holding.kind] ?? 0
        if (imp.level > maxLevel) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `HoldingImprovement ${idStr}: level=${imp.level} exceeds max ${maxLevel} for ${holding.kind}/${imp.kind} (§19.1)`,
          })
        }
      }

      if (imp.condition < 0 || imp.condition > 100) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `HoldingImprovement ${idStr}: condition=${imp.condition} outside [0, 100] (§19.1)`,
        })
      }

      const pairKey = `${imp.holdingId as string}:${imp.kind}`
      if (seenHoldingKindPairs.has(pairKey)) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `HoldingImprovement ${idStr}: duplicate holdingId+kind pair ${pairKey} (§19.1)`,
        })
      }
      seenHoldingKindPairs.add(pairKey)

      const holdingKey = imp.holdingId as string
      const list = improvementsByHolding[holdingKey] ?? []
      list.push(impId)
      improvementsByHolding[holdingKey] = list
    }

    for (const [holdingKey, indexedIds] of Object.entries(
      state.holdingImprovementIndex.byHolding,
    )) {
      if (!indexedIds) continue
      const actualIds = improvementsByHolding[holdingKey] ?? []
      const indexedSet = new Set(indexedIds.map((id) => id as string))
      const actualSet = new Set(actualIds.map((id) => id as string))

      for (const id of indexedIds) {
        if (!actualSet.has(id)) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `holdingImprovementIndex.byHolding[${holdingKey}] contains ${id} which does not exist or has wrong holdingId (§19.1)`,
          })
        }
      }
      for (const id of actualIds) {
        if (!indexedSet.has(id)) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `HoldingImprovement ${id} belongs to holding ${holdingKey} but is not in holdingImprovementIndex.byHolding (§19.1)`,
          })
        }
      }
    }

    for (const [holdingKey, actualIds] of Object.entries(improvementsByHolding)) {
      if (!(holdingKey in state.holdingImprovementIndex.byHolding)) {
        for (const id of actualIds) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `HoldingImprovement ${id as string} belongs to holding ${holdingKey} but holdingImprovementIndex.byHolding has no entry (§19.1)`,
          })
        }
      }
    }
  }

  // --- v0.33 §13.3: IMPROVEMENT_DEFINITIONS / config 整合（const を回すのみ・低コスト） ---
  if (config) {
    const HOLDING_KINDS = ['manor', 'city'] as const
    for (const kind of Object.keys(IMPROVEMENT_DEFINITIONS) as HoldingImprovementKind[]) {
      const def = IMPROVEMENT_DEFINITIONS[kind]
      for (const hk of HOLDING_KINDS) {
        const maxLevel = config.holdingImprovementMaxLevelByKind[kind][hk]
        const allowed = def.allowedHoldingKinds.includes(hk)
        if (maxLevel !== undefined && maxLevel < 0) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `IMPROVEMENT config: maxLevel for ${kind}/${hk} is negative (${maxLevel}) (§13.3)`,
          })
        }
        // allowedHoldingKinds に含まれる holdingKind は maxLevel >= 1
        if (allowed && (maxLevel === undefined || maxLevel < 1)) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `IMPROVEMENT config: ${kind} allowed for ${hk} but maxLevel=${maxLevel ?? 'undefined'} (<1) (§13.3)`,
          })
        }
        // allowedHoldingKinds に含まれない holdingKind は maxLevel が undefined または 0
        if (!allowed && maxLevel !== undefined && maxLevel > 0) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `IMPROVEMENT config: ${kind} not allowed for ${hk} but maxLevel=${maxLevel} (>0) (§13.3)`,
          })
        }
      }
      // capacityRole==='capacity' は targetOccupations の capacityPerLevel が正値で存在
      if (def.capacityRole === 'capacity') {
        for (const occ of def.targetOccupations ?? []) {
          const perLevel = config.holdingImprovementOccupationCapacityPerLevel[kind][occ]
          if (perLevel === undefined || perLevel <= 0) {
            errors.push({
              code: 'INTEGRITY_VIOLATION',
              message: `IMPROVEMENT config: ${kind} capacityRole=capacity but occupationCapacityPerLevel[${occ}]=${perLevel ?? 'undefined'} (§13.3)`,
            })
          }
        }
      }
    }
  }

  // --- v0.33 §13.4: occupation capacity の健全性（NaN/Infinity/負を返さない、none=0） ---
  if (config) {
    const CAP_PAIRS = [
      ['peasants', 'agriculture'],
      ['townsmen', 'urban_labor'],
      ['nobles', 'elite_service'],
    ] as const
    for (const [holdingIdStr, holding] of Object.entries(state.holdings)) {
      if (!holding) continue
      const hid = holdingIdStr as HoldingId
      for (const [popClass, occupation] of CAP_PAIRS) {
        const cap = getHoldingOccupationCapacity(state, config, hid, popClass, occupation)
        if (!Number.isFinite(cap) || cap < 0) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `Holding ${holdingIdStr}: occupation capacity for ${occupation} is invalid (${cap}) (§13.4)`,
          })
        }
      }
      const noneCap = getHoldingOccupationCapacity(state, config, hid, 'peasants', 'none')
      if (noneCap !== 0) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Holding ${holdingIdStr}: occupation 'none' capacity must be 0 (got ${noneCap}) (§13.4)`,
        })
      }
    }
  }

  // --- v0.22 Goal integrity ---
  const activeGoalCountByOwner: Record<string, number> = {}

  for (const [goalIdStr, goal] of Object.entries(state.goals)) {
    if (!goal) continue

    // Owner must be active
    if (goal.owner.kind === 'polity') {
      const polity = state.polities[goal.owner.id]
      if (!polity) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Goal ${goalIdStr}: owner polity ${goal.owner.id as string} does not exist`,
        })
      } else if (!polity.active && goal.status === 'active') {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Goal ${goalIdStr}: owner polity ${goal.owner.id as string} is inactive but Goal is active`,
        })
      }
    } else if (goal.owner.kind === 'house') {
      const house = state.houses[goal.owner.id]
      if (!house) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Goal ${goalIdStr}: owner house ${goal.owner.id as string} does not exist`,
        })
      } else if (!house.active && goal.status === 'active') {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Goal ${goalIdStr}: owner house ${goal.owner.id as string} is inactive but Goal is active`,
        })
      }
    }

    // Progress in range
    if (goal.progress < 0 || goal.progress > goal.targetProgress) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Goal ${goalIdStr}: progress ${goal.progress} outside [0, ${goal.targetProgress}]`,
      })
    }

    // Active goal count per owner (max 1)
    if (goal.status === 'active') {
      const ownerKey = `${goal.owner.kind}:${goal.owner.id}`
      activeGoalCountByOwner[ownerKey] = (activeGoalCountByOwner[ownerKey] ?? 0) + 1
    }

    // ReasonIds reference existing DecisionReasons
    for (const rid of goal.reasonIds) {
      if (!state.decisionReasons[rid]) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Goal ${goalIdStr}: reasonId ${rid as string} does not exist`,
        })
      }
    }
  }

  // Check active goal count per owner
  for (const [ownerKey, count] of Object.entries(activeGoalCountByOwner)) {
    if (count > 1) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Owner ${ownerKey} has ${count} active Goals (max 1)`,
      })
    }
  }

  // --- v0.22 Aim integrity ---
  const activeAimCountByOwner: Record<string, number> = {}

  for (const [aimIdStr, aim] of Object.entries(state.aims)) {
    if (!aim) continue

    // Owner must be active (for active aims)
    if (aim.owner.kind === 'polity') {
      const polity = state.polities[aim.owner.id]
      if (!polity) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Aim ${aimIdStr}: owner polity ${aim.owner.id as string} does not exist`,
        })
      } else if (!polity.active && aim.status === 'active') {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Aim ${aimIdStr}: owner polity ${aim.owner.id as string} is inactive but Aim is active`,
        })
      }
    } else if (aim.owner.kind === 'house') {
      const house = state.houses[aim.owner.id]
      if (!house) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Aim ${aimIdStr}: owner house ${aim.owner.id as string} does not exist`,
        })
      } else if (!house.active && aim.status === 'active') {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Aim ${aimIdStr}: owner house ${aim.owner.id as string} is inactive but Aim is active`,
        })
      }
    }

    // goal_driven Aim must have goalId
    if (aim.origin === 'goal_driven' && !aim.goalId) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Aim ${aimIdStr}: origin is goal_driven but goalId is missing`,
      })
    }

    // goalId must point to existing Goal with same owner
    if (aim.goalId) {
      const parentGoal = state.goals[aim.goalId]
      if (!parentGoal) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Aim ${aimIdStr}: goalId ${aim.goalId as string} does not exist`,
        })
      } else {
        if (
          parentGoal.owner.kind !== aim.owner.kind ||
          (parentGoal.owner.id as string) !== (aim.owner.id as string)
        ) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `Aim ${aimIdStr}: owner mismatch with Goal ${aim.goalId as string}`,
          })
        }
      }
    }

    // Progress in range
    if (aim.progress < 0 || aim.progress > aim.targetProgress) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Aim ${aimIdStr}: progress ${aim.progress} outside [0, ${aim.targetProgress}]`,
      })
    }

    // Deadline >= createdWeek
    if (aim.deadlineWeek < aim.createdWeek) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Aim ${aimIdStr}: deadlineWeek ${aim.deadlineWeek} < createdWeek ${aim.createdWeek}`,
      })
    }

    // activeDiplomaticPlayId must reference an existing active/escalated Play
    if (aim.activeDiplomaticPlayId) {
      const play = state.diplomaticPlays[aim.activeDiplomaticPlayId]
      if (!play) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Aim ${aimIdStr}: activeDiplomaticPlayId ${aim.activeDiplomaticPlayId as string} does not exist`,
        })
      } else if (play.status !== 'active' && play.status !== 'escalated') {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Aim ${aimIdStr}: activeDiplomaticPlayId ${aim.activeDiplomaticPlayId as string} is not active/escalated (status: ${play.status})`,
        })
      }
    }

    // Active aim count per owner (max 1 for goal_driven)
    if (aim.status === 'active' && aim.origin === 'goal_driven') {
      const ownerKey = `${aim.owner.kind}:${aim.owner.id}`
      activeAimCountByOwner[ownerKey] = (activeAimCountByOwner[ownerKey] ?? 0) + 1
    }

    // ReasonIds reference existing DecisionReasons
    for (const rid of aim.reasonIds) {
      if (!state.decisionReasons[rid]) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Aim ${aimIdStr}: reasonId ${rid as string} does not exist`,
        })
      }
    }
  }

  // Check active aim count per owner
  for (const [ownerKey, count] of Object.entries(activeAimCountByOwner)) {
    if (count > 1) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Owner ${ownerKey} has ${count} active goal_driven Aims (max 1)`,
      })
    }
  }

  // --- v0.22 DiplomaticPlay Goal/Aim cross-references ---
  for (const [playIdStr, play] of Object.entries(state.diplomaticPlays)) {
    if (!play) continue

    if (play.goalId) {
      if (!state.goals[play.goalId]) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `DiplomaticPlay ${playIdStr}: goalId ${play.goalId as string} does not exist`,
        })
      }
    }

    if (play.aimId) {
      if (!state.aims[play.aimId]) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `DiplomaticPlay ${playIdStr}: aimId ${play.aimId as string} does not exist`,
        })
      }
    }
  }

  // --- v0.23: Task integrity ---
  for (const [taskIdStr, task] of Object.entries(state.tasks)) {
    if (!task) continue
    // Assignee must exist, be alive, and not be placeholder
    const assignee = state.persons[task.assigneePersonId]
    if (!assignee) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Task ${taskIdStr}: assignee ${task.assigneePersonId} does not exist`,
      })
    } else if (!assignee.alive) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Task ${taskIdStr}: assignee ${task.assigneePersonId} is dead`,
      })
    } else if (assignee.kind === 'placeholder') {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Task ${taskIdStr}: assignee ${task.assigneePersonId} is placeholder`,
      })
    }
    if (task.difficulty < 0 || task.difficulty > 100) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Task ${taskIdStr}: difficulty ${task.difficulty} out of range [0,100]`,
      })
    }
    if (!VALID_ABILITY_KEYS.has(task.relevantAbility)) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Task ${taskIdStr}: relevantAbility '${task.relevantAbility}' is not a valid AbilityKey`,
      })
    }
    // Active task target should not be terminal
    if (task.status === 'active' && task.targetRef.kind === 'aim') {
      const targetAim = state.aims[task.targetRef.id]
      if (targetAim && targetAim.status !== 'active') {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Task ${taskIdStr}: active task targets terminal aim ${task.targetRef.id} (status=${targetAim.status})`,
        })
      }
    }
  }

  // --- v0.25 §17.2: collect_holding_revenue Task integrity ---
  {
    const activeRevenueTasksByTarget: Record<string, number> = {}

    for (const [taskIdStr, task] of Object.entries(state.tasks)) {
      if (!task) continue
      if (task.kind !== 'collect_holding_revenue') continue

      if (task.targetRef.kind !== 'holding_office_assignment') {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Task ${taskIdStr}: collect_holding_revenue has targetRef.kind=${task.targetRef.kind}, expected holding_office_assignment (§17.2)`,
        })
        continue
      }

      const assignment = state.holdingOfficeAssignments[task.targetRef.id]
      if (!assignment) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Task ${taskIdStr}: collect_holding_revenue targets missing HoldingOfficeAssignment ${task.targetRef.id as string} (§17.2)`,
        })
      } else if (!assignment.active) {
        if (task.status === 'active') {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `Task ${taskIdStr}: active collect_holding_revenue targets inactive HoldingOfficeAssignment ${task.targetRef.id as string} (§17.2)`,
          })
        }
      } else {
        if (isPlaceholderPerson(state, assignment.holderPersonId)) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `Task ${taskIdStr}: collect_holding_revenue exists for placeholder holder ${assignment.holderPersonId as string} (§17.2)`,
          })
        }
      }

      if (task.status === 'active') {
        const tKey = targetRefKey(task.targetRef)
        activeRevenueTasksByTarget[tKey] = (activeRevenueTasksByTarget[tKey] ?? 0) + 1
      }
    }

    for (const [tKey, count] of Object.entries(activeRevenueTasksByTarget)) {
      if (count > 1) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `${count} active collect_holding_revenue Tasks for target ${tKey} (§17.2 max 1)`,
        })
      }
    }
  }

  // --- v0.25 §17.3: Selector range checks (debug + config only) ---
  if (debug && config) {
    for (const hoaIdStr of Object.keys(state.holdingOfficeAssignments)) {
      const hoaId = hoaIdStr as HoldingOfficeAssignmentId
      const hoa = state.holdingOfficeAssignments[hoaId]
      if (!hoa || !hoa.active) continue

      const localExtractionRate = getBailiffLocalExtractionRate(state, config, hoaId)
      if (
        localExtractionRate < config.minLocalExtractionRate ||
        localExtractionRate > config.maxLocalExtractionRate
      ) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `HoldingOfficeAssignment ${hoaIdStr}: localExtractionRate=${localExtractionRate.toFixed(3)} outside [${config.minLocalExtractionRate}, ${config.maxLocalExtractionRate}] (§17.3)`,
        })
      }

      const recentTaskStatus = getRecentBailiffRevenueTaskStatus(state, hoaId)
      const collectionEfficiency = getBailiffCollectionEfficiency(
        state,
        config,
        hoaId,
        recentTaskStatus,
      )
      if (
        collectionEfficiency < config.minBailiffCollectionEfficiency ||
        collectionEfficiency > 1.0
      ) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `HoldingOfficeAssignment ${hoaIdStr}: collectionEfficiency=${collectionEfficiency.toFixed(3)} outside [${config.minBailiffCollectionEfficiency}, 1.0] (§17.3)`,
        })
      }

      const bailiffFeeRate = getBailiffFeeRate(state, config, hoaId)
      if (bailiffFeeRate < 0 || bailiffFeeRate > config.maxBailiffFeeRate) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `HoldingOfficeAssignment ${hoaIdStr}: bailiffFeeRate=${bailiffFeeRate.toFixed(3)} outside [0, ${config.maxBailiffFeeRate}] (§17.3)`,
        })
      }

      const burden = computeBailiffBurdenComponents(
        localExtractionRate,
        collectionEfficiency,
        config.collectionFrictionFactor,
      )
      if (burden.totalBurdenRate < 0 || burden.totalBurdenRate > config.maxLocalExtractionRate) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `HoldingOfficeAssignment ${hoaIdStr}: totalBurdenRate=${burden.totalBurdenRate.toFixed(3)} outside [0, ${config.maxLocalExtractionRate}] (§17.3)`,
        })
      }
    }
  }

  // --- v0.23: Person Goal integrity ---
  for (const [personIdStr, person] of Object.entries(state.persons)) {
    if (!person || !person.alive) continue
    if (person.kind === 'placeholder') continue
    if (person.age < 15) continue // adultAge
    if (!person.houseId) continue

    const house = state.houses[person.houseId]
    if (!house || !house.active) continue

    // Count active Person Goals (check for > 1, which is always invalid)
    const ownerKey = `person:${personIdStr}`
    const goalIds = state.goalIndex.byOwner[ownerKey]
    let activeGoalCount = 0
    if (goalIds) {
      for (const gid of goalIds) {
        const goal = state.goals[gid]
        if (goal && goal.status === 'active') activeGoalCount++
      }
    }
    if (activeGoalCount > 1) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Person ${personIdStr}: expected at most 1 active Person Goal, found ${activeGoalCount}`,
      })
    }
  }

  // --- Aim activeTaskId / activeDiplomaticPlayId mutual exclusion ---
  for (const [aimIdStr, aim] of Object.entries(state.aims)) {
    if (!aim || aim.status !== 'active') continue
    let count = 0
    if (aim.activeTaskId) count++
    if (aim.activeDiplomaticPlayId) count++
    if (count > 1) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Aim ${aimIdStr}: has ${count} active refs (activeTaskId/activeDiplomaticPlayId) but at most 1 is allowed`,
      })
    }
  }

  // --- v0.23: Person Goal progress range ---
  for (const [goalIdStr, goal] of Object.entries(state.goals)) {
    if (!goal) continue
    if (goal.owner.kind === 'person') {
      if (goal.progress < 0 || goal.progress > 100) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Person Goal ${goalIdStr}: progress ${goal.progress} outside range [0, 100]`,
        })
      }
    }
  }

  // --- v0.23: support_organization_aim target integrity ---
  for (const [aimIdStr, aim] of Object.entries(state.aims)) {
    if (!aim) continue
    if (aim.kind !== 'support_organization_aim') continue
    if (aim.status !== 'active') continue

    if (!aim.target || aim.target.kind !== 'aim') {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `support_organization_aim ${aimIdStr}: missing or invalid target (expected kind='aim')`,
      })
      continue
    }

    const targetAim = state.aims[aim.target.id]
    if (!targetAim) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `support_organization_aim ${aimIdStr}: target aim ${aim.target.id as string} not found`,
      })
    } else if (targetAim.status !== 'active') {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `support_organization_aim ${aimIdStr}: active but target aim ${aim.target.id as string} is ${targetAim.status}`,
      })
    }
  }

  // --- Project integrity ---
  for (const [idStr, project] of Object.entries(state.projects)) {
    if (!project) continue

    if ((project.id as string) !== idStr) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Project ${idStr}: id mismatch (${project.id})`,
      })
    }

    if (
      project.status === 'completed' ||
      project.status === 'failed' ||
      project.status === 'cancelled'
    ) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Project ${idStr}: terminal project in state (status=${project.status})`,
      })
    }

    const creator = state.persons[project.creatorPersonId]
    if (!creator) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Project ${idStr}: creator ${project.creatorPersonId} does not exist`,
      })
    }

    const supervisor = state.persons[project.supervisorPersonId]
    if (!supervisor) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Project ${idStr}: supervisor ${project.supervisorPersonId} does not exist`,
      })
    } else if (project.status === 'active' && !supervisor.alive) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Project ${idStr}: active project but supervisor ${project.supervisorPersonId} is dead`,
      })
    }

    if (project.origin.kind === 'aim') {
      const aim = state.aims[project.origin.aimId]
      if (!aim) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Project ${idStr}: origin aim ${project.origin.aimId} does not exist`,
        })
      }
    }
  }

  // --- v0.29 §19.2: currentStageKey validation for all project kinds ---
  for (const [idStr, project] of Object.entries(state.projects)) {
    if (!project || project.status !== 'active') continue
    const validKeys = PROJECT_STAGE_SEQUENCES[project.kind]
    if (!validKeys.some((e) => e.key === project.currentStageKey)) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Project ${idStr}: currentStageKey=${project.currentStageKey} is not valid for kind=${project.kind} (§19.2)`,
      })
    }
  }

  // --- v0.27 §19.3-§19.4: develop_holding project checks ---
  {
    const activeDevelopByHolding: Record<string, string[]> = {}

    for (const [idStr, project] of Object.entries(state.projects)) {
      if (!project || project.kind !== 'develop_holding') continue
      if (project.status !== 'active') continue

      // §19.3: ProjectBudget non-negative
      if (project.budget.required < 0) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Project ${idStr}: budget.required=${project.budget.required} must be >= 0 (§19.3)`,
        })
      }
      if (project.budget.allocated < 0) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Project ${idStr}: budget.allocated=${project.budget.allocated} must be >= 0 (§19.3)`,
        })
      }
      if (project.budget.remaining < 0) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Project ${idStr}: budget.remaining=${project.budget.remaining} must be >= 0 (§19.3)`,
        })
      }
      if (project.budget.spent < 0) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Project ${idStr}: budget.spent=${project.budget.spent} must be >= 0 (§19.3)`,
        })
      }

      // §19.3: allocated === remaining + spent
      const budgetSum = project.budget.remaining + project.budget.spent
      if (Math.abs(project.budget.allocated - budgetSum) > 0.01) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Project ${idStr}: budget.allocated (${project.budget.allocated}) !== remaining (${project.budget.remaining}) + spent (${project.budget.spent}) (§19.3)`,
        })
      }

      // §19.3: pre-budget stages should have zero budget allocation
      const stageType = getProjectStageType(project.kind, project.currentStageKey)
      if (stageType === 'immediate') {
        if (
          project.budget.allocated !== 0 ||
          project.budget.remaining !== 0 ||
          project.budget.spent !== 0
        ) {
          if (debug) {
            console.warn(
              `INTEGRITY (§19.3 warn): Project ${idStr}: stage=${project.currentStageKey} but budget allocated/remaining/spent not all zero`,
            )
          }
        }
      }

      // §19.4: holdingId exists
      if (!state.holdings[project.holdingId]) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Project ${idStr}: holdingId=${project.holdingId as string} does not exist (§19.4)`,
        })
      }

      // §19.4: improvementKind is valid
      if (!VALID_HOLDING_IMPROVEMENT_KINDS.has(project.improvementKind)) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Project ${idStr}: improvementKind=${project.improvementKind} is not valid (§19.4)`,
        })
      }

      // §19.4: targetImprovementLevel <= max level
      const holding = state.holdings[project.holdingId]
      if (holding && config) {
        // v0.33 §13.2: access 反転。0（未定義含む）= 建設不可。
        const maxLevel =
          config.holdingImprovementMaxLevelByKind[project.improvementKind][holding.kind] ?? 0
        if (project.targetImprovementLevel > maxLevel) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `Project ${idStr}: targetImprovementLevel=${project.targetImprovementLevel} exceeds max ${maxLevel} for ${holding.kind}/${project.improvementKind} (§19.4)`,
          })
        }
      }

      // §19.4: at most 1 active develop_holding per holdingId
      const holdingKey = project.holdingId as string
      const activeList = activeDevelopByHolding[holdingKey] ?? []
      activeList.push(idStr)
      activeDevelopByHolding[holdingKey] = activeList
    }

    for (const [holdingKey, projectIds] of Object.entries(activeDevelopByHolding)) {
      if (projectIds.length > 1) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Holding ${holdingKey}: ${projectIds.length} active develop_holding projects (limit 1) (§19.4)`,
        })
      }
    }
  }

  // Project index forward consistency
  for (const [key, pids] of Object.entries(state.projectIndex.byOwner)) {
    for (const pid of pids ?? []) {
      const p = state.projects[pid]
      if (!p) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `projectIndex.byOwner[${key}]: project ${pid} does not exist`,
        })
      } else if (decisionSubjectKey(p.owner) !== key) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `projectIndex.byOwner[${key}]: project ${pid} has owner ${decisionSubjectKey(p.owner)}`,
        })
      }
    }
  }

  for (const [key, pids] of Object.entries(state.projectIndex.byAim)) {
    for (const pid of pids ?? []) {
      const p = state.projects[pid]
      if (!p) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `projectIndex.byAim[${key}]: project ${pid} does not exist`,
        })
      }
    }
  }

  for (const [key, pids] of Object.entries(state.projectIndex.byCreatorPerson)) {
    for (const pid of pids ?? []) {
      const p = state.projects[pid]
      if (!p) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `projectIndex.byCreatorPerson[${key}]: project ${pid} does not exist`,
        })
      }
    }
  }

  for (const [key, pids] of Object.entries(state.projectIndex.bySupervisorPerson)) {
    for (const pid of pids ?? []) {
      const p = state.projects[pid]
      if (!p) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `projectIndex.bySupervisorPerson[${key}]: project ${pid} does not exist`,
        })
      }
    }
  }

  // Task targetRef project validation
  for (const [, task] of Object.entries(state.tasks)) {
    if (!task || task.status !== 'active') continue
    if (task.targetRef.kind === 'project') {
      const project = state.projects[task.targetRef.id]
      if (!project) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Task ${task.id}: targetRef project ${task.targetRef.id} does not exist`,
        })
      }
    }
  }

  // --- v0.29 §30: diplomatic Project diplomaticPlayId validation ---
  for (const [idStr, project] of Object.entries(state.projects)) {
    if (!project || project.status !== 'active') continue
    if (!isDiplomaticProjectKind(project.kind)) continue
    const dpProject = project as
      | LandClaimProject
      | ContractRevisionProject
      | RespondToPressureProject
    if (dpProject.diplomaticPlayId) {
      const play = state.diplomaticPlays[dpProject.diplomaticPlayId]
      if (!play) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Project ${idStr}: diplomaticPlayId ${dpProject.diplomaticPlayId as string} does not exist (§30)`,
        })
      }
    }
  }

  // --- Pressure integrity ---

  // P1: Each Pressure's references must be valid
  for (const [pidStr, pressure] of Object.entries(state.pressures)) {
    if (!pressure) continue

    // Terminal pressures should be purged by cleanupTerminalDiplomacy
    if (pressure.status === 'resolved' || pressure.status === 'cancelled') {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Pressure ${pidStr}: terminal status '${pressure.status}' should have been cleaned up`,
      })
    }

    // relatedDiplomaticPlayId must reference existing DiplomaticPlay
    if (pressure.relatedDiplomaticPlayId) {
      const play = state.diplomaticPlays[pressure.relatedDiplomaticPlayId]
      if (!play) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Pressure ${pidStr}: relatedDiplomaticPlayId ${pressure.relatedDiplomaticPlayId as string} does not exist`,
        })
      }
    }

    // responseProjectId must reference a Project with kind === 'respond_to_pressure' if it still exists.
    // Projects are purged from state once terminal, so a missing project is acceptable (stale reference).
    if (pressure.responseProjectId) {
      const project = state.projects[pressure.responseProjectId]
      if (project && project.kind !== 'respond_to_pressure') {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Pressure ${pidStr}: responseProjectId ${pressure.responseProjectId as string} has kind '${project.kind}', expected 'respond_to_pressure'`,
        })
      }
    }
  }

  // P2: Each active respond_to_pressure Project's pressureId must reference existing Pressure
  for (const [projIdStr, project] of Object.entries(state.projects)) {
    if (!project) continue
    if (project.kind !== 'respond_to_pressure') continue
    if (
      project.status === 'completed' ||
      project.status === 'failed' ||
      project.status === 'cancelled'
    )
      continue

    const pressure = state.pressures[project.pressureId]
    if (!pressure) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Project ${projIdStr} (respond_to_pressure): pressureId ${project.pressureId as string} does not exist`,
      })
    }
  }

  // P3: pressureIndex consistency
  for (const [key, pids] of Object.entries(state.pressureIndex.byTarget)) {
    for (const pid of pids ?? []) {
      const pressure = state.pressures[pid]
      if (!pressure) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `pressureIndex.byTarget[${key}]: pressure ${pid as string} does not exist`,
        })
      } else if (decisionSubjectKey(pressure.target) !== key) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `pressureIndex.byTarget[${key}]: pressure ${pid as string} has target ${decisionSubjectKey(pressure.target)}`,
        })
      }
    }
  }

  for (const [key, pids] of Object.entries(state.pressureIndex.bySource)) {
    for (const pid of pids ?? []) {
      const pressure = state.pressures[pid]
      if (!pressure) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `pressureIndex.bySource[${key}]: pressure ${pid as string} does not exist`,
        })
      } else if (decisionSubjectKey(pressure.source) !== key) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `pressureIndex.bySource[${key}]: pressure ${pid as string} has source ${decisionSubjectKey(pressure.source)}`,
        })
      }
    }
  }

  for (const [key, pids] of Object.entries(state.pressureIndex.byDiplomaticPlay)) {
    for (const pid of pids ?? []) {
      const pressure = state.pressures[pid]
      if (!pressure) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `pressureIndex.byDiplomaticPlay[${key}]: pressure ${pid as string} does not exist`,
        })
      } else if ((pressure.relatedDiplomaticPlayId as string) !== key) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `pressureIndex.byDiplomaticPlay[${key}]: pressure ${pid as string} has relatedDiplomaticPlayId ${pressure.relatedDiplomaticPlayId as string}`,
        })
      }
    }
  }

  for (const [key, pids] of Object.entries(state.pressureIndex.byProject)) {
    for (const pid of pids ?? []) {
      const pressure = state.pressures[pid]
      if (!pressure) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `pressureIndex.byProject[${key}]: pressure ${pid as string} does not exist`,
        })
      } else if ((pressure.responseProjectId as string) !== key) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `pressureIndex.byProject[${key}]: pressure ${pid as string} has responseProjectId ${pressure.responseProjectId as string}`,
        })
      }
    }
  }

  // ─── Chronicle index ↔ entry 内部整合 (v0.38 §7.1) ───
  //   index↔entry の構造整合のみ検査する。entityRefs の参照先が現在 state に存在するか
  //   (active か / 死亡人物か / 断絶家か / 終了 War か) は検査しない (soft-ref。§7.1)。
  //   index 対象は person/house/polity/province/holding の 5 kind のみ。
  const chronicleIndexAxes: ReadonlyArray<{
    kind: 'person' | 'house' | 'polity' | 'province' | 'holding'
    label: string
    index: Record<string, ChronicleEntryId[]>
  }> = [
    { kind: 'person', label: 'byPerson', index: state.chronicleIndex.byPerson },
    { kind: 'house', label: 'byHouse', index: state.chronicleIndex.byHouse },
    { kind: 'polity', label: 'byPolity', index: state.chronicleIndex.byPolity },
    { kind: 'province', label: 'byProvince', index: state.chronicleIndex.byProvince },
    { kind: 'holding', label: 'byHolding', index: state.chronicleIndex.byHolding },
  ]
  // forward: index に載る entry id が実在し、その entityRefs に (kind, key) を含む
  for (const axis of chronicleIndexAxes) {
    for (const [key, eids] of Object.entries(axis.index)) {
      for (const eid of eids ?? []) {
        const entry = state.chronicleEntries[eid]
        if (!entry) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `chronicleIndex.${axis.label}[${key}] references missing ChronicleEntry ${eid as string} (v0.38 §7.1)`,
          })
          continue
        }
        if (!entry.entityRefs.some((r) => r.kind === axis.kind && r.id === key)) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `chronicleIndex.${axis.label}[${key}] entry ${eid as string} has no matching ${axis.kind} entityRef (v0.38 §7.1)`,
          })
        }
      }
    }
  }
  // reverse: 各 entry の 5 index 対象 kind の ref が、対応 index に entry id として登録済み
  {
    const bucketByKind: Partial<Record<string, Record<string, ChronicleEntryId[]>>> = {
      person: state.chronicleIndex.byPerson,
      house: state.chronicleIndex.byHouse,
      polity: state.chronicleIndex.byPolity,
      province: state.chronicleIndex.byProvince,
      holding: state.chronicleIndex.byHolding,
    }
    for (const [eidStr, entry] of Object.entries(state.chronicleEntries)) {
      for (const r of entry.entityRefs) {
        const bucket = bucketByKind[r.kind]
        if (!bucket) continue // faction/clan 等 index 非対象 kind は検査しない (§5.2)
        const indexed = bucket[r.id] ?? []
        if (!indexed.includes(entry.id)) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `ChronicleEntry ${eidStr} ${r.kind} ref ${r.id} is not registered in chronicleIndex (v0.38 §7.1)`,
          })
        }
      }
    }
  }

  return errors
}

export function runIntegritySystem(ctx: TickContext): TickContext {
  const errors = collectIntegrityErrors(ctx.state, { debug: ctx.config.debug, config: ctx.config })

  if (errors.length > 0) {
    for (const error of errors) {
      console.error('INTEGRITY:', error.message)
    }
    throw new Error(`Integrity check failed with ${errors.length} error(s): ${errors[0]?.message}`)
  }

  return ctx
}
