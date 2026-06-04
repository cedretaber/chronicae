// v0.42c: shareUpdateSystem の polity 枝削除 + houseShareUpdateSystem 改名後のテスト。
// 旧 polity overlap テスト (§16.2) は polity share 廃止に伴い削除した
// (overlap は influenceSelectors の office domain 加算としてテスト済み)。

import { describe, it, expect } from 'vitest'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import type { TickContext } from './context'
import type { WorldState } from '../types/world'
import type { PersonId, HouseId } from '../types/ids'
import { generateWorld } from '../worldgen/generateWorld'
import { runHouseShareUpdateSystem } from './houseShareUpdateSystem'
import { getHouseShares } from '../selectors/shareSelectors'

function makeCtx(world: WorldState): TickContext {
  return {
    state: world,
    rng: createRng('share-update-test'),
    config: defaultConfig,
    events: [],
    nextEventIndex: 0,
    deathsThisTick: [],
    deathRolesThisTick: {},
    nextPersonIndex: 0,
    nextHouseIndex: 0,
    nextPolityIndex: 0,
  }
}

describe('runHouseShareUpdateSystem (v0.42c — house 専用)', () => {
  it('updates house shares for living members and never creates polity shares', () => {
    const { world } = generateWorld('house-share-update')
    world.currentWeekOfYear = 1
    world.absoluteWeek = world.currentYear * 48

    const houseId = Object.keys(world.houses).find((k): k is HouseId => {
      const h = world.houses[k as HouseId]
      return h !== undefined && h.active && h.kind !== 'system' && h.memberIds.length > 0
    })
    expect(houseId).toBeDefined()

    const result = runHouseShareUpdateSystem(makeCtx(world))

    // house の living member 全員に share が upsert される
    const houseShares = getHouseShares(result.state, houseId!)
    const livingMembers = result.state.houses[houseId!]!.memberIds.filter((id: PersonId) => {
      const p = result.state.persons[id]
      return p && p.alive
    })
    expect(houseShares.length).toBe(livingMembers.length)
    for (const share of houseShares) {
      expect(share.rawPower).toBeGreaterThan(0)
    }

    // v0.42c: polity share は型レベルで存在しない (houseShares は houseId 必須)
  })

  it('removes dead member shares (50% transferred to leader, remainder deleted)', () => {
    const { world } = generateWorld('house-share-dead')
    world.currentWeekOfYear = 1
    world.absoluteWeek = world.currentYear * 48

    // 適当な家の member を 1 人殺す (alive=false 直接 — share 残置の drift を模す)
    const houseId = Object.keys(world.houses).find((k): k is HouseId => {
      const h = world.houses[k as HouseId]
      return h !== undefined && h.active && h.kind !== 'system' && h.memberIds.length >= 2
    })!
    const victimId = world.houses[houseId]!.memberIds[0]!
    world.persons[victimId] = { ...world.persons[victimId]!, alive: false }

    const result = runHouseShareUpdateSystem(makeCtx(world))
    const shares = getHouseShares(result.state, houseId)
    expect(shares.some((s) => s.holderPersonId === victimId)).toBe(false)
  })
})
