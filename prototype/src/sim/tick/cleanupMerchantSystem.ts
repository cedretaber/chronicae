import type { TickContext } from './context'
import { createSimEvent } from './context'
import type { MerchantCompanyId, TradeRouteId, MerchantCompanyEstablishmentId } from '../types/ids'
import { nameParam, entityRef } from '../types/event'
import { cloneMerchantSlicesOnly } from '../worldgen/seedMerchantCompanies'
import {
  setTradeRouteStatusMut,
  setMerchantEstablishmentStatusMut,
  setMerchantCompanyStatusMut,
  removeTradeRouteMut,
  removeMerchantEstablishmentMut,
  removeMerchantCompanyMut,
  removeMerchantCompanyShareMut,
} from '../mutations/merchantMutations'

// v0.61 §20: 商会 lifecycle の weekly cleanup。
//   (1) 経営難 grace 超過の active 商会を dormant 化（route/branch closed・treasury=0）。
//   (2) terminal entity の retention purge（closed route/branch・dormant/dissolved 商会＋shares）。
//   ctx.rng 非消費・決定的。

export function runCleanupMerchantSystem(ctx: TickContext): TickContext {
  const state = ctx.state
  const config = ctx.config
  const week = state.absoluteWeek
  const retention = config.terminalMerchantRetentionWeeks
  const graceWeeks = config.merchantCompanyBankruptcyGraceMonths * 4

  // 何か処理対象があるか軽くスキャン（無ければ早期 return で clone を避ける）。
  let hasWork = false
  for (const c of Object.values(state.merchantCompanies)) {
    if (!c) continue
    if (
      c.status === 'active' &&
      c.distressSince !== undefined &&
      week - c.distressSince >= graceWeeks
    ) {
      hasWork = true
      break
    }
    if (
      (c.status === 'dormant' || c.status === 'dissolved') &&
      c.closedWeek !== undefined &&
      week - c.closedWeek >= retention
    ) {
      hasWork = true
      break
    }
  }
  if (!hasWork) {
    for (const r of Object.values(state.tradeRoutes)) {
      if (
        r &&
        r.status === 'closed' &&
        r.closedWeek !== undefined &&
        week - r.closedWeek >= retention
      ) {
        hasWork = true
        break
      }
    }
  }
  if (!hasWork) {
    for (const e of Object.values(state.merchantCompanyEstablishments)) {
      if (
        e &&
        e.status === 'closed' &&
        e.closedWeek !== undefined &&
        week - e.closedWeek >= retention
      ) {
        hasWork = true
        break
      }
    }
  }
  if (!hasWork) return ctx

  const draft = cloneMerchantSlicesOnly(state)
  let workingCtx = { ...ctx, state: draft }

  // --- (1) 破産 → dormant ---
  for (const companyId of (Object.keys(draft.merchantCompanies) as MerchantCompanyId[]).sort()) {
    const company = draft.merchantCompanies[companyId]
    if (!company || company.status !== 'active') continue
    if (company.distressSince === undefined || week - company.distressSince < graceWeeks) continue

    for (const routeId of [...(draft.tradeRouteIndex.byCompany[companyId as string] ?? [])]) {
      const route = draft.tradeRoutes[routeId]
      if (route && route.status !== 'closed') setTradeRouteStatusMut(draft, routeId, 'closed', week)
    }
    for (const estId of [
      ...(draft.merchantCompanyEstablishmentIndex.byCompany[companyId as string] ?? []),
    ]) {
      const est = draft.merchantCompanyEstablishments[estId]
      if (est && est.status !== 'closed')
        setMerchantEstablishmentStatusMut(draft, estId, 'closed', week)
    }
    const updated = draft.merchantCompanies[companyId]
    if (updated) {
      const cleared = { ...updated, treasury: 0, closedWeek: week }
      delete cleared.distressSince
      draft.merchantCompanies[companyId] = cleared
    }
    setMerchantCompanyStatusMut(draft, companyId, 'dormant')

    const { event, ctx: ec } = createSimEvent(workingCtx, {
      type: 'MERCHANT_COMPANY_BANKRUPT',
      importance: 'normal',
      messageKey: 'merchant.company_bankrupt',
      messageParams: { company: nameParam('house', company.nameKey) },
      entityRefs: [entityRef('merchant_company', companyId, 'company', company.nameKey)],
    })
    workingCtx = { ...ec, events: [...ec.events, event] }
  }

  // --- (2) retention purge ---
  // closed route。
  for (const routeId of Object.keys(draft.tradeRoutes) as TradeRouteId[]) {
    const r = draft.tradeRoutes[routeId]
    if (
      r &&
      r.status === 'closed' &&
      r.closedWeek !== undefined &&
      week - r.closedWeek >= retention
    ) {
      removeTradeRouteMut(draft, routeId)
    }
  }
  // closed establishment。
  for (const estId of Object.keys(
    draft.merchantCompanyEstablishments,
  ) as MerchantCompanyEstablishmentId[]) {
    const e = draft.merchantCompanyEstablishments[estId]
    if (
      e &&
      e.status === 'closed' &&
      e.closedWeek !== undefined &&
      week - e.closedWeek >= retention
    ) {
      removeMerchantEstablishmentMut(draft, estId)
    }
  }
  // dormant / dissolved 商会 → 残 route/branch/share ごと purge。
  for (const companyId of Object.keys(draft.merchantCompanies) as MerchantCompanyId[]) {
    const c = draft.merchantCompanies[companyId]
    if (!c) continue
    if (c.status !== 'dormant' && c.status !== 'dissolved') continue
    if (c.closedWeek === undefined || week - c.closedWeek < retention) continue
    for (const routeId of [...(draft.tradeRouteIndex.byCompany[companyId as string] ?? [])]) {
      removeTradeRouteMut(draft, routeId)
    }
    for (const estId of [
      ...(draft.merchantCompanyEstablishmentIndex.byCompany[companyId as string] ?? []),
    ]) {
      removeMerchantEstablishmentMut(draft, estId)
    }
    for (const shareId of [
      ...(draft.merchantCompanyShareIndex.byCompany[companyId as string] ?? []),
    ]) {
      removeMerchantCompanyShareMut(draft, shareId)
    }
    removeMerchantCompanyMut(draft, companyId)
  }

  return { ...workingCtx, state: draft }
}
