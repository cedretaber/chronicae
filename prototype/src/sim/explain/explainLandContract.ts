import type { WorldState } from '../types/world'
import type { LandContractId } from '../types/ids'
import type { EventReason, EventEffect } from '../types/event'
import { getProvinceLandContractChain } from '../selectors/landContractSelectors'

export type LandContractChangeKind =
  | 'granted'
  | 'transferred'
  | 'inserted'
  | 'replaced'
  | 'tax_changed'
  | 'revoked'

export function explainLandContract(
  state: WorldState,
  contractId: LandContractId,
  kind: LandContractChangeKind,
): { reasons: EventReason[]; effects: EventEffect[] } {
  const contract = state.landContracts[contractId]
  if (!contract) return { reasons: [], effects: [] }

  const reasons: EventReason[] = []
  const effects: EventEffect[] = []

  const chain = getProvinceLandContractChain(state, contract.provinceId)
  const chainDepth = chain.length
  reasons.push({
    label: 'Chain depth',
    value: chainDepth,
  })

  const grantee = state.polities[contract.granteePolityId]
  if (grantee) {
    reasons.push({
      label: 'Grantee Polity rank',
      value: grantee.rank,
    })
  }

  reasons.push({
    label: 'taxRateToGrantor',
    value: contract.terms.taxRateToGrantor,
  })

  switch (kind) {
    case 'granted':
      effects.push({ label: 'New contract created' })
      break
    case 'transferred':
      effects.push({ label: 'Grantee Polity replaced' })
      break
    case 'inserted':
      effects.push({ label: 'Intermediate contract inserted' })
      break
    case 'replaced':
      effects.push({ label: 'Lower contract replaced (direct subordination)' })
      break
    case 'tax_changed':
      effects.push({ label: 'taxRateToGrantor adjusted' })
      break
    case 'revoked':
      effects.push({ label: 'Contract revoked' })
      break
  }

  return { reasons, effects }
}
