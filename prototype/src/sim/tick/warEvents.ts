import type { TickContext } from './context'
import { createSimEvent } from './context'
import type {
  War,
  WarGoal,
  WarSideKey,
  BattlefieldKind,
  BattleResult,
  BattleInitiationKind,
} from '../types/war'
import type { BattleOutcomeQuality } from '../types/battle'
import type { PersonId, PolityId, ProvinceId } from '../types/ids'
import type { OrganizationRef } from '../types/office'
import type { WorldState } from '../types/world'
import type {
  EventType,
  EventImportance,
  EventMessageParams,
  EventEntityRef,
  EventEntityKind,
} from '../types/event'
import { nameParam, entityRef } from '../types/event'
import { getPolityNameRefForEmit, getHoldingNameRefForEmit } from '../selectors/nameRefSelectors'
import { getOrganizationName } from '../selectors/organizationSelectors'
import { isContractEliminationRate } from '../selectors/landContractSelectors'
import {
  getWarPrimaryAttacker,
  getWarPrimaryDefender,
  describeWarGoal,
} from '../mutations/warMutations'

// v0.34: War lifecycle system 群 (Creation / Progress / cancelOrphaned / PeaceSettlement) が
//   共有する event 発行 helper。createSimEvent は event を返すだけで ctx.events に積まないため、
//   ここで append まで行う (conflictResolutionSystem.ts の local emitEvent と同パターン)。

function actorEntityKind(actor: OrganizationRef): EventEntityKind {
  switch (actor.kind) {
    case 'polity':
      return 'polity'
    case 'house':
      return 'house'
    case 'merchant_company':
      return 'merchant_company'
  }
}

function actorNameKey(state: WorldState, actor: OrganizationRef): string {
  return getOrganizationName(state, actor)
}

// v0.41 (§7.2): nameParam の emit category。holding 由来 Polity は 'polity' でなく
// 'province'/'city' になるため、actor.kind ではなくこの helper で category を決める。
function actorEmitCategory(state: WorldState, actor: OrganizationRef): string {
  if (actor.kind === 'polity') return getPolityNameRefForEmit(state, actor.id).category
  if (actor.kind === 'house') return 'house'
  return 'merchant_company'
}

function emit(
  ctx: TickContext,
  type: EventType,
  importance: EventImportance,
  messageKey: string,
  messageParams: EventMessageParams,
  entityRefs: EventEntityRef[],
): TickContext {
  // v0.49 §16.2: warId を持つ war event は chronicleIndex.byWar 駆動のため war ref を自動付与する。
  //   既に war ref があれば足さない (index 側でも (kind,id) dedupe される)。War detail が full-scan を回避。
  const wid = messageParams.warId
  const refs =
    typeof wid === 'string' && !entityRefs.some((r) => r.kind === 'war' && r.id === wid)
      ? [...entityRefs, entityRef('war', wid, 'war')]
      : entityRefs
  const { event, ctx: nextCtx } = createSimEvent(ctx, {
    type,
    importance,
    messageKey,
    messageParams,
    entityRefs: refs,
  })
  return { ...nextCtx, events: [...nextCtx.events, event] }
}

type WarParties = {
  attacker: OrganizationRef
  defender: OrganizationRef
  attackerName: string
  defenderName: string
  attackerCategory: string
  defenderCategory: string
}

function warParties(state: WorldState, war: War): WarParties | undefined {
  const a = getWarPrimaryAttacker(war)?.actor
  const d = getWarPrimaryDefender(war)?.actor
  if (!a || !d) return undefined
  return {
    attacker: a,
    defender: d,
    attackerName: actorNameKey(state, a),
    defenderName: actorNameKey(state, d),
    attackerCategory: actorEmitCategory(state, a),
    defenderCategory: actorEmitCategory(state, d),
  }
}

function attackerDefenderRefs(p: WarParties): EventEntityRef[] {
  return [
    entityRef(actorEntityKind(p.attacker), p.attacker.id, 'attacker', p.attackerName),
    entityRef(actorEntityKind(p.defender), p.defender.id, 'defender', p.defenderName),
  ]
}

