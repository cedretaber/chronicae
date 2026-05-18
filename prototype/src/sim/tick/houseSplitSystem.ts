import type { TickContext } from './context'
import { randomFloat } from '../rng/rng'
import type { HouseId, PersonId } from '../types/ids'
import type { SuccessionCandidate } from '../selectors/successionSelectors'
import { createLogger } from '../debug/logger'
import { getHouseCohesion } from '../selectors/statusSelectors'
import { splitHouse } from '../mutations/worldStructureMutations'
import { getRoleScore } from '../selectors/abilitySelectors'
import { getHouseControlledProvinceIds } from '../selectors/landContractSelectors'
import type { WorldState } from '../types/world'

export type SplitInput = {
  houseId: HouseId
  successorId: PersonId
  splitCandidates: SuccessionCandidate[]
}

export function maybeSplitHouseAfterSuccession(ctx: TickContext, input: SplitInput): TickContext {
  const house = ctx.state.houses[input.houseId]
  if (!house) return ctx

  const {
    houseSplitEnabled,
    minProvincesForHouseSplit,
    houseSplitCohesionThreshold,
    baseHouseSplitChance,
    houseSplitAmbitionFactor,
    houseSplitPrestigeFactor,
    houseSplitMartialFactor,
    houseSplitCohesionFactor,
  } = ctx.config

  const log = createLogger(ctx.config.debug)

  if (!houseSplitEnabled) return ctx
  if (getHouseControlledProvinceIds(ctx.state, house.id).length < minProvincesForHouseSplit)
    return ctx
  if (input.splitCandidates.length < 1) return ctx

  const currentCohesion = getHouseCohesion(ctx.state, house.id)
  if (currentCohesion >= houseSplitCohesionThreshold) {
    log.log('HOUSE_SPLIT', {
      year: ctx.state.currentYear,
      month: ctx.state.currentMonth,
      house: input.houseId,
      cohesion: Math.round(currentCohesion),
      threshold: houseSplitCohesionThreshold,
      result: 'skipped',
      reason: 'cohesion_too_high',
    })
    return ctx
  }

  const splitter = chooseSplitter(ctx.state, input.splitCandidates, ctx.config)
  if (!splitter) return ctx

  const splitChance =
    baseHouseSplitChance +
    splitter.person.traits.ambition * houseSplitAmbitionFactor +
    splitter.person.legacyPrestige * houseSplitPrestigeFactor +
    (getRoleScore(ctx.state, splitter.person.id, 'warCommand') / 10) * houseSplitMartialFactor -
    currentCohesion * houseSplitCohesionFactor

  const { value: roll, rng: rngAfter } = randomFloat(ctx.rng)
  if (roll >= splitChance) {
    log.log('HOUSE_SPLIT', {
      year: ctx.state.currentYear,
      month: ctx.state.currentMonth,
      house: input.houseId,
      cohesion: Math.round(currentCohesion),
      threshold: houseSplitCohesionThreshold,
      split_chance: Math.round(splitChance * 100),
      result: 'skipped',
      reason: 'probability',
    })
    return { ...ctx, rng: rngAfter }
  }

  const ctxAfterRoll = { ...ctx, rng: rngAfter }
  const result = splitHouse(ctxAfterRoll, {
    houseId: input.houseId,
    splitterPersonId: splitter.person.id,
  })
  if (!result.ok) return ctxAfterRoll
  return result.value.ctx
}

function chooseSplitter(
  state: WorldState,
  candidates: SuccessionCandidate[],
  config: import('../config/defaultConfig').SimulationConfig,
): SuccessionCandidate | null {
  let bestCandidate: SuccessionCandidate | null = null
  let bestScore = -Infinity

  for (const candidate of candidates) {
    const score =
      candidate.person.traits.ambition * config.houseSplitAmbitionFactor +
      candidate.person.legacyPrestige * config.houseSplitPrestigeFactor +
      (getRoleScore(state, candidate.person.id, 'warCommand') / 10) * config.houseSplitMartialFactor

    if (score > bestScore) {
      bestScore = score
      bestCandidate = candidate
    }
  }

  return bestCandidate
}
