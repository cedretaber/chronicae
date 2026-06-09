import type { TickContext } from './context'
import { makeEventId } from './context'
import { calcAmbitionScores } from './ambitionSystem'
import { randomFloat } from '../rng/rng'
import { clamp } from '../utils/math'
import { adjustPersonLegacyPrestige, adjustHouseLegacyPrestige } from '../helpers/attitudeHelpers'
import { getHouseCohesion, getPolityStability } from '../selectors/statusSelectors'
import { getHouseLeader } from '../selectors/officeSelectors'
import { getAvailableOfficeRoles } from '../selectors/officeSelectors'
import { createOfficeAssignment, revokeOfficesByOrganization } from '../mutations/officeMutations'
import { addPlot as addPlotMutation } from '../mutations/plotMutations'
import { adjustHouseMembersAttitude } from '../mutations/attitudeMutations'
import type { OrganizationRef, OfficeRole } from '../types/office'
import type { PlotId, HouseId, PersonId, PolityId } from '../types/ids'
import type { Plot, PlotType } from '../types/plot'
import type { EventType } from '../types/event'
import { createSimEvent } from './context'
import { nameParam, entityRef } from '../types/event'
import type { EventEntityRef } from '../types/event'
import type { Person } from '../types/person'
import { isLifeStageAtLeast } from '../types/person'
import { getRoleScore } from '../selectors/abilitySelectors'
import { getHousePrimaryPolityId } from '../selectors/polityRelations'
import { getPolityImmediateOverlordPolityIds } from '../selectors/diplomaticSupportSelectors'
import type { House } from '../types/house'
import type { WorldState } from '../types/world'

function emitEvent(
  ctx: TickContext,
  type: EventType,
  importance: 'minor' | 'normal' | 'major' | 'critical',
  _actorIds: PersonId[],
  _houseIds: HouseId[],
  _polityIds: PolityId[],
  _summary: string,
  messageKey: string,
  messageParams: import('../types/event').EventMessageParams,
  eventEntityRefs: EventEntityRef[],
): TickContext {
  const { event, ctx: eventCtx } = createSimEvent(ctx, {
    type,
    importance,
    messageKey,
    messageParams,
    entityRefs: eventEntityRefs,
  })
  return { ...eventCtx, events: [...eventCtx.events, event] }
}

type ResolveResult = {
  ctx: TickContext
  succeeded: boolean
}

function resolvePlot(currentCtx: TickContext, plot: Plot): ResolveResult {
  const leader = currentCtx.state.persons[plot.leaderId]
  // 死亡した leader の plot は無効化 (dead person を Office に任命する事故を防ぐ)
  if (!leader || !leader.alive) {
    const updatedPlots = { ...currentCtx.state.activePlots }
    delete updatedPlots[plot.id]
    return {
      ctx: { ...currentCtx, state: { ...currentCtx.state, activePlots: updatedPlots } },
      succeeded: false,
    }
  }

  let targetDefense: number
  switch (plot.type) {
    case 'replace_house_leader': {
      const th = currentCtx.state.houses[plot.targetHouseId as HouseId]
      targetDefense = th ? getHouseCohesion(currentCtx.state, th.id) : 0
      break
    }
    case 'seize_office': {
      const tp = currentCtx.state.polities[plot.targetPolityId as PolityId]
      targetDefense = tp?.adminPower ?? 0
      break
    }
    case 'prepare_rebellion': {
      const tp = currentCtx.state.polities[plot.targetPolityId as PolityId]
      const adminPower = tp?.adminPower ?? 0
      const stability = tp ? getPolityStability(currentCtx.state, currentCtx.config, tp.id) : 0
      targetDefense = adminPower * 0.5 + stability * 0.5
      break
    }
  }

  const plotSuccessChance = clamp(
    currentCtx.config.basePlotSuccess +
      ((getRoleScore(currentCtx.state, leader.id, 'governance') / 10 +
        getRoleScore(currentCtx.state, leader.id, 'warCommand') / 10) /
        2) *
        0.1 +
      (plot.power / 100) * 0.15 +
      (plot.secrecy / 100) * 0.1 -
      (targetDefense / 100) * 0.2 -
      (plot.risk / 100) * 0.2,
    0.05,
    0.95,
  )

  const { value: roll, rng: nextRng } = randomFloat(currentCtx.rng)
  const rolledCtx = { ...currentCtx, rng: nextRng }
  const succeeded = roll < plotSuccessChance

  if (succeeded) {
    const resultCtx = applyPlotSuccess(rolledCtx, plot, leader)
    return { ctx: resultCtx, succeeded: true }
  } else {
    const resultCtx = applyPlotFailure(rolledCtx, plot, leader)
    return { ctx: resultCtx, succeeded: false }
  }
}

