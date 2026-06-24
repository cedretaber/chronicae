import type { PopGroup } from '../types/popGroup'
import type { ResourceKind } from '../types/resource'
import type { SimulationConfig } from '../config/defaultConfig'
import type { PolityId, HouseId, PersonId, PopGroupId, HoldingId } from '../types/ids'
import type { WorldState } from '../types/world'
import type { Project } from '../types/project'
import type { Person } from '../types/person'
import { computePopNeedDemand } from './resourceMarketSelectors'
import { getPolityHouseIds, getPolityPersonIds } from './polityRelations'
import { getRepublicPoliticalCandidatePersons } from './republicSelectors'
import { getActiveBailiff } from './bailiffSelectors'
import { getRoleScore } from './abilitySelectors'
import { getAttitudeOrDefault } from '../helpers/attitudeHelpers'

// v0.60: POP が full-desired need を満たすのに要する金額（resourceEconomySystem の
//   tierCost と同一式: Σ buyOrders × price）。desiredValue は数量なので金額化が必須。
export function getPopPredictedLifeCost(
  pop: PopGroup,
  config: SimulationConfig,
  priceLookup: (resource: ResourceKind) => number,
): number {
  const needs = computePopNeedDemand(pop, config, priceLookup)
  let cost = 0
  for (const cat of needs) {
    for (const res of cat.resources) {
      cost += res.buyOrders * priceLookup(res.resource)
    }
  }
  return cost
}

// v0.60: 生活費 horizon を超える余剰のみ拠出可能（飢えた POP は 0）。
export function getPopContributableSurplus(
  pop: PopGroup,
  config: SimulationConfig,
  priceLookup: (resource: ResourceKind) => number,
): number {
  const lifeCost = getPopPredictedLifeCost(pop, config, priceLookup)
  const reserve = lifeCost * config.popContributionHorizonMonths
  return Math.max(0, pop.money - reserve)
}

// v0.60: 資金集めの拠出候補 (ステークホルダー)。insider = owner/creator/supervisor/現地代官
//   (高率・能力で floor〜full スケール・関係非依存)。external = 関連 House/Person・ローカル POP
//   (能力×関係で減衰)。
export type FundingContributor =
  | { kind: 'polity'; id: PolityId; insider: boolean }
  | { kind: 'house'; id: HouseId; insider: boolean }
  | { kind: 'person'; id: PersonId; insider: boolean }
  | { kind: 'pop'; id: PopGroupId; insider: false }

// 対象 holding を持つか判定 (funding 対象 5 種は全て holdingId を持つ)。
function getProjectHoldingId(project: Project): HoldingId | undefined {
  return 'holdingId' in project ? project.holdingId : undefined
}

// v0.60: Project のステークホルダーを決定的 (ID 昇順・重複排除・insider 優先) に列挙する。
//   acquire_real_estate は私的取得なので POP・関連 Polity を含めず owner House＋メンバーのみ。
export function getProjectFundingStakeholders(
  state: WorldState,
  config: SimulationConfig,
  project: Project,
): FundingContributor[] {
  const personInsider = new Set<PersonId>()
  const personExternal = new Set<PersonId>()
  const houseInsider = new Set<HouseId>()
  const houseExternal = new Set<HouseId>()
  const polityInsider = new Set<PolityId>()
  const popExternal = new Set<PopGroupId>()

  // --- insider: owner / creator / supervisor ---
  if (project.owner.kind === 'polity') polityInsider.add(project.owner.id)
  if (project.owner.kind === 'house') houseInsider.add(project.owner.id)
  if (project.owner.kind === 'person') personInsider.add(project.owner.id)
  personInsider.add(project.creatorPersonId)
  personInsider.add(project.supervisorPersonId)

  const holdingId = getProjectHoldingId(project)
  const isAcquire = project.kind === 'acquire_real_estate'

  // --- insider: 現地代官 (acquire 以外) ---
  if (holdingId && !isAcquire) {
    const bailiff = getActiveBailiff(state, holdingId)
    if (bailiff) personInsider.add(bailiff)
  }

  // --- external: owner が polity の場合の関連 House/Person (commonwealth は republic union) ---
  if (project.owner.kind === 'polity' && !isAcquire) {
    const polityId = project.owner.id
    for (const hid of getPolityHouseIds(state, polityId)) houseExternal.add(hid)
    for (const pid of getPolityPersonIds(state, polityId)) personExternal.add(pid)
    for (const pid of getRepublicPoliticalCandidatePersons(state, config, polityId)) {
      personExternal.add(pid)
    }
  }
  // --- external: owner が house の場合の House メンバー Person ---
  if (project.owner.kind === 'house') {
    const house = state.houses[project.owner.id]
    if (house) for (const pid of house.memberIds) personExternal.add(pid)
  }

  // --- external: ローカル POP (acquire 以外) ---
  if (holdingId && !isAcquire) {
    for (const popId of state.popIndex.byHolding[holdingId] ?? []) popExternal.add(popId)
  }

  // --- dedup: insider 優先 (external から insider を除外) ---
  for (const id of personInsider) personExternal.delete(id)
  for (const id of houseInsider) houseExternal.delete(id)

  const out: FundingContributor[] = []
  for (const id of polityInsider) out.push({ kind: 'polity', id, insider: true })
  for (const id of houseInsider) out.push({ kind: 'house', id, insider: true })
  for (const id of houseExternal) out.push({ kind: 'house', id, insider: false })
  for (const id of personInsider) out.push({ kind: 'person', id, insider: true })
  for (const id of personExternal) out.push({ kind: 'person', id, insider: false })
  for (const id of popExternal) out.push({ kind: 'pop', id, insider: false })
  // 決定的順序: kind:id の辞書順でグローバルソート (各 kind:id は dedup 済みで一意)。
  out.sort((a, b) => `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`))
  return out
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x
}

