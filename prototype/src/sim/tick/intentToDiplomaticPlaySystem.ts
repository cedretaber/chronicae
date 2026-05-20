import type { TickContext } from './context'
import { makeEventId } from './context'
import type { ActorIntentId, PolityId, ProvinceId } from '../types/ids'
import { createDiplomaticPlayId } from '../types/ids'
import type { DiplomaticPlay } from '../types/diplomaticPlay'
import type { PoliticalActorRef } from '../types/actor'
import type { SimEvent } from '../types/event'
import { defaultLandContractConfig } from '../config/landContractConfig'
import {
  getProvinceTerminalContract,
  getLandContractGrantor,
} from '../selectors/landContractSelectors'
import type { WorldState } from '../types/world'

// v0.18 Stage C/D/F §9: IntentToDiplomaticPlaySystem
//
// active な ActorIntent を DiplomaticPlay に変換する。
//
// Stage F 統合後の変換ルール:
//   sell_land / acquire_land の両 Intent → 一律 land_claim Play
//     initiator = 土地を取得しようとする側 (buyer / acquirer)
//     target    = 現所有者 (seller / defender)
//   counterDemand と初期 progress/tension で「平和度・威圧度」を表現:
//     - sell_land Intent: counterDemand = pay_wealth(seller 提示価格)、progress 高め (合意ベース)
//     - acquire_land Intent (同 rank・同 grantor・acquirer 支払い能力あり):
//         counterDemand = pay_wealth(計算 price)、progress 高め (合意ベース)
//     - acquire_land Intent (上記不成立): counterDemand なし、tension 高め (威圧ベース)
//
// Play actor の慣習: 「initiator が target に土地譲渡を要求」で一貫させる。
// progressLandClaim 内の acceptanceScore は target (defender) 視点で評価する。
//
// 変換後の Intent は status='converted' になり、tick 末の cleanupTerminalDiplomacy で削除される。
// 変換できない Intent は immediate に status='expired' に (spec §9.2)。

export function runIntentToDiplomaticPlaySystem(ctx: TickContext): TickContext {
  let currentCtx = ctx

  // 既存 active/escalated land_claim Play の重複防止キーを構築 (§9.3)
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

    const actorPolity = currentCtx.state.polities[intent.actor.id]
    const targetActorPolity = currentCtx.state.polities[intent.targetActor.id]
    if (!actorPolity || !actorPolity.active || !targetActorPolity || !targetActorPolity.active) {
      currentCtx = setIntentStatus(currentCtx, intent.id, 'expired')
      continue
    }

    // Intent kind → Play actor mapping + counterDemand / 初期値の決定
    let initiator: PoliticalActorRef
    let target: PoliticalActorRef
    let counterDemandAmount: number
    let initialProgress: number
    let initialTension: number

    if (intent.kind === 'sell_land') {
      // sell_land: actor=seller, targetActor=buyer
      initiator = intent.targetActor // buyer
      target = intent.actor // seller
      // seller 提示価格 (Intent.priority に格納済)
      counterDemandAmount = intent.priority
      initialProgress = currentCtx.config.landClaimInitialProgressOnConsent
      initialTension = 0
    } else {
      // acquire_land: actor=acquirer, targetActor=defender
      initiator = intent.actor // acquirer = buyer 候補
      target = intent.targetActor // defender = seller 候補
      const buyerPolity = actorPolity
      const sellerPolity = targetActorPolity

      // commonwealth は spec §3 / §5.6 により対象外
      if (buyerPolity.ownerHouseId === undefined || sellerPolity.ownerHouseId === undefined) {
        currentCtx = setIntentStatus(currentCtx, intent.id, 'expired')
        continue
      }

      // 同 rank・同 grantor・支払い能力 が揃えば「合意ベース」、それ以外は「威圧ベース」
      const eligibleForPurchase = checkLandPurchaseEligibility(
        currentCtx.state,
        initiator.id,
        target.id,
        intent.targetProvinceId,
      )
      if (eligibleForPurchase) {
        const price = computeLandPurchasePrice(currentCtx.state, intent.targetProvinceId)
        if (buyerPolity.treasury >= price) {
          counterDemandAmount = price
          initialProgress = currentCtx.config.landClaimInitialProgressOnConsent
          initialTension = 0
        } else {
          counterDemandAmount = 0
          initialProgress = 0
          initialTension = currentCtx.config.landClaimInitialTensionOnPressure
        }
      } else {
        counterDemandAmount = 0
        initialProgress = 0
        initialTension = currentCtx.config.landClaimInitialTensionOnPressure
      }
    }

    const provinceId = intent.targetProvinceId
    const dedupeKey = `land_claim|${initiator.kind}:${initiator.id}|${target.kind}:${target.id}|${provinceId}`
    if (existingActivePlayKeys.has(dedupeKey)) {
      currentCtx = setIntentStatus(currentCtx, intent.id, 'expired')
      continue
    }

    currentCtx = createLandClaimPlay(currentCtx, {
      intentId: intent.id,
      initiator,
      target,
      provinceId,
      counterDemandAmount,
      initialProgress,
      initialTension,
    })
    existingActivePlayKeys.add(dedupeKey)
  }

  return currentCtx
}

