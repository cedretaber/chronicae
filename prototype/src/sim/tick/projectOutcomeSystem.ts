import type { TickContext } from './context'
import type { CreateSimEventInput } from './context'
import type { SimEvent } from '../types/event'
import { nameParam, entityRef } from '../types/event'
import type { WorldState } from '../types/world'
import type { Project, LandClaimProject, ContractRevisionProject } from '../types/project'
import type { DiplomaticPlay } from '../types/diplomaticPlay'
import type { PoliticalActorRef } from '../types/actor'
import type {
  EventId,
  PolityId,
  OrganizationShareId,
  DiplomaticPlayId,
  ProvinceId,
} from '../types/ids'
import { createDiplomaticPlayId, createOrganizationShareId } from '../types/ids'
import type { SimulationConfig } from '../config/defaultConfig'
import { clamp } from '../utils/math'
import { removeProjectFromIndexMut, isDiplomaticProjectKind } from '../mutations/projectMutations'
import {
  getProvinceTerminalContract,
  getProvinceLandContractChain,
  getLandContractGrantor,
  getProvinceDevelopmentFromHoldings,
  selectTargetHoldingInProvince,
} from '../selectors/landContractSelectors'
import { getActorMilitaryPower } from '../selectors/actorSelectors'
import { getDiplomaticPlayDelegate } from '../selectors/taskSelectors'
import { defaultLandContractConfig } from '../config/landContractConfig'

export function runProjectOutcomeSystem(ctx: TickContext): TickContext {
  const config = ctx.config

  const ws: WorldState = {
    ...ctx.state,
    projects: { ...ctx.state.projects },
    projectIndex: {
      byOwner: { ...ctx.state.projectIndex.byOwner },
      byAim: { ...ctx.state.projectIndex.byAim },
      byParentProject: { ...ctx.state.projectIndex.byParentProject },
      byCreatorPerson: { ...ctx.state.projectIndex.byCreatorPerson },
      bySupervisorPerson: { ...ctx.state.projectIndex.bySupervisorPerson },
      byRelatedEntity: { ...ctx.state.projectIndex.byRelatedEntity },
    },
    aims: { ...ctx.state.aims },
    polities: { ...ctx.state.polities },
    houses: { ...ctx.state.houses },
    holdings: { ...ctx.state.holdings },
    organizationShares: { ...ctx.state.organizationShares },
    shareIndex: {
      byOrganization: { ...ctx.state.shareIndex.byOrganization },
      byHolder: { ...ctx.state.shareIndex.byHolder },
    },
    diplomaticPlays: { ...ctx.state.diplomaticPlays },
  }

  const newEvents: SimEvent[] = []
  let nextEventIndex = ctx.nextEventIndex

  function emitEvent(input: CreateSimEventInput): void {
    const id = `e-${ws.absoluteWeek}-${nextEventIndex}` as EventId
    nextEventIndex++
    newEvents.push({
      id,
      year: ws.currentYear,
      weekOfYear: ws.currentWeekOfYear,
      type: input.type,
      importance: input.importance,
      messageKey: input.messageKey,
      messageParams: input.messageParams,
      entityRefs: input.entityRefs ?? [],
      reasons: input.reasons ?? [],
      effects: input.effects ?? [],
    })
  }

  const terminalProjects: Project[] = []
  for (const [, project] of Object.entries(ws.projects)) {
    if (!project) continue
    if (
      project.status === 'completed' ||
      project.status === 'failed' ||
      project.status === 'cancelled'
    ) {
      terminalProjects.push(project)
    }
  }

  const existingActivePlayKeys = buildExistingPlayKeys(ws)

  for (const project of terminalProjects) {
    if (project.status === 'completed') {
      if (isDiplomaticProjectKind(project.kind)) {
        createDiplomaticPlayFromProjectMut(ws, config, project, existingActivePlayKeys, emitEvent)
      } else {
        applyNonDiplomaticEffectMut(ws, config, project, emitEvent)
        addAimProgressForCompletedProjectMut(ws, config, project)
      }
      if (project.origin.kind === 'aim') {
        const aim = ws.aims[project.origin.aimId]
        if (aim) {
          ws.aims[aim.id] = { ...aim, successfulProjectCount: aim.successfulProjectCount + 1 }
        }
      }
    } else if (project.status === 'failed') {
      if (project.origin.kind === 'aim') {
        const aim = ws.aims[project.origin.aimId]
        if (aim) {
          ws.aims[aim.id] = { ...aim, failedProjectCount: aim.failedProjectCount + 1 }
        }
      }
    }

    removeProjectFromIndexMut(ws, project)
    delete ws.projects[project.id]
  }

  return {
    ...ctx,
    state: ws,
    events: [...ctx.events, ...newEvents],
    nextEventIndex,
  }
}