// v0.43 §10.4 WAR_PARTICIPANT_JOINED — copy filter を通過した supporter ごとに発行 (normal)。
//   宣言だけで参戦しなかった supporter (filter 落ち) はこの event が出ない —
//   DIPLOMATIC_SUPPORT_DECLARED とのペア有無で「宣言したが参戦しなかった」を読める (§10.3a)。
export function emitWarParticipantJoined(
  ctx: TickContext,
  war: War,
  sideKey: WarSideKey,
  supporterPolityId: PolityId,
): TickContext {
  const p = warParties(ctx.state, war)
  if (!p) return ctx
  const supporterRef = getPolityNameRefForEmit(ctx.state, supporterPolityId)
  const primary = sideKey === 'attacker' ? p.attacker : p.defender
  const primaryName = sideKey === 'attacker' ? p.attackerName : p.defenderName
  const primaryCategory = sideKey === 'attacker' ? p.attackerCategory : p.defenderCategory
  return emit(
    ctx,
    'WAR_PARTICIPANT_JOINED',
    'normal',
    'war.participant_joined',
    {
      warId: war.id,
      supporter: nameParam(supporterRef.category, supporterRef.nameKey),
      primary: nameParam(primaryCategory, primaryName),
    },
    [
      entityRef('polity', supporterPolityId, 'supporter', supporterRef.nameKey),
      entityRef(actorEntityKind(primary), primary.id, sideKey, primaryName),
    ],
  )
}

// §12.2 WAR_DECLARED — WarCreationSystem が War 作成時に発行 (major)。
//   casus belli として「対象 + 戦争前の状態 + 変えようとする内容」を記録する (歴史記述)。
//   War は terminalWarRetentionWeeks 後に cleanup されるため、永続記録はこの event params が担う。
export function emitWarDeclared(ctx: TickContext, war: War, issueKind: string): TickContext {
  const p = warParties(ctx.state, war)
  if (!p) return ctx

  const goal = war.warGoals[0]
  // goal 不在は防御的 fallback (汎用 war.declared)。
  if (!goal) {
    return emit(
      ctx,
      'WAR_DECLARED',
      'major',
      'war.declared.generic',
      {
        warId: war.id,
        attacker: nameParam(p.attackerCategory, p.attackerName),
        defender: nameParam(p.defenderCategory, p.defenderName),
        issue: issueKind,
      },
      attackerDefenderRefs(p),
    )
  }

  const desc = describeWarGoal(ctx.state, goal)

  if (desc.kind === 'popular_revolt_independence') {
    const holdingId = desc.holdingIds?.[0]
    const holding = holdingId ? ctx.state.holdings[holdingId] : undefined
    const provId = holding?.provinceId
    const prov = provId ? ctx.state.provinces[provId] : undefined
    const revoltRefs: EventEntityRef[] = [...attackerDefenderRefs(p)]
    if (provId) revoltRefs.push(entityRef('province', provId, 'province', prov?.nameKey))
    return emit(
      ctx,
      'WAR_DECLARED',
      'major',
      'war.declared.revolt',
      {
        warId: war.id,
        attacker: nameParam(p.attackerCategory, p.attackerName),
        defender: nameParam(p.defenderCategory, p.defenderName),
        province: nameParam('province', prov?.nameKey ?? ''),
      },
      revoltRefs,
    )
  }

  const subjectName = desc.provinceNameKey ?? desc.holdingId
  const refs: EventEntityRef[] = [...attackerDefenderRefs(p)]
  if (desc.provinceId) {
    refs.push(entityRef('province', desc.provinceId, 'province', desc.provinceNameKey))
  }

  if (desc.kind === 'change_contract_tax_rate') {
    // §6.69: 目標税率が境界クランプ = 契約取消し意図。税率改定ではなく「土地契約の解除」を語る。
    if (isContractEliminationRate(desc.afterRate, ctx.config)) {
      return emit(
        ctx,
        'WAR_DECLARED',
        'major',
        'war.declared.dissolve_contract',
        {
          warId: war.id,
          attacker: nameParam(p.attackerCategory, p.attackerName),
          defender: nameParam(p.defenderCategory, p.defenderName),
          subject: nameParam('province', subjectName),
        },
        refs,
      )
    }
    return emit(
      ctx,
      'WAR_DECLARED',
      'major',
      'war.declared.change_tax',
      {
        warId: war.id,
        attacker: nameParam(p.attackerCategory, p.attackerName),
        defender: nameParam(p.defenderCategory, p.defenderName),
        subject: nameParam('province', subjectName),
        fromRate: Math.round(desc.beforeRate * 100),
        toRate: Math.round(desc.afterRate * 100),
      },
      refs,
    )
  }

  // transfer_land_contract: 元保持者 (fromPolityId) を明示する。
  const fromRef = getPolityNameRefForEmit(ctx.state, desc.fromPolityId)
  return emit(
    ctx,
    'WAR_DECLARED',
    'major',
    'war.declared.transfer_land',
    {
      warId: war.id,
      attacker: nameParam(p.attackerCategory, p.attackerName),
      defender: nameParam(p.defenderCategory, p.defenderName),
      subject: nameParam('province', subjectName),
      from: nameParam(fromRef.category, fromRef.nameKey),
    },
    refs,
  )
}

