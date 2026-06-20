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
import type { CtxResult, SimResult } from './result'
import { ok, err } from './result'
import {
  getHoldingLandContractChain,
  getLandContractGrantor,
  getGrantorRank,
} from '../selectors/landContractSelectors'
import { getPolityNameRefForEmit, getHoldingNameRefForEmit } from '../selectors/nameRefSelectors'
import { installHoldingPlaceholderBailiff, vacateHoldingBailiff } from './provinceOfficeMutations'

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

// 末端契約が移動して holding の terminal Polity が変わったら、その holding の bailiff
// (HoldingOfficeAssignment) を「新しい terminal Polity 任命の placeholder」に差し替える。
//
// 旧 terminal の支配家の代官が残留すると、その家が奪った側 Polity の influence 母集合に
// 居座り、house-global な wealth/prestige が乗って「土地を奪われた側の支配家が、奪った側
// Polity の支配家門になる」リークを生む (叛乱 commonwealth で顕著: 旧宗主の富豪家が独立国の
// 支配家門表示 + 余剰金を吸い上げる)。任命権 (PoliticalRight holding_office_role) 側は
// rightConsistencySystem が terminal 不一致を regime_change で revoke するが、assignment 側には
// この同期が無かった (さらに commonwealth は bailiffAppointmentSystem に owner 不在でスキップ
// されるため、既存の "holder house が terminal owner と無関係なら vacate" cleanup も届かない)。
//
// 叛乱 (createChildLandContract) / 戦争土地移転 (transferLandContractGrantee /
// insertIntermediateLandContract / transferAllProvincesToPolity) / 契約削除 (removeContract) の
// 全経路が、この terminal cache 再計算を通る。regiment owner 同期 (syncRegimentOwnerToHomeTerminal)
// が lazy では即開戦に間に合わなかった先例に倣い、ここで eager に同期する。
function recomputeTerminalCacheAndResyncBailiffs(
  state: WorldState,
  provinceId: ProvinceId,
): WorldState {
  const before = state.holdingTerminalPolityCache
  const nextCache = recomputeHoldingTerminalCache(state, provinceId)
  let next: WorldState = { ...state, holdingTerminalPolityCache: nextCache }
  const province = state.provinces[provinceId]
  if (!province) return next
  for (const holdingId of province.holdingIds) {
    const newTerminal = nextCache[holdingId]
    if (before[holdingId] === newTerminal) continue
    if (newTerminal !== undefined) {
      // 新 terminal Polity 任命の placeholder に差し替え (旧代官は内部で vacate される)。
      // placeholder は houseless で influence 寄与ゼロ。bailiff を持つ owner Polity なら
      // 次の BailiffAppointmentSystem で実在人物に昇格する。
      next = installHoldingPlaceholderBailiff(next, {
        holdingId,
        appointingPolityId: newTerminal,
        week: state.absoluteWeek,
      })
    } else {
      // terminal が消滅 (chain 空) — 任命主が無いので vacate のみ。
      next = vacateHoldingBailiff(next, holdingId)
    }
  }
  return next
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
    // holdingId は byHolding index だけでなく contract record にも保持する。
    // 欠落させると removeContract の byHolding cleanup (下記) や war/peace の
    // contract.holdingId === goal.holdingId 照合・UI の holding 名解決がすり抜ける。
    ...(params.holdingId ? { holdingId: params.holdingId } : {}),
    ...(params.specialStatus ? { specialStatus: params.specialStatus } : {}),
  }
  const granteeSlot = emptyGranteeSlot(state.landContractIndex, params.granteePolityId)
  const nextState: WorldState = {
    ...state,
    landContracts: { ...state.landContracts, [id]: contract },
    landContractIndex: {
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
    state: recomputeTerminalCacheAndResyncBailiffs(nextState, params.provinceId),
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

function transferLandContractGrantee(
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
      byHolding: state.landContractIndex.byHolding,
      byGranteePolity: {
        ...state.landContractIndex.byGranteePolity,
        [contract.granteePolityId]: oldGranteeNext,
        [newGranteePolityId]: [...newGranteeSlot, contractId],
      },
      byParent: state.landContractIndex.byParent,
    },
  }
  return recomputeTerminalCacheAndResyncBailiffs(nextState, contract.provinceId)
}

