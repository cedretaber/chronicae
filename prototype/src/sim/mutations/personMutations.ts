import type { TickContext } from '../tick/context'
import { makePersonId } from '../tick/context'
import type { PersonId, HouseId } from '../types/ids'
import type {
  Person,
  Sex,
  BirthStatus,
  AbilityScores,
  DeathCircumstance,
  GeniusType,
} from '../types/person'
import type { WorldState } from '../types/world'
import type { StateResult, CtxResult } from './result'
import { ok, err } from './result'
import { clearSpouse, recordFormerSpouse } from './relationshipMutations'
import { revokeOfficesByHolder } from './officeMutations'
import { removePersonSharesInHouse } from './shareMutations'
import { removeRightsByHolder } from './politicalRightMutations'
import { buildPerson } from '../helpers/personFactory'
import { sampleAbilitiesFromAptitudes } from '../selectors/abilitySelectors'

export type BirthChildInput = {
  fatherId: PersonId
  motherId?: PersonId
  birthStatus: BirthStatus
  nameKey: string
  sex: Sex
  aptitudes: AbilityScores
  traits: { ambition: number; caution: number }
  geniusType?: GeniusType // v0.45 天才 (ロールと天賦引き上げは birthSystem 側で済んでいる)
}

export type MarkPersonDeadOptions = {
  deathCircumstance?: DeathCircumstance
}

export function markPersonDead(
  state: WorldState,
  personId: PersonId,
  options?: MarkPersonDeadOptions,
): StateResult {
  const person = state.persons[personId]
  if (!person)
    return err({
      code: 'PERSON_NOT_FOUND',
      message: 'markPersonDead: person not found: ' + personId,
    })
  if (!person.alive) return ok(state)

  const deathCircumstance = options?.deathCircumstance
  const updatedPerson: typeof person =
    deathCircumstance !== undefined
      ? { ...person, alive: false, deathCircumstance }
      : { ...person, alive: false }

  // 死別前に配偶者を控えておき、clearSpouse 後に formerSpouseIds へ記録する。
  const formerSpouseId = person.spouseId

  let newState: WorldState = {
    ...state,
    persons: { ...state.persons, [personId]: updatedPerson },
    livingPersonIds: state.livingPersonIds.filter((id) => id !== personId),
  }
  const spouseResult = clearSpouse(newState, personId)
  if (spouseResult.ok) newState = spouseResult.value
  if (formerSpouseId !== undefined) {
    newState = recordFormerSpouse(newState, personId, formerSpouseId)
  }
  newState = revokeOfficesByHolder(newState, personId)
  // v0.42 §6.4: personal right は holder 死亡で即時失効 (silent cascade — office と同じ扱い)
  newState = removeRightsByHolder(newState, { kind: 'person', id: personId })

  if (person.houseId) {
    const house = newState.houses[person.houseId]
    if (house && house.memberIds.includes(personId)) {
      newState = {
        ...newState,
        houses: {
          ...newState.houses,
          [person.houseId]: {
            ...house,
            memberIds: house.memberIds.filter((id) => id !== personId),
            deceasedMemberIds: [...(house.deceasedMemberIds ?? []), personId],
          },
        },
      }
    }
  }

  return ok(newState)
}

export function movePersonToHouse(
  state: WorldState,
  personId: PersonId,
  newHouseId: HouseId,
): StateResult {
  const person = state.persons[personId]
  if (!person)
    return err({
      code: 'PERSON_NOT_FOUND',
      message: 'movePersonToHouse: person not found: ' + personId,
    })

  const newHouse = state.houses[newHouseId]
  if (!newHouse)
    return err({
      code: 'HOUSE_NOT_FOUND',
      message: 'movePersonToHouse: target house not found: ' + newHouseId,
    })

  if (person.houseId === newHouseId) {
    return ok(state)
  }

  let current = state
  // Clean up shares in old house before moving
  if (person.houseId) {
    current = removePersonSharesInHouse(current, personId, person.houseId)
  }

  const newPersons = { ...current.persons }
  newPersons[personId] = {
    ...person,
    houseId: newHouseId,
  }

  const newHouses = { ...current.houses }
  if (person.houseId) {
    const oldHouse = current.houses[person.houseId]
    if (oldHouse) {
      newHouses[oldHouse.id] = {
        ...oldHouse,
        memberIds: oldHouse.memberIds.filter((id) => id !== personId),
      }
    }
  }
  newHouses[newHouse.id] = {
    ...newHouse,
    memberIds: [...newHouse.memberIds, personId],
  }

  return ok({
    ...current,
    persons: newPersons,
    houses: newHouses,
  })
}

