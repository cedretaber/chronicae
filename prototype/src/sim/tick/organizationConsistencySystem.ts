import type { TickContext } from './context'
import type { PolityId } from '../types/ids'
import type { SimEvent } from '../types/event'
import { makeEventId } from './context'
import { getPolityHouseIds } from '../selectors/polityRelations'
import { removeOrganizationShare } from '../mutations/shareMutations'
import { revokeOfficeAssignment } from '../mutations/officeMutations'

// v0.15 §11.4: PolityOwnerConsistencySystem の後段で実行。
// Polity Share / Office の保持資格を監査し、不適格を削除/revoke する。
export function runOrganizationConsistencySystem(ctx: TickContext): TickContext {
  let currentCtx = ctx
  const polityIds = (Object.keys(currentCtx.state.polities) as PolityId[]).sort()

  for (const polityId of polityIds) {
    const polity = currentCtx.state.polities[polityId]
    if (!polity || !polity.active) continue

    const eligibleHouseIds = new Set<string>(getPolityHouseIds(currentCtx.state, polityId))

    // Step 1: 不適格 Share 削除
    const orgKey = `polity:${polityId}`
    const shareIds = [...(currentCtx.state.shareIndex.byOrganization[orgKey] ?? [])]
    for (const shareId of shareIds) {
      const share = currentCtx.state.organizationShares[shareId]
      if (!share) continue
      if (share.holder.kind !== 'house') continue
      if (!eligibleHouseIds.has(share.holder.id)) {
        currentCtx = {
          ...currentCtx,
          state: removeOrganizationShare(currentCtx.state, share.id),
        }
      }
    }

    // Step 2: 不適格 Polity Office revoke + OFFICE_REVOKED 発火
    const officeIds = [...(currentCtx.state.officeIndex.byOrganization[orgKey] ?? [])]
    for (const officeId of officeIds) {
      const office = currentCtx.state.officeAssignments[officeId]
      if (!office || !office.active) continue
      const person = currentCtx.state.persons[office.holderPersonId]
      if (!person || !person.alive) continue // 別系統の不整合
      const house = currentCtx.state.houses[person.houseId]
      const houseEligible = house && house.active && eligibleHouseIds.has(house.id)
      if (houseEligible) continue

      const revokedState = revokeOfficeAssignment(currentCtx.state, office.id)
      const { id: eventId, ctx: eventCtx } = makeEventId({ ...currentCtx, state: revokedState })
      const event: SimEvent = {
        id: eventId,
        year: eventCtx.state.currentYear,
        month: eventCtx.state.currentMonth,
        type: 'OFFICE_REVOKED',
        importance: 'normal',
        actorIds: [office.holderPersonId],
        houseIds: house ? [house.id] : [],
        polityIds: [polityId],
        provinceIds: [],
        summary: `Office of ${office.role} in ${polity.name} was revoked as the holder's house no longer holds province in this polity.`,
        reasons: [],
        effects: [],
      }
      currentCtx = { ...eventCtx, events: [...eventCtx.events, event] }
    }
  }

  return currentCtx
}