function applyPlotSuccess(currentCtx: TickContext, plot: Plot, leader: Person): TickContext {
  if (!leader.houseId) return currentCtx
  let state = currentCtx.state

  switch (plot.type) {
    case 'replace_house_leader': {
      const targetHouse = currentCtx.state.houses[plot.targetHouseId as HouseId]
      if (targetHouse) {
        const currentHeadId = getHouseLeader(currentCtx.state, targetHouse.id)
        // Find a new head from within the target house's existing members
        const newHead = targetHouse.memberIds
          .map((id) => state.persons[id])
          .filter(
            (p): p is NonNullable<typeof p> =>
              p !== undefined &&
              p.alive &&
              isLifeStageAtLeast(p.lifeStage, 'young_adulthood') &&
              (p.id as string) !== (currentHeadId ?? ''),
          )
          .sort((a, b) => b.legacyPrestige - a.legacyPrestige)[0]

        if (newHead) {
          // Apply office mutation: revoke all offices for the organization, then assign to new leader
          const targetOrgRef: OrganizationRef = { kind: 'house', id: targetHouse.id }
          let newState = revokeOfficesByOrganization(state, targetOrgRef, 'leader')
          newState = createOfficeAssignment(newState, targetOrgRef, 'leader', newHead.id)
          state = newState

          // Adjust target house member attitudes
          if (currentHeadId) {
            const r = adjustHouseMembersAttitude(
              state,
              targetHouse.id,
              { kind: 'person', id: currentHeadId },
              {
                respect: -10,
              },
            )
            if (r.ok) state = r.value
          }
          const r2 = adjustHouseMembersAttitude(
            state,
            targetHouse.id,
            { kind: 'person', id: newHead.id },
            { respect: 8 },
          )
          if (r2.ok) state = r2.value
        }

        // Leader legacyPrestige +5
        state = adjustPersonLegacyPrestige(state, plot.leaderId, 5)
      }

      const polityIds: PolityId[] = plot.targetPolityId
        ? [plot.targetPolityId]
        : [getHousePrimaryPolityId(state, leader.houseId) as PolityId]

      return emitEvent(
        { ...currentCtx, state, events: [...currentCtx.events] },
        'PLOT_SUCCEEDED',
        'major',
        [plot.leaderId],
        [leader.houseId],
        polityIds,
        `${leader.nameKey}'s ${plot.type} plot succeeded.`,
        'plot.succeeded',
        { person: nameParam('person', leader.nameKey), plotType: plot.type },
        [
          entityRef('person', plot.leaderId, 'leader', leader.nameKey),
          entityRef('house', leader.houseId, 'house'),
        ],
      )
    }

    case 'seize_office': {
      const targetPolity = currentCtx.state.polities[plot.targetPolityId as PolityId]
      if (targetPolity) {
        const targetRole = plot.targetRole
        if (targetRole) {
          const targetPolityId = plot.targetPolityId
          if (!targetPolityId) return currentCtx
          const polityOrgRef: OrganizationRef = { kind: 'polity', id: targetPolityId }
          state = createOfficeAssignment(state, polityOrgRef, targetRole, plot.leaderId)
        }
      }

      state = adjustPersonLegacyPrestige(state, plot.leaderId, 5)
      state = adjustHouseLegacyPrestige(state, leader.houseId, 2)

      const targetPolityId = plot.targetPolityId
      const polityIds: PolityId[] = targetPolityId
        ? [targetPolityId]
        : [getHousePrimaryPolityId(state, leader.houseId) as PolityId]

      return emitEvent(
        { ...currentCtx, state, events: [...currentCtx.events] },
        'PLOT_SUCCEEDED',
        'major',
        [plot.leaderId],
        [leader.houseId],
        polityIds,
        `${leader.nameKey}'s ${plot.type} plot succeeded.`,
        'plot.succeeded',
        { person: nameParam('person', leader.nameKey), plotType: plot.type },
        [
          entityRef('person', plot.leaderId, 'leader', leader.nameKey),
          entityRef('house', leader.houseId, 'house'),
        ],
      )
    }

    case 'prepare_rebellion': {
      // 叛乱準備の loyalty 失墜は「叛乱の相手 = 宗主 (overlord) polity」へ向ける。
      // 旧実装は自家の primary polity (= 所有する自国) へ向けており、主権者が自国へ
      // 反感を蓄積する不自然な挙動を生んでいた。target は startNewPlot で overlord に確定済み。
      const targetPolityId = plot.targetPolityId
      if (targetPolityId !== undefined) {
        const rr = adjustHouseMembersAttitude(
          state,
          leader.houseId,
          { kind: 'polity', id: targetPolityId },
          {
            affection: -8,
            respect: -5,
          },
        )
        if (rr.ok) state = rr.value
      }

      const polityIds: PolityId[] = targetPolityId ? [targetPolityId] : []

      return emitEvent(
        { ...currentCtx, state, events: [...currentCtx.events] },
        'PLOT_SUCCEEDED',
        'major',
        [plot.leaderId],
        [leader.houseId],
        polityIds,
        `${leader.nameKey}'s ${plot.type} plot succeeded.`,
        'plot.succeeded',
        { person: nameParam('person', leader.nameKey), plotType: plot.type },
        [
          entityRef('person', plot.leaderId, 'leader', leader.nameKey),
          entityRef('house', leader.houseId, 'house'),
        ],
      )
    }
  }
}

