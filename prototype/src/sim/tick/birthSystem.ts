import type { TickContext } from './context'
import { createSimEvent } from './context'
import { randomFloat } from '../rng/rng'
import { pickNameBySex } from '../worldgen/nameGenerators'
import { createLogger } from '../debug/logger'
import type { PersonId } from '../types/ids'
import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import { birthChild } from '../mutations/personMutations'
import { inheritAptitudes, sampleAptitudes } from '../selectors/abilitySelectors'
import { rollGeniusType, applyGeniusAptitudes } from '../helpers/geniusHelpers'
import { nameParam, entityRef } from '../types/event'
import { houseNameParam } from '../selectors/nameRefSelectors'

const BIRTH_CALLS_PER_YEAR = 12

export function runBirthSystem(ctx: TickContext): TickContext {
  let currentCtx = ctx

  const livingCount = countLivingPersons(currentCtx.state)
  const birthMultiplier = computeBirthMultiplier(
    currentCtx.config,
    livingCount,
    currentCtx.state.worldgenLivingPersonsBaseline,
  )

  const adultMales = countAdultMales(currentCtx.state)

  for (const personId of currentCtx.state.livingPersonIds) {
    const person = currentCtx.state.persons[personId]
    if (!person) continue
    if (person.kind === 'placeholder') continue
    if (person.sex !== 'male') continue
    if (person.age < currentCtx.config.fatherMinChildAge) continue
    if (person.age > currentCtx.config.fatherMaxChildAge) continue
    if (!person.houseId) continue
    const house = currentCtx.state.houses[person.houseId]
    if (!house || !house.active) continue

    const { value: birthRoll, rng: rollRng } = randomFloat(currentCtx.rng)
    currentCtx = { ...currentCtx, rng: rollRng }

    const birthChance =
      (currentCtx.config.baseBirthChancePerMalePerYear / BIRTH_CALLS_PER_YEAR) * birthMultiplier
    if (birthRoll >= birthChance) continue

    let motherId: PersonId | undefined = undefined
    let birthStatus: 'legitimate' | 'illegitimate' = 'illegitimate'

    if (person.spouseId) {
      const spouse = currentCtx.state.persons[person.spouseId]
      if (
        spouse &&
        spouse.alive &&
        spouse.sex === 'female' &&
        spouse.age >= currentCtx.config.motherMinChildAge &&
        spouse.age <= currentCtx.config.motherMaxChildAge
      ) {
        const { value: spouseRoll, rng: spouseRng } = randomFloat(currentCtx.rng)
        currentCtx = { ...currentCtx, rng: spouseRng }
        if (spouseRoll < currentCtx.config.spouseMotherChance) {
          motherId = person.spouseId
          birthStatus = 'legitimate'
        }
      }
    }

    const totalLiving = countLivingPersons(currentCtx.state)
    let sexRoll: number
    {
      const { value: sr, rng: srRng } = randomFloat(currentCtx.rng)
      sexRoll = sr
      currentCtx = { ...currentCtx, rng: srRng }
    }
    // v0.45.4: 閾値を config 化 (0 でコントローラ無効 — 女性多めプレイ用)
    const sex =
      adultMales < totalLiving * currentCtx.config.adultMaleShortageThreshold
        ? currentCtx.config.maleBirthChanceWhenAdultMaleShortage
        : currentCtx.config.maleBirthChance

    const childSex = sexRoll < sex ? 'male' : 'female'

    const { value: amb1, rng: rng1 } = randomFloat(currentCtx.rng)
    const { value: amb3, rng: rng2 } = randomFloat(rng1)
    currentCtx = { ...currentCtx, rng: rng2 }
    let childNameKey: string
    if (currentCtx.namePoolService) {
      const { value: key, rng: rngAfterName } = currentCtx.namePoolService.pickNameKey(
        currentCtx.rng,
        {
          nameCultureId: currentCtx.config.nameCultureId,
          category: 'person',
          path: [childSex],
        },
      )
      currentCtx = { ...currentCtx, rng: rngAfterName }
      childNameKey = key
    } else {
      const { name, rng: rngAfterName } = pickNameBySex(childSex, currentCtx.rng)
      currentCtx = { ...currentCtx, rng: rngAfterName }
      childNameKey = name
    }

    const childMother = motherId !== undefined ? currentCtx.state.persons[motherId] : undefined

    let childAptitudes: import('../types/person').AbilityScores
    if (childMother) {
      const { value: apt, rng: aptRng } = inheritAptitudes(
        person,
        childMother,
        currentCtx.rng,
        currentCtx.config,
      )
      childAptitudes = apt
      currentCtx = { ...currentCtx, rng: aptRng }
    } else {
      const { value: apt, rng: aptRng } = sampleAptitudes(currentCtx.rng, currentCtx.config)
      childAptitudes = apt
      currentCtx = { ...currentCtx, rng: aptRng }
    }

    // v0.45 天才ロール: 出現したら対応能力の天賦を 80-120 帯へ引き上げる
    const { value: geniusType, rng: geniusRng } = rollGeniusType(currentCtx.rng, currentCtx.config)
    currentCtx = { ...currentCtx, rng: geniusRng }
    if (geniusType !== undefined) {
      const applied = applyGeniusAptitudes(
        childAptitudes,
        geniusType,
        currentCtx.rng,
        currentCtx.config,
      )
      childAptitudes = applied.value
      currentCtx = { ...currentCtx, rng: applied.rng }
    }

    const birthResult = birthChild(currentCtx, {
      fatherId: person.id,
      ...(motherId !== undefined ? { motherId } : {}),
      birthStatus,
      nameKey: childNameKey,
      sex: childSex,
      aptitudes: childAptitudes,
      traits: { ambition: amb1, caution: amb3 },
      ...(geniusType !== undefined ? { geniusType } : {}),
    })
    if (!birthResult.ok) continue

    const {
      ctx: ctxAfterBirth,
      value: { childId },
    } = birthResult.value
    currentCtx = ctxAfterBirth

    // 出生時の所属家。birthChild は父の家を必須とし子に継承させる (子の出生時の家 = 父の家)
    // ため、CHILD_BORN 到達時点で houseId は常に定義済み。
    const childHouse =
      person.houseId !== undefined ? currentCtx.state.houses[person.houseId] : undefined

    const { event, ctx: eventCtx } = createSimEvent(currentCtx, {
      type: 'CHILD_BORN',
      importance: 'normal',
      // 両親と出生時の家を記録する。母が不在の稀なケース (seeding 等) のみ別テンプレート。
      messageKey: childMother ? 'person.born' : 'person.born_no_mother',
      messageParams: {
        child: nameParam('person', childNameKey),
        father: nameParam('person', person.nameKey),
        ...(childMother ? { mother: nameParam('person', childMother.nameKey) } : {}),
        ...(person.houseId ? { house: houseNameParam(childHouse, person.houseId) } : {}),
      },
      entityRefs: [
        entityRef('person', childId, 'child', childNameKey),
        entityRef('person', person.id, 'father', person.nameKey),
        ...(childMother
          ? [entityRef('person', childMother.id, 'mother', childMother.nameKey)]
          : []),
        ...(person.houseId
          ? [entityRef('house', person.houseId, 'house', childHouse?.nameKey)]
          : []),
      ],
    })

    currentCtx = { ...eventCtx, events: [...eventCtx.events, event] }

    // v0.45 天才の誕生は major でメインログに流す (1% なので頻度は低い)
    if (geniusType !== undefined) {
      const { event: geniusEvent, ctx: geniusEventCtx } = createSimEvent(currentCtx, {
        type: 'PERSON_GENIUS_BORN',
        importance: 'major',
        messageKey: 'person.genius_born',
        messageParams: {
          child: nameParam('person', childNameKey),
          geniusType,
        },
        // 天才誕生は「その子が天才である」ことだけを示す。両親・家など出生情報は同時に出る
        // CHILD_BORN が持つため重複させない (child + house のみ)。
        entityRefs: [
          entityRef('person', childId, 'child', childNameKey),
          ...(person.houseId ? [entityRef('house', person.houseId, 'house')] : []),
        ],
      })
      currentCtx = { ...geniusEventCtx, events: [...geniusEventCtx.events, geniusEvent] }
    }

    const log = createLogger(currentCtx.config.debug)
    const birthFields: Record<string, string | number | boolean> = {
      year: currentCtx.state.currentYear,
      week: currentCtx.state.currentWeekOfYear,
      child: childId,
      sex: childSex,
      father: person.id,
      status: birthStatus,
    }
    if (motherId) birthFields['mother'] = motherId
    log.log('BIRTH', birthFields)
  }

  return currentCtx
}

