import type {
  PolityId,
  ProvinceId,
  StateRegionId,
  HoldingId,
  HoldingOfficeAssignmentId,
  HoldingImprovementId,
} from '../types/ids'
import type { SimError } from '../mutations/errors'
import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import { IMPROVEMENT_DEFINITIONS } from '../config/improvementDefinitions'
import { getHoldingOccupationCapacity } from '../selectors/popSelectors'
import type { HoldingImprovementKind } from '../types/holdingImprovement'
import { VALID_HOLDING_IMPROVEMENT_KINDS } from './integrityConstants'

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
    if (holding.landQuality <= 0) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Holding ${holding.id} landQuality=${holding.landQuality} must be > 0 (§18.3)`,
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

  // --- v0.33 §13.4: occupation capacity の健全性（NaN/Infinity/負を返さない、none=0） ---
  if (config) {
    const CAP_PAIRS = [
      ['peasants', 'agriculture'],
      ['townsmen', 'urban_labor'],
      ['nobles', 'elite_service'],
    ] as const
    for (const [holdingIdStr, holding] of Object.entries(state.holdings)) {
      if (!holding) continue
      const hid = holdingIdStr as HoldingId
      for (const [popClass, occupation] of CAP_PAIRS) {
        const cap = getHoldingOccupationCapacity(state, config, hid, popClass, occupation)
        if (!Number.isFinite(cap) || cap < 0) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `Holding ${holdingIdStr}: occupation capacity for ${occupation} is invalid (${cap}) (§13.4)`,
          })
        }
      }
      const noneCap = getHoldingOccupationCapacity(state, config, hid, 'peasants', 'none')
      if (noneCap !== 0) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Holding ${holdingIdStr}: occupation 'none' capacity must be 0 (got ${noneCap}) (§13.4)`,
        })
      }
    }
  }
}
