import type { TickContext, CreateSimEventInput } from './context'
import type { SimEvent } from '../types/event'
import { nameParam, entityRef } from '../types/event'
import type { WorldState } from '../types/world'
import type { Crisis, CrisisKind } from '../types/crisis'
import type { HandleCrisisProject } from '../types/project'
import type { ProvinceId, HoldingId, PolityId, PersonId, ProjectId, EventId } from '../types/ids'
import type { PopClass } from '../types/popGroup'
import { createProjectId } from '../types/ids'
import { randomFloat } from '../rng/rng'
import type { RngState } from '../rng/rng'
import { WEEKS_PER_YEAR } from '../utils/timeUtils'
import {
  createCrisisMut,
  setCrisisResponseProjectMut,
  setCrisisSeverityMut,
  removeCrisisMut,
} from '../mutations/crisisMutations'
import { addProjectToIndexMut } from '../mutations/projectMutations'
import {
  reduceHoldingPopSizeProportionalMut,
  adjustHoldingPopWealthMut,
  adjustHoldingPopUnrestMut,
} from '../mutations/popMutations'
import { adjustHoldingPopAttitudeMut } from '../mutations/attitudeMutations'
import { getHoldingTerminalPolityId, isPlaceholderPerson } from '../selectors/landContractSelectors'
import { getProvincePopulationPressure } from '../selectors/popSelectors'
import { getInitialProjectStageKey } from '../config/projectStageSequences'
import type { SimulationConfig } from '../config/defaultConfig'

// holding に active・非 placeholder の代官 (bailiff) がいれば返す。
function getActiveBailiff(ws: WorldState, holdingId: HoldingId): PersonId | undefined {
  const officeId = ws.holdingOfficeIndex.byHolding[holdingId]
  if (!officeId) return undefined
  const a = ws.holdingOfficeAssignments[officeId]
  if (!a || !a.active) return undefined
  if (isPlaceholderPerson(ws, a.holderPersonId)) return undefined
  const holder = ws.persons[a.holderPersonId]
  if (!holder || !holder.alive) return undefined
  return a.holderPersonId
}

// holding が指定 kind の Crisis を負う資格 (該当 POP を持つか) を判定する (§4.1 spawn フィルタ)。
// famine/drought → peasants(agriculture)、plague → 何らかの POP。
function holdingEligibleForKind(ws: WorldState, holdingId: HoldingId, kind: CrisisKind): boolean {
  const popIds = ws.popIndex.byHolding[holdingId]
  if (!popIds || popIds.length === 0) return false
  if (kind === 'plague') return true
  // famine / drought: 農業 peasants が居る holding のみ
  for (const popId of popIds) {
    const pop = ws.popGroups[popId]
    if (pop && pop.class === 'peasants' && pop.occupation === 'agriculture') return true
  }
  return false
}

// 対処 Project (handle_crisis) を生成する。owner = live 解決した polity、creator/supervisor = 代官。
function createHandleCrisisProjectMut(
  ws: WorldState,
  config: SimulationConfig,
  crisis: Crisis,
  ownerPolityId: PolityId,
  bailiffId: PersonId,
  absoluteWeek: number,
): void {
  const projectId: ProjectId = createProjectId(ws.nextProjectId)
  ws.nextProjectId++

  const treasury = ws.polities[ownerPolityId]?.treasury ?? 0
  const required = Math.min(
    Math.floor(treasury * config.crisisBudgetTreasuryRatio),
    config.crisisBudgetCapByKind[crisis.kind],
  )

  const project: HandleCrisisProject = {
    id: projectId,
    owner: { kind: 'polity', id: ownerPolityId },
    origin: { kind: 'system', reasonKey: 'crisis_response' },
    kind: 'handle_crisis',
    crisisId: crisis.id,
    holdingId: crisis.holdingId,
    creatorPersonId: bailiffId,
    supervisorPersonId: bailiffId,
    status: 'active',
    progress: 0,
    // §3.4: targetProgress = 初期 severity。progress が積まれて severity が 0 になると resolved。
    targetProgress: crisis.severity,
    currentStageKey: getInitialProjectStageKey('handle_crisis'),
    createdWeek: absoluteWeek,
    deadlineWeek: crisis.deadlineWeek,
    reasonIds: [],
    budget: { required, allocated: 0, remaining: 0, spent: 0, source: { kind: 'owner' } },
  }

  ws.projects[projectId] = project
  addProjectToIndexMut(ws, project)
  setCrisisResponseProjectMut(ws, crisis.id, projectId)
}

