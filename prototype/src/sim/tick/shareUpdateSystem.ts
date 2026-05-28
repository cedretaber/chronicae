import type { TickContext } from './context'
import type { PersonId, PolityId, HouseId } from '@sim/types/ids'
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
import { getHousePolityOfficeOverlapScore } from '@sim/selectors/officeSelectors'
import {
  getHousePrimaryPolityId,
  getHouseProvinceIdsByPolity,
  getPolityHouseIds,
} from '@sim/selectors/polityRelations'

export function runShareUpdateSystem(ctx: TickContext): TickContext {
  let state = ctx.state
  const config = ctx.config

  // 1. Update Polity Shares for each Polity
  // 通常 holder: House (各 active House について本 system が rawPower を年次再計算する)
  // 例外 holder: Person (§17 commonwealth / 独裁者・僭主)。Rebel Polity 生成時に
  //   worldStructureMutations.createRebelPolity が初期値 100 を 1 度だけ設定する。
  //   本 system は touch しない (rebel leader 死亡時の整合は OrganizationConsistencySystem が
  //   削除する)。Person holder の rawPower を年次変動させる仕様は将来検討。
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

      // v0.17 §16.2: House/Polity Office overlap bonus to House holder's Polity Share rawPower.
      // Person holder (commonwealth / rebel) は対象外 (§16.2 末尾の注意)。
      const overlapScore = getHousePolityOfficeOverlapScore(state, houseId, polityId)
      const adjustedRawPower =
        calculatedRawPower * (1 + overlapScore * config.polityShareOfficeOverlapBonusMax)
      const newRawPower = adjustedRawPower * config.shareYearlyRetentionRate

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
