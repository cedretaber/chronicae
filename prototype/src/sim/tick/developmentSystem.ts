import { clamp } from '../utils/math'
import type { TickContext } from './context'
import type { ProvinceId } from '../types/ids'

export function runDevelopmentSystem(ctx: TickContext): TickContext {
  // v013-residual: simple-batch — 全 province の development を decay/recover。adjustProvinceDevelopment で代替可だがループが単純なので直接記述
  const newProvinces = { ...ctx.state.provinces }

  for (const provinceId of Object.keys(ctx.state.provinces).sort()) {
    const province = ctx.state.provinces[provinceId as ProvinceId]
    if (!province) continue

    let { development } = province

    if (development > 0) {
      development = Math.max(0, development - ctx.config.developmentPositiveMonthlyDecay)
    } else if (development < 0) {
      development = Math.min(0, development + ctx.config.developmentNegativeMonthlyRecovery)
    }

    development = clamp(development, -100, 100)

    newProvinces[provinceId as ProvinceId] = { ...province, development }
  }

  return {
    ...ctx,
    state: {
      ...ctx.state,
      provinces: newProvinces,
    },
  }
}
