import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { Project, LandClaimProject, ContractRevisionProject } from '../types/project'
import type {
  DiplomaticPlay,
  DiplomaticDemand,
  ContractTaxRevisionIssue,
} from '../types/diplomaticPlay'
import type { OrganizationRef } from '../types/office'
import type { DiplomaticPlayId, PolityId, ProvinceId } from '../types/ids'
import type { CreateSimEventInput } from '../tick/context'
import { createDiplomaticPlayId } from '../types/ids'
import { nameParam, entityRef } from '../types/event'
import {
  getProvinceDominantTerminalContract,
  getHoldingLandContractChain,
  getHoldingTerminalPolityId,
  getLandContractGrantor,
  getProvinceDevelopmentFromHoldings,
  selectTargetHoldingInProvince,
} from '../selectors/landContractSelectors'
import { canTransferLandContract } from './landContractMutations'
import { getActorMilitaryPower } from '../selectors/actorSelectors'
import { predictPressureResponseStance } from '../selectors/pressureStanceSelectors'
import { politiesShareOwnerHouse } from '../selectors/polityRelations'
import { getPolityNameRefForEmit } from '../selectors/nameRefSelectors'
import { getDiplomaticPlayDelegate } from '../selectors/taskSelectors'
import { clamp } from '../utils/math'
import { defaultLandContractConfig } from '../config/landContractConfig'
import { createDiplomaticOfferMut } from './diplomaticOfferMutations'
import { computeTaxRevisionCompensation } from '../tick/diplomaticOfferEvaluation'

