import type { TickContext, CreateSimEventInput } from './context'
import { createSimEvent } from './context'
import type { SimEvent } from '../types/event'
import { nameParam, entityRef } from '../types/event'
import type { WorldState } from '../types/world'
import type { Crisis, CrisisKind, RevoltDemand } from '../types/crisis'
import type { HandleCrisisProject } from '../types/project'
import type {
  ProvinceId,
  HoldingId,
  HoldingImprovementId,
  PolityId,
  PersonId,
  ProjectId,
  CrisisId,
  EventId,
  WarId,
} from '../types/ids'
import type { PopClass } from '../types/popGroup'
import { createProjectId } from '../types/ids'
import { randomFloat } from '../rng/rng'
import type { RngState } from '../rng/rng'
import { WEEKS_PER_YEAR } from '../utils/timeUtils'
import { clamp100 } from '../utils/math'
import {
  createCrisisMut,
  setCrisisResponseProjectMut,
  setCrisisSeverityMut,
  setCrisisStatusMut,
  removeCrisisMut,
} from '../mutations/crisisMutations'
import { addProjectToIndexMut } from '../mutations/projectMutations'
import {
  reduceHoldingPopSizeProportionalMut,
  adjustHoldingPopNeedSatisfactionMut,
  adjustHoldingPopUnrestMut,
} from '../mutations/popMutations'
import { adjustHoldingPopAttitudeMut } from '../mutations/attitudeMutations'
import { getHoldingTerminalPolityId } from '../selectors/landContractSelectors'
import { getActiveBailiff } from '../selectors/bailiffSelectors'
import { holdingNameParam } from '../selectors/nameRefSelectors'
import { getHoldingImprovementEffectiveLevel } from '../selectors/holdingImprovementSelectors'
import { getProvincePopulationPressure } from '../selectors/popSelectors'
import { getPolityLeader } from '../selectors/officeSelectors'
import { selectProjectSupervisor } from '../selectors/projectSelectors'
import { getInitialProjectStageKey } from '../config/projectStageSequences'
import type { SimulationConfig } from '../config/defaultConfig'

// holding が指定 kind の Crisis を負う資格 (該当 POP を持つか) を判定する (§4.1 spawn フィルタ)。
// famine/drought → peasants(agriculture)、plague → 何らかの POP。
function holdingEligibleForKind(ws: WorldState, holdingId: HoldingId, kind: CrisisKind): boolean {
  const popIds = ws.popIndex.byHolding[holdingId]
  if (!popIds || popIds.length === 0) return false
  if (kind === 'plague') return true
  // famine / drought: 農業 peasants が居る holding のみ
  for (const popId of popIds) {
    const pop = ws.popGroups[popId]
    if (pop && pop.class === 'lower' && pop.employed) return true
  }
  return false
}

// 対処 Project の creator / supervisor を決める (§3.2)。代官 (bailiff) がいれば現地責任者として
//   creator=supervisor に据え、「有能な代官が災害を凌ぐ」現地ドラマを保つ。代官不在時は Pressure と
//   同様に owner polity の指導者を creator に立て、selectProjectSupervisor で担当者を探す。指導者すら
//   いなければ undefined (= 真に放置)。bailiff を selectProjectSupervisor に通さないのは、代官は polity
//   office ではなく holding office 保有者で officeBonus が付かず別人に displace されてしまうため。
export function resolveCrisisHandlers(
  ws: WorldState,
  config: SimulationConfig,
  holdingId: HoldingId,
  ownerPolityId: PolityId,
): { creatorId: PersonId; supervisorId: PersonId } | undefined {
  const bailiff = getActiveBailiff(ws, holdingId)
  if (bailiff) return { creatorId: bailiff, supervisorId: bailiff }

  const leaderId = getPolityLeader(ws, ownerPolityId)
  if (!leaderId) return undefined
  const leader = ws.persons[leaderId]
  if (!leader || !leader.alive || leader.kind === 'placeholder') return undefined

  const supervisorId =
    selectProjectSupervisor(
      ws,
      config,
      { kind: 'polity', id: ownerPolityId },
      'handle_crisis',
      leaderId,
    ) ?? leaderId
  return { creatorId: leaderId, supervisorId }
}

