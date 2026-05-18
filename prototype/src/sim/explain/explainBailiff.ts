import type { WorldState } from '../types/world'
import type { ProvinceId, PersonId } from '../types/ids'
import type { EventReason, EventEffect } from '../types/event'
import { getProvinceTerminalPolityId } from '../selectors/landContractSelectors'

export type BailiffChangeKind = 'appointed' | 'vacated' | 'placeholder_installed'

export function explainBailiff(
  state: WorldState,
  provinceId: ProvinceId,
  kind: BailiffChangeKind,
  holderPersonId?: PersonId,
): { reasons: EventReason[]; effects: EventEffect[] } {
  const reasons: EventReason[] = []
  const effects: EventEffect[] = []

  const terminalPolityId = getProvinceTerminalPolityId(state, provinceId)
  if (terminalPolityId) {
    const polity = state.polities[terminalPolityId]
    if (polity) {
      reasons.push({
        label: 'Terminal Polity',
        value: polity.rank,
      })
    }
  }

  if (holderPersonId) {
    const holder = state.persons[holderPersonId]
    if (holder) {
      reasons.push({
        label: 'Numeracy',
        value: holder.abilities.numeracy,
      })
      reasons.push({
        label: 'Insight',
        value: holder.abilities.insight,
      })
    }
  }

  switch (kind) {
    case 'appointed':
      effects.push({ label: 'New bailiff appointed (normal Person)' })
      break
    case 'vacated':
      effects.push({ label: 'Bailiff vacated' })
      break
    case 'placeholder_installed':
      effects.push({ label: 'Placeholder bailiff installed (vacant seat)' })
      break
  }

  return { reasons, effects }
}
