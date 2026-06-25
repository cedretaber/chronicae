import type { TickContext } from './context'
import { createSimEvent } from './context'
import type { MerchantCompanyId } from '../types/ids'
import type { OrganizationRef } from '../types/office'
import {
  getActiveOfficeHolders,
  getOrganizationOfficeEntityRefs,
} from '../selectors/officeSelectors'
import { getMerchantCompanyDecisionMaker } from '../selectors/merchantSelectors'
import { createOfficeAssignment, revokeOfficesByOrganization } from '../mutations/officeMutations'
import { nameParam, entityRef } from '../types/event'

// v0.61 §8.1: 会長 (= share rawPower 最上位 = getMerchantCompanyDecisionMaker) を
//   merchant_company:leader OfficeAssignment に同期する weekly system。
//   appointmentSystem には乗せず、ここで share 由来の会長を leader office に合わせる
//   (House leader 同期と同型)。death を生む全 system の後・cleanup/integrity の前に置く。
//   active でない company (bankrupt/dormant/dissolved) は leader/administrator を revoke し shell 化する。
export function runMerchantCompanyOfficeSyncSystem(ctx: TickContext): TickContext {
  let currentCtx = ctx

  for (const companyId of Object.keys(
    currentCtx.state.merchantCompanies,
  ).sort() as MerchantCompanyId[]) {
    const company = currentCtx.state.merchantCompanies[companyId]
    if (!company) continue
    const ref: OrganizationRef = { kind: 'merchant_company', id: companyId }

    if (company.status !== 'active') {
      // shell 化: 全 office を revoke。
      const revoked = revokeOfficesByOrganization(currentCtx.state, ref)
      if (revoked !== currentCtx.state) currentCtx = { ...currentCtx, state: revoked }
      continue
    }

    const decisionMaker = getMerchantCompanyDecisionMaker(currentCtx.state, companyId)
    const currentLeaders = getActiveOfficeHolders(currentCtx.state, ref, 'leader')
    const currentLeader = currentLeaders[0]

    // 既に正しい会長が leader office を 1 つだけ持っているなら何もしない。
    if (decisionMaker && currentLeaders.length === 1 && currentLeader === decisionMaker) {
      continue
    }

    // 付け替え: 既存 leader office を全 revoke。
    let state = revokeOfficesByOrganization(currentCtx.state, ref, 'leader')

    if (!decisionMaker) {
      // 会長候補不在: leader 空席のまま。
      if (state !== currentCtx.state) currentCtx = { ...currentCtx, state }
      continue
    }

    state = createOfficeAssignment(state, ref, 'leader', decisionMaker)
    currentCtx = { ...currentCtx, state }

    const person = currentCtx.state.persons[decisionMaker]
    if (person) {
      const { event, ctx: ec } = createSimEvent(currentCtx, {
        type: 'OFFICE_ASSIGNED',
        importance: 'normal',
        messageKey: 'office.assigned_merchant_company',
        messageParams: {
          person: nameParam('person', person.nameKey),
          role: nameParam('role', 'merchant_company_leader'),
          company: nameParam('house', company.nameKey),
        },
        entityRefs: [
          entityRef('person', decisionMaker, 'appointee', person.nameKey),
          ...getOrganizationOfficeEntityRefs(ref),
        ],
      })
      currentCtx = { ...ec, events: [...ec.events, event] }
    }
  }

  return currentCtx
}