// §12.4 WAR_WON / WAR_LOST — PeaceSettlementSystem が決着時に勝者/敗者へ発行 (major)。
export function emitWarOutcome(ctx: TickContext, war: War, attackerWon: boolean): TickContext {
  const p = warParties(ctx.state, war)
  if (!p) return ctx
  const winner = attackerWon ? p.attacker : p.defender
  const loser = attackerWon ? p.defender : p.attacker
  const winnerName = attackerWon ? p.attackerName : p.defenderName
  const loserName = attackerWon ? p.defenderName : p.attackerName
  const winnerCategory = attackerWon ? p.attackerCategory : p.defenderCategory
  const loserCategory = attackerWon ? p.defenderCategory : p.attackerCategory
  let next = emit(
    ctx,
    'WAR_WON',
    'major',
    'war.won',
    {
      warId: war.id,
      winner: nameParam(winnerCategory, winnerName),
      loser: nameParam(loserCategory, loserName),
    },
    [
      entityRef(actorEntityKind(winner), winner.id, 'winner', winnerName),
      entityRef(actorEntityKind(loser), loser.id, 'loser', loserName),
    ],
  )
  next = emit(
    next,
    'WAR_LOST',
    'major',
    'war.lost',
    {
      warId: war.id,
      loser: nameParam(loserCategory, loserName),
      winner: nameParam(winnerCategory, winnerName),
    },
    [
      entityRef(actorEntityKind(loser), loser.id, 'loser', loserName),
      entityRef(actorEntityKind(winner), winner.id, 'winner', winnerName),
    ],
  )
  return next
}

// §12.4a WAR_ENDED — white_peace (timeout / stale 安全終結) / cancelled (orphan) 終結で発行 (major)。
export function emitWarEnded(ctx: TickContext, war: War): TickContext {
  const p = warParties(ctx.state, war)
  if (!p) return ctx
  return emit(
    ctx,
    'WAR_ENDED',
    'major',
    'war.ended',
    {
      warId: war.id,
      attacker: nameParam(p.attackerCategory, p.attackerName),
      defender: nameParam(p.defenderCategory, p.defenderName),
    },
    attackerDefenderRefs(p),
  )
}

// v0.42 WAR_AVERTED — WarCreationSystem が勝率/性格ゲートで開戦を見送った時に発行 (minor)。
//   War entity は生成されていないため、attacker/defender の OrganizationRef を直接受け取る。
//   winChance / threshold は 0..1 を百分率に丸めて params に記録する (歴史記述・デバッグ)。
export function emitWarAverted(
  ctx: TickContext,
  attacker: OrganizationRef,
  defender: OrganizationRef,
  winChance: number,
  threshold: number,
): TickContext {
  const state = ctx.state
  const attackerName = actorNameKey(state, attacker)
  const defenderName = actorNameKey(state, defender)
  const attackerCategory = actorEmitCategory(state, attacker)
  const defenderCategory = actorEmitCategory(state, defender)
  return emit(
    ctx,
    'WAR_AVERTED',
    'minor',
    'war.averted',
    {
      attacker: nameParam(attackerCategory, attackerName),
      defender: nameParam(defenderCategory, defenderName),
      winChance: Math.round(winChance * 100),
      threshold: Math.round(threshold * 100),
    },
    [
      entityRef(actorEntityKind(attacker), attacker.id, 'attacker', attackerName),
      entityRef(actorEntityKind(defender), defender.id, 'defender', defenderName),
    ],
  )
}

