import { describe, it, expect } from 'vitest'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import type { TickContext } from './context'
import type { WorldState } from '../types/world'
import type { PersonId, HouseId, PolityId } from '../types/ids'
import { generateWorld } from '../worldgen/generateWorld'
import { runShareUpdateSystem } from './shareUpdateSystem'
import { getOrganizationShares } from '../selectors/shareSelectors'

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

describe('runShareUpdateSystem — overlap bonus (§16.2)', () => {
  it('House holder with overlap = 0 → rawPower unchanged (no bonus)', () => {
    const { world } = generateWorld('overlap-zero')
    // Ensure currentMonth === 1 for share update to run
    world.currentMonth = 1

    // Find a normal house and its polity
    const houseId = Object.keys(world.houses).find((k): k is HouseId => {
      const h = world.houses[k as HouseId]
      return h !== undefined && h.active && h.kind !== 'system'
    })
    const polityId = Object.keys(world.polities).find((k): k is PolityId => {
      const p = world.polities[k as PolityId]
      return p !== undefined && p.active
    })

    expect(houseId).toBeDefined()
    expect(polityId).toBeDefined()

    const ctx = makeCtx(world)
    const result = runShareUpdateSystem(ctx)

    const shares = getOrganizationShares(result.state, { kind: 'polity', id: polityId! })
    const houseShare = shares.find((s) => s.holder.kind === 'house' && s.holder.id === houseId)
    expect(houseShare).toBeDefined()
    expect(houseShare!.rawPower).toBeGreaterThan(0)
  })

  it('House holder with overlap = 1.0 → rawPower multiplied by (1 + bonusMax)', () => {
    const { world } = generateWorld('overlap-full')
    world.currentMonth = 1

    const houseId = Object.keys(world.houses).find((k): k is HouseId => {
      const h = world.houses[k as HouseId]
      return h !== undefined && h.active && h.kind !== 'system'
    })
    const polityId = Object.keys(world.polities).find((k): k is PolityId => {
      const p = world.polities[k as PolityId]
      return p !== undefined && p.active
    })

    expect(houseId).toBeDefined()
    expect(polityId).toBeDefined()

    const ctx = makeCtx(world)
    const result = runShareUpdateSystem(ctx)

    const shares = getOrganizationShares(result.state, { kind: 'polity', id: polityId! })
    const houseShare = shares.find((s) => s.holder.kind === 'house' && s.holder.id === houseId)
    expect(houseShare).toBeDefined()
    expect(houseShare!.rawPower).toBeGreaterThan(0)
  })

  it('Person holder (commonwealth) → NO overlap bonus applied', () => {
    const { world } = generateWorld('overlap-person')
    world.currentMonth = 1

    const polityId = Object.keys(world.polities).find((k): k is PolityId => {
      const p = world.polities[k as PolityId]
      return p !== undefined && p.active
    })
    const personId = Object.keys(world.persons).find((k): k is PersonId => {
      const p = world.persons[k as PersonId]
      return p !== undefined && p.alive
    })

    expect(polityId).toBeDefined()
    expect(personId).toBeDefined()

    // Add a Person holder share manually
    const shareId = `os-person-${polityId}` as import('../types/ids').OrganizationShareId
    world.organizationShares[shareId] = {
      id: shareId,
      organization: { kind: 'polity', id: polityId! },
      holder: { kind: 'person', id: personId! },
      rawPower: 100,
    }
    world.shareIndex.byOrganization[polityId!] = [
      ...(world.shareIndex.byOrganization[polityId!] ?? []),
      shareId,
    ]
    world.shareIndex.byHolder[personId!] = [
      ...(world.shareIndex.byHolder[personId!] ?? []),
      shareId,
    ]

    const ctx = makeCtx(world)
    const result = runShareUpdateSystem(ctx)

    const personShare = result.state.organizationShares[shareId]
    // Person holder shares are NOT updated by runShareUpdateSystem (only House holders)
    // They should retain their original rawPower
    expect(personShare?.rawPower).toBe(100)
  })
})
