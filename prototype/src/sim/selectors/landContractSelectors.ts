import type { WorldState } from '../types/world'
import type { ProvinceId, PolityId, HouseId, PersonId, LandContractId } from '../types/ids'
import type { LandContract, LandContractGrantor } from '../types/landContract'
import { ANONYMOUS_HOUSE_ID, ROOT_WORLD } from '../types/landContract'
import type { PolityRank } from '../types/polity'

export function getProvinceLandContractChain(
  state: WorldState,
  provinceId: ProvinceId,
): LandContract[] {
  const ids = state.landContractIndex.byProvince[provinceId] ?? []
  const chain: LandContract[] = []
  for (const id of ids) {
    const contract = state.landContracts[id]
    if (!contract) continue
    chain.push(contract)
  }
  return chain
}

export function getProvinceRootContract(
  state: WorldState,
  provinceId: ProvinceId,
): LandContract | undefined {
  const ids = state.landContractIndex.byProvince[provinceId] ?? []
  const rootId = ids[0]
  if (!rootId) return undefined
  return state.landContracts[rootId]
}

export function getProvinceTerminalContract(
  state: WorldState,
  provinceId: ProvinceId,
): LandContract | undefined {
  const ids = state.landContractIndex.byProvince[provinceId] ?? []
  const terminalId = ids[ids.length - 1]
  if (!terminalId) return undefined
  return state.landContracts[terminalId]
}

export function getProvinceTerminalPolityId(
  state: WorldState,
  provinceId: ProvinceId,
): PolityId | undefined {
  return state.provinceTerminalPolityCache[provinceId]
}

export function getProvinceRootPolityId(
  state: WorldState,
  provinceId: ProvinceId,
): PolityId | undefined {
  const root = getProvinceRootContract(state, provinceId)
  return root?.granteePolityId
}

export function getProvinceOverlordPolityIds(
  state: WorldState,
  provinceId: ProvinceId,
): PolityId[] {
  const chain = getProvinceLandContractChain(state, provinceId)
  if (chain.length <= 1) return []
  return chain.slice(0, -1).map((c) => c.granteePolityId)
}

export function getProvinceEffectiveOwnerHouseId(
  state: WorldState,
  provinceId: ProvinceId,
): HouseId | undefined {
  const terminalPolityId = getProvinceTerminalPolityId(state, provinceId)
  if (!terminalPolityId) return undefined
  const polity = state.polities[terminalPolityId]
  if (!polity) return undefined
  return polity.ownerHouseId
}

export function getPolityGrantedProvinceIds(state: WorldState, polityId: PolityId): ProvinceId[] {
  const contractIds = state.landContractIndex.byGranteePolity[polityId] ?? []
  const result: ProvinceId[] = []
  for (const id of contractIds) {
    const c = state.landContracts[id]
    if (!c) continue
    result.push(c.provinceId)
  }
  return result
}

export function getPolityTerminalProvinceIds(state: WorldState, polityId: PolityId): ProvinceId[] {
  const contractIds = state.landContractIndex.byGranteePolity[polityId] ?? []
  const result: ProvinceId[] = []
  for (const id of contractIds) {
    const c = state.landContracts[id]
    if (!c) continue
    if (state.landContractIndex.byParent[id] !== undefined) continue
    result.push(c.provinceId)
  }
  return result
}

export function getPolityOverlordProvinceIds(state: WorldState, polityId: PolityId): ProvinceId[] {
  const contractIds = state.landContractIndex.byGranteePolity[polityId] ?? []
  const result: ProvinceId[] = []
  for (const id of contractIds) {
    const c = state.landContracts[id]
    if (!c) continue
    if (state.landContractIndex.byParent[id] === undefined) continue
    result.push(c.provinceId)
  }
  return result
}

export function getHouseOwnedPolityIds(state: WorldState, houseId: HouseId): PolityId[] {
  return state.polityIndex.byOwnerHouse[houseId] ?? []
}

export function getHouseControlledProvinceIds(state: WorldState, houseId: HouseId): ProvinceId[] {
  const polityIds = getHouseOwnedPolityIds(state, houseId)
  const seen = new Set<string>()
  const result: ProvinceId[] = []
  for (const polityId of polityIds) {
    for (const provinceId of getPolityTerminalProvinceIds(state, polityId)) {
      const key = provinceId as string
      if (seen.has(key)) continue
      seen.add(key)
      result.push(provinceId)
    }
  }
  return result
}

export function getHouseRelevantProvinceIds(state: WorldState, houseId: HouseId): ProvinceId[] {
  const polityIds = getHouseOwnedPolityIds(state, houseId)
  const seen = new Set<string>()
  const result: ProvinceId[] = []
  for (const polityId of polityIds) {
    for (const provinceId of getPolityGrantedProvinceIds(state, polityId)) {
      const key = provinceId as string
      if (seen.has(key)) continue
      seen.add(key)
      result.push(provinceId)
    }
  }
  return result
}

export function getLandContractGrantor(
  state: WorldState,
  contractId: LandContractId,
): LandContractGrantor | undefined {
  const contract = state.landContracts[contractId]
  if (!contract) return undefined
  if (contract.parentContractId !== undefined) {
    const parent = state.landContracts[contract.parentContractId]
    if (!parent) return undefined
    return { kind: 'polity', id: parent.granteePolityId }
  }
  return { kind: 'root', id: contract.rootAuthorityId ?? ROOT_WORLD }
}

export function getGrantorRank(state: WorldState, grantor: LandContractGrantor): number {
  if (grantor.kind === 'root') return 0
  const polity = state.polities[grantor.id]
  if (!polity) return 0
  return polity.rank
}

export type ClaimTargetMatch = {
  contract: LandContract
  polityId: PolityId
  matchType: 'same' | 'lower' | 'upper'
}

export function findClaimTargetInChain(
  state: WorldState,
  provinceId: ProvinceId,
  claimerRank: PolityRank,
): ClaimTargetMatch | undefined {
  const chain = getProvinceLandContractChain(state, provinceId)
  let sameRank: ClaimTargetMatch | undefined
  let closestLower: ClaimTargetMatch | undefined
  let closestUpper: ClaimTargetMatch | undefined

  for (const contract of chain) {
    const polity = state.polities[contract.granteePolityId]
    if (!polity || !polity.active) continue

    if (polity.rank === claimerRank) {
      sameRank = { contract, polityId: contract.granteePolityId, matchType: 'same' }
      break
    }
    if (polity.rank > claimerRank) {
      if (!closestLower || polity.rank < state.polities[closestLower.polityId]!.rank) {
        closestLower = { contract, polityId: contract.granteePolityId, matchType: 'lower' }
      }
    }
    if (polity.rank < claimerRank) {
      if (!closestUpper || polity.rank > state.polities[closestUpper.polityId]!.rank) {
        closestUpper = { contract, polityId: contract.granteePolityId, matchType: 'upper' }
      }
    }
  }

  return sameRank ?? closestLower ?? closestUpper
}

export function isPlaceholderPerson(state: WorldState, personId: PersonId): boolean {
  const person = state.persons[personId]
  if (!person) return false
  return person.kind === 'placeholder'
}

export function getAnonymousHouseId(): HouseId {
  return ANONYMOUS_HOUSE_ID
}

export function isSystemHouse(state: WorldState, houseId: HouseId): boolean {
  const house = state.houses[houseId]
  if (!house) return false
  return house.kind === 'system'
}
