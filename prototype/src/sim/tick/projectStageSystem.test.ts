import { describe, it, expect } from 'vitest'
import { makeEmptyV016State, withHouse, withPerson, withPolity } from '../testFixtures'
import { defaultConfig } from '../config/defaultConfig'
import { resolveImmediateStages } from './projectStageSystem'
import { addProjectToIndexMut } from '../mutations/projectMutations'
import { createDiplomaticOfferId } from '../types/ids'
import type { WorldState } from '../types/world'
import type { RespondToPressureProject, DevelopHoldingProject } from '../types/project'
import type { DiplomaticPlay, DiplomaticOffer, DiplomaticDemand } from '../types/diplomaticPlay'
import type {
  ProjectId,
  DiplomaticPlayId,
  DiplomaticOfferId,
  PolityId,
  HoldingId,
  HoldingOfficeAssignmentId,
  HouseId,
  LandContractId,
  PersonId,
  PressureId,
} from '../types/ids'
import { PLACEHOLDER_PERSON_ID } from '../types/person'
import type { PressureResponseStance } from '../types/pressure'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeProject(
  overrides?: Partial<RespondToPressureProject> & {
    diplomaticPlayId?: DiplomaticPlayId | undefined
    stance?: PressureResponseStance | undefined
  },
): RespondToPressureProject {
  const base: RespondToPressureProject = {
    id: 'proj-1' as ProjectId,
    owner: { kind: 'polity', id: 'c-target' as PolityId },
    origin: { kind: 'system', reasonKey: 'test' },
    kind: 'respond_to_pressure',
    creatorPersonId: PLACEHOLDER_PERSON_ID,
    supervisorPersonId: PLACEHOLDER_PERSON_ID,
    status: 'active',
    progress: 0,
    targetProgress: 100,
    currentStageKey: 'propose_initial_offer',
    createdWeek: 48000,
    reasonIds: [],
    pressureId: 'prs-1' as PressureId,
    diplomaticPlayId: 'dp-1' as DiplomaticPlayId,
  }
  return { ...base, ...overrides }
}

function makeProjectWithoutPlayId(
  overrides?: Partial<RespondToPressureProject> & {
    stance?: PressureResponseStance | undefined
  },
): RespondToPressureProject {
  type Base = Omit<RespondToPressureProject, 'diplomaticPlayId'>
  const base: Base = {
    id: 'proj-1' as ProjectId,
    owner: { kind: 'polity', id: 'c-target' as PolityId },
    origin: { kind: 'system', reasonKey: 'test' },
    kind: 'respond_to_pressure',
    creatorPersonId: PLACEHOLDER_PERSON_ID,
    supervisorPersonId: PLACEHOLDER_PERSON_ID,
    status: 'active',
    progress: 0,
    targetProgress: 100,
    currentStageKey: 'propose_initial_offer',
    createdWeek: 48000,
    reasonIds: [],
    pressureId: 'prs-1' as PressureId,
    ...overrides,
  }
  return { ...base }
}

function makeProjectWithoutStance(
  overrides?: Partial<RespondToPressureProject> & {
    diplomaticPlayId?: DiplomaticPlayId | undefined
  },
): RespondToPressureProject {
  type Base = Omit<RespondToPressureProject, 'stance'>
  const base: Base = {
    id: 'proj-1' as ProjectId,
    owner: { kind: 'polity', id: 'c-target' as PolityId },
    origin: { kind: 'system', reasonKey: 'test' },
    kind: 'respond_to_pressure',
    creatorPersonId: PLACEHOLDER_PERSON_ID,
    supervisorPersonId: PLACEHOLDER_PERSON_ID,
    status: 'active',
    progress: 0,
    targetProgress: 100,
    currentStageKey: 'propose_initial_offer',
    createdWeek: 48000,
    reasonIds: [],
    pressureId: 'prs-1' as PressureId,
    diplomaticPlayId: 'dp-1' as DiplomaticPlayId,
    ...overrides,
  }
  return { ...base }
}

