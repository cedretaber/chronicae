import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { OrganizationRef } from '../types/office'
import type { PressureResponseStance } from '../types/pressure'
import { getActorMilitaryPower } from './actorSelectors'
import { getPolityLeader, getHouseLeader } from './officeSelectors'
import { normalizedTrait } from './personAbilityEffects'

// 圧力 (外交劇) に対する被圧力側 (target) の応答 stance を、彼我の軍事力比から予測する。
//
// 単一の真実 (single source of truth):
//   - projectStageSystem の stance 決定 (defender が実際にどう応じるか)
//   - 外交劇の開始ゲート (createContractRevisionPlayFromProjectMut が起こすべきか)
//   の両方がこの 1 関数を呼ぶ。開始時の「相手が応じる見込み」と実際の応答が必ず一致する。
//
// 将来「大国の動員制約」等で getActorMilitaryPower の算出が変わると、
// 予測と実応答の両方へ自動的に反映される (修正はこの式 1 箇所)。
//
// v0.42: nominal power のまま、concede/resist 境界を target の意思決定者の性格でシフトする。
//   慎重な宗主は早く譲歩し、大胆な宗主は不利でも拒否する。personAbilityEffectsEnabled で gate
//   (OFF 時は厳密に従来挙動)。開戦ゲート (warEstimateSelectors) は regiment 勝率で別軸に判定するため、
//   ここに regiment 戦力を持ち込まない (aim/play ゲートへ 0 動員エッジを波及させない)。
export const PRESSURE_CONCEDE_POWER_RATIO = 0.5
export const PRESSURE_RESIST_POWER_RATIO = 1.2

// target の意思決定者 (polity=指導者 / house=当主) の性格傾向を返す。不在なら中立 (0.5/0.5)。
function getDecisionMakerTraits(
  state: WorldState,
  actor: OrganizationRef,
): { ambition: number; caution: number } {
  const leaderId =
    actor.kind === 'polity' ? getPolityLeader(state, actor.id) : getHouseLeader(state, actor.id)
  const person = leaderId ? state.persons[leaderId] : undefined
  if (!person || !person.alive) return { ambition: 0.5, caution: 0.5 }
  return { ambition: person.traits.ambition, caution: person.traits.caution }
}

export function predictPressureResponseStance(
  state: WorldState,
  config: SimulationConfig,
  sourceActor: OrganizationRef,
  targetActor: OrganizationRef,
): PressureResponseStance {
  const targetPower = getActorMilitaryPower(state, config, targetActor)
  const sourcePower = getActorMilitaryPower(state, config, sourceActor)

  // 「大胆さ」軸: ambition 高 / caution 低 ほど境界が下がり、不利でも拒否しやすく譲歩しにくい。
  //   両境界を同量シフトするので concede < resist の順序は保たれる。
  let concedeRatio = PRESSURE_CONCEDE_POWER_RATIO
  let resistRatio = PRESSURE_RESIST_POWER_RATIO
  if (config.personAbilityEffectsEnabled) {
    const { ambition, caution } = getDecisionMakerTraits(state, targetActor)
    const shift =
      normalizedTrait(ambition) * config.pressureStanceAmbitionShift -
      normalizedTrait(caution) * config.pressureStanceCautionShift
    concedeRatio -= shift
    resistRatio -= shift
  }

  // target が source より十分弱い → 譲歩 / 拮抗 → 交渉 / target が十分強い → 拒絶 (現状維持で押し切る)
  if (targetPower < sourcePower * concedeRatio) return 'concede'
  if (targetPower >= sourcePower * resistRatio) return 'resist'
  return 'negotiate'
}