// --- Non-diplomatic effect application ---

function applyNonDiplomaticEffectMut(
  ws: WorldState,
  config: SimulationConfig,
  project: Project,
  emitEvent: (input: CreateSimEventInput) => void,
): void {
  switch (project.kind) {
    case 'develop_holding':
      applyDevelopHoldingMut(ws, config, project, emitEvent)
      break
    case 'expand_polity_share':
      applyExpandPolityShareMut(ws, config, project, emitEvent)
      break
    case 'promote_policy_shift':
      applyPromotePolicyShiftMut(ws, project, emitEvent)
      break
    case 'patronize_artist':
      applyPatronizeArtistMut(ws, config, project, emitEvent)
      break
    case 'commission_chronicle':
      applyCommissionChronicleMut(ws, config, project, emitEvent)
      break
  }
}

function applyDevelopHoldingMut(
  ws: WorldState,
  config: SimulationConfig,
  project: Project,
  emitEvent: (input: CreateSimEventInput) => void,
): void {
  if (project.owner.kind !== 'polity') return
  const polityId = project.owner.id
  const polity = ws.polities[polityId]
  if (!polity || !polity.active) return
  if (polity.treasury < config.developHoldingCost) return

  const holdingId = 'holdingId' in project ? project.holdingId : undefined
  if (!holdingId) return
  const holding = ws.holdings[holdingId]
  if (!holding) return

  const tp = ws.holdingTerminalPolityCache[holdingId]
  if (!tp || (tp as string) !== (polityId as string)) return

  const newDev = clamp(holding.development + config.developHoldingGain, -100, 100)
  ws.polities[polityId] = { ...polity, treasury: polity.treasury - config.developHoldingCost }
  ws.holdings[holdingId] = { ...holding, development: newDev }

  const polityNameKey = polity.nameKey
  const provinceNameKey = ws.provinces[holding.provinceId]?.nameKey ?? holding.provinceId
  emitEvent({
    type: 'COUNTRY_LAND_DEVELOPED',
    importance: 'minor',
    messageKey: 'polity.land_developed',
    messageParams: {
      polity: nameParam('polity', polityNameKey),
      province: nameParam('province', provinceNameKey),
    },
    entityRefs: [
      entityRef('polity', polityId, 'polity', polityNameKey),
      entityRef('province', holding.provinceId, 'province', provinceNameKey),
    ],
  })
}

function applyExpandPolityShareMut(
  ws: WorldState,
  config: SimulationConfig,
  project: Project,
  emitEvent: (input: CreateSimEventInput) => void,
): void {
  if (project.owner.kind !== 'house') return
  const houseId = project.owner.id
  const house = ws.houses[houseId]
  if (!house || !house.active) return
  if (house.wealth < config.expandPolityShareCost) return

  const polityId = 'polityId' in project ? project.polityId : undefined
  if (!polityId) return
  const polity = ws.polities[polityId]
  if (!polity || !polity.active) return

  const shareIds = ws.shareIndex.byOrganization[polityId] ?? []
  let existingShareId: OrganizationShareId | undefined
  for (const sid of shareIds) {
    const share = ws.organizationShares[sid]
    if (
      share &&
      share.holder.kind === 'house' &&
      (share.holder.id as string) === (houseId as string)
    ) {
      existingShareId = sid
      break
    }
  }

  if (existingShareId) {
    const existingShare = ws.organizationShares[existingShareId]
    if (existingShare) {
      ws.organizationShares[existingShareId] = {
        ...existingShare,
        rawPower: existingShare.rawPower + config.expandPolityShareRawPowerGain,
      }
    }
  } else {
    const newShareId = createOrganizationShareId(ws.nextOrganizationShareId)
    ws.organizationShares[newShareId] = {
      id: newShareId,
      organization: { kind: 'polity', id: polityId },
      holder: { kind: 'house', id: houseId },
      rawPower: config.expandPolityShareRawPowerGain,
    }
    ws.shareIndex.byOrganization[polityId] = [
      ...(ws.shareIndex.byOrganization[polityId] ?? []),
      newShareId,
    ]
    ws.shareIndex.byHolder[houseId] = [...(ws.shareIndex.byHolder[houseId] ?? []), newShareId]
    ws.nextOrganizationShareId++
  }

  ws.houses[houseId] = { ...house, wealth: house.wealth - config.expandPolityShareCost }

  emitEvent({
    type: 'HOUSE_POLITY_SHARE_EXPANDED',
    importance: 'minor',
    messageKey: 'house.polity_share_expanded',
    messageParams: {
      house: nameParam('house', house.nameKey),
      polity: nameParam('polity', polity.nameKey),
    },
    entityRefs: [
      entityRef('house', houseId, 'house', house.nameKey),
      entityRef('polity', polityId, 'polity', polity.nameKey),
    ],
  })
}

