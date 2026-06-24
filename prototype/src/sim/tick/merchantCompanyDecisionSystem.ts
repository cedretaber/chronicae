import type { TickContext } from './context'
import { createSimEvent } from './context'
import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { MerchantCompanyId, PersonId, StateRegionId, ProjectId } from '../types/ids'
import { createProjectId } from '../types/ids'
import type { Project, ProjectBudget } from '../types/project'
import type { ResourceKind } from '../types/resource'
import { RESOURCE_KINDS } from '../types/resource'
import { nameParam, entityRef } from '../types/event'
import { marketResourcePriceKey } from '../types/resourceEconomy'
import { addProjectToIndexMut } from '../mutations/projectMutations'
import { setTradeRouteStatusMut } from '../mutations/merchantMutations'
import {
  getMerchantCompanyDecisionMaker,
  getCompanyHeadquarters,
  getAdjacentStateRegionIds,
  getStateCityHoldingId,
} from '../selectors/merchantSelectors'
import { getActiveOfficeHolders } from '../selectors/officeSelectors'
import { WEEKS_PER_YEAR } from '../utils/timeUtils'

// v0.61 §17/§18: 商会の自律 decision（年次・lean 版）。Goal/Aim entity を介さず、crisis と同じ
//   system-origin Project を直接生成する（funding 経路は merchant 未配線のため pre-fund して
//   execute_project から開始＝treasury を生成時に drain）。close/replace は §17.4 どおり即時。
//   ctx.rng は消費せず state から決定的に判断する。

const PROJECT_DEADLINE_WEEKS = WEEKS_PER_YEAR * 3

function companyHqStateId(
  state: WorldState,
  companyId: MerchantCompanyId,
): StateRegionId | undefined {
  const hq = getCompanyHeadquarters(state, companyId)
  if (!hq) return undefined
  const holding = state.holdings[hq.holdingId]
  if (!holding) return undefined
  return state.provinces[holding.provinceId]?.stateId
}

// 前月 snapshot から (source 余剰 × target 不足) が最大の (target, resource) を選ぶ。既存 active route と
//   同一 (src,tgt,resource) は除外。score>0 が無ければ undefined。
function pickBestRouteTarget(
  state: WorldState,
  sourceStateId: StateRegionId,
  existing: { tgt: string; res: ResourceKind }[],
): { targetStateId: StateRegionId; resource: ResourceKind } | undefined {
  const existingSet = new Set(existing.map((e) => `${e.tgt}:${e.res}`))
  const orders = (sid: string, res: ResourceKind): { sell: number; buy: number } | undefined => {
    const ps = state.marketResourcePrices[marketResourcePriceKey(sid, res)]
    const last = ps?.history[ps.history.length - 1]
    return last ? { sell: last.sellOrders, buy: last.buyOrders } : undefined
  }
  let best: { targetStateId: StateRegionId; resource: ResourceKind; score: number } | undefined
  for (const targetStateId of getAdjacentStateRegionIds(state, sourceStateId)) {
    for (const resource of RESOURCE_KINDS) {
      if (existingSet.has(`${targetStateId as string}:${resource}`)) continue
      const src = orders(sourceStateId, resource)
      const tgt = orders(targetStateId, resource)
      if (!src || !tgt) continue
      const score = Math.max(0, src.sell - src.buy) * Math.max(0, tgt.buy - tgt.sell)
      if (score <= 0) continue
      if (!best || score > best.score) best = { targetStateId, resource, score }
    }
  }
  return best ? { targetStateId: best.targetStateId, resource: best.resource } : undefined
}

function pickCreatorSupervisor(
  state: WorldState,
  companyId: MerchantCompanyId,
): { creator: PersonId; supervisor: PersonId } | undefined {
  const chairman = getMerchantCompanyDecisionMaker(state, companyId)
  if (!chairman) return undefined
  const admins = getActiveOfficeHolders(
    state,
    { kind: 'merchant_company', id: companyId },
    'administrator',
  )
  const admin = admins.find((id) => (id as string) !== (chairman as string))
  // 番頭が居れば supervisor に、居なければ chairman 自身が兼任。
  return { creator: chairman, supervisor: admin ?? chairman }
}