// §12.5 PEACE_SETTLEMENT_APPLIED — tax 経路は底層 mutation が event を出さないため必ずここで発行。
//   transfer 経路は applyLandContractTransferGoal が LAND_CONTRACT_* を内部発行するので、
//   PeaceSettlement 側はこの「適用された」ことを示す 1 件だけを補足的に発行する。
export function emitPeaceSettlementApplied(ctx: TickContext, war: War, goal: WarGoal): TickContext {
  const p = warParties(ctx.state, war)
  if (!p) return ctx
  // v0.39: revolt WarGoal のハンドラは未実装。event 発行不要。
  if (goal.kind === 'popular_revolt_independence') return ctx
  const holding = ctx.state.holdings[goal.holdingId]
  const provinceId = holding?.provinceId
  // v0.41 (§7.2/§8): Holding 名は Province 名代用でなく Holding 自身の name を kind→category 出し分けで使う。
  const holdingRef = getHoldingNameRefForEmit(ctx.state, goal.holdingId)
  // §6.69: 税率改定 goal でも newRate が境界クランプなら「土地契約の解除」を語る。
  const isElimination =
    goal.kind === 'change_contract_tax_rate' &&
    isContractEliminationRate(goal.newTaxRateToGrantor, ctx.config)
  const messageKey =
    goal.kind === 'transfer_land_contract'
      ? 'war.peace_settlement.transfer_land'
      : isElimination
        ? 'war.peace_settlement.dissolve_contract'
        : 'war.peace_settlement.change_tax'
  const refs: EventEntityRef[] = [
    entityRef('holding', goal.holdingId, 'holding'),
    ...attackerDefenderRefs(p),
  ]
  if (provinceId) {
    refs.push(
      entityRef('province', provinceId, 'province', ctx.state.provinces[provinceId]?.nameKey),
    )
  }
  return emit(
    ctx,
    'PEACE_SETTLEMENT_APPLIED',
    'major',
    messageKey,
    {
      warId: war.id,
      attacker: nameParam(p.attackerCategory, p.attackerName),
      defender: nameParam(p.defenderCategory, p.defenderName),
      holding: nameParam(holdingRef.category, holdingRef.nameKey),
      // tax 経路は before→after の税率を記録する (歴史記述)。transfer は from/to を底層 LAND_CONTRACT_* が持つ。
      ...(goal.kind === 'change_contract_tax_rate'
        ? {
            fromRate: Math.round(goal.baseTaxRateToGrantor * 100),
            toRate: Math.round(goal.newTaxRateToGrantor * 100),
          }
        : {}),
    },
    refs,
  )
}

// ─── v0.35 §11: WarManeuver の Battle / Avoidance / 総大将交代 event ───
//   Battle entity を持たないため params は self-contained (province 名・人物名・powers・warScore)。
//   人物 (総大将 / commander) は entityRef('person', ...) で UI クリック可能化する。

function personNameKeyOrId(state: WorldState, id: PersonId): string {
  return state.persons[id]?.nameKey ?? id
}

// person ref を返す (undefined は積まない)。
function personRef(
  state: WorldState,
  id: PersonId | undefined,
  role: string,
): EventEntityRef | undefined {
  if (id === undefined) return undefined
  return entityRef('person', id, role, state.persons[id]?.nameKey)
}

export type BattleOccurredInput = {
  provinceId?: ProvinceId
  battlefieldKind: BattlefieldKind
  initiationKind: BattleInitiationKind
  result: BattleResult
  attackerCaptainGeneralId?: PersonId
  defenderCaptainGeneralId?: PersonId
  attackerCommanderId?: PersonId
  defenderCommanderId?: PersonId
  // 実際に連隊を率いた現場指揮官全員 (本人の年代記に会戦を残すための person ref 用)。
  //   narrative テキストは上の単一 representative commander を使い、こちらは全員分の ref を積む。
  attackerCommanderPersonIds?: readonly PersonId[]
  defenderCommanderPersonIds?: readonly PersonId[]
  attackerPower: number
  defenderPower: number
  attackerEffectivePower: number
  defenderEffectivePower: number
  warScoreDelta: number
  warScoreAfter: number
  // v0.36 §16: Battle entity 参照 + 両 side の動員連隊数 (counts-only enrich)。
  battleId: string
  attackerRegimentCount: number
  defenderRegimentCount: number
  // v0.37 §17: battle summary enrich (additive)。counts は Battle entity の ID 配列から導出。
  outcomeQuality?: BattleOutcomeQuality
  ticksElapsed?: number
  frontage?: number
  attackerInitialFrontlineCount?: number
  defenderInitialFrontlineCount?: number
  attackerRoutedCount?: number
  defenderRoutedCount?: number
  breakthroughSide?: WarSideKey
  pursuitOccurred?: boolean
  // 会戦再生 UI: major 会戦のみ恒久 BattleLog の id を渡す。ChronicleEntry に battleLog ref を付け
  //   年代記から会戦再生パネルへリンクする。normal は retention で purge されるため渡さない (dangling 防止)。
  battleLogId?: string
}

