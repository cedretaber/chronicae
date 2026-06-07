// v0.45 天才: 人物生成時の低確率ロールで「型」を決め、対応能力の天賦と初期値を引き上げる。
//
// フックは samplePerson (worldgen / 在野 / 配偶者 / commonwealth 指導者) と
// birthSystem→birthChild (出生) の 2 経路のみ。両経路ともこのモジュールの関数を共有する。

import type { AbilityKey, AbilityScores, GeniusType } from '../types/person'
import type { RngState, RngResult } from '../rng/rng'
import type { SimulationConfig } from '../config/defaultConfig'
import { randomFloat, randomInt } from '../rng/rng'
import { ABILITY_KEYS } from '../constants/abilityConstants'

// 型ごとの対応能力。6 能力が commander / chancellor で 3:3 に割れる。
export const GENIUS_ABILITY_SETS: Record<GeniusType, readonly AbilityKey[]> = {
  commander: ['valor', 'command', 'charisma'],
  chancellor: ['numeracy', 'learning', 'insight'],
  universal: ABILITY_KEYS,
}

const GENIUS_TYPES = ['commander', 'chancellor', 'universal'] as const

function geniusTypeWeight(config: SimulationConfig, type: GeniusType): number {
  switch (type) {
    case 'commander':
      return config.geniusTypeWeightCommander
    case 'chancellor':
      return config.geniusTypeWeightChancellor
    case 'universal':
      return config.geniusTypeWeightUniversal
  }
}

/**
 * 出現判定 + 型選択。出現しなければ undefined。
 * 出現判定で randomFloat 1 回、ヒット時は型選択でさらに 1 回消費する。
 * weight は合計で正規化するため任意の比率を config に書ける (合計 0 以下なら出現しない)。
 */
export function rollGeniusType(
  rng: RngState,
  config: SimulationConfig,
): RngResult<GeniusType | undefined> {
  if (config.geniusAppearanceChance <= 0) return { value: undefined, rng }
  const { value: roll, rng: rng1 } = randomFloat(rng)
  if (roll >= config.geniusAppearanceChance) return { value: undefined, rng: rng1 }

  const totalWeight = GENIUS_TYPES.reduce((s, t) => s + geniusTypeWeight(config, t), 0)
  if (totalWeight <= 0) return { value: undefined, rng: rng1 }
  const { value: typeRoll, rng: rng2 } = randomFloat(rng1)
  let cursor = typeRoll * totalWeight
  for (const type of GENIUS_TYPES) {
    cursor -= geniusTypeWeight(config, type)
    if (cursor < 0) return { value: type, rng: rng2 }
  }
  // 浮動小数の端で抜けた場合は最後の型 (universal)
  return { value: GENIUS_TYPES[GENIUS_TYPES.length - 1], rng: rng2 }
}

/**
 * 対応能力の天賦を [geniusAptitudeMin, geniusAptitudeMax] のロールで引き上げる。
 * max(既存値, ロール値) — 遺伝で既に高い場合に潰さない「床」として働く。
 */
export function applyGeniusAptitudes(
  aptitudes: AbilityScores,
  geniusType: GeniusType,
  rng: RngState,
  config: SimulationConfig,
): RngResult<AbilityScores> {
  let currentRng = rng
  const result: AbilityScores = { ...aptitudes }
  for (const k of GENIUS_ABILITY_SETS[geniusType]) {
    const { value, rng: nextRng } = randomInt(
      currentRng,
      config.geniusAptitudeMin,
      config.geniusAptitudeMax,
    )
    result[k] = Math.max(result[k], value)
    currentRng = nextRng
  }
  return { value: result, rng: currentRng }
}

/**
 * 対応能力の初期値を geniusInitialAbilityValue まで引き上げる (天賦を超えない)。
 * 既に初期サンプルが高い場合 (高齢で生成された人物など) はそのまま。RNG 不使用。
 */
export function applyGeniusInitialAbilities(
  abilities: AbilityScores,
  aptitudes: AbilityScores,
  geniusType: GeniusType,
  config: SimulationConfig,
): AbilityScores {
  const result: AbilityScores = { ...abilities }
  for (const k of GENIUS_ABILITY_SETS[geniusType]) {
    result[k] = Math.max(result[k], Math.min(config.geniusInitialAbilityValue, aptitudes[k]))
  }
  return result
}
