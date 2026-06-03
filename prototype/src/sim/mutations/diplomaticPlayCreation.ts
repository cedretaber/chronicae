import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { Project, LandClaimProject, ContractRevisionProject } from '../types/project'
import type {
  DiplomaticPlay,
  DiplomaticDemand,
  ContractTaxRevisionIssue,
} from '../types/diplomaticPlay'
import type { PoliticalActorRef } from '../types/actor'
import type { DiplomaticPlayId, PolityId, ProvinceId } from '../types/ids'
import type { CreateSimEventInput } from '../tick/context'
import { createDiplomaticPlayId } from '../types/ids'
import { nameParam, entityRef } from '../types/event'
import {
  getProvinceTerminalContract,
  getProvinceLandContractChain,
  getLandContractGrantor,
  getProvinceDevelopmentFromHoldings,
  selectTargetHoldingInProvince,
} from '../selectors/landContractSelectors'
import { getActorMilitaryPower } from '../selectors/actorSelectors'
import { getDiplomaticPlayDelegate } from '../selectors/taskSelectors'
import { clamp } from '../utils/math'
import { defaultLandContractConfig } from '../config/landContractConfig'
import { createDiplomaticOfferMut } from './diplomaticOfferMutations'
import { computeTaxRevisionCompensation } from '../tick/diplomaticOfferEvaluation'

export type CreatePlayResult =
  | { kind: 'created'; playId: DiplomaticPlayId }
  | { kind: 'duplicate' }
  | { kind: 'invalid_inputs' }

export function buildExistingPlayKeys(ws: WorldState): Set<string> {
  const keys = new Set<string>()
  for (const play of Object.values(ws.diplomaticPlays)) {
    if (!play || (play.status !== 'active' && play.status !== 'escalated')) continue
    const key = playDedupeKey(play, ws)
    if (key) keys.add(key)
  }
  return keys
}

function playDedupeKey(play: DiplomaticPlay, state: WorldState): string | undefined {
  const provinceId = getPlayProvinceId(play, state)
  if (!provinceId) return undefined
  return `${play.kind}|${play.initiator.kind}:${play.initiator.id}|${play.target.kind}:${play.target.id}|${provinceId}`
}

function getPlayProvinceId(play: DiplomaticPlay, state: WorldState): string | undefined {
  if (play.issue) {
    if (play.issue.kind === 'land_claim') return play.issue.provinceId
    if (play.issue.kind === 'contract_tax_revision')
      return state.holdings[play.issue.holdingId]?.provinceId
  }
  return undefined
}

export function createDiplomaticPlayFromProjectMut(
  ws: WorldState,
  config: SimulationConfig,
  project: Project,
  existingPlayKeys: Set<string>,
  emitEvent: (input: CreateSimEventInput) => void,
): CreatePlayResult {
  if (project.kind === 'acquire_land' || project.kind === 'sell_land') {
    return createLandClaimPlayFromProjectMut(ws, config, project, existingPlayKeys, emitEvent)
  } else if (project.kind === 'improve_contract_terms' || project.kind === 'demand_tax_increase') {
    return createContractRevisionPlayFromProjectMut(
      ws,
      config,
      project,
      existingPlayKeys,
      emitEvent,
    )
  }
  return { kind: 'invalid_inputs' }
}