// 対処 Project (handle_crisis) を生成する。owner = live 解決した polity。creator/supervisor は
//   resolveCrisisHandlers が決める (代官 or 指導者+探索担当者)。
export function createHandleCrisisProjectMut(
  ws: WorldState,
  config: SimulationConfig,
  crisis: Crisis,
  ownerPolityId: PolityId,
  creatorId: PersonId,
  supervisorId: PersonId,
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
    creatorPersonId: creatorId,
    supervisorPersonId: supervisorId,
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

// Crisis を purge / 失効する際、まだ active な対処 Project が残っていれば cancel して orphan 化を防ぐ
//   (放置すると Crisis 消滅後も Project が ~4 週 (projectMaintenance interval) 走り、ghost 完了で
//   失効した Crisis を「解消成功」扱いしうる)。budget.remaining は projectOutcomeSystem が cancel 時に
//   owner へ返金する。EC1 の owner mismatch cancel と同型。crisisId から fresh に引き直す
//   (EC1 で responseProjectId が同 tick 中に張り替わりうるため)。
export function cancelActiveResponseProjectMut(
  ws: WorldState,
  crisisId: CrisisId,
  reason: 'deadline_expired' | 'owner_inactive' | 'target_destroyed' | 'target_repaired',
): void {
  const fresh = ws.crises[crisisId]
  const projectId = fresh?.responseProjectId
  if (!projectId) return
  const p = ws.projects[projectId]
  if (!p || p.status !== 'active') return
  // 既存規約に合わせて status を決める: deadline 到達 = 対処失敗 (failed, 評判ペナルティ対象)、
  //   owner 消滅 / 対象破壊 = 外因 (cancelled, 帰責なし)。projectMaintenanceSystem の deadline/owner 処理と同型。
  const status = reason === 'deadline_expired' ? 'failed' : 'cancelled'
  ws.projects[projectId] = { ...p, status, terminalReason: reason }
}

// v0.48.1 §5: 戦災で対象 holding の全 improvement の condition を一括減少させる。閾値割れは翌サイクル
//   以降に facilityMaintenanceSystem が disrepair Crisis として拾う。per-object spread + sort 走査。
function applyWarDamageToImprovementsMut(ws: WorldState, holdingId: HoldingId, drop: number): void {
  if (drop <= 0) return
  const impIds = [...(ws.holdingImprovementIndex.byHolding[holdingId as string] ?? [])].sort()
  for (const impId of impIds) {
    const imp = ws.holdingImprovements[impId]
    if (!imp) continue
    const newCondition = Math.max(0, imp.condition - drop)
    if (newCondition !== imp.condition) {
      ws.holdingImprovements[impId] = { ...imp, condition: newCondition }
    }
  }
}

// v0.48 Phase B: 戦災 (war_damage) Crisis を ctx ベースで spawn する。PeaceSettlementSystem が
//   land transfer 成功後に呼ぶ (§5.2)。owner = 終戦後の新支配 polity。初期ショック (全 class)・
//   代官いれば対処 Project 生成は災害と共通。two-slice 書き戻し (Crisis + Project slice) を ctx.state に反映。
//   v0.48.1 (案 B): 既に active な war_damage Crisis がある holding で再戦災が起きた場合は新規生成せず、
//   既存 Crisis の deadline をリセット (対処猶予の延長) + 設備 condition を再損傷させる。
export function spawnWarDamageCrisis(
  ctx: TickContext,
  holdingId: HoldingId,
  ownerPolityId: PolityId,
  sourceWarId: WarId,
): TickContext {
  const config = ctx.config
  const absoluteWeek = ctx.state.absoluteWeek
  const deadlineWeek = absoluteWeek + config.crisisDeadlineWeeksByKind.war_damage
  const drop = config.warDamageConditionDrop

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
    // v0.48.1 §5: 戦災で対象 holding の improvement condition を一括減少させるため slice を含める。
    holdingImprovements: { ...ctx.state.holdingImprovements },
    holdingImprovementIndex: {
      byHolding: { ...ctx.state.holdingImprovementIndex.byHolding },
    },
  }

  // 案 B (v0.48.1): 同 holding に active war_damage があれば新規生成せず、deadline をリセット (対処猶予の
  //   延長) + 設備を再損傷させる。対応 Project があれば deadline を同期 (延長が実際に効くように)。event は
  //   出さない (Crisis は既存)。
  const existing = [...(ws.crisisIndex.byHolding[holdingId as string] ?? [])]
  for (const cid of existing) {
    const c = ws.crises[cid]
    if (c && c.kind === 'war_damage' && c.status === 'active') {
      ws.crises[cid] = { ...c, deadlineWeek }
      const pid = c.responseProjectId
      if (pid) {
        const p = ws.projects[pid]
        if (p && p.status === 'active' && p.deadlineWeek !== undefined) {
          ws.projects[pid] = { ...p, deadlineWeek }
        }
      }
      applyWarDamageToImprovementsMut(ws, holdingId, drop)
      return { ...ctx, state: ws }
    }
  }

  const ownerPolity = ws.polities[ownerPolityId]
  if (!ownerPolity || !ownerPolity.active) return ctx

  // pressureExcess は無関係 (戦災は人口圧力起点でない) → severity = base のみ
  const severity = Math.min(100, config.crisisInitialSeverityByKind.war_damage)

  const crisis = createCrisisMut(ws, {
    kind: 'war_damage',
    holdingId,
    severity,
    createdWeek: absoluteWeek,
    deadlineWeek,
    status: 'active',
    reasonIds: [],
    sourceWarId,
  })

  // 戦災の初期ショックは全 class (戦火は身分を選ばない)
  const shockRate = config.crisisInitialShockSizeRateByKind.war_damage
  if (shockRate > 0) {
    reduceHoldingPopSizeProportionalMut(ws, holdingId, shockRate, undefined)
  }

  applyWarDamageToImprovementsMut(ws, holdingId, drop)

  const handlers = resolveCrisisHandlers(ws, config, holdingId, ownerPolityId)
  if (handlers) {
    createHandleCrisisProjectMut(
      ws,
      config,
      crisis,
      ownerPolityId,
      handlers.creatorId,
      handlers.supervisorId,
      absoluteWeek,
    )
  }

  const { event, ctx: ec } = createSimEvent(
    { ...ctx, state: ws },
    {
      type: 'CRISIS_CREATED',
      importance: 'minor',
      messageKey: 'crisis.created',
      messageParams: {
        crisisKind: 'war_damage',
        holding: holdingNameParam(ws, holdingId),
      },
      entityRefs: [entityRef('holding', holdingId, 'holding')],
    },
  )
  return { ...ec, events: [...ec.events, event] }
}

