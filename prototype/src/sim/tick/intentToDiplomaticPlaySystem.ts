import type { TickContext } from './context'
import { makeEventId } from './context'
import type { ActorIntentId, PolityId, ProvinceId } from '../types/ids'
import { createDiplomaticPlayId } from '../types/ids'
import type { DiplomaticPlay, DiplomaticPlayKind } from '../types/diplomaticPlay'
import type { PoliticalActorRef } from '../types/actor'
import type { SimEvent } from '../types/event'
import { defaultLandContractConfig } from '../config/landContractConfig'
import {
  getProvinceTerminalContract,
  getLandContractGrantor,
} from '../selectors/landContractSelectors'
import type { WorldState } from '../types/world'

// v0.18 Stage C / Stage D §9: IntentToDiplomaticPlaySystem
//
// active な ActorIntent を DiplomaticPlay に変換する。
//
// 変換ルール:
//   sell_land Intent (actor=seller, targetActor=buyer)
//     → land_purchase Play (initiator=buyer, target=seller)
//   acquire_land Intent (actor=acquirer, targetActor=defender)
//     → 同 rank・同 grantor の隣接かつ非 commonwealth → land_purchase Play
//     → それ以外 → land_transfer_demand Play
//     (どちらも initiator=acquirer, target=defender)
//
// Play actor の慣習: 「initiator が target に何かを要求」で一貫させる。
// land_purchase 妥協式 (§10.3.2) は target (seller) 視点で評価する。
//
// 変換後の Intent は status='converted' になり、tick 末の cleanupTerminalDiplomacy で削除される。
// 変換できない Intent は immediate に status='expired' に (spec §9.2)。