function createLandClaimPlayFromProjectMut(
  ws: WorldState,
  config: SimulationConfig,
  project: LandClaimProject,
  existingPlayKeys: Set<string>,
  emitEvent: (input: CreateSimEventInput) => void,
): CreatePlayResult {
  if (project.owner.kind !== 'polity') return { kind: 'invalid_inputs' }
  if (!project.counterpartyPolityId) return { kind: 'invalid_inputs' }

  const provinceId = project.provinceId
  if (!provinceId) return { kind: 'invalid_inputs' }

  const holdingId = project.holdingId ?? selectTargetHoldingInProvince(ws, provinceId)
  if (!holdingId) return { kind: 'invalid_inputs' }

  let initiator: PoliticalActorRef
  let target: PoliticalActorRef
  let counterDemandAmount: number
  let initialProgress: number
  let initialTension: number

  if (project.kind === 'sell_land') {
    initiator = { kind: 'polity', id: project.counterpartyPolityId }
    target = { kind: 'polity', id: project.owner.id }
    counterDemandAmount = computeLandPurchasePrice(ws, provinceId, config)
    initialProgress = config.landClaimInitialProgressOnConsent
    initialTension = 0
  } else {
    initiator = { kind: 'polity', id: project.owner.id }
    target = { kind: 'polity', id: project.counterpartyPolityId }

    const buyerPolity = ws.polities[initiator.id]
    const sellerPolity = ws.polities[target.id]
    if (!buyerPolity || !buyerPolity.active || !sellerPolity || !sellerPolity.active)
      return { kind: 'invalid_inputs' }
    if (buyerPolity.ownerHouseId === undefined || sellerPolity.ownerHouseId === undefined)
      return { kind: 'invalid_inputs' }

    const eligible = checkLandPurchaseEligibility(ws, initiator.id, target.id, provinceId)
    if (eligible) {
      const price = computeLandPurchasePrice(ws, provinceId, config)
      if (buyerPolity.treasury >= price) {
        counterDemandAmount = price
        initialProgress = config.landClaimInitialProgressOnConsent
        initialTension = 0
      } else {
        counterDemandAmount = 0
        initialProgress = 0
        initialTension = config.landClaimInitialTensionOnPressure
      }
    } else {
      counterDemandAmount = 0
      initialProgress = 0
      initialTension = config.landClaimInitialTensionOnPressure
    }
  }

  const dedupeKey = `land_claim|${initiator.kind}:${initiator.id}|${target.kind}:${target.id}|${provinceId}`
  if (existingPlayKeys.has(dedupeKey)) return { kind: 'duplicate' }

  const playId: DiplomaticPlayId = createDiplomaticPlayId(ws.nextDiplomaticPlayId)
  const initiatorDelegate = getDiplomaticPlayDelegate(ws, initiator)
  const targetDelegate = getDiplomaticPlayDelegate(ws, target, initiatorDelegate)

  const play: DiplomaticPlay = {
    id: playId,
    kind: 'land_claim',
    initiator,
    target,
    originProjectId: project.id,
    ...(project.origin.kind === 'aim' && project.origin.aimId
      ? { aimId: project.origin.aimId }
      : {}),
    issue: { kind: 'land_claim' as const, holdingId, provinceId },
    status: 'active',
    startedWeek: ws.absoluteWeek,
    deadlineWeek: ws.absoluteWeek + config.landClaimNegotiationDurationWeeks,
    progress: initialProgress,
    tension: initialTension,
    ...(initiatorDelegate ? { initiatorDelegatePersonId: initiatorDelegate } : {}),
    ...(targetDelegate ? { targetDelegatePersonId: targetDelegate } : {}),
    initiatorPreparation: project.preparation,
    initiatorLeverage: project.leverage,
    initiatorCommitment: project.commitment,
    targetPreparation: 0,
    targetLeverage: 0,
    targetCommitment: 0,
    initiatorActiveTaskIds: [],
    targetActiveTaskIds: [],
    offerHistoryIds: [],
  }

  ws.diplomaticPlays[playId] = play

  // Create initial offer from initiator
  const initialOfferDemands: DiplomaticDemand[] = [
    {
      kind: 'transfer_land_contract',
      holdingId,
      toPolityId: initiator.id,
      beneficiaryActor: initiator,
    },
  ]
  if (counterDemandAmount > 0) {
    initialOfferDemands.push({
      kind: 'pay_wealth',
      from: initiator,
      to: target,
      amount: counterDemandAmount,
    })
  }
  createDiplomaticOfferMut(ws, playId, initiator, initialOfferDemands, [])

  ws.nextDiplomaticPlayId++
  existingPlayKeys.add(dedupeKey)

  if (project.origin.kind === 'aim') {
    const aim = ws.aims[project.origin.aimId]
    if (aim) {
      ws.aims[aim.id] = { ...aim, activeDiplomaticPlayId: playId }
    }
  }

  const initiatorNameKey = ws.polities[initiator.id]?.nameKey ?? String(initiator.id)
  const targetNameKey = ws.polities[target.id]?.nameKey ?? String(target.id)
  const hasOffer = counterDemandAmount > 0
  emitEvent({
    type: 'DIPLOMATIC_PLAY_STARTED',
    importance: 'normal',
    messageKey: hasOffer
      ? 'diplomatic_play.started_with_offer'
      : 'diplomatic_play.started_no_offer',
    messageParams: {
      initiator: nameParam('polity', initiatorNameKey),
      target: nameParam('polity', targetNameKey),
      province: nameParam('province', ws.provinces[provinceId]?.nameKey ?? String(provinceId)),
    },
    entityRefs: [
      entityRef('polity', initiator.id, 'initiator', initiatorNameKey),
      entityRef('polity', target.id, 'target', targetNameKey),
      entityRef('holding', holdingId, 'holding'),
    ],
  })

  return { kind: 'created', playId }
}

