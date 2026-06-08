// 影響力個人中心化 Phase 4: person 保有任命権の死亡時継承 (§10)。
//
// 死亡時、person-held right は必ず「国回収 (削除)」か「家産化 (holder=house に変換)」の
// どちらかに分類される (第3の結果は無い)。判定:
//   - houseless 死亡 → 常に国回収 (家産化先なし・flip なし)
//   - 死亡者家 == owner 家 → 常に家産化 (自家没収は不自然・flip なし)
//   - commonwealth (ownerHouseId なし) → owner 70% 条件不成立 → 死亡者家 20% だけで判定 + flip
//   - 通常 → owner家% >= seize で国回収 / 死亡者家% < retain で国回収 / それ以外 家産化、+ flip
// flip (主君の気まぐれ) は rightId+personId の決定論 hash (RNG state を持たず再現可能)。
//
// 設計: markPersonDead の前に呼ぶ。家産化 (transfer person→house) した right は markPersonDead の
// removeRightsByHolder({person}) に捕まらず生存。国回収 (放置) した right は markPersonDead が削除する。
// influence% は pre-death snapshot (死亡者本人の office/reputation 寄与込み = 死亡直前の家の力で判定)。

import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { PersonId, PolityId, HouseId, PoliticalRightId } from '../types/ids'
import type { MarkPersonDeadOptions } from './personMutations'
import type { StateResult } from './result'
import { markPersonDead } from './personMutations'
import { getRightsByHolder, getPolityIdForRightTarget } from '../selectors/politicalRightSelectors'
import { getHouseAggregateInfluenceInPolity } from '../selectors/influenceSelectors'
import { transferPoliticalRight } from './politicalRightMutations'
import { hashSeedToUint32 } from '../rng/rng'

type InheritanceDecision = 'inherit' | 'seize' // 家産化 | 国回収

function flipApplies(
  config: SimulationConfig,
  rightId: PoliticalRightId,
  personId: PersonId,
): boolean {
  const roll = hashSeedToUint32(`rightInheritanceFlip:${rightId}:${personId}`) / 2 ** 32
  return roll < config.rightInheritanceFlipChance
}

function decideRightInheritance(
  state: WorldState,
  config: SimulationConfig,
  polityId: PolityId,
  deadHouseId: HouseId | undefined,
  personId: PersonId,
  rightId: PoliticalRightId,
): InheritanceDecision {
  // houseless → 常に国回収 (flip skip)
  if (deadHouseId === undefined) return 'seize'
  const polity = state.polities[polityId]
  if (!polity || !polity.active) return 'seize'
  // 死亡者家 == owner 家 → 常に家産化 (flip skip)
  if (polity.ownerHouseId !== undefined && polity.ownerHouseId === deadHouseId) return 'inherit'

  const deadHousePct = getHouseAggregateInfluenceInPolity(
    state,
    config,
    deadHouseId,
    polityId,
  ).percent

  let base: InheritanceDecision
  if (polity.ownerHouseId !== undefined) {
    const ownerPct = getHouseAggregateInfluenceInPolity(
      state,
      config,
      polity.ownerHouseId,
      polityId,
    ).percent
    if (ownerPct >= config.rightInheritanceOwnerSeizeThreshold) base = 'seize'
    else if (deadHousePct < config.rightInheritanceHouseRetainThreshold) base = 'seize'
    else base = 'inherit'
  } else {
    // commonwealth: owner 70% 不成立扱い → 死亡者家 20% だけで判定
    base = deadHousePct < config.rightInheritanceHouseRetainThreshold ? 'seize' : 'inherit'
  }

  if (flipApplies(config, rightId, personId)) {
    return base === 'inherit' ? 'seize' : 'inherit'
  }
  return base
}

// person-held right を継承判定し、家産化分を transfer する (国回収分は放置 → markPersonDead が削除)。
export function resolveRightInheritanceOnDeath(
  state: WorldState,
  config: SimulationConfig,
  personId: PersonId,
): WorldState {
  const person = state.persons[personId]
  if (!person) return state
  const rights = getRightsByHolder(state, { kind: 'person', id: personId })
  if (rights.length === 0) return state

  const deadHouseId = person.houseId
  let current = state
  // rightId 昇順で決定的に処理する (transfer の index 変化に依存しない安定順)
  const sorted = [...rights].sort((a, b) => a.id.localeCompare(b.id))
  for (const right of sorted) {
    const polityId = getPolityIdForRightTarget(current, right.target)
    if (polityId === undefined) continue // 国回収 (markPersonDead が削除)
    const decision = decideRightInheritance(
      current,
      config,
      polityId,
      deadHouseId,
      personId,
      right.id,
    )
    if (decision === 'inherit' && deadHouseId !== undefined) {
      const result = transferPoliticalRight(current, right.id, { kind: 'house', id: deadHouseId })
      // err (家が inactive/extinct 等) → 国回収 fallback (放置して markPersonDead に任せる)
      if (result.ok) current = result.value.state
    }
    // 'seize' → 何もしない (markPersonDead の removeRightsByHolder が削除)
  }
  return current
}

// 影響力個人中心化 Phase 4: 死亡 choke-point。継承 → markPersonDead を集約する。
// 全死亡サイトはこの wrapper を使うこと (site ごとに inheritance+markPersonDead の pair を
// 書くと新サイト追加時の書き漏れを生む)。
export function markPersonDeadWithInheritance(
  state: WorldState,
  config: SimulationConfig,
  personId: PersonId,
  options?: MarkPersonDeadOptions,
): StateResult {
  const afterInheritance = resolveRightInheritanceOnDeath(state, config, personId)
  return markPersonDead(afterInheritance, personId, options)
}
