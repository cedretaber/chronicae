import type { TickContext } from './context'
import { createSimEvent } from './context'
import { randomFloat } from '../rng/rng'
import type { ProvinceId } from '../types/ids'
import { nameParam, entityRef } from '../types/event'
import {
  adjustProvincePopWealthByClass,
  adjustProvincePopUnrestByClass,
} from '../mutations/popMutations'
import { getProvinceTerminalPolityId } from '../selectors/landContractSelectors'

// v0.48 §4: 旧 disasterSystem から BountifulHarvest (正イベント) を切り出した。年次のまま
//   (週次化すると ~48 倍に暴発する)。負イベント (famine/plague/drought) は crisisSystem に移設済み。
function applyBountifulHarvest(ctx: TickContext, provinceId: ProvinceId): TickContext {
  const province = ctx.state.provinces[provinceId]
  if (!province) return ctx

  let nextState = ctx.state
  nextState = adjustProvincePopWealthByClass(
    nextState,
    provinceId,
    'lower',
    ctx.config.bountifulHarvestPeasantWealthGain,
  )
  nextState = adjustProvincePopUnrestByClass(
    nextState,
    provinceId,
    'lower',
    -ctx.config.bountifulHarvestPeasantUnrestReduction,
  )
  nextState = adjustProvincePopWealthByClass(
    nextState,
    provinceId,
    'middle',
    ctx.config.bountifulHarvestTownsmanWealthGain,
  )
  nextState = adjustProvincePopUnrestByClass(
    nextState,
    provinceId,
    'middle',
    -ctx.config.bountifulHarvestTownsmanUnrestReduction,
  )

  const nextCtx = { ...ctx, state: nextState }
  const { event, ctx: eventCtx } = createSimEvent(nextCtx, {
    type: 'BOUNTIFUL_HARVEST',
    importance: 'normal',
    messageKey: 'disaster.bountiful_harvest',
    messageParams: {
      province: nameParam('province', province.nameKey),
    },
    entityRefs: [entityRef('province', provinceId, 'province', province.nameKey)],
  })
  return { ...eventCtx, state: nextState, events: [...eventCtx.events, event] }
}

export function runHarvestSystem(ctx: TickContext): TickContext {
  if (!ctx.config.disasterEnabled) return ctx

  let currentCtx = ctx

  for (const provinceIdStr of Object.keys(ctx.state.provinces).sort()) {
    const provinceId = provinceIdStr as ProvinceId
    const province = ctx.state.provinces[provinceId]
    if (!province) continue

    const terminalPolityId = getProvinceTerminalPolityId(currentCtx.state, provinceId)
    if (!terminalPolityId) continue
    const polity = currentCtx.state.polities[terminalPolityId]
    if (!polity || !polity.active) continue

    const { value: harvestRoll, rng } = randomFloat(currentCtx.rng)
    currentCtx = { ...currentCtx, rng }

    if (harvestRoll < ctx.config.bountifulHarvestBaseChancePerYear) {
      currentCtx = applyBountifulHarvest(currentCtx, provinceId)
    }
  }

  return currentCtx
}