export function runIntentToDiplomaticPlaySystem(ctx: TickContext): TickContext {
  let currentCtx = ctx

  // 既存 active Play の重複防止キーを構築 (§9.3)
  // key: `${kind}|${initiatorId}|${targetId}|${targetProvinceId}`
  const existingActivePlayKeys = new Set<string>()
  for (const play of Object.values(currentCtx.state.diplomaticPlays)) {
    if (!play || (play.status !== 'active' && play.status !== 'escalated')) continue
    const key = playDedupeKey(play)
    if (key) existingActivePlayKeys.add(key)
  }

  for (const intentIdStr of Object.keys(currentCtx.state.actorIntents).sort()) {
    const intent = currentCtx.state.actorIntents[intentIdStr as ActorIntentId]
    if (!intent || intent.status !== 'active') continue

    if (intent.kind !== 'sell_land' && intent.kind !== 'acquire_land') continue

    if (!intent.targetActor) {
      currentCtx = setIntentStatus(currentCtx, intent.id, 'expired')
      continue
    }
    if (intent.targetProvinceId === undefined) {
      currentCtx = setIntentStatus(currentCtx, intent.id, 'expired')
      continue
    }
    // Polity actor のみ (v0.18)
    if (intent.actor.kind !== 'polity' || intent.targetActor.kind !== 'polity') {
      currentCtx = setIntentStatus(currentCtx, intent.id, 'expired')
      continue
    }

    // 共通 active actor check
    const actorPolity = currentCtx.state.polities[intent.actor.id]
    const targetActorPolity = currentCtx.state.polities[intent.targetActor.id]
    if (!actorPolity || !actorPolity.active || !targetActorPolity || !targetActorPolity.active) {
      currentCtx = setIntentStatus(currentCtx, intent.id, 'expired')
      continue
    }

    if (intent.kind === 'sell_land') {
      // sell_land: initiator=buyer (intent.targetActor), target=seller (intent.actor)
      const initiator: PoliticalActorRef = intent.targetActor
      const target: PoliticalActorRef = intent.actor
      const provinceId = intent.targetProvinceId
      const price = intent.priority

      const dedupeKey = `land_purchase|${initiator.kind}:${initiator.id}|${target.kind}:${target.id}|${provinceId}`
      if (existingActivePlayKeys.has(dedupeKey)) {
        currentCtx = setIntentStatus(currentCtx, intent.id, 'expired')
        continue
      }

      currentCtx = createLandPurchasePlay(currentCtx, {
        intentId: intent.id,
        initiator,
        target,
        provinceId,
        price,
      })
      existingActivePlayKeys.add(dedupeKey)
      continue
    }

    // intent.kind === 'acquire_land'
    // acquire_land: initiator=acquirer (intent.actor), target=defender (intent.targetActor)
    const initiator: PoliticalActorRef = intent.actor
    const target: PoliticalActorRef = intent.targetActor
    const provinceId = intent.targetProvinceId

    // commonwealth target は spec §3 / §5.6 により land_purchase / land_transfer_demand 共に対象外
    if (actorPolity.ownerHouseId === undefined || targetActorPolity.ownerHouseId === undefined) {
      currentCtx = setIntentStatus(currentCtx, intent.id, 'expired')
      continue
    }

    // 同 rank かつ同 grantor の隣接 → land_purchase
    // それ以外 → land_transfer_demand
    const eligibleForPurchase = checkLandPurchaseEligibility(
      currentCtx.state,
      initiator.id,
      target.id,
      provinceId,
    )

    if (eligibleForPurchase) {
      const price = computeLandPurchasePrice(currentCtx.state, provinceId)
      // acquirer treasury 不足なら land_purchase に進まない (land_transfer_demand に倒す)
      const acquirer = currentCtx.state.polities[initiator.id]
      if (acquirer && acquirer.treasury >= price) {
        const dedupeKey = `land_purchase|${initiator.kind}:${initiator.id}|${target.kind}:${target.id}|${provinceId}`
        if (existingActivePlayKeys.has(dedupeKey)) {
          currentCtx = setIntentStatus(currentCtx, intent.id, 'expired')
          continue
        }
        currentCtx = createLandPurchasePlay(currentCtx, {
          intentId: intent.id,
          initiator,
          target,
          provinceId,
          price,
        })
        existingActivePlayKeys.add(dedupeKey)
        continue
      }
    }

    // land_transfer_demand
    const dedupeKey = `land_transfer_demand|${initiator.kind}:${initiator.id}|${target.kind}:${target.id}|${provinceId}`
    if (existingActivePlayKeys.has(dedupeKey)) {
      currentCtx = setIntentStatus(currentCtx, intent.id, 'expired')
      continue
    }
    currentCtx = createLandTransferDemandPlay(currentCtx, {
      intentId: intent.id,
      initiator,
      target,
      provinceId,
    })
    existingActivePlayKeys.add(dedupeKey)
  }

  return currentCtx
}

// ─── Play 生成 helpers ───

type CreateLandPurchaseInput = {
  intentId: ActorIntentId
  initiator: PoliticalActorRef
  target: PoliticalActorRef
  provinceId: ProvinceId
  price: number
}

function createLandPurchasePlay(ctx: TickContext, input: CreateLandPurchaseInput): TickContext {
  let currentCtx = ctx
  const { intentId, initiator, target, provinceId, price } = input
  const playId = createDiplomaticPlayId(currentCtx.state.nextDiplomaticPlayId)
  const { deadlineYear, deadlineMonth } = computeDeadline(
    currentCtx,
    currentCtx.config.landPurchaseNegotiationDurationMonths,
  )

  const play: DiplomaticPlay = {
    id: playId,
    kind: 'land_purchase',
    initiator,
    target,
    originIntentId: intentId,
    primaryDemand: {
      kind: 'transfer_land_contract',
      provinceId,
      toPolityId: initiator.id as PolityId,
      beneficiaryActor: initiator,
    },
    counterDemand: {
      kind: 'pay_wealth',
      from: initiator,
      to: target,
      amount: price,
    },
    status: 'active',
    startedYear: currentCtx.state.currentYear,
    startedMonth: currentCtx.state.currentMonth,
    deadlineYear,
    deadlineMonth,
    progress: 0,
    tension: 0,
  }

  currentCtx = {
    ...currentCtx,
    state: {
      ...currentCtx.state,
      diplomaticPlays: {
        ...currentCtx.state.diplomaticPlays,
        [playId]: play,
      },
      nextDiplomaticPlayId: currentCtx.state.nextDiplomaticPlayId + 1,
    },
  }
  currentCtx = setIntentStatus(currentCtx, intentId, 'converted')
  currentCtx = emitConversionAndStartEvents(currentCtx, {
    kind: 'land_purchase',
    initiator,
    target,
    provinceId,
  })
  return currentCtx
}

