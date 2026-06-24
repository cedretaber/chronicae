import type { TickContext } from './context'
import type { MerchantCompanyShareId } from '../types/ids'
import { isLivingPerson } from '../types/person'
import { removeMerchantCompanyShareMut } from '../mutations/merchantMutations'

// v0.61 §9.2: 年次の商会 share 更新。v0.61 では deceased holder の share purge と index 同期のみ。
//   会長 (decisionMaker) の再計算は merchantCompanyOfficeSyncSystem が weekly に行うため、
//   share 自体の更新は年次で足りる。出資者政治・乗っ取り・相続は future。
export function runMerchantCompanyShareUpdateSystem(ctx: TickContext): TickContext {
  const state = ctx.state
  // 死亡 holder の share id を収集 (決定的順序)。
  const toRemove: MerchantCompanyShareId[] = []
  for (const id of Object.keys(state.merchantCompanyShares).sort() as MerchantCompanyShareId[]) {
    const share = state.merchantCompanyShares[id]
    if (!share) continue
    if (!isLivingPerson(state.persons[share.holderPersonId])) {
      toRemove.push(id)
    }
  }
  if (toRemove.length === 0) return ctx

  // mutable draft: 触る slice のみ shallow-clone する (removeIndex は配列を filter で置換)。
  const draft = {
    ...state,
    merchantCompanyShares: { ...state.merchantCompanyShares },
    merchantCompanyShareIndex: {
      byCompany: { ...state.merchantCompanyShareIndex.byCompany },
      byHolder: { ...state.merchantCompanyShareIndex.byHolder },
    },
  }
  for (const id of toRemove) {
    removeMerchantCompanyShareMut(draft, id)
  }
  return { ...ctx, state: draft }
}
