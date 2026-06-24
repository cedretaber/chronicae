import type { TickContext } from './context'
import type { WorldState } from '../types/world'
import type { RegimentId, PolityId } from '../types/ids'
import { getPolityTerritorialStatus } from '../types/polity'
import { disbandRegimentMut, createRegiment } from '../mutations/regimentMutations'
import { organizationKey } from '../selectors/organizationSelectors'

export function runCavalryEntitlementSystem(ctx: TickContext): TickContext {
  let ws: WorldState = ctx.state
  let cloned = false
  const ensureDraft = (): void => {
    if (cloned) return
    ws = {
      ...ctx.state,
      regiments: { ...ctx.state.regiments },
      regimentIndex: {
        byOwner: { ...ctx.state.regimentIndex.byOwner },
        byWar: { ...ctx.state.regimentIndex.byWar },
        byHomeProvince: { ...ctx.state.regimentIndex.byHomeProvince },
        byHomeHolding: { ...ctx.state.regimentIndex.byHomeHolding },
      },
    }
    cloned = true
  }

  const { config } = ctx
  const cooldownWeeks = config.cavalryDestroyedCooldownWeeks

  const allRegimentIds = Object.keys(ws.regiments) as RegimentId[]

  // Step 1: titular owner の cavalry を即 disband
  for (const rid of allRegimentIds) {
    const r = ws.regiments[rid]
    if (!r || r.troopKind !== 'cavalry' || r.status === 'disbanded') continue
    if (r.owner.kind !== 'polity') continue
    const polity = ws.polities[r.owner.id]
    if (!polity || !polity.active) continue
    if (getPolityTerritorialStatus(polity) === 'titular') {
      ensureDraft()
      disbandRegimentMut(ws, rid)
    }
  }

  // Step 2: destroyed cavalry の cooldown → disband
  for (const rid of allRegimentIds) {
    const r = ws.regiments[rid]
    if (!r || r.troopKind !== 'cavalry' || r.status !== 'destroyed') continue
    if (r.destroyedWeek !== undefined && ws.absoluteWeek - r.destroyedWeek >= cooldownWeeks) {
      ensureDraft()
      disbandRegimentMut(ws, rid)
    }
  }

  // Step 3: active non-titular Polity ごとに entitlement 調整
  const polityIds = (Object.keys(ws.polities) as PolityId[]).sort()
  for (const polityId of polityIds) {
    const polity = ws.polities[polityId]
    if (!polity || !polity.active) continue
    if (getPolityTerritorialStatus(polity) === 'titular') continue

    const entitlement = config.cavalryEntitlementByRank[polity.rank] ?? 0
    if (entitlement <= 0) continue

    const ownerKey = organizationKey({ kind: 'polity', id: polityId })
    const ownedIds = ws.regimentIndex.byOwner[ownerKey] ?? []

    const activeCav: RegimentId[] = []
    const cooldownCav: RegimentId[] = []
    for (const rid of ownedIds) {
      const r = ws.regiments[rid]
      if (!r || r.troopKind !== 'cavalry') continue
      if (r.status === 'active') {
        activeCav.push(rid)
      } else if (r.status === 'destroyed') {
        cooldownCav.push(rid)
      }
    }

    const currentCount = activeCav.length + cooldownCav.length

    if (currentCount < entitlement) {
      // cooldown 中 destroyed がなければ新規作成
      const deficit = entitlement - currentCount
      for (let i = 0; i < deficit; i++) {
        ensureDraft()
        createRegiment(ws, {
          owner: { kind: 'polity', id: polityId },
          sourceKind: 'noble_retinue',
          troopKind: 'cavalry',
          strength: config.regimentInitialStrength,
          organization: config.regimentInitialOrganization,
          morale: config.regimentInitialMorale,
          maxStrength: config.regimentMaxStrength,
          basePower: config.cavalryEntitlementBasePower,
          baselineOrganization: config.regimentBaselineOrganizationDefault,
          maxOrganization: config.regimentMaxOrganizationDefault,
          baselineMorale: config.regimentBaselineMoraleDefault,
          maxMorale: config.regimentMaxMoraleDefault,
          createdWeek: ws.absoluteWeek,
        })
      }
    } else if (currentCount > entitlement) {
      // 超過時: destroyed 優先、effectivePower(=basePower * strength/100) 昇順で disband
      const excess = currentCount - entitlement
      const candidates = [...cooldownCav, ...activeCav]
      candidates.sort((a, b) => {
        const ra = ws.regiments[a]
        const rb = ws.regiments[b]
        if (!ra || !rb) return 0
        // destroyed を先に
        if (ra.status === 'destroyed' && rb.status !== 'destroyed') return -1
        if (ra.status !== 'destroyed' && rb.status === 'destroyed') return 1
        const ea = ra.basePower * (ra.strength / 100)
        const eb = rb.basePower * (rb.strength / 100)
        return ea - eb
      })
      for (let i = 0; i < excess && i < candidates.length; i++) {
        ensureDraft()
        disbandRegimentMut(ws, candidates[i]!)
      }
    }
  }

  if (!cloned) return ctx
  return { ...ctx, state: ws }
}
