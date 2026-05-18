import { describe, it, expect } from 'vitest'
import { generateWorld } from './generateWorld'
import type { ProvinceId } from '../types/ids'

describe('generateWorld', () => {
  it('is deterministic: same seed produces identical world', () => {
    const { world: w1 } = generateWorld('test-seed')
    const { world: w2 } = generateWorld('test-seed')
    expect(JSON.stringify(w1)).toEqual(JSON.stringify(w2))
  })

  it('has correct structure: 40 provinces, 3 polities, 15 houses', () => {
    const { world } = generateWorld('test-seed')
    expect(Object.keys(world.provinces).length).toEqual(40)
    expect(Object.keys(world.polities).length).toEqual(3)
    expect(Object.keys(world.houses).length).toEqual(15)
  })

  it('has correct person count: 120 persons (8 per house)', () => {
    const { world } = generateWorld('test-seed')
    const count = Object.keys(world.persons).length
    expect(count).toBe(120)
  })

  describe('consistency checks', () => {
    it('every house: all provinceIds exist and ownerHouseId matches', () => {
      const { world } = generateWorld('test-seed')

      const houseKeys = Object.keys(world.houses).sort()
      for (const hk of houseKeys) {
        const house = world.houses[hk as keyof typeof world.houses]
        if (!house) continue

        const provinceIds = house.provinceIds
        for (const pid of provinceIds) {
          const province = world.provinces[pid]
          expect(province).toBeDefined()
          expect(province?.ownerHouseId).toEqual(house.id)
        }
      }
    })

    it('every person: house exists', () => {
      const { world } = generateWorld('test-seed')

      const personKeys = Object.keys(world.persons).sort()
      for (const pk of personKeys) {
        const person = world.persons[pk as keyof typeof world.persons]
        if (!person) continue

        const house = world.houses[person.houseId]
        expect(house).toBeDefined()
      }
    })

    it('every house: has an active leader office with a living holder', () => {
      const { world } = generateWorld('test-seed')

      const houseKeys = Object.keys(world.houses).sort()
      for (const hk of houseKeys) {
        const house = world.houses[hk as keyof typeof world.houses]
        if (!house) continue

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

    it('every province: owner house exists', () => {
      const { world } = generateWorld('test-seed')

      const provinceKeys = Object.keys(world.provinces).sort()
      for (const pkk of provinceKeys) {
        const province = world.provinces[pkk as keyof typeof world.provinces]
        if (!province) continue

        const house = world.houses[province.ownerHouseId]
        expect(house).toBeDefined()
      }
    })
  })

  describe('parameter bounds', () => {
    it('provinces: habitability in [30,90], popGroupIds has 3 entries', () => {
      const { world } = generateWorld('test-seed')

      const provinceKeys = Object.keys(world.provinces).sort()
      for (const pk of provinceKeys) {
        const province = world.provinces[pk as keyof typeof world.provinces]
        expect(province?.habitability).toBeGreaterThanOrEqual(30)
        expect(province?.habitability).toBeLessThanOrEqual(90)
        expect(province?.popGroupIds).toHaveLength(3)
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

  describe('graph structure (after link removal + jitter)', () => {
    it('every province has at least 1 neighbor', () => {
      const { world } = generateWorld('graph-test-seed')

      const provinceKeys = Object.keys(world.provinces).sort() as ProvinceId[]
      for (const id of provinceKeys) {
        const province = world.provinces[id]
        if (!province) continue
        expect(province.neighbors.length).toBeGreaterThanOrEqual(1)
      }
    })

    it('neighbor relationship is bidirectional', () => {
      const { world } = generateWorld('bidirectional-test-seed')

      const provinceKeys = Object.keys(world.provinces).sort() as ProvinceId[]
      for (const id of provinceKeys) {
        const province = world.provinces[id]
        if (!province) continue
        for (const neighborId of province.neighbors) {
          const neighborProvince = world.provinces[neighborId]
          if (!neighborProvince) continue
          expect((neighborProvince.neighbors as string[]).includes(id as string)).toBe(true)
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

      expect(visited.size).toEqual(40)
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

    it('jitter: all province x/y coordinates within expected bounds', () => {
      const { world } = generateWorld('jitter-test-seed')

      const provinceKeys = Object.keys(world.provinces).sort() as ProvinceId[]
      for (const id of provinceKeys) {
        const province = world.provinces[id]
        if (!province) continue
        expect(province.x).toBeGreaterThanOrEqual(-25)
        expect(province.x).toBeLessThanOrEqual(725)
        expect(province.y).toBeGreaterThanOrEqual(-25)
        expect(province.y).toBeLessThanOrEqual(425)
      }
    })
  })
})