// v0.16 §16.1 case B: 既存 contract の上に中間 contract (新 grantee) を挿入する。
// chain の terminal の直前に挿入し、新 contract が terminal の親、新 contract の親が旧 terminal-1 contract になる。
function insertIntermediateLandContract(
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

  // 調査 §4.1: byProvince 撤去。対象 holding の byHolding チェーン上で挿入位置を決める。
  const holdingChain = params.holdingId
    ? (state.landContractIndex.byHolding[params.holdingId] ?? [])
    : []
  const belowIdx = holdingChain.findIndex((cid) => cid === params.belowContractId)
  if (belowIdx === -1) return { state, contractId: '' as LandContractId }

  const id = createLandContractId(state.nextLandContractId)
  const oldParentId = below.parentContractId
  const newContract: LandContract = {
    id,
    provinceId: params.provinceId,
    granteePolityId: params.newGranteePolityId,
    terms: { taxRateToGrantor: clampTaxRate(params.taxRateToGrantor) },
    // createChildLandContract と同様、holdingId を record にも保持する。
    ...(params.holdingId ? { holdingId: params.holdingId } : {}),
    ...(oldParentId !== undefined
      ? { parentContractId: oldParentId }
      : { rootAuthorityId: below.rootAuthorityId ?? ROOT_WORLD }),
  }

  const updatedBelow: LandContract = {
    ...below,
    parentContractId: id,
  }
  delete (updatedBelow as { rootAuthorityId?: RootAuthorityId }).rootAuthorityId

  const newHoldingChain = [...holdingChain.slice(0, belowIdx), id, ...holdingChain.slice(belowIdx)]
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
      byHolding: params.holdingId
        ? { ...state.landContractIndex.byHolding, [params.holdingId]: newHoldingChain }
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
    state: recomputeTerminalCacheAndResyncBailiffs(nextState, params.provinceId),
    contractId: id,
  }
}

export type LandContractTransferReason = 'purchase' | 'cession' | 'war' | 'revolt'

// transfer 実行プラン。planLandContractTransfer が「どの contract をどう操作すれば feudal chain の
// rank invariant を保ったまま toPolity に holding を移管できるか」を純粋に決定し、ここに正規化する。
//   noop          : 既に toPolity 所有 (state 変更不要)
//   swap_grantee  : contractId の grantee を toPolity に差し替え (5-a/5-b、5-c の同 rank)
//   create_child  : parentContractId の下に子契約を新設 (5-c の末尾)
//   insert_below  : belowContractId の上に中間契約を挿入 (5-c の途中)
export type LandContractTransferPlan =
  | { kind: 'noop' }
  | { kind: 'swap_grantee'; contractId: LandContractId }
  | { kind: 'create_child'; parentContractId: LandContractId }
  | { kind: 'insert_below'; belowContractId: LandContractId }