// holding 単位で Crisis を生成する。dedup・owner live 解決・初期ショック・代官いれば Project 生成。
// 生成したら true を返す (province サマリ emit 判定用)。
function spawnCrisisForHolding(
  ws: WorldState,
  config: SimulationConfig,
  holdingId: HoldingId,
  kind: CrisisKind,
  pressureExcess: number,
  absoluteWeek: number,
  emitEvent: (input: CreateSimEventInput) => void,
): boolean {
  // dedup: 同 kind の active Crisis があれば skip (§2.4 EC4)
  const existing = ws.crisisIndex.byHolding[holdingId as string] ?? []
  for (const cid of existing) {
    const c = ws.crises[cid]
    if (c && c.kind === kind && c.status === 'active') return false
  }

  // owner は live 解決 (§0-10)。active owner polity が無ければ生成しない (§C1 整合)。
  const ownerPolityId = getHoldingTerminalPolityId(ws, holdingId)
  if (!ownerPolityId) return false
  const ownerPolity = ws.polities[ownerPolityId]
  if (!ownerPolity || !ownerPolity.active) return false

  const severity = Math.min(
    100,
    config.crisisInitialSeverityByKind[kind] + pressureExcess * config.crisisSeverityPressureBonus,
  )
  const deadlineWeek = absoluteWeek + config.crisisDeadlineWeeksByKind[kind]

  const crisis = createCrisisMut(ws, {
    kind,
    holdingId,
    severity,
    createdWeek: absoluteWeek,
    deadlineWeek,
    status: 'active',
    reasonIds: [],
  })

  // 初期ショック (一回限りの人口減, holding スコープで 1 回。province ラッパーの多重罠を回避, §4.1)
  const shockRate = config.crisisInitialShockSizeRateByKind[kind]
  if (shockRate > 0) {
    const popClass: PopClass | undefined = kind === 'plague' ? undefined : 'peasants'
    reduceHoldingPopSizeProportionalMut(ws, holdingId, shockRate, popClass)
  }

  // 代官がいれば対処 Project を生成 (= 凌ぐ)。いなければ Project なし = 放置 (§3.2/§4.4)。
  const bailiff = getActiveBailiff(ws, holdingId)
  if (bailiff) {
    createHandleCrisisProjectMut(ws, config, crisis, ownerPolityId, bailiff, absoluteWeek)
  }

  // per-holding CRISIS_CREATED (minor)。chronicle へは登録しない (fan-out 氾濫回避, §4.5)。
  emitEvent({
    type: 'CRISIS_CREATED',
    importance: 'minor',
    messageKey: 'crisis.created',
    messageParams: {
      crisisKind: crisis.kind,
      holding: nameParam('holding', ws.holdings[holdingId]?.nameKey ?? holdingId),
    },
    entityRefs: [entityRef('holding', holdingId, 'holding')],
  })
  return true
}

// 年次の発生ロール (province 規模・人口圧力連動)。当たったら被災 province 内の該当 holding に
// Crisis を 1 つずつ生成する (§4.1)。RNG はローカルに追跡し最後に書き戻す。
function runAnnualSpawn(
  ws: WorldState,
  config: SimulationConfig,
  rngIn: RngState,
  emitEvent: (input: CreateSimEventInput) => void,
): RngState {
  let rng = rngIn
  const absoluteWeek = ws.absoluteWeek

  for (const provinceIdStr of Object.keys(ws.provinces).sort()) {
    const provinceId = provinceIdStr as ProvinceId
    const province = ws.provinces[provinceId]
    if (!province) continue

    const pressure = getProvincePopulationPressure(ws, config, provinceId)
    const pressureExcess = Math.max(0, pressure - config.populationPressureThreshold)

    const famineChance =
      config.famineBaseChancePerYear + config.faminePressureChanceBonus * pressureExcess
    const plagueChance =
      config.plagueBaseChancePerYear + config.plaguePressureChanceBonus * pressureExcess
    const droughtChance =
      config.droughtBaseChancePerYear + config.droughtPressureChanceBonus * pressureExcess

    const f = randomFloat(rng)
    rng = f.rng
    const p = randomFloat(rng)
    rng = p.rng
    const d = randomFloat(rng)
    rng = d.rng

    const holdingIds = [...province.holdingIds].sort()
    // kind を province 内の該当 holding に spawn し、1 件でも生成したら count を返す。
    const spawnKind = (kind: CrisisKind): number => {
      let created = 0
      for (const holdingId of holdingIds) {
        if (!holdingEligibleForKind(ws, holdingId, kind)) continue
        if (
          spawnCrisisForHolding(
            ws,
            config,
            holdingId,
            kind,
            pressureExcess,
            absoluteWeek,
            emitEvent,
          )
        )
          created++
      }
      return created
    }

    // 後方互換: province レベルの物語ビートとして旧 FAMINE/PLAGUE を 1 件だけ残す (§4.5)。
    //   drought は新 kind で legacy event を持たないため per-holding CRISIS_CREATED のみ。
    if (f.value < famineChance && spawnKind('famine') > 0) {
      emitEvent({
        type: 'FAMINE',
        importance: 'major',
        messageKey: 'disaster.famine',
        messageParams: { province: nameParam('province', province.nameKey) },
        entityRefs: [entityRef('province', provinceId, 'province', province.nameKey)],
      })
    }
    if (p.value < plagueChance && spawnKind('plague') > 0) {
      emitEvent({
        type: 'PLAGUE',
        importance: 'major',
        messageKey: 'disaster.plague',
        messageParams: { province: nameParam('province', province.nameKey) },
        entityRefs: [entityRef('province', provinceId, 'province', province.nameKey)],
      })
    }
    if (d.value < droughtChance) spawnKind('drought')
  }

  return rng
}