export function runMerchantCompanyDecisionSystem(ctx: TickContext): TickContext {
  const state = ctx.state
  const config = ctx.config
  const companyIds = (Object.keys(state.merchantCompanies) as MerchantCompanyId[])
    .filter((id) => state.merchantCompanies[id]?.status === 'active')
    .sort()
  if (companyIds.length === 0) return ctx

  const week = state.absoluteWeek
  // 触る slice を draft 化。
  let draft: WorldState = {
    ...state,
    merchantCompanies: { ...state.merchantCompanies },
    tradeRoutes: { ...state.tradeRoutes },
    tradeRouteIndex: {
      ...state.tradeRouteIndex,
      byStatus: {
        active: [...state.tradeRouteIndex.byStatus.active],
        closing: [...state.tradeRouteIndex.byStatus.closing],
        closed: [...state.tradeRouteIndex.byStatus.closed],
      },
    },
    projects: { ...state.projects },
  }
  let workingCtx = { ...ctx, state: draft }

  // 進行中の merchant Project を持つ company を集計（1 社 1 件まで）。
  const companiesWithActiveProject = new Set<string>()
  for (const p of Object.values(state.projects)) {
    if (p && p.status === 'active' && p.owner.kind === 'merchant_company') {
      companiesWithActiveProject.add(p.owner.id)
    }
  }

  for (const companyId of companyIds) {
    // --- 1. close/replace immediate（§17.4）: 慢性赤字の route を即時 closed ---
    const activeRouteIds = [...(draft.tradeRouteIndex.byCompany[companyId as string] ?? [])]
      .filter((id) => draft.tradeRoutes[id]?.status === 'active')
      .sort()
    for (const routeId of activeRouteIds) {
      const route = draft.tradeRoutes[routeId]
      if (!route) continue
      const aged = week - route.createdWeek > config.merchantCompanyInitialRouteGraceWeeks
      if (aged && route.smoothedProfit < config.merchantRouteCloseSmoothedProfitThreshold) {
        setTradeRouteStatusMut(draft, routeId, 'closed', week)
        const company = draft.merchantCompanies[companyId]
        const { event, ctx: ec } = createSimEvent(workingCtx, {
          type: 'MERCHANT_ROUTE_CLOSED',
          importance: 'minor',
          messageKey: 'merchant.route_closed',
          messageParams: { company: nameParam('merchant_company', company?.nameKey ?? '') },
          entityRefs: [entityRef('merchant_company', companyId, 'company', company?.nameKey ?? '')],
        })
        workingCtx = { ...ec, events: [...ec.events, event] }
        draft = workingCtx.state
      }
    }

    // --- 2. build decision: 1 社 1 Project・treasury floor 超過時のみ ---
    if (companiesWithActiveProject.has(companyId)) continue
    const company = draft.merchantCompanies[companyId]
    if (!company || company.treasury <= config.merchantBuildTreasuryFloor) continue

    const hq = getCompanyHeadquarters(draft, companyId)
    if (!hq) continue
    const hqStateId = companyHqStateId(draft, companyId)
    if (!hqStateId) continue

    const activeRoutes = [...(draft.tradeRouteIndex.byCompany[companyId as string] ?? [])]
      .map((id) => draft.tradeRoutes[id])
      .filter((r): r is NonNullable<typeof r> => !!r && r.status === 'active')
    const slotCap = hq.level * config.merchantCompanyTradeRouteSlotsPerHeadquartersLevel

    const action = decideBuildAction(
      draft,
      config,
      companyId,
      hqStateId,
      hq.level,
      activeRoutes,
      slotCap,
    )
    if (!action) continue
    const cs = pickCreatorSupervisor(draft, companyId)
    if (!cs) continue

    draft = createMerchantProjectMut(
      draft,
      config,
      companyId,
      action,
      cs.creator,
      cs.supervisor,
      week,
    )
    companiesWithActiveProject.add(companyId)
    workingCtx = { ...workingCtx, state: draft }
  }

  return { ...workingCtx, state: draft }
}

type BuildAction =
  | {
      kind: 'open_trade_route'
      sourceStateId: StateRegionId
      targetStateId: StateRegionId
      resource: ResourceKind
    }
  | { kind: 'upgrade_trade_route'; targetTradeRouteId: import('../types/ids').TradeRouteId }
  | { kind: 'build_company_branch'; targetHoldingId: import('../types/ids').HoldingId }
  | { kind: 'upgrade_company_headquarters' }

