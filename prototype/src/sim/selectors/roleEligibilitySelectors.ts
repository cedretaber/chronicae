import type { WorldState } from '@sim/types/world'
import type { PersonId } from '@sim/types/ids'
import type { SimulationConfig } from '@sim/config/defaultConfig'
import { hashSeedToUint32 } from '@sim/rng/rng'

// v0.45.3 性別役職適格ゲート。
//   時代背景 (古代〜近世) 上、女性の役職持ちは「非常に稀」とする。女性ごとに personId の
//   決定論 hash で一度だけ適格性が決まり (femaleRoleEligibilityChance)、適格な女性は男性と
//   同一の実力競争に乗る (稀さと実力突破の分離)。pure selector からも呼ばれるため RNG state
//   は使わない (lazy refresh で値が揺れない)。
//   適用先: polity/house office 任命・代官・総大将 (military 経路)・現場指揮官・派閥首領・
//   project supervisor。当主/君主の継承は対象外 (既存の男子優先ロジックが司る)。
//   女当主・女王の例外は本 helper の免除でなく構造で実現する: 継承 selector は本 gate を
//   通らず、総大将の leader fallback (女王親征) も gate を通らない。leader 免除を helper に
//   入れると「女当主が将軍職も兼ねる」漏れが起きる (実測で女性 office holder の主因だった)。
//   候補が払底した場合の ungated 再試行は allowFemaleRolesWhenNoMaleCandidate が司る
//   (各呼び出しサイトの責務。default false — 開けると男性プールの局所払底が常態のため
//   fallback が支配経路になり「非常に稀」が成立しない)。

export function isRoleEligibleBySex(
  state: WorldState,
  config: SimulationConfig,
  personId: PersonId,
): boolean {
  const person = state.persons[personId]
  if (!person || person.sex === 'male') return true
  const roll = hashSeedToUint32(`femaleRoleEligibility:${personId}`) / 2 ** 32
  return roll < config.femaleRoleEligibilityChance
}
