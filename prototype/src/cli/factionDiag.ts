// 派閥拡大設計のための診断ハーネス (read-only)。
// advisor の 3 計測を最終状態で実測する:
//   1. active 派閥の memberCount vs memberCap (cap律速 or 供給律速)
//   2. 派閥 NP 分布 (factionNominationPowerThreshold=0.3 を超える割合)
//   3. placeholder 代官 holding と、所有家 free adult の枯渇 (Tier 2b 枯れ)
import { generateWorld } from '@sim/worldgen/generateWorld'
import { tick } from '@sim/tick/tick'
import { defaultConfig } from '@sim/config/defaultConfig'
import type { WorldState } from '@sim/types/world'
import type { PolityId } from '@sim/types/ids'
import type { OfficeRole } from '@sim/types/office'
import {
  getActiveFactions,
  getFactionActiveMemberIds,
  getFactionMemberCap,
  getFactionNominationPower,
  getFactionalCandidateScore,
  computeAvailableOfficeSlots,
  getBestRoleScore,
} from '@sim/selectors/factionSelectors'
import {
  getPolityTerminalProvinceIds,
  isPlaceholderPerson,
} from '@sim/selectors/landContractSelectors'
import { hasActiveOffice, hasActiveHoldingOffice } from '@sim/selectors/officeSelectors'
import { isHouselessPerson, isLandlessHouseMember } from '@sim/selectors/availabilitySelectors'
import { isRoleEligibleBySex } from '@sim/selectors/roleEligibilitySelectors'
import { getActiveFactionMembership, getFactionByLeader } from '@sim/selectors/factionSelectors'
import { isLifeStageAtLeast } from '@sim/types/person'
import { createNamePoolService } from '@sim/namegen/namePoolService'
import type { NamePoolData } from '@sim/namegen/namePoolTypes'
import fs from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'

const BAILIFF_ROLE: OfficeRole = 'advisor' // bailiffAppointmentSystem の BAILIFF_ROLE_ALIAS と同じ