function makePlay(
  kind: DiplomaticPlay['kind'],
  overrides?: Partial<DiplomaticPlay> & { issue?: DiplomaticPlay['issue'] },
): DiplomaticPlay {
  return {
    id: 'dp-1' as DiplomaticPlayId,
    kind,
    initiator: { kind: 'polity', id: 'c-init' as PolityId },
    target: { kind: 'polity', id: 'c-target' as PolityId },
    status: 'active',
    startedWeek: 48000,
    deadlineWeek: 48048,
    progress: 0,
    tension: 0,
    initiatorPreparation: 0,
    initiatorLeverage: 0,
    initiatorCommitment: 0,
    targetPreparation: 0,
    targetLeverage: 0,
    targetCommitment: 0,
    initiatorSupporters: [],
    targetSupporters: [],
    initiatorActiveTaskIds: [],
    targetActiveTaskIds: [],
    offerHistoryIds: [],
    ...overrides,
  }
}

function makePlayWithoutIssue(
  kind: DiplomaticPlay['kind'],
  overrides?: Partial<DiplomaticPlay>,
): DiplomaticPlay {
  type Base = Omit<DiplomaticPlay, 'issue'>
  const base: Base = {
    id: 'dp-1' as DiplomaticPlayId,
    kind,
    initiator: { kind: 'polity', id: 'c-init' as PolityId },
    target: { kind: 'polity', id: 'c-target' as PolityId },
    status: 'active',
    startedWeek: 48000,
    deadlineWeek: 48048,
    progress: 0,
    tension: 0,
    initiatorPreparation: 0,
    initiatorLeverage: 0,
    initiatorCommitment: 0,
    targetPreparation: 0,
    targetLeverage: 0,
    targetCommitment: 0,
    initiatorSupporters: [],
    targetSupporters: [],
    initiatorActiveTaskIds: [],
    targetActiveTaskIds: [],
    offerHistoryIds: [],
    ...overrides,
  }
  return { ...base }
}

function makeOffer(
  demands: DiplomaticDemand[],
  overrides?: Partial<DiplomaticOffer>,
): DiplomaticOffer {
  return {
    id: 'do-1' as DiplomaticOfferId,
    playId: 'dp-1' as DiplomaticPlayId,
    proposedBy: { kind: 'polity', id: 'c-init' as PolityId },
    demands,
    status: 'pending',
    createdWeek: 48000,
    reasonIds: [],
    ...overrides,
  }
}

function injectScenario(
  ws: WorldState,
  project: RespondToPressureProject,
  play?: DiplomaticPlay,
  offer?: DiplomaticOffer,
): void {
  ws.projects[project.id] = project
  addProjectToIndexMut(ws, project)
  if (play) {
    ws.diplomaticPlays[play.id] = play
  }
  if (offer) {
    ws.diplomaticOffers[offer.id] = offer
  }
}

function run(ws: WorldState, projectId: ProjectId = 'proj-1' as ProjectId): void {
  resolveImmediateStages(ws, defaultConfig, projectId, ws.absoluteWeek)
}

function getProject(ws: WorldState): RespondToPressureProject {
  return ws.projects['proj-1' as ProjectId] as RespondToPressureProject
}

