// v0.42 §17: POLITICAL_RIGHT_* イベントの emit helper。
//
// - GRANTED: acquire_political_right project 完了時 (projectOutcomeSystem)
// - REVOKED: rightConsistencySystem の drift 回収時 (mutation cascade は silent — office と同じ)
// - TRANSFERRED: holder 付替時。v0.42 では通常発火経路が無い (争奪・剥奪は future)。
//   unit test で emit→render の placeholder 健全性を固定する。
//
// messageParams 規約 (§17.2): raw ID を入れない。nameKey / enum 値のみ。ID は entityRefs。
// rightKind / revokeReason は eventRenderer が events ns の enum.<key>.<value> ラベルに解決する。

import type { TickContext } from './context'
import { createSimEvent } from './context'
import type { WorldState } from '../types/world'
import type {
  PoliticalRight,
  PoliticalRightHolderRef,
  PoliticalRightTargetRef,
} from '../types/politicalRight'
import { getPoliticalRightKindFromTarget } from '../types/politicalRight'
import type { EventEntityRef, LocalizedNameParam } from '../types/event'
import { nameParam, entityRef } from '../types/event'
import type { PoliticalRightRevokeReason } from './rightConsistencySystem'
import { getPolityNameRefForEmit, getHoldingNameRefForEmit } from '../selectors/nameRefSelectors'

function holderNameParam(state: WorldState, holder: PoliticalRightHolderRef): LocalizedNameParam {
  if (holder.kind === 'person') {
    return nameParam('person', state.persons[holder.id]?.nameKey ?? holder.id)
  }
  return nameParam('house', state.houses[holder.id]?.nameKey ?? holder.id)
}

// target の表示名: office → role 名 / holding → holding 名 / regiment → 本拠 province 名
// (regiment は固有名を持たないため、本拠地名で「どこの連隊か」を表す)
function targetNameParam(state: WorldState, target: PoliticalRightTargetRef): LocalizedNameParam {
  switch (target.kind) {
    case 'polity_office_role':
      return nameParam('role', `polity_${target.role}`)
    case 'holding_office_role': {
      const ref = getHoldingNameRefForEmit(state, target.holdingId)
      return nameParam(ref.category, ref.nameKey)
    }
    case 'regiment': {
      const regiment = state.regiments[target.regimentId]
      const provinceId = regiment?.homeProvinceId
      const provinceNameKey =
        provinceId !== undefined ? (state.provinces[provinceId]?.nameKey ?? provinceId) : 'unknown'
      return nameParam('province', provinceNameKey)
    }
  }
}

function buildEntityRefs(state: WorldState, right: PoliticalRight): EventEntityRef[] {
  const refs: EventEntityRef[] = []
  if (right.holder.kind === 'person') {
    refs.push(
      entityRef('person', right.holder.id, 'right_holder', state.persons[right.holder.id]?.nameKey),
    )
  } else {
    refs.push(
      entityRef('house', right.holder.id, 'right_holder', state.houses[right.holder.id]?.nameKey),
    )
  }
  const polityRef = getPolityNameRefForEmit(state, right.polityId)
  refs.push(entityRef('polity', right.polityId, 'polity', polityRef.nameKey))
  if (right.target.kind === 'holding_office_role') {
    const holdingRef = getHoldingNameRefForEmit(state, right.target.holdingId)
    refs.push(entityRef('holding', right.target.holdingId, 'right_target', holdingRef.nameKey))
  } else if (right.target.kind === 'regiment') {
    const provinceId = state.regiments[right.target.regimentId]?.homeProvinceId
    if (provinceId !== undefined) {
      refs.push(
        entityRef('province', provinceId, 'right_target', state.provinces[provinceId]?.nameKey),
      )
    }
  }
  return refs
}

export function emitPoliticalRightGranted(ctx: TickContext, right: PoliticalRight): TickContext {
  const state = ctx.state
  const polityRef = getPolityNameRefForEmit(state, right.polityId)
  const { event, ctx: nextCtx } = createSimEvent(ctx, {
    type: 'POLITICAL_RIGHT_GRANTED',
    importance: 'normal',
    messageKey: 'political_right.granted',
    messageParams: {
      rightKind: getPoliticalRightKindFromTarget(right.target),
      target: targetNameParam(state, right.target),
      holder: holderNameParam(state, right.holder),
      polity: nameParam(polityRef.category, polityRef.nameKey),
    },
    entityRefs: buildEntityRefs(state, right),
  })
  return { ...nextCtx, events: [...nextCtx.events, event] }
}

export function emitPoliticalRightRevoked(
  ctx: TickContext,
  right: PoliticalRight,
  reason: PoliticalRightRevokeReason,
): TickContext {
  const state = ctx.state
  const polityRef = getPolityNameRefForEmit(state, right.polityId)
  const { event, ctx: nextCtx } = createSimEvent(ctx, {
    type: 'POLITICAL_RIGHT_REVOKED',
    importance: 'normal',
    messageKey: 'political_right.revoked',
    messageParams: {
      rightKind: getPoliticalRightKindFromTarget(right.target),
      target: targetNameParam(state, right.target),
      holder: holderNameParam(state, right.holder),
      polity: nameParam(polityRef.category, polityRef.nameKey),
      revokeReason: reason,
    },
    entityRefs: buildEntityRefs(state, right),
  })
  return { ...nextCtx, events: [...nextCtx.events, event] }
}

// newHolder 付替後の right を渡す (holder = 新 holder)。
export function emitPoliticalRightTransferred(
  ctx: TickContext,
  right: PoliticalRight,
): TickContext {
  const state = ctx.state
  const polityRef = getPolityNameRefForEmit(state, right.polityId)
  const { event, ctx: nextCtx } = createSimEvent(ctx, {
    type: 'POLITICAL_RIGHT_TRANSFERRED',
    importance: 'normal',
    messageKey: 'political_right.transferred',
    messageParams: {
      rightKind: getPoliticalRightKindFromTarget(right.target),
      target: targetNameParam(state, right.target),
      holder: holderNameParam(state, right.holder),
      polity: nameParam(polityRef.category, polityRef.nameKey),
    },
    entityRefs: buildEntityRefs(state, right),
  })
  return { ...nextCtx, events: [...nextCtx.events, event] }
}