function applyPlotFailure(currentCtx: TickContext, plot: Plot, leader: Person): TickContext {
  if (!leader.houseId) return currentCtx
  let state = currentCtx.state

  switch (plot.type) {
    case 'replace_house_leader': {
      state = adjustPersonLegacyPrestige(state, plot.leaderId, -3)

      const polityIds: PolityId[] = plot.targetPolityId
        ? [plot.targetPolityId]
        : [getHousePrimaryPolityId(state, leader.houseId) as PolityId]

      return emitEvent(
        { ...currentCtx, state, events: [...currentCtx.events] },
        'PLOT_FAILED',
        'normal',
        [plot.leaderId],
        [leader.houseId],
        polityIds,
        `${leader.nameKey}'s ${plot.type} plot failed.`,
        'plot.failed',
        { person: nameParam('person', leader.nameKey), plotType: plot.type },
        [
          entityRef('person', plot.leaderId, 'leader', leader.nameKey),
          entityRef('house', leader.houseId, 'house'),
        ],
      )
    }

    case 'seize_office': {
      state = adjustPersonLegacyPrestige(state, plot.leaderId, -3)

      const polityIds: PolityId[] = plot.targetPolityId
        ? [plot.targetPolityId]
        : [getHousePrimaryPolityId(state, leader.houseId) as PolityId]

      return emitEvent(
        { ...currentCtx, state, events: [...currentCtx.events] },
        'PLOT_FAILED',
        'normal',
        [plot.leaderId],
        [leader.houseId],
        polityIds,
        `${leader.nameKey}'s ${plot.type} plot failed.`,
        'plot.failed',
        { person: nameParam('person', leader.nameKey), plotType: plot.type },
        [
          entityRef('person', plot.leaderId, 'leader', leader.nameKey),
          entityRef('house', leader.houseId, 'house'),
        ],
      )
    }

    case 'prepare_rebellion': {
      state = adjustPersonLegacyPrestige(state, plot.leaderId, -3)

      const polityIds: PolityId[] = plot.targetPolityId
        ? [plot.targetPolityId]
        : [getHousePrimaryPolityId(state, leader.houseId) as PolityId]

      return emitEvent(
        { ...currentCtx, state, events: [...currentCtx.events] },
        'PLOT_FAILED',
        'normal',
        [plot.leaderId],
        [leader.houseId],
        polityIds,
        `${leader.nameKey}'s ${plot.type} plot failed.`,
        'plot.failed',
        { person: nameParam('person', leader.nameKey), plotType: plot.type },
        [
          entityRef('person', plot.leaderId, 'leader', leader.nameKey),
          entityRef('house', leader.houseId, 'house'),
        ],
      )
    }
  }
}