// external 拠出意欲の能力係数 (supervisor の diplomacy 適性を非線形スケール)。
//   factor = (clamp(score,0,∞)/50)^exponent。score 0 → 0、50 → 1.0。能力中心史観の演出。
function supervisorAbilityFactor(
  state: WorldState,
  config: SimulationConfig,
  project: Project,
): number {
  const score = getRoleScore(state, project.supervisorPersonId, 'diplomacy')
  const clamped = score < 0 ? 0 : score
  return Math.pow(clamped / 50, config.fundraisingAbilityExponent)
}

// v0.60.2: insider (owner/creator/supervisor/代官) の拠出率。身内は動機が高いので関係には
//   依存しないが、説得・調整には supervisor の能力が要るため ability で floor〜full にスケール。
//   floor=insiderAbilityFloor。abilityFactor=0 でも floor 倍 (動機分) は出し、full 能力で max。
function insiderWillingness(state: WorldState, config: SimulationConfig, project: Project): number {
  const floor = clamp01(config.insiderAbilityFloor)
  const factor = supervisorAbilityFactor(state, config, project)
  return clamp01(config.insiderMaxContributionFraction * (floor + (1 - floor) * factor))
}

// contributor → supervisor への attitude (friendly ほど高い [0,1])。Person/POP のみ。
function relationFactorToSupervisor(
  state: WorldState,
  project: Project,
  source: Person | PopGroup,
): number {
  const att = getAttitudeOrDefault(state, source, {
    kind: 'person',
    id: project.supervisorPersonId,
  })
  return clamp01((att.affection * 0.6 + att.respect * 0.4) / 100)
}

// v0.60: 1 contributor が当ラウンドで拠出する額 (決定的・stock 以下に clamp)。
//   insider = stock × insiderWillingness (能力で floor〜full スケール・関係非依存)。
//   external = stock × maxFractionByKind × supervisorAbilityFactor × relationFactor。
//   POP の stock は生活費 horizon を超える余剰のみ。RNG 不使用。
export function computeContributorPledge(
  state: WorldState,
  config: SimulationConfig,
  project: Project,
  contributor: FundingContributor,
  priceLookup: (resource: ResourceKind) => number,
): number {
  let spare: number
  let willingness: number
  const frac = config.fundraisingMaxContributionFractionByContributorKind

  if (contributor.kind === 'polity') {
    const polity = state.polities[contributor.id]
    if (!polity) return 0
    spare = polity.treasury
    willingness = contributor.insider
      ? insiderWillingness(state, config, project)
      : clamp01(frac.polity * supervisorAbilityFactor(state, config, project)) // 組織は relation=1
  } else if (contributor.kind === 'house') {
    const house = state.houses[contributor.id]
    if (!house || !house.active) return 0
    spare = house.wealth
    willingness = contributor.insider
      ? insiderWillingness(state, config, project)
      : clamp01(frac.house * supervisorAbilityFactor(state, config, project)) // 家も relation=1
  } else if (contributor.kind === 'person') {
    const person = state.persons[contributor.id]
    if (!person || !person.alive) return 0
    spare = person.wealth
    willingness = contributor.insider
      ? insiderWillingness(state, config, project)
      : clamp01(
          frac.person *
            supervisorAbilityFactor(state, config, project) *
            relationFactorToSupervisor(state, project, person),
        )
  } else {
    const pop = state.popGroups[contributor.id]
    if (!pop) return 0
    spare = getPopContributableSurplus(pop, config, priceLookup)
    willingness = clamp01(
      frac.pop *
        supervisorAbilityFactor(state, config, project) *
        relationFactorToSupervisor(state, project, pop),
    )
  }

  if (spare <= 0 || willingness <= 0) return 0
  const pledge = spare * willingness
  return Math.max(0, Math.min(pledge, spare))
}