// ─── Play 生成 ───

type CreateLandClaimInput = {
  intentId: ActorIntentId
  initiator: PoliticalActorRef
  target: PoliticalActorRef
  provinceId: ProvinceId
  counterDemandAmount: number // 0 なら counterDemand 省略 (威圧要求)
  initialProgress: number
  initialTension: number
}

function createLandClaimPlay(ctx: TickContext, input: CreateLandClaimInput): TickContext {
  let currentCtx = ctx
  const {
    intentId,
    initiator,
    target,
    provinceId,
    counterDemandAmount,
    initialProgress,
    initialTension,
  } = input
  const playId = createDiplomaticPlayId(currentCtx.state.nextDiplomaticPlayId)
  const { deadlineYear, deadlineMonth } = computeDeadline(
    currentCtx,
    currentCtx.config.landClaimNegotiationDurationMonths,
  )

  const play: DiplomaticPlay = {
    id: playId,
    kind: 'land_claim',
    initiator,
    target,
    originIntentId: intentId,
    primaryDemand: {
      kind: 'transfer_land_contract',
      provinceId,
      toPolityId: initiator.id as PolityId,
      beneficiaryActor: initiator,
    },
    ...(counterDemandAmount > 0
      ? {
          counterDemand: {
            kind: 'pay_wealth' as const,
            from: initiator,
            to: target,
            amount: counterDemandAmount,
          },
        }
      : {}),
    status: 'active',
    startedYear: currentCtx.state.currentYear,
    startedMonth: currentCtx.state.currentMonth,
    deadlineYear,
    deadlineMonth,
    progress: initialProgress,
    tension: initialTension,
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
    initiator,
    target,
    provinceId,
    hasOffer: counterDemandAmount > 0,
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
    initiator: PoliticalActorRef
    target: PoliticalActorRef
    provinceId: ProvinceId
    hasOffer: boolean
  },
): TickContext {
  let currentCtx = ctx
  const { initiator, target, provinceId, hasOffer } = input

  const { id: convEventId, ctx: ctxConv } = makeEventId(currentCtx)
  const initiatorName =
    ctxConv.state.polities[initiator.id as PolityId]?.name ?? String(initiator.id)
  const targetName = ctxConv.state.polities[target.id as PolityId]?.name ?? String(target.id)
  const provinceName = ctxConv.state.provinces[provinceId]?.name ?? provinceId
  const polityIds = [initiator.id, target.id] as PolityId[]

  // hasOffer (補償金あり) か否かで summary を分ける
  const convSummary = hasOffer
    ? `${initiatorName} opens negotiations to acquire ${provinceName} from ${targetName} with compensation.`
    : `${initiatorName} demands ${provinceName} from ${targetName} without compensation.`
  const startSummary = hasOffer
    ? `${initiatorName} negotiates with ${targetName} for ${provinceName}.`
    : `${initiatorName} pressures ${targetName} to cede ${provinceName}.`

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
