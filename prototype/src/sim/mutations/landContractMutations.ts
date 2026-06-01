import type { WorldState } from '../types/world'
import type { ProvinceId, PolityId, LandContractId, HoldingId } from '../types/ids'
import type {
  LandContract,
  LandContractIndex,
  RootAuthorityId,
  LandContractSpecialStatus,
} from '../types/landContract'
import { ROOT_WORLD } from '../types/landContract'
import { createLandContractId } from '../types/ids'
import { clampTaxRate } from '../helpers/landContractHelpers'
import type { TickContext } from '../tick/context'
import { createSimEvent } from '../tick/context'
import { entityRef, nameParam } from '../types/event'
import type { CtxResult } from './result'
import { ok, err } from './result'
import {
  getHoldingLandContractChain,
  getLandContractGrantor,
  getGrantorRank,
} from '../selectors/landContractSelectors'

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
  holdingId?: HoldingId
  specialStatus?: LandContractSpecialStatus
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

function recomputeHoldingTerminalCache(
  state: WorldState,
  provinceId: ProvinceId,
): WorldState['holdingTerminalPolityCache'] {
  const province = state.provinces[provinceId]
  if (!province) return state.holdingTerminalPolityCache
  const nextCache = { ...state.holdingTerminalPolityCache }
  for (const hid of province.holdingIds) {
    const holdingChain = state.landContractIndex.byHolding[hid] ?? []
    const terminalId = holdingChain[holdingChain.length - 1]
    if (!terminalId) {
      delete nextCache[hid]
      continue
    }
    const terminal = state.landContracts[terminalId]
    if (!terminal) {
      delete nextCache[hid]
      continue
    }
    nextCache[hid] = terminal.granteePolityId
  }
  return nextCache
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
      byHolding: state.landContractIndex.byHolding,
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
      holdingTerminalPolityCache: recomputeHoldingTerminalCache(nextState, params.provinceId),
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
    ...(params.specialStatus ? { specialStatus: params.specialStatus } : {}),
  }
  const chain = emptyChainSlot(state.landContractIndex, params.provinceId)
  const granteeSlot = emptyGranteeSlot(state.landContractIndex, params.granteePolityId)
  const nextState: WorldState = {
    ...state,
    landContracts: { ...state.landContracts, [id]: contract },
    landContractIndex: {
      byProvince: params.holdingId
        ? state.landContractIndex.byProvince
        : { ...state.landContractIndex.byProvince, [params.provinceId]: [...chain, id] },
      byHolding: params.holdingId
        ? {
            ...state.landContractIndex.byHolding,
            [params.holdingId]: [
              ...(state.landContractIndex.byHolding[params.holdingId] ?? []),
              id,
            ],
          }
        : state.landContractIndex.byHolding,
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
      holdingTerminalPolityCache: recomputeHoldingTerminalCache(nextState, params.provinceId),
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
      byHolding: state.landContractIndex.byHolding,
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
    holdingTerminalPolityCache: recomputeHoldingTerminalCache(nextState, contract.provinceId),
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
    holdingId?: HoldingId
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
      byProvince: params.holdingId
        ? state.landContractIndex.byProvince
        : { ...state.landContractIndex.byProvince, [params.provinceId]: newChain },
      byHolding: params.holdingId
        ? (() => {
            const holdingChain = state.landContractIndex.byHolding[params.holdingId] ?? []
            const hIdx = holdingChain.findIndex((cid) => cid === params.belowContractId)
            const newHoldingChain =
              hIdx >= 0
                ? [...holdingChain.slice(0, hIdx), id, ...holdingChain.slice(hIdx)]
                : [...holdingChain, id]
            return { ...state.landContractIndex.byHolding, [params.holdingId]: newHoldingChain }
          })()
        : state.landContractIndex.byHolding,
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
      holdingTerminalPolityCache: recomputeHoldingTerminalCache(nextState, params.provinceId),
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
      byHolding: state.landContractIndex.byHolding,
      byGranteePolity: nextByGrantee,
      byParent: nextByParent,
    },
  }
  return {
    ...nextState,
    holdingTerminalPolityCache: recomputeHoldingTerminalCache(nextState, params.provinceId),
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

export type LandContractTransferReason = 'purchase' | 'cession' | 'war' | 'revolt'

export function applyLandContractTransferGoal(
  ctx: TickContext,
  input: {
    holdingId: HoldingId
    fromPolityId: PolityId
    toPolityId: PolityId
    reason: LandContractTransferReason
  },
): CtxResult<void> {
  const state = ctx.state
  const holding = state.holdings[input.holdingId]
  if (!holding) {
    return err({
      code: 'HOLDING_NOT_FOUND',
      message: `applyLandContractTransferGoal: holding ${input.holdingId} not found`,
    })
  }
  const provinceId = holding.provinceId
  const province = state.provinces[provinceId]
  if (!province) {
    return err({
      code: 'PROVINCE_NOT_FOUND',
      message: `applyLandContractTransferGoal: province ${provinceId} not found`,
    })
  }
  const toPolity = state.polities[input.toPolityId]
  if (!toPolity || !toPolity.active) {
    return err({
      code: 'POLITY_NOT_FOUND',
      message: `applyLandContractTransferGoal: target polity ${input.toPolityId} is missing or inactive`,
    })
  }
  const chain = getHoldingLandContractChain(state, input.holdingId)
  const targetContract = chain.find((c) => c.granteePolityId === input.fromPolityId)
  if (!targetContract) {
    return err({
      code: 'CONTRACT_NOT_FOUND',
      message: `applyLandContractTransferGoal: no contract with grantee ${input.fromPolityId} in chain of holding ${input.holdingId}`,
    })
  }
  if (targetContract.granteePolityId === input.toPolityId) {
    return ok({ ctx, value: undefined })
  }

  const fromPolityId = input.fromPolityId
  const fromPolity = state.polities[fromPolityId]
  const fromRank = fromPolity?.rank ?? 0

  let newState: WorldState

  if (toPolity.rank <= fromRank) {
    // 5-a (同 rank) or 5-b (claimer が上位 rank): grantee を差し替える
    const grantor = getLandContractGrantor(state, targetContract.id)
    if (grantor) {
      const grantorRank = getGrantorRank(state, grantor)
      if (grantorRank >= toPolity.rank) {
        return err({
          code: 'INTEGRITY_VIOLATION',
          message: `applyLandContractTransferGoal: rank invariant violation (grantor rank ${grantorRank} >= grantee rank ${toPolity.rank})`,
        })
      }
    }
    const childContractId = state.landContractIndex.byParent[targetContract.id]
    if (childContractId) {
      const childContract = state.landContracts[childContractId]
      if (childContract) {
        const childPolity = state.polities[childContract.granteePolityId]
        if (childPolity && toPolity.rank >= childPolity.rank) {
          return err({
            code: 'INTEGRITY_VIOLATION',
            message: `applyLandContractTransferGoal: rank invariant violation (new grantee rank ${toPolity.rank} >= child rank ${childPolity.rank})`,
          })
        }
      }
    }
    newState = transferLandContractGrantee(state, targetContract.id, input.toPolityId)
  } else {
    // 5-c (claimer が下位 rank): チェーンを走査して適切な位置に挿入/差し替え
    if (fromRank >= toPolity.rank) {
      return err({
        code: 'INTEGRITY_VIOLATION',
        message: `applyLandContractTransferGoal: cannot insert below same or lower rank (from=${fromRank} to=${toPolity.rank})`,
      })
    }
    let anchor = targetContract
    let placed: { state: WorldState } | undefined
    for (let depth = 0; depth < 20; depth++) {
      const childId = state.landContractIndex.byParent[anchor.id]
      if (!childId) {
        placed = createChildLandContract(state, {
          provinceId,
          parentContractId: anchor.id,
          granteePolityId: input.toPolityId,
          taxRateToGrantor: 0.3,
          holdingId: input.holdingId,
        })
        break
      }
      const child = state.landContracts[childId]
      if (!child) {
        return err({
          code: 'INTEGRITY_VIOLATION',
          message: `applyLandContractTransferGoal: child contract ${childId as string} not found`,
        })
      }
      const childPolity = state.polities[child.granteePolityId]
      const childRank = childPolity?.rank ?? 0

      if (toPolity.rank < childRank) {
        placed = insertIntermediateLandContract(state, {
          provinceId,
          belowContractId: childId,
          newGranteePolityId: input.toPolityId,
          taxRateToGrantor: 0.3,
          holdingId: input.holdingId,
        })
        break
      }

      if (toPolity.rank === childRank) {
        const cGrantor = getLandContractGrantor(state, childId)
        if (cGrantor) {
          const cGrantorRank = getGrantorRank(state, cGrantor)
          if (cGrantorRank >= toPolity.rank) {
            return err({
              code: 'INTEGRITY_VIOLATION',
              message: `applyLandContractTransferGoal: rank invariant violation (grantor rank ${cGrantorRank} >= grantee rank ${toPolity.rank})`,
            })
          }
        }
        const gcId = state.landContractIndex.byParent[childId]
        if (gcId) {
          const gc = state.landContracts[gcId]
          if (gc) {
            const gcPolity = state.polities[gc.granteePolityId]
            if (gcPolity && toPolity.rank >= gcPolity.rank) {
              return err({
                code: 'INTEGRITY_VIOLATION',
                message: `applyLandContractTransferGoal: rank invariant violation (new grantee rank ${toPolity.rank} >= grandchild rank ${gcPolity.rank})`,
              })
            }
          }
        }
        placed = { state: transferLandContractGrantee(state, childId, input.toPolityId) }
        break
      }

      anchor = child
    }
    if (!placed) {
      return err({
        code: 'INTEGRITY_VIOLATION',
        message: `applyLandContractTransferGoal: could not find valid position in chain for rank ${toPolity.rank}`,
      })
    }
    newState = placed.state
  }
  let nextCtx: TickContext = { ...ctx, state: newState }

  const fromNameKey = fromPolity?.nameKey ?? fromPolityId
  const toNameKey = toPolity.nameKey
  const holdingProvince = state.provinces[holding.provinceId]

  // LAND_CONTRACT_TRANSFERRED event
  const { event: transferEvent, ctx: ctxAfterTransfer } = createSimEvent(nextCtx, {
    type: 'LAND_CONTRACT_TRANSFERRED',
    importance: 'normal',
    messageKey: 'land_contract.transferred',
    messageParams: {
      holding: nameParam('province', holdingProvince?.nameKey ?? holding.provinceId),
      from: nameParam('polity', fromNameKey),
      to: nameParam('polity', toNameKey),
      reason: input.reason,
    },
    entityRefs: [
      entityRef('holding', input.holdingId, 'holding'),
      entityRef('polity', fromPolityId, 'from'),
      entityRef('polity', input.toPolityId, 'to'),
      entityRef('province', provinceId, 'province'),
    ],
  })
  nextCtx = { ...ctxAfterTransfer, events: [...ctxAfterTransfer.events, transferEvent] }

  // reason 別の追加 domain event (Stage F: purchase / cession / war / revolt)
  let outcomeEventType:
    | 'LAND_CONTRACT_PURCHASED'
    | 'LAND_CONTRACT_CEDED'
    | 'LAND_CONTRACT_CONQUERED'
    | undefined
  let outcomeSummary: string | undefined
  if (input.reason === 'purchase') {
    outcomeEventType = 'LAND_CONTRACT_PURCHASED'
    outcomeSummary = `${toNameKey} purchased ${holdingProvince?.nameKey ?? holding.provinceId} from ${fromNameKey}.`
  } else if (input.reason === 'cession') {
    outcomeEventType = 'LAND_CONTRACT_CEDED'
    outcomeSummary = `${fromNameKey} ceded ${holdingProvince?.nameKey ?? holding.provinceId} to ${toNameKey}.`
  } else if (input.reason === 'war') {
    outcomeEventType = 'LAND_CONTRACT_CONQUERED'
    outcomeSummary = `${toNameKey} conquered ${holdingProvince?.nameKey ?? holding.provinceId} from ${fromNameKey}.`
  }

  if (outcomeEventType && outcomeSummary) {
    const messageKeyMap: Record<string, string> = {
      LAND_CONTRACT_PURCHASED: 'land_contract.purchased',
      LAND_CONTRACT_CEDED: 'land_contract.ceded',
      LAND_CONTRACT_CONQUERED: 'land_contract.conquered',
    }
    const { event: outcomeEvent, ctx: ctxAfterOutcome } = createSimEvent(nextCtx, {
      type: outcomeEventType,
      importance: 'major',
      messageKey: messageKeyMap[outcomeEventType]!,
      messageParams: {
        to: nameParam('polity', toNameKey),
        holding: nameParam('province', holdingProvince?.nameKey ?? holding.provinceId),
        from: nameParam('polity', fromNameKey),
      },
      entityRefs: [
        entityRef('holding', input.holdingId, 'holding'),
        entityRef('polity', fromPolityId, 'from'),
        entityRef('polity', input.toPolityId, 'to'),
        entityRef('province', provinceId, 'province'),
      ],
    })
    nextCtx = { ...ctxAfterOutcome, events: [...ctxAfterOutcome.events, outcomeEvent] }
  }

  return ok({ ctx: nextCtx, value: undefined })
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
      byHolding: state.landContractIndex.byHolding,
      byGranteePolity: {
        ...state.landContractIndex.byGranteePolity,
        [contract.granteePolityId]: granteeSlot.filter((id) => id !== contractId),
      },
      byParent: newByParent,
    },
  }
  return {
    ...nextState,
    holdingTerminalPolityCache: recomputeHoldingTerminalCache(nextState, contract.provinceId),
  }
}

