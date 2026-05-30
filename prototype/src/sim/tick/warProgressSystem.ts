import type { TickContext } from './context'
import type { WorldState } from '../types/world'
import type { WarId } from '../types/ids'
import { updateWar, getWarPrimaryAttacker, getWarPrimaryDefender } from '../mutations/warMutations'
import { getActorMilitaryPower, isActorActive } from '../selectors/actorSelectors'
import { clamp } from '../utils/math'
import { emitWarScoreChanged } from './warEvents'

// v0.34 §7 WarProgressSystem
//
// active War の attacker / defender の抽象軍事力を比較し warScore を更新する。乱数は使わない (§7.6)。
// 終結判定はしない (§7.7。PeaceSettlementSystem の責務)。
//
// dead-participant guard (§B advisor①): primary participant が missing/inactive な War は warScore を触らない。
//   消滅 actor は cancelOrphanedWarsSystem (consistency 系の後ろ) が同 tick 内に cancelled 化する。
//
// calcGeneralWarPowerModifier は使わない (§7.3。Polity/House を統一に扱う。指揮官補正は v0.35)。

export function runWarProgressSystem(ctx: TickContext): TickContext {
  const config = ctx.config
  const absoluteWeek = ctx.state.absoluteWeek

  const activeWarIds = Object.keys(ctx.state.wars)
    .sort()
    .filter((id) => ctx.state.wars[id as WarId]?.status === 'active')
  if (activeWarIds.length === 0) return ctx

  const ws: WorldState = {
    ...ctx.state,
    wars: { ...ctx.state.wars },
    polities: { ...ctx.state.polities },
  }
  const scoreChanges: { warId: WarId; delta: number }[] = []

  for (const idStr of activeWarIds) {
    const wid = idStr as WarId
    const war = ws.wars[wid]
    if (!war) continue
    const atk = getWarPrimaryAttacker(war)?.actor
    const def = getWarPrimaryDefender(war)?.actor
    if (!atk || !def) continue
    if (!isActorActive(ws, atk) || !isActorActive(ws, def)) continue

    const aP = getActorMilitaryPower(ws, config, atk)
    const dP = getActorMilitaryPower(ws, config, def)

    // §7.4 winChance → delta (上限 clamp)。
    const winChance = aP / (aP + dP + 1)
    let change = clamp(
      (winChance - 0.5) * config.warScoreProgressFactor,
      -config.maxWarScoreDeltaPerTick,
      config.maxWarScoreDeltaPerTick,
    )
    // §7.5 戦力崩壊 (供給不能)。
    if (aP <= config.warMinimumEffectivePower) change -= config.warScoreCollapseDelta
    if (dP <= config.warMinimumEffectivePower) change += config.warScoreCollapseDelta

    const newScore = clamp(war.warScore + change, -100, 100)
    const applied = newScore - war.warScore
    updateWar(ws, wid, { warScore: newScore })

    // §B advisor③: valor/command の「直近戦争参加」判定 (abilitySelectors) を温存する。
    for (const actor of [atk, def]) {
      if (actor.kind === 'polity') {
        const p = ws.polities[actor.id]
        if (p) ws.polities[actor.id] = { ...p, lastWarWeek: absoluteWeek }
      }
    }

    // §12.3: |delta| が閾値以上のときのみ WAR_SCORE_CHANGED。
    if (Math.abs(applied) >= config.warScoreEventThreshold) {
      scoreChanges.push({ warId: wid, delta: applied })
    }
  }

  let next: TickContext = { ...ctx, state: ws }
  for (const sc of scoreChanges) {
    const w = next.state.wars[sc.warId]
    if (w) next = emitWarScoreChanged(next, w, sc.delta)
  }
  return next
}
