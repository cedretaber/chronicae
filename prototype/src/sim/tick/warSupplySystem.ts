import type { TickContext } from './context'
import type { WorldState } from '../types/world'
import type { WarId, PolityId, ProvinceId } from '../types/ids'
import type { WarSideKey, WarSideSupplyState, WarSide } from '../types/war'
import type { Regiment } from '../types/regiment'
import type { EventEntityRef, EventMessageParams } from '../types/event'
import { createSimEvent } from './context'
import { entityRef } from '../types/event'
import { randomFloat } from '../rng/rng'
import {
  computeSupplyAccess,
  computeForageEfficiency,
  computeSupplyDemand,
  computeCavalryRatio,
  computeShortageBand,
  selectWarStaffForSide,
  getProvinceAveragePopUnrest,
} from '../selectors/warSupplySelectors'
import {
  getWarGoalProvince,
  getWarSidePrimaryPolityActor,
  getWarSidePolityActors,
  isEligibleWarPerson,
} from '../selectors/warManeuverSelectors'
import { getRoleScore } from '../selectors/abilitySelectors'
import {
  getProvincePolityControlFromHoldings,
  getHoldingTerminalPolityId,
} from '../selectors/landContractSelectors'
import { updateWarSideMut } from '../mutations/warMutations'
import { destroyRegimentMut, updateRegimentMut } from '../mutations/regimentMutations'
import { clamp } from '../utils/math'

// Check if province territory is friendly for the side
function isFriendlyTerritory(
  state: WorldState,
  provinceId: ProvinceId,
  sidePolityIds: readonly PolityId[],
): boolean {
  const province = state.provinces[provinceId]
  if (!province) return false
  const politySet = new Set<string>(sidePolityIds)
  for (const holdingId of province.holdingIds) {
    const terminal = getHoldingTerminalPolityId(state, holdingId)
    if (terminal !== undefined && politySet.has(terminal)) return true
  }
  return false
}

