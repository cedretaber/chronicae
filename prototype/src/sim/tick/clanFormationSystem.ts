import type { TickContext } from './context'
import type { WorldState } from '@sim/types/world'
import type { HouseId, ClanId, PersonId } from '@sim/types/ids'
import { isRulingHouse, isInfluentialHouse } from '@sim/selectors/availabilitySelectors'
import { createClan, addHouseToClan, syncClanActive } from '@sim/mutations/clanMutations'

function collectMemberHouseIds(state: WorldState, rootHouseId: HouseId): HouseId[] {
  const result: HouseId[] = []
  const visited = new Set<string>()
  const stack: HouseId[] = [rootHouseId]
  while (stack.length > 0) {
    const houseId = stack.pop()!
    if (visited.has(houseId)) continue
    visited.add(houseId)
    const house = state.houses[houseId]
    if (!house) continue
    if (house.kind === 'system') continue
    if (house.clanId !== undefined && houseId !== rootHouseId) continue
    result.push(houseId)
    for (const cadetId of house.cadetHouseIds) {
      if (!visited.has(cadetId)) {
        const cadet = state.houses[cadetId]
        if (cadet && cadet.clanId !== undefined) continue
        stack.push(cadetId)
      }
    }
  }
  return result
}

export function runClanFormationSystem(ctx: TickContext): TickContext {
  let state = ctx.state
  const config = ctx.config

  // --- Part 1: New clan formation ---
  const houseIds = Object.keys(state.houses).sort() as HouseId[]
  for (const houseId of houseIds) {
    const house = state.houses[houseId]
    if (!house) continue
    if (!house.active) continue
    if (house.kind === 'system') continue
    if (house.clanId !== undefined) continue

    const formationGroup: HouseId[] = [houseId]
    for (const cadetId of house.cadetHouseIds) {
      const cadet = state.houses[cadetId]
      if (!cadet) continue
      if (!cadet.active) continue
      if (cadet.kind === 'system') continue
      if (cadet.clanId !== undefined) continue
      formationGroup.push(cadetId)
    }

    const directCadetCount = formationGroup.length - 1
    if (directCadetCount < config.clanFormationMinDirectCadetHouses) continue

    let hasInfluence = false
    for (const fid of formationGroup) {
      if (isRulingHouse(state, fid)) {
        hasInfluence = true
        break
      }
    }
    if (!hasInfluence) {
      let influentialCount = 0
      for (const fid of formationGroup) {
        if (isInfluentialHouse(state, config, fid)) influentialCount++
      }
      if (influentialCount < config.clanFormationMinInfluentialHouses) continue
    }

    let totalLiving = 0
    let totalWealth = 0
    let totalPrestige = 0
    for (const fid of formationGroup) {
      const fHouse = state.houses[fid]
      if (!fHouse || !fHouse.active) continue
      totalLiving += fHouse.memberIds.length
      totalWealth += fHouse.wealth
      totalPrestige += fHouse.legacyPrestige
    }
    const quantityPass =
      totalLiving >= config.clanFormationMinTotalLivingMembers ||
      totalWealth >= config.clanFormationMinTotalWealth ||
      totalPrestige >= config.clanFormationMinTotalLegacyPrestige
    if (!quantityPass) continue

    const memberHouseIds = collectMemberHouseIds(state, houseId)
    const rootHouse = state.houses[houseId]
    const createParams: {
      rootHouseId: HouseId
      memberHouseIds: HouseId[]
      founderPersonId?: PersonId
      createdWeek: number
    } = {
      rootHouseId: houseId,
      memberHouseIds,
      createdWeek: state.absoluteWeek,
    }
    if (rootHouse?.founderId !== undefined) {
      createParams.founderPersonId = rootHouse.founderId
    }
    const result = createClan(state, createParams)
    state = result.state
  }

  // --- Part 2: Existing clan maintenance ---
  const clanIds = Object.keys(state.clans).sort() as ClanId[]
  for (const clanId of clanIds) {
    const clan = state.clans[clanId]
    if (!clan) continue

    for (const memberHouseId of [...clan.memberHouseIds]) {
      const memberHouse = state.houses[memberHouseId]
      if (!memberHouse) continue
      for (const cadetId of memberHouse.cadetHouseIds) {
        const cadet = state.houses[cadetId]
        if (cadet && cadet.clanId === undefined && cadet.kind !== 'system') {
          state = addHouseToClan(state, clanId, cadetId)
        }
      }
    }

    state = syncClanActive(state, clanId)
  }

  return { ...ctx, state }
}