function createContractRevisionPlayFromProjectMut(
  ws: WorldState,
  config: SimulationConfig,
  project: ContractRevisionProject,
  existingPlayKeys: Set<string>,
  emitEvent: (input: CreateSimEventInput) => void,
): CreatePlayResult {
  if (project.owner.kind !== 'polity') return { kind: 'invalid_inputs' }
  if (!project.counterpartyPolityId) return { kind: 'invalid_inputs' }

  const holdingId = project.holdingId
  if (!holdingId) return { kind: 'invalid_inputs' }

  const provinceId = ws.holdings[holdingId]?.provinceId
  if (!provinceId) return { kind: 'invalid_inputs' }

  const isReduction = project.kind === 'improve_contract_terms'
  const chain = getProvinceLandContractChain(ws, provinceId)
  const subjectContract = isReduction
    ? chain.find(
        (c) => c && c.granteePolityId === project.owner.id && c.parentContractId !== undefined,
      )
    : chain.find((c) => c && c.granteePolityId === project.counterpartyPolityId)

  if (!subjectContract) return { kind: 'invalid_inputs' }

  const currentRate = subjectContract.terms.taxRateToGrantor
  const desiredDelta = config.taxRevisionInitialDemandDelta
  const newRate = clamp(
    isReduction ? currentRate - desiredDelta : currentRate + desiredDelta,
    config.taxRevisionMinRate,
    config.taxRevisionMaxRate,
  )

  const initiator: PoliticalActorRef = { kind: 'polity', id: project.owner.id }
  const target: PoliticalActorRef = { kind: 'polity', id: project.counterpartyPolityId }

  const dedupeKey = `contract_tax_revision|${initiator.kind}:${initiator.id}|${target.kind}:${target.id}|${provinceId}`
  if (existingPlayKeys.has(dedupeKey)) return { kind: 'duplicate' }

  const initiatorPower = getActorMilitaryPower(ws, config, initiator)
  const targetPower = getActorMilitaryPower(ws, config, target)
  const hasAdvantage = initiatorPower > targetPower

  const playId: DiplomaticPlayId = createDiplomaticPlayId(ws.nextDiplomaticPlayId)
  const initiatorDelegate = getDiplomaticPlayDelegate(ws, initiator)
  const targetDelegate = getDiplomaticPlayDelegate(ws, target, initiatorDelegate)

  const issue: ContractTaxRevisionIssue = {
    kind: 'contract_tax_revision' as const,
    holdingId,
    landContractId: subjectContract.id,
    baseTaxRateToGrantor: currentRate,
    desiredTaxRateToGrantor: newRate,
    direction: isReduction ? ('decrease' as const) : ('increase' as const),
  }

  const play: DiplomaticPlay = {
    id: playId,
    kind: 'contract_tax_revision',
    initiator,
    target,
    originProjectId: project.id,
    ...(project.origin.kind === 'aim' && project.origin.aimId
      ? { aimId: project.origin.aimId }
      : {}),
    issue,
    status: 'active',
    startedWeek: ws.absoluteWeek,
    deadlineWeek: ws.absoluteWeek + config.taxRevisionNegotiationDurationWeeks,
    progress: hasAdvantage ? config.taxRevisionInitialProgressOnAdvantage : 0,
    tension: hasAdvantage ? 0 : config.taxRevisionInitialTensionOnPressure,
    ...(initiatorDelegate ? { initiatorDelegatePersonId: initiatorDelegate } : {}),
    ...(targetDelegate ? { targetDelegatePersonId: targetDelegate } : {}),
    initiatorPreparation: project.preparation,
    initiatorLeverage: project.leverage,
    initiatorCommitment: project.commitment,
    targetPreparation: 0,
    targetLeverage: 0,
    targetCommitment: 0,
    initiatorActiveTaskIds: [],
    targetActiveTaskIds: [],
    offerHistoryIds: [],
  }

  ws.diplomaticPlays[playId] = play

  // Create initial offer from initiator
  const initialOfferDemands: DiplomaticDemand[] = [
    {
      kind: 'change_contract_tax_rate',
      holdingId,
      landContractId: subjectContract.id,
      newTaxRateToGrantor: newRate,
    },
  ]
  const compensation = computeTaxRevisionCompensation(ws, config, issue, newRate)
  if (compensation > 0) {
    initialOfferDemands.push({
      kind: 'pay_wealth',
      from: initiator,
      to: target,
      amount: Math.round(compensation),
    })
  }
  createDiplomaticOfferMut(ws, playId, initiator, initialOfferDemands, [])

  ws.nextDiplomaticPlayId++
  existingPlayKeys.add(dedupeKey)

  if (project.origin.kind === 'aim') {
    const aim = ws.aims[project.origin.aimId]
    if (aim) {
      ws.aims[aim.id] = { ...aim, activeDiplomaticPlayId: playId }
    }
  }

  const initiatorNameKey = ws.polities[initiator.id]?.nameKey ?? String(initiator.id)
  const targetNameKey = ws.polities[target.id]?.nameKey ?? String(target.id)
  const hasInitialOffer = compensation > 0
  emitEvent({
    type: 'DIPLOMATIC_PLAY_STARTED',
    importance: 'normal',
    messageKey: hasInitialOffer
      ? 'diplomatic_play.started_with_offer'
      : 'diplomatic_play.started_no_offer',
    messageParams: {
      initiator: nameParam('polity', initiatorNameKey),
      target: nameParam('polity', targetNameKey),
      province: nameParam('province', ws.provinces[provinceId]?.nameKey ?? String(provinceId)),
    },
    entityRefs: [
      entityRef('polity', initiator.id, 'initiator', initiatorNameKey),
      entityRef('polity', target.id, 'target', targetNameKey),
      entityRef('holding', holdingId, 'holding'),
    ],
  })

  return { kind: 'created', playId }
}

export function checkLandPurchaseEligibility(
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
    if (`${neighborGrantor.kind}:${neighborGrantor.id}` === targetGrantorKey) return true
  }
  return false
}

export function computeLandPurchasePrice(
  state: WorldState,
  provinceId: ProvinceId,
  config?: SimulationConfig,
): number {
  // config 未指定時は default 値で算出 (調査 §5.3: --config で上書き可能に)
  const lc = config ?? defaultLandContractConfig
  const development = getProvinceDevelopmentFromHoldings(state, provinceId, config)
  return Math.max(
    lc.purchasePriceBase,
    lc.purchasePriceBase + development * lc.purchasePriceDevelopmentFactor,
  )
}