function applyPromotePolicyShiftMut(
  ws: WorldState,
  project: Project,
  emitEvent: (input: CreateSimEventInput) => void,
): void {
  if (project.owner.kind !== 'house') return
  const houseId = project.owner.id
  const house = ws.houses[houseId]
  if (!house || !house.active) return

  const polityId = 'polityId' in project ? project.polityId : undefined
  if (!polityId) return
  const polity = ws.polities[polityId]
  if (!polity || !polity.active) return

  emitEvent({
    type: 'HOUSE_POLICY_INFLUENCE',
    importance: 'minor',
    messageKey: 'house.policy_influence',
    messageParams: {
      house: nameParam('house', house.nameKey),
      polity: nameParam('polity', polity.nameKey),
    },
    entityRefs: [
      entityRef('house', houseId, 'house', house.nameKey),
      entityRef('polity', polityId, 'polity', polity.nameKey),
    ],
  })
}

function applyPatronizeArtistMut(
  ws: WorldState,
  config: SimulationConfig,
  project: Project,
  emitEvent: (input: CreateSimEventInput) => void,
): void {
  if (project.owner.kind !== 'house') return
  const houseId = project.owner.id
  const house = ws.houses[houseId]
  if (!house || !house.active) return
  if (house.wealth < config.patronizeArtistCost) return

  ws.houses[houseId] = {
    ...house,
    wealth: house.wealth - config.patronizeArtistCost,
    legacyPrestige: house.legacyPrestige + config.patronizeArtistPrestigeGain,
  }

  emitEvent({
    type: 'HOUSE_PATRONIZED_ARTIST',
    importance: 'minor',
    messageKey: 'house.patronized_artist',
    messageParams: { house: nameParam('house', house.nameKey) },
    entityRefs: [entityRef('house', houseId, 'house', house.nameKey)],
  })
}

function applyCommissionChronicleMut(
  ws: WorldState,
  config: SimulationConfig,
  project: Project,
  emitEvent: (input: CreateSimEventInput) => void,
): void {
  if (project.owner.kind !== 'house') return
  const houseId = project.owner.id
  const house = ws.houses[houseId]
  if (!house || !house.active) return
  if (house.wealth < config.commissionChronicleCost) return

  ws.houses[houseId] = {
    ...house,
    wealth: house.wealth - config.commissionChronicleCost,
    legacyPrestige: house.legacyPrestige + config.commissionChroniclePrestigeGain,
  }

  emitEvent({
    type: 'HOUSE_COMMISSIONED_CHRONICLE',
    importance: 'minor',
    messageKey: 'house.commissioned_chronicle',
    messageParams: { house: nameParam('house', house.nameKey) },
    entityRefs: [entityRef('house', houseId, 'house', house.nameKey)],
  })
}

// --- Aim progress for non-diplomatic projects ---

