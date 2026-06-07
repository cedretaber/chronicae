import type { TickContext } from './context'
import type { WorldState } from '../types/world'
import type { PersonId, EventId } from '../types/ids'
import type { AbilityScores, AbilityKey, Person } from '../types/person'
import type { SimEvent } from '../types/event'
import { isLivingPerson } from '../types/person'
import { ABILITY_KEYS, ABILITY_AGE_CURVES, ABILITY_HARD_CAP } from '../constants/abilityConstants'
import { naturalFraction, hadRelevantExperience } from '../selectors/abilitySelectors'
import { randomFloat } from '../rng/rng'
import { nameParam, entityRef } from '../types/event'
import { isNotablePerson } from '../selectors/notablePersonSelectors'

// v0.40 §6.3: living な父母の該当 ability の平均（両親いれば平均・片親のみなら片親）。
//   死亡済み親は含めない。親がいなければ undefined。
function averageLivingParentAbility(
  state: WorldState,
  person: Person,
  key: AbilityKey,
): number | undefined {
  const values: number[] = []
  for (const parentId of [person.fatherId, person.motherId]) {
    if (!parentId) continue
    const parent = state.persons[parentId]
    if (isLivingPerson(parent)) {
      values.push(parent.abilities[key])
    }
  }
  if (values.length === 0) return undefined
  return values.reduce((a, b) => a + b, 0) / values.length
}

// 自然成長の emit 用レコード。duty = hadRelevantExperience による上限解放が
// なければ起こり得なかった成長 (oldValue >= naturalCeil の帯)。
type NaturalGrowthRecord = {
  personId: PersonId
  key: AbilityKey
  oldValue: number
  newValue: number
  duty: boolean
}

export function runPersonGrowthSystem(ctx: TickContext): TickContext {
  let rng = ctx.rng
  const updatedPersons: Record<PersonId, AbilityScores> = {}
  const grownRecords: NaturalGrowthRecord[] = []

  for (const personId of ctx.state.livingPersonIds) {
    const person = ctx.state.persons[personId]
    if (!person) continue
    if (person.kind === 'placeholder') continue

    let changed = false
    const newAbilities: AbilityScores = { ...person.abilities }

    for (const k of ABILITY_KEYS) {
      const ability = newAbilities[k]
      const aptitude = person.aptitudes[k]

      const naturalCeil = aptitude * naturalFraction(k, person.age, ctx.config)
      const experienced = hadRelevantExperience(ctx.state, person.id, k)
      const effectiveCeil = experienced ? aptitude : naturalCeil

      let grew = false

      // Growth
      if (ability < effectiveCeil && effectiveCeil > 0) {
        let gainChance = ctx.config.abilityGrowthChanceBase * (1 - ability / effectiveCeil)
        // v0.40 §6.3: childhood/adolescence は living 親能力が自分より高い ability で成長 chance に加点。
        //   aptitudes/effectiveCeil/naturalFraction は不変（age-curve には触れない）。
        if (person.lifeStage === 'childhood' || person.lifeStage === 'adolescence') {
          const parentalAbility = averageLivingParentAbility(ctx.state, person, k)
          if (parentalAbility !== undefined && parentalAbility > ability) {
            gainChance += ctx.config.parentalAbilityGrowthChanceBonus
          }
        }
        const { value: roll, rng: nextRng } = randomFloat(rng)
        rng = nextRng
        if (roll < gainChance / 100) {
          // v0.45: 成長量はギャップ比例 (成功時最低 +1)。天井近くでは従来どおり +1、
          //   天井と大きく離れている (天才の幼少期・登用直後の上限解放) ほど大きく伸びる。
          //   新値は round(effectiveCeil) を超えない (従来の +1 overshoot 幅は維持)。
          const gapAmount = Math.max(
            1,
            Math.round((effectiveCeil - ability) * ctx.config.abilityGrowthGapFactor),
          )
          newAbilities[k] = Math.min(
            ability + gapAmount,
            Math.max(Math.round(effectiveCeil), ability + 1),
            ABILITY_HARD_CAP,
          )
          changed = true
          grew = true
          grownRecords.push({
            personId: person.id,
            key: k,
            oldValue: ability,
            newValue: newAbilities[k],
            // naturalCeil 以上の帯での成長は experienced による上限解放がなければ
            // 起こり得なかった = 職務 (経験) 由来の成長として区別する
            duty: experienced && ability >= naturalCeil,
          })
        }
      }

      // Decline (only if no growth this step)
      if (!grew) {
        const curve = ABILITY_AGE_CURVES[k]
        if (ability > naturalCeil && (curve === 'youthPeak' || curve === 'midLifePeak')) {
          let declineChance = ctx.config.abilityDeclineChanceBase
          if (hadRelevantExperience(ctx.state, person.id, k)) {
            declineChance *= ctx.config.abilityActiveDeclineMultiplier
          }
          const { value: roll, rng: nextRng } = randomFloat(rng)
          rng = nextRng
          if (roll < declineChance / 100) {
            newAbilities[k] = Math.max(ability - 1, 0)
            changed = true
          }
        }
      }
    }

    if (changed) {
      updatedPersons[person.id] = newAbilities
    }
  }

  if (Object.keys(updatedPersons).length === 0) {
    return { ...ctx, rng }
  }

  const newPersons = { ...ctx.state.persons }
  for (const [id, abilities] of Object.entries(updatedPersons)) {
    const pid = id as PersonId
    const person = newPersons[pid]
    if (person) {
      newPersons[pid] = { ...person, abilities }
    }
  }

  const newState = { ...ctx.state, persons: newPersons }

  // 自然成長を PERSON_ABILITY_GREW として emit する。importance は award 経路
  // (awardHelpers) と同じ notable→normal / それ以外→minor。メイン EventLog は
  // major/critical のみ表示するため、これらは Person Chronicle (byPerson) にのみ残る。
  const newEvents: SimEvent[] = []
  let nextEventIndex = ctx.nextEventIndex
  for (const record of grownRecords) {
    const person = newPersons[record.personId]
    if (!person) continue
    const id = `e-${newState.absoluteWeek}-${nextEventIndex}` as EventId
    nextEventIndex++
    newEvents.push({
      id,
      year: newState.currentYear,
      weekOfYear: newState.currentWeekOfYear,
      type: 'PERSON_ABILITY_GREW',
      importance: isNotablePerson(newState, record.personId) ? 'normal' : 'minor',
      messageKey: 'person.ability_grew',
      messageParams: {
        person: nameParam('person', person.nameKey),
        ability: record.key,
        oldValue: record.oldValue,
        newValue: record.newValue,
        sourceKind: record.duty ? 'duty' : 'natural',
      },
      entityRefs: [entityRef('person', record.personId, 'subject', person.nameKey)],
      reasons: [],
      effects: [],
    })
  }

  return {
    ...ctx,
    rng,
    state: newState,
    events: newEvents.length > 0 ? [...ctx.events, ...newEvents] : ctx.events,
    nextEventIndex,
  }
}