// replace_house_leader の対象 = 自分の分家 (cadet house) で生存当主を持つもの。
// 同じ宗主を戴く別家を「同じ realm」と誤判定して空回りしていた旧フィルタ
// (1 polity = 1 owner なので決して一致しない) を、王朝統制という実体ある対象へ置換する。
function pickCadetTarget(state: WorldState, house: House): HouseId | undefined {
  for (const cid of [...house.cadetHouseIds].sort()) {
    const cadet = state.houses[cid]
    if (!cadet || !cadet.active || cadet.kind === 'system') continue
    const headId = getHouseLeader(state, cid)
    if (!headId) continue
    const head = state.persons[headId]
    if (!head || !head.alive) continue
    return cid
  }
  return undefined
}

// seize_office の対象 = 自分が仕える宗主 (overlord) polity の空き役職。
// 自国 (= 自分が所有する polity) の役職を奪う旧挙動 (任命権を既に握る国で無意味) を排除し、
// 宗主の宮廷で席を奪うという実体ある政治行動にする。overlord 不在の主権家には対象が無い。
function pickSeizeOfficeTarget(
  state: WorldState,
  overlordIds: PolityId[],
): { polityId: PolityId; role: OfficeRole } | undefined {
  for (const pid of overlordIds) {
    const polity = state.polities[pid]
    if (!polity || !polity.active) continue
    const availableRoles = getAvailableOfficeRoles(state, { kind: 'polity', id: pid })
    const role = availableRoles.find((r) => r !== 'leader') ?? availableRoles[0]
    if (role) return { polityId: pid, role }
  }
  return undefined
}

