import type { WorldState } from '@sim/types/world'
import type { PersonId, OfficeAssignmentId } from '@sim/types/ids'
import type { OrganizationRef, OfficeRole } from '@sim/types/office'
import { createOfficeAssignmentId } from '@sim/types/ids'
import type { StateResult } from './result'
import { ok, err } from './result'

export type AssignOfficeInput = {
  organization: OrganizationRef
  role: OfficeRole
  holderPersonId: PersonId
  replaceExisting?: boolean
}

function orgKey(org: OrganizationRef): string {
  return `${org.kind}:${org.id}`
}

export function createOfficeAssignment(
  state: WorldState,
  organization: OrganizationRef,
  role: OfficeRole,
  holderPersonId: PersonId,
): WorldState {
  const id = createOfficeAssignmentId(state.nextOfficeAssignmentId)
  const newOffice = {
    id,
    organization,
    role,
    holderPersonId,
    active: true,
    startYear: state.currentYear,
    unpaidCount: 0,
  }

  const orgKeyStr = orgKey(organization)
  const personKeyStr = holderPersonId as string

  const existingByOrg = state.officeIndex.byOrganization[orgKeyStr] ?? []
  const existingByPerson = state.officeIndex.byHolderPerson[personKeyStr] ?? []

  return {
    ...state,
    nextOfficeAssignmentId: state.nextOfficeAssignmentId + 1,
    officeAssignments: {
      ...state.officeAssignments,
      [id]: newOffice,
    },
    officeIndex: {
      byOrganization: {
        ...state.officeIndex.byOrganization,
        [orgKeyStr]: [...existingByOrg, id],
      },
      byHolderPerson: {
        ...state.officeIndex.byHolderPerson,
        [personKeyStr]: [...existingByPerson, id],
      },
    },
  }
}

export function revokeOfficeAssignment(
  state: WorldState,
  officeId: OfficeAssignmentId,
): WorldState {
  const office = state.officeAssignments[officeId]
  if (!office || !office.active) return state

  const updatedOffice = { ...office, active: false }

  return {
    ...state,
    officeAssignments: {
      ...state.officeAssignments,
      [officeId]: updatedOffice,
    },
  }
}

export function revokeOfficesByHolder(state: WorldState, personId: PersonId): WorldState {
  const personKeyStr = personId as string
  const ids = state.officeIndex.byHolderPerson[personKeyStr] ?? []
  let current = state
  for (const id of ids) {
    current = revokeOfficeAssignment(current, id)
  }
  return current
}

export function revokeOfficesByOrganization(
  state: WorldState,
  organization: OrganizationRef,
  role?: OfficeRole,
): WorldState {
  const orgKeyStr = orgKey(organization)
  const ids = state.officeIndex.byOrganization[orgKeyStr] ?? []
  let current = state
  for (const id of ids) {
    const office = current.officeAssignments[id]
    if (!office || !office.active) continue
    if (role !== undefined && office.role !== role) continue
    current = revokeOfficeAssignment(current, id)
  }
  return current
}

export function assignOffice(state: WorldState, input: AssignOfficeInput): StateResult {
  const person = state.persons[input.holderPersonId]
  if (!person)
    return err({
      code: 'PERSON_NOT_FOUND',
      message: 'assignOffice: holder not found: ' + input.holderPersonId,
    })
  if (!person.alive)
    return err({
      code: 'PERSON_DEAD',
      message: 'assignOffice: holder is not alive: ' + input.holderPersonId,
    })

  let currentState = state
  if (input.replaceExisting) {
    currentState = revokeOfficesByOrganization(currentState, input.organization, input.role)
  }
  currentState = createOfficeAssignment(
    currentState,
    input.organization,
    input.role,
    input.holderPersonId,
  )
  return ok(currentState)
}
