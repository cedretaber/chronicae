import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { LandContractId, PolityId } from '../types/ids'
import type { LandContractDefault } from '../types/landContractDefault'
import { WEEKS_PER_YEAR } from '../utils/timeUtils'

// index は active のみ保持するため、index 経由 getter は active entity のみ返す。

export function getActiveDefaultForContract(
  state: WorldState,
  contractId: LandContractId,
): LandContractDefault | undefined {
  const id = state.landContractDefaultIndex.byContract[contractId as string]
  if (!id) return undefined
  return state.landContractDefaults[id]
}

export function getActiveDefaultsForClaimantPolity(
  state: WorldState,
  polityId: PolityId,
): LandContractDefault[] {
  const ids = state.landContractDefaultIndex.byClaimantPolity[polityId as string] ?? []
  const result: LandContractDefault[] = []
  for (const id of ids) {
    const d = state.landContractDefaults[id]
    if (d) result.push(d)
  }
  return result
}

export function getActiveDefaultsForOccupierPolity(
  state: WorldState,
  polityId: PolityId,
): LandContractDefault[] {
  const ids = state.landContractDefaultIndex.byOccupierPolity[polityId as string] ?? []
  const result: LandContractDefault[] = []
  for (const id of ids) {
    const d = state.landContractDefaults[id]
    if (d) result.push(d)
  }
  return result
}

// 時効までの残り週数。lastContestedWeek 方式 (§13.2)。0 以下なら時効到達。
function getDefaultPrescriptionRemainingWeeks(
  state: WorldState,
  config: SimulationConfig,
  d: LandContractDefault,
): number {
  const baseWeek = d.lastContestedWeek ?? d.startedWeek
  const elapsed = state.absoluteWeek - baseWeek
  return config.landContractDefaultPrescriptionYears * WEEKS_PER_YEAR - elapsed
}

export function getDefaultPrescriptionRemainingYears(
  state: WorldState,
  config: SimulationConfig,
  d: LandContractDefault,
): number {
  return Math.max(0, getDefaultPrescriptionRemainingWeeks(state, config, d) / WEEKS_PER_YEAR)
}