function startNewPlot(currentCtx: TickContext, houseId: HouseId): TickContext {
  const house = currentCtx.state.houses[houseId]
  if (!house || !house.active) return currentCtx

  const leaderId = getHouseLeader(currentCtx.state, houseId)
  if (!leaderId) return currentCtx

  const head = currentCtx.state.persons[leaderId]
  if (!head || !head.alive) return currentCtx

  // Check if house already has an active plot
  const hasActivePlot = Object.values(currentCtx.state.activePlots).some(
    (p) => p.leaderId === leaderId && p.status === 'active',
  )
  if (hasActivePlot) return currentCtx

  // --- 妥当な対象を持つ plot 種別だけを候補化する ---
  // plot を打てるのは primary polity を所有する家のみ (calcAmbitionScores が primary polity
  // 不在で 0 を返す)。各種別は「現実に作用する対象」がある場合だけ候補にし、自国・自分・存在
  // しない rival への空回り (および主権者の自国叛乱) を構造的に排除する。
  const primaryPolityId = getHousePrimaryPolityId(currentCtx.state, houseId)
  // 直接の宗主 (immediate overlord) polity 集合。空 = 主権国 (直属の主なし)
  //   → prepare_rebellion / seize_office は対象なし。grand-suzerain ではなく直属の主を狙う。
  const overlordIds = primaryPolityId
    ? ([
        ...getPolityImmediateOverlordPolityIds(currentCtx.state, primaryPolityId),
      ].sort() as PolityId[])
    : []
  const rebellionTargetPolityId: PolityId | undefined = overlordIds[0]
  const seizeTarget = pickSeizeOfficeTarget(currentCtx.state, overlordIds)
  const cadetTargetHouseId = pickCadetTarget(currentCtx.state, house)

  const { rebellionTendency } = calcAmbitionScores(currentCtx.state, houseId)
  const rebelBias = Math.max(0, (rebellionTendency - currentCtx.config.rebellionThreshold) / 100)

  // 候補 (種別, 重み)。重みは旧来の帯域 (rebellion 0.25+bias / seize 0.35 / replace 0.40) を踏襲。
  const candidates: { type: PlotType; weight: number }[] = []
  if (rebellionTargetPolityId !== undefined)
    candidates.push({ type: 'prepare_rebellion', weight: 0.25 + rebelBias })
  if (seizeTarget !== undefined) candidates.push({ type: 'seize_office', weight: 0.35 })
  if (cadetTargetHouseId !== undefined)
    candidates.push({ type: 'replace_house_leader', weight: 0.4 })

  // 妥当な策謀対象が無い家は何もしない (RNG も消費しない)。
  if (candidates.length === 0) return currentCtx

  // 種別を 1 float で重み付き抽選する
  const { value: typeRoll, rng: rng1 } = randomFloat(currentCtx.rng)
  const ctx1 = { ...currentCtx, rng: rng1 }
  const totalWeight = candidates.reduce((sum, c) => sum + c.weight, 0)
  const lastCandidate = candidates[candidates.length - 1]
  let plotType: PlotType = lastCandidate ? lastCandidate.type : 'replace_house_leader'
  {
    const threshold = typeRoll * totalWeight
    let acc = 0
    for (const c of candidates) {
      acc += c.weight
      if (threshold < acc) {
        plotType = c.type
        break
      }
    }
  }

  // Roll stats using 3 separate randomFloat calls
  const { value: powerRoll, rng: rng2 } = randomFloat(ctx1.rng)
  const ctx2 = { ...ctx1, rng: rng2 }

  const { value: secrecyRoll, rng: rng3 } = randomFloat(ctx2.rng)
  const ctx3 = { ...ctx2, rng: rng3 }

  const { value: riskRoll, rng: rng4 } = randomFloat(ctx3.rng)
  const ctx4 = { ...ctx3, rng: rng4 }

  const power = Math.floor(powerRoll * 60) + 20
  const secrecy = Math.floor(secrecyRoll * 60) + 20
  const risk = Math.floor(riskRoll * 60) + 20
  const durationWeeks = plotType === 'prepare_rebellion' ? 24 : 12

  // Generate PlotId
  // event id (e-<week>-<index>) を流用してユニーク性を確保するが、prefix は plot 専用の `pl-` に
  // する。`p-` は ProvinceId (p-<index>) が使用しており、prefix を共有すると ID が世界全体で一意で
  // なくなる (実際の文字列は segment 数が違うため現状は衝突しないが、紛らわしく潜在的衝突源)。
  const { id: rawId, ctx: eventCtx } = makeEventId(ctx4)
  const plotId = rawId.replace(/^e-/, 'pl-') as PlotId

  // 種別ごとの target を確定 (候補化の段階で妥当性は保証済み)
  let targetHouseId: HouseId | undefined
  let targetPolityId: PolityId | undefined
  let targetRole: OfficeRole | undefined

  switch (plotType) {
    case 'replace_house_leader':
      targetHouseId = cadetTargetHouseId
      break
    case 'seize_office':
      targetPolityId = seizeTarget?.polityId
      targetRole = seizeTarget?.role
      break
    case 'prepare_rebellion':
      targetPolityId = rebellionTargetPolityId
      break
  }

  // Build Plot object - only include defined optional fields
  const newPlot: Plot = {
    id: plotId,
    type: plotType,
    status: 'active',
    startedWeek: eventCtx.state.absoluteWeek,
    durationWeeks,
    leaderId: leaderId,
    participantIds: [leaderId],
    power,
    secrecy,
    risk,
    ...(targetHouseId !== undefined ? { targetHouseId } : {}),
    ...(targetPolityId !== undefined ? { targetPolityId } : {}),
    ...(targetRole !== undefined ? { targetRole } : {}),
  }

  const addResult = addPlotMutation(eventCtx.state, newPlot)
  const newState = addResult.ok ? addResult.value : eventCtx.state

  // Emit PLOT_STARTED event
  const housePrimaryPolityId = getHousePrimaryPolityId(eventCtx.state, house.id)
  const polityIds: PolityId[] = targetPolityId
    ? [targetPolityId]
    : housePrimaryPolityId
      ? [housePrimaryPolityId]
      : []

  return emitEvent(
    { ...eventCtx, state: newState, events: [...eventCtx.events] },
    'PLOT_STARTED',
    'normal',
    [leaderId],
    [houseId],
    polityIds,
    `${head.nameKey} began a ${plotType} plot.`,
    'plot.started',
    { person: nameParam('person', head.nameKey), plotType: plotType },
    [entityRef('person', leaderId, 'leader', head.nameKey), entityRef('house', houseId, 'house')],
  )
}