// §11.1 BATTLE_OCCURRED (normal)。warScore 変化は warScoreDelta / warScoreAfter で表現。
export function emitBattleOccurred(
  ctx: TickContext,
  war: War,
  input: BattleOccurredInput,
): TickContext {
  const state = ctx.state
  const p = warParties(state, war)
  if (!p) return ctx
  const provinceNameKey = input.provinceId ? state.provinces[input.provinceId]?.nameKey : undefined
  // v0.38 Phase 4: chronicle narrative 用の派生フラグ (additive・純粋導出で RNG 不変)。
  //   chronicleEventDefinitions.selectBattleTemplate が rich template 出し分けに使う。
  const isVictory = input.result === 'attacker_victory' || input.result === 'defender_victory'
  // 「数的劣勢を覆した勝利」(outnumbered_victory template) は連隊数で判定する。
  //   chronicle template が両 side の連隊数を表示して「数的劣勢」と描写するため、判定根拠も
  //   連隊数に一致させる (effectivePower 基準だと「連隊数は多いが戦力で劣った勝者」を数的劣勢と
  //   誤表示してしまう)。
  const winnerRegimentCount =
    input.result === 'attacker_victory' ? input.attackerRegimentCount : input.defenderRegimentCount
  const loserRegimentCount =
    input.result === 'attacker_victory' ? input.defenderRegimentCount : input.attackerRegimentCount
  const outnumberedVictory = isVictory && winnerRegimentCount < loserRegimentCount
  const decisiveVictory = input.outcomeQuality === 'rout'
  const refs: EventEntityRef[] = [...attackerDefenderRefs(p)]
  // v0.49 §16.2: war ref は emit() が params.warId から自動付与する (chronicleIndex.byWar 駆動)。
  if (input.provinceId) {
    refs.push(entityRef('province', input.provinceId, 'province', provinceNameKey))
  }
  // 会戦再生 UI: major 会戦のみ BattleLog ref を付け、年代記から会戦再生パネルへリンクする。
  if (input.battleLogId) {
    refs.push(entityRef('battleLog', input.battleLogId, 'battle'))
  }
  for (const [id, role] of [
    [input.attackerCaptainGeneralId, 'attacker_captain_general'],
    [input.defenderCaptainGeneralId, 'defender_captain_general'],
  ] as const) {
    const r = personRef(state, id, role)
    if (r) refs.push(r)
  }
  // 実際に連隊を率いた現場指揮官を全員 person ref に積む (本人の年代記=byPerson に会戦が残る)。
  //   同一人物が複数連隊を率いる/CG 兼任のケースは dedupe (index 側でも (kind,id) 重複は畳まれる)。
  const seenCommander = new Set<string>()
  for (const [ids, role] of [
    [input.attackerCommanderPersonIds, 'attacker_commander'],
    [input.defenderCommanderPersonIds, 'defender_commander'],
  ] as const) {
    for (const id of ids ?? []) {
      if (seenCommander.has(id)) continue
      seenCommander.add(id)
      const r = personRef(state, id, role)
      if (r) refs.push(r)
    }
  }
  const winnerName =
    input.result === 'attacker_victory'
      ? p.attackerName
      : input.result === 'defender_victory'
        ? p.defenderName
        : undefined
  const loserName =
    input.result === 'attacker_victory'
      ? p.defenderName
      : input.result === 'defender_victory'
        ? p.attackerName
        : undefined
  const winnerCategory =
    input.result === 'attacker_victory'
      ? p.attackerCategory
      : input.result === 'defender_victory'
        ? p.defenderCategory
        : p.attackerCategory
  const loserCategory =
    input.result === 'attacker_victory'
      ? p.defenderCategory
      : input.result === 'defender_victory'
        ? p.attackerCategory
        : p.defenderCategory
  const battleMessageKey =
    input.result === 'inconclusive' ? 'war.battle_occurred_inconclusive' : 'war.battle_occurred'
  return emit(
    ctx,
    'BATTLE_OCCURRED',
    'normal',
    battleMessageKey,
    {
      warId: war.id,
      battleId: input.battleId,
      battlefieldKind: input.battlefieldKind,
      initiationKind: input.initiationKind,
      result: input.result,
      attacker: nameParam(p.attackerCategory, p.attackerName),
      defender: nameParam(p.defenderCategory, p.defenderName),
      attackerName: nameParam(p.attackerCategory, p.attackerName),
      defenderName: nameParam(p.defenderCategory, p.defenderName),
      ...(winnerName ? { winnerName: nameParam(winnerCategory, winnerName) } : {}),
      ...(loserName ? { loserName: nameParam(loserCategory, loserName) } : {}),
      attackerPower: input.attackerPower,
      defenderPower: input.defenderPower,
      attackerEffectivePower: input.attackerEffectivePower,
      defenderEffectivePower: input.defenderEffectivePower,
      attackerRegimentCount: input.attackerRegimentCount,
      defenderRegimentCount: input.defenderRegimentCount,
      warScoreDelta: input.warScoreDelta,
      warScoreAfter: input.warScoreAfter,
      // v0.38 Phase 4: chronicle narrative 選択用フラグ (描画はせず template 出し分けにのみ使う)。
      outnumberedVictory,
      decisiveVictory,
      // v0.37 §17: battle summary (additive。raw 値/enum で渡し、表示解決は eventRenderer)。
      ...(input.outcomeQuality ? { outcomeQuality: input.outcomeQuality } : {}),
      ...(input.ticksElapsed !== undefined ? { ticksElapsed: input.ticksElapsed } : {}),
      ...(input.frontage !== undefined ? { frontage: input.frontage } : {}),
      ...(input.attackerInitialFrontlineCount !== undefined
        ? { attackerInitialFrontlineCount: input.attackerInitialFrontlineCount }
        : {}),
      ...(input.defenderInitialFrontlineCount !== undefined
        ? { defenderInitialFrontlineCount: input.defenderInitialFrontlineCount }
        : {}),
      ...(input.attackerRoutedCount !== undefined
        ? { attackerRoutedCount: input.attackerRoutedCount }
        : {}),
      ...(input.defenderRoutedCount !== undefined
        ? { defenderRoutedCount: input.defenderRoutedCount }
        : {}),
      ...(input.breakthroughSide ? { breakthroughSide: input.breakthroughSide } : {}),
      ...(input.pursuitOccurred !== undefined ? { pursuitOccurred: input.pursuitOccurred } : {}),
      ...(provinceNameKey ? { province: nameParam('province', provinceNameKey) } : {}),
      ...(input.attackerCommanderId
        ? {
            attackerCommander: nameParam(
              'person',
              personNameKeyOrId(state, input.attackerCommanderId),
            ),
          }
        : {}),
      ...(input.defenderCommanderId
        ? {
            defenderCommander: nameParam(
              'person',
              personNameKeyOrId(state, input.defenderCommanderId),
            ),
          }
        : {}),
    },
    refs,
  )
}