// §6.5 transfer 適用可否 + 適用プランの「単一の真実」。validation (rank invariant 等) と分岐判断を
// ここに集約し、applyLandContractTransferGoal は本プランを実行するだけにする。canTransferLandContract
// は本関数の .ok ラッパーで、war creation / play 生成の事前ゲートが同一ロジックを共有する
// (勝てるが構造上適用不可能な seize 戦争 = 永久白紙和平ループを開戦前に弾く)。
export function planLandContractTransfer(
  state: WorldState,
  input: {
    holdingId: HoldingId
    fromPolityId: PolityId
    toPolityId: PolityId
  },
): SimResult<LandContractTransferPlan> {
  const holding = state.holdings[input.holdingId]
  if (!holding) {
    return err({
      code: 'HOLDING_NOT_FOUND',
      message: `planLandContractTransfer: holding ${input.holdingId} not found`,
    })
  }
  const province = state.provinces[holding.provinceId]
  if (!province) {
    return err({
      code: 'PROVINCE_NOT_FOUND',
      message: `planLandContractTransfer: province ${holding.provinceId} not found`,
    })
  }
  const toPolity = state.polities[input.toPolityId]
  if (!toPolity || !toPolity.active) {
    return err({
      code: 'POLITY_NOT_FOUND',
      message: `planLandContractTransfer: target polity ${input.toPolityId} is missing or inactive`,
    })
  }
  const chain = getHoldingLandContractChain(state, input.holdingId)
  const targetContract = chain.find((c) => c.granteePolityId === input.fromPolityId)
  if (!targetContract) {
    return err({
      code: 'CONTRACT_NOT_FOUND',
      message: `planLandContractTransfer: no contract with grantee ${input.fromPolityId} in chain of holding ${input.holdingId}`,
    })
  }
  if (targetContract.granteePolityId === input.toPolityId) {
    return ok({ kind: 'noop' })
  }

  const fromPolity = state.polities[input.fromPolityId]
  const fromRank = fromPolity?.rank ?? 0

  if (toPolity.rank <= fromRank) {
    // 5-a (同 rank) or 5-b (claimer が上位 rank): grantee を差し替える
    const grantor = getLandContractGrantor(state, targetContract.id)
    if (grantor) {
      const grantorRank = getGrantorRank(state, grantor)
      if (grantorRank >= toPolity.rank) {
        return err({
          code: 'INTEGRITY_VIOLATION',
          message: `planLandContractTransfer: rank invariant violation (grantor rank ${grantorRank} >= grantee rank ${toPolity.rank})`,
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
            message: `planLandContractTransfer: rank invariant violation (new grantee rank ${toPolity.rank} >= child rank ${childPolity.rank})`,
          })
        }
      }
    }
    return ok({ kind: 'swap_grantee', contractId: targetContract.id })
  }

  // 5-c (claimer が下位 rank): チェーンを走査して適切な位置に挿入/差し替え
  if (fromRank >= toPolity.rank) {
    return err({
      code: 'INTEGRITY_VIOLATION',
      message: `planLandContractTransfer: cannot insert below same or lower rank (from=${fromRank} to=${toPolity.rank})`,
    })
  }
  let anchor = targetContract
  for (let depth = 0; depth < 20; depth++) {
    const childId = state.landContractIndex.byParent[anchor.id]
    if (!childId) {
      return ok({ kind: 'create_child', parentContractId: anchor.id })
    }
    const child = state.landContracts[childId]
    if (!child) {
      return err({
        code: 'INTEGRITY_VIOLATION',
        message: `planLandContractTransfer: child contract ${childId as string} not found`,
      })
    }
    const childPolity = state.polities[child.granteePolityId]
    const childRank = childPolity?.rank ?? 0

    if (toPolity.rank < childRank) {
      return ok({ kind: 'insert_below', belowContractId: childId })
    }

    if (toPolity.rank === childRank) {
      const cGrantor = getLandContractGrantor(state, childId)
      if (cGrantor) {
        const cGrantorRank = getGrantorRank(state, cGrantor)
        if (cGrantorRank >= toPolity.rank) {
          return err({
            code: 'INTEGRITY_VIOLATION',
            message: `planLandContractTransfer: rank invariant violation (grantor rank ${cGrantorRank} >= grantee rank ${toPolity.rank})`,
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
              message: `planLandContractTransfer: rank invariant violation (new grantee rank ${toPolity.rank} >= grandchild rank ${gcPolity.rank})`,
            })
          }
        }
      }
      return ok({ kind: 'swap_grantee', contractId: childId })
    }

    anchor = child
  }
  return err({
    code: 'INTEGRITY_VIOLATION',
    message: `planLandContractTransfer: could not find valid position in chain for rank ${toPolity.rank}`,
  })
}