// active Crisis の週次処理 (§4.2 デバフ / §4.3 期限 / §4.4 attitude / severity 派生同期 §3.4)。
//   crisisSystem は projectOutcomeSystem の後に走るため、resolved Crisis は既に purge 済み (§2.4)。
function runWeeklyProcessing(
  ws: WorldState,
  config: SimulationConfig,
  absoluteWeek: number,
  emitEvent: (input: CreateSimEventInput) => void,
): boolean {
  let touched = false

  for (const crisisIdStr of Object.keys(ws.crises).sort()) {
    const crisis = ws.crises[crisisIdStr as keyof typeof ws.crises]
    if (!crisis || crisis.status !== 'active') continue
    touched = true

    const holdingId = crisis.holdingId
    const popClass: PopClass | undefined = crisis.kind === 'plague' ? undefined : 'peasants'

    // owner を live 解決 (§0-10)。owner inactive/holding terminal 喪失 → expired+purge (EC2/EC5)。
    const ownerPolityId = getHoldingTerminalPolityId(ws, holdingId)
    const ownerPolity = ownerPolityId ? ws.polities[ownerPolityId] : undefined
    if (!ownerPolityId || !ownerPolity || !ownerPolity.active) {
      removeCrisisMut(ws, crisis.id)
      continue
    }

    // 対処 Project の状態を確認し severity を派生同期 (§3.4)。
    const project = crisis.responseProjectId ? ws.projects[crisis.responseProjectId] : undefined
    const activeProject =
      project && project.status === 'active' && project.kind === 'handle_crisis'
        ? project
        : undefined

    // EC1: 所有移転で Project.owner がずれていたら cancel して responseProject をクリア (再 spawn 対象に)。
    let effectiveProject = activeProject
    if (
      activeProject &&
      (activeProject.owner.kind !== 'polity' || activeProject.owner.id !== ownerPolityId)
    ) {
      ws.projects[activeProject.id] = {
        ...activeProject,
        status: 'cancelled',
        terminalReason: 'owner_inactive',
      }
      setCrisisResponseProjectMut(ws, crisis.id, undefined)
      effectiveProject = undefined
    }

    let severity = crisis.severity
    if (effectiveProject) {
      severity = Math.max(0, effectiveProject.targetProgress - effectiveProject.progress)
      if (severity !== crisis.severity) setCrisisSeverityMut(ws, crisis.id, severity)
    }

    // §4.3 期限処理: deadline 未解決 → expired。追加 affection 低下を確定して purge。
    //   (Phase C の unrest はここで commonwealth 成立 + 独立戦争へ接続する — §5.3。)
    if (absoluteWeek >= crisis.deadlineWeek) {
      applyExpiredAttitude(ws, config, crisis, ownerPolityId)
      emitEvent({
        type: 'CRISIS_EXPIRED',
        importance: 'normal',
        messageKey: 'crisis.expired',
        messageParams: {
          crisisKind: crisis.kind,
          holding: nameParam('holding', ws.holdings[holdingId]?.nameKey ?? holdingId),
        },
        entityRefs: [entityRef('holding', holdingId, 'holding')],
      })
      removeCrisisMut(ws, crisis.id)
      continue
    }

    // §4.2 週次デバフ (active, severity 比例)。放置 Crisis も severity 据え置きでデバフ継続。
    if (severity > 0) {
      adjustHoldingPopWealthMut(
        ws,
        holdingId,
        -config.crisisWeeklyWealthPenaltyPerSeverity * severity,
        popClass,
      )
      adjustHoldingPopUnrestMut(
        ws,
        holdingId,
        config.crisisWeeklyUnrestPerSeverity * severity,
        popClass,
      )
    }

    // §4.4 放置時の attitude 低下 (対処 Project 無し or 予算不足で secure_budget 停滞)。
    //   代官 (person) と Polity への affection を毎週低下。owner house は対象外 (§0-6)。
    const neglected = !effectiveProject || effectiveProject.currentStageKey === 'secure_budget'
    if (neglected) {
      applyNeglectAttitude(ws, config, crisis, ownerPolityId, popClass)
    }
  }

  return touched
}

