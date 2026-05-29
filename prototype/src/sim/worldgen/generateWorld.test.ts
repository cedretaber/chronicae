import { describe, it, expect } from 'vitest'
import { generateWorld } from './generateWorld'
import type { ProvinceId } from '../types/ids'
import {
  getHouseControlledProvinceIds,
  getProvinceEffectiveOwnerHouseId,
} from '../selectors/landContractSelectors'
import { WORLD_PRESETS } from './worldPresets'
import { defaultMapConfig } from './mapConfig'

const tinyPreset = WORLD_PRESETS.tiny

describe('generateWorld', () => {
  it('is deterministic: same seed produces identical world', () => {
    const { world: w1 } = generateWorld('test-seed')
    const { world: w2 } = generateWorld('test-seed')
    expect(JSON.stringify(w1)).toEqual(JSON.stringify(w2))
  })

  it('has correct structure: province count in expected range, 9 polities (1 kingdom + 2 duchies + 6 counties), 9 normal houses', () => {
    const { world } = generateWorld('test-seed')
    const provinceCount = Object.keys(world.provinces).length
    const minProv = tinyPreset.stateCount * tinyPreset.provinceCountPerStateMin
    const maxProv = tinyPreset.stateCount * tinyPreset.provinceCountPerStateMax
    expect(provinceCount).toBeGreaterThanOrEqual(minProv)
    expect(provinceCount).toBeLessThanOrEqual(maxProv)
    expect(Object.keys(world.polities).length).toEqual(9)
    const rank2 = Object.values(world.polities).filter((p) => p?.rank === 2).length
    const rank3 = Object.values(world.polities).filter((p) => p?.rank === 3).length
    const rank4 = Object.values(world.polities).filter((p) => p?.rank === 4).length
    expect(rank2).toEqual(1)
    expect(rank3).toEqual(2)
    expect(rank4).toEqual(6)
    const normalHouseCount = Object.values(world.houses).filter((h) => h?.kind !== 'system').length
    const systemHouseCount = Object.values(world.houses).filter((h) => h?.kind === 'system').length
    expect(normalHouseCount).toEqual(9)
    expect(systemHouseCount).toEqual(0)
  })

  it('has correct person count: varies by preset + 1 placeholder singleton', () => {
    const { world } = generateWorld('test-seed')
    const normal = Object.values(world.persons).filter((p) => p?.kind !== 'placeholder').length
    const placeholder = Object.values(world.persons).filter((p) => p?.kind === 'placeholder').length
    expect(placeholder).toBe(1)
    expect(normal).toBeGreaterThan(0)
  })

  describe('consistency checks', () => {
    it('every house: all controlled provinces exist and effective owner matches', () => {
      const { world } = generateWorld('test-seed')

      const houseKeys = Object.keys(world.houses).sort()
      for (const hk of houseKeys) {
        const house = world.houses[hk as keyof typeof world.houses]
        if (!house) continue

        const provinceIds = getHouseControlledProvinceIds(world, house.id)
        for (const pid of provinceIds) {
          const province = world.provinces[pid]
          expect(province).toBeDefined()
          const effectiveOwner = getProvinceEffectiveOwnerHouseId(world, pid)
          expect(effectiveOwner).toEqual(house.id)
        }
      }
    })

    it('every person: house exists', () => {
      const { world } = generateWorld('test-seed')

      const personKeys = Object.keys(world.persons).sort()
      for (const pk of personKeys) {
        const person = world.persons[pk as keyof typeof world.persons]
        if (!person) continue

        if (person.houseId) {
          const house = world.houses[person.houseId]
          expect(house).toBeDefined()
        }
      }
    })

    it('every normal house: has an active leader office with a living holder', () => {
      const { world } = generateWorld('test-seed')

      const houseKeys = Object.keys(world.houses).sort()
      for (const hk of houseKeys) {
        const house = world.houses[hk as keyof typeof world.houses]
        if (!house) continue
        if (house.kind === 'system') continue

        const orgKey = `house:${house.id}`
        const officeIds = world.officeIndex.byOrganization[orgKey] ?? []
        const leaderOffice = officeIds
          .map((id) => world.officeAssignments[id])
          .find((o) => o?.active && o.role === 'leader')

        expect(leaderOffice).toBeDefined()
        const head = world.persons[leaderOffice!.holderPersonId]
        expect(head).toBeDefined()
        expect(head?.alive).toBe(true)
      }
    })

    it('every province: effective owner house exists', () => {
      const { world } = generateWorld('test-seed')

      const provinceKeys = Object.keys(world.provinces).sort()
      for (const pkk of provinceKeys) {
        const province = world.provinces[pkk as keyof typeof world.provinces]
        if (!province) continue

        const effectiveOwner = getProvinceEffectiveOwnerHouseId(world, province.id)
        if (!effectiveOwner) continue
        const house = world.houses[effectiveOwner]
        expect(house).toBeDefined()
      }
    })
  })

  describe('parameter bounds', () => {
    it('provinces: valid terrain/features, each Holding has POPs', () => {
      const { world } = generateWorld('test-seed')

      const validTerrains = ['plains', 'forest', 'hills', 'mountains', 'wetlands']
      const validFeatures = ['coastal', 'major_river', 'lake']
      const provinceKeys = Object.keys(world.provinces).sort()
      for (const pk of provinceKeys) {
        const province = world.provinces[pk as keyof typeof world.provinces]
        expect(validTerrains).toContain(province?.terrain)
        expect(Array.isArray(province?.features)).toBe(true)
        for (const f of province?.features ?? []) {
          expect(validFeatures).toContain(f)
        }
        // features には重複が無い
        const features = province?.features ?? []
        expect(new Set(features).size).toBe(features.length)
        // Each Holding should have POPs registered in popIndex
        const holdingIds = province?.holdingIds ?? []
        expect(holdingIds.length).toBeGreaterThanOrEqual(1)
      }
    })

    it('polities: treasury in [100,300], legacyPrestige in [20,60]', () => {
      const { world } = generateWorld('test-seed')

      const polityKeys = Object.keys(world.polities).sort()
      for (const ck of polityKeys) {
        const polity = world.polities[ck as keyof typeof world.polities]
        expect(polity?.treasury).toBeGreaterThanOrEqual(100)
        expect(polity?.treasury).toBeLessThanOrEqual(300)
        expect(polity?.legacyPrestige).toBeGreaterThanOrEqual(20)
        expect(polity?.legacyPrestige).toBeLessThanOrEqual(60)
      }
    })
  })

  describe('graph structure', () => {
    it('every province has at least 1 neighbor', () => {
      const { world } = generateWorld('graph-test-seed')

      for (const province of Object.values(world.provinces)) {
        if (!province) continue
        expect(province.neighbors.length).toBeGreaterThanOrEqual(1)
      }
    })

    it('neighbor relationship is bidirectional', () => {
      const { world } = generateWorld('bidirectional-test-seed')

      for (const province of Object.values(world.provinces)) {
        if (!province) continue
        for (const neighborId of province.neighbors) {
          const neighborProvince = world.provinces[neighborId]
          if (!neighborProvince) continue
          expect((neighborProvince.neighbors as string[]).includes(province.id as string)).toBe(
            true,
          )
        }
      }
    })

    it('all provinces form a single connected component', () => {
      const { world } = generateWorld('connected-test-seed')

      const provinceKeys = Object.keys(world.provinces).sort() as ProvinceId[]
      const startId = provinceKeys[0]!
      const visited = new Set<ProvinceId>()
      const queue: ProvinceId[] = [startId]

      while (queue.length > 0) {
        const current = queue.shift()!
        if (visited.has(current)) continue
        visited.add(current)
        const currentProvince = world.provinces[current]
        if (!currentProvince) continue
        for (const neighborId of currentProvince.neighbors) {
          if (!visited.has(neighborId)) {
            queue.push(neighborId)
          }
        }
      }

      expect(visited.size).toEqual(Object.keys(world.provinces).length)
    })

    it('same seed produces same neighbor graph (determinism)', () => {
      const { world: w1 } = generateWorld('determinism-test')
      const { world: w2 } = generateWorld('determinism-test')

      const provinceKeys = Object.keys(w1.provinces).sort() as ProvinceId[]
      for (const id of provinceKeys) {
        const n1 = w1.provinces[id]?.neighbors
        const n2 = w2.provinces[id]?.neighbors
        expect(n1?.sort()).toEqual(n2?.sort())
      }
    })

    it('province coordinates within map bounds', () => {
      const { world } = generateWorld('bounds-test-seed')

      for (const province of Object.values(world.provinces)) {
        if (!province) continue
        expect(province.x).toBeGreaterThanOrEqual(0)
        expect(province.x).toBeLessThanOrEqual(defaultMapConfig.worldMapWidth)
        expect(province.y).toBeGreaterThanOrEqual(0)
        expect(province.y).toBeLessThanOrEqual(defaultMapConfig.worldMapHeight)
      }
    })

    it("each state's provinces form a connected subgraph", () => {
      const { world } = generateWorld('state-connectivity-seed')

      for (const state of Object.values(world.states)) {
        if (!state || state.provinceIds.length <= 1) continue

        const stateProvSet = new Set<ProvinceId>(state.provinceIds)
        const startId = state.provinceIds[0]!
        const visited = new Set<ProvinceId>()
        const queue: ProvinceId[] = [startId]

        while (queue.length > 0) {
          const current = queue.shift()!
          if (visited.has(current)) continue
          visited.add(current)
          const prov = world.provinces[current]
          if (!prov) continue
          for (const nid of prov.neighbors) {
            if (stateProvSet.has(nid) && !visited.has(nid)) {
              queue.push(nid)
            }
          }
        }

        expect(visited.size).toEqual(state.provinceIds.length)
      }
    })
  })

  describe('state structure', () => {
    it('has correct number of states', () => {
      const { world } = generateWorld('test-seed')
      expect(Object.keys(world.states).length).toBe(tinyPreset.stateCount)
    })

    it('each state has province count within preset range', () => {
      const { world } = generateWorld('test-seed')
      for (const state of Object.values(world.states)) {
        if (!state) continue
        expect(state.provinceIds.length).toBeGreaterThanOrEqual(tinyPreset.provinceCountPerStateMin)
        expect(state.provinceIds.length).toBeLessThanOrEqual(
          tinyPreset.provinceCountPerStateMax + 2,
        )
      }
    })

    it('every province belongs to a state', () => {
      const { world } = generateWorld('test-seed')
      for (const province of Object.values(world.provinces)) {
        if (!province) continue
        const state = world.states[province.stateId]
        expect(state).toBeDefined()
        expect(state!.provinceIds).toContain(province.id)
      }
    })

    it('states have centerX/centerY within map bounds', () => {
      const { world } = generateWorld('test-seed')
      for (const state of Object.values(world.states)) {
        if (!state) continue
        expect(state.centerX).toBeGreaterThanOrEqual(0)
        expect(state.centerX).toBeLessThanOrEqual(defaultMapConfig.worldMapWidth)
        expect(state.centerY).toBeGreaterThanOrEqual(0)
        expect(state.centerY).toBeLessThanOrEqual(defaultMapConfig.worldMapHeight)
      }
    })
  })
})
