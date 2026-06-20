import type { WorldState } from '../types/world'
import type { PolityId } from '../types/ids'
import type { Pressure } from '../types/pressure'
import type { Crisis } from '../types/crisis'
import { decisionSubjectKey } from '../types/goal'

// この Polity が target になっている active Pressure (外圧)。
export function getActivePressuresForPolity(state: WorldState, polityId: PolityId): Pressure[] {
  const key = decisionSubjectKey({ kind: 'polity', id: polityId })
  const ids = state.pressureIndex.byTarget[key] ?? []
  const result: Pressure[] = []
  for (const id of ids) {
    const p = state.pressures[id]
    if (p && p.status === 'active') result.push(p)
  }
  return result
}

// この Polity が terminal (実効支配) の holding で進行中の active Crisis。
//   crisis は holding 単位 (owner は live 解決) なので、polity の terminal 契約の holding を走査する。
export function getActiveCrisesForPolity(state: WorldState, polityId: PolityId): Crisis[] {
  const contractIds = state.landContractIndex.byGranteePolity[polityId] ?? []
  const seen = new Set<string>()
  const result: Crisis[] = []
  for (const cid of contractIds) {
    const c = state.landContracts[cid]
    if (!c || c.holdingId === undefined) continue
    // byParent[c.id] が無い = 子契約なし = この Polity が terminal (実効支配)。
    if (state.landContractIndex.byParent[c.id] !== undefined) continue
    const crisisIds = state.crisisIndex.byHolding[c.holdingId] ?? []
    for (const crid of crisisIds) {
      if (seen.has(crid)) continue
      const crisis = state.crises[crid]
      if (crisis && crisis.status === 'active') {
        seen.add(crid)
        result.push(crisis)
      }
    }
  }
  return result
}