function measure(state: WorldState) {
  const config = defaultConfig
  const npThreshold = config.factionNominationPowerThreshold

  // --- 1 & 2: 派閥サイジング + NP ---
  const factions = getActiveFactions(state)
  let capBound = 0 // memberCount >= cap
  let supplyBound = 0 // memberCount < cap
  let npAbove = 0
  let slotsAboveOne = 0 // computeAvailableOfficeSlots >= 1 (cap が floor を超える派閥)
  const memberCounts: number[] = []
  const caps: number[] = []
  const nps: number[] = []
  const rawSlots: number[] = []
  for (const f of factions) {
    const members = getFactionActiveMemberIds(state, f.id).length
    const cap = getFactionMemberCap(state, config, f.id)
    const np = getFactionNominationPower(
      state,
      config,
      f.id,
      { kind: 'polity', id: f.polityId },
      BAILIFF_ROLE,
    )
    const leader = state.persons[f.leaderPersonId]
    const slots = leader?.houseId ? computeAvailableOfficeSlots(state, config, leader.houseId) : 0
    memberCounts.push(members)
    caps.push(cap)
    nps.push(np)
    rawSlots.push(slots)
    if (slots >= 1) slotsAboveOne++
    if (members >= cap) capBound++
    else supplyBound++
    if (np >= npThreshold) npAbove++
  }

  // --- 3: 代官席の placeholder と、polity 単位の真の人材不足 ---
  let bailiffSeats = 0
  let placeholderSeats = 0
  let filledSeats = 0
  // polity 単位で「空席数 vs 充填可能人材数」を比較し、真の deficit を測る。
  //   充填可能人材 = 所有家 free adult + 派閥候補(bailiff score>=minAppointmentScore)
  let vacantInDeficitPolity = 0 // 人材<空席 の polity にある空席 (構造的に埋まらない)
  let vacantWithSlackPolity = 0 // 人材>=空席 なのに placeholder (timing/booking で取りこぼし)
  let deficitSeatTotal = 0 // Σ max(0, 空席 - 充填可能人材)

  for (const polityId of Object.keys(state.polities)) {
    const polity = state.polities[polityId as PolityId]
    if (!polity || !polity.active) continue
    const ownerHouseId = polity.ownerHouseId
    if (!ownerHouseId) continue
    const ownerHouse = state.houses[ownerHouseId]
    if (!ownerHouse) continue

    const ownerFreeAdults = ownerHouse.memberIds.filter((mid) => {
      const p = state.persons[mid]
      return (
        p &&
        p.alive &&
        p.age >= config.bailiffMinAge &&
        p.kind !== 'placeholder' &&
        !hasActiveOffice(state, p.id) &&
        !hasActiveHoldingOffice(state, p.id)
      )
    }).length

    // この polity に anchor する派閥から、bailiff score>=minAppointmentScore の eligible 候補を distinct で数える
    const factionalCandidateIds = new Set<string>()
    for (const f of factions) {
      if (f.polityId !== (polityId as PolityId)) continue
      const np = getFactionNominationPower(
        state,
        config,
        f.id,
        { kind: 'polity', id: polityId as PolityId },
        BAILIFF_ROLE,
      )
      if (np < npThreshold) continue
      for (const mid of getFactionActiveMemberIds(state, f.id)) {
        const p = state.persons[mid]
        if (!p || !p.alive || p.kind === 'placeholder') continue
        if (p.age < config.bailiffMinAge) continue
        if (hasActiveOffice(state, mid) || hasActiveHoldingOffice(state, mid)) continue
        const raw = getFactionalCandidateScore(
          state,
          config,
          f.id,
          mid,
          { kind: 'polity', id: polityId as PolityId },
          BAILIFF_ROLE,
        )
        const score = raw * config.factionBailiffNominationWeight
        if (score >= config.minAppointmentScore) factionalCandidateIds.add(mid)
      }
    }
    const fillable = ownerFreeAdults + factionalCandidateIds.size

    let polityVacant = 0
    for (const provinceId of getPolityTerminalProvinceIds(state, polityId as PolityId)) {
      const province = state.provinces[provinceId]
      if (!province) continue
      for (const holdingId of province.holdingIds) {
        if (state.holdingTerminalPolityCache[holdingId] !== (polityId as PolityId)) continue
        const officeId = state.holdingOfficeIndex.byHolding[holdingId]
        if (!officeId) continue
        const office = state.holdingOfficeAssignments[officeId]
        if (!office) continue
        bailiffSeats++
        if (isPlaceholderPerson(state, office.holderPersonId)) {
          placeholderSeats++
          polityVacant++
        } else {
          filledSeats++
        }
      }
    }
    if (polityVacant > 0) {
      if (fillable < polityVacant) {
        vacantInDeficitPolity += polityVacant
        deficitSeatTotal += polityVacant - fillable
      } else {
        vacantWithSlackPolity += polityVacant
      }
    }
  }

  // --- 4: 募集 supply (現状 pool vs Phase 3 が解禁する追加 body) ---
  // 共通の足切り: young_adulthood+ / 派閥未所属 / 非リーダー / 性別適格 / active(polity)office なし
  let currentSupply = 0 // 現状の募集対象 (houseless または landless)
  let phase3UnlockSupply = 0 // housed かつ landed だが無役の成人 (Phase 3 が新たに解禁)
  for (const pid of state.livingPersonIds) {
    const p = state.persons[pid]
    if (!p || p.kind === 'placeholder') continue
    if (!isLifeStageAtLeast(p.lifeStage, 'young_adulthood')) continue
    if (getActiveFactionMembership(state, pid)) continue
    if (getFactionByLeader(state, pid)) continue
    if (!isRoleEligibleBySex(state, config, pid)) continue
    if (hasActiveOffice(state, pid)) continue
    const houselessOrLandless = isHouselessPerson(state, pid) || isLandlessHouseMember(state, pid)
    if (houselessOrLandless) {
      currentSupply++
    } else if (!hasActiveHoldingOffice(state, pid)) {
      // housed + landed + 代官でもない無役 = Phase 3 拡大で初めて拾える層
      phase3UnlockSupply++
    }
  }

  // --- 5: commonwealth (共和国) の代官席 ---
  // bailiffAppointmentSystem は ownerHouseId 不在の polity を丸ごとスキップする (:48)。
  // commonwealth は ownerHouseId===undefined 恒常 (polity.ts:15) なので、その holding の
  // 代官席は一切任命されない筈。実測で確認する ([3] は owner 必須なので未カウント)。
  let cwPolities = 0
  let cwBailiffSeats = 0
  let cwPlaceholderSeats = 0
  let cwFilledSeats = 0
  for (const polityId of Object.keys(state.polities)) {
    const polity = state.polities[polityId as PolityId]
    if (!polity || !polity.active) continue
    if (polity.kind !== 'commonwealth') continue
    cwPolities++
    for (const provinceId of getPolityTerminalProvinceIds(state, polityId as PolityId)) {
      const province = state.provinces[provinceId]
      if (!province) continue
      for (const holdingId of province.holdingIds) {
        if (state.holdingTerminalPolityCache[holdingId] !== (polityId as PolityId)) continue
        const officeId = state.holdingOfficeIndex.byHolding[holdingId]
        if (!officeId) continue
        const office = state.holdingOfficeAssignments[officeId]
        if (!office) continue
        cwBailiffSeats++
        if (isPlaceholderPerson(state, office.holderPersonId)) cwPlaceholderSeats++
        else cwFilledSeats++
      }
    }
  }

  // --- 6: commonwealth に anchor する派閥 (factional 任命経路が commonwealth で生きているか) ---
  // 派閥の anchor (faction.polityId) が commonwealth の polity を指す数。
  // getHousePrimaryPolityId は owned polity しか返さない (commonwealth は ownerHouseId 不在で owned に入らない)
  // → anchor が commonwealth になるのは「house が polity 未所有 + seat terminal が commonwealth」のレアケースのみ。
  // これが ~0 なら、factional 任命経路は code 上 commonwealth 対応でも実際にはほぼ発火しない。
  let factionsAnchoredToCommonwealth = 0
  for (const f of factions) {
    const anchor = state.polities[f.polityId]
    if (anchor && anchor.kind === 'commonwealth') factionsAnchoredToCommonwealth++
  }

  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
  const mean = (xs: number[]) => (xs.length ? sum(xs) / xs.length : 0)
  const max = (xs: number[]) => (xs.length ? Math.max(...xs) : 0)

  return {
    factionCount: factions.length,
    capBound,
    supplyBound,
    npAbove,
    npBelow: factions.length - npAbove,
    slotsAboveOne,
    meanMembers: mean(memberCounts),
    maxMembers: max(memberCounts),
    meanCap: mean(caps),
    maxCap: max(caps),
    meanSlots: mean(rawSlots),
    maxSlots: max(rawSlots),
    meanNp: mean(nps),
    maxNp: max(nps),
    bailiffSeats,
    placeholderSeats,
    filledSeats,
    vacantInDeficitPolity,
    vacantWithSlackPolity,
    deficitSeatTotal,
    currentSupply,
    phase3UnlockSupply,
    cwPolities,
    cwBailiffSeats,
    cwPlaceholderSeats,
    cwFilledSeats,
    factionsAnchoredToCommonwealth,
  }
}

