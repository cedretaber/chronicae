import type { TickContext } from './context'
import { createSimEvent } from './context'
import type { PolityId } from '../types/ids'
import { nameParam, entityRef } from '../types/event'
import { getPolityHouseIds } from '../selectors/polityRelations'
import { revokeOfficeAssignment } from '../mutations/officeMutations'
import { getActiveFactionMembership } from '../selectors/factionSelectors'
import { getPolityOfficeAppointmentRight } from '../selectors/politicalRightSelectors'
import { getActiveOfficeHolders, getEffectiveOfficeMaxHolders } from '../selectors/officeSelectors'
import { getPolityNameRefForEmitFromPolity } from '../selectors/nameRefSelectors'
import type { OfficeRole, OrganizationRef } from '../types/office'

// v0.15 §11.4: PolityOwnerConsistencySystem の後段で実行。
// Polity Share / Office の保持資格を監査し、不適格を削除/revoke する。
export function runOrganizationConsistencySystem(ctx: TickContext): TickContext {
  let currentCtx = ctx
  const polityIds = (Object.keys(currentCtx.state.polities) as PolityId[]).sort()

  for (const polityId of polityIds) {
    const polity = currentCtx.state.polities[polityId]
    if (!polity || !polity.active) continue
    const polityNameRef = getPolityNameRefForEmitFromPolity(currentCtx.state, polity)

    const eligibleHouseIds = new Set<string>(getPolityHouseIds(currentCtx.state, polityId))

    // v0.42c: Step 1 (polity share cleanup) は polity share 廃止に伴い削除。
    const orgKey = `polity:${polityId}`

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

      // v0.42 §9.4: Right 由来任命の例外 (狭い判定)。対象 role に active な
      // polity_office_appointment right があり、holder が House なら同 House の holder を、
      // Person なら本人のみを eligible 扱いする。これを入れないと right 任命が最大 4 週で
      // 黙って revoke され right system が機能しない (§21.1)。
      // Phase 1 stub: slot 0 固定 (Phase 2 で office.slotIndex に差替)
      const appointmentRight = getPolityOfficeAppointmentRight(
        currentCtx.state,
        polityId,
        office.role,
        0,
      )
      if (appointmentRight) {
        if (
          appointmentRight.holder.kind === 'house' &&
          person.houseId === appointmentRight.holder.id
        ) {
          continue
        }
        if (
          appointmentRight.holder.kind === 'person' &&
          office.holderPersonId === appointmentRight.holder.id
        ) {
          continue
        }
      }

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
              organization: nameParam(polityNameRef.category, polityNameRef.nameKey),
            },
            entityRefs: [
              entityRef('person', office.holderPersonId, 'holder', holder?.nameKey),
              entityRef('polity', polityId, 'organization', polityNameRef.nameKey),
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
            organization: nameParam(polityNameRef.category, polityNameRef.nameKey),
          },
          entityRefs: [
            entityRef('person', office.holderPersonId, 'holder', holder?.nameKey),
            ...(house ? [entityRef('house', house.id, 'house', house.nameKey)] : []),
            entityRef('polity', polityId, 'organization', polityNameRef.nameKey),
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
              organization: nameParam(polityNameRef.category, polityNameRef.nameKey),
            },
            entityRefs: [
              entityRef('person', office.holderPersonId, 'holder', holder?.nameKey),
              ...(house ? [entityRef('house', house.id, 'house', house.nameKey)] : []),
              entityRef('polity', polityId, 'organization', polityNameRef.nameKey),
            ],
          },
        )
        currentCtx = { ...eventCtx, events: [...eventCtx.events, event] }
      }
    }
  }

  return currentCtx
}
