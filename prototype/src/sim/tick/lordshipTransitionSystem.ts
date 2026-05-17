import type { TickContext } from './context'
import type { ProvinceId, HouseId } from '../types/ids'
import type { SimEvent } from '../types/event'
import { randomFloat } from '../rng/rng'
import { makeEventId } from './context'
import { clamp } from '../utils/math'
import { transferProvinceToHouse } from '../mutations/provinceMutations'

export function runLordshipTransitionSystem(ctx: TickContext): TickContext {
  const { provinces, houses } = ctx.state
  const config = ctx.config
  let currentCtx = ctx

  const provinceSnapshot = { ...provinces }
  const houseSnapshot = { ...houses }

  const candidates: Array<{
    targetId: ProvinceId
    sourceNeighbor: { houseControl: number; ownerHouseId: HouseId }
  }> = []

  let currentRng = currentCtx.rng

  for (const targetIdKey of Object.keys(provinceSnapshot)) {
    const targetId = targetIdKey as ProvinceId
    const target = provinceSnapshot[targetId]
    if (!target) continue

    if (target.houseControl >= config.lordshipAbsorptionTargetThreshold) continue

    const ownerHouse = houseSnapshot[target.ownerHouseId]
    if (!ownerHouse) continue
    if (target.id === ownerHouse.seatProvinceId) continue

    const neighborCandidates: Array<{
      neighbor: { houseControl: number; ownerHouseId: HouseId }
    }> = []

    for (const neighborId of target.neighbors) {
      const neighbor = provinceSnapshot[neighborId]
      if (!neighbor) continue
      if (neighbor.countryId !== target.countryId) continue
      if (neighbor.ownerHouseId === target.ownerHouseId) continue
      if (neighbor.houseControl < config.lordshipAbsorptionSourceMinimum) continue
      if (neighbor.houseControl < target.houseControl * config.lordshipAbsorptionRatio) continue

      neighborCandidates.push({
        neighbor: { houseControl: neighbor.houseControl, ownerHouseId: neighbor.ownerHouseId },
      })
    }

    if (neighborCandidates.length === 0) continue

    const first = neighborCandidates[0]
    if (!first) continue
    let bestNeighbor = first.neighbor
    if (neighborCandidates.length > 1) {
      const maxHouseControl = Math.max(...neighborCandidates.map((c) => c.neighbor.houseControl))
      const topCandidates = neighborCandidates.filter(
        (c) => c.neighbor.houseControl === maxHouseControl,
      )
      if (topCandidates.length > 1) {
        const { value: index, rng: nextRng } = randomFloat(currentRng)
        currentRng = nextRng
        const chosenIndex = Math.floor(index * topCandidates.length)
        const chosen = topCandidates[chosenIndex]
        if (!chosen) continue
        bestNeighbor = chosen.neighbor
      } else {
        const top = topCandidates[0]
        if (!top) continue
        bestNeighbor = top.neighbor
      }
    }

    const { value: chance, rng: nextRng } = randomFloat(currentRng)
    currentRng = nextRng

    if (chance >= config.lordshipAbsorptionMonthlyChance) continue

    candidates.push({ targetId, sourceNeighbor: bestNeighbor })
  }

  const newEvents: SimEvent[] = []

  for (const candidate of candidates) {
    const target = provinceSnapshot[candidate.targetId]
    if (!target) continue

    const oldHouseId = target.ownerHouseId
    const newHouseId = candidate.sourceNeighbor.ownerHouseId

    const newHouse = houseSnapshot[newHouseId]
    if (!newHouse) continue

    const { id: eventId, ctx: eventCtx } = makeEventId(currentCtx)
    currentCtx = eventCtx

    const targetProvince = provinceSnapshot[candidate.targetId]
    const oldHouseName = houseSnapshot[oldHouseId]?.name ?? oldHouseId
    const newHouseName = newHouse.name
    const provinceName = targetProvince?.name ?? candidate.targetId

    newEvents.push({
      id: eventId,
      type: 'LORDSHIP_TRANSFERRED',
      year: currentCtx.state.currentYear,
      month: currentCtx.state.currentMonth,
      importance: 'minor',
      actorIds: [],
      houseIds: [newHouseId, oldHouseId],
      countryIds: [],
      provinceIds: [candidate.targetId],
      summary: `${newHouseName} absorbed ${provinceName} from ${oldHouseName}.`,
      reasons: [],
      effects: [],
    })
  }

  let currentState = currentCtx.state
  for (const candidate of candidates) {
    const newHouseControl = clamp(
      candidate.sourceNeighbor.houseControl - config.lordshipAbsorptionNewControlPenalty,
      config.lordshipAbsorptionNewControlMin,
      config.lordshipAbsorptionNewControlMax,
    )
    const r = transferProvinceToHouse(
      currentState,
      candidate.targetId,
      candidate.sourceNeighbor.ownerHouseId,
      {
        newHouseControl,
      },
    )
    if (r.ok) currentState = r.value
  }

  return {
    ...currentCtx,
    state: currentState,
    events: [...currentCtx.events, ...newEvents],
    nextEventIndex: currentCtx.nextEventIndex + newEvents.length,
  }
}