function getNewOffer(ws: WorldState): DiplomaticOffer | undefined {
  const id = createDiplomaticOfferId(0)
  return ws.diplomaticOffers[id]
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('resolveProposalInitialOffer via resolveImmediateStages', () => {
  // ── Early returns ─────────────────────────────────────────────────────────

  describe('early returns', () => {
    it('skips to next stage when diplomaticPlayId is undefined', () => {
      const ws = makeEmptyV016State()
      const project = makeProjectWithoutPlayId()
      injectScenario(ws, project)

      run(ws)

      const proj = getProject(ws)
      expect(proj.currentStageKey).toBe('prepare_response')
      expect(ws.nextDiplomaticOfferId).toBe(0)
    })

    it('skips to next stage when play does not exist in ws', () => {
      const ws = makeEmptyV016State()
      const project = makeProject({ diplomaticPlayId: 'dp-999' as DiplomaticPlayId })
      injectScenario(ws, project)

      run(ws)

      const proj = getProject(ws)
      expect(proj.currentStageKey).toBe('prepare_response')
      expect(ws.nextDiplomaticOfferId).toBe(0)
    })

    it('skips to next stage when play status is not active', () => {
      const ws = makeEmptyV016State()
      const offer = makeOffer([
        {
          kind: 'transfer_land_contract',
          holdingId: 'hl-0' as HoldingId,
          toPolityId: 'c-init' as PolityId,
        },
        {
          kind: 'pay_wealth',
          from: { kind: 'polity', id: 'c-init' as PolityId },
          to: { kind: 'polity', id: 'c-target' as PolityId },
          amount: 100,
        },
      ])
      const play = makePlay('land_claim', {
        status: 'settled',
        currentOfferId: 'do-1' as DiplomaticOfferId,
        offerHistoryIds: ['do-1' as DiplomaticOfferId],
      })
      const project = makeProject()
      injectScenario(ws, project, play, offer)

      run(ws)

      const proj = getProject(ws)
      expect(proj.currentStageKey).toBe('prepare_response')
      expect(ws.nextDiplomaticOfferId).toBe(0)
    })

    it('skips to next stage when play has no currentOfferId', () => {
      const ws = makeEmptyV016State()
      const play = makePlay('land_claim')
      const project = makeProject()
      injectScenario(ws, project, play)

      run(ws)

      const proj = getProject(ws)
      expect(proj.currentStageKey).toBe('prepare_response')
      expect(ws.nextDiplomaticOfferId).toBe(0)
    })
  })

  // ── Land Claim stance tests ───────────────────────────────────────────────

  describe('land_claim stance tests', () => {
    const basePlay = {
      currentOfferId: 'do-1' as DiplomaticOfferId,
      offerHistoryIds: ['do-1' as DiplomaticOfferId],
    }

    const transferDemand: DiplomaticDemand = {
      kind: 'transfer_land_contract',
      holdingId: 'hl-0' as HoldingId,
      toPolityId: 'c-init' as PolityId,
    }

    const payWealthDemand = (amount: number): DiplomaticDemand => ({
      kind: 'pay_wealth',
      from: { kind: 'polity', id: 'c-init' as PolityId },
      to: { kind: 'polity', id: 'c-target' as PolityId },
      amount,
    })

    it('concede copies all initiator demands for land_claim', () => {
      const ws = makeEmptyV016State()
      const offer = makeOffer([transferDemand, payWealthDemand(100)])
      const play = makePlay('land_claim', { ...basePlay })
      const project = makeProject({ stance: 'concede' })
      injectScenario(ws, project, play, offer)

      run(ws)

      const proj = getProject(ws)
      expect(proj.currentStageKey).toBe('prepare_response')
      expect(ws.nextDiplomaticOfferId).toBe(1)

      const newOffer = getNewOffer(ws)
      expect(newOffer).toBeDefined()
      expect(newOffer!.demands).toEqual([transferDemand, payWealthDemand(100)])
      expect(newOffer!.proposedBy).toEqual({ kind: 'polity', id: 'c-target' as PolityId })
    })

    it('negotiate scales pay_wealth by 1.3 for land_claim', () => {
      const ws = makeEmptyV016State()
      const offer = makeOffer([transferDemand, payWealthDemand(100)])
      const play = makePlay('land_claim', { ...basePlay })
      const project = makeProject({ stance: 'negotiate' })
      injectScenario(ws, project, play, offer)

      run(ws)

      const newOffer = getNewOffer(ws)
      expect(newOffer).toBeDefined()
      expect(newOffer!.demands).toHaveLength(2)
      expect(newOffer!.demands[0]).toEqual(transferDemand)
      expect(newOffer!.demands[1]).toEqual(payWealthDemand(130))
    })

    it('negotiate falls back to status_quo when no pay_wealth for land_claim', () => {
      const ws = makeEmptyV016State()
      const offer = makeOffer([transferDemand])
      const play = makePlay('land_claim', { ...basePlay })
      const project = makeProject({ stance: 'negotiate' })
      injectScenario(ws, project, play, offer)

      run(ws)

      const newOffer = getNewOffer(ws)
      expect(newOffer).toBeDefined()
      expect(newOffer!.demands).toEqual([{ kind: 'status_quo' }])
    })

    it('negotiate falls back to status_quo when offer not in ws for land_claim', () => {
      const ws = makeEmptyV016State()
      const play = makePlay('land_claim', { ...basePlay })
      const project = makeProject({ stance: 'negotiate' })
      injectScenario(ws, project, play)

      run(ws)

      const newOffer = getNewOffer(ws)
      expect(newOffer).toBeDefined()
      expect(newOffer!.demands).toEqual([{ kind: 'status_quo' }])
    })

    it('resist produces status_quo for land_claim', () => {
      const ws = makeEmptyV016State()
      const offer = makeOffer([transferDemand, payWealthDemand(100)])
      const play = makePlay('land_claim', { ...basePlay })
      const project = makeProject({ stance: 'resist' })
      injectScenario(ws, project, play, offer)

      run(ws)

      const newOffer = getNewOffer(ws)
      expect(newOffer).toBeDefined()
      expect(newOffer!.demands).toEqual([{ kind: 'status_quo' }])
    })
  })

  // ── Contract Tax Revision stance tests ────────────────────────────────────

  describe('contract_tax_revision stance tests', () => {
    const basePlay = {
      currentOfferId: 'do-1' as DiplomaticOfferId,
      offerHistoryIds: ['do-1' as DiplomaticOfferId],
      issue: {
        kind: 'contract_tax_revision' as const,
        holdingId: 'hl-0' as HoldingId,
        landContractId: 'lc-1' as LandContractId,
        baseTaxRateToGrantor: 0.3,
        desiredTaxRateToGrantor: 0.5,
        direction: 'increase' as const,
      },
    }

    const taxDemand: DiplomaticDemand = {
      kind: 'change_contract_tax_rate',
      holdingId: 'hl-0' as HoldingId,
      landContractId: 'lc-1' as LandContractId,
      newTaxRateToGrantor: 0.5,
    }

    it('concede copies demands for contract_tax_revision', () => {
      const ws = makeEmptyV016State()
      const offer = makeOffer([taxDemand])
      const play = makePlay('contract_tax_revision', basePlay)
      const project = makeProject({ stance: 'concede' })
      injectScenario(ws, project, play, offer)

      run(ws)

      const newOffer = getNewOffer(ws)
      expect(newOffer).toBeDefined()
      expect(newOffer!.demands).toEqual([taxDemand])
    })

    it('negotiate creates halfway rate for contract_tax_revision', () => {
      const ws = makeEmptyV016State()
      const offer = makeOffer([taxDemand])
      const play = makePlay('contract_tax_revision', basePlay)
      const project = makeProject({ stance: 'negotiate' })
      injectScenario(ws, project, play, offer)

      run(ws)

      const newOffer = getNewOffer(ws)
      expect(newOffer).toBeDefined()
      expect(newOffer!.demands).toHaveLength(1)
      const demand = newOffer!.demands[0]!
      expect(demand.kind).toBe('change_contract_tax_rate')
      if (demand.kind === 'change_contract_tax_rate') {
        expect(demand.newTaxRateToGrantor).toBeCloseTo(0.4, 10)
      }
    })

    it('negotiate falls back to status_quo when issue missing for contract_tax_revision', () => {
      const ws = makeEmptyV016State()
      const offer = makeOffer([taxDemand])
      const play = makePlayWithoutIssue('contract_tax_revision', {
        currentOfferId: 'do-1' as DiplomaticOfferId,
        offerHistoryIds: ['do-1' as DiplomaticOfferId],
      })
      const project = makeProject({ stance: 'negotiate' })
      injectScenario(ws, project, play, offer)

      run(ws)

      const newOffer = getNewOffer(ws)
      expect(newOffer).toBeDefined()
      expect(newOffer!.demands).toEqual([{ kind: 'status_quo' }])
    })

    it('resist produces status_quo for contract_tax_revision', () => {
      const ws = makeEmptyV016State()
      const offer = makeOffer([taxDemand])
      const play = makePlay('contract_tax_revision', basePlay)
      const project = makeProject({ stance: 'resist' })
      injectScenario(ws, project, play, offer)

      run(ws)

      const newOffer = getNewOffer(ws)
      expect(newOffer).toBeDefined()
      expect(newOffer!.demands).toEqual([{ kind: 'status_quo' }])
    })
  })

  // ── Default stance, progress, lifecycle ───────────────────────────────────

  describe('default stance, progress, lifecycle', () => {
    it('defaults to negotiate when stance is undefined', () => {
      const ws = makeEmptyV016State()
      const offer = makeOffer([
        {
          kind: 'transfer_land_contract',
          holdingId: 'hl-0' as HoldingId,
          toPolityId: 'c-init' as PolityId,
        },
        {
          kind: 'pay_wealth',
          from: { kind: 'polity', id: 'c-init' as PolityId },
          to: { kind: 'polity', id: 'c-target' as PolityId },
          amount: 100,
        },
      ])
      const play = makePlay('land_claim', {
        currentOfferId: 'do-1' as DiplomaticOfferId,
        offerHistoryIds: ['do-1' as DiplomaticOfferId],
      })
      const project = makeProjectWithoutStance()
      injectScenario(ws, project, play, offer)

      run(ws)

      const newOffer = getNewOffer(ws)
      expect(newOffer).toBeDefined()
      expect(newOffer!.demands).toHaveLength(2)
      expect(newOffer!.demands[0]).toEqual({
        kind: 'transfer_land_contract',
        holdingId: 'hl-0' as HoldingId,
        toPolityId: 'c-init' as PolityId,
      })
      expect(newOffer!.demands[1]).toEqual({
        kind: 'pay_wealth',
        from: { kind: 'polity', id: 'c-init' as PolityId },
        to: { kind: 'polity', id: 'c-target' as PolityId },
        amount: 130,
      })
    })

    it('progress is clamped to 100', () => {
      const ws = makeEmptyV016State()
      const offer = makeOffer([{ kind: 'status_quo' }])
      const play = makePlay('land_claim', {
        currentOfferId: 'do-1' as DiplomaticOfferId,
        offerHistoryIds: ['do-1' as DiplomaticOfferId],
        progress: 95,
      })
      const project = makeProject({ stance: 'concede' })
      injectScenario(ws, project, play, offer)

      run(ws)

      const updatedPlay = ws.diplomaticPlays['dp-1' as DiplomaticPlayId]
      expect(updatedPlay!.progress).toBe(100)
    })

    it('old offer is withdrawn and new tracked in offerHistoryIds', () => {
      const ws = makeEmptyV016State()
      const offer = makeOffer([{ kind: 'status_quo' }])
      const play = makePlay('land_claim', {
        currentOfferId: 'do-1' as DiplomaticOfferId,
        offerHistoryIds: ['do-1' as DiplomaticOfferId],
      })
      const project = makeProject({ stance: 'concede' })
      injectScenario(ws, project, play, offer)

      run(ws)

      const updatedPlay = ws.diplomaticPlays['dp-1' as DiplomaticPlayId]
      expect(updatedPlay).toBeDefined()

      // Old offer should be withdrawn
      const oldOffer = ws.diplomaticOffers['do-1' as DiplomaticOfferId]
      expect(oldOffer!.status).toBe('withdrawn')

      // New offer should exist
      const newOffer = getNewOffer(ws)
      expect(newOffer).toBeDefined()
      expect(newOffer!.status).toBe('pending')

      // offerHistoryIds should contain both
      expect(updatedPlay!.offerHistoryIds).toContain('do-1' as DiplomaticOfferId)
      expect(updatedPlay!.offerHistoryIds).toContain(createDiplomaticOfferId(0))

      // currentOfferId should point to new offer
      expect(updatedPlay!.currentOfferId).toBe(createDiplomaticOfferId(0))

      // New offer should be proposed by target
      expect(newOffer!.proposedBy).toEqual({ kind: 'polity', id: 'c-target' as PolityId })
    })
  })
})

// ─── find_supervisor (develop_holding) ──────────────────────────────────────

describe('resolveFindSupervisor via resolveImmediateStages (develop_holding)', () => {
  const POLITY = 'c-dev' as PolityId
  const HOUSE = 'hh-dev' as HouseId
  const HOLDING = 'hl-dev' as HoldingId
  const CREATOR = 'pe-creator' as PersonId

  function makeDevState(): WorldState {
    let ws = makeEmptyV016State()
    ws = withHouse(ws, HOUSE)
    ws = withPolity(ws, POLITY, { ownerHouseId: HOUSE })
    ws = withPerson(ws, CREATOR, { houseId: HOUSE })
    return ws
  }

  function makeDevProject(overrides?: Partial<DevelopHoldingProject>): DevelopHoldingProject {
    return {
      id: 'proj-dev' as ProjectId,
      owner: { kind: 'polity', id: POLITY },
      origin: { kind: 'system', reasonKey: 'test' },
      kind: 'develop_holding',
      creatorPersonId: CREATOR,
      supervisorPersonId: CREATOR,
      status: 'active',
      progress: 0,
      targetProgress: 100,
      currentStageKey: 'find_supervisor',
      createdWeek: 48000,
      reasonIds: [],
      holdingId: HOLDING,
      improvementKind: 'irrigation_infrastructure',
      targetImprovementLevel: 1,
      budget: { required: 0, allocated: 0, remaining: 0, spent: 0, source: { kind: 'owner' } },
      ...overrides,
    }
  }

  function inject(ws: WorldState, project: DevelopHoldingProject): void {
    ws.projects[project.id] = project
    addProjectToIndexMut(ws, project)
  }

  function runDev(ws: WorldState): DevelopHoldingProject {
    resolveImmediateStages(ws, defaultConfig, 'proj-dev' as ProjectId, ws.absoluteWeek)
    return ws.projects['proj-dev' as ProjectId] as DevelopHoldingProject
  }

  it('対象 holding に active bailiff がいれば supervisor になり termProtect が付く', () => {
    const ws = makeDevState()
    const bailiffId = 'pe-bailiff' as PersonId
    const next = withPerson(ws, bailiffId, { houseId: HOUSE })
    Object.assign(ws, next)
    const hoId = 'ho-1' as HoldingOfficeAssignmentId
    ws.holdingOfficeAssignments[hoId] = {
      id: hoId,
      holdingId: HOLDING,
      role: 'bailiff',
      holderPersonId: bailiffId,
      appointingPolityId: POLITY,
      active: true,
      startWeek: 0,
      unpaidCount: 0,
      expectedFeeRate: 0.1,
    }
    ws.holdingOfficeIndex.byHolding[HOLDING] = hoId
    inject(ws, makeDevProject({ deadlineWeek: ws.absoluteWeek + 100 }))

    const project = runDev(ws)

    expect(project.supervisorPersonId).toBe(bailiffId)
    expect(project.currentStageKey).not.toBe('find_supervisor')
    expect(ws.holdingOfficeAssignments[hoId]?.termProtectedUntilWeek).toBe(ws.absoluteWeek + 100)
  })

  it('bailiff 不在時は workload の軽い候補を owner pool から選ぶ (旧・無関係候補探索の廃止)', () => {
    let ws = makeDevState()
    const busyId = 'pe-busy' as PersonId
    const idleId = 'pe-idle' as PersonId
    // memberIds 順で busy が先 (同点なら busy が勝つ並び) — workload ペナルティで idle が逆転する
    ws = withPerson(ws, busyId, { houseId: HOUSE })
    ws = withPerson(ws, idleId, { houseId: HOUSE })
    // busy に active project を 4 件監督させる
    for (let i = 0; i < 4; i++) {
      const p = makeDevProject({
        id: `proj-busy-${i}` as ProjectId,
        supervisorPersonId: busyId,
        currentStageKey: 'execute_project',
      })
      ws.projects[p.id] = p
      addProjectToIndexMut(ws, p)
    }
    inject(ws, makeDevProject())

    const project = runDev(ws)

    expect(project.supervisorPersonId).toBe(idleId)
    expect(project.currentStageKey).not.toBe('find_supervisor')
  })

  it('候補ゼロでも creator に倒して stage が進む (find_supervisor で stall しない)', () => {
    // owner 家のメンバーが creator のみ → selectProjectSupervisor は creator を除外して
    // undefined → creator fallback で必ず前進する
    const ws = makeDevState()
    inject(ws, makeDevProject())

    const project = runDev(ws)

    expect(project.supervisorPersonId).toBe(CREATOR)
    expect(project.currentStageKey).not.toBe('find_supervisor')
  })
})

// ─── v0.60 secure_budget 軽量化 (初期 fraction 確保・ハード失敗撤廃) ──────────

describe('v0.60 secure_budget 軽量化 (develop_holding)', () => {
  const POLITY = 'c-sb' as PolityId
  const HOUSE = 'hh-sb' as HouseId
  const HOLDING = 'hl-sb' as HoldingId
  const CREATOR = 'pe-sb-creator' as PersonId

  function makeState(treasury: number): WorldState {
    let ws = makeEmptyV016State()
    ws = withHouse(ws, HOUSE)
    ws = withPolity(ws, POLITY, { ownerHouseId: HOUSE, treasury })
    ws = withPerson(ws, CREATOR, { houseId: HOUSE })
    return ws
  }

  function makeProj(): DevelopHoldingProject {
    return {
      id: 'proj-sb' as ProjectId,
      owner: { kind: 'polity', id: POLITY },
      origin: { kind: 'system', reasonKey: 'test' },
      kind: 'develop_holding',
      creatorPersonId: CREATOR,
      supervisorPersonId: CREATOR,
      status: 'active',
      progress: 0,
      targetProgress: 100,
      currentStageKey: 'secure_budget',
      createdWeek: 0,
      reasonIds: [],
      holdingId: HOLDING,
      improvementKind: 'irrigation_infrastructure',
      targetImprovementLevel: 1,
      budget: { required: 1000, allocated: 0, remaining: 0, spent: 0, source: { kind: 'owner' } },
    }
  }

  function run(ws: WorldState): DevelopHoldingProject {
    ws.projects['proj-sb' as ProjectId] = makeProj()
    resolveImmediateStages(ws, defaultConfig, 'proj-sb' as ProjectId, ws.absoluteWeek)
    return ws.projects['proj-sb' as ProjectId] as DevelopHoldingProject
  }

  it('treasury が required 未満でも開始でき、確保額は fraction (300) と stock の小さい方', () => {
    // required=1000, fraction=0.3 → target=300。treasury=300 → take=300。
    const ws = makeState(300)
    const project = run(ws)
    expect(project.currentStageKey).toBe('execute_project')
    expect(project.budget.allocated).toBe(300)
    expect(project.budget.remaining).toBe(300)
    expect(ws.polities[POLITY]?.treasury).toBe(0)
    // budget.required は不変。
    expect(project.budget.required).toBe(1000)
  })

  it('treasury 0 でも失敗せず execute へ進む (remaining=0)', () => {
    const ws = makeState(0)
    const project = run(ws)
    expect(project.currentStageKey).toBe('execute_project')
    expect(project.budget.allocated).toBe(0)
    expect(project.budget.remaining).toBe(0)
  })

  it('treasury が target を超えるなら target(300) だけ確保する', () => {
    const ws = makeState(5000)
    const project = run(ws)
    expect(project.budget.allocated).toBe(300)
    expect(ws.polities[POLITY]?.treasury).toBe(4700)
  })
})

// ─── v0.60 raise_funds resolver ────────────────────────────────────────────

describe('v0.60 raise_funds resolver (develop_holding)', () => {
  const POLITY = 'c-rf' as PolityId
  const HOUSE = 'hh-rf' as HouseId
  const HOLDING = 'hl-rf' as HoldingId
  const CREATOR = 'pe-rf-creator' as PersonId
  const SUPERVISOR = 'pe-rf-super' as PersonId

  function makeState(opts: {
    treasury: number
    creatorWealth: number
    supervisorWealth: number
  }): WorldState {
    let ws = makeEmptyV016State()
    ws = withHouse(ws, HOUSE)
    ws = withPolity(ws, POLITY, { ownerHouseId: HOUSE, treasury: opts.treasury })
    ws = withPerson(ws, CREATOR, { houseId: HOUSE, wealth: opts.creatorWealth })
    ws = withPerson(ws, SUPERVISOR, { houseId: HOUSE, wealth: opts.supervisorWealth })
    return ws
  }

  function makeProj(budget: {
    required: number
    allocated: number
    remaining: number
    spent: number
  }): DevelopHoldingProject {
    return {
      id: 'proj-rf' as ProjectId,
      owner: { kind: 'polity', id: POLITY },
      origin: { kind: 'system', reasonKey: 'test' },
      kind: 'develop_holding',
      creatorPersonId: CREATOR,
      supervisorPersonId: SUPERVISOR,
      status: 'active',
      progress: 40,
      targetProgress: 100,
      currentStageKey: 'raise_funds',
      createdWeek: 0,
      deadlineWeek: 500,
      reasonIds: [],
      holdingId: HOLDING,
      improvementKind: 'irrigation_infrastructure',
      targetImprovementLevel: 1,
      budget: { ...budget, source: { kind: 'owner' } },
    }
  }

  function run(ws: WorldState, project: DevelopHoldingProject): DevelopHoldingProject {
    ws.projects[project.id] = project
    resolveImmediateStages(ws, defaultConfig, project.id, 1000)
    return ws.projects[project.id] as DevelopHoldingProject
  }

  it('十分な拠出が集まると budget に加算され execute_project へ戻り deadline が延びる', () => {
    const ws = makeState({ treasury: 200, creatorWealth: 200, supervisorWealth: 200 })
    const project = run(ws, makeProj({ required: 1000, allocated: 300, remaining: 0, spent: 300 }))
    // insider polity/creator/supervisor が各 0.5×stock=100 を拠出 → raised=300。
    expect(project.currentStageKey).toBe('execute_project')
    expect(project.budget.allocated).toBe(600)
    expect(project.budget.remaining).toBe(300)
    expect(project.fundingRoundCount).toBe(1)
    expect(project.deadlineWeek).toBe(1000 + defaultConfig.projectFundingDeadlineExtensionWeeks)
  })

  it('保存則: 拠出者 stock 減少分の合計 == budget allocated 増加分', () => {
    const ws = makeState({ treasury: 200, creatorWealth: 200, supervisorWealth: 200 })
    const before = 200 + 200 + 200
    const project = run(ws, makeProj({ required: 1000, allocated: 300, remaining: 0, spent: 300 }))
    const after =
      (ws.polities[POLITY]?.treasury ?? 0) +
      (ws.persons[CREATOR]?.wealth ?? 0) +
      (ws.persons[SUPERVISOR]?.wealth ?? 0)
    const drained = before - after
    const allocatedIncrease = project.budget.allocated - 300
    expect(drained).toBeCloseTo(allocatedIncrease, 6)
  })

  it('v0.60.1: material-sink (develop_holding) は over-collection cap されず required を超えて調達する', () => {
    const ws = makeState({ treasury: 1000, creatorWealth: 1000, supervisorWealth: 1000 })
    // 建設資材の品薄で真の所要額が required を超えるケースを救済するため、material-sink は cap しない。
    // insider 3 者が各 0.5×1000=500 を拠出 → raised=1500 がそのまま allocated に乗る (cap なし)。
    const project = run(ws, makeProj({ required: 1000, allocated: 950, remaining: 0, spent: 950 }))
    expect(project.budget.allocated).toBeCloseTo(2450, 6)
    const drained =
      3000 -
      ((ws.polities[POLITY]?.treasury ?? 0) +
        (ws.persons[CREATOR]?.wealth ?? 0) +
        (ws.persons[SUPERVISOR]?.wealth ?? 0))
    expect(drained).toBeCloseTo(1500, 6)
    // 保存則: drain 合計 == allocated 増加分。
    expect(drained).toBeCloseTo(project.budget.allocated - 950, 6)
  })

  it('拠出が最小回収未満 (全 stock 枯渇) だと funding_failed', () => {
    const ws = makeState({ treasury: 0, creatorWealth: 0, supervisorWealth: 0 })
    const project = run(ws, makeProj({ required: 1000, allocated: 300, remaining: 0, spent: 300 }))
    expect(project.status).toBe('failed')
    expect(project.terminalReason).toBe('funding_failed')
  })
})