function countLivingPersons(state: WorldState): number {
  let count = 0
  for (const personId of state.livingPersonIds) {
    const person = state.persons[personId]
    if (person && person.kind !== 'placeholder') count++
  }
  return count
}

// v0.45.1: 閾値は絶対値から worldgen 初期人口 (baseline) 比例に変更。
//   critical (×1 以下) → 3 倍ブースト / target (×2 未満) → 1.5 倍 / high (×3 以上) → 0.5 倍ダンパー。
//   high 帯は死亡率 U 字化で純再生産率が 1 を超えたために新設 (人口は ×2〜×3 帯で安定する)。
//   baseline 未設定 (古い fixture 等) では制御無効 (常に 1.0)。
function computeBirthMultiplier(
  config: SimulationConfig,
  livingCount: number,
  baseline: number | undefined,
): number {
  if (baseline === undefined || baseline <= 0) return 1.0
  if (livingCount <= baseline * config.criticalLivingPersonsFactor)
    return config.criticalPopulationBirthMultiplier
  if (livingCount < baseline * config.targetLivingPersonsFactor)
    return config.lowPopulationBirthMultiplier
  if (livingCount >= baseline * config.highLivingPersonsFactor)
    return config.highPopulationBirthMultiplier
  return 1.0
}

function countAdultMales(state: WorldState): number {
  let count = 0
  for (const personId of state.livingPersonIds) {
    const person = state.persons[personId]
    if (person && person.kind !== 'placeholder' && person.sex === 'male' && person.age >= 15)
      count++
  }
  return count
}
