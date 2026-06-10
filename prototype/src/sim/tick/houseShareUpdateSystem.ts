import type { TickContext } from './context'
import type { PersonId, HouseId, HouseShareId } from '@sim/types/ids'
import { createHouseShareId } from '@sim/types/ids'
import type { WorldState } from '@sim/types/world'
import type { SimulationConfig } from '@sim/config/defaultConfig'
import type { OrganizationRef } from '@sim/types/office'
import { createHouseShare } from '@sim/mutations/shareMutations'
import { getHouseShares } from '@sim/selectors/shareSelectors'
import { getHouseLeader } from '@sim/selectors/officeSelectors'
import { getOfficeAssignments } from '@sim/selectors/officeSelectors'
import { getRoleScore } from '@sim/selectors/abilitySelectors'
import { getHousePrimaryPolityId } from '@sim/selectors/polityRelations'
import { getPersonOrganizationReputationSum } from '@sim/selectors/personReputationSelectors'

// perf (v0.47): mutable-draft パターン。かつては shareMutations の per-call 版
//   (transferShareRawPower / removeHouseShare / upsertHouseShare) が呼び出しごとに
//   houseShares (432) + index 2 マップを spread していた (生存メンバー数 × 4週ごと、
//   decade1→10 で 10-12 倍成長)。draft は run 冒頭で 3 マップを各 1 回浅コピーし、以降の
//   インライン Mut 版は shareMutations の per-call 版と同一系列でキー追加/削除/置換を行う
//   (ID 採番順・index 配列の filter/append 順・空配列キー残置を含めて挙動同一)。
//   index 配列は常に新規配列を代入し、元 state 側の配列は破壊しない。
//   shareMutations.ts 側を変更する場合はこの複製ロジックも要同期。
export function runHouseShareUpdateSystem(ctx: TickContext): TickContext {
  const config = ctx.config
  const draft: WorldState = {
    ...ctx.state,
    houseShares: { ...ctx.state.houseShares },
    houseShareIndex: {
      byHouse: { ...ctx.state.houseShareIndex.byHouse },
      byHolderPerson: { ...ctx.state.houseShareIndex.byHolderPerson },
    },
  }

  // shareMutations.createHouseShare と同一挙動。
  const createHouseShareMut = (
    houseId: HouseId,
    holderPersonId: PersonId,
    rawPower: number,
  ): void => {
    const id = createHouseShareId(draft.nextHouseShareId)
    draft.nextHouseShareId = draft.nextHouseShareId + 1
    draft.houseShares[id] = { id, houseId, holderPersonId, rawPower }
    draft.houseShareIndex.byHouse[houseId] = [...(draft.houseShareIndex.byHouse[houseId] ?? []), id]
    draft.houseShareIndex.byHolderPerson[holderPersonId] = [
      ...(draft.houseShareIndex.byHolderPerson[holderPersonId] ?? []),
      id,
    ]
  }
  // shareMutations.updateShareRawPower と同一挙動 (share 不在は no-op)。
  const updateShareRawPowerMut = (shareId: HouseShareId, newRawPower: number): void => {
    const share = draft.houseShares[shareId]
    if (!share) return
    draft.houseShares[shareId] = { ...share, rawPower: newRawPower }
  }
  // shareMutations.removeHouseShare と同一挙動 (share 不在は no-op、空配列キーは残す)。
  const removeHouseShareMut = (shareId: HouseShareId): void => {
    const share = draft.houseShares[shareId]
    if (!share) return
    delete draft.houseShares[shareId]
    draft.houseShareIndex.byHouse[share.houseId] = (
      draft.houseShareIndex.byHouse[share.houseId] ?? []
    ).filter((id) => id !== shareId)
    draft.houseShareIndex.byHolderPerson[share.holderPersonId] = (
      draft.houseShareIndex.byHolderPerson[share.holderPersonId] ?? []
    ).filter((id) => id !== shareId)
  }
  // shareMutations.transferShareRawPower と同一挙動 (byHouse スナップショット走査)。
  const transferShareRawPowerMut = (
    fromPersonId: PersonId,
    toPersonId: PersonId,
    houseId: HouseId,
    ratio: number,
  ): void => {
    const ids = [...(draft.houseShareIndex.byHouse[houseId] ?? [])]
    for (const id of ids) {
      const share = draft.houseShares[id]
      if (!share) continue
      if (share.holderPersonId !== fromPersonId) continue

      const transferAmount = share.rawPower * ratio
      const remaining = share.rawPower - transferAmount

      if (remaining <= 0) {
        removeHouseShareMut(id)
      } else {
        updateShareRawPowerMut(id, remaining)
      }

      const toIds = draft.houseShareIndex.byHouse[houseId] ?? []
      let toShareId: HouseShareId | undefined
      for (const tid of toIds) {
        const ts = draft.houseShares[tid]
        if (ts && ts.holderPersonId === toPersonId) {
          toShareId = tid
          break
        }
      }

      if (toShareId) {
        const toShare = draft.houseShares[toShareId]
        if (toShare) updateShareRawPowerMut(toShareId, toShare.rawPower + transferAmount)
      } else {
        createHouseShareMut(houseId, toPersonId, transferAmount)
      }
    }
  }
  // shareMutations.upsertHouseShare と同一挙動。
  const upsertHouseShareMut = (
    houseId: HouseId,
    holderPersonId: PersonId,
    rawPower: number,
  ): void => {
    const ids = draft.houseShareIndex.byHouse[houseId] ?? []
    let existingId: HouseShareId | undefined
    for (const id of ids) {
      const share = draft.houseShares[id]
      if (share && share.holderPersonId === holderPersonId) {
        existingId = id
        break
      }
    }
    if (existingId !== undefined) {
      if (rawPower <= 0) {
        removeHouseShareMut(existingId)
        return
      }
      updateShareRawPowerMut(existingId, rawPower)
      return
    }
    if (rawPower <= 0) return
    createHouseShareMut(houseId, holderPersonId, rawPower)
  }

  // v0.42c: Polity share 枝は削除 (Polity Influence は influenceSelectors の read-model)。
  // 2. Update House Shares for each House
  for (const houseId of Object.keys(draft.houses).sort() as HouseId[]) {
    const house = draft.houses[houseId]
    if (!house || !house.active) continue
    if (house.kind === 'system') continue

    const existingShares = getHouseShares(draft, houseId)

    const leaderId = getHouseLeader(draft, houseId)

    // Handle dead persons: transfer 50% of their share to the leader, delete the rest
    for (const share of existingShares) {
      const person = draft.persons[share.holderPersonId]
      if (!person || person.alive) continue

      // Person is dead
      if (leaderId && leaderId !== share.holderPersonId) {
        transferShareRawPowerMut(share.holderPersonId, leaderId, houseId, 0.5)
      }
      // Delete remaining share for dead person
      const updatedShare = draft.houseShares[share.id]
      if (updatedShare) {
        removeHouseShareMut(share.id)
      }
    }

    // Update living persons
    for (const personId of house.memberIds) {
      const person = draft.persons[personId]
      if (!person || !person.alive) continue

      const isLeader = personId === leaderId
      const newRawPower = computeHouseShareRawPower(draft, config, houseId, personId, isLeader)

      upsertHouseShareMut(houseId, personId, newRawPower)
    }
  }

  return { ...ctx, state: draft }
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
