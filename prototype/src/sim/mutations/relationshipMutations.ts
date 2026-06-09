import type { PersonId } from '../types/ids'
import type { WorldState } from '../types/world'
import type { StateResult } from './result'
import { ok, err } from './result'

export function setSpouse(
  state: WorldState,
  personAId: PersonId,
  personBId: PersonId,
): StateResult {
  const personA = state.persons[personAId]
  if (!personA)
    return err({ code: 'PERSON_NOT_FOUND', message: 'setSpouse: personA not found: ' + personAId })

  const personB = state.persons[personBId]
  if (!personB)
    return err({ code: 'PERSON_NOT_FOUND', message: 'setSpouse: personB not found: ' + personBId })

  if (personA.spouseId !== undefined)
    return err({ code: 'INTEGRITY_VIOLATION', message: 'setSpouse: personA already has a spouse' })
  if (personB.spouseId !== undefined)
    return err({ code: 'INTEGRITY_VIOLATION', message: 'setSpouse: personB already has a spouse' })

  const newPersons = { ...state.persons }
  newPersons[personAId] = { ...personA, spouseId: personBId }
  newPersons[personBId] = { ...personB, spouseId: personAId }

  return ok({ ...state, persons: newPersons })
}

export function clearSpouse(state: WorldState, personId: PersonId): StateResult {
  const person = state.persons[personId]
  if (!person)
    return err({
      code: 'PERSON_NOT_FOUND',
      message: 'clearSpouse: person not found: ' + personId,
    })

  if (person.spouseId === undefined) return ok(state)

  const spouseId = person.spouseId
  const newPersons = { ...state.persons }

  const { spouseId: _sp1, ...personWithoutSpouse } = person
  void _sp1
  newPersons[personId] = personWithoutSpouse

  const spouse = newPersons[spouseId]
  if (spouse && (spouse.spouseId as string) === (personId as string)) {
    const { spouseId: _sp2, ...spouseWithoutSpouse } = spouse
    void _sp2
    newPersons[spouseId] = spouseWithoutSpouse
  }

  return ok({ ...state, persons: newPersons })
}

// 死別した配偶者を双方の formerSpouseIds に記録する (重複排除・対称)。
// 婚姻 (spouseId) の解消自体は clearSpouse が行う。これは履歴の保持のみ。
export function recordFormerSpouse(
  state: WorldState,
  personId: PersonId,
  formerSpouseId: PersonId,
): WorldState {
  const a = state.persons[personId]
  const b = state.persons[formerSpouseId]
  if (!a || !b) return state

  const addRef = (p: typeof a, ref: PersonId): typeof a => {
    const cur = p.formerSpouseIds ?? []
    if (cur.some((id) => (id as string) === (ref as string))) return p
    return { ...p, formerSpouseIds: [...cur, ref] }
  }

  return {
    ...state,
    persons: {
      ...state.persons,
      [personId]: addRef(a, formerSpouseId),
      [formerSpouseId]: addRef(b, personId),
    },
  }
}

export function addChildToParents(
  state: WorldState,
  childId: PersonId,
  fatherId?: PersonId,
  motherId?: PersonId,
): StateResult {
  const child = state.persons[childId]
  if (!child)
    return err({
      code: 'PERSON_NOT_FOUND',
      message: 'addChildToParents: child not found: ' + childId,
    })

  const newPersons = { ...state.persons }

  if (fatherId !== undefined) {
    const father = newPersons[fatherId]
    if (!father)
      return err({
        code: 'PERSON_NOT_FOUND',
        message: 'addChildToParents: father not found: ' + fatherId,
      })
    if (!father.childIds.some((id) => (id as string) === (childId as string))) {
      newPersons[fatherId] = { ...father, childIds: [...father.childIds, childId] }
    }
    const currentChild = newPersons[childId]!
    if (currentChild.fatherId === undefined) {
      newPersons[childId] = { ...currentChild, fatherId }
    }
  }

  if (motherId !== undefined) {
    const mother = newPersons[motherId]
    if (!mother)
      return err({
        code: 'PERSON_NOT_FOUND',
        message: 'addChildToParents: mother not found: ' + motherId,
      })
    if (!mother.childIds.some((id) => (id as string) === (childId as string))) {
      newPersons[motherId] = { ...mother, childIds: [...mother.childIds, childId] }
    }
    const currentChild = newPersons[childId]!
    if (currentChild.motherId === undefined) {
      newPersons[childId] = { ...currentChild, motherId }
    }
  }

  return ok({ ...state, persons: newPersons })
}