// 放置中の週次 affection 低下 (代官 + Polity)。
function applyNeglectAttitude(
  ws: WorldState,
  config: SimulationConfig,
  crisis: WorldState['crises'][keyof WorldState['crises']],
  ownerPolityId: PolityId,
  popClass: PopClass | undefined,
): void {
  const bailiff = getActiveBailiff(ws, crisis.holdingId)
  if (bailiff) {
    adjustHoldingPopAttitudeMut(
      ws,
      crisis.holdingId,
      { kind: 'person', id: bailiff },
      { affection: config.crisisNeglectAffectionDropPerWeekBailiff },
      popClass,
    )
  }
  adjustHoldingPopAttitudeMut(
    ws,
    crisis.holdingId,
    { kind: 'polity', id: ownerPolityId },
    { affection: config.crisisNeglectAffectionDropPerWeekPolity },
    popClass,
  )
}

// expired 確定時の追加 affection 低下 (代官 + Polity)。
function applyExpiredAttitude(
  ws: WorldState,
  config: SimulationConfig,
  crisis: WorldState['crises'][keyof WorldState['crises']],
  ownerPolityId: PolityId,
): void {
  const popClass: PopClass | undefined = crisis.kind === 'plague' ? undefined : 'peasants'
  const bailiff = getActiveBailiff(ws, crisis.holdingId)
  if (bailiff) {
    adjustHoldingPopAttitudeMut(
      ws,
      crisis.holdingId,
      { kind: 'person', id: bailiff },
      { affection: config.crisisExpiredAffectionDropBailiff },
      popClass,
    )
  }
  adjustHoldingPopAttitudeMut(
    ws,
    crisis.holdingId,
    { kind: 'polity', id: ownerPolityId },
    { affection: config.crisisExpiredAffectionDropPolity },
    popClass,
  )
}

export function runCrisisSystem(ctx: TickContext): TickContext {
  if (!ctx.config.crisisEnabled) return ctx

  const config = ctx.config
  const absoluteWeek = ctx.state.absoluteWeek

  // 1 tick 1 draft: Crisis slice (crises/crisisIndex/nextCrisisId は spread で carry) と
  //   Project slice (projects/projectIndex/nextProjectId)・popGroups の全てを同一 draft に反映する
  //   (§2.2 two-slice 書き戻しの罠: 片方だけ進めると ID 衝突 → integrity 違反)。
  const ws: WorldState = {
    ...ctx.state,
    crises: { ...ctx.state.crises },
    crisisIndex: {
      byHolding: { ...ctx.state.crisisIndex.byHolding },
      byProject: { ...ctx.state.crisisIndex.byProject },
    },
    projects: { ...ctx.state.projects },
    projectIndex: {
      byOwner: { ...ctx.state.projectIndex.byOwner },
      byAim: { ...ctx.state.projectIndex.byAim },
      byParentProject: { ...ctx.state.projectIndex.byParentProject },
      byCreatorPerson: { ...ctx.state.projectIndex.byCreatorPerson },
      bySupervisorPerson: { ...ctx.state.projectIndex.bySupervisorPerson },
      byRelatedEntity: { ...ctx.state.projectIndex.byRelatedEntity },
    },
    popGroups: { ...ctx.state.popGroups },
  }

  const newEvents: SimEvent[] = []
  let nextEventIndex = ctx.nextEventIndex
  function emitEvent(input: CreateSimEventInput): void {
    const id = `e-${ws.absoluteWeek}-${nextEventIndex}` as EventId
    nextEventIndex++
    newEvents.push({
      id,
      year: ws.currentYear,
      weekOfYear: ws.currentWeekOfYear,
      type: input.type,
      importance: input.importance,
      messageKey: input.messageKey,
      messageParams: input.messageParams,
      entityRefs: input.entityRefs ?? [],
      reasons: input.reasons ?? [],
      effects: input.effects ?? [],
    })
  }

  let rng = ctx.rng

  // 週次処理 (デバフ・期限・attitude・severity 同期)
  const touched = runWeeklyProcessing(ws, config, absoluteWeek, emitEvent)

  // 年次の発生ゲート (年初週)
  let spawned = false
  if (absoluteWeek % WEEKS_PER_YEAR === 0) {
    const beforeNextCrisisId = ws.nextCrisisId
    rng = runAnnualSpawn(ws, config, rng, emitEvent)
    spawned = ws.nextCrisisId !== beforeNextCrisisId || rng !== ctx.rng
  }

  if (!touched && !spawned && newEvents.length === 0) return ctx

  return { ...ctx, state: ws, rng, events: [...ctx.events, ...newEvents], nextEventIndex }
}
