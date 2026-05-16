import { describe, it, expect } from 'vitest'
import { generateWorld } from './generateWorld'
import type { ProvinceId } from '../types/ids'

describe('generateWorld', () => {
  it('is deterministic: same seed produces identical world', () => {
    const { world: w1 } = generateWorld('test-seed')
    const { world: w2 } = generateWorld('test-seed')
    expect(JSON.stringify(w1)).toEqual(JSON.stringify(w2))
  })

  it('has correct structure: 40 provinces, 3 countries, 15 houses', () => {
    const { world } = generateWorld('test-seed')
    expect(Object.keys(world.provinces).length).toEqual(40)
    expect(Object.keys(world.countries).length).toEqual(3)
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

    it('every person: countryId matches house countryId', () => {
      const { world } = generateWorld('test-seed')

      const personKeys = Object.keys(world.persons).sort()
      for (const pk of personKeys) {
        const person = world.persons[pk as keyof typeof world.persons]
        if (!person) continue

        const house = world.houses[person.houseId]
        expect(house?.countryId).toEqual(person.countryId)
      }
    })

    it('every house: headId exists and is alive', () => {
      const { world } = generateWorld('test-seed')

      const houseKeys = Object.keys(world.houses).sort()
      for (const hk of houseKeys) {
        const house = world.houses[hk as keyof typeof world.houses]
        if (!house) continue

        const head = world.persons[house.headId]
        expect(head).toBeDefined()
        expect(head?.alive).toBe(true)
      }
    })

    it('every province: owner house countryId matches province countryId', () => {
      const { world } = generateWorld('test-seed')

      const provinceKeys = Object.keys(world.provinces).sort()
      for (const pkk of provinceKeys) {
        const province = world.provinces[pkk as keyof typeof world.provinces]
        if (!province) continue

        const house = world.houses[province.ownerHouseId]
        expect(house?.countryId).toEqual(province.countryId)
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

    it('countries: treasury in [100,300], legacyPrestige in [20,60]', () => {
      const { world } = generateWorld('test-seed')

      const countryKeys = Object.keys(world.countries).sort()
      for (const ck of countryKeys) {
        const country = world.countries[ck as keyof typeof world.countries]
        expect(country?.treasury).toBeGreaterThanOrEqual(100)
        expect(country?.treasury).toBeLessThanOrEqual(300)
        expect(country?.legacyPrestige).toBeGreaterThanOrEqual(20)
        expect(country?.legacyPrestige).toBeLessThanOrEqual(60)
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
