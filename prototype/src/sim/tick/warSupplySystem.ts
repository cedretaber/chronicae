import type { TickContext } from './context'
import type { WorldState } from '../types/world'
import type { WarId, CrisisId } from '../types/ids'
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
  isFriendlyTerritory,
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
import type { HoldingImprovementKind } from '../types/holdingImprovement'
import { damageHoldingImprovementConditionMut } from '../mutations/holdingImprovementMutations'
import {
  adjustHoldingPopNeedSatisfactionMut,
  adjustHoldingPopUnrestMut,
} from '../mutations/popMutations'
import { createCrisisMut, setCrisisSeverityMut } from '../mutations/crisisMutations'
import type { CreateCrisisInput } from '../mutations/crisisMutations'
import { resolveCrisisHandlers, createHandleCrisisProjectMut } from './crisisSystem'
import { holdingNameParam } from '../selectors/nameRefSelectors'

const PLUNDER_PRIORITY_BY_HOLDING_KIND: Record<string, readonly HoldingImprovementKind[]> = {
  manor: ['storage_infrastructure', 'irrigation_infrastructure', 'transport_infrastructure'],
  city: [
    'storage_infrastructure',
    'market_infrastructure',
    'workshop_infrastructure',
    'transport_infrastructure',
  ],
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
    crises: { ...ctx.state.crises },
    crisisIndex: {
      byHolding: { ...ctx.state.crisisIndex.byHolding },
      byProject: { ...ctx.state.crisisIndex.byProject },
    },
    projects: { ...ctx.state.projects },
    projectIndex: {
      byOwner: { ...ctx.state.projectIndex.byOwner },
      byAim: { ...ctx.state.projectIndex.byAim },
      byParentProject: { ...ctx.state.projectIndex.byParentProject },
      byCreatorPerson: { ...ctx.state.projectIndex.byCreatorPerson },
      bySupervisorPerson: { ...ctx.state.projectIndex.bySupervisorPerson },
      byRelatedEntity: { ...ctx.state.projectIndex.byRelatedEntity },
    },
    holdingImprovements: { ...ctx.state.holdingImprovements },
    holdingImprovementIndex: {
      byHolding: { ...ctx.state.holdingImprovementIndex.byHolding },
    },
    popGroups: { ...ctx.state.popGroups },
    popIndex: {
      byHolding: { ...ctx.state.popIndex.byHolding },
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
      let supplyRelief = 0 // Phase 4 will add plunder/requisition relief
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

      let harshRequisitionHostilityGain = 0 // Phase 4
      let plunderHostilityGain = 0 // Phase 4
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
      let plunderRelief = 0 // Phase 4
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

      // 12.5. Normal foraging condition damage (silent, primary holding only per §7.3)
      if (supplyDemand > 0 && provinceId !== undefined) {
        const province = ws.provinces[provinceId]
        if (province && province.holdingIds.length > 0) {
          const primaryHoldingId = [...province.holdingIds].sort()[0]!
          const conditionDrop =
            config.supplyForageConditionDrop *
            (nextSupplyPressure / 100) *
            (supplyDemand / 10) *
            (1 - qmScore / 200)
          if (conditionDrop > 0.5) {
            damageHoldingImprovementConditionMut(ws, primaryHoldingId, conditionDrop, [
              'storage_infrastructure',
            ])
          }
        }
      }

      // 12.6. Harsh requisition judgment
      if (nextSupplyPressure >= config.warSupplyHarshRequisitionPressureThreshold) {
        const harshChance =
          (nextSupplyPressure - config.warSupplyHarshRequisitionPressureThreshold) *
          config.warSupplyHarshRequisitionChanceFactor
        const { value: harshRoll, rng: harshRng } = randomFloat(next.rng)
        next = { ...next, rng: harshRng }
        if (harshRoll < harshChance) {
          const province = ws.provinces[provinceId]
          if (province) {
            const provinceHoldings = [...province.holdingIds].sort()
            if (provinceHoldings.length > 0) {
              const targetHoldingId = provinceHoldings[0]!
              const harshDrop = config.supplyHarshRequisitionConditionDrop
              damageHoldingImprovementConditionMut(ws, targetHoldingId, harshDrop, [
                'storage_infrastructure',
              ])
              adjustHoldingPopNeedSatisfactionMut(
                ws,
                targetHoldingId,
                -config.warSupplyHarshRequisitionPopWealthDamage,
              )
              adjustHoldingPopUnrestMut(
                ws,
                targetHoldingId,
                config.warSupplyHarshRequisitionPopUnrestGain,
              )
              harshRequisitionHostilityGain = config.warSupplyHarshRequisitionHostilityGain
              supplyRelief += config.warSupplyHarshRequisitionSupplyRelief

              // Spillover
              const { value: spilloverRoll, rng: spilloverRng } = randomFloat(next.rng)
              next = { ...next, rng: spilloverRng }
              if (spilloverRoll < config.warSupplyHarshRequisitionSpilloverChance) {
                const otherHoldings = provinceHoldings.filter((h) => h !== targetHoldingId)
                if (otherHoldings.length > 0) {
                  const spilloverTarget = otherHoldings[0]!
                  const spilloverDrop = harshDrop * config.supplySpilloverDamageMultiplier
                  damageHoldingImprovementConditionMut(ws, spilloverTarget, spilloverDrop, [
                    'storage_infrastructure',
                  ])
                  adjustHoldingPopNeedSatisfactionMut(
                    ws,
                    spilloverTarget,
                    -config.warSupplyHarshRequisitionPopWealthDamage,
                  )
                  adjustHoldingPopUnrestMut(
                    ws,
                    spilloverTarget,
                    config.warSupplyHarshRequisitionPopUnrestGain,
                  )
                }
              }

              // Emit SUPPLY_HARSH_REQUISITION event
              const { event: harshEvent, ctx: harshCtx } = createSimEvent(next, {
                type: 'SUPPLY_HARSH_REQUISITION',
                importance: 'normal',
                messageKey: 'supply.harsh_requisition',
                messageParams: {
                  warId: war.id,
                  side: sideKey,
                  holding: targetHoldingId,
                  conditionDrop: harshDrop,
                  wealthDelta: -config.warSupplyHarshRequisitionPopWealthDamage,
                  unrestDelta: config.warSupplyHarshRequisitionPopUnrestGain,
                  supplyPressureReduction: config.warSupplyHarshRequisitionSupplyRelief,
                },
                entityRefs: [
                  entityRef('war', war.id, 'war'),
                  entityRef('holding', targetHoldingId),
                  entityRef('polity', primaryPolityId, sideKey),
                ],
              })
              next = { ...harshCtx, events: [...harshCtx.events, harshEvent] }
            }
          }
        }
      }

      // 12.7. Plunder judgment
      if (nextPlunderPressure >= config.warSupplyPlunderPressureThreshold) {
        const plunderChance =
          (nextPlunderPressure - config.warSupplyPlunderPressureThreshold) *
          config.warSupplyPlunderChanceFactor
        const { value: plunderRoll, rng: plunderRng } = randomFloat(next.rng)
        next = { ...next, rng: plunderRng }
        if (plunderRoll < plunderChance) {
          const province = ws.provinces[provinceId]
          if (province) {
            const provinceHoldings = [...province.holdingIds].sort()
            if (provinceHoldings.length > 0) {
              const targetHoldingId = provinceHoldings[0]!
              const targetHolding = ws.holdings[targetHoldingId]
              const targetKinds = PLUNDER_PRIORITY_BY_HOLDING_KIND[targetHolding?.kind ?? ''] ?? []
              const plunderDrop = config.supplyPlunderConditionDrop
              damageHoldingImprovementConditionMut(ws, targetHoldingId, plunderDrop, targetKinds)
              adjustHoldingPopNeedSatisfactionMut(
                ws,
                targetHoldingId,
                -config.warSupplyPlunderPopWealthDamage,
              )
              adjustHoldingPopUnrestMut(ws, targetHoldingId, config.warSupplyPlunderPopUnrestGain)
              plunderHostilityGain = config.warSupplyPlunderHostilityGain
              supplyRelief += config.warSupplyPlunderSupplyRelief
              plunderRelief = config.warSupplyPlunderPressureRelief

              // Crisis: check existing war_damage, update or create
              const existingCrisisIds = ws.crisisIndex.byHolding[targetHoldingId as string] ?? []
              let existingWarDamage: CrisisId | undefined
              for (const cid of existingCrisisIds) {
                const c = ws.crises[cid]
                if (c && c.kind === 'war_damage' && c.status === 'active') {
                  existingWarDamage = cid
                  break
                }
              }
              if (existingWarDamage) {
                const existingCrisis = ws.crises[existingWarDamage]
                if (existingCrisis) {
                  const newSeverity = Math.min(
                    100,
                    existingCrisis.severity + config.crisisInitialSeverityByKind.war_damage,
                  )
                  setCrisisSeverityMut(ws, existingWarDamage, newSeverity)
                  ws.crises[existingWarDamage] = {
                    ...ws.crises[existingWarDamage]!,
                    deadlineWeek: absoluteWeek + config.crisisDeadlineWeeksByKind.war_damage,
                  }
                }
              } else {
                const ownerPolityId = getHoldingTerminalPolityId(ws, targetHoldingId)
                if (ownerPolityId) {
                  const crisisInput: CreateCrisisInput = {
                    kind: 'war_damage',
                    holdingId: targetHoldingId,
                    severity: config.crisisInitialSeverityByKind.war_damage,
                    createdWeek: absoluteWeek,
                    deadlineWeek: absoluteWeek + config.crisisDeadlineWeeksByKind.war_damage,
                    status: 'active',
                    reasonIds: [],
                  }
                  const crisis = createCrisisMut(ws, crisisInput)
                  const handlers = resolveCrisisHandlers(ws, config, targetHoldingId, ownerPolityId)
                  if (handlers) {
                    createHandleCrisisProjectMut(
                      ws,
                      config,
                      crisis,
                      ownerPolityId,
                      handlers.creatorId,
                      handlers.supervisorId,
                      absoluteWeek,
                    )
                  }
                  const { event: crisisEvt, ctx: crisisCtx } = createSimEvent(next, {
                    type: 'CRISIS_CREATED',
                    importance: 'minor',
                    messageKey: 'crisis.created',
                    messageParams: {
                      crisisKind: 'war_damage',
                      holding: holdingNameParam(ws, targetHoldingId),
                    },
                    entityRefs: [entityRef('holding', targetHoldingId, 'holding')],
                  })
                  next = { ...crisisCtx, events: [...crisisCtx.events, crisisEvt] }
                }
              }

              // Spillover
              const spilloverBaseChance =
                config.warSupplyPlunderSpilloverBaseChance +
                nextPlunderPressure * config.warSupplyPlunderSpilloverPressureFactor
              const maxSpillover = config.warSupplyMaxSpilloverHoldings
              const damagedHoldings = new Set([targetHoldingId])
              for (let i = 0; i < maxSpillover; i++) {
                const remaining = provinceHoldings.filter((h) => !damagedHoldings.has(h))
                if (remaining.length === 0) break
                const { value: spillRoll, rng: spillRng } = randomFloat(next.rng)
                next = { ...next, rng: spillRng }
                if (spillRoll < spilloverBaseChance) {
                  const spilloverTarget = remaining[0]!
                  damagedHoldings.add(spilloverTarget)
                  const spilloverDrop = plunderDrop * config.supplySpilloverDamageMultiplier
                  damageHoldingImprovementConditionMut(
                    ws,
                    spilloverTarget,
                    spilloverDrop,
                    targetKinds,
                  )
                  adjustHoldingPopNeedSatisfactionMut(
                    ws,
                    spilloverTarget,
                    -config.warSupplyPlunderPopWealthDamage,
                  )
                  adjustHoldingPopUnrestMut(
                    ws,
                    spilloverTarget,
                    config.warSupplyPlunderPopUnrestGain,
                  )
                }
              }

              const damagedKinds: string[] = targetKinds.slice()

              // Emit SUPPLY_PLUNDER event
              const { event: plunderEvent, ctx: plunderCtx } = createSimEvent(next, {
                type: 'SUPPLY_PLUNDER',
                importance: 'major',
                messageKey: 'supply.plunder',
                messageParams: {
                  warId: war.id,
                  side: sideKey,
                  holding: targetHoldingId,
                  damagedKinds: damagedKinds.join(', '),
                  conditionDrop: plunderDrop,
                  wealthDelta: -config.warSupplyPlunderPopWealthDamage,
                  unrestDelta: config.warSupplyPlunderPopUnrestGain,
                  supplyPressureReduction: config.warSupplyPlunderSupplyRelief,
                },
                entityRefs: [
                  entityRef('war', war.id, 'war'),
                  entityRef('holding', targetHoldingId),
                  entityRef('polity', primaryPolityId, sideKey),
                ],
              })
              next = { ...plunderCtx, events: [...plunderCtx.events, plunderEvent] }
            }
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

      // 14. Retroactive adjustments: apply relief/hostility from requisition/plunder
      const finalSupplyPressure = Math.max(0, nextSupplyPressure - supplyRelief)
      const finalLocalHostility = clamp(
        nextLocalHostility + harshRequisitionHostilityGain + plunderHostilityGain,
        0,
        100,
      )
      const finalPlunderPressure = Math.max(0, nextPlunderPressure - plunderRelief)

      const newState: WarSideSupplyState = {
        supplyAccess,
        supplyPressure: finalSupplyPressure,
        forageEfficiency,
        localHostility: finalLocalHostility,
        plunderPressure: finalPlunderPressure,
      }
      const sideObj = sideKey === 'attacker' ? ws.wars[wid]!.attacker : ws.wars[wid]!.defender
      const updatedSide: WarSide = { ...sideObj, supplyState: newState }
      if (strategistId !== undefined) {
        updatedSide.strategistPersonId = strategistId
      } else {
        delete updatedSide.strategistPersonId
      }
      if (quartermasterId !== undefined) {
        updatedSide.quartermasterPersonId = quartermasterId
      } else {
        delete updatedSide.quartermasterPersonId
      }
      const warObj = ws.wars[wid]!
      ws.wars[wid] = {
        ...warObj,
        [sideKey === 'attacker' ? 'attacker' : 'defender']: updatedSide,
      }
    }
  }

  return { ...next, state: ws }
}
