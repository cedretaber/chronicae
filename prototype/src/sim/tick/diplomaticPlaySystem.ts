import type { TickContext } from './context'
import type { DiplomaticPlayId } from '../types/ids'
import type { DiplomaticPlay } from '../types/diplomaticPlay'
import { progressRevoltNegotiation } from './diplomaticPlayRevolt'
import { progressLandClaim, progressContractTaxRevision } from './diplomaticPlayLandTax'
import { ensureDelegates } from './diplomaticPlayHelpers'

// compute* helpers は diplomaticPlayHelpers へ移設したが、外部 (diplomaticOfferEvaluation 等)
// が './diplomaticPlaySystem' から import しているため re-export で公開 API を維持する。
export {
  computeDefenderTreasuryNeed,
  computeProvinceValue,
  computeStrategicValue,
  computePrestigeLoss,
} from './diplomaticPlayHelpers'

// DiplomaticPlaySystem: active な DiplomaticPlay を毎 tick 進行させる。
//
// v0.30 offer-driven モデル (land_claim / contract_tax_revision):
//   - structural tension を毎 tick 微増
//   - 新 offer が currentOfferId に設定された tick のみ evaluateOffer を実行
//   - accepted → settled、rejected → tension 上昇、play は active 継続
//   - tension >= escalationThreshold → escalated
//   - deadline 到達 → always escalated (no 'failed')
//
// revolt_negotiation (旧モデル維持):
//   - acceptanceScore で progress / tension を更新
//   - progress >= settlementThreshold → settled
//   - deadline → progress > tension なら settled、else escalated / failed
//
// 'escalated' は active 系 status。ConflictResolutionSystem が同 tick 中に解決する。

export function runDiplomaticPlaySystem(ctx: TickContext): TickContext {
  let currentCtx = ctx

  for (const playIdStr of Object.keys(currentCtx.state.diplomaticPlays).sort()) {
    const play = currentCtx.state.diplomaticPlays[playIdStr as DiplomaticPlayId]
    if (!play) continue
    if (play.status !== 'active') continue
    if (play.kind === 'revolt_negotiation') {
      currentCtx = progressRevoltNegotiation(currentCtx, play)
    } else if (play.kind === 'land_claim') {
      currentCtx = progressLandClaim(currentCtx, play)
    } else if (play.kind === 'contract_tax_revision') {
      currentCtx = progressContractTaxRevision(currentCtx, play)
    }
  }

  // Phase 2: Ensure delegates are valid for active plays (spec §10)
  for (const playIdStr of Object.keys(currentCtx.state.diplomaticPlays).sort()) {
    const play = currentCtx.state.diplomaticPlays[playIdStr as DiplomaticPlayId]
    if (!play) continue
    if (play.status !== 'active') continue
    currentCtx = ensureDelegates(currentCtx, play)
  }

  return currentCtx
}

export function cancelOrphanedPlays(ctx: TickContext): TickContext {
  let nextPlays: Record<DiplomaticPlayId, DiplomaticPlay> | undefined
  for (const [idStr, play] of Object.entries(ctx.state.diplomaticPlays)) {
    if (!play || play.status !== 'active') continue

    let shouldCancel = false
    if (play.issue) {
      if (play.issue.kind === 'land_claim') {
        if (!ctx.state.holdings[play.issue.holdingId]) shouldCancel = true
        if (!ctx.state.provinces[play.issue.provinceId]) shouldCancel = true
      }
      if (play.issue.kind === 'contract_tax_revision') {
        if (!ctx.state.holdings[play.issue.holdingId]) shouldCancel = true
        const contract = ctx.state.landContracts[play.issue.landContractId]
        if (!contract) {
          shouldCancel = true
        } else {
          const holdingChain = ctx.state.landContractIndex.byHolding[play.issue.holdingId] ?? []
          if (!holdingChain.includes(play.issue.landContractId)) shouldCancel = true
        }
      }
    }

    if (shouldCancel) {
      if (!nextPlays) nextPlays = { ...ctx.state.diplomaticPlays }
      nextPlays[idStr as DiplomaticPlayId] = { ...play, status: 'cancelled' }
    }
  }
  if (!nextPlays) return ctx
  return { ...ctx, state: { ...ctx.state, diplomaticPlays: nextPlays } }
}
