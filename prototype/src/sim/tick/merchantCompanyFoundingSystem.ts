import type { TickContext } from './context'
import { createSimEvent } from './context'
import type { WorldState } from '../types/world'
import type { StateRegionId } from '../types/ids'
import { nameParam, entityRef } from '../types/event'
import { cloneMerchantSlicesOnly, seedOneMerchantCompany } from '../worldgen/seedMerchantCompanies'
import {
  getCompanyHeadquarters,
  getStateCityHoldingId,
  estimateStateProductionPotential,
} from '../selectors/merchantSelectors'
import { RESOURCE_KINDS } from '../types/resource'

// v0.61 §20.7: 年次。active 商会が 0 の StateRegion に、cooldown 経過 + market value gate を満たせば
//   新商会を 1 社設立する（dissolve/bankrupt で商会が絶えた地域の再興）。§25 撤回後は ctx.rng を
//   そのまま使ってよい（隔離 rng 不要）。cooldown は再興間隔の下限。

export function runMerchantCompanyFoundingSystem(ctx: TickContext): TickContext {
  const state = ctx.state
  const config = ctx.config
  if (!config.merchantSystemEnabled) return ctx
  const week = state.absoluteWeek

  // active 商会が在る state を集計（HQ の所在 state）。
  const statesWithActive = new Set<string>()
  for (const company of Object.values(state.merchantCompanies)) {
    if (!company || company.status !== 'active') continue
    const hq = getCompanyHeadquarters(state, company.id)
    if (!hq) continue
    const holding = state.holdings[hq.holdingId]
    const sid = holding ? state.provinces[holding.provinceId]?.stateId : undefined
    if (sid) statesWithActive.add(sid)
  }

  // 候補 state: active 商会ゼロ・city 有り・cooldown 経過・production potential が下限超過。
  const candidates: StateRegionId[] = []
  for (const stateId of (Object.keys(state.states) as StateRegionId[]).sort()) {
    if (statesWithActive.has(stateId)) continue
    if (!getStateCityHoldingId(state, stateId)) continue
    const cooldownUntil = state.merchantFoundingCooldownByState[stateId as string]
    if (cooldownUntil !== undefined && week < cooldownUntil) continue
    const potential = estimateStateProductionPotential(state, stateId)
    let total = 0
    for (const r of RESOURCE_KINDS) total += potential[r] ?? 0
    if (total <= config.merchantCompanyMinimumMarketValueForFounding) continue
    candidates.push(stateId)
  }
  if (candidates.length === 0) return ctx

  let draft: WorldState = {
    ...cloneMerchantSlicesOnly(state),
    persons: { ...state.persons },
    houses: { ...state.houses },
    merchantFoundingCooldownByState: { ...state.merchantFoundingCooldownByState },
  }
  let rng = ctx.rng
  let workingCtx = { ...ctx, state: draft, rng }
  // 重要: 人物/家 ID は **ctx の live カウンタ**（maxIndex+1 起点・runtime births と共有・dh-/pe-）から採る。
  //   state.nextPersonIndex は worldgen 専用で stale なため使うと既存 person と衝突する（v0.61 P7 で発生）。
  const counters = {
    nextPersonIndex: ctx.nextPersonIndex,
    nextHouseIndex: ctx.nextHouseIndex,
  }

  for (const stateId of candidates) {
    const res = seedOneMerchantCompany(draft, stateId, rng, config, ctx.namePoolService, counters)
    if (!res) continue
    draft = res.state
    rng = res.rng
    draft.merchantFoundingCooldownByState[stateId as string] =
      week + config.merchantCompanyRefoundingCooldownWeeks

    // 直近に作った company（最大 id）を拾って Chronicle emit。
    const newCompanyId =
      `mc-${draft.nextMerchantCompanyId - 1}` as keyof typeof draft.merchantCompanies
    const company = draft.merchantCompanies[newCompanyId]
    workingCtx = { ...workingCtx, state: draft, rng }
    if (company) {
      const { event, ctx: ec } = createSimEvent(workingCtx, {
        type: 'MERCHANT_COMPANY_FOUNDED',
        importance: 'normal',
        messageKey: 'merchant.company_founded',
        messageParams: { company: nameParam('merchant_company', company.nameKey) },
        entityRefs: [entityRef('merchant_company', company.id, 'company', company.nameKey)],
      })
      workingCtx = { ...ec, events: [...ec.events, event], rng }
      draft = workingCtx.state
    }
  }

  draft = {
    ...draft,
    nextPersonIndex: counters.nextPersonIndex,
    nextHouseIndex: counters.nextHouseIndex,
  }
  // ctx の live カウンタも進める（同 tick の後続 system / tick 末の state 書き戻しが衝突しないように）。
  return {
    ...workingCtx,
    state: draft,
    rng,
    nextPersonIndex: counters.nextPersonIndex,
    nextHouseIndex: counters.nextHouseIndex,
  }
}
