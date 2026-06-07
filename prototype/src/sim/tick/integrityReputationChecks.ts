// v0.44 §12.1: PersonReputation の整合性チェック。
//
// NOTE: §12.2 (Project.terminalReason) / §12.3 (DiplomaticPlay.terminalOutcome) は
// それぞれ integrityGoalProjectChecks / integrityDiplomacyWarChecks に追加してある。
// terminal entity は同 tick 〜 4 週内に削除されるため、これらは年末 integrity では
// 実質発火せず、--integrity-per-system での mid-tick 検証が前提となる。

import type { SimError } from '../mutations/errors'
import type { WorldState } from '../types/world'
import { VALID_REPUTATION_CATEGORIES } from '../types/personReputation'

const VALID_CATEGORY_SET = new Set<string>(VALID_REPUTATION_CATEGORIES)
const VALID_SOURCE_KINDS = new Set<string>(['project', 'diplomatic_play', 'war'])

export function checkPersonReputations(state: WorldState, errors: SimError[]): void {
  for (const [idStr, reputation] of Object.entries(state.personReputations)) {
    if (!reputation) continue

    if ((reputation.id as string) !== idStr) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `PersonReputation ${idStr}: id mismatch (entity.id=${reputation.id as string}) (§12.1)`,
      })
    }

    if (!state.persons[reputation.personId]) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `PersonReputation ${idStr}: personId ${reputation.personId as string} does not exist (§12.1)`,
      })
    }

    if (!Number.isFinite(reputation.baseScore)) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `PersonReputation ${idStr}: baseScore is not finite (${String(reputation.baseScore)}) (§12.1)`,
      })
    }

    if (reputation.createdWeek > reputation.expiryWeek) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `PersonReputation ${idStr}: createdWeek ${reputation.createdWeek} > expiryWeek ${reputation.expiryWeek} (§12.1)`,
      })
    }

    if (!VALID_CATEGORY_SET.has(reputation.category)) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `PersonReputation ${idStr}: invalid category ${String(reputation.category)} (§12.1)`,
      })
    }

    if (!VALID_SOURCE_KINDS.has(reputation.source.kind)) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `PersonReputation ${idStr}: invalid source.kind ${String(reputation.source.kind)} (§12.1)`,
      })
    }

    // entity → index 方向
    const indexEntry = state.personReputationIndex.byPerson[reputation.personId] ?? []
    if (!indexEntry.includes(reputation.id)) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `PersonReputation ${idStr}: missing from personReputationIndex.byPerson[${reputation.personId as string}] (§12.1)`,
      })
    }
  }

  // index → entity 方向 + personId 整合
  for (const [personIdStr, ids] of Object.entries(state.personReputationIndex.byPerson)) {
    if (!ids) continue
    if (ids.length === 0) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `personReputationIndex.byPerson[${personIdStr}]: empty entry not purged (§12.1)`,
      })
    }
    for (const id of ids) {
      const reputation = state.personReputations[id]
      if (!reputation) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `personReputationIndex.byPerson[${personIdStr}]: references missing PersonReputation ${id as string} (§12.1)`,
        })
      } else if ((reputation.personId as string) !== personIdStr) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `personReputationIndex.byPerson[${personIdStr}]: PersonReputation ${id as string} belongs to ${reputation.personId as string} (§12.1)`,
        })
      }
    }
  }
}
