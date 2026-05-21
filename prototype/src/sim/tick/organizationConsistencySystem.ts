import type { TickContext } from './context'
import { createSimEvent } from './context'
import type { PolityId } from '../types/ids'
import { nameParam, entityRef } from '../types/event'
import { getPolityHouseIds } from '../selectors/polityRelations'
import { removeOrganizationShare } from '../mutations/shareMutations'
import { revokeOfficeAssignment } from '../mutations/officeMutations'
import { ANONYMOUS_HOUSE_ID } from '../types/house'

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
    // House holder: 当該 House が Polity の eligibleHouseIds に含まれなければ削除
    // Person holder (§17 commonwealth / 独裁者・僭主): 当該 Person が dead / placeholder /
    //   不在、もしくは houseId が inactive または eligibleHouseIds に含まれなければ削除
    // v0.18-pre: commonwealth Polity の AnonymousHouse 所属 Person-direct holder (rebel founder)
    //            は houseId が eligibleHouseIds に含まれなくても eligible 扱いする
    const orgKey = `polity:${polityId}`
    const shareIds = [...(currentCtx.state.shareIndex.byOrganization[orgKey] ?? [])]
    for (const shareId of shareIds) {
      const share = currentCtx.state.organizationShares[shareId]
      if (!share) continue
      let shouldRemove = false
      if (share.holder.kind === 'house') {
        shouldRemove = !eligibleHouseIds.has(share.holder.id)
      } else {
        const person = currentCtx.state.persons[share.holder.id]
        if (!person || !person.alive || person.kind === 'placeholder') {
          shouldRemove = true
        } else {
          const house = currentCtx.state.houses[person.houseId]
          const isCommonwealthRebelHolder =
            polity.kind === 'commonwealth' && person.houseId === ANONYMOUS_HOUSE_ID
          if (!isCommonwealthRebelHolder) {
            if (!house || !house.active || !eligibleHouseIds.has(house.id)) {
              shouldRemove = true
            }
          }
        }
      }
      if (shouldRemove) {
        currentCtx = {
          ...currentCtx,
          state: removeOrganizationShare(currentCtx.state, share.id),
        }
      }
    }

    // Step 2: 不適格 Polity Office revoke + OFFICE_REVOKED 発火
    // v0.18-pre: commonwealth Polity の AnonymousHouse 所属 holder (rebel founder) は eligible 扱い
    const officeIds = [...(currentCtx.state.officeIndex.byOrganization[orgKey] ?? [])]
    for (const officeId of officeIds) {
      const office = currentCtx.state.officeAssignments[officeId]
      if (!office || !office.active) continue
      const person = currentCtx.state.persons[office.holderPersonId]
      if (!person || !person.alive) continue // 別系統の不整合
      const house = currentCtx.state.houses[person.houseId]
      const houseEligible = house && house.active && eligibleHouseIds.has(house.id)
      const isCommonwealthRebelHolder =
        polity.kind === 'commonwealth' && person.houseId === ANONYMOUS_HOUSE_ID
      if (houseEligible || isCommonwealthRebelHolder) continue

      const revokedState = revokeOfficeAssignment(currentCtx.state, office.id)
      const holder = revokedState.persons[office.holderPersonId]
      const { event, ctx: eventCtx } = createSimEvent(
        { ...currentCtx, state: revokedState },
        {
          type: 'OFFICE_REVOKED',
          importance: 'normal',
          messageKey: 'office.revoked',
          messageParams: {
            role: office.role,
            organization: nameParam('polity', polity.nameKey, polity.name),
          },
          entityRefs: [
            entityRef('person', office.holderPersonId, 'holder', holder?.nameKey),
            ...(house ? [entityRef('house', house.id, 'house', house.nameKey)] : []),
            entityRef('polity', polityId, 'organization', polity?.nameKey),
          ],
          legacySummary: `Office of ${office.role} in ${polity.name} was revoked as the holder's house no longer holds province in this polity.`,
          legacyActorIds: [office.holderPersonId],
          legacyHouseIds: house ? [house.id] : [],
          legacyPolityIds: [polityId],
        },
      )
      currentCtx = { ...eventCtx, events: [...eventCtx.events, event] }
    }
  }

  return currentCtx
}
