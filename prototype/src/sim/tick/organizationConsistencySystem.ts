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

      // v0.42 §9.4: Right 由来任命の例外 (狭い判定)。着座 slot に active な
      // polity_office_appointment right があり、holder が House なら同 House の holder を、
      // Person なら本人のみを eligible 扱いする。これを入れないと right 任命が最大 4 週で
      // 黙って revoke され right system が機能しない (§21.1)。
      // v0.42 slot 化: 保護は着座 slot の right 保持者に限る (role 全体ではない)。
      const appointmentRight = getPolityOfficeAppointmentRight(
        currentCtx.state,
        polityId,
        office.role,
        office.slotIndex,
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

      // v0.47.x: 無家/有家を分岐させず単一の eligibility 判定に統合する。
      // 旧実装は houseless 分岐 (if !person.houseId) で無条件 revoke しており、§6.32 の
      // 不変条件「active な派閥に所属する人物は eligible」を houseless だけ取りこぼしていた
      // (factional 経路 = getFactionalCandidateScore は house ゲートなし で着座した無家派閥員を
      // 誤って解任していた)。house が undefined でも isFactionMember を見て保持する。
      const house = person.houseId ? currentCtx.state.houses[person.houseId] : undefined
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
          // 有家 (この国に領地喪失/断絶) と無家 (派閥の後ろ盾喪失) で文言を出し分ける。
          messageKey: house ? 'office.revoked' : 'office.revoked_houseless',
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
    // v0.42 slot 化: slotIndex の大きい (列の後ろの) 着座者から順に解任。
    // 先頭スロットほど縮小時に生き残る = 先頭 slot の right の価値が高い。
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
        .sort((a, b) => b.slotIndex - a.slotIndex)

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
            // Step 3 は rank 降格による定員削減が理由 (領地喪失/無家ではない)。
            messageKey: 'office.revoked_capacity',
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