type CreateLandTransferDemandInput = {
  intentId: ActorIntentId
  initiator: PoliticalActorRef
  target: PoliticalActorRef
  provinceId: ProvinceId
}

function createLandTransferDemandPlay(
  ctx: TickContext,
  input: CreateLandTransferDemandInput,
): TickContext {
  let currentCtx = ctx
  const { intentId, initiator, target, provinceId } = input
  const playId = createDiplomaticPlayId(currentCtx.state.nextDiplomaticPlayId)
  const { deadlineYear, deadlineMonth } = computeDeadline(
    currentCtx,
    currentCtx.config.landTransferDemandNegotiationDurationMonths,
  )

  const play: DiplomaticPlay = {
    id: playId,
    kind: 'land_transfer_demand',
    initiator,
    target,
    originIntentId: intentId,
    primaryDemand: {
      kind: 'transfer_land_contract',
      provinceId,
      toPolityId: initiator.id as PolityId,
      beneficiaryActor: initiator,
    },
    // Stage D: 補償金なし (counterDemand 省略)
    status: 'active',
    startedYear: currentCtx.state.currentYear,
    startedMonth: currentCtx.state.currentMonth,
    deadlineYear,
    deadlineMonth,
    progress: 0,
    tension: 0,
  }

  currentCtx = {
    ...currentCtx,
    state: {
      ...currentCtx.state,
      diplomaticPlays: {
        ...currentCtx.state.diplomaticPlays,
        [playId]: play,
      },
      nextDiplomaticPlayId: currentCtx.state.nextDiplomaticPlayId + 1,
    },
  }
  currentCtx = setIntentStatus(currentCtx, intentId, 'converted')
  currentCtx = emitConversionAndStartEvents(currentCtx, {
    kind: 'land_transfer_demand',
    initiator,
    target,
    provinceId,
  })
  return currentCtx
}

function computeDeadline(
  ctx: TickContext,
  durationMonths: number,
): { deadlineYear: number; deadlineMonth: number } {
  const totalStartedMonth = ctx.state.currentMonth - 1
  const deadlineYear = ctx.state.currentYear + Math.floor((totalStartedMonth + durationMonths) / 12)
  const deadlineMonth = ((totalStartedMonth + durationMonths) % 12) + 1
  return { deadlineYear, deadlineMonth }
}

function emitConversionAndStartEvents(
  ctx: TickContext,
  input: {
    kind: DiplomaticPlayKind
    initiator: PoliticalActorRef
    target: PoliticalActorRef
    provinceId: ProvinceId
  },
): TickContext {
  let currentCtx = ctx
  const { kind, initiator, target, provinceId } = input

  const { id: convEventId, ctx: ctxConv } = makeEventId(currentCtx)
  const initiatorName =
    ctxConv.state.polities[initiator.id as PolityId]?.name ?? String(initiator.id)
  const targetName = ctxConv.state.polities[target.id as PolityId]?.name ?? String(target.id)
  const provinceName = ctxConv.state.provinces[provinceId]?.name ?? provinceId
  const polityIds = [initiator.id, target.id] as PolityId[]

  let convSummary: string
  let startSummary: string
  if (kind === 'land_purchase') {
    convSummary = `${initiatorName} opens negotiations to purchase ${provinceName} from ${targetName}.`
    startSummary = `${initiatorName} negotiates with ${targetName} for ${provinceName}.`
  } else if (kind === 'land_transfer_demand') {
    convSummary = `${initiatorName} demands ${provinceName} from ${targetName}.`
    startSummary = `${initiatorName} pressures ${targetName} to cede ${provinceName}.`
  } else {
    convSummary = `${initiatorName} initiates ${kind} with ${targetName}.`
    startSummary = convSummary
  }

  const convEv: SimEvent = {
    id: convEventId,
    year: ctxConv.state.currentYear,
    month: ctxConv.state.currentMonth,
    type: 'ACTOR_INTENT_CONVERTED',
    importance: 'normal',
    actorIds: [],
    houseIds: [],
    polityIds,
    provinceIds: [provinceId],
    summary: convSummary,
    reasons: [],
    effects: [],
  }
  currentCtx = { ...ctxConv, events: [...ctxConv.events, convEv] }

  const { id: startEventId, ctx: ctxStart } = makeEventId(currentCtx)
  const startEv: SimEvent = {
    id: startEventId,
    year: ctxStart.state.currentYear,
    month: ctxStart.state.currentMonth,
    type: 'DIPLOMATIC_PLAY_STARTED',
    importance: 'normal',
    actorIds: [],
    houseIds: [],
    polityIds,
    provinceIds: [provinceId],
    summary: startSummary,
    reasons: [],
    effects: [],
  }
  currentCtx = { ...ctxStart, events: [...ctxStart.events, startEv] }
  return currentCtx
}