export type BattleAvoidedInput = {
  provinceId?: ProvinceId
  battlefieldKind: BattlefieldKind
  avoidingSide: WarSideKey | 'both'
  attackerCaptainGeneralId?: PersonId
  defenderCaptainGeneralId?: PersonId
  avoidanceSucceeded: boolean
  attackerAvoidanceCountAfter: number
  defenderAvoidanceCountAfter: number
  warScoreDelta: number
  warScoreAfter: number
}

// §11.2 BATTLE_AVOIDED (minor)。両者回避は avoidingSide='both' / warScoreDelta=0。
export function emitBattleAvoided(
  ctx: TickContext,
  war: War,
  input: BattleAvoidedInput,
): TickContext {
  const state = ctx.state
  const p = warParties(state, war)
  if (!p) return ctx
  const provinceNameKey = input.provinceId ? state.provinces[input.provinceId]?.nameKey : undefined
  const refs: EventEntityRef[] = [...attackerDefenderRefs(p)]
  if (input.provinceId) {
    refs.push(entityRef('province', input.provinceId, 'province', provinceNameKey))
  }
  for (const [id, role] of [
    [input.attackerCaptainGeneralId, 'attacker_captain_general'],
    [input.defenderCaptainGeneralId, 'defender_captain_general'],
  ] as const) {
    const r = personRef(state, id, role)
    if (r) refs.push(r)
  }
  const avoidedMessageKey =
    input.avoidingSide === 'both' ? 'war.battle_avoided_both' : 'war.battle_avoided'
  return emit(
    ctx,
    'BATTLE_AVOIDED',
    'minor',
    avoidedMessageKey,
    {
      warId: war.id,
      battlefieldKind: input.battlefieldKind,
      avoidingSide: input.avoidingSide,
      attacker: nameParam(p.attackerCategory, p.attackerName),
      defender: nameParam(p.defenderCategory, p.defenderName),
      attackerName: nameParam(p.attackerCategory, p.attackerName),
      defenderName: nameParam(p.defenderCategory, p.defenderName),
      avoidingName:
        input.avoidingSide === 'attacker'
          ? nameParam(p.attackerCategory, p.attackerName)
          : input.avoidingSide === 'defender'
            ? nameParam(p.defenderCategory, p.defenderName)
            : '',
      avoidanceSucceeded: input.avoidanceSucceeded,
      attackerAvoidanceCountAfter: input.attackerAvoidanceCountAfter,
      defenderAvoidanceCountAfter: input.defenderAvoidanceCountAfter,
      warScoreDelta: input.warScoreDelta,
      warScoreAfter: input.warScoreAfter,
      ...(provinceNameKey ? { province: nameParam('province', provinceNameKey) } : {}),
    },
    refs,
  )
}

