import type { TickContext } from './context'
import { createSimEvent } from './context'
import type { PersonId, PolityId } from '../types/ids'
import type { LifeStage } from '../types/person'
import type { SimEvent, EventType } from '../types/event'
import { randomFloat } from '../rng/rng'
import { nameParam, entityRef } from '../types/event'
import { getHouseLeader, getPolityLeader } from '../selectors/officeSelectors'
import { getHousePrimaryPolityId } from '../selectors/polityRelations'

// 遷移先 stage（config.lifeStageTransitionAges のキーと一致）。childhood は遷移先になり得ない。
type TransitionStage = 'adolescence' | 'young_adulthood' | 'mature_adulthood' | 'old_age'

// 一方向遷移の遷移先。old_age には次がない（map に存在しない）。
const NEXT_LIFE_STAGE: Partial<Record<LifeStage, TransitionStage>> = {
  childhood: 'adolescence',
  adolescence: 'young_adulthood',
  young_adulthood: 'mature_adulthood',
  mature_adulthood: 'old_age',
}

/**
 * v0.40 §5: LifeStage を年次で一方向に進める。
 * advanceTime で age が上がった後に走り、age が遷移範囲に達した人物を確率的に次段階へ進める。
 * adolescence→young_adulthood / mature_adulthood→old_age の 2 遷移のみ life event を emit する（§10）。
 */
export function runLifeStageProgressionSystem(ctx: TickContext): TickContext {
  let rng = ctx.rng
  let currentCtx = ctx
  const updatedStages: Record<PersonId, TransitionStage> = {}
  const newEvents: SimEvent[] = []

  for (const personId of ctx.state.livingPersonIds) {
    const person = ctx.state.persons[personId]
    if (!person || !person.alive) continue
    if (person.kind === 'placeholder') continue

    const nextStage = NEXT_LIFE_STAGE[person.lifeStage]
    if (!nextStage) continue // old_age は遷移先なし

    const range = ctx.config.lifeStageTransitionAges[nextStage]
    const age = person.age
    if (age < range.minAge) continue

    let shouldTransition: boolean
    if (age >= range.maxAge) {
      shouldTransition = true
    } else {
      const threshold =
        age >= range.standardAge
          ? ctx.config.lifeStageTransitionChanceStandard
          : ctx.config.lifeStageTransitionChanceEarly
      const { value: roll, rng: nextRng } = randomFloat(rng)
      rng = nextRng
      shouldTransition = roll < threshold
    }
    if (!shouldTransition) continue

    updatedStages[personId] = nextStage

    // §10: 成人入り / 老年入りのみ life event を emit する。
    const eventType: EventType | undefined =
      nextStage === 'young_adulthood'
        ? 'PERSON_CAME_OF_AGE'
        : nextStage === 'old_age'
          ? 'PERSON_ENTERED_OLD_AGE'
          : undefined
    if (!eventType) continue

    // §10.4: 安価な index ベース条件のみで notable 判定する（calcPersonImportanceScore は使わない）。
    const houseId = person.houseId
    let notable = false
    let polityId: PolityId | undefined
    if (houseId) {
      if (getHouseLeader(ctx.state, houseId) === personId) notable = true
      polityId = getHousePrimaryPolityId(ctx.state, houseId)
      if (!notable && polityId && getPolityLeader(ctx.state, polityId) === personId) notable = true
    }
    if (!notable) {
      const officeIds = ctx.state.officeIndex.byHolderPerson[personId as string] ?? []
      for (const officeId of officeIds) {
        const office = ctx.state.officeAssignments[officeId]
        if (office && office.active) {
          notable = true
          break
        }
      }
    }

    // §10.5: entityRefs を importance で出し分ける（一般=person のみ / 主要=person+house+polity）。
    const entityRefs = [entityRef('person', personId, 'subject', person.nameKey)]
    if (notable && houseId) {
      const house = ctx.state.houses[houseId]
      entityRefs.push(entityRef('house', houseId, 'house', house?.nameKey))
      if (polityId) {
        const polity = ctx.state.polities[polityId]
        entityRefs.push(entityRef('polity', polityId, 'polity', polity?.nameKey))
      }
    }

    const { event, ctx: eventCtx } = createSimEvent(currentCtx, {
      type: eventType,
      importance: notable ? 'normal' : 'minor',
      messageKey:
        eventType === 'PERSON_CAME_OF_AGE' ? 'person.came_of_age' : 'person.entered_old_age',
      messageParams: {
        person: nameParam('person', person.nameKey),
        age,
      },
      entityRefs,
    })
    currentCtx = eventCtx
    newEvents.push(event)
  }

  if (Object.keys(updatedStages).length === 0 && newEvents.length === 0) {
    return { ...ctx, rng }
  }

  const newPersons = { ...currentCtx.state.persons }
  for (const [id, stage] of Object.entries(updatedStages)) {
    const pid = id as PersonId
    const p = newPersons[pid]
    if (p) newPersons[pid] = { ...p, lifeStage: stage }
  }

  return {
    ...currentCtx,
    rng,
    state: { ...currentCtx.state, persons: newPersons },
    events: [...currentCtx.events, ...newEvents],
  }
}
