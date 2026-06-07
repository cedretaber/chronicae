import type { TickContext } from './context'
import { createSimEvent } from './context'
import { randomFloat } from '../rng/rng'
import { markPersonDead } from '../mutations/personMutations'
import { getHouseLeader, getPolityLeader } from '../selectors/officeSelectors'
import { getHousePrimaryPolityId } from '../selectors/polityRelations'
import { nameParam, entityRef } from '../types/event'

export function runMortalitySystem(ctx: TickContext): TickContext {
  let currentCtx = ctx

  for (const personId of ctx.state.livingPersonIds) {
    const person = currentCtx.state.persons[personId]
    if (!person) continue
    if (person.kind === 'placeholder') continue

    // v0.45.1: U字年齢曲線 (config 化)。年齢境界 3/15/40/60/70 は固定、率のみ config。
    const config = currentCtx.config
    const baseRate =
      person.age <= 2
        ? config.mortalityRateInfant
        : person.age <= 14
          ? config.mortalityRateChild
          : person.age <= 39
            ? config.mortalityRatePrime
            : person.age <= 59
              ? config.mortalityRateMiddle
              : person.age <= 69
                ? config.mortalityRateSenior
                : config.mortalityRateElder
    // v0.45.1: 天才は死亡率を乗数で抑える (夭折は残るが稀になる)
    const deathRate =
      person.geniusType !== undefined ? baseRate * config.geniusMortalityMultiplier : baseRate

    const { value: deathCheck, rng: nextRng } = randomFloat(currentCtx.rng)
    currentCtx = { ...currentCtx, rng: nextRng }

    if (deathCheck < deathRate) {
      // v0.45.1: 在野 (houseId なし) も自然死する (旧実装はここで continue しており
      //   在野人物は刈り込み以外で死なない=実質不死だった)。
      //   house/polity leader 判定は house 経由のため在野では常に false。
      const houseLeaderBefore = person.houseId
        ? getHouseLeader(currentCtx.state, person.houseId)
        : undefined
      const wasHouseLeader = houseLeaderBefore === personId
      const personPrimaryPolityId = person.houseId
        ? getHousePrimaryPolityId(currentCtx.state, person.houseId)
        : undefined
      const polityRulerBefore = personPrimaryPolityId
        ? getPolityLeader(currentCtx.state, personPrimaryPolityId)
        : undefined
      const wasPolityLeader = polityRulerBefore === personId

      const deadResult = markPersonDead(currentCtx.state, personId)
      const currentState = deadResult.ok ? deadResult.value : currentCtx.state

      // v0.38 §6.3: notable death (house/polity leader) は IMPORTANT_PERSON_DIED に type 昇格し
      //   importance を major にする。同一死亡で PERSON_DIED と両方は emit しない (単一イベント)。
      //   notability は office 剥奪前 (上の wasHouseLeader/wasPolityLeader) でしか正確に取れないため
      //   projection 側 filter ではなく emit 側で分岐する (案A)。
      //   v0.45: 天才の死も major で記録する (夭折も含めて年代記の対象)。
      const isNotableDeath = wasHouseLeader || wasPolityLeader || person.geniusType !== undefined

      const house = person.houseId ? currentState.houses[person.houseId] : undefined
      const { event, ctx: eventCtx } = createSimEvent(
        { ...currentCtx, state: currentState },
        {
          type: isNotableDeath ? 'IMPORTANT_PERSON_DIED' : 'PERSON_DIED',
          importance: isNotableDeath ? 'major' : 'minor',
          messageKey: 'person.died',
          messageParams: {
            person: nameParam('person', person.nameKey),
            age: person.age,
          },
          entityRefs: [
            entityRef('person', personId, 'deceased', person.nameKey),
            ...(person.houseId
              ? [entityRef('house', person.houseId, 'house', house?.nameKey)]
              : []),
          ],
        },
      )

      currentCtx = {
        ...eventCtx,
        state: currentState,
        events: [...eventCtx.events, event],
        deathsThisTick: [...eventCtx.deathsThisTick, personId],
        deathRolesThisTick: {
          ...eventCtx.deathRolesThisTick,
          [personId]: { wasHouseLeader, wasPolityLeader },
        },
      }
    }
  }

  return currentCtx
}