// §11.3 WAR_CAPTAIN_GENERAL_CHANGED。総大将喪失 (new undefined) は major、それ以外 normal。
//   初回任命 (old undefined) では呼ばない (呼び出し側で gate)。
export function emitCaptainGeneralChanged(
  ctx: TickContext,
  war: War,
  sideKey: WarSideKey,
  oldCaptainGeneralId: PersonId | undefined,
  newCaptainGeneralId: PersonId | undefined,
): TickContext {
  const state = ctx.state
  const side = sideKey === 'attacker' ? war.attacker : war.defender
  const actor = side.participants.find((pp) => pp.primary)?.actor
  if (!actor) return ctx
  const actorName = actorNameKey(state, actor)
  const actorCategory = actorEmitCategory(state, actor)
  const importance: EventImportance = newCaptainGeneralId === undefined ? 'major' : 'normal'
  const refs: EventEntityRef[] = [entityRef(actorEntityKind(actor), actor.id, 'actor', actorName)]
  const oldRef = personRef(state, oldCaptainGeneralId, 'old_captain_general')
  if (oldRef) refs.push(oldRef)
  const newRef = personRef(state, newCaptainGeneralId, 'new_captain_general')
  if (newRef) refs.push(newRef)
  return emit(
    ctx,
    'WAR_CAPTAIN_GENERAL_CHANGED',
    importance,
    // 後任なし (喪失) は別テンプレート。同一キーだと {{newCaptainGeneral}} が未解決のまま
    // 表示される (messageParam drift — conditional spread は静的 coverage 検査をすり抜ける)
    newCaptainGeneralId !== undefined ? 'war.captain_general_changed' : 'war.captain_general_lost',
    {
      warId: war.id,
      side: sideKey,
      actor: nameParam(actorCategory, actorName),
      ...(oldCaptainGeneralId
        ? { oldCaptainGeneral: nameParam('person', personNameKeyOrId(state, oldCaptainGeneralId)) }
        : {}),
      ...(newCaptainGeneralId
        ? { newCaptainGeneral: nameParam('person', personNameKeyOrId(state, newCaptainGeneralId)) }
        : {}),
    },
    refs,
  )
}