// ─── 判定 helpers ───

// 同 rank かつ同 grantor の隣接条件: 旧 landContractPurchaseSystem の判定と同じ。
// acquirer の terminal Province のいずれかが target Province と隣接し、両 Province の
// terminal contract grantor が一致する場合に true。
function checkLandPurchaseEligibility(
  state: WorldState,
  acquirerPolityId: PolityId,
  targetPolityId: PolityId,
  provinceId: ProvinceId,
): boolean {
  const acquirer = state.polities[acquirerPolityId]
  const target = state.polities[targetPolityId]
  if (!acquirer || !target) return false
  if (acquirer.rank !== target.rank) return false

  const targetContract = getProvinceTerminalContract(state, provinceId)
  if (!targetContract) return false
  const targetGrantor = getLandContractGrantor(state, targetContract.id)
  if (!targetGrantor) return false
  const targetGrantorKey = `${targetGrantor.kind}:${targetGrantor.id}`

  // acquirer の terminal Province を見て、target Province と隣接 + 同 grantor を確認
  const targetProvince = state.provinces[provinceId]
  if (!targetProvince) return false
  for (const neighborId of targetProvince.neighbors) {
    const neighborContract = getProvinceTerminalContract(state, neighborId)
    if (!neighborContract) continue
    if (neighborContract.granteePolityId !== acquirerPolityId) continue
    const neighborGrantor = getLandContractGrantor(state, neighborContract.id)
    if (!neighborGrantor) continue
    if (`${neighborGrantor.kind}:${neighborGrantor.id}` === targetGrantorKey) {
      return true
    }
  }
  return false
}

function computeLandPurchasePrice(state: WorldState, provinceId: ProvinceId): number {
  const province = state.provinces[provinceId]
  if (!province) return defaultLandContractConfig.purchasePriceBase
  return Math.max(
    defaultLandContractConfig.purchasePriceBase,
    defaultLandContractConfig.purchasePriceBase +
      province.development * defaultLandContractConfig.purchasePriceDevelopmentFactor,
  )
}

function playDedupeKey(play: DiplomaticPlay): string | undefined {
  const provinceId = getPlayProvinceId(play)
  if (!provinceId) return undefined
  return `${play.kind}|${play.initiator.kind}:${play.initiator.id}|${play.target.kind}:${play.target.id}|${provinceId}`
}

function getPlayProvinceId(play: DiplomaticPlay): string | undefined {
  const d = play.primaryDemand
  if (d.kind === 'transfer_land_contract') return d.provinceId
  if (d.kind === 'revolt_concession') return d.provinceId
  return undefined
}

function setIntentStatus(
  ctx: TickContext,
  intentId: ActorIntentId,
  status: 'converted' | 'expired' | 'cancelled',
): TickContext {
  const intent = ctx.state.actorIntents[intentId]
  if (!intent) return ctx
  return {
    ...ctx,
    state: {
      ...ctx.state,
      actorIntents: {
        ...ctx.state.actorIntents,
        [intentId]: { ...intent, status },
      },
    },
  }
}