function addAimProgressForCompletedProjectMut(
  ws: WorldState,
  config: SimulationConfig,
  project: Project,
): void {
  if (project.origin.kind !== 'aim') return
  const aim = ws.aims[project.origin.aimId]
  if (!aim || aim.status !== 'active') return

  let progressGain: number
  switch (aim.kind) {
    case 'develop_owned_holding':
      progressGain = config.aimProgressGainDevelopmentProject
      break
    case 'increase_polity_share':
    case 'steer_polity_external_expansion':
    case 'steer_polity_internal_development':
      progressGain = config.aimProgressGainPowerProject
      break
    case 'patronize_artist':
    case 'commission_chronicle':
      progressGain = config.aimProgressGainCultureProject
      break
    default:
      progressGain = config.aimProgressGainCultureProject
      break
  }

  let newProgress = clamp(aim.progress + progressGain, 0, aim.targetProgress)
  if (newProgress >= aim.targetProgress - config.aimProgressCompletionTolerance) {
    newProgress = aim.targetProgress
    ws.aims[aim.id] = { ...aim, progress: newProgress, status: 'succeeded' }
  } else {
    ws.aims[aim.id] = { ...aim, progress: newProgress }
  }
}

// --- Diplomatic play creation ---

function buildExistingPlayKeys(ws: WorldState): Set<string> {
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
  const d = play.primaryDemand
  if (d.kind === 'transfer_land_contract') return state.holdings[d.holdingId]?.provinceId
  if (d.kind === 'change_contract_tax_rate') return state.holdings[d.holdingId]?.provinceId
  if (d.kind === 'revolt_concession') return d.provinceId
  return undefined
}

function createDiplomaticPlayFromProjectMut(
  ws: WorldState,
  config: SimulationConfig,
  project: Project,
  existingPlayKeys: Set<string>,
  emitEvent: (input: CreateSimEventInput) => void,
): void {
  if (project.kind === 'acquire_land' || project.kind === 'sell_land') {
    createLandClaimPlayFromProjectMut(ws, config, project, existingPlayKeys, emitEvent)
  } else if (project.kind === 'improve_contract_terms' || project.kind === 'demand_tax_increase') {
    createContractRevisionPlayFromProjectMut(ws, config, project, existingPlayKeys, emitEvent)
  }
}

function createLandClaimPlayFromProjectMut(
  ws: WorldState,
  config: SimulationConfig,
  project: LandClaimProject,
  existingPlayKeys: Set<string>,
  emitEvent: (input: CreateSimEventInput) => void,
): void {
  if (project.owner.kind !== 'polity') return
  if (!project.counterpartyPolityId) return

  const provinceId = project.provinceId
  if (!provinceId) return

  const holdingId = project.holdingId ?? selectTargetHoldingInProvince(ws, provinceId)
  if (!holdingId) return

  let initiator: PoliticalActorRef
  let target: PoliticalActorRef
  let counterDemandAmount: number
  let initialProgress: number
  let initialTension: number

  if (project.kind === 'sell_land') {
    initiator = { kind: 'polity', id: project.counterpartyPolityId }
    target = { kind: 'polity', id: project.owner.id }
    counterDemandAmount = computeLandPurchasePrice(ws, provinceId)
    initialProgress = config.landClaimInitialProgressOnConsent
    initialTension = 0
  } else {
    initiator = { kind: 'polity', id: project.owner.id }
    target = { kind: 'polity', id: project.counterpartyPolityId }

    const buyerPolity = ws.polities[initiator.id]
    const sellerPolity = ws.polities[target.id]
    if (!buyerPolity || !buyerPolity.active || !sellerPolity || !sellerPolity.active) return
    if (buyerPolity.ownerHouseId === undefined || sellerPolity.ownerHouseId === undefined) return

    const eligible = checkLandPurchaseEligibility(ws, initiator.id, target.id, provinceId)
    if (eligible) {
      const price = computeLandPurchasePrice(ws, provinceId)
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
  if (existingPlayKeys.has(dedupeKey)) return

  const playId: DiplomaticPlayId = createDiplomaticPlayId(ws.nextDiplomaticPlayId)
  const initiatorDelegate = getDiplomaticPlayDelegate(ws, initiator)
  const targetDelegate = getDiplomaticPlayDelegate(ws, target)

  const play: DiplomaticPlay = {
    id: playId,
    kind: 'land_claim',
    initiator,
    target,
    originProjectId: project.id,
    ...(project.origin.kind === 'aim' && project.origin.aimId
      ? { aimId: project.origin.aimId }
      : {}),
    primaryDemand: {
      kind: 'transfer_land_contract',
      holdingId,
      toPolityId: initiator.id,
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
  }

  ws.diplomaticPlays[playId] = play
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
    },
    entityRefs: [
      entityRef('polity', initiator.id, 'initiator', initiatorNameKey),
      entityRef('polity', target.id, 'target', targetNameKey),
      entityRef('holding', holdingId, 'holding'),
    ],
  })
}

