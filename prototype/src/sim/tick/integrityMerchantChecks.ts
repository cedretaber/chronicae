import type { SimError } from '../mutations/errors'
import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { MerchantCompanyId } from '../types/ids'
import { getCompanyHeadquarters, getAdjacentStateRegionIds } from '../selectors/merchantSelectors'

// v0.61 商会・交易システムの整合性検査。
//   record↔index 同期 + §24.1 の静的 hard invariant
//   (ownerHouse active / HQ=city / route 隣接・level・slot cap / share+office holder alive)。

// index の各 bucket に載る id が record に存在し、重複が無いことを検査する汎用ヘルパー。
function checkIndexRefsExist(
  errors: SimError[],
  label: string,
  buckets: Record<string, readonly string[]>,
  recordHas: (id: string) => boolean,
): void {
  for (const [key, ids] of Object.entries(buckets)) {
    const seen = new Set<string>()
    for (const id of ids) {
      if (!recordHas(id)) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `${label} index[${key}] references missing id=${id}`,
        })
      }
      if (seen.has(id)) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `${label} index[${key}] has duplicate id=${id}`,
        })
      }
      seen.add(id)
    }
  }
}

export function checkMerchant(
  state: WorldState,
  errors: SimError[],
  config: SimulationConfig | undefined,
): void {
  // --- MerchantCompany ---
  const companyExists = (id: string): boolean => state.merchantCompanies[id as never] !== undefined
  checkIndexRefsExist(
    errors,
    'merchantCompany.byOwnerHouse',
    state.merchantCompanyIndex.byOwnerHouse,
    companyExists,
  )
  checkIndexRefsExist(
    errors,
    'merchantCompany.byStatus',
    state.merchantCompanyIndex.byStatus,
    companyExists,
  )

  // --- Establishment ---
  const estExists = (id: string): boolean =>
    state.merchantCompanyEstablishments[id as never] !== undefined
  checkIndexRefsExist(
    errors,
    'merchantEstablishment.byCompany',
    state.merchantCompanyEstablishmentIndex.byCompany,
    estExists,
  )
  checkIndexRefsExist(
    errors,
    'merchantEstablishment.byHolding',
    state.merchantCompanyEstablishmentIndex.byHolding,
    estExists,
  )
  checkIndexRefsExist(
    errors,
    'merchantEstablishment.byKind',
    state.merchantCompanyEstablishmentIndex.byKind,
    estExists,
  )

  // --- TradeRoute ---
  const routeExists = (id: string): boolean => state.tradeRoutes[id as never] !== undefined
  checkIndexRefsExist(errors, 'tradeRoute.byCompany', state.tradeRouteIndex.byCompany, routeExists)
  checkIndexRefsExist(
    errors,
    'tradeRoute.bySourceState',
    state.tradeRouteIndex.bySourceState,
    routeExists,
  )
  checkIndexRefsExist(
    errors,
    'tradeRoute.byTargetState',
    state.tradeRouteIndex.byTargetState,
    routeExists,
  )
  checkIndexRefsExist(
    errors,
    'tradeRoute.byResource',
    state.tradeRouteIndex.byResource,
    routeExists,
  )
  checkIndexRefsExist(errors, 'tradeRoute.byStatus', state.tradeRouteIndex.byStatus, routeExists)

  // --- Share ---
  const shareExists = (id: string): boolean =>
    state.merchantCompanyShares[id as never] !== undefined
  checkIndexRefsExist(
    errors,
    'merchantShare.byCompany',
    state.merchantCompanyShareIndex.byCompany,
    shareExists,
  )
  checkIndexRefsExist(
    errors,
    'merchantShare.byHolder',
    state.merchantCompanyShareIndex.byHolder,
    shareExists,
  )

  // --- §24.1 静的 hard invariant ---
  const err = (message: string): void => {
    errors.push({ code: 'INTEGRITY_VIOLATION', message })
  }
  const slotsPerLevel = config?.merchantCompanyTradeRouteSlotsPerHeadquartersLevel ?? 4

  for (const companyId of Object.keys(state.merchantCompanies) as MerchantCompanyId[]) {
    const company = state.merchantCompanies[companyId]
    if (!company) continue

    // 非 dissolved company は active な ownerHouse を持つ (dissolved は断絶同 tick で処理済)。
    if (company.status !== 'dissolved') {
      const owner = state.houses[company.ownerHouseId]
      if (!owner || !owner.active) {
        err(
          `MerchantCompany ${companyId} (status=${company.status}) ownerHouse ${company.ownerHouseId} is missing or inactive`,
        )
      }
    }

    if (company.status === 'active') {
      // active company は HQ を exactly 1 つ持ち、その holding は city。
      const hqIds = (
        state.merchantCompanyEstablishmentIndex.byCompany[companyId as string] ?? []
      ).filter((id) => state.merchantCompanyEstablishments[id]?.kind === 'headquarters')
      const activeHqIds = hqIds.filter(
        (id) => state.merchantCompanyEstablishments[id]?.status === 'active',
      )
      if (activeHqIds.length !== 1) {
        err(
          `active MerchantCompany ${companyId} must have exactly 1 active HQ (has ${activeHqIds.length})`,
        )
      }
      const hq = getCompanyHeadquarters(state, companyId)
      if (hq && state.holdings[hq.holdingId]?.kind !== 'city') {
        err(`MerchantCompany ${companyId} HQ holding ${hq.holdingId} is not a city`)
      }

      // NOTE: active office holder の liveness は integrityCoreChecks が全 OfficeAssignment に対して
      //   検査済み（merchant office も含む）。ここでは重複させない。

      // active route 数 <= HQ.level × slotsPerLevel。
      const activeRoutes = (state.tradeRouteIndex.byCompany[companyId as string] ?? []).filter(
        (id) => state.tradeRoutes[id]?.status === 'active',
      )
      const cap = (hq?.level ?? 0) * slotsPerLevel
      if (activeRoutes.length > cap) {
        err(
          `MerchantCompany ${companyId} active route count ${activeRoutes.length} exceeds cap ${cap}`,
        )
      }
    }
  }

  // establishment: branch holding も city。同一 company が同一 holding に複数 active establishment 不可。
  const seenCompanyHolding = new Set<string>()
  for (const est of Object.values(state.merchantCompanyEstablishments)) {
    if (!est || est.status !== 'active') continue
    if (state.holdings[est.holdingId]?.kind !== 'city') {
      err(`Establishment ${est.id} (${est.kind}) holding ${est.holdingId} is not a city`)
    }
    const key = `${est.companyId}@${est.holdingId}`
    if (seenCompanyHolding.has(key)) {
      err(
        `MerchantCompany ${est.companyId} has multiple active establishments in holding ${est.holdingId}`,
      )
    }
    seenCompanyHolding.add(key)
  }

  // TradeRoute: companyId 存在 / active は source≠target・隣接・level>=1・level<=HQ.level。
  for (const route of Object.values(state.tradeRoutes)) {
    if (!route) continue
    if (!state.merchantCompanies[route.companyId]) {
      err(`TradeRoute ${route.id} references missing company ${route.companyId}`)
    }
    if (route.level < 1) {
      err(`TradeRoute ${route.id} level ${route.level} must be >= 1`)
    }
    if (route.status !== 'active') continue
    if ((route.sourceStateId as string) === (route.targetStateId as string)) {
      err(`active TradeRoute ${route.id} source equals target (${route.sourceStateId})`)
    }
    if (!state.states[route.sourceStateId]) {
      err(`active TradeRoute ${route.id} sourceState ${route.sourceStateId} does not exist`)
    }
    if (!state.states[route.targetStateId]) {
      err(`active TradeRoute ${route.id} targetState ${route.targetStateId} does not exist`)
    }
    const adjacent = getAdjacentStateRegionIds(state, route.sourceStateId)
    if (!adjacent.some((s) => (s as string) === (route.targetStateId as string))) {
      err(
        `active TradeRoute ${route.id} target ${route.targetStateId} is not adjacent to source ${route.sourceStateId}`,
      )
    }
    const hq = getCompanyHeadquarters(state, route.companyId)
    if (hq && route.level > hq.level) {
      err(`active TradeRoute ${route.id} level ${route.level} exceeds HQ level ${hq.level}`)
    }
  }

  // Share holder Person は存在する（HouseShare と同様、dead holder は yearly purge までの
  //   合法 transient なので alive までは要求しない）。
  for (const share of Object.values(state.merchantCompanyShares)) {
    if (!share) continue
    if (!state.merchantCompanies[share.companyId]) {
      err(`MerchantCompanyShare ${share.id} references missing company ${share.companyId}`)
    }
    if (!state.persons[share.holderPersonId]) {
      err(`MerchantCompanyShare ${share.id} references non-existent person ${share.holderPersonId}`)
    }
  }
}
