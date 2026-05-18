import type { WorldState } from '../types/world'
import type {
  ProvinceId,
  PolityId,
  LandContractId,
} from '../types/ids'
import type {
  LandContract,
  LandContractIndex,
  ProvinceTerminalPolityCache,
  RootAuthorityId,
} from '../types/landContract'
import { ROOT_WORLD } from '../types/landContract'
import { createLandContractId } from '../types/ids'
import { clampTaxRate } from '../helpers/landContractHelpers'

type CreateRootContractParams = {
  provinceId: ProvinceId
  granteePolityId: PolityId
  rootAuthorityId?: RootAuthorityId
}

type CreateChildContractParams = {
  provinceId: ProvinceId
  parentContractId: LandContractId
  granteePolityId: PolityId
  taxRateToGrantor: number
}

type CreateResult = {
  state: WorldState
  contractId: LandContractId
}

function emptyChainSlot(
  index: LandContractIndex,
  provinceId: ProvinceId,
): LandContractId[] {
  return index.byProvince[provinceId] ?? []
}

function emptyGranteeSlot(
  index: LandContractIndex,
  polityId: PolityId,
): LandContractId[] {
  return index.byGranteePolity[polityId] ?? []
}

function recomputeTerminalCache(
  state: WorldState,
  provinceId: ProvinceId,
): ProvinceTerminalPolityCache {
  const ids = state.landContractIndex.byProvince[provinceId] ?? []
  const terminalId = ids[ids.length - 1]
  if (!terminalId) {
    const next = { ...state.provinceTerminalPolityCache }
    delete next[provinceId]
    return next
  }
  const terminal = state.landContracts[terminalId]
  if (!terminal) return state.provinceTerminalPolityCache
  return {
    ...state.provinceTerminalPolityCache,
    [provinceId]: terminal.granteePolityId,
  }
}

export function createRootLandContract(
  state: WorldState,
  params: CreateRootContractParams,
): CreateResult {
  const id = createLandContractId(state.nextLandContractId)
  const rootAuthorityId = params.rootAuthorityId ?? ROOT_WORLD
  const contract: LandContract = {
    id,
    provinceId: params.provinceId,
    rootAuthorityId,
    granteePolityId: params.granteePolityId,
    terms: { taxRateToGrantor: 0 },
  }
  const chain = emptyChainSlot(state.landContractIndex, params.provinceId)
  const granteeSlot = emptyGranteeSlot(state.landContractIndex, params.granteePolityId)
  const nextState: WorldState = {
    ...state,
    landContracts: { ...state.landContracts, [id]: contract },
    landContractIndex: {
      byProvince: { ...state.landContractIndex.byProvince, [params.provinceId]: [...chain, id] },
      byGranteePolity: {
        ...state.landContractIndex.byGranteePolity,
        [params.granteePolityId]: [...granteeSlot, id],
      },
      byParent: { ...state.landContractIndex.byParent },
    },
    nextLandContractId: state.nextLandContractId + 1,
  }
  return {
    state: { ...nextState, provinceTerminalPolityCache: recomputeTerminalCache(nextState, params.provinceId) },
    contractId: id,
  }
}

export function createChildLandContract(
  state: WorldState,
  params: CreateChildContractParams,
): CreateResult {
  const id = createLandContractId(state.nextLandContractId)
  const contract: LandContract = {
    id,
    provinceId: params.provinceId,
    parentContractId: params.parentContractId,
    granteePolityId: params.granteePolityId,
    terms: { taxRateToGrantor: clampTaxRate(params.taxRateToGrantor) },
  }
  const chain = emptyChainSlot(state.landContractIndex, params.provinceId)
  const granteeSlot = emptyGranteeSlot(state.landContractIndex, params.granteePolityId)
  const nextState: WorldState = {
    ...state,
    landContracts: { ...state.landContracts, [id]: contract },
    landContractIndex: {
      byProvince: { ...state.landContractIndex.byProvince, [params.provinceId]: [...chain, id] },
      byGranteePolity: {
        ...state.landContractIndex.byGranteePolity,
        [params.granteePolityId]: [...granteeSlot, id],
      },
      byParent: { ...state.landContractIndex.byParent, [params.parentContractId]: id },
    },
    nextLandContractId: state.nextLandContractId + 1,
  }
  return {
    state: { ...nextState, provinceTerminalPolityCache: recomputeTerminalCache(nextState, params.provinceId) },
    contractId: id,
  }
}

export function adjustLandContractTaxRate(
  state: WorldState,
  contractId: LandContractId,
  newRate: number,
): WorldState {
  const contract = state.landContracts[contractId]
  if (!contract) return state
  if (contract.parentContractId === undefined) return state
  const next: LandContract = {
    ...contract,
    terms: { taxRateToGrantor: clampTaxRate(newRate) },
  }
  return {
    ...state,
    landContracts: { ...state.landContracts, [contractId]: next },
  }
}

export function transferLandContractGrantee(
  state: WorldState,
  contractId: LandContractId,
  newGranteePolityId: PolityId,
): WorldState {
  const contract = state.landContracts[contractId]
  if (!contract) return state
  if (contract.granteePolityId === newGranteePolityId) return state

  const oldGranteeSlot = state.landContractIndex.byGranteePolity[contract.granteePolityId] ?? []
  const oldGranteeNext = oldGranteeSlot.filter((id) => id !== contractId)
  const newGranteeSlot = state.landContractIndex.byGranteePolity[newGranteePolityId] ?? []

  const nextContract: LandContract = { ...contract, granteePolityId: newGranteePolityId }
  const nextState: WorldState = {
    ...state,
    landContracts: { ...state.landContracts, [contractId]: nextContract },
    landContractIndex: {
      byProvince: state.landContractIndex.byProvince,
      byGranteePolity: {
        ...state.landContractIndex.byGranteePolity,
        [contract.granteePolityId]: oldGranteeNext,
        [newGranteePolityId]: [...newGranteeSlot, contractId],
      },
      byParent: state.landContractIndex.byParent,
    },
  }
  return {
    ...nextState,
    provinceTerminalPolityCache: recomputeTerminalCache(nextState, contract.provinceId),
  }
}

export function transferAllProvincesToPolity(
  state: WorldState,
  fromPolityId: PolityId,
  toPolityId: PolityId,
): WorldState {
  let next = state
  const contractIds = [...(state.landContractIndex.byGranteePolity[fromPolityId] ?? [])]
  for (const contractId of contractIds) {
    next = transferLandContractGrantee(next, contractId, toPolityId)
  }
  return next
}