export function runPlotSystem(ctx: TickContext): TickContext {
  let currentCtx = ctx

  // === PHASE A: Resolve existing plots ===
  const activePlotIds = Object.keys(ctx.state.activePlots).sort()

  for (const plotId of activePlotIds) {
    const plot = currentCtx.state.activePlots[plotId as PlotId]
    if (!plot || plot.status !== 'active') {
      continue
    }

    // Check if plot has expired using absoluteWeek comparison
    if (ctx.state.absoluteWeek >= plot.startedWeek + plot.durationWeeks) {
      // Resolve the plot
      const result = resolvePlot(currentCtx, plot)
      // 調査 Phase5 (terminal plot accumulation cleanup): 従来は解決済み plot を
      // { ...plot, status: 'succeeded' | 'failed' } として activePlots に残し続けていた
      // (removePlot 未呼び出し)。全 reader は status === 'active' で filter するため
      // terminal record は読まれず dead weight として永久累積するだけ。PLOT_SUCCEEDED/
      // PLOT_FAILED イベントは resolvePlot 内で emit 済みなので、ここで削除しても挙動は
      // bit-identical (event count 不変)。累積を防ぐため resolution 時に削除する。
      const updatedPlots = { ...result.ctx.state.activePlots }
      delete updatedPlots[plotId as PlotId]
      let stateAfter = { ...result.ctx.state, activePlots: updatedPlots }
      // cooldown: 解決した策謀の家に最終解決週を記録し、連発 (一生打ち続ける) を防ぐ。
      const resolvedHouseId = stateAfter.persons[plot.leaderId]?.houseId
      const resolvedHouse = resolvedHouseId ? stateAfter.houses[resolvedHouseId] : undefined
      if (resolvedHouseId && resolvedHouse) {
        stateAfter = {
          ...stateAfter,
          houses: {
            ...stateAfter.houses,
            [resolvedHouseId]: {
              ...resolvedHouse,
              lastPlotResolvedWeek: ctx.state.absoluteWeek,
            },
          },
        }
      }
      currentCtx = { ...result.ctx, state: stateAfter }
      continue
    }

    continue
  }

  // === PHASE B: Start new plots ===
  const houseIds = Object.keys(ctx.state.houses).sort()

  for (const houseId of houseIds) {
    const scores = calcAmbitionScores(currentCtx.state, houseId as HouseId)
    if (scores.plotTendency < currentCtx.config.plotThreshold) continue

    const house = currentCtx.state.houses[houseId as HouseId]
    if (!house || !house.active) continue
    if (house.kind === 'system') continue

    // cooldown: 直近の策謀解決から plotCooldownWeeks 経過するまで新規策謀を開始しない。
    if (
      house.lastPlotResolvedWeek !== undefined &&
      currentCtx.state.absoluteWeek <
        house.lastPlotResolvedWeek + currentCtx.config.plotCooldownWeeks
    )
      continue

    const leaderId = getHouseLeader(currentCtx.state, houseId as HouseId)
    if (!leaderId) continue

    const head = currentCtx.state.persons[leaderId]
    if (!head || !head.alive) continue

    const hasActivePlot = Object.values(currentCtx.state.activePlots).some(
      (p) => p.leaderId === leaderId && p.status === 'active',
    )
    if (hasActivePlot) continue

    currentCtx = startNewPlot(currentCtx, houseId as HouseId)
  }

  return currentCtx
}
