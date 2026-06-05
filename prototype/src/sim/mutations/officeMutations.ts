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
  slotIndex?: number,
): WorldState {
  const orgKeyStr = orgKey(organization)

  // v0.42 slot 単位任命権: 明示指定がなければ active な同 (org, role) の最小未使用番号を採番
  let resolvedSlotIndex = slotIndex
  if (resolvedSlotIndex === undefined) {
    const used = new Set<number>()
    for (const oid of state.officeIndex.byOrganization[orgKeyStr] ?? []) {
      const o = state.officeAssignments[oid]
      if (o && o.active && o.role === role) used.add(o.slotIndex)
    }
    resolvedSlotIndex = 0
    while (used.has(resolvedSlotIndex)) resolvedSlotIndex++
  }

  const id = createOfficeAssignmentId(state.nextOfficeAssignmentId)
  const newOffice = {
    id,
    organization,
    role,
    holderPersonId,
    slotIndex: resolvedSlotIndex,
    active: true,
    startYear: state.currentYear,
    unpaidCount: 0,
  }

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

// v0.17.3 B: 失効した OfficeAssignment は完全削除する。
// 旧版は `active: false` をセットして残置していたため、state.officeAssignments と
// officeIndex の両方が累積して O(N) 走査系 (integrityCheck / officeCompensationSystem)
// が肥大化していた。selectors はすべて `if (!o || !o.active) continue` のガードを通る
// ため、delete と active=false は意味的に等価。
export function revokeOfficeAssignment(
  state: WorldState,
  officeId: OfficeAssignmentId,
): WorldState {
  const office = state.officeAssignments[officeId]
  if (!office || !office.active) return state

  const orgKeyStr = orgKey(office.organization)
  const personKeyStr = office.holderPersonId as string

  const nextAssignments = { ...state.officeAssignments }
  delete nextAssignments[officeId]

  const orgSlot = (state.officeIndex.byOrganization[orgKeyStr] ?? []).filter(
    (id) => id !== officeId,
  )
  const personSlot = (state.officeIndex.byHolderPerson[personKeyStr] ?? []).filter(
    (id) => id !== officeId,
  )

  return {
    ...state,
    officeAssignments: nextAssignments,
    officeIndex: {
      byOrganization: { ...state.officeIndex.byOrganization, [orgKeyStr]: orgSlot },
      byHolderPerson: { ...state.officeIndex.byHolderPerson, [personKeyStr]: personSlot },
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

// v0.17 §6.5: OfficeAssignment term expiration → 削除。
// v0.17.3 B: revokeOfficeAssignment と同様に完全削除する。
// 任期切れと revoke は意味的に区別したいが、state 上は同じ「消滅」として扱う
// (event 側で OFFICE_TERM_ENDED / OFFICE_REVOKED の区別を保持済み)。
export function expireOfficeTermAssignment(
  state: WorldState,
  officeId: OfficeAssignmentId,
): WorldState {
  return revokeOfficeAssignment(state, officeId)
}