export function eliminateContractFromChain(
  state: WorldState,
  contractId: LandContractId,
  inheritedTaxRate?: number,
): WorldState {
  const contract = state.landContracts[contractId]
  if (!contract) return state

  const childContractId = state.landContractIndex.byParent[contractId]
  const parentContractId = contract.parentContractId
  const isRoot = parentContractId === undefined

  // Build updated state
  const nextLandContracts = { ...state.landContracts }
  delete nextLandContracts[contractId]

  const chain = state.landContractIndex.byProvince[contract.provinceId] ?? []
  const newChain = chain.filter((cid) => cid !== contractId)

  const granteeSlot = state.landContractIndex.byGranteePolity[contract.granteePolityId] ?? []
  const newGranteeSlot = granteeSlot.filter((id) => id !== contractId)

  const newByParent = { ...state.landContractIndex.byParent }
  delete newByParent[contractId]

  if (childContractId) {
    const childContract = state.landContracts[childContractId]
    if (childContract) {
      let updatedChild: LandContract
      if (isRoot) {
        // Child becomes root
        updatedChild = {
          ...childContract,
          rootAuthorityId: contract.rootAuthorityId ?? ROOT_WORLD,
        }
        delete (updatedChild as { parentContractId?: LandContractId }).parentContractId
      } else {
        // Child reconnects to parent
        updatedChild = {
          ...childContract,
          parentContractId,
        }
        delete (updatedChild as { rootAuthorityId?: RootAuthorityId }).rootAuthorityId
      }
      if (inheritedTaxRate !== undefined) {
        updatedChild = {
          ...updatedChild,
          terms: { taxRateToGrantor: clampTaxRate(inheritedTaxRate) },
        }
      }
      nextLandContracts[childContractId] = updatedChild

      // Update byParent: parent -> child (bridging)
      if (parentContractId !== undefined) {
        newByParent[parentContractId] = childContractId
      }
    }
  } else {
    // No child - just remove parent's reference
    if (parentContractId !== undefined) {
      delete newByParent[parentContractId]
    }
  }

  const newByHolding = { ...state.landContractIndex.byHolding }
  if (contract.holdingId) {
    const holdingChain = newByHolding[contract.holdingId] ?? []
    newByHolding[contract.holdingId] = holdingChain.filter((cid) => cid !== contractId)
  }

  const nextState: WorldState = {
    ...state,
    landContracts: nextLandContracts,
    landContractIndex: {
      byProvince: { ...state.landContractIndex.byProvince, [contract.provinceId]: newChain },
      byHolding: newByHolding,
      byGranteePolity: {
        ...state.landContractIndex.byGranteePolity,
        [contract.granteePolityId]: newGranteeSlot,
      },
      byParent: newByParent,
    },
  }

  return {
    ...nextState,
    holdingTerminalPolityCache: recomputeHoldingTerminalCache(nextState, contract.provinceId),
  }
}
