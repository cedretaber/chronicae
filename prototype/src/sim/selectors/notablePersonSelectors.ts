// v0.44: notable (主要人物) 判定の共通 selector。
// lifeStageProgressionSystem §10.4 のインライン判定を抽出した (v0.44 で award 系
// イベントの importance 出し分けにも使うため共通化)。
// 安価な index ベース条件のみで判定する (calcPersonImportanceScore は使わない):
//   - 家の当主である
//   - 家の primary polity の指導者である
//   - active な役職を 1 つ以上持つ
//   - 天才である (v0.45。成長ログが normal になり、死去が IMPORTANT_PERSON_DIED 対象になる)

import type { WorldState } from '../types/world'
import type { PersonId } from '../types/ids'
import { getHouseLeader, getPolityLeader } from './officeSelectors'
import { getHousePrimaryPolityId } from './polityRelations'

export function isNotablePerson(state: WorldState, personId: PersonId): boolean {
  const person = state.persons[personId]
  if (!person) return false

  if (person.geniusType !== undefined) return true

  const houseId = person.houseId
  if (houseId) {
    if (getHouseLeader(state, houseId) === personId) return true
    const polityId = getHousePrimaryPolityId(state, houseId)
    if (polityId && getPolityLeader(state, polityId) === personId) return true
  }

  const officeIds = state.officeIndex.byHolderPerson[personId as string] ?? []
  for (const officeId of officeIds) {
    const office = state.officeAssignments[officeId]
    if (office && office.active) return true
  }
  return false
}
