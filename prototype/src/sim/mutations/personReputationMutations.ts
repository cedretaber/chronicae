// v0.44 PersonReputation の mutation helper (spec v0.44 §4)。
//
// - byPerson index の同期は必ずこの層で閉じる (politicalRightMutations と同じ規約)。
// - hard-delete。空になった index entry は purge する (taskIndex の空エントリ purge と同方針)。
// - Mut 系は ws の maps を新しいオブジェクトに差し替える (removeRightsByTargetMut パターン)。
//   呼び出し元が clone 済みでなくても元 state を変異させない。

import type { WorldState } from '@sim/types/world'
import type { PersonReputationId, PersonId } from '@sim/types/ids'
import type { PersonReputation } from '@sim/types/personReputation'
import { personReputationOrganizationKey } from '@sim/types/personReputation'
import { createPersonReputationId } from '@sim/types/ids'

export type CreatePersonReputationInput = Omit<PersonReputation, 'id'>

export function addPersonReputationMut(
  ws: WorldState,
  input: CreatePersonReputationInput,
): PersonReputation {
  const id = createPersonReputationId(ws.nextPersonReputationId)
  const reputation: PersonReputation = { ...input, id }

  ws.nextPersonReputationId = ws.nextPersonReputationId + 1
  ws.personReputations = { ...ws.personReputations, [id]: reputation }

  const byPerson = {
    ...ws.personReputationIndex.byPerson,
    [input.personId]: [...(ws.personReputationIndex.byPerson[input.personId] ?? []), id],
  }
  // byOrganization は tag された評判のみ index 入り (relatedOrganization は optional)。
  let byOrganization = ws.personReputationIndex.byOrganization
  if (input.relatedOrganization !== undefined) {
    const orgKey = personReputationOrganizationKey(input.relatedOrganization)
    byOrganization = {
      ...byOrganization,
      [orgKey]: [...(byOrganization[orgKey] ?? []), id],
    }
  }
  ws.personReputationIndex = { byPerson, byOrganization }
  return reputation
}

export function removePersonReputationMut(ws: WorldState, reputationId: PersonReputationId): void {
  const reputation = ws.personReputations[reputationId]
  if (!reputation) return

  const nextReputations = { ...ws.personReputations }
  delete nextReputations[reputationId]

  const byPerson = { ...ws.personReputationIndex.byPerson }
  const entry = (byPerson[reputation.personId] ?? []).filter((id) => id !== reputationId)
  if (entry.length > 0) byPerson[reputation.personId] = entry
  else delete byPerson[reputation.personId]

  // byOrganization: tag されている評判のみ index にあるので、tag がある場合だけ purge する。
  const byOrganization = { ...ws.personReputationIndex.byOrganization }
  if (reputation.relatedOrganization !== undefined) {
    const orgKey = personReputationOrganizationKey(reputation.relatedOrganization)
    const orgEntry = (byOrganization[orgKey] ?? []).filter((id) => id !== reputationId)
    if (orgEntry.length > 0) byOrganization[orgKey] = orgEntry
    else delete byOrganization[orgKey]
  }

  ws.personReputations = nextReputations
  ws.personReputationIndex = { byPerson, byOrganization }
}

// 死亡 purge 用 (§4.5)。deadPersonLogPurgeSystem に piggyback して呼ぶ。
export function removePersonReputationsByPersonMut(ws: WorldState, personId: PersonId): void {
  const ids = ws.personReputationIndex.byPerson[personId]
  if (!ids || ids.length === 0) return
  for (const id of [...ids]) {
    removePersonReputationMut(ws, id)
  }
}