// §6.5 transfer 事前ゲート用 predicate。planLandContractTransfer の .ok ラッパー (単一の真実)。
export function canTransferLandContract(
  state: WorldState,
  holdingId: HoldingId,
  fromPolityId: PolityId,
  toPolityId: PolityId,
): boolean {
  return planLandContractTransfer(state, { holdingId, fromPolityId, toPolityId }).ok
}

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
  // validation + 分岐判断は planLandContractTransfer に集約 (単一の真実)。
  const plan = planLandContractTransfer(state, {
    holdingId: input.holdingId,
    fromPolityId: input.fromPolityId,
    toPolityId: input.toPolityId,
  })
  if (!plan.ok) return err(plan.error)
  // noop: 既に toPolity 所有。state 変更なし。
  if (plan.value.kind === 'noop') return ok({ ctx, value: undefined })

  // plan が ok の時点で holding は存在保証済み (planner と同条件)。
  const holding = state.holdings[input.holdingId]
  if (!holding) return ok({ ctx, value: undefined })
  const provinceId = holding.provinceId
  const fromPolityId = input.fromPolityId

  let newState: WorldState
  switch (plan.value.kind) {
    case 'swap_grantee':
      newState = transferLandContractGrantee(state, plan.value.contractId, input.toPolityId)
      break
    case 'create_child':
      newState = createChildLandContract(state, {
        provinceId,
        parentContractId: plan.value.parentContractId,
        granteePolityId: input.toPolityId,
        taxRateToGrantor: 0.3,
        holdingId: input.holdingId,
      }).state
      break
    case 'insert_below':
      newState = insertIntermediateLandContract(state, {
        provinceId,
        belowContractId: plan.value.belowContractId,
        newGranteePolityId: input.toPolityId,
        taxRateToGrantor: 0.3,
        holdingId: input.holdingId,
      }).state
      break
    default: {
      const _exhaustive: never = plan.value
      return err({
        code: 'INTEGRITY_VIOLATION',
        message: `applyLandContractTransferGoal: unexpected plan ${String(_exhaustive)}`,
      })
    }
  }
  let nextCtx: TickContext = { ...ctx, state: newState }

  const fromRef = getPolityNameRefForEmit(state, fromPolityId)
  const toRef = getPolityNameRefForEmit(state, input.toPolityId)
  const fromNameKey = fromRef.nameKey
  const toNameKey = toRef.nameKey
  // v0.41 (§7.2/§8): Holding 名は Province 名代用でなく Holding 自身の name (kind→category)。
  const holdingRef = getHoldingNameRefForEmit(state, input.holdingId)

  // LAND_CONTRACT_TRANSFERRED event
  const { event: transferEvent, ctx: ctxAfterTransfer } = createSimEvent(nextCtx, {
    type: 'LAND_CONTRACT_TRANSFERRED',
    importance: 'normal',
    messageKey: 'land_contract.transferred',
    messageParams: {
      holding: nameParam(holdingRef.category, holdingRef.nameKey),
      from: nameParam(fromRef.category, fromNameKey),
      to: nameParam(toRef.category, toNameKey),
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
    outcomeSummary = `${toNameKey} purchased ${holdingRef.nameKey} from ${fromNameKey}.`
  } else if (input.reason === 'cession') {
    outcomeEventType = 'LAND_CONTRACT_CEDED'
    outcomeSummary = `${fromNameKey} ceded ${holdingRef.nameKey} to ${toNameKey}.`
  } else if (input.reason === 'war') {
    outcomeEventType = 'LAND_CONTRACT_CONQUERED'
    outcomeSummary = `${toNameKey} conquered ${holdingRef.nameKey} from ${fromNameKey}.`
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
        to: nameParam(toRef.category, toNameKey),
        holding: nameParam(holdingRef.category, holdingRef.nameKey),
        from: nameParam(fromRef.category, fromNameKey),
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
      byHolding: newByHolding,
      byGranteePolity: {
        ...state.landContractIndex.byGranteePolity,
        [contract.granteePolityId]: newGranteeSlot,
      },
      byParent: newByParent,
    },
  }

  return recomputeTerminalCacheAndResyncBailiffs(nextState, contract.provinceId)
}

// v0.53 §13.4/B2: holding の chain を「keep 契約を新 root にする」形へ正規化する。
//   keep 契約 (= terminal occupier の契約) の祖先をすべて除去し、keep を root に昇格
//   (parentContractId 削除 / rootAuthorityId=ROOT_WORLD / taxRateToGrantor=0)。
//   時効 legalize と反乱確立で「不払い/占拠を貫いた holder が de facto 独立 root 化」する操作。
//   各 holding の chain は holding 専用 (worldgen が clone) なので祖先除去で他 holding は壊れない。
export function normalizeHoldingChainToRoot(
  state: WorldState,
  holdingId: HoldingId,
  keepContractId: LandContractId,
): WorldState {
  const keep = state.landContracts[keepContractId]
  if (!keep) return state
  const chain = getHoldingLandContractChain(state, holdingId)

  const nextLandContracts = { ...state.landContracts }
  const newByParent = { ...state.landContractIndex.byParent }
  const newByGrantee = { ...state.landContractIndex.byGranteePolity }

  // keep 以外の chain 契約 (祖先 + 万一の子) を除去
  for (const c of chain) {
    if (c.id === keepContractId) continue
    delete nextLandContracts[c.id]
    delete newByParent[c.id]
    const slot = newByGrantee[c.granteePolityId] ?? []
    newByGrantee[c.granteePolityId] = slot.filter((id) => id !== c.id)
  }

  // keep を root に昇格
  const promoted: LandContract = {
    ...keep,
    rootAuthorityId: ROOT_WORLD,
    terms: { taxRateToGrantor: 0 },
  }
  delete (promoted as { parentContractId?: LandContractId }).parentContractId
  nextLandContracts[keepContractId] = promoted
  delete newByParent[keepContractId]

  const newByHolding = { ...state.landContractIndex.byHolding }
  newByHolding[holdingId] = [keepContractId]

  const nextState: WorldState = {
    ...state,
    landContracts: nextLandContracts,
    landContractIndex: {
      byHolding: newByHolding,
      byGranteePolity: newByGrantee,
      byParent: newByParent,
    },
  }

  return recomputeTerminalCacheAndResyncBailiffs(nextState, keep.provinceId)
}
