import type { TickContext } from './context'
import type { PolityId, HouseId, PersonId } from '../types/ids'
import { getOrganizationShares, getTotalRawPower } from '../selectors/shareSelectors'
import { getPolityDistributablePerCycle } from '../selectors/landContractSelectors'

// v0.16 §18.2: PolitySurplusDistributionSystem
// 給与控除後 (OfficeCompensation は別 system が treasury から引く) の余剰を Share holder に分配する。
// distributable = max(0, treasury - reserveTarget) * distributionRate
// reserveTarget = base + perHolding × holdingCount (所領規模に応じた動的保留)
// Person Share holder → Person.wealth, House Share holder → House.wealth
export function runPolitySurplusDistributionSystem(ctx: TickContext): TickContext {
  let state = ctx.state

  const houseWealthDeltas = new Map<HouseId, number>()
  const personWealthDeltas = new Map<PersonId, number>()
  const polityTreasuryDeltas = new Map<PolityId, number>()

  for (const polityIdStr of Object.keys(state.polities).sort()) {
    const polityId = polityIdStr as PolityId
    const polity = state.polities[polityId]
    if (!polity || !polity.active) continue

    // v0.37: reserveTarget+distributable は getPolityDistributablePerCycle に集約 (収入投影と共用)
    const distributable = getPolityDistributablePerCycle(state, polityId, ctx.config)
    if (distributable <= 0) continue

    const shares = getOrganizationShares(state, { kind: 'polity', id: polityId })
    const total = getTotalRawPower(state, { kind: 'polity', id: polityId })
    if (total <= 0 || shares.length === 0) continue

    let actuallyDistributed = 0
    for (const share of shares) {
      const portion = (share.rawPower / total) * distributable
      if (portion <= 0) continue
      if (share.holder.kind === 'house') {
        const houseId = share.holder.id
        houseWealthDeltas.set(houseId, (houseWealthDeltas.get(houseId) ?? 0) + portion)
        actuallyDistributed += portion
      } else if (share.holder.kind === 'person') {
        const personId = share.holder.id
        // v0.16: 死亡した Person Share holder には分配しない。
        // shareUpdateSystem の次回更新で Share holder 自体が再計算される想定。
        // それまでの間は分配だけ skip して dead person.wealth が増えないようにする。
        const person = state.persons[personId]
        if (!person || !person.alive) continue
        personWealthDeltas.set(personId, (personWealthDeltas.get(personId) ?? 0) + portion)
        actuallyDistributed += portion
      }
    }
    polityTreasuryDeltas.set(polityId, -actuallyDistributed)
  }

  if (
    houseWealthDeltas.size === 0 &&
    personWealthDeltas.size === 0 &&
    polityTreasuryDeltas.size === 0
  ) {
    return ctx
  }

  // 一括適用
  const newPolities = { ...state.polities }
  for (const [polityId, delta] of polityTreasuryDeltas) {
    const p = newPolities[polityId]
    if (!p) continue
    newPolities[polityId] = { ...p, treasury: Math.max(0, p.treasury + delta) }
  }

  const newHouses = { ...state.houses }
  for (const [houseId, delta] of houseWealthDeltas) {
    const h = newHouses[houseId]
    if (!h) continue
    newHouses[houseId] = { ...h, wealth: Math.max(0, h.wealth + delta) }
  }

  const newPersons = { ...state.persons }
  for (const [personId, delta] of personWealthDeltas) {
    const person = newPersons[personId]
    if (!person) continue
    newPersons[personId] = { ...person, wealth: Math.max(0, person.wealth + delta) }
  }

  state = { ...state, polities: newPolities, houses: newHouses, persons: newPersons }
  return { ...ctx, state }
}
