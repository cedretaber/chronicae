import type { TickContext } from './context'
import type { ProvinceId, PolityId, PersonId, PopGroupId, HoldingId } from '../types/ids'
import type { WorldState } from '../types/world'
import { isEmployed } from '../types/workplaceRef'
import { calcTreasurerTaxEfficiency } from '../selectors/personAbilityEffects'
import { governanceCompetence } from '../selectors/abilitySelectors'
import type { AssetOwnerRef } from '../types/realEstateAsset'
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
  // v0.54: owner income のうち polity owner 分は treasury へ直接加算する (税フロー効率の対象外)。
  //   draft.polities は shallow copy しないため、末尾の newPolities 構築時にまとめて適用する。
  const ownerTreasuryDeltas = new Map<PolityId, number>()
  const draft: WorldState = {
    ...ctx.state,
    persons: { ...ctx.state.persons },
    popGroups: { ...ctx.state.popGroups },
    houses: { ...ctx.state.houses },
  }

  // v0.63: upper 配当を holding 収入から carve し、雇用 upper POP に size 比例で配分。
  //   carve==mint: 雇用 upper 不在なら carve しない (money が消えない)。
  const upperDividendRate = ctx.config.upperDividendShareOfNetRevenue
  const carveUpperDividendMut = (holdingId: HoldingId, pool: number): number => {
    if (upperDividendRate <= 0 || pool <= 0) return 0
    const popIds = draft.popIndex.byHolding[holdingId]
    if (!popIds) return 0
    let upperSize = 0
    for (const pid of popIds) {
      const pop = draft.popGroups[pid]
      if (pop && isEmployed(pop) && pop.class === 'upper') upperSize += pop.size
    }
    if (upperSize <= 0) return 0
    const budget = pool * upperDividendRate
    for (const pid of popIds) {
      const pop = draft.popGroups[pid]
      if (!pop || !isEmployed(pop) || pop.class !== 'upper') continue
      const amount = budget * (pop.size / upperSize)
      draft.popGroups[pid] = { ...pop, money: pop.money + amount }
    }
    return budget
  }

  // 旧 addPersonWealth と同一挙動 (person 不在なら no-op、wealth は 0 でクランプ)。
  const addPersonWealthMut = (personId: PersonId, delta: number): void => {
    const p = draft.persons[personId]
    if (!p) return
    draft.persons[personId] = { ...p, wealth: Math.max(0, p.wealth + delta) }
  }

  // v0.54 §17.4: RealEstateAsset owner へ ownerIncome を支払う。owner.kind で支払い先が変わる。
  //   支払えた額を返す (owner が不在/inactive/死亡なら 0)。支払えなかった分は呼び出し側で
  //   holding taxable に戻し、保存則 (§21.4: Σ ownerPaid + Σ taxable == Σ positiveNet) を保つ
  //   (旧 computeHoldingOwnerIncomes も inactive house の income は holding 側に残していた)。
  const payOwnerIncome = (owner: AssetOwnerRef, income: number): number => {
    if (income <= 0) return 0
    if (owner.kind === 'house') {
      const house = draft.houses[owner.id]
      if (house && house.active) {
        draft.houses[owner.id] = { ...house, wealth: house.wealth + income }
        return income
      }
    } else if (owner.kind === 'person') {
      const person = draft.persons[owner.id]
      if (person && person.alive) {
        draft.persons[owner.id] = { ...person, wealth: Math.max(0, person.wealth + income) }
        return income
      }
    } else {
      const polity = draft.polities[owner.id]
      if (polity && polity.active) {
        ownerTreasuryDeltas.set(owner.id, (ownerTreasuryDeltas.get(owner.id) ?? 0) + income)
        return income
      }
    }
    return 0
  }

  for (const provinceId of Object.keys(ctx.state.provinces).sort() as ProvinceId[]) {
    const province = ctx.state.provinces[provinceId]
    if (!province) continue

    for (const holdingId of province.holdingIds) {
      const holding = draft.holdings[holdingId]
      if (!holding) continue

      // v0.54 §17.1.1: 月次 resource snapshot を source に、per-asset で holding taxable と owner 支払いを確定。
      //   positiveNet = max(0, asset netRevenue)。所有なし=全額 taxable / 所有あり=holdingDue のみ taxable で
      //   ownerIncome は owner へ / 押領中=due+押領分を holding 側へ吸収 (rightful owner には払わない §17.5)。
      const snapshot = draft.monthlyHoldingResourceRevenue[holdingId]
      let holdingTaxable = 0
      if (snapshot) {
        for (const ar of snapshot.assetResults) {
          // v0.58: 賃金 carve ＋ upper 配当 carve 後が owner/税/国庫の原資 (positiveNet を 1 箇所変える
          //   だけで owner income / holdingDue / taxable / 代官 / treasury すべてが carve 分縮む)。
          const positiveNet = Math.max(0, ar.netRevenue - ar.wageShare)
          if (positiveNet <= 0) continue
          const asset = draft.realEstateAssets[ar.assetId]
          if (!asset || !asset.owner) {
            holdingTaxable += positiveNet
            continue
          }
          const seized = draft.realEstateSeizureIndex.byAsset[asset.id as string] !== undefined
          const holdingDue = positiveNet * ctx.config.realEstateHoldingDueRate
          const ownerIncome = positiveNet - holdingDue
          if (seized) {
            holdingTaxable += positiveNet
            continue
          }
          holdingTaxable += holdingDue
          // 支払えなかった ownerIncome (owner 不在/inactive/死亡) は holding 側に残す (保存則維持)。
          const paid = payOwnerIncome(asset.owner, ownerIncome)
          holdingTaxable += ownerIncome - paid
        }
      }
      // v0.58: POP 資産課税 — lower/middle の money(per-capita floor 超過分)に月次課税し、land 税と同じ
      //   holding 収入(holdingTaxable)へ合流させる。実徴収は下の代官 collectionFraction(能力反映)で割引き、
      //   POP からの burn は「実際に徴収された分」だけにする(uncollected は POP 手元に残し money を消さない)。
      //   upper は除外(死蔵は将来 Project 出資)・floor 以下の貧困層は非課税(累進)。
      const popTaxRate = ctx.config.popWealthTaxRate
      const popTaxByPop = new Map<PopGroupId, number>()
      if (popTaxRate > 0) {
        const popTaxFloor = ctx.config.popWealthTaxFloorPerCapita
        const taxPopIds = draft.popIndex.byHolding[holdingId]
        if (taxPopIds) {
          for (const popId of taxPopIds) {
            const pop = draft.popGroups[popId]
            if (!pop || pop.class === 'upper' || pop.size <= 0) continue
            const taxable = Math.max(0, pop.money - popTaxFloor * pop.size)
            if (taxable <= 0) continue
            const nominal = taxable * popTaxRate
            popTaxByPop.set(popId, nominal)
            holdingTaxable += nominal
          }
        }
      }

      if (holdingTaxable <= 0) continue
      const revenueAfterOwnerIncome = holdingTaxable
      // POP 資産税の **納税額** に使う徴収率 = localExtractionRate (代官が取り立てる割合)。
      //   collectionEfficiency(不正・賄賂で消える分)は掛けない — 納税額 と 徴税額(treasury 到達分)の
      //   ズレ=徴税ロスは意図された挙動(POP は払うが treasury には届かず消える)。代官不在/非 active は 1。
      let popTaxLevyFraction = 1

      const assignmentId = draft.holdingOfficeIndex.byHolding[holdingId]
      let remittanceToTerminal: number

      if (!assignmentId) {
        const dividend = carveUpperDividendMut(holdingId, revenueAfterOwnerIncome)
        remittanceToTerminal = revenueAfterOwnerIncome - dividend
      } else {
        const assignment = draft.holdingOfficeAssignments[assignmentId]
        if (!assignment || !assignment.active) {
          const dividend = carveUpperDividendMut(holdingId, revenueAfterOwnerIncome)
          remittanceToTerminal = revenueAfterOwnerIncome - dividend
        } else {
          const recentTaskStatus = getRecentBailiffRevenueTaskStatus(draft, assignmentId)
          const localExtractionRate = getBailiffLocalExtractionRate(draft, ctx.config, assignmentId)
          const collectionEfficiency = getBailiffCollectionEfficiency(
            draft,
            ctx.config,
            assignmentId,
            recentTaskStatus,
          )
          popTaxLevyFraction = localExtractionRate
          const collected = revenueAfterOwnerIncome * localExtractionRate * collectionEfficiency
          const dividend = carveUpperDividendMut(holdingId, collected)
          const afterDividend = collected - dividend
          const bailiffFeeRate = getBailiffFeeRate(draft, ctx.config, assignmentId)
          const bailiffFee = afterDividend * bailiffFeeRate
          remittanceToTerminal = afterDividend - bailiffFee

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
              // v0.58: 苛斂誅求の welfare 圧迫は needSatisfaction を削る (wealth 退役)。
              //   localExtractionWealthPenalty は係数として流用 (welfare ペナルティ)。
              for (const popId of popIds) {
                const pop = draft.popGroups[popId]
                if (!pop) continue
                const newSat = clamp(
                  pop.needSatisfaction -
                    burdenComponents.collectionFrictionBurdenRate *
                      ctx.config.localExtractionWealthPenalty *
                      (pop.needSatisfaction / 100),
                  0,
                  100,
                )
                if (newSat !== pop.needSatisfaction) {
                  draft.popGroups[popId] = { ...pop, needSatisfaction: newSat }
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

      // v0.58: POP 資産税の burn (納税額) — nominal × popTaxLevyFraction(localExtractionRate) を POP.money から引く。
      //   このうち treasury へ届く徴税額は holdingTaxable 経由で collected(×collectionEfficiency)→bailiffFee/
      //   remittance→chain→treasury に流れる。差分(徴税効率ロス=不正・賄賂)は世界から消滅(意図的 sink・
      //   抽象市場の mint と source/sink で総量均衡)。代官の取り立てが緩い(extraction 低)ほど POP の納税額も減る。
      if (popTaxByPop.size > 0 && popTaxLevyFraction > 0) {
        for (const [popId, nominal] of popTaxByPop) {
          const pop = draft.popGroups[popId]
          if (!pop) continue
          const burn = nominal * popTaxLevyFraction
          if (burn <= 0) continue
          draft.popGroups[popId] = { ...pop, money: Math.max(0, pop.money - burn) }
        }
      }

      const chain = getHoldingLandContractChain(draft, holdingId)
      if (chain.length === 0) continue

      let remaining = remittanceToTerminal
      for (let i = chain.length - 1; i >= 0; i--) {
        const contract = chain[i]!
        // v0.53 §11.2: active LandContractDefault がある contract は実効 taxRate=0 (contract record は不変)。
        //   grantee が全額を手元に留め上位 grantor へ繰り上げない (D3: 上流 chain 全体が干上がる)。
        const hasActiveDefault =
          draft.landContractDefaultIndex.byContract[contract.id as string] !== undefined
        const taxRate = hasActiveDefault ? 0 : contract.terms.taxRateToGrantor
        const retained = remaining * (1 - taxRate)
        treasuryDeltas.set(
          contract.granteePolityId,
          (treasuryDeltas.get(contract.granteePolityId) ?? 0) + retained,
        )
        remaining = remaining * taxRate
      }
    }

    // v0.58: 旧 retainedToPop wealth-gain ループは廃止。POP の所得チャネルは賃金 (ResourceEconomy の
    //   wage mint) に一本化した。徴税後に POP 手元へ残る分を wealth 指数に足す擬似所得は不要。
    //   (これに伴い provinceTaxable / provinceCollected の集計も除去した。)
  }

  const newPolities = { ...draft.polities }
  for (const polityIdStr of Object.keys(draft.polities).sort()) {
    const polityId = polityIdStr as PolityId
    const polity = newPolities[polityId]
    if (!polity || !polity.active) continue
    const taxEfficiency = calcTreasurerTaxEfficiency(ctx.state, polityId, ctx.config)
    const delta = treasuryDeltas.get(polityId) ?? 0
    const flowEfficiency = ctx.config.taxFlowEfficiency
    // v0.54: polity owner の ownerIncome は税フロー効率の対象外で直接加算 (§17.4)。
    const ownerDelta = ownerTreasuryDeltas.get(polityId) ?? 0
    newPolities[polityId] = {
      ...polity,
      treasury: polity.treasury + delta * taxEfficiency * flowEfficiency + ownerDelta,
    }
  }
  draft.polities = newPolities

  return { ...ctx, state: draft }
}