// v0.47 §10: 分家創設時に founder の家族 (spouse + child) を新 House へ移す helper。
// splitHouse の inline family-move を切り出し再利用する (分封 §8 / Polity 譲渡 §11 で共有)。
// 規約 (§10.1/§10.2):
//   - founder 本人 + 同 House (founder の旧 houseId と一致) の spouse / child を移す
//   - 既に別 House に所属する者・active office holder (polity/holding office = leader/title holder
//     含む) は除外 (独自立場の人物を巻き込まない)
//   - 故人は移さない (§10.3)
// best-effort: 個々の move 失敗は無視して可能な限り移す。
export function moveFounderFamilyToHouse(
  state: WorldState,
  founderPersonId: PersonId,
  newHouseId: HouseId,
): WorldState {
  const founder = state.persons[founderPersonId]
  if (!founder) return state
  const founderOldHouseId = founder.houseId

  // 移動候補を move 前に snapshot する (move で houseId が変わるため)。
  const memberIds: PersonId[] = []
  if (founder.spouseId !== undefined) {
    const spouse = state.persons[founder.spouseId]
    if (
      spouse &&
      spouse.alive &&
      spouse.houseId === founderOldHouseId &&
      !isImmovableForFamilyMove(state, spouse.id)
    ) {
      memberIds.push(spouse.id)
    }
  }
  for (const childId of founder.childIds) {
    const child = state.persons[childId]
    if (
      child &&
      child.alive &&
      child.houseId === founderOldHouseId &&
      !isImmovableForFamilyMove(state, child.id)
    ) {
      memberIds.push(childId)
    }
  }

  let current = state
  // founder 本人を先に移す。
  const founderMove = movePersonToHouse(current, founderPersonId, newHouseId)
  if (founderMove.ok) current = founderMove.value
  for (const memberId of memberIds) {
    const move = movePersonToHouse(current, memberId, newHouseId)
    if (move.ok) current = move.value
  }
  return current
}

// 家族移動から除外すべきか: active polity/holding office holder (leader / title holder / bailiff 含む)。
function isImmovableForFamilyMove(state: WorldState, personId: PersonId): boolean {
  const polityOfficeIds = state.officeIndex.byHolderPerson[personId as string] ?? []
  for (const oaId of polityOfficeIds) {
    const oa = state.officeAssignments[oaId]
    if (oa && oa.active) return true
  }
  const holdingOfficeIds = state.holdingOfficeIndex.byHolderPerson[personId] ?? []
  for (const hoId of holdingOfficeIds) {
    const ho = state.holdingOfficeAssignments[hoId]
    if (ho && ho.active) return true
  }
  return false
}

export function addPersonWealth(state: WorldState, personId: PersonId, delta: number): StateResult {
  const person = state.persons[personId]
  if (!person)
    return err({
      code: 'PERSON_NOT_FOUND',
      message: 'addPersonWealth: person not found: ' + personId,
    })
  return ok({
    ...state,
    persons: {
      ...state.persons,
      [personId]: { ...person, wealth: Math.max(0, person.wealth + delta) },
    },
  })
}

export function clearPersonWealth(state: WorldState, personId: PersonId): StateResult {
  const person = state.persons[personId]
  if (!person)
    return err({
      code: 'PERSON_NOT_FOUND',
      message: 'clearPersonWealth: person not found: ' + personId,
    })
  return ok({
    ...state,
    persons: { ...state.persons, [personId]: { ...person, wealth: 0 } },
  })
}

export function birthChild(
  ctx: TickContext,
  input: BirthChildInput,
): CtxResult<{ childId: PersonId }> {
  const father = ctx.state.persons[input.fatherId]
  if (!father)
    return err({
      code: 'PERSON_NOT_FOUND',
      message: 'birthChild: father not found: ' + input.fatherId,
    })

  if (!father.houseId)
    return err({
      code: 'HOUSE_NOT_FOUND',
      message: 'birthChild: father has no house: ' + input.fatherId,
    })
  const house = ctx.state.houses[father.houseId]
  if (!house)
    return err({
      code: 'HOUSE_NOT_FOUND',
      message: 'birthChild: house not found: ' + father.houseId,
    })

  const { id: childId, ctx: ctxWithId } = makePersonId(ctx)

  // v0.45: 天才も初期能力は通常サンプル (age 0 でほぼ 0)。天賦との大差が
  // ギャップ比例成長 (abilityGrowthGapFactor) により幼少期の高速成長として現れる。
  const { value: abilities, rng: rngAfterAbilities } = sampleAbilitiesFromAptitudes(
    input.aptitudes,
    0,
    ctxWithId.rng,
    ctxWithId.config,
  )

  const childPerson = buildPerson({
    id: childId,
    nameKey: input.nameKey,
    sex: input.sex,
    age: 0,
    lifeStage: 'childhood',
    houseId: father.houseId,
    birthStatus: input.birthStatus,
    abilities,
    aptitudes: input.aptitudes,
    traits: input.traits,
    fatherId: input.fatherId,
    ...(input.motherId !== undefined ? { motherId: input.motherId } : {}),
    ...(input.geniusType !== undefined ? { geniusType: input.geniusType } : {}),
  })

  let newPersons: Record<PersonId, Person> = { ...ctxWithId.state.persons, [childId]: childPerson }

  const updatedFather = newPersons[input.fatherId]
  if (updatedFather) {
    newPersons = {
      ...newPersons,
      [input.fatherId]: { ...updatedFather, childIds: [...updatedFather.childIds, childId] },
    }
  }

  if (input.motherId) {
    const updatedMother = newPersons[input.motherId]
    if (updatedMother) {
      newPersons = {
        ...newPersons,
        [input.motherId]: { ...updatedMother, childIds: [...updatedMother.childIds, childId] },
      }
    }
  }

  const newHouses = { ...ctxWithId.state.houses }
  const updatedHouse = newHouses[father.houseId]
  if (updatedHouse) {
    newHouses[father.houseId] = {
      ...updatedHouse,
      memberIds: [...updatedHouse.memberIds, childId],
    }
  }

  const newState = {
    ...ctxWithId.state,
    persons: newPersons,
    houses: newHouses,
    livingPersonIds: [...ctxWithId.state.livingPersonIds, childId].sort(),
  }
  return ok({
    ctx: { ...ctxWithId, rng: rngAfterAbilities, state: newState },
    value: { childId },
  })
}
