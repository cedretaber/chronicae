import type { TickContext } from './context'
import type { PolityId } from '../types/ids'
import type { Polity } from '../types/polity'
import { getPolityAdminPower } from '@sim/selectors/statusSelectors'

export function runGovernanceSystem(ctx: TickContext): TickContext {
  let currentCtx = ctx

  // v013-residual: simple-batch — 全 polity の adminPower 計算後の単一バッチ書き込み。将来 setPolityAdminPower() で代替可
  const polityIds = Object.keys(currentCtx.state.polities).sort()
  const newPolities: Record<PolityId, Polity> = { ...currentCtx.state.polities }

  for (const polityId of polityIds) {
    const polity = currentCtx.state.polities[polityId as PolityId]
    if (!polity) continue
    if (!polity.active) continue

    const adminPower = getPolityAdminPower(
      currentCtx.state,
      currentCtx.config,
      polityId as PolityId,
    )

    newPolities[polityId as PolityId] = {
      ...polity,
      adminPower,
    }
  }

  currentCtx = { ...currentCtx, state: { ...currentCtx.state, polities: newPolities } }

  return currentCtx
}
