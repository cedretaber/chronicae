import type { TickContext } from './context'
import { randomFloat } from '../rng/rng'
import type { HouseId, PersonId } from '../types/ids'
import { createLogger } from '../debug/logger'
import { getHouseCohesion } from '../selectors/statusSelectors'
import { splitHouse } from '../mutations/worldStructureMutations'
import { chooseSplitter } from './houseSplitSystem'
import { getHouseControlledProvinceIds } from '../selectors/landContractSelectors'
import { getAdultSuccessionCandidates, getTopHeirIds } from '../selectors/successionSelectors'
import { isLifeStageAtLeast } from '../types/person'
import { getHouseLeader } from '../selectors/officeSelectors'
import { getRoleScore } from '../selectors/abilitySelectors'

export function runHouseSplitEvaluationSystem(ctx: TickContext): TickContext {
  if (!ctx.config.houseSplitEnabled) return ctx

  let currentCtx = ctx
  const log = createLogger(currentCtx.config.debug)

  for (const houseId of Object.keys(currentCtx.state.houses).sort() as HouseId[]) {
    const house = currentCtx.state.houses[houseId]
    if (!house || !house.active) continue
    if (house.kind === 'system') continue

    // Cooldown check
    if (house.lastSplitWeek !== undefined) {
      const weeksSince = currentCtx.state.absoluteWeek - house.lastSplitWeek
      if (weeksSince < currentCtx.config.houseSplitCooldownWeeks) continue
    }

    // Min living members check
    const livingMemberCount = house.memberIds.filter((pid) => {
      const p = currentCtx.state.persons[pid]
      return p && p.alive
    }).length
    if (livingMemberCount < currentCtx.config.houseSplitMinLivingMembers) continue

    // Min wealth check
    if (house.wealth < currentCtx.config.houseSplitMinWealth) continue

    // Min legacyPrestige check
    if (house.legacyPrestige < currentCtx.config.houseSplitMinLegacyPrestige) continue

    // Min provinces check (reuses existing config)
    if (
      getHouseControlledProvinceIds(currentCtx.state, houseId).length <
      currentCtx.config.minProvincesForHouseSplit
    )
      continue

    // Cohesion check
    const currentCohesion = getHouseCohesion(currentCtx.state, houseId)
    if (currentCohesion >= currentCtx.config.houseSplitCohesionThreshold) continue

    // Find adult capable branch member (exclude current leader)
    const candidates = getAdultSuccessionCandidates(currentCtx.state, house, currentCtx.config)
    const leaderId = getHouseLeader(currentCtx.state, houseId)
    const leader = leaderId ? currentCtx.state.persons[leaderId] : undefined
    // 跡継ぎ（現当主基準の継承順位上位 N 人）は分家を興さない。getAdultSuccessionCandidates の
    //   血統スコアは「house 内の死亡メンバー」基準で生存当主のケースでは heir 順にならないため、
    //   現当主 leader を基準に getTopHeirIds で再計算して除外する。
    const heirIds =
      leader !== undefined
        ? getTopHeirIds(
            candidates,
            leader,
            currentCtx.config.houseSplitExcludeTopSuccessionRanks,
            currentCtx.state,
            currentCtx.config,
          )
        : new Set<PersonId>()
    // v0.40 §8.2: 分家を興す splitter（cadet house の founder）は young_adulthood 以降に限る。
    //   succession 用 helper（adultAge=15）は据え置きのまま、splitter にのみ追加ゲートをかける。
    const splitCandidates = candidates.filter(
      (c) =>
        c.person.id !== leaderId &&
        isLifeStageAtLeast(c.person.lifeStage, 'young_adulthood') &&
        !heirIds.has(c.person.id),
    )
    if (splitCandidates.length < 1) continue

    const splitter = chooseSplitter(currentCtx.state, splitCandidates, currentCtx.config)
    if (!splitter) continue

    // Probability roll
    const {
      baseHouseSplitChance,
      houseSplitAmbitionFactor,
      houseSplitPrestigeFactor,
      houseSplitMartialFactor,
      houseSplitCohesionFactor,
    } = currentCtx.config

    const splitChance =
      baseHouseSplitChance +
      splitter.person.traits.ambition * houseSplitAmbitionFactor +
      splitter.person.legacyPrestige * houseSplitPrestigeFactor +
      (getRoleScore(currentCtx.state, splitter.person.id, 'warCommand') / 10) *
        houseSplitMartialFactor -
      currentCohesion * houseSplitCohesionFactor

    const { value: roll, rng: rngAfter } = randomFloat(currentCtx.rng)
    currentCtx = { ...currentCtx, rng: rngAfter }
    if (roll >= splitChance) {
      log.log('HOUSE_SPLIT_EVAL', {
        year: currentCtx.state.currentYear,
        weekOfYear: currentCtx.state.currentWeekOfYear,
        house: houseId,
        splitChance: Math.round(splitChance * 100),
        result: 'skipped',
        reason: 'probability',
      })
      continue
    }

    const result = splitHouse(currentCtx, {
      houseId,
      splitterPersonId: splitter.person.id,
    })
    if (!result.ok) continue
    currentCtx = result.value.ctx

    log.log('HOUSE_SPLIT_EVAL', {
      year: currentCtx.state.currentYear,
      weekOfYear: currentCtx.state.currentWeekOfYear,
      house: houseId,
      result: 'split',
      newHouse: result.value.value.newHouseId,
    })
  }

  return currentCtx
}