function decideBuildAction(
  state: WorldState,
  config: SimulationConfig,
  companyId: MerchantCompanyId,
  hqStateId: StateRegionId,
  hqLevel: number,
  activeRoutes: {
    id: import('../types/ids').TradeRouteId
    level: number
    smoothedProfit: number
    targetStateId: StateRegionId
    resource: ResourceKind
  }[],
  slotCap: number,
): BuildAction | undefined {
  const treasury = state.merchantCompanies[companyId]?.treasury ?? 0

  // (a) 空きスロット + 有望な arbitrage target → open_trade_route
  if (activeRoutes.length < slotCap && treasury > config.merchantOpenRouteProjectBudget) {
    const existing = activeRoutes.map((r) => ({ tgt: r.targetStateId, res: r.resource }))
    const target = pickBestRouteTarget(state, hqStateId, existing)
    if (target) {
      return {
        kind: 'open_trade_route',
        sourceStateId: hqStateId,
        targetStateId: target.targetStateId,
        resource: target.resource,
      }
    }
  }

  // (b) level<HQ の最良 route を upgrade
  if (treasury > config.merchantUpgradeRouteProjectBudget) {
    const upgradable = activeRoutes
      .filter((r) => r.level < hqLevel)
      .sort(
        (a, b) => b.smoothedProfit - a.smoothedProfit || (a.id as string).localeCompare(b.id),
      )[0]
    if (upgradable) return { kind: 'upgrade_trade_route', targetTradeRouteId: upgradable.id }
  }

  // (c) 隣接 city に未出店なら支店建設（treasury 潤沢時）
  if (treasury > config.merchantBuildBranchProjectBudget * 2) {
    const occupied = new Set(
      (state.merchantCompanyEstablishmentIndex.byCompany[companyId as string] ?? [])
        .map((id) => state.merchantCompanyEstablishments[id])
        .filter((e) => e && e.status === 'active')
        .map((e) => e!.holdingId as string),
    )
    for (const adj of getAdjacentStateRegionIds(state, hqStateId)) {
      const cityHolding = getStateCityHoldingId(state, adj)
      if (cityHolding && !occupied.has(cityHolding)) {
        return { kind: 'build_company_branch', targetHoldingId: cityHolding }
      }
    }
  }

  // (d) treasury 潤沢 → HQ 増築（route/branch の cap を上げる）
  if (treasury > config.merchantUpgradeHqProjectBudget * 2) {
    return { kind: 'upgrade_company_headquarters' }
  }
  return undefined
}

function budgetFor(config: SimulationConfig, kind: BuildAction['kind']): number {
  switch (kind) {
    case 'open_trade_route':
      return config.merchantOpenRouteProjectBudget
    case 'upgrade_trade_route':
      return config.merchantUpgradeRouteProjectBudget
    case 'build_company_branch':
      return config.merchantBuildBranchProjectBudget
    case 'upgrade_company_headquarters':
      return config.merchantUpgradeHqProjectBudget
  }
}

// crisis の createHandleCrisisProjectMut パターン。pre-fund（treasury drain・budget allocated）で
//   execute_project から開始し、find_supervisor/secure_budget（merchant 未配線）をスキップする。
function createMerchantProjectMut(
  ws: WorldState,
  config: SimulationConfig,
  companyId: MerchantCompanyId,
  action: BuildAction,
  creatorId: PersonId,
  supervisorId: PersonId,
  week: number,
): WorldState {
  const cost = budgetFor(config, action.kind)
  const projectId: ProjectId = createProjectId(ws.nextProjectId)
  const budget: ProjectBudget = {
    required: cost,
    allocated: cost,
    remaining: cost,
    spent: 0,
    source: { kind: 'owner' },
  }
  // born-complete（§18 lean）: merchant project は find_supervisor/secure_budget/task 実行を介さず
  //   生成時に status=completed で作る。次 tick の projectOutcomeSystem が outcome handler を発火し
  //   route/branch を生成→purge する。cost は生成時に treasury から drain（投資額）。
  const base = {
    id: projectId,
    owner: { kind: 'merchant_company' as const, id: companyId },
    origin: { kind: 'system' as const, reasonKey: 'merchant_decision' },
    companyId,
    creatorPersonId: creatorId,
    supervisorPersonId: supervisorId,
    status: 'completed' as const,
    terminalReason: 'completed' as const,
    progress: config.projectDefaultTargetProgress,
    targetProgress: config.projectDefaultTargetProgress,
    currentStageKey: 'execute_project' as const,
    createdWeek: week,
    deadlineWeek: week + PROJECT_DEADLINE_WEEKS,
    reasonIds: [],
    budget,
  }
  let project: Project
  switch (action.kind) {
    case 'open_trade_route':
      project = {
        ...base,
        kind: 'open_trade_route',
        sourceStateId: action.sourceStateId,
        targetStateId: action.targetStateId,
        resource: action.resource,
      }
      break
    case 'upgrade_trade_route':
      project = {
        ...base,
        kind: 'upgrade_trade_route',
        targetTradeRouteId: action.targetTradeRouteId,
      }
      break
    case 'build_company_branch':
      project = { ...base, kind: 'build_company_branch', targetHoldingId: action.targetHoldingId }
      break
    case 'upgrade_company_headquarters':
      project = { ...base, kind: 'upgrade_company_headquarters' }
      break
  }

  const company = ws.merchantCompanies[companyId]
  const draft: WorldState = {
    ...ws,
    nextProjectId: ws.nextProjectId + 1,
    projects: { ...ws.projects, [projectId]: project },
    merchantCompanies: company
      ? { ...ws.merchantCompanies, [companyId]: { ...company, treasury: company.treasury - cost } }
      : ws.merchantCompanies,
  }
  addProjectToIndexMut(draft, project)
  return draft
}