function createContractRevisionPlayFromProjectMut(
  ws: WorldState,
  config: SimulationConfig,
  project: ContractRevisionProject,
  existingPlayKeys: Set<string>,
  emitEvent: (input: CreateSimEventInput) => void,
): void {
  if (project.owner.kind !== 'polity') return
  if (!project.counterpartyPolityId) return

  const holdingId = project.holdingId
  if (!holdingId) return

  const provinceId = ws.holdings[holdingId]?.provinceId
  if (!provinceId) return

  const isReduction = project.kind === 'improve_contract_terms'
  const chain = getProvinceLandContractChain(ws, provinceId)
  const subjectContract = isReduction
    ? chain.find(
        (c) => c && c.granteePolityId === project.owner.id && c.parentContractId !== undefined,
      )
    : chain.find((c) => c && c.granteePolityId === project.counterpartyPolityId)

  if (!subjectContract) return

  const currentRate = subjectContract.terms.taxRateToGrantor
  const newRate = isReduction
    ? currentRate - config.taxRevisionTaxChangeAmount
    : currentRate + config.taxRevisionTaxChangeAmount

  const initiator: PoliticalActorRef = { kind: 'polity', id: project.owner.id }
  const target: PoliticalActorRef = { kind: 'polity', id: project.counterpartyPolityId }

  const dedupeKey = `contract_tax_revision|${initiator.kind}:${initiator.id}|${target.kind}:${target.id}|${provinceId}`
  if (existingPlayKeys.has(dedupeKey)) return

  const initiatorPower = getActorMilitaryPower(ws, config, initiator)
  const targetPower = getActorMilitaryPower(ws, config, target)
  const hasAdvantage = initiatorPower > targetPower

  const playId: DiplomaticPlayId = createDiplomaticPlayId(ws.nextDiplomaticPlayId)
  const initiatorDelegate = getDiplomaticPlayDelegate(ws, initiator)
  const targetDelegate = getDiplomaticPlayDelegate(ws, target)

  const play: DiplomaticPlay = {
    id: playId,
    kind: 'contract_tax_revision',
    initiator,
    target,
    originProjectId: project.id,
    ...(project.origin.kind === 'aim' && project.origin.aimId
      ? { aimId: project.origin.aimId }
      : {}),
    primaryDemand: {
      kind: 'change_contract_tax_rate',
      holdingId,
      landContractId: subjectContract.id,
      newTaxRateToGrantor: newRate,
    },
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
  }

  ws.diplomaticPlays[playId] = play
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
  emitEvent({
    type: 'DIPLOMATIC_PLAY_STARTED',
    importance: 'normal',
    messageKey: 'diplomatic_play.started_no_offer',
    messageParams: {
      initiator: nameParam('polity', initiatorNameKey),
      target: nameParam('polity', targetNameKey),
    },
    entityRefs: [
      entityRef('polity', initiator.id, 'initiator', initiatorNameKey),
      entityRef('polity', target.id, 'target', targetNameKey),
      entityRef('holding', holdingId, 'holding'),
    ],
  })
}

// --- Helpers ---

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
    if (`${neighborGrantor.kind}:${neighborGrantor.id}` === targetGrantorKey) return true
  }
  return false
}

function computeLandPurchasePrice(state: WorldState, provinceId: ProvinceId): number {
  const development = getProvinceDevelopmentFromHoldings(state, provinceId)
  return Math.max(
    defaultLandContractConfig.purchasePriceBase,
    defaultLandContractConfig.purchasePriceBase +
      development * defaultLandContractConfig.purchasePriceDevelopmentFactor,
  )
}