export type CreatePlayResult =
  | { kind: 'created'; playId: DiplomaticPlayId }
  | { kind: 'duplicate' }
  | { kind: 'invalid_inputs' }
  // 相手が応じる見込みがなく (resist 確実)、起こしても status_quo に終わるだけの外交劇。
  // invalid_inputs (毎 tick retry) と区別し、呼出側でプロジェクトを失敗扱いにして actor を解放する。
  | { kind: 'infeasible' }

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

  // v0.45.2 同家戦争防止ゲート (安全網): 同じ支配家の polity 同士の play は生成しない。
  //   主ゲートは aim 選定 (goalSelectors) / target 解決 (taskProjectCompletion) — ここは
  //   生成までの間に ownership が変わった場合の防御。sell_land も含め全 kind で
  //   「同家ペアの play は存在しない」不変条件を保つ。
  if (politiesShareOwnerHouse(ws, project.owner.id, project.counterpartyPolityId)) {
    return { kind: 'invalid_inputs' }
  }

  const holdingId = project.holdingId ?? selectTargetHoldingInProvince(ws, provinceId)
  if (!holdingId) return { kind: 'invalid_inputs' }

  let initiator: OrganizationRef
  let target: OrganizationRef
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

  // §6.5: transfer の宛先は常に initiator (demand.toPolityId = initiator.id)。fromPolityId は
  //   war goal (createWarGoalFromDiplomaticPlay) と同じく holding の現 terminal grantee。rank invariant 上
  //   transfer 不能な holding は seize しても warScore で勝てず白紙和平ループになるため、play / war 化
  //   する前に warCreationSystem.isWarGoalApplicable と同一 predicate で弾く (play spam も防ぐ)。
  const transferFromPolityId = getHoldingTerminalPolityId(ws, holdingId) ?? target.id
  if (!canTransferLandContract(ws, holdingId, transferFromPolityId, initiator.id)) {
    return { kind: 'invalid_inputs' }
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
    initiatorSupporters: [],
    targetSupporters: [],
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

  const initiatorRef = getPolityNameRefForEmit(ws, initiator.id)
  const targetRef = getPolityNameRefForEmit(ws, target.id)
  const initiatorNameKey = initiatorRef.nameKey
  const targetNameKey = targetRef.nameKey
  const hasOffer = counterDemandAmount > 0
  emitEvent({
    type: 'DIPLOMATIC_PLAY_STARTED',
    importance: 'normal',
    messageKey: hasOffer
      ? 'diplomatic_play.started_with_offer'
      : 'diplomatic_play.started_no_offer',
    messageParams: {
      initiator: nameParam(initiatorRef.category, initiatorNameKey),
      target: nameParam(targetRef.category, targetNameKey),
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
  // 調査 §4.1: project が holdingId を保有しているので、legacy な province チェーンでなく
  // 対象 holding 自身の chain (byHolding) を検索対象にする (province 単位 1 チェーンの代用を撤廃)。
  const chain = getHoldingLandContractChain(ws, holdingId)
  const subjectContract = isReduction
    ? chain.find(
        (c) => c && c.granteePolityId === project.owner.id && c.parentContractId !== undefined,
      )
    : chain.find((c) => c && c.granteePolityId === project.counterpartyPolityId)

  if (!subjectContract) return { kind: 'invalid_inputs' }

  const currentRate = subjectContract.terms.taxRateToGrantor
  const desiredDelta = config.taxRevisionInitialDemandDelta
  // 契約取消し意図の復元: goalSelectors の eliminate_*_contract aim は税率が既に境界付近のとき
  //   「+/-delta の小刻み改定」でなく「契約そのものの排除」を狙う。だが aim→project の縮退で
  //   その意図が落ちるため、aim 発火と同じ閾値条件 (taxRevisionMin/MaxRateForReduction/Increase)
  //   をここで再判定し、取消し時は税率境界 (min/max) を直接要求する。これにより勝利/受諾時に
  //   CONTRACT_ELIMINATED が確実に発火する。
  //   旧実装は increase 側で aim 閾値 0.6 と「+delta が max 0.8 に届く」境界 0.7 が食い違い、
  //   税率 [0.6, 0.7) の取消し意図が黙って増税に縮退していた (reduction 側は閾値 0.15 =
  //   min 0.05 + delta 0.1 で偶然整合しており、ここでの明示化は bit-identical)。
  const newRate = isReduction
    ? currentRate <= config.taxRevisionMinRateForReduction
      ? config.taxRevisionMinRate
      : clamp(currentRate - desiredDelta, config.taxRevisionMinRate, config.taxRevisionMaxRate)
    : currentRate >= config.taxRevisionMaxRateForIncrease
      ? config.taxRevisionMaxRate
      : clamp(currentRate + desiredDelta, config.taxRevisionMinRate, config.taxRevisionMaxRate)

  // §6.69: reduction 境界要求 (= overlord 契約の取消し) は、除去対象である overlord (= 自契約の親)
  //   が除去可能 (非 root) な場合のみ成立する。overlord が主権者 (root 保持) なら勝っても applyTaxGoal
  //   が no-op (white_peace) になり、同一 holding への futile な解除戦争が連発する。除去不能なら
  //   play を生成しない。improve aim が時間差で税率を境界まで下げてしまうケース (project 作成時は
  //   tax>0.15 でも play 生成時には ≤0.15) もここで弾く (goalSelectors の aim 発火ゲートと二重の網)。
  if (isReduction && newRate <= config.taxRevisionMinRate) {
    const parentId = subjectContract.parentContractId
    const parentContract = parentId !== undefined ? ws.landContracts[parentId] : undefined
    if (!parentContract || parentContract.rootAuthorityId) {
      return { kind: 'infeasible' }
    }
  }

  const initiator: OrganizationRef = { kind: 'polity', id: project.owner.id }
  const target: OrganizationRef = { kind: 'polity', id: project.counterpartyPolityId }

  // v0.45.2 同家戦争防止ゲート (安全網): 同じ支配家の polity 同士の play は生成しない。
  //   主ゲートは aim 選定 (goalSelectors) / target 解決 (taskProjectCompletion)。
  if (politiesShareOwnerHouse(ws, initiator.id, target.id)) {
    return { kind: 'infeasible' }
  }

  // 開始ゲート: 相手 (target) が resist 確実 = 起こしても status_quo に終わるだけの
  // 外交劇は開始しない。受諾見込みの予測を projectStageSystem の stance 決定と同一式で共有する
  // (initiator が圧力源、target が被圧力側)。弱い臣下が強い宗主に減税要求を出し続け
  // 「外交劇は起こすが何も変わらない」が連発する問題を、行動を起こす前に弾く。
  if (predictPressureResponseStance(ws, config, initiator, target) === 'resist') {
    return { kind: 'infeasible' }
  }

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
    initiatorSupporters: [],
    targetSupporters: [],
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

  const initiatorRef = getPolityNameRefForEmit(ws, initiator.id)
  const targetRef = getPolityNameRefForEmit(ws, target.id)
  const initiatorNameKey = initiatorRef.nameKey
  const targetNameKey = targetRef.nameKey
  const hasInitialOffer = compensation > 0
  emitEvent({
    type: 'DIPLOMATIC_PLAY_STARTED',
    importance: 'normal',
    messageKey: hasInitialOffer
      ? 'diplomatic_play.started_with_offer'
      : 'diplomatic_play.started_no_offer',
    messageParams: {
      initiator: nameParam(initiatorRef.category, initiatorNameKey),
      target: nameParam(targetRef.category, targetNameKey),
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

  const targetContract = getProvinceDominantTerminalContract(state, provinceId)
  if (!targetContract) return false
  const targetGrantor = getLandContractGrantor(state, targetContract.id)
  if (!targetGrantor) return false
  const targetGrantorKey = `${targetGrantor.kind}:${targetGrantor.id}`

  const targetProvince = state.provinces[provinceId]
  if (!targetProvince) return false
  for (const neighborId of targetProvince.neighbors) {
    const neighborContract = getProvinceDominantTerminalContract(state, neighborId)
    if (!neighborContract) continue
    if (neighborContract.granteePolityId !== acquirerPolityId) continue
    const neighborGrantor = getLandContractGrantor(state, neighborContract.id)
    if (!neighborGrantor) continue
    if (`${neighborGrantor.kind}:${neighborGrantor.id}` === targetGrantorKey) return true
  }
  return false
}

function computeLandPurchasePrice(
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
