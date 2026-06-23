import type {
  PolityId,
  ProvinceId,
  StateRegionId,
  HoldingId,
  HoldingOfficeAssignmentId,
  HoldingImprovementId,
  RealEstateAssetId,
  RealEstateSeizureId,
  ProductionRecipeId,
} from '../types/ids'
import type { SimError } from '../mutations/errors'
import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import { IMPROVEMENT_DEFINITIONS } from '../config/improvementDefinitions'
import { REAL_ESTATE_DEFINITIONS } from '../config/realEstateDefinitions'
import { PRODUCTION_RECIPE_DEFINITIONS } from '../config/productionRecipeDefinitions'
import { assertArrayIndexMatches } from './integrityIndexHelpers'
import { getHoldingClassCapacity } from '../selectors/popSelectors'
import type { HoldingImprovementKind } from '../types/holdingImprovement'
import { VALID_HOLDING_IMPROVEMENT_KINDS } from './integrityConstants'
import { assetOwnerKey } from '../types/realEstateAsset'

export function checkGeographyAndHoldings(
  state: WorldState,
  errors: SimError[],
  debug: boolean,
  config: SimulationConfig | undefined,
): void {
  // ─── State-Province consistency checks (v0.20-a) ───

  // S1: Every Province.stateId points to an existing StateRegion
  for (const provIdStr of Object.keys(state.provinces)) {
    const prov = state.provinces[provIdStr as ProvinceId]
    if (!prov) continue
    if (!state.states[prov.stateId]) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Province ${provIdStr} has stateId=${prov.stateId as string} which does not exist in states`,
      })
    }
  }

  // S2: Every StateRegion.provinceIds entry points to existing Province with matching stateId
  for (const stateIdStr of Object.keys(state.states)) {
    const stateRegion = state.states[stateIdStr as StateRegionId]
    if (!stateRegion) continue
    if (stateRegion.provinceIds.length === 0) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `StateRegion ${stateIdStr} has no provinces`,
      })
    }
    for (const pid of stateRegion.provinceIds) {
      const prov = state.provinces[pid]
      if (!prov) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `StateRegion ${stateIdStr} references non-existent Province ${pid as string}`,
        })
      } else if ((prov.stateId as string) !== (stateRegion.id as string)) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `StateRegion ${stateIdStr} contains Province ${pid as string} whose stateId=${prov.stateId as string} does not match`,
        })
      }
    }
  }

  // S3: Every Province is in exactly one State's provinceIds (no orphans, no duplicates)
  {
    const provincesInStates = new Set<string>()
    for (const stateRegion of Object.values(state.states)) {
      if (!stateRegion) continue
      for (const pid of stateRegion.provinceIds) {
        if (provincesInStates.has(pid)) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `Province ${pid} appears in multiple StateRegions`,
          })
        }
        provincesInStates.add(pid)
      }
    }
    for (const provIdStr of Object.keys(state.provinces)) {
      if (!provincesInStates.has(provIdStr)) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Province ${provIdStr} is not in any StateRegion.provinceIds`,
        })
      }
    }
  }

  // S4: Province.neighbors must be bidirectional
  for (const prov of Object.values(state.provinces)) {
    if (!prov) continue
    for (const nid of prov.neighbors) {
      const neighbor = state.provinces[nid]
      if (!neighbor) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Province ${prov.id} has neighbor ${nid as string} which does not exist`,
        })
        continue
      }
      if (!neighbor.neighbors.includes(prov.id)) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Province ${prov.id} has neighbor ${nid as string} but the reverse is missing`,
        })
      }
    }
    if (prov.neighbors.includes(prov.id)) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Province ${prov.id} has itself as a neighbor`,
      })
    }
    if (prov.neighbors.length === 0) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Province ${prov.id} has no neighbors (isolated)`,
      })
    }
  }

  // H0: Every Province must have at least one Holding
  for (const province of Object.values(state.provinces)) {
    if (!province) continue
    if (province.holdingIds.length === 0) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Province ${province.id} has no Holdings`,
      })
    }
  }

  // H1: Every Province.holdingIds entry exists in state.holdings with matching provinceId
  for (const province of Object.values(state.provinces)) {
    if (!province) continue
    for (const hid of province.holdingIds) {
      const holding = state.holdings[hid]
      if (!holding) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Province ${province.id} references missing Holding ${hid}`,
        })
      } else if (holding.provinceId !== province.id) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Province ${province.id} lists Holding ${hid}, but Holding.provinceId is ${holding.provinceId}`,
        })
      }
    }
  }

  // H2: Every Holding.provinceId points to an existing Province that lists this Holding
  for (const holding of Object.values(state.holdings)) {
    if (!holding) continue
    const province = state.provinces[holding.provinceId]
    if (!province) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Holding ${holding.id} references missing Province ${holding.provinceId}`,
      })
    } else if (!province.holdingIds.includes(holding.id)) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Holding ${holding.id} belongs to Province ${holding.provinceId} but is not in holdingIds`,
      })
    }
  }

  // H3: holdingTerminalPolityCache consistent with per-Holding byHolding chain terminal
  for (const holding of Object.values(state.holdings)) {
    if (!holding) continue
    const holdingTerminal = state.holdingTerminalPolityCache[holding.id]
    const chain = state.landContractIndex.byHolding[holding.id] ?? []
    const terminalContractId = chain[chain.length - 1]
    const terminalContract = terminalContractId
      ? state.landContracts[terminalContractId]
      : undefined
    const expectedPolity = terminalContract?.granteePolityId
    if (holdingTerminal !== expectedPolity) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Holding ${holding.id} holdingTerminalPolityCache (${holdingTerminal}) != byHolding chain terminal grantee (${expectedPolity}) for province ${holding.provinceId}`,
      })
    }
  }

  // H4: Holding field range checks (§18.3)
  for (const holding of Object.values(state.holdings)) {
    if (!holding) continue
    if (holding.polityControl < 0 || holding.polityControl > 100) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Holding ${holding.id} polityControl=${holding.polityControl} out of range [0,100] (§18.3)`,
      })
    }
    if (holding.weight <= 0) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Holding ${holding.id} weight=${holding.weight} must be > 0 (§18.3)`,
      })
    }
    if (holding.kind !== 'manor' && holding.kind !== 'city') {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Holding ${holding.id} kind=${String(holding.kind)} must be 'manor' or 'city' (§18.3)`,
      })
    }
    // H7 (v0.41 §9.1): every Holding has a non-empty nameKey
    if (typeof holding.nameKey !== 'string' || holding.nameKey.length === 0) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Holding ${holding.id} has empty nameKey (§9.1 H7)`,
      })
    }
  }

  // H8 (v0.41 §9.2): Holding.nameKey unique within each Province
  // (Province 名との衝突・異 Province 間重複は許容)
  for (const province of Object.values(state.provinces)) {
    if (!province) continue
    const seen = new Set<string>()
    for (const hid of province.holdingIds) {
      const holding = state.holdings[hid]
      if (!holding) continue
      if (seen.has(holding.nameKey)) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Province ${province.id} has duplicate Holding nameKey '${holding.nameKey}' (§9.2 H8)`,
        })
      }
      seen.add(holding.nameKey)
    }
  }

  // P-name (v0.41 §9.3): Polity.nameSource validity
  for (const polity of Object.values(state.polities)) {
    if (!polity) continue
    const ns = polity.nameSource
    switch (ns.kind) {
      case 'pool':
        if (typeof ns.nameKey !== 'string' || ns.nameKey.length === 0) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `Polity ${polity.id} nameSource(pool) has empty nameKey (§9.3 P-name)`,
          })
        }
        break
      case 'holding':
        if (!state.holdings[ns.holdingId]) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `Polity ${polity.id} nameSource(holding) references missing Holding ${ns.holdingId} (§9.3 P-name)`,
          })
        }
        break
    }
  }

  // H5: HoldingOffice integrity (§18.5)
  for (const holdingIdStr of Object.keys(state.holdings)) {
    const hid = holdingIdStr as HoldingId
    const assignmentId = state.holdingOfficeIndex.byHolding[hid]
    if (!assignmentId) continue
    const assignment = state.holdingOfficeAssignments[assignmentId]
    if (!assignment) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `holdingOfficeIndex.byHolding[${hid}] references missing assignment ${assignmentId as string} (§18.5)`,
      })
      continue
    }
    if (!assignment.active) continue
    if (assignment.holdingId !== hid) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `HoldingOfficeAssignment ${assignmentId as string} holdingId=${assignment.holdingId as string} != indexed holding ${hid} (§18.5)`,
      })
    }
    const holder = state.persons[assignment.holderPersonId]
    if (!holder) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `HoldingOfficeAssignment ${assignmentId as string} holderPersonId=${assignment.holderPersonId as string} does not exist (§18.5)`,
      })
    }
    const terminalPolityId = state.holdingTerminalPolityCache[hid]
    if (
      terminalPolityId &&
      (assignment.appointingPolityId as string) !== (terminalPolityId as string)
    ) {
      if (debug) {
        console.warn(
          `INTEGRITY (§18.5 warn): HoldingOfficeAssignment ${assignmentId as string} appointingPolityId=${assignment.appointingPolityId as string} != terminal polity ${terminalPolityId as string} for holding ${hid}`,
        )
      }
    }
  }

  // H6: holdingOfficeIndex.byAppointingPolity consistency (§18.5)
  for (const polityIdStr of Object.keys(state.holdingOfficeIndex.byAppointingPolity)) {
    const polityId = polityIdStr as PolityId
    const hoaIds = state.holdingOfficeIndex.byAppointingPolity[polityId] ?? []
    for (const hoaId of hoaIds) {
      const hoa = state.holdingOfficeAssignments[hoaId]
      if (!hoa) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `holdingOfficeIndex.byAppointingPolity[${polityIdStr}] references missing assignment ${hoaId as string} (§18.5)`,
        })
      }
    }
  }

  // --- v0.25 §17.1: HoldingOfficeAssignment extended checks ---
  {
    const activeHoldingsByPerson: Record<string, HoldingOfficeAssignmentId[]> = {}
    const activeHoldingsByHolding: Record<string, HoldingOfficeAssignmentId[]> = {}

    for (const hoaIdStr of Object.keys(state.holdingOfficeAssignments)) {
      const hoaId = hoaIdStr as HoldingOfficeAssignmentId
      const hoa = state.holdingOfficeAssignments[hoaId]
      if (!hoa || !hoa.active) continue

      const holder = state.persons[hoa.holderPersonId]
      if (holder && !holder.alive && holder.kind !== 'placeholder') {
        if (debug) {
          console.warn(
            `INTEGRITY (§17.1 warn): HoldingOfficeAssignment ${hoaIdStr}: holder ${hoa.holderPersonId as string} is dead non-placeholder (transient: awaiting bailiffAppointmentSystem cleanup)`,
          )
        }
      }

      if (hoa.contractedRemittanceRate < 0 || hoa.contractedRemittanceRate > 1) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `HoldingOfficeAssignment ${hoaIdStr}: contractedRemittanceRate=${hoa.contractedRemittanceRate} outside [0, 1] (§17.1)`,
        })
      }
      if (hoa.expectedFeeRate < 0 || hoa.expectedFeeRate > 1) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `HoldingOfficeAssignment ${hoaIdStr}: expectedFeeRate=${hoa.expectedFeeRate} outside [0, 1] (§17.1)`,
        })
      }
      if (
        config &&
        hoa.contractedRemittanceRate + hoa.expectedFeeRate > config.maxLocalExtractionRate * 1.1
      ) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `HoldingOfficeAssignment ${hoaIdStr}: contractedRemittanceRate+expectedFeeRate=${(hoa.contractedRemittanceRate + hoa.expectedFeeRate).toFixed(3)} exceeds maxLocalExtractionRate*1.1=${(config.maxLocalExtractionRate * 1.1).toFixed(3)} (§17.1)`,
        })
      }

      const holdingKey = hoa.holdingId as string
      const holdingList = activeHoldingsByHolding[holdingKey] ?? []
      holdingList.push(hoaId)
      activeHoldingsByHolding[holdingKey] = holdingList

      if (holder && holder.kind !== 'placeholder') {
        const personKey = hoa.holderPersonId as string
        const personList = activeHoldingsByPerson[personKey] ?? []
        personList.push(hoaId)
        activeHoldingsByPerson[personKey] = personList
      }
    }

    for (const [holdingKey, hoaIds] of Object.entries(activeHoldingsByHolding)) {
      if (hoaIds.length > 1) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Holding ${holdingKey} has ${hoaIds.length} active bailiff assignments (§17.1)`,
        })
      }
    }

    for (const [personKey, hoaIds] of Object.entries(activeHoldingsByPerson)) {
      if (hoaIds.length > 1) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Normal person ${personKey} has ${hoaIds.length} active bailiff assignments (§17.1 no concurrency)`,
        })
      }
    }
  }

  // --- v0.27 §19.1: HoldingImprovement checks ---
  {
    const seenHoldingKindPairs = new Set<string>()
    const improvementsByHolding: Record<string, HoldingImprovementId[]> = {}

    for (const [idStr, imp] of Object.entries(state.holdingImprovements)) {
      if (!imp) continue
      const impId = idStr as HoldingImprovementId

      if (!idStr.startsWith('hi-')) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `HoldingImprovement ${idStr}: id does not start with 'hi-' (§19.1)`,
        })
      }

      const holding = state.holdings[imp.holdingId]
      if (!holding) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `HoldingImprovement ${idStr}: holdingId ${imp.holdingId as string} does not exist (§19.1)`,
        })
      }

      if (!VALID_HOLDING_IMPROVEMENT_KINDS.has(imp.kind)) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `HoldingImprovement ${idStr}: kind=${imp.kind} is not valid (§19.1)`,
        })
      }

      if (imp.level < 1) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `HoldingImprovement ${idStr}: level=${imp.level} must be >= 1 (§19.1)`,
        })
      }

      if (holding && config) {
        // v0.33 §13.2: access 反転 [kind][holdingKind] ?? 0。0（未定義含む）= 建設不可なので
        // level >= 1 の improvement が存在する時点で違反（imp.level > maxLevel で両ケースを表現）。
        const maxLevel = config.holdingImprovementMaxLevelByKind[imp.kind][holding.kind] ?? 0
        if (imp.level > maxLevel) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `HoldingImprovement ${idStr}: level=${imp.level} exceeds max ${maxLevel} for ${holding.kind}/${imp.kind} (§19.1)`,
          })
        }
      }

      if (imp.condition < 0 || imp.condition > 100) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `HoldingImprovement ${idStr}: condition=${imp.condition} outside [0, 100] (§19.1)`,
        })
      }

      const pairKey = `${imp.holdingId as string}:${imp.kind}`
      if (seenHoldingKindPairs.has(pairKey)) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `HoldingImprovement ${idStr}: duplicate holdingId+kind pair ${pairKey} (§19.1)`,
        })
      }
      seenHoldingKindPairs.add(pairKey)

      const holdingKey = imp.holdingId as string
      const list = improvementsByHolding[holdingKey] ?? []
      list.push(impId)
      improvementsByHolding[holdingKey] = list
    }

    for (const [holdingKey, indexedIds] of Object.entries(
      state.holdingImprovementIndex.byHolding,
    )) {
      if (!indexedIds) continue
      const actualIds = improvementsByHolding[holdingKey] ?? []
      const indexedSet = new Set(indexedIds.map((id) => id as string))
      const actualSet = new Set(actualIds.map((id) => id as string))

      for (const id of indexedIds) {
        if (!actualSet.has(id)) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `holdingImprovementIndex.byHolding[${holdingKey}] contains ${id} which does not exist or has wrong holdingId (§19.1)`,
          })
        }
      }
      for (const id of actualIds) {
        if (!indexedSet.has(id)) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `HoldingImprovement ${id} belongs to holding ${holdingKey} but is not in holdingImprovementIndex.byHolding (§19.1)`,
          })
        }
      }
    }

    for (const [holdingKey, actualIds] of Object.entries(improvementsByHolding)) {
      if (!(holdingKey in state.holdingImprovementIndex.byHolding)) {
        for (const id of actualIds) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `HoldingImprovement ${id as string} belongs to holding ${holdingKey} but holdingImprovementIndex.byHolding has no entry (§19.1)`,
          })
        }
      }
    }
  }

  // --- v0.33 §13.3: IMPROVEMENT_DEFINITIONS / config 整合（const を回すのみ・低コスト） ---
  if (config) {
    const HOLDING_KINDS = ['manor', 'city'] as const
    for (const kind of Object.keys(IMPROVEMENT_DEFINITIONS) as HoldingImprovementKind[]) {
      const def = IMPROVEMENT_DEFINITIONS[kind]
      for (const hk of HOLDING_KINDS) {
        const maxLevel = config.holdingImprovementMaxLevelByKind[kind][hk]
        const allowed = def.allowedHoldingKinds.includes(hk)
        if (maxLevel !== undefined && maxLevel < 0) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `IMPROVEMENT config: maxLevel for ${kind}/${hk} is negative (${maxLevel}) (§13.3)`,
          })
        }
        // allowedHoldingKinds に含まれる holdingKind は maxLevel >= 1
        if (allowed && (maxLevel === undefined || maxLevel < 1)) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `IMPROVEMENT config: ${kind} allowed for ${hk} but maxLevel=${maxLevel ?? 'undefined'} (<1) (§13.3)`,
          })
        }
        // allowedHoldingKinds に含まれない holdingKind は maxLevel が undefined または 0
        if (!allowed && maxLevel !== undefined && maxLevel > 0) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `IMPROVEMENT config: ${kind} not allowed for ${hk} but maxLevel=${maxLevel} (>0) (§13.3)`,
          })
        }
      }
      // v0.52: HoldingImprovement は全て production_quality (infrastructure) に移行。
      // capacity を直接生む improvement は無い (RealEstateAsset が担う)。
    }
  }

  // --- v0.52: critical infrastructure 存在保証 (manor → manor_house, city → town_hall) ---
  {
    const criticalByHolding: Record<string, { manor_house: boolean; town_hall: boolean }> = {}
    for (const [, imp] of Object.entries(state.holdingImprovements)) {
      if (!imp) continue
      if (imp.kind === 'manor_house' || imp.kind === 'town_hall') {
        const entry = (criticalByHolding[imp.holdingId as string] ??= {
          manor_house: false,
          town_hall: false,
        })
        entry[imp.kind] = true
      }
    }
    for (const [, holding] of Object.entries(state.holdings)) {
      if (!holding) continue
      const entry = criticalByHolding[holding.id as string]
      if (holding.kind === 'manor' && !entry?.manor_house) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Holding ${holding.id}: manor must have manor_house infrastructure (v0.52 critical)`,
        })
      }
      if (holding.kind === 'city' && !entry?.town_hall) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Holding ${holding.id}: city must have town_hall infrastructure (v0.52 critical)`,
        })
      }
    }
  }

  // --- v0.52: RealEstateAsset integrity checks ---
  {
    const byHoldingRebuilt: Record<string, RealEstateAssetId[]> = {}
    const byOwnerRebuilt: Record<string, RealEstateAssetId[]> = {}

    for (const [assetIdStr, asset] of Object.entries(state.realEstateAssets)) {
      if (!asset) continue
      const assetId = assetIdStr as RealEstateAssetId

      if (!(assetId as string).startsWith('re-')) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `RealEstateAsset ${assetIdStr}: id must start with re-`,
        })
      }

      if (!state.holdings[asset.holdingId]) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `RealEstateAsset ${assetIdStr}: holdingId=${asset.holdingId as string} does not exist`,
        })
      }

      const def = REAL_ESTATE_DEFINITIONS[asset.realEstateKind]
      if (!def) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `RealEstateAsset ${assetIdStr}: unknown realEstateKind=${asset.realEstateKind}`,
        })
      }

      if (asset.level < 1) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `RealEstateAsset ${assetIdStr}: level=${asset.level} must be >= 1`,
        })
      }

      if (def) {
        const holding = state.holdings[asset.holdingId]
        if (holding) {
          const maxLevel = def.maxLevelByHoldingKind[holding.kind]
          if (maxLevel !== undefined && asset.level > maxLevel) {
            errors.push({
              code: 'INTEGRITY_VIOLATION',
              message: `RealEstateAsset ${assetIdStr}: level=${asset.level} exceeds maxLevel=${maxLevel} for ${holding.kind}`,
            })
          }
          if (!def.allowedHoldingKinds.includes(holding.kind)) {
            errors.push({
              code: 'INTEGRITY_VIOLATION',
              message: `RealEstateAsset ${assetIdStr}: kind=${asset.realEstateKind} not allowed in ${holding.kind}`,
            })
          }
        }
      }

      // v0.54 §21.1: recipeSlots invariant
      {
        let slotTotal = 0
        for (const [recipeIdStr, slotCount] of Object.entries(asset.recipeSlots)) {
          if (slotCount === undefined) continue
          if (!Number.isInteger(slotCount) || slotCount < 0) {
            errors.push({
              code: 'INTEGRITY_VIOLATION',
              message: `RealEstateAsset ${assetIdStr}: recipeSlots[${recipeIdStr}]=${slotCount} must be a non-negative integer`,
            })
          }
          slotTotal += slotCount
          const recipe = PRODUCTION_RECIPE_DEFINITIONS[recipeIdStr as ProductionRecipeId]
          if (!recipe) {
            errors.push({
              code: 'INTEGRITY_VIOLATION',
              message: `RealEstateAsset ${assetIdStr}: recipeSlots references unknown recipe ${recipeIdStr}`,
            })
          } else if (!recipe.allowedRealEstateKinds.includes(asset.realEstateKind)) {
            errors.push({
              code: 'INTEGRITY_VIOLATION',
              message: `RealEstateAsset ${assetIdStr}: recipe ${recipeIdStr} not allowed for kind=${asset.realEstateKind}`,
            })
          }
        }
        if (config && slotTotal !== config.realEstateRecipeSlotCount) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `RealEstateAsset ${assetIdStr}: recipeSlots total=${slotTotal} must equal realEstateRecipeSlotCount=${config.realEstateRecipeSlotCount}`,
          })
        }
      }

      if (asset.owner) {
        switch (asset.owner.kind) {
          case 'person': {
            const person = state.persons[asset.owner.id]
            if (!person) {
              errors.push({
                code: 'INTEGRITY_VIOLATION',
                message: `RealEstateAsset ${assetIdStr}: owner person ${asset.owner.id as string} does not exist`,
              })
            }
            break
          }
          case 'house': {
            const house = state.houses[asset.owner.id]
            if (!house) {
              errors.push({
                code: 'INTEGRITY_VIOLATION',
                message: `RealEstateAsset ${assetIdStr}: owner house ${asset.owner.id as string} does not exist`,
              })
            }
            break
          }
          case 'polity': {
            const polity = state.polities[asset.owner.id]
            if (!polity) {
              errors.push({
                code: 'INTEGRITY_VIOLATION',
                message: `RealEstateAsset ${assetIdStr}: owner polity ${asset.owner.id as string} does not exist`,
              })
            }
            break
          }
        }
      }

      const holdingKey = asset.holdingId as string
      ;(byHoldingRebuilt[holdingKey] ??= []).push(assetId)

      if (asset.owner) {
        const ownerK = assetOwnerKey(asset.owner)
        ;(byOwnerRebuilt[ownerK] ??= []).push(assetId)
      }
    }

    const idx = state.realEstateAssetIndex
    for (const [key, ids] of Object.entries(idx.byHolding)) {
      const expected = byHoldingRebuilt[key]
      if (!expected) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `realEstateAssetIndex.byHolding[${key}] has ${(ids ?? []).length} entries but no assets exist for this holding`,
        })
      } else if (ids && ids.length !== expected.length) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `realEstateAssetIndex.byHolding[${key}] has ${ids.length} entries but expected ${expected.length}`,
        })
      }
    }
    for (const [key, expected] of Object.entries(byHoldingRebuilt)) {
      if (!idx.byHolding[key]) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `realEstateAssetIndex.byHolding missing key ${key} (${expected.length} assets)`,
        })
      }
    }

    for (const [key, ids] of Object.entries(idx.byOwner)) {
      const expected = byOwnerRebuilt[key]
      if (!expected) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `realEstateAssetIndex.byOwner[${key}] has ${(ids ?? []).length} entries but no owned assets exist for this owner`,
        })
      } else if (ids && ids.length !== expected.length) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `realEstateAssetIndex.byOwner[${key}] has ${ids.length} entries but expected ${expected.length}`,
        })
      }
    }
    for (const [key, expected] of Object.entries(byOwnerRebuilt)) {
      if (!idx.byOwner[key]) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `realEstateAssetIndex.byOwner missing key ${key} (${expected.length} assets)`,
        })
      }
    }
  }

  // --- v0.53: RealEstateSeizure integrity checks (spec §18.1) ---
  {
    const byHoldingRebuilt: Record<string, RealEstateSeizureId[]> = {}
    const byAssetRebuilt: Record<string, RealEstateSeizureId> = {}
    const byOwnerHouseRebuilt: Record<string, RealEstateSeizureId[]> = {}

    for (const [idStr, seizure] of Object.entries(state.realEstateSeizures)) {
      if (!seizure) continue
      const id = idStr as RealEstateSeizureId

      // [全 entity]
      if (!(id as string).startsWith('rs-')) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `RealEstateSeizure ${idStr}: id must start with rs-`,
        })
      }
      if (seizure.rightfulOwner.kind !== 'house') {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `RealEstateSeizure ${idStr}: rightfulOwner must be a house in Phase 1`,
        })
      }
      if (seizure.startedWeek > state.absoluteWeek) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `RealEstateSeizure ${idStr}: startedWeek ${seizure.startedWeek} > absoluteWeek ${state.absoluteWeek}`,
        })
      }
      if (
        seizure.lastContestedWeek !== undefined &&
        (seizure.lastContestedWeek < seizure.startedWeek ||
          seizure.lastContestedWeek > state.absoluteWeek)
      ) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `RealEstateSeizure ${idStr}: lastContestedWeek ${seizure.lastContestedWeek} outside [startedWeek, absoluteWeek]`,
        })
      }
      if (seizure.accumulatedUnpaidAmount < 0) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `RealEstateSeizure ${idStr}: accumulatedUnpaidAmount ${seizure.accumulatedUnpaidAmount} < 0`,
        })
      }

      // [active のみ] FK 存在検査 (terminal/retained は cancel 原因で dangling 許容, A2)
      if (seizure.status === 'active') {
        const holding = state.holdings[seizure.holdingId]
        if (!holding) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `RealEstateSeizure ${idStr}: holdingId ${seizure.holdingId as string} does not exist`,
          })
        }
        const asset = state.realEstateAssets[seizure.assetId]
        if (!asset) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `RealEstateSeizure ${idStr}: assetId ${seizure.assetId as string} does not exist`,
          })
        } else if ((asset.holdingId as string) !== (seizure.holdingId as string)) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `RealEstateSeizure ${idStr}: asset.holdingId ${asset.holdingId as string} !== seizure.holdingId ${seizure.holdingId as string}`,
          })
        }
        if (!state.polities[seizure.seizerPolityId]) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `RealEstateSeizure ${idStr}: seizerPolityId ${seizure.seizerPolityId as string} does not exist`,
          })
        }
        if (seizure.rightfulOwner.kind === 'house' && !state.houses[seizure.rightfulOwner.id]) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `RealEstateSeizure ${idStr}: rightfulOwner house ${seizure.rightfulOwner.id as string} does not exist`,
          })
        }
        // active seizure は同一 asset に最大 1
        if (byAssetRebuilt[seizure.assetId as string]) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `RealEstateSeizure ${idStr}: asset ${seizure.assetId as string} has more than one active seizure`,
          })
        }
        byAssetRebuilt[seizure.assetId as string] = id
        byHoldingRebuilt[seizure.holdingId as string] = [
          ...(byHoldingRebuilt[seizure.holdingId as string] ?? []),
          id,
        ]
        if (seizure.rightfulOwner.kind === 'house') {
          const hk = seizure.rightfulOwner.id as string
          byOwnerHouseRebuilt[hk] = [...(byOwnerHouseRebuilt[hk] ?? []), id]
        }
      }
    }

    // index は active entity のみを保持する (B7)。byAsset を rebuilt と照合。
    const idx = state.realEstateSeizureIndex
    for (const [key, id] of Object.entries(idx.byAsset)) {
      if (byAssetRebuilt[key] !== id) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `realEstateSeizureIndex.byAsset[${key}]=${id as string} does not match active seizures`,
        })
      }
    }
    for (const key of Object.keys(byAssetRebuilt)) {
      if (idx.byAsset[key] === undefined) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `realEstateSeizureIndex.byAsset missing key ${key}`,
        })
      }
    }
    // 配列 index (byHolding / byRightfulOwnerHouse) を set 比較で照合する (§18.1)
    assertArrayIndexMatches(
      errors,
      'realEstateSeizureIndex.byHolding',
      idx.byHolding,
      byHoldingRebuilt,
    )
    assertArrayIndexMatches(
      errors,
      'realEstateSeizureIndex.byRightfulOwnerHouse',
      idx.byRightfulOwnerHouse,
      byOwnerHouseRebuilt,
    )
  }

  // --- v0.33 §13.4: class capacity の健全性（NaN/Infinity/負を返さない） ---
  if (config) {
    const POP_CLASSES = ['lower', 'middle', 'upper'] as const
    for (const [holdingIdStr, holding] of Object.entries(state.holdings)) {
      if (!holding) continue
      const hid = holdingIdStr as HoldingId
      for (const popClass of POP_CLASSES) {
        const cap = getHoldingClassCapacity(state, config, hid, popClass)
        if (!Number.isFinite(cap) || cap < 0) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `Holding ${holdingIdStr}: class capacity for ${popClass} is invalid (${cap})`,
          })
        }
      }
    }
  }
}