export function runWarSupplySystem(ctx: TickContext): TickContext {
  if (!ctx.config.warSupplyEnabled) return ctx
  if (!ctx.config.warEnabled) return ctx

  const config = ctx.config
  const absoluteWeek = ctx.state.absoluteWeek

  // Collect active war IDs (sorted for determinism)
  const activeWarIds = Object.keys(ctx.state.wars)
    .sort()
    .filter((id) => ctx.state.wars[id as WarId]?.status === 'active')
  if (activeWarIds.length === 0) return ctx

  // Clone-once mutable draft
  const ws: WorldState = {
    ...ctx.state,
    wars: { ...ctx.state.wars },
    regiments: { ...ctx.state.regiments },
    regimentIndex: {
      byOwner: { ...ctx.state.regimentIndex.byOwner },
      byWar: { ...ctx.state.regimentIndex.byWar },
      byHomeProvince: { ...ctx.state.regimentIndex.byHomeProvince },
      byHomeHolding: { ...ctx.state.regimentIndex.byHomeHolding },
    },
  }
  let next: TickContext = { ...ctx, state: ws }

  for (const idStr of activeWarIds) {
    const wid = idStr as WarId
    const war = ws.wars[wid]
    if (!war || war.status !== 'active') continue

    for (const sideKey of ['attacker', 'defender'] as WarSideKey[]) {
      const side = sideKey === 'attacker' ? war.attacker : war.defender
      const primaryPolityId = getWarSidePrimaryPolityActor(war, sideKey)
      if (primaryPolityId === undefined) continue
      const sidePolityIds = getWarSidePolityActors(war, sideKey)

      // 1. Staff lazy refresh (strategist / quartermaster)
      let strategistId = side.strategistPersonId
      if (strategistId !== undefined && !isEligibleWarPerson(ws, strategistId)) {
        strategistId = undefined
      }
      if (strategistId === undefined) {
        strategistId = selectWarStaffForSide(
          ws,
          config,
          sidePolityIds,
          'strategy',
          side.captainGeneralPersonId,
          side.quartermasterPersonId !== undefined
            ? new Set([side.quartermasterPersonId])
            : undefined,
        )
      }

      let quartermasterId = side.quartermasterPersonId
      if (quartermasterId !== undefined && !isEligibleWarPerson(ws, quartermasterId)) {
        quartermasterId = undefined
      }
      if (quartermasterId === undefined) {
        const exclude = new Set<string>()
        if (strategistId !== undefined) exclude.add(strategistId)
        quartermasterId = selectWarStaffForSide(
          ws,
          config,
          sidePolityIds,
          'stewardship',
          side.captainGeneralPersonId,
          exclude.size > 0 ? exclude : undefined,
        )
      }

      // 2. Province resolution
      const provinceId = getWarGoalProvince(ws, war)
      const prevState = side.supplyState

      // Get previous values (or defaults for first tick)
      const prevSupplyPressure = prevState?.supplyPressure ?? 0
      const prevLocalHostility = prevState?.localHostility ?? 0
      const prevPlunderPressure = prevState?.plunderPressure ?? 0

      if (provinceId === undefined) {
        // No province → decay only
        const nextSupplyPressure = Math.max(
          0,
          prevSupplyPressure - config.warSupplyPressureDecayPerWeek,
        )
        const nextLocalHostility = clamp(
          prevLocalHostility - config.warSupplyLocalHostilityDecayPerWeek,
          0,
          100,
        )
        const nextPlunderPressure = Math.max(
          0,
          prevPlunderPressure - config.warSupplyPlunderPressureDecayPerWeek,
        )
        const newState: WarSideSupplyState = {
          supplyAccess: prevState?.supplyAccess ?? 0,
          supplyPressure: nextSupplyPressure,
          forageEfficiency: prevState?.forageEfficiency ?? 0,
          localHostility: nextLocalHostility,
          plunderPressure: nextPlunderPressure,
        }
        const sidePatch: Partial<WarSide> = {
          supplyState: newState,
          ...(strategistId !== undefined ? { strategistPersonId: strategistId } : {}),
          ...(quartermasterId !== undefined ? { quartermasterPersonId: quartermasterId } : {}),
        }
        updateWarSideMut(ws, wid, sideKey, sidePatch)
        continue
      }

      // 3. Regiment collection
      const warRegimentIds = ws.regimentIndex.byWar[wid] ?? []
      const sideRegiments: Regiment[] = []
      for (const rid of warRegimentIds) {
        const r = ws.regiments[rid]
        if (!r || r.status !== 'active' || r.currentSide !== sideKey) continue
        sideRegiments.push(r)
      }

      const supplyDemand = computeSupplyDemand(sideRegiments, config)
      if (supplyDemand <= 0) {
        // No demand → decay only
        const nextSupplyPressure = Math.max(
          0,
          prevSupplyPressure - config.warSupplyPressureDecayPerWeek,
        )
        const nextLocalHostility = clamp(
          prevLocalHostility - config.warSupplyLocalHostilityDecayPerWeek,
          0,
          100,
        )
        const nextPlunderPressure = Math.max(
          0,
          prevPlunderPressure - config.warSupplyPlunderPressureDecayPerWeek,
        )
        const newState: WarSideSupplyState = {
          supplyAccess: prevState?.supplyAccess ?? 0,
          supplyPressure: nextSupplyPressure,
          forageEfficiency: prevState?.forageEfficiency ?? 0,
          localHostility: nextLocalHostility,
          plunderPressure: nextPlunderPressure,
        }
        const sidePatch: Partial<WarSide> = {
          supplyState: newState,
          ...(strategistId !== undefined ? { strategistPersonId: strategistId } : {}),
          ...(quartermasterId !== undefined ? { quartermasterPersonId: quartermasterId } : {}),
        }
        updateWarSideMut(ws, wid, sideKey, sidePatch)
        continue
      }

      // 4. Staff scores (absent → captainGeneral fallback × 0.75)
      const cgId = side.captainGeneralPersonId
      const cgCommand = cgId !== undefined ? getRoleScore(ws, cgId, 'warCommand') : 0

      let qmScore: number
      if (quartermasterId !== undefined) {
        qmScore = getRoleScore(ws, quartermasterId, 'stewardship')
      } else if (cgId !== undefined) {
        qmScore = getRoleScore(ws, cgId, 'stewardship') * config.warSupplyStaffAbsentScoreMultiplier
      } else {
        qmScore = 0
      }

      let stratScore: number
      if (strategistId !== undefined) {
        stratScore = getRoleScore(ws, strategistId, 'strategy')
      } else if (cgId !== undefined) {
        stratScore = getRoleScore(ws, cgId, 'strategy') * config.warSupplyStaffAbsentScoreMultiplier
      } else {
        stratScore = 0
      }

      // 5. supplyAccess (recomputed)
      const supplyAccess = computeSupplyAccess(
        ws,
        config,
        provinceId,
        prevLocalHostility,
        qmScore,
        stratScore,
        sidePolityIds,
      )

      // 6. forageEfficiency (recomputed)
      const cavalryRatio = computeCavalryRatio(sideRegiments)
      const forageEfficiency = computeForageEfficiency(
        ws,
        config,
        provinceId,
        prevLocalHostility,
        qmScore,
        stratScore,
        cgCommand,
        cavalryRatio,
        sidePolityIds,
      )

      // 7. supplyPressure update (accumulator, uses prev localHostility)
      const pressureGain =
        Math.max(0, supplyDemand - supplyAccess * forageEfficiency) *
        config.warSupplyPressureGainFactor
      const supplyRelief = 0 // Phase 4 will add plunder/requisition relief
      const nextSupplyPressure = Math.max(
        0,
        prevSupplyPressure -
          config.warSupplyPressureDecayPerWeek +
          pressureGain +
          prevLocalHostility * config.warSupplyLocalHostilityToPressureFactor -
          supplyRelief,
      )

      // 8. localHostility update (accumulator, uses THIS week's supplyPressure)
      const friendly = isFriendlyTerritory(ws, provinceId, sidePolityIds)
      const polityControl = getProvincePolityControlFromHoldings(ws, provinceId)
      const avgPopUnrest = getProvinceAveragePopUnrest(ws, provinceId)

      const enemyTerritoryHostilityGain = friendly ? 0 : 2.0
      const friendlyTerritoryReduction = friendly ? 1.5 : 0
      const polityControlReduction = (polityControl / 100) * 1.0
      const qmDiscipline = (qmScore / 100) * config.warSupplyQuartermasterDisciplineFactor
      const cgDiscipline = (cgCommand / 100) * config.warSupplyCaptainGeneralDisciplineFactor

      const hostilityGain =
        nextSupplyPressure * config.warSupplyPressureToHostilityFactor +
        enemyTerritoryHostilityGain +
        avgPopUnrest * config.warSupplyPopUnrestToHostilityFactor -
        friendlyTerritoryReduction -
        polityControlReduction -
        qmDiscipline -
        cgDiscipline

      const harshRequisitionHostilityGain = 0 // Phase 4
      const plunderHostilityGain = 0 // Phase 4
      const nextLocalHostility = clamp(
        prevLocalHostility -
          config.warSupplyLocalHostilityDecayPerWeek +
          hostilityGain +
          harshRequisitionHostilityGain +
          plunderHostilityGain,
        0,
        100,
      )

      // 9. plunderPressure update (accumulator, uses THIS week's supplyPressure and localHostility)
      const commandDisciplinePenalty = Math.max(
        0,
        config.warSupplyCommandDisciplineBase -
          (cgCommand / 100) * config.warSupplyCaptainGeneralDisciplineFactor -
          (qmScore / 100) * config.warSupplyQuartermasterDisciplineFactor,
      )
      const enemyTerritoryPlunderGain = friendly ? 0 : 1.0
      const plunderRelief = 0 // Phase 4
      const requisitionRelief = 0 // Phase 4

      const nextPlunderPressure = Math.max(
        0,
        prevPlunderPressure -
          config.warSupplyPlunderPressureDecayPerWeek +
          nextSupplyPressure * config.warSupplyPressureToPlunderFactor +
          nextLocalHostility * config.warSupplyHostilityToPlunderFactor +
          commandDisciplinePenalty +
          enemyTerritoryPlunderGain -
          plunderRelief -
          requisitionRelief,
      )

      // 10. Shortage band
      const band = computeShortageBand(nextSupplyPressure, config)

      // 11. Regiment attrition
      const orgDamage = config.warSupplyOrganizationDamageByBand[band]
      const moraleDamage = config.warSupplyMoraleDamageByBand[band]
      const strengthDamage = config.warSupplyStrengthDamageByBand[band]

      let totalStrengthDamage = 0
      let collapsedCount = 0

      if (band !== 'none') {
        for (const r of sideRegiments) {
          const rid = r.id
          const cavMult = r.troopKind === 'cavalry' ? config.cavalrySupplyAttritionMultiplier : 1
          const actualStrDmg = strengthDamage * cavMult
          const nextOrg = clamp(r.organization - orgDamage, 0, r.maxOrganization)
          const nextMorale = clamp(r.morale - moraleDamage, 0, r.maxMorale)
          const nextStrength = clamp(r.strength - actualStrDmg, 0, r.maxStrength)
          totalStrengthDamage += actualStrDmg

          updateRegimentMut(ws, rid, {
            organization: nextOrg,
            morale: nextMorale,
            strength: nextStrength,
          })
        }
      }

      // 12. Collapse risk (catastrophic only)
      if (band === 'catastrophic') {
        const pressureExcess = nextSupplyPressure - config.warSupplyPressureCatastrophicThreshold
        const collapseChance =
          config.warSupplyCatastrophicCollapseChanceBase +
          pressureExcess * config.warSupplyCatastrophicCollapsePressureFactor

        for (const r of sideRegiments) {
          if (r.status !== 'active') continue
          const rid = r.id
          const { value: roll, rng: nextRng } = randomFloat(next.rng)
          next = { ...next, rng: nextRng }
          if (roll < collapseChance) {
            destroyRegimentMut(ws, rid, absoluteWeek)
            collapsedCount++
          }
        }
      }

      // 13. SUPPLY_ATTRITION event (only for significant attrition)
      if (
        totalStrengthDamage >= config.warSupplyAttritionEventStrengthThreshold ||
        collapsedCount > 0
      ) {
        const messageParams: EventMessageParams = {
          warId: war.id,
          side: sideKey,
          supplyPressure: Math.round(nextSupplyPressure),
          strengthDamage: Math.round(totalStrengthDamage),
          organizationDamage: orgDamage,
          moraleDamage,
          collapsedRegimentCount: collapsedCount,
        }
        const refs: EventEntityRef[] = [
          entityRef('war', war.id, 'war'),
          entityRef('polity', primaryPolityId, sideKey),
        ]
        const importance = collapsedCount > 0 ? 'major' : 'normal'
        const { event, ctx: eventCtx } = createSimEvent(next, {
          type: 'SUPPLY_ATTRITION',
          importance,
          messageKey: 'supply.attrition',
          messageParams,
          entityRefs: refs,
        })
        next = { ...eventCtx, events: [...eventCtx.events, event] }
      }

      // 14. Write back supplyState
      const newState: WarSideSupplyState = {
        supplyAccess,
        supplyPressure: nextSupplyPressure,
        forageEfficiency,
        localHostility: nextLocalHostility,
        plunderPressure: nextPlunderPressure,
      }
      const sidePatch: Partial<WarSide> = {
        supplyState: newState,
        ...(strategistId !== undefined ? { strategistPersonId: strategistId } : {}),
        ...(quartermasterId !== undefined ? { quartermasterPersonId: quartermasterId } : {}),
      }
      updateWarSideMut(ws, wid, sideKey, sidePatch)
    }
  }

  return { ...next, state: ws }
}