// WI-0/WI-1 merit 計測 (advisor 指摘): 「優秀な人物に集中」が proxy 任せの emergent でないか実測する。
//   M1: leader の patronPower (officeSlots + appointment right 数) と best role-score の相関。
//       高ければ「power⟹才能」がある程度成立。低い/負なら明示 merit 項が必須 (power=富/血筋になっている)。
//   M2: 派閥所属者 (leader + members) の才能が、非所属 eligible pool より高いか。
//       高くなければ現行 selection は talent を集めていない → power-order だけでは集中しない。
function measureMerit(state: WorldState) {
  const config = defaultConfig
  const factions = getActiveFactions(state)

  // holder key (`kind:id`) → appointment-type right 数 (holding_office_role + polity_office_role)
  const rightsByHolder = new Map<string, number>()
  for (const id of Object.keys(state.politicalRights)) {
    const r = state.politicalRights[id as keyof typeof state.politicalRights]
    if (!r) continue
    if (r.target.kind !== 'holding_office_role' && r.target.kind !== 'polity_office_role') continue
    const key = `${r.holder.kind}:${r.holder.id}`
    rightsByHolder.set(key, (rightsByHolder.get(key) ?? 0) + 1)
  }

  // M1: leader patronPower vs role-score
  // patronPower は「席=配れる職」(officeSlots + appointmentSeats)。meritSeats は含まない (才能は別軸)。
  // WI-0/1 後の engine 成否は corr(patronPower, leaderScore) ではなく corr(faction size, leaderScore) で測る:
  //   meritSeats を cap に入れ talent 比重を募集に入れたので、才能ある leader ほど cap が大きく大派閥になる。
  //   (patronPower 自体は富/血筋の代理のままで才能と無相関なのが正常 — power が才能を運ぶわけではない。)
  const patronPowers: number[] = []
  const leaderScores: number[] = []
  const factionSizes: number[] = []
  const memberIdSet = new Set<string>()
  const leaderIdSet = new Set<string>()
  for (const f of factions) {
    const leader = state.persons[f.leaderPersonId]
    if (!leader || !leader.houseId) continue
    const officeSlots = computeAvailableOfficeSlots(state, config, leader.houseId)
    const seats =
      (rightsByHolder.get(`person:${leader.id}`) ?? 0) +
      (rightsByHolder.get(`house:${leader.houseId}`) ?? 0)
    patronPowers.push(officeSlots + seats)
    leaderScores.push(getBestRoleScore(state, f.leaderPersonId))
    const memberIds = getFactionActiveMemberIds(state, f.id)
    factionSizes.push(memberIds.length)
    leaderIdSet.add(f.leaderPersonId)
    for (const mid of memberIds) memberIdSet.add(mid)
  }

  // M2: faction-affiliated (leader+member) role-score vs unaffiliated eligible pool
  const affiliatedScores: number[] = []
  const poolScores: number[] = []
  for (const pid of state.livingPersonIds) {
    const p = state.persons[pid]
    if (!p || p.kind === 'placeholder') continue
    if (!isLifeStageAtLeast(p.lifeStage, 'young_adulthood')) continue
    const score = getBestRoleScore(state, pid)
    if (leaderIdSet.has(pid) || memberIdSet.has(pid)) {
      affiliatedScores.push(score)
    } else {
      // 募集 eligible だが未所属 (現行 base pool 条件)
      if (!isRoleEligibleBySex(state, config, pid)) continue
      if (hasActiveOffice(state, pid)) continue
      if (!(isHouselessPerson(state, pid) || isLandlessHouseMember(state, pid))) continue
      poolScores.push(score)
    }
  }

  const pearson = (xs: number[], ys: number[]): number => {
    const n = xs.length
    if (n < 2) return NaN
    const mx = xs.reduce((a, b) => a + b, 0) / n
    const my = ys.reduce((a, b) => a + b, 0) / n
    let sxy = 0
    let sxx = 0
    let syy = 0
    for (let i = 0; i < n; i++) {
      const dx = xs[i]! - mx
      const dy = ys[i]! - my
      sxy += dx * dy
      sxx += dx * dx
      syy += dy * dy
    }
    if (sxx === 0 || syy === 0) return NaN
    return sxy / Math.sqrt(sxx * syy)
  }
  const median = (xs: number[]): number => {
    if (xs.length === 0) return NaN
    const s = [...xs].sort((a, b) => a - b)
    const mid = Math.floor(s.length / 2)
    return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
  }
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN)

  return {
    leaderN: patronPowers.length,
    corrPowerScore: pearson(patronPowers, leaderScores),
    corrSizeScore: pearson(factionSizes, leaderScores),
    affiliatedN: affiliatedScores.length,
    poolN: poolScores.length,
    affiliatedMedianScore: median(affiliatedScores),
    poolMedianScore: median(poolScores),
    affiliatedMeanScore: mean(affiliatedScores),
    poolMeanScore: mean(poolScores),
    leaderMeanScore: mean(leaderScores),
  }
}

