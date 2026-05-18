import { describe, it, expect } from 'vitest'
import { generateWorld } from './generateWorld'
import type { ProvinceId } from '../types/ids'
import {
  getHouseControlledProvinceIds,
  getProvinceEffectiveOwnerHouseId,
} from '../selectors/landContractSelectors'

describe('generateWorld', () => {
  it('is deterministic: same seed produces identical world', () => {
    const { world: w1 } = generateWorld('test-seed')
    const { world: w2 } = generateWorld('test-seed')
    expect(JSON.stringify(w1)).toEqual(JSON.stringify(w2))
  })

  it('has correct structure: 40 provinces, 15 polities (3 kingdoms + 4 duchies + 8 counties), 15 normal + 1 AnonymousHouse', () => {
    const { world } = generateWorld('test-seed')
    expect(Object.keys(world.provinces).length).toEqual(40)
    expect(Object.keys(world.polities).length).toEqual(15)
    const rank2 = Object.values(world.polities).filter((p) => p?.rank === 2).length
    const rank3 = Object.values(world.polities).filter((p) => p?.rank === 3).length
    const rank4 = Object.values(world.polities).filter((p) => p?.rank === 4).length
    expect(rank2).toEqual(3)
    expect(rank3).toEqual(4)
    expect(rank4).toEqual(8)
    const normalHouseCount = Object.values(world.houses).filter((h) => h?.kind !== 'system').length
    const systemHouseCount = Object.values(world.houses).filter((h) => h?.kind === 'system').length
    expect(normalHouseCount).toEqual(15)
    expect(systemHouseCount).toEqual(1)
  })

  it('has correct person count: 120 normal + 40 placeholder bailiffs', () => {
    const { world } = generateWorld('test-seed')
    const normal = Object.values(world.persons).filter((p) => p?.kind !== 'placeholder').length
    const placeholder = Object.values(world.persons).filter((p) => p?.kind === 'placeholder').length
    expect(normal).toBe(120)
    expect(placeholder).toBe(40)
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

        const house = world.houses[person.houseId]
        expect(house).toBeDefined()
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
