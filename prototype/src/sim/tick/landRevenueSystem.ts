import type { TickContext } from './context'
import type { ProvinceId, PolityId, PersonId } from '../types/ids'
import type { WorldState } from '../types/world'
import type { PopClass } from '../types/popGroup'
import { calcTreasurerTaxEfficiency } from '../selectors/personAbilityEffects'
import { governanceCompetence } from '../selectors/abilitySelectors'
import { getHoldingProduction, getProvinceProduction } from '../selectors/popEconomySelectors'
import {
  getHoldingLandContractChain,
  isPlaceholderPerson,
} from '../selectors/landContractSelectors'
import { adjustAttitude, personAttitudeKey } from '../helpers/attitudeHelpers'
import {
  getBailiffLocalExtractionRate,
  getBailiffCollectionEfficiency,
  getBailiffFeeRate,
  computeBailiffBurdenComponents,
  getRecentBailiffRevenueTaskStatus,
  getBailiffPolicy,
} from '../selectors/bailiffSelectors'
import { computeHoldingOwnerIncomes } from '../selectors/realEstateSelectors'
import { clamp } from '../utils/math'
import { createLogger } from '../debug/logger'

// perf (v0.47): mutable-draft パターン。かつては addPersonWealth (bailiff fee) /
//   adjustPopAttitude (pop ごと) / adjustProvincePopWealthByClass (province × 3 class) が
//   呼び出しごとに persons / popGroups マップ全体を spread していた。draft は run 冒頭で
//   persons / popGroups を各 1 回浅コピーし、以降は既存キーのオブジェクト置換で
//   per-call 版と bit-identical を保つ (clamp 位置・更新順序・wealth→unrest→attitude の
//   系列を同一に保存)。
export function runLandRevenueSystem(ctx: TickContext): TickContext {
  const log = createLogger(ctx.config.debug)
  const treasuryDeltas = new Map<PolityId, number>()
  const draft: WorldState = {
    ...ctx.state,
    persons: { ...ctx.state.persons },
    popGroups: { ...ctx.state.popGroups },
    houses: { ...ctx.state.houses },
  }

  // 旧 addPersonWealth と同一挙動 (person 不在なら no-op、wealth は 0 でクランプ)。
  const addPersonWealthMut = (personId: PersonId, delta: number): void => {
    const p = draft.persons[personId]
    if (!p) return
    draft.persons[personId] = { ...p, wealth: Math.max(0, p.wealth + delta) }
  }

  for (const provinceId of Object.keys(ctx.state.provinces).sort() as ProvinceId[]) {
    const province = ctx.state.provinces[provinceId]
    if (!province) continue

    let provinceCollected = 0

    for (const holdingId of province.holdingIds) {
      const holding = draft.holdings[holdingId]
      if (!holding) continue

      const grossHoldingRevenue = getHoldingProduction(draft, ctx.config, holdingId)
      if (grossHoldingRevenue <= 0) continue

      // v0.52 owner income: owner あり RealEstateAsset の owner に収益を配分
      // bailiff extraction の対象外 (gross から先に差し引く)
      let ownerIncomeTotalForHolding = 0
      const ownerIncomes = computeHoldingOwnerIncomes(
        draft,
        ctx.config,
        holdingId,
        grossHoldingRevenue,
      )
      for (const entry of ownerIncomes) {
        if (entry.owner.kind === 'house') {
          const house = draft.houses[entry.owner.id]
          if (house && house.active) {
            draft.houses[entry.owner.id] = { ...house, wealth: house.wealth + entry.income }
            ownerIncomeTotalForHolding += entry.income
          }
        }
      }
      const revenueAfterOwnerIncome = grossHoldingRevenue - ownerIncomeTotalForHolding

      const assignmentId = draft.holdingOfficeIndex.byHolding[holdingId]
      let remittanceToTerminal: number

      if (!assignmentId) {
        remittanceToTerminal = revenueAfterOwnerIncome
        provinceCollected += revenueAfterOwnerIncome
      } else {
        const assignment = draft.holdingOfficeAssignments[assignmentId]
        if (!assignment || !assignment.active) {
          remittanceToTerminal = revenueAfterOwnerIncome
          provinceCollected += revenueAfterOwnerIncome
        } else {
          const recentTaskStatus = getRecentBailiffRevenueTaskStatus(draft, assignmentId)
          const localExtractionRate = getBailiffLocalExtractionRate(draft, ctx.config, assignmentId)
          const collectionEfficiency = getBailiffCollectionEfficiency(
            draft,
            ctx.config,
            assignmentId,
            recentTaskStatus,
          )
          const collected = revenueAfterOwnerIncome * localExtractionRate * collectionEfficiency
          const bailiffFeeRate = getBailiffFeeRate(draft, ctx.config, assignmentId)
          const bailiffFee = collected * bailiffFeeRate
          remittanceToTerminal = collected - bailiffFee
          provinceCollected += collected

          if (!isPlaceholderPerson(draft, assignment.holderPersonId) && bailiffFee > 0) {
            const holder = draft.persons[assignment.holderPersonId]
            if (holder && holder.alive) {
              addPersonWealthMut(assignment.holderPersonId, bailiffFee)
            }
          }

          const burdenComponents = computeBailiffBurdenComponents(
            localExtractionRate,
            collectionEfficiency,
            ctx.config.collectionFrictionFactor,
          )

          const popIds = draft.popIndex.byHolding[holdingId]
          if (popIds) {
            if (burdenComponents.collectionFrictionBurdenRate > 0) {
              for (const popId of popIds) {
                const pop = draft.popGroups[popId]
                if (!pop) continue
                const newWealth = clamp(
                  pop.wealth -
                    burdenComponents.collectionFrictionBurdenRate *
                      ctx.config.localExtractionWealthPenalty *
                      (pop.wealth / 100),
                  0,
                  100,
                )
                if (newWealth !== pop.wealth) {
                  draft.popGroups[popId] = { ...pop, wealth: newWealth }
                }
              }
            }

            const burdenOverComfort = Math.max(
              0,
              burdenComponents.totalBurdenRate - ctx.config.comfortableLocalExtractionRate,
            )
            if (burdenOverComfort > 0) {
              for (const popId of popIds) {
                const pop = draft.popGroups[popId]
                if (!pop) continue
                const newUnrest = clamp(
                  pop.unrest + burdenOverComfort * ctx.config.localExtractionUnrestGain,
                  0,
                  100,
                )
                if (newUnrest !== pop.unrest) {
                  draft.popGroups[popId] = { ...pop, unrest: newUnrest }
                }
              }
            }

            if (!isPlaceholderPerson(draft, assignment.holderPersonId)) {
              const policy = getBailiffPolicy(draft, ctx.config, assignmentId)

              const affectionDelta = clamp(
                -burdenOverComfort * ctx.config.bailiffBurdenAffectionPenaltyFactor +
                  (policy === 'protect_residents'
                    ? ctx.config.bailiffProtectResidentsAffectionBonus
                    : 0),
                -1.0,
                0.5,
              )
              // v0.49: respect(尊敬/軽蔑) は代官の「有能さ＋実績」で動かす。苛烈さ(affection)
              //   とは独立軸 — 苛斂誅求でも有能なら恐れつつ尊敬され、低能力なら好かれても軽蔑される。
              //   軽蔑(負方向)は能力ドリフトが駆動する。task は completed の加点のみ — status は
              //   'completed'|'none' の2値で 'none' は「直近4週にタスク完了が無い(未割当含む)」=失敗
              //   ではないため、未完了を減点扱いにすると自動徴収できている有能代官まで不当に軽蔑される。
              const bailiffPerson = draft.persons[assignment.holderPersonId]
              const competence = bailiffPerson
                ? governanceCompetence(bailiffPerson.abilities)
                : ctx.config.bailiffRespectNeutralScore
              const abilityRespectDelta =
                (competence - ctx.config.bailiffRespectNeutralScore) *
                ctx.config.bailiffAbilityRespectFactor
              const taskRespectDelta =
                recentTaskStatus === 'completed' ? ctx.config.bailiffTaskCompletedRespectGain : 0
              const respectDelta = clamp(
                abilityRespectDelta + taskRespectDelta,
                -ctx.config.bailiffRespectMaxDelta,
                ctx.config.bailiffRespectMaxDelta,
              )

              if (affectionDelta !== 0 || respectDelta !== 0) {
                // 旧 adjustPopAttitude と同一挙動 (pop 不在は no-op、adjustAttitude で常に新 map)。
                const attitudeKey = personAttitudeKey(assignment.holderPersonId)
                for (const popId of popIds) {
                  const pop = draft.popGroups[popId]
                  if (!pop) continue
                  draft.popGroups[popId] = {
                    ...pop,
                    attitudes: adjustAttitude(pop.attitudes, attitudeKey, {
                      affection: affectionDelta,
                      respect: respectDelta,
                    }),
                  }
                }
              }
            }
          }

          if (ctx.config.debug) {
            log.log('BAILIFF', {
              holdingId,
              collected: collected.toFixed(2),
              bailiffFee: bailiffFee.toFixed(2),
              remittance: remittanceToTerminal.toFixed(2),
              localExtractionRate: localExtractionRate.toFixed(3),
              collectionEfficiency: collectionEfficiency.toFixed(3),
              totalBurdenRate: burdenComponents.totalBurdenRate.toFixed(3),
            })
          }
        }
      }

      const chain = getHoldingLandContractChain(draft, holdingId)
      if (chain.length === 0) continue

      let remaining = remittanceToTerminal
      for (let i = chain.length - 1; i >= 0; i--) {
        const contract = chain[i]!
        const taxRate = contract.terms.taxRateToGrantor
        const retained = remaining * (1 - taxRate)
        treasuryDeltas.set(
          contract.granteePolityId,
          (treasuryDeltas.get(contract.granteePolityId) ?? 0) + retained,
        )
        remaining = remaining * taxRate
      }
    }

    const provinceProduction = getProvinceProduction(draft, ctx.config, provinceId)
    const retainedToPop = Math.max(0, provinceProduction - provinceCollected)
    const retainedRatio = provinceProduction > 0 ? retainedToPop / provinceProduction : 0
    const retainedWealthGainByClass = ctx.config.retainedWealthGainByClass
    const popClasses: PopClass[] = ['peasants', 'townsmen', 'nobles']

    // 旧 adjustProvincePopWealthByClass と同一挙動 (class 一致 pop のみ clamp 0..100、不変なら skip)。
    for (const popClass of popClasses) {
      const delta = retainedRatio * retainedWealthGainByClass[popClass]
      for (const holdingId of province.holdingIds) {
        const popIds = draft.popIndex.byHolding[holdingId]
        if (!popIds) continue
        for (const popGroupId of popIds) {
          const pop = draft.popGroups[popGroupId]
          if (!pop || pop.class !== popClass) continue
          const newWealth = clamp(pop.wealth + delta, 0, 100)
          if (newWealth === pop.wealth) continue
          draft.popGroups[popGroupId] = { ...pop, wealth: newWealth }
        }
      }
    }
  }

  const newPolities = { ...draft.polities }
  for (const polityIdStr of Object.keys(draft.polities).sort()) {
    const polityId = polityIdStr as PolityId
    const polity = newPolities[polityId]
    if (!polity || !polity.active) continue
    const taxEfficiency = calcTreasurerTaxEfficiency(ctx.state, polityId, ctx.config)
    const delta = treasuryDeltas.get(polityId) ?? 0
    const flowEfficiency = ctx.config.taxFlowEfficiency
    newPolities[polityId] = {
      ...polity,
      treasury: polity.treasury + delta * taxEfficiency * flowEfficiency,
    }
  }
  draft.polities = newPolities

  return { ...ctx, state: draft }
}
