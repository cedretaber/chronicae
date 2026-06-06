import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { DiplomaticPlayId } from '../types/ids'
import type { DiplomaticPlaySupporter, DiplomaticPlaySideKey } from '../types/diplomaticPlay'
import { politicalActorKey } from '../selectors/actorSelectors'

// v0.43 §6: DiplomaticPlay supporter の追加 mutation。
//   supporter 配列の更新は直接 spread を散らさず必ずこの helper を通す (§6.1)。
//   戻り値は enum string (syncRegimentOwnerToHomeTerminalMut の慣習に倣う)。

export type AddDiplomaticPlaySupporterResult =
  | 'added'
  | 'play_not_found'
  | 'not_active'
  | 'non_polity_actor'
  | 'inactive_polity'
  | 'primary_actor'
  | 'duplicate'
  | 'opposite_side'
  | 'max_supporters_reached'

// §6.2 の全検査を集約した上で supporter を side の配列に append する。
export function addDiplomaticPlaySupporterMut(
  ws: WorldState,
  config: SimulationConfig,
  playId: DiplomaticPlayId,
  side: DiplomaticPlaySideKey,
  supporter: DiplomaticPlaySupporter,
): AddDiplomaticPlaySupporterResult {
  const play = ws.diplomaticPlays[playId]
  if (!play) return 'play_not_found'
  if (play.status !== 'active') return 'not_active'

  const actor = supporter.actor
  if (actor.kind !== 'polity') return 'non_polity_actor'
  if (ws.polities[actor.id]?.active !== true) return 'inactive_polity'

  const actorKey = politicalActorKey(actor)
  if (politicalActorKey(play.initiator) === actorKey || politicalActorKey(play.target) === actorKey)
    return 'primary_actor'

  const sameSide = side === 'initiator' ? play.initiatorSupporters : play.targetSupporters
  const otherSide = side === 'initiator' ? play.targetSupporters : play.initiatorSupporters
  if (sameSide.some((s) => politicalActorKey(s.actor) === actorKey)) return 'duplicate'
  if (otherSide.some((s) => politicalActorKey(s.actor) === actorKey)) return 'opposite_side'

  if (sameSide.length >= config.maxDiplomaticSupportersPerSide) return 'max_supporters_reached'

  ws.diplomaticPlays[playId] =
    side === 'initiator'
      ? { ...play, initiatorSupporters: [...play.initiatorSupporters, supporter] }
      : { ...play, targetSupporters: [...play.targetSupporters, supporter] }
  return 'added'
}
