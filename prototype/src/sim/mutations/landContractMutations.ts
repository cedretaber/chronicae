import type { WorldState } from '../types/world'
import type { ProvinceId, PolityId, LandContractId } from '../types/ids'
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

function emptyChainSlot(index: LandContractIndex, provinceId: ProvinceId): LandContractId[] {
  return index.byProvince[provinceId] ?? []
}

function emptyGranteeSlot(index: LandContractIndex, polityId: PolityId): LandContractId[] {
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
    state: {
      ...nextState,
      provinceTerminalPolityCache: recomputeTerminalCache(nextState, params.provinceId),
    },
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
    state: {
      ...nextState,
      provinceTerminalPolityCache: recomputeTerminalCache(nextState, params.provinceId),
    },
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

// v0.16 §16.1 case B: 既存 contract の上に中間 contract (新 grantee) を挿入する。
// chain の terminal の直前に挿入し、新 contract が terminal の親、新 contract の親が旧 terminal-1 contract になる。
export function insertIntermediateLandContract(
  state: WorldState,
  params: {
    provinceId: ProvinceId
    belowContractId: LandContractId
    newGranteePolityId: PolityId
    taxRateToGrantor: number
  },
): { state: WorldState; contractId: LandContractId } {
  const below = state.landContracts[params.belowContractId]
  if (!below) return { state, contractId: '' as LandContractId }

  const chain = state.landContractIndex.byProvince[params.provinceId] ?? []
  const belowIdx = chain.findIndex((cid) => cid === params.belowContractId)
  if (belowIdx === -1) return { state, contractId: '' as LandContractId }

  const id = createLandContractId(state.nextLandContractId)
  const oldParentId = below.parentContractId
  const newContract: LandContract = {
    id,
    provinceId: params.provinceId,
    granteePolityId: params.newGranteePolityId,
    terms: { taxRateToGrantor: clampTaxRate(params.taxRateToGrantor) },
    ...(oldParentId !== undefined
      ? { parentContractId: oldParentId }
      : { rootAuthorityId: below.rootAuthorityId ?? ROOT_WORLD }),
  }

  const updatedBelow: LandContract = {
    ...below,
    parentContractId: id,
  }
  delete (updatedBelow as { rootAuthorityId?: RootAuthorityId }).rootAuthorityId

  const newChain = [...chain.slice(0, belowIdx), id, ...chain.slice(belowIdx)]
  const granteeSlot = emptyGranteeSlot(state.landContractIndex, params.newGranteePolityId)
  // byParent は「parent → 直下 child」方向 (mutations/createChildLandContract と同じ)
  const newByParent = { ...state.landContractIndex.byParent }
  // 旧 oldParent → below を上書きして oldParent → new に
  if (oldParentId !== undefined) {
    newByParent[oldParentId] = id
  }
  // new → below を登録
  newByParent[id] = params.belowContractId

  const nextState: WorldState = {
    ...state,
    landContracts: {
      ...state.landContracts,
      [id]: newContract,
      [params.belowContractId]: updatedBelow,
    },
    landContractIndex: {
      byProvince: { ...state.landContractIndex.byProvince, [params.provinceId]: newChain },
      byGranteePolity: {
        ...state.landContractIndex.byGranteePolity,
        [params.newGranteePolityId]: [...granteeSlot, id],
      },
      byParent: newByParent,
    },
    nextLandContractId: state.nextLandContractId + 1,
  }
  return {
    state: {
      ...nextState,
      provinceTerminalPolityCache: recomputeTerminalCache(nextState, params.provinceId),
    },
    contractId: id,
  }
}

// v0.16 §16.1 case B 変種: 勝者 Polity が既に overlord として chain 上に存在する場合、
// 勝者 contract と敗者 (terminal) contract の間にある中間 contract をすべて除去する。
// 戻り値: 残った chain.
export function replaceLowerLandContract(
  state: WorldState,
  params: { provinceId: ProvinceId; winnerPolityId: PolityId },
): WorldState {
  const chain = state.landContractIndex.byProvince[params.provinceId] ?? []
  if (chain.length === 0) return state

  let winnerIdx = -1
  for (let i = 0; i < chain.length; i++) {
    const cid = chain[i]
    if (!cid) continue
    const c = state.landContracts[cid]
    if (!c) continue
    if (c.granteePolityId === params.winnerPolityId) {
      winnerIdx = i
      break
    }
  }
  if (winnerIdx === -1) return state
  if (winnerIdx === chain.length - 1) return state

  const toRemove = chain.slice(winnerIdx + 1, chain.length - 1)
  if (toRemove.length === 0) return state

  let nextLandContracts = { ...state.landContracts }
  let nextByGrantee = { ...state.landContractIndex.byGranteePolity }
  const nextByParent = { ...state.landContractIndex.byParent }
  for (const cid of toRemove) {
    const removed = state.landContracts[cid]
    if (!removed) continue
    delete nextLandContracts[cid]
    const slot = nextByGrantee[removed.granteePolityId] ?? []
    nextByGrantee = {
      ...nextByGrantee,
      [removed.granteePolityId]: slot.filter((id) => id !== cid),
    }
    delete nextByParent[cid]
  }

  const winnerId = chain[winnerIdx]
  const terminalId = chain[chain.length - 1]
  const terminal = terminalId ? state.landContracts[terminalId] : undefined
  if (!winnerId || !terminalId || !terminal) return state

  const updatedTerminal: LandContract = {
    ...terminal,
    parentContractId: winnerId,
  }
  delete (updatedTerminal as { rootAuthorityId?: RootAuthorityId }).rootAuthorityId
  nextLandContracts = { ...nextLandContracts, [terminalId]: updatedTerminal }
  // byParent は parent → child 方向。winner contract の直下を terminal に更新する。
  nextByParent[winnerId] = terminalId

  const newChain = [...chain.slice(0, winnerIdx + 1), terminalId]
  const nextState: WorldState = {
    ...state,
    landContracts: nextLandContracts,
    landContractIndex: {
      byProvince: { ...state.landContractIndex.byProvince, [params.provinceId]: newChain },
      byGranteePolity: nextByGrantee,
      byParent: nextByParent,
    },
  }
  return {
    ...nextState,
    provinceTerminalPolityCache: recomputeTerminalCache(nextState, params.provinceId),
  }
}

// v0.16 §18: 金銭による LandContract 譲渡。
// terminal の grantee を seller (現在の terminal Polity) から buyer に差し替え、
// buyer.treasury から seller.treasury に price を移す。
// 同 rank 制約 (case A 相当) を満たすことが前提。caller が rank と隣接性をチェックする。
export function purchaseLandContract(
  state: WorldState,
  params: {
    provinceId: ProvinceId
    buyerPolityId: PolityId
    sellerPolityId: PolityId
    price: number
  },
): WorldState {
  const buyer = state.polities[params.buyerPolityId]
  const seller = state.polities[params.sellerPolityId]
  if (!buyer || !seller) return state
  if (buyer.treasury < params.price) return state

  // terminal grantee swap (case A semantics)
  const terminalContractId = state.landContractIndex.byProvince[params.provinceId]?.slice(-1)[0]
  if (!terminalContractId) return state
  const terminal = state.landContracts[terminalContractId]
  if (!terminal) return state
  if (terminal.granteePolityId !== params.sellerPolityId) return state

  let nextState = transferLandContractGrantee(state, terminalContractId, params.buyerPolityId)

  // treasury 移動
  const nextPolities = { ...nextState.polities }
  nextPolities[params.buyerPolityId] = {
    ...buyer,
    treasury: Math.max(0, buyer.treasury - params.price),
  }
  nextPolities[params.sellerPolityId] = {
    ...seller,
    treasury: seller.treasury + params.price,
  }
  nextState = { ...nextState, polities: nextPolities }

  return nextState
}

// v0.16 §16.1: contract を削除する。terminal でない contract を消すと chain が断絶するので、
// 削除前に caller が chain 整合性 (例えば terminal を root に昇格させる) を担保する責務がある。
export function revokeLandContract(state: WorldState, contractId: LandContractId): WorldState {
  const contract = state.landContracts[contractId]
  if (!contract) return state

  const chain = state.landContractIndex.byProvince[contract.provinceId] ?? []
  const newChain = chain.filter((cid) => cid !== contractId)
  const granteeSlot = state.landContractIndex.byGranteePolity[contract.granteePolityId] ?? []
  // byParent は parent → child 方向。
  // 旧: parent → contractId, contractId → child
  // 新: parent → child (contractId をスキップ)
  const newByParent = { ...state.landContractIndex.byParent }
  const oldChild: LandContractId | undefined = newByParent[contractId]
  delete newByParent[contractId]
  if (contract.parentContractId !== undefined) {
    if (oldChild !== undefined) {
      newByParent[contract.parentContractId] = oldChild
    } else {
      delete newByParent[contract.parentContractId]
    }
  }

  const nextLandContracts = { ...state.landContracts }
  delete nextLandContracts[contractId]

  const nextState: WorldState = {
    ...state,
    landContracts: nextLandContracts,
    landContractIndex: {
      byProvince: { ...state.landContractIndex.byProvince, [contract.provinceId]: newChain },
      byGranteePolity: {
        ...state.landContractIndex.byGranteePolity,
        [contract.granteePolityId]: granteeSlot.filter((id) => id !== contractId),
      },
      byParent: newByParent,
    },
  }
  return {
    ...nextState,
    provinceTerminalPolityCache: recomputeTerminalCache(nextState, contract.provinceId),
  }
}