// 単一 house が patron として握る faction membership のシェア (%) と、その house の id。
// = その house が leader を出す全派閥の member 総数 / 全派閥 member 総数。
// 1 家が talent 庇護を独占すると上昇 (snowball)、崩壊で分散すると低下 (振動)。
function dominantHouseShare(state: WorldState): {
  share: number
  houseId: string
  count: number
} {
  const byHouse = new Map<string, number>()
  let total = 0
  for (const f of getActiveFactions(state)) {
    const leader = state.persons[f.leaderPersonId]
    const hid = leader?.houseId
    const n = getFactionActiveMemberIds(state, f.id).length
    total += n
    if (!hid) continue
    byHouse.set(hid, (byHouse.get(hid) ?? 0) + n)
  }
  let bestHouse = ''
  let bestN = 0
  for (const [hid, n] of byHouse) {
    if (n > bestN) {
      bestN = n
      bestHouse = hid
    }
  }
  return { share: total > 0 ? (bestN / total) * 100 : 0, houseId: bestHouse, count: bestN }
}

// 成人人口 (固定分母)。dominant house faction members / adult pop は崩壊で総 faction 数が
// 縮んでも分母が動かないので、share% の denominator アーティファクトと真の entrenchment を切り分ける。
function adultPopulation(state: WorldState): number {
  let n = 0
  for (const pid of state.livingPersonIds) {
    const p = state.persons[pid]
    if (!p || p.kind === 'placeholder') continue
    if (!isLifeStageAtLeast(p.lifeStage, 'young_adulthood')) continue
    n++
  }
  return n
}