// v0.48 Phase C: 反乱前段の unrest Crisis を ctx ベースで spawn する。provinceRevoltSystem が
//   ロール成功時に呼ぶ (§5.3)。demand を保持し、代官いれば対処 (= 鎮静/譲歩) Project を生成する。
//   commonwealth/play は生成しない (案 A: 期限切れ時にまとめて生成し war 化する)。
export function spawnUnrestCrisis(
  ctx: TickContext,
  holdingId: HoldingId,
  ownerPolityId: PolityId,
  demand: RevoltDemand,
): TickContext {
  const config = ctx.config
  const absoluteWeek = ctx.state.absoluteWeek

  // dedup: 同 holding に active unrest があれば skip
  const existing = ctx.state.crisisIndex.byHolding[holdingId as string] ?? []
  for (const cid of existing) {
    const c = ctx.state.crises[cid]
    if (c && c.kind === 'unrest' && c.status === 'active') return ctx
  }
  const ownerPolity = ctx.state.polities[ownerPolityId]
  if (!ownerPolity || !ownerPolity.active) return ctx

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
  }

  const severity = Math.min(100, config.crisisInitialSeverityByKind.unrest)
  const deadlineWeek = absoluteWeek + config.crisisDeadlineWeeksByKind.unrest

  const crisis = createCrisisMut(ws, {
    kind: 'unrest',
    holdingId,
    severity,
    createdWeek: absoluteWeek,
    deadlineWeek,
    status: 'active',
    reasonIds: [],
    demand,
  })

  const handlers = resolveCrisisHandlers(ws, config, holdingId, ownerPolityId)
  if (handlers) {
    createHandleCrisisProjectMut(
      ws,
      config,
      crisis,
      ownerPolityId,
      handlers.creatorId,
      handlers.supervisorId,
      absoluteWeek,
    )
  }

  const { event, ctx: ec } = createSimEvent(
    { ...ctx, state: ws },
    {
      type: 'CRISIS_CREATED',
      importance: 'minor',
      messageKey: 'crisis.created',
      messageParams: {
        crisisKind: 'unrest',
        holding: holdingNameParam(ws, holdingId),
      },
      entityRefs: [entityRef('holding', holdingId, 'holding')],
    },
  )
  return { ...ec, events: [...ec.events, event] }
}

