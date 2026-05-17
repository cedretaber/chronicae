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