function main() {
  const args = process.argv.slice(2)
  let seed = '1'
  let years = 100
  let preset = 'small'
  let configOverride: Partial<typeof defaultConfig> = {}
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--seed' && args[i + 1]) seed = args[++i]!
    else if (args[i] === '--years' && args[i + 1]) years = parseInt(args[++i]!, 10)
    else if (args[i] === '--preset' && args[i + 1]) preset = args[++i]!
    else if (args[i] === '--config' && args[i + 1])
      configOverride = JSON.parse(args[++i]!) as Partial<typeof defaultConfig>
  }
  const config = { ...defaultConfig, ...configOverride }

  const namePoolPath = path.resolve(process.cwd(), 'src/sim/namegen/namePools.yaml')
  const poolData = YAML.parse(fs.readFileSync(namePoolPath, 'utf8')) as NamePoolData
  const nameService = createNamePoolService(poolData)

  const worldResult = generateWorld(
    seed,
    preset as 'tiny' | 'small' | 'standard' | 'perfLarge',
    nameService,
  )
  let state = worldResult.world
  let rng = worldResult.rng

  const totalWeeks = years * 48
  const domShareSeries: number[] = []
  const domHouseSeries: string[] = []
  const domFixedSeries: number[] = [] // dominant house faction members / 成人人口 % (固定分母)
  for (let w = 0; w < totalWeeks; w++) {
    const result = tick({ state, rng, config })
    state = result.state
    rng = result.rng
    // 5 年ごとに支配 house シェアをサンプル (dominance 時系列・振動の指標)。
    if (w % 240 === 239) {
      const d = dominantHouseShare(state)
      domShareSeries.push(Math.round(d.share))
      domHouseSeries.push(d.houseId)
      const adults = adultPopulation(state)
      domFixedSeries.push(adults > 0 ? Math.round((d.count / adults) * 1000) / 10 : 0)
    }
  }

  const m = measure(state)
  console.log(`=== Faction Diagnosis (seed=${seed}, years=${years}, preset=${preset}) ===`)
  console.log(`[1] 派閥サイジング: ${m.factionCount} 派閥`)
  console.log(
    `    cap律速 (member>=cap): ${m.capBound}  |  供給律速 (member<cap): ${m.supplyBound}`,
  )
  console.log(
    `    member 平均=${m.meanMembers.toFixed(2)} 最大=${m.maxMembers}  |  cap 平均=${m.meanCap.toFixed(2)} 最大=${m.maxCap}`,
  )
  console.log(
    `    officeSlots(cap原資) 平均=${m.meanSlots.toFixed(3)} 最大=${m.maxSlots.toFixed(3)}  |  slots>=1 の派閥=${m.slotsAboveOne}/${m.factionCount} (これが0なら cap式は死んで floor 固定)`,
  )
  console.log(`[2] NP 分布 (閾値=${defaultConfig.factionNominationPowerThreshold})`)
  console.log(
    `    NP>=閾値: ${m.npAbove}  |  NP<閾値: ${m.npBelow}  |  NP 平均=${m.meanNp.toFixed(3)} 最大=${m.maxNp.toFixed(3)}`,
  )
  console.log(
    `[3] 代官席: 総数=${m.bailiffSeats} 着座=${m.filledSeats} placeholder=${m.placeholderSeats}`,
  )
  console.log(
    `    空席のうち 真の人材不足 polity (所有家freeAdult+派閥候補<空席)=${m.vacantInDeficitPolity}  |  人材は足りるのに placeholder=${m.vacantWithSlackPolity}`,
  )
  console.log(`    構造的に埋まらない席 Σmax(0,空席-充填可能人材)=${m.deficitSeatTotal}`)
  console.log(`[4] 募集 supply`)
  console.log(
    `    現状 pool (houseless/landless, eligible)=${m.currentSupply}  |  Phase3 が解禁する追加 body (housed+landed 無役)=${m.phase3UnlockSupply}`,
  )
  console.log(`[5] commonwealth (共和国) の代官席`)
  console.log(
    `    commonwealth polity 数=${m.cwPolities}  |  代官席 総数=${m.cwBailiffSeats} 着座=${m.cwFilledSeats} placeholder=${m.cwPlaceholderSeats}`,
  )
  console.log(`[6] commonwealth に anchor する派閥`)
  console.log(
    `    commonwealth anchor 派閥=${m.factionsAnchoredToCommonwealth} / 全派閥 ${m.factionCount} (~0 なら factional 任命経路は commonwealth で実質不発)`,
  )

  const mm = measureMerit(state)
  console.log(`[7] merit M1: engine 成否 = faction size ↔ leader 才能 相関`)
  console.log(
    `    n=${mm.leaderN}  corr(size,score) r=${mm.corrSizeScore.toFixed(3)} (★engine: 正なら才能ある patron ほど大派閥=集積成立)  |  corr(patronPower,score) r=${mm.corrPowerScore.toFixed(3)} (≈0 が正常: power は富/血筋の代理)  leader平均score=${mm.leaderMeanScore.toFixed(1)}`,
  )
  console.log(`[8] merit M2: 派閥所属(leader+member) vs 非所属eligible pool の才能`)
  console.log(
    `    所属 n=${mm.affiliatedN} median=${mm.affiliatedMedianScore.toFixed(1)} mean=${mm.affiliatedMeanScore.toFixed(1)}  |  pool n=${mm.poolN} median=${mm.poolMedianScore.toFixed(1)} mean=${mm.poolMeanScore.toFixed(1)} (所属>pool でなければ talent を集めていない)`,
  )

  // [9] dominance 時系列 (WI-3 振動の指標)。5 年ごとの「支配 house の faction membership シェア%」。
  //   turnover = 支配 house が入れ替わった distinct house 数 (高い=patron 庇護が家を巡る=分権/振動、
  //              1=1 家が独占=snowball/集権)。reversals = シェア時系列の方向反転数。
  let reversals = 0
  let prevDir = 0
  for (let i = 1; i < domShareSeries.length; i++) {
    const d = Math.sign(domShareSeries[i]! - domShareSeries[i - 1]!)
    if (d !== 0 && prevDir !== 0 && d !== prevDir) reversals++
    if (d !== 0) prevDir = d
  }
  const distinctHouses = new Set(domHouseSeries.filter((h) => h !== '')).size
  const shareMax = domShareSeries.length ? Math.max(...domShareSeries) : 0
  const shareMin = domShareSeries.length ? Math.min(...domShareSeries) : 0
  const fixedMax = domFixedSeries.length ? Math.max(...domFixedSeries) : 0
  console.log(`[9] dominance 時系列 (支配 house の派閥 membership シェア%・5年毎): WI-3 振動の指標`)
  console.log(
    `    share=[${domShareSeries.join(',')}]  max=${shareMax}% min=${shareMin}% reversals=${reversals} 支配house turnover=${distinctHouses} (turnover/reversals 高=振動 / 低=snowball)`,
  )
  console.log(
    `    固定分母(支配house派閥員/成人人口) fixed=[${domFixedSeries.join(',')}] max=${fixedMax}% (崩壊で総派閥員が縮んでも不変→entrenchment と分母artifactを切り分け)`,
  )

  // [10] 入れ子 (Phase 2-a 形成): root / nested 数と深さ分布。
  const depthOf = (f: { id: string; parentFactionId?: string }): number => {
    let d = 0
    let cur = f
    const guard = new Set<string>()
    while (cur.parentFactionId !== undefined && !guard.has(cur.id)) {
      guard.add(cur.id)
      const parent = state.factions[cur.parentFactionId as keyof typeof state.factions]
      if (!parent) break
      d++
      cur = parent
    }
    return d
  }
  const depths: number[] = []
  let nestedCount = 0
  let parentsWithChildren = 0
  for (const f of getActiveFactions(state)) {
    const d = depthOf(f)
    depths.push(d)
    if (d > 0) nestedCount++
    if ((state.factionIndex.byParent[f.id]?.length ?? 0) > 0) parentsWithChildren++
  }
  const depthDist = new Map<number, number>()
  for (const d of depths) depthDist.set(d, (depthDist.get(d) ?? 0) + 1)
  const distStr = [...depthDist.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([d, c]) => `d${d}:${c}`)
    .join(' ')
  console.log(
    `[10] 入れ子 (形成): nested 派閥=${nestedCount}/${depths.length} 親=${parentsWithChildren}`,
  )
  console.log(`    深さ分布 ${distStr || '(なし)'} (d0=root・形成が発火していれば d1+ が出る)`)
}

try {
  main()
} catch (err) {
  console.error(err)
  process.exit(1)
}
