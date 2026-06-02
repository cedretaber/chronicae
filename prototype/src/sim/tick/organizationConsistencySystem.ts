import type { TickContext } from './context'
import { createSimEvent } from './context'
import type { PolityId } from '../types/ids'
import { nameParam, entityRef } from '../types/event'
import { getPolityHouseIds } from '../selectors/polityRelations'
import { removeOrganizationShare } from '../mutations/shareMutations'
import { revokeOfficeAssignment } from '../mutations/officeMutations'
import { getActiveFactionMembership } from '../selectors/factionSelectors'
import { getActiveOfficeHolders, getEffectiveOfficeMaxHolders } from '../selectors/officeSelectors'
import type { OfficeRole, OrganizationRef } from '../types/office'

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
    // commonwealth Polity の Person-direct holder (rebel leader) は houseId が
    //   eligibleHouseIds に含まれなくても eligible 扱いする。commonwealth は owner house を
    //   持たない person-direct share モデル (§17) であり、getPolityHouseIds は空を返すため、
    //   house eligibility に紐付けると leader (houseless でも、独立元の国の支配家出身の
    //   housed でも) の share が道連れで削除され commonwealth が headless 化する。
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
        } else if (polity.kind === 'commonwealth') {
          // commonwealth の person-direct holder は houseId に関わらず eligible
          shouldRemove = false
        } else if (!person.houseId) {
          // 非 commonwealth の houseless direct holder は不適格
          shouldRemove = true
        } else {
          const house = currentCtx.state.houses[person.houseId]
          const isFactionMember =
            getActiveFactionMembership(currentCtx.state, share.holder.id) !== undefined
          if (!isFactionMember) {
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
    // commonwealth Polity の Person-direct holder (rebel leader) は Step 1 と同じく eligible 扱い
    // (owner house を持たない person-direct モデルのため house eligibility に紐付けない)
    const officeIds = [...(currentCtx.state.officeIndex.byOrganization[orgKey] ?? [])]
    for (const officeId of officeIds) {
      const office = currentCtx.state.officeAssignments[officeId]
      if (!office || !office.active) continue
      const person = currentCtx.state.persons[office.holderPersonId]
      if (!person || !person.alive) continue // 別系統の不整合
      if (polity.kind === 'commonwealth') continue // commonwealth holder は houseId 不問で eligible
      if (!person.houseId) {
        // 非 commonwealth の houseless holder は revoke
        const revokedState = revokeOfficeAssignment(currentCtx.state, office.id)
        const holder = revokedState.persons[office.holderPersonId]
        const { event, ctx: eventCtx } = createSimEvent(
          { ...currentCtx, state: revokedState },
          {
            type: 'OFFICE_REVOKED',
            importance: 'normal',
            messageKey: 'office.revoked',
            messageParams: {
              role: nameParam('role', `polity_${office.role}`),
              organization: nameParam('polity', polity.nameKey),
            },
            entityRefs: [
              entityRef('person', office.holderPersonId, 'holder', holder?.nameKey),
              entityRef('polity', polityId, 'organization', polity?.nameKey),
            ],
          },
        )
        currentCtx = { ...eventCtx, events: [...eventCtx.events, event] }
        continue
      }
      const house = currentCtx.state.houses[person.houseId]
      const houseEligible = house && house.active && eligibleHouseIds.has(house.id)
      const isFactionMember =
        getActiveFactionMembership(currentCtx.state, office.holderPersonId) !== undefined
      if (houseEligible || isFactionMember) continue

      const revokedState = revokeOfficeAssignment(currentCtx.state, office.id)
      const holder = revokedState.persons[office.holderPersonId]
      const { event, ctx: eventCtx } = createSimEvent(
        { ...currentCtx, state: revokedState },
        {
          type: 'OFFICE_REVOKED',
          importance: 'normal',
          messageKey: 'office.revoked',
          messageParams: {
            role: nameParam('role', `polity_${office.role}`),
            organization: nameParam('polity', polity.nameKey),
          },
          entityRefs: [
            entityRef('person', office.holderPersonId, 'holder', holder?.nameKey),
            ...(house ? [entityRef('house', house.id, 'house', house.nameKey)] : []),
            entityRef('polity', polityId, 'organization', polity?.nameKey),
          ],
        },
      )
      currentCtx = { ...eventCtx, events: [...eventCtx.events, event] }
    }

    // Step 3: rank ベースの定員超過 revoke
    // polity の rank / province 数に対して effective maxHolders を超える役職者を解任する。
    // 最も新しい任命（startYear が大きい）から順に解任。
    const POLITY_ROLES: OfficeRole[] = ['administrator', 'treasurer', 'military', 'advisor']
    const polityRef: OrganizationRef = { kind: 'polity', id: polityId }
    for (const role of POLITY_ROLES) {
      const effectiveMax = getEffectiveOfficeMaxHolders(
        currentCtx.state,
        currentCtx.config,
        polityRef,
        role,
      )
      const holderIds = getActiveOfficeHolders(currentCtx.state, polityRef, role)
      if (holderIds.length <= effectiveMax) continue

      const assignments = holderIds
        .flatMap((pid) => {
          const ids = currentCtx.state.officeIndex.byOrganization[orgKey] ?? []
          for (const oid of ids) {
            const o = currentCtx.state.officeAssignments[oid]
            if (o && o.active && o.role === role && o.holderPersonId === pid) {
              return [o]
            }
          }
          return []
        })
        .sort((a, b) => b.startYear - a.startYear)

      const excess = assignments.slice(0, assignments.length - effectiveMax)
      for (const office of excess) {
        const revokedState = revokeOfficeAssignment(currentCtx.state, office.id)
        const holder = revokedState.persons[office.holderPersonId]
        const houseId = holder?.houseId
        const house = houseId ? revokedState.houses[houseId] : undefined
        const { event, ctx: eventCtx } = createSimEvent(
          { ...currentCtx, state: revokedState },
          {
            type: 'OFFICE_REVOKED',
            importance: 'normal',
            messageKey: 'office.revoked',
            messageParams: {
              role: nameParam('role', `polity_${office.role}`),
              organization: nameParam('polity', polity.nameKey),
            },
            entityRefs: [
              entityRef('person', office.holderPersonId, 'holder', holder?.nameKey),
              ...(house ? [entityRef('house', house.id, 'house', house.nameKey)] : []),
              entityRef('polity', polityId, 'organization', polity?.nameKey),
            ],
          },
        )
        currentCtx = { ...eventCtx, events: [...eventCtx.events, event] }
      }
    }
  }

  return currentCtx
}
