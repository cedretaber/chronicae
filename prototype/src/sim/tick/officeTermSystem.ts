import type { TickContext } from './context'
import { createSimEvent } from './context'
import type { OfficeAssignmentId } from '../types/ids'
import { isOfficeTermExpired, getOrganizationOfficeEntityRefs } from '../selectors/officeSelectors'
import { expireOfficeTermAssignment } from '../mutations/officeMutations'
import { nameParam, entityRef } from '../types/event'

// v0.17 §6.5: Every January, expire non-leader offices whose term has elapsed.
export function runOfficeTermSystem(ctx: TickContext): TickContext {
  let currentCtx = ctx

  const officeIds = (Object.keys(currentCtx.state.officeAssignments) as OfficeAssignmentId[]).sort()
  for (const officeId of officeIds) {
    const office = currentCtx.state.officeAssignments[officeId]
    if (!office || !office.active) continue
    if (office.role === 'leader') continue
    if (!isOfficeTermExpired(currentCtx.state, currentCtx.config, office)) continue

    const holder = currentCtx.state.persons[office.holderPersonId]
    const holderHouseId = holder?.houseId

    const expiredState = expireOfficeTermAssignment(currentCtx.state, officeId)
    currentCtx = { ...currentCtx, state: expiredState }

    const { event, ctx: ec } = createSimEvent(currentCtx, {
      type: 'OFFICE_TERM_ENDED',
      importance: 'normal',
      messageKey: 'office.term_ended',
      messageParams: {
        person: holder ? nameParam('person', holder.nameKey) : office.holderPersonId,
        role: nameParam('role', `${office.organization.kind}_${office.role}`),
      },
      entityRefs: [
        entityRef('person', office.holderPersonId, 'holder', holder?.nameKey),
        ...(holderHouseId ? [entityRef('house', holderHouseId, 'house')] : []),
        ...getOrganizationOfficeEntityRefs(office.organization),
      ],
    })
    currentCtx = { ...ec, events: [...ec.events, event] }
  }

  return currentCtx
}