// holding 単位で Crisis を生成する。dedup・owner live 解決・初期ショック・代官いれば Project 生成。
// 生成したら true を返す (province サマリ emit 判定用)。
function spawnCrisisForHolding(
  ws: WorldState,
  config: SimulationConfig,
  holdingId: HoldingId,
  kind: CrisisKind,
  pressureExcess: number,
  pressure: number,
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

  // v0.48.1: 設備による被害軽減 (灌漑→干魃 / 貯蔵→飢饉)。その holding の当該設備の「実効レベル」
  //   (level × conditionEffectiveness) に応じ severity と初期ショックを乗算で下げる (決定的・RNG 不撹乱)。
  //   機能不全 (condition < 閾値) の設備は軽減効果が下がり、condition 0 で軽減ゼロ (壊れた蔵/灌漑は守れない)。
  //   未登録 kind は factor 1 (軽減なし)。
  const mitigation = config.crisisMitigationByKind[kind]
  let mitigationFactor = 1
  if (mitigation) {
    const effLevel = getHoldingImprovementEffectiveLevel(
      ws,
      config,
      holdingId,
      mitigation.improvementKind,
    )
    mitigationFactor = Math.max(0, 1 - mitigation.reductionPerLevel * effLevel)
  }

  const severity = Math.min(
    100,
    (config.crisisInitialSeverityByKind[kind] +
      pressureExcess * config.crisisSeverityPressureBonus) *
      mitigationFactor,
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

  // 初期ショック (一回限りの人口減, holding スコープで 1 回。province ラッパーの多重罠を回避, §4.1)。
  //   v0.55: 飢饉は固定率テーブルではなく「扶養力超過の不足分に比例した急性餓死」。市場が上限価格で
  //   食料を無限購入させてしまう抽象化を、物理制約 (餓死) で補完する (input shortage と対称)。
  //   慢性的な人口調整は popSystem の carrying-capacity growthFactor が担当し、飢饉は急性層を担う。
  let shockRate = config.crisisInitialShockSizeRateByKind[kind] * mitigationFactor
  if (kind === 'famine') {
    const deficit = Math.max(0, pressure - config.famineOnsetPressure)
    shockRate =
      Math.min(config.famineMaxMortalityRate, config.famineMortalityPerDeficit * deficit) *
      mitigationFactor
  }
  if (shockRate > 0) {
    const popClass: PopClass | undefined = kind === 'plague' ? undefined : 'lower'
    reduceHoldingPopSizeProportionalMut(ws, holdingId, shockRate, popClass)
  }

  // 対処 Project を生成 (= 凌ぐ)。代官がいれば代官が、いなければ Pressure 同様 owner polity が担当者を
  //   探す。指導者すら不在なら Project なし = 真の放置 (§3.2/§4.4)。
  const handlers = resolveCrisisHandlers(ws, config, holdingId, ownerPolityId)
  if (handlers) {
    createHandleCrisisProjectMut(
      ws,
      config,
      crisis,
      ownerPolityId,
      handlers.creatorId,
      handlers.supervisorId,
      absoluteWeek,
    )
  }

  // per-holding CRISIS_CREATED (minor)。chronicle へは登録しない (fan-out 氾濫回避, §4.5)。
  emitEvent({
    type: 'CRISIS_CREATED',
    importance: 'minor',
    messageKey: 'crisis.created',
    messageParams: {
      crisisKind: crisis.kind,
      holding: holdingNameParam(ws, holdingId),
    },
    entityRefs: [entityRef('holding', holdingId, 'holding')],
  })
  return true
}

// v0.48.1 §2.2: 設備の機能不全 (disrepair) Crisis を ws ベースで spawn する。
//   facilityMaintenanceSystem が condition 閾値割れ improvement に対し呼ぶ。ctx ベースにしないのは
//   呼び出し側 (facilityMaintenanceSystem) が同 draft で減衰を書き込んでおり、ctx ベースだと
//   その書込を lost write するため。owner は呼び出し側で live 解決・active 検証済みを受け取る。
//   生成したら true を返す。
export function spawnDisrepairCrisisMut(
  ws: WorldState,
  config: SimulationConfig,
  holdingId: HoldingId,
  improvementId: HoldingImprovementId,
  ownerPolityId: PolityId,
  absoluteWeek: number,
  emitEvent: (input: CreateSimEventInput) => void,
): boolean {
  // dedup: 同 improvement を指す active disrepair Crisis があれば skip (per-improvement 粒度, §0-6)
  const existing = ws.crisisIndex.byHolding[holdingId as string] ?? []
  for (const cid of existing) {
    const c = ws.crises[cid]
    if (
      c &&
      c.kind === 'disrepair' &&
      c.status === 'active' &&
      (c.targetImprovementId as string) === (improvementId as string)
    ) {
      return false
    }
  }

  // severity = 修理工数 (= createHandleCrisisProjectMut が targetProgress に入れる)。表示用 severity
  //   (threshold − condition) は crisisSystem が毎サイクル上書きする (§4.3)。
  const severity = config.crisisInitialSeverityByKind.disrepair
  // disrepair は deadline を使わないが Crisis.deadlineWeek は必須フィールドなので型充足値を入れる。
  const deadlineWeek = absoluteWeek + config.crisisDeadlineWeeksByKind.disrepair

  const crisis = createCrisisMut(ws, {
    kind: 'disrepair',
    holdingId,
    severity,
    createdWeek: absoluteWeek,
    deadlineWeek,
    status: 'active',
    reasonIds: [],
    targetImprovementId: improvementId,
  })

  // 対処 (= 修理) Project を生成。代官 or 指導者+探索担当者。誰もいなければ Project なし = 真の放置
  //   → §2.3 で condition 0 到達時にレベルダウン/全壊。
  const handlers = resolveCrisisHandlers(ws, config, holdingId, ownerPolityId)
  if (handlers) {
    createHandleCrisisProjectMut(
      ws,
      config,
      crisis,
      ownerPolityId,
      handlers.creatorId,
      handlers.supervisorId,
      absoluteWeek,
    )
  }

  emitEvent({
    type: 'CRISIS_CREATED',
    importance: 'minor',
    messageKey: 'crisis.created',
    messageParams: {
      crisisKind: 'disrepair',
      holding: holdingNameParam(ws, holdingId),
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

    // v0.55: 飢饉は「食料生産が物理的扶養力 (perCapitaFoodNeed ベース) を割った結果」として発火する。
    //   信号は購買力中立の pressure (= 人口 / 扶養力)。扶養力超過の不足分 (pressure − famineOnsetPressure)
    //   に比例して発火確率が上がる。market fulfillment は購買力加重で「買えない=飢える」層ほど需要が
    //   下がり充足が高く出る (逆向き) ため使わない。base は既定 0 (任意の背景飢饉率ノブ)。
    const famineDeficit = Math.max(0, pressure - config.famineOnsetPressure)
    const famineChance =
      config.famineBaseChancePerYear + config.faminePressureChanceBonus * famineDeficit
    const plagueChance =
      config.plagueBaseChancePerYear + config.plaguePressureChanceBonus * pressureExcess
    // v0.55: 干魃は気候イベント。人口圧とは独立した base chance のみで発火する。発生 holding の
    //   食料生産を減衰させ (resourceEconomySystem) → 扶養力低下 → 飢饉の原因となる。
    //   直接の人口ショックは持たない (crisisInitialShockSizeRateByKind.drought = 0)。
    const droughtChance = config.droughtBaseChancePerYear

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
            pressure,
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
    const crisis = ws.crises[crisisIdStr as CrisisId]
    if (!crisis || crisis.status !== 'active') continue
    touched = true

    const holdingId = crisis.holdingId
    // plague は全 class、unrest は反乱 class、disrepair は全 class (neglect attitude のみ使用)、
    // それ以外 (famine/drought/war_damage) は peasants。
    const popClass: PopClass | undefined =
      crisis.kind === 'plague'
        ? undefined
        : crisis.kind === 'unrest'
          ? crisis.demand?.claimantPopClass
          : crisis.kind === 'disrepair'
            ? undefined
            : 'lower'

    // owner を live 解決 (§0-10)。owner inactive/holding terminal 喪失 → expired+purge (EC2/EC5)。
    const ownerPolityId = getHoldingTerminalPolityId(ws, holdingId)
    const ownerPolity = ownerPolityId ? ws.polities[ownerPolityId] : undefined
    if (!ownerPolityId || !ownerPolity || !ownerPolity.active) {
      cancelActiveResponseProjectMut(ws, crisis.id, 'owner_inactive')
      removeCrisisMut(ws, crisis.id)
      continue
    }

    // 対処 Project の状態を確認し severity を派生同期 (§3.4)。
    const project = crisis.responseProjectId ? ws.projects[crisis.responseProjectId] : undefined
    const activeProject =
      project && project.status === 'active' && project.kind === 'handle_crisis'
        ? project
        : undefined

    // EC1: 所有移転で Project.owner がずれていたら旧 Project を cancel し、新 owner の代官がいれば
    //   対処 Project を張り直す (自己修復)。新 owner に代官がいなければ放置 (responseProject クリアのみ)。
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
      // 新 owner で担当者を立て直して対処 Project を張り直す (次 tick から severity sync が拾う)。
      //   代官 or 指導者+探索担当者。誰もいなければ放置 (responseProject クリアのみ)。
      const fresh = ws.crises[crisis.id]
      const newHandlers = resolveCrisisHandlers(ws, config, holdingId, ownerPolityId)
      if (newHandlers && fresh) {
        createHandleCrisisProjectMut(
          ws,
          config,
          fresh,
          ownerPolityId,
          newHandlers.creatorId,
          newHandlers.supervisorId,
          absoluteWeek,
        )
      }
    }

    // EC6: 放置リトライ — 対処 Project がない active crisis に毎週担当者を探し直す。
    //   commonwealth 成立直後など人材不足で spawn 時に Project を立てられなかった crisis が、
    //   行政官配置後に回復できるようにする。
    if (!effectiveProject) {
      const fresh = ws.crises[crisis.id]
      if (fresh && !fresh.responseProjectId) {
        const retryHandlers = resolveCrisisHandlers(ws, config, holdingId, ownerPolityId)
        if (retryHandlers) {
          createHandleCrisisProjectMut(
            ws,
            config,
            fresh,
            ownerPolityId,
            retryHandlers.creatorId,
            retryHandlers.supervisorId,
            absoluteWeek,
          )
          const updated = ws.crises[crisis.id]
          effectiveProject = updated?.responseProjectId
            ? (ws.projects[updated.responseProjectId] as HandleCrisisProject | undefined)
            : undefined
        }
      }
    }

    let severity = crisis.severity
    if (crisis.kind === 'disrepair') {
      // v0.48.1 §4.3: disrepair は condition 駆動。表示 severity = clamp(0,100, threshold − condition)
      //   (機能不全の深刻度)。Project 進捗ベースの派生は使わない (使うと severity が修理進捗を反映する
      //   behavioral bug)。condition は facilityMaintenanceSystem が動かすのでここは読むだけ。
      const impId = crisis.targetImprovementId
      const imp = impId ? ws.holdingImprovements[impId] : undefined
      if (imp) {
        const displaySeverity = clamp100(config.facilityDisrepairThreshold - imp.condition)
        if (displaySeverity !== crisis.severity)
          setCrisisSeverityMut(ws, crisis.id, displaySeverity)
        severity = displaySeverity
      }
    } else if (effectiveProject) {
      severity = Math.max(0, effectiveProject.targetProgress - effectiveProject.progress)
      if (severity !== crisis.severity) setCrisisSeverityMut(ws, crisis.id, severity)
    }

    // §4.3 期限処理: deadline 未解決 → expired。disrepair は終端 repaired/destroyed のみ (タイマー無し)。
    if (crisis.kind !== 'disrepair' && absoluteWeek >= crisis.deadlineWeek) {
      applyExpiredAttitude(ws, config, crisis, ownerPolityId, popClass)
      // まだ active な対処 Project を cancel (orphan 防止)。非 unrest は即 purge、unrest は
      //   unrestCrisisSystem が purge するが、いずれも対処 Project はこの時点で終了させてよい
      //   (Crisis 有効期間 = Project 実行 deadline で、期限到達 = 対処失敗のため)。
      cancelActiveResponseProjectMut(ws, crisis.id, 'deadline_expired')
      if (crisis.kind === 'unrest') {
        // §5.3 案 A: unrest は purge せず expired を mark するだけ。武装蜂起 (commonwealth+play
        //   生成→escalation) は ctx ベースの unrestCrisisSystem が同 tick で適用する (Decision 1)。
        setCrisisStatusMut(ws, crisis.id, 'expired')
      } else {
        emitEvent({
          type: 'CRISIS_EXPIRED',
          importance: 'normal',
          messageKey: 'crisis.expired',
          messageParams: {
            crisisKind: crisis.kind,
            holding: holdingNameParam(ws, holdingId),
          },
          entityRefs: [entityRef('holding', holdingId, 'holding')],
        })
        removeCrisisMut(ws, crisis.id)
      }
      continue
    }

    // §4.2 週次デバフ (active, severity 比例)。放置 Crisis も severity 据え置きでデバフ継続。
    // v0.48.1 §4.3: disrepair の実コストは生産 effectiveness 低下 (§3) なので severity 比例の pop
    //   デバフは適用しない (二重計上回避)。間接連鎖 (生産低下→wealth→unrest) は残る。
    if (crisis.kind !== 'disrepair' && severity > 0) {
      adjustHoldingPopNeedSatisfactionMut(
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
  // v0.48.1: disrepair は唯一 deadline を持たず neglect が破壊までの multi-year にわたって蓄積するため、
  //   週次 affection 低下を他 Crisis より穏やかにする (crisisDisrepairNeglectMultiplier、通常 < 1)。
  const mult = crisis.kind === 'disrepair' ? config.crisisDisrepairNeglectMultiplier : 1
  const bailiff = getActiveBailiff(ws, crisis.holdingId)
  if (bailiff) {
    adjustHoldingPopAttitudeMut(
      ws,
      crisis.holdingId,
      { kind: 'person', id: bailiff },
      { affection: config.crisisNeglectAffectionDropPerWeekBailiff * mult },
      popClass,
    )
  }
  adjustHoldingPopAttitudeMut(
    ws,
    crisis.holdingId,
    { kind: 'polity', id: ownerPolityId },
    { affection: config.crisisNeglectAffectionDropPerWeekPolity * mult },
    popClass,
  )
}

// expired 確定時の追加 affection 低下 (代官 + Polity)。popClass は呼び出し側で算出した対象 class
//   (unrest なら claimantPopClass) を受け取る — 内部で再計算すると unrest の反乱 class を取り違える。
function applyExpiredAttitude(
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

  // 年次の発生ゲート (年初週)。famine/plague/drought は自然災害なので従来どおり disasterEnabled でも
  //   suppress できる (旧 disasterSystem の kill-switch 互換)。war_damage/unrest は別経路で spawn される。
  let spawned = false
  if (config.disasterEnabled && absoluteWeek % WEEKS_PER_YEAR === 0) {
    const beforeNextCrisisId = ws.nextCrisisId
    rng = runAnnualSpawn(ws, config, rng, emitEvent)
    spawned = ws.nextCrisisId !== beforeNextCrisisId || rng !== ctx.rng
  }

  if (!touched && !spawned && newEvents.length === 0) return ctx

  return { ...ctx, state: ws, rng, events: [...ctx.events, ...newEvents], nextEventIndex }
}
