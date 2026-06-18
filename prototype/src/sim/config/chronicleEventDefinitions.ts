import type { EventType, EventEntityRef, SimEvent } from '../types/event'
import type { ChronicleCategory } from '../types/chronicle'

// v0.38 §6.2: Chronicle 化対象 EventType の定義。importance 閾値ではなく allowlist で決める。
//   低頻度・高 signal を中心にし、高頻度の行政イベントは byPerson 限定などで選択投入する。
export type ChronicleEventDefinition = {
  category: ChronicleCategory
  // この event を chronicle 化する際、entityRefs をこの kind のみに絞る (projection で filter)。
  //   未指定なら全 ref を保持 (Phase 1 挙動)。office を byPerson 限定にするため ['person']。
  //   ref を絞ることで byHouse/byPolity index に載らず、かつ entry.entityRefs が
  //   絞り込み後と一致するので integrity (index↔entry) は無改修で通る。
  retainRefKinds?: readonly EventEntityRef['kind'][]
  // templateKey override。string=固定、関数=event の params から narrative key を選ぶ。
  //   未指定なら event.messageKey をそのまま使う (Phase 1 挙動)。
  templateKey?: string | ((event: SimEvent) => string)
}

// v0.38 Phase 4: BATTLE_OCCURRED の chronicle templateKey を params の派生フラグで選ぶ。
//   通常勝利・非勝利は既存 'war.battle_occurred' を流用し、特徴的な勝利だけ rich template に差し替える。
//   outnumberedVictory / decisiveVictory は emitBattleOccurred が additive に算出済み。
//   辛勝 (narrow) は「勝者自身も壊走連隊を出した」を既存の routed count params から判定 (enrich 不要)。
function selectBattleTemplate(event: SimEvent): string {
  const p = event.messageParams
  const result = p.result
  const isVictory = result === 'attacker_victory' || result === 'defender_victory'
  if (!isVictory) return 'war.battle_occurred_inconclusive'
  if (p.outnumberedVictory === true) return 'chronicle.battle.outnumbered_victory'
  if (p.decisiveVictory === true) return 'chronicle.battle.decisive_victory'
  const winnerRouted = result === 'attacker_victory' ? p.attackerRoutedCount : p.defenderRoutedCount
  if (typeof winnerRouted === 'number' && winnerRouted > 0) {
    return 'chronicle.battle.narrow_victory'
  }
  return 'war.battle_occurred'
}

export const CHRONICLE_EVENT_TYPE_DEFINITIONS: Partial<
  Record<EventType, ChronicleEventDefinition>
> = {
  // War / Battle
  WAR_DECLARED: { category: 'war' },
  WAR_WON: { category: 'war' },
  WAR_LOST: { category: 'war' },
  WAR_ENDED: { category: 'war' },
  // v0.43 §17: supporter の参戦 (copy filter 通過)。
  WAR_PARTICIPANT_JOINED: { category: 'war' },
  PEACE_SETTLEMENT_APPLIED: { category: 'war' },
  SUPPLY_ATTRITION: { category: 'war' },
  // Diplomacy (v0.43 §17): 支援宣言。宣言と参戦のペア有無で「宣言したが参戦しなかった」を読める。
  DIPLOMATIC_SUPPORT_DECLARED: { category: 'diplomacy' },
  BATTLE_OCCURRED: { category: 'battle', templateKey: selectBattleTemplate },
  // Land (LAND_CONTRACT_TRANSFERRED 一本。PURCHASED/CEDED/CONQUERED は二重計上回避で除外)
  LAND_CONTRACT_TRANSFERRED: { category: 'land' },
  // House
  HOUSE_FOUNDED: { category: 'house' },
  CADET_HOUSE_FOUNDED: { category: 'house' },
  HOUSE_SPLIT: { category: 'house' },
  HOUSE_EXTINCT: { category: 'house' },
  HOUSE_LEADER_CHANGED: { category: 'house' },
  // Governance
  POLITY_OWNER_CHANGED: { category: 'governance' },
  // v0.47 称号・分封・領邦再編 (§17.2): titular 化 / 称号廃止 (governance 史)
  POLITY_TITULARIZED: { category: 'governance' },
  POLITY_ABOLISHED: { category: 'governance' },
  // 分封 / 陞爵 / 称号譲渡 / 集約 / House 創設
  POLITY_GRANTED: { category: 'land' },
  POLITY_RANK_PROMOTED: { category: 'governance' },
  POLITY_TITLE_TRANSFERRED: { category: 'house' },
  LAND_CONTRACT_CONSOLIDATED: { category: 'land' },
  HOUSE_FOUNDED_BY_LAND_GRANT: { category: 'house' },
  CADET_BRANCH_FOUNDED_BY_LAND_GRANT: { category: 'house' },
  CADET_BRANCH_FOUNDED_BY_TITLE_TRANSFER: { category: 'house' },
  HOUSE_FOUNDED_IN_REPUBLIC: { category: 'house' },
  // v0.42 PoliticalRight (§17.3): 任命権・連隊管理権の授与/失効/移転。低頻度・高 signal。
  POLITICAL_RIGHT_GRANTED: { category: 'governance' },
  POLITICAL_RIGHT_REVOKED: { category: 'governance' },
  POLITICAL_RIGHT_TRANSFERRED: { category: 'governance' },
  // Land governance (v0.38 Phase 3): 税率改定。polity+province ref (holding ref は無い)。
  CONTRACT_TAX_REVISED: { category: 'land' },
  // Revolt
  REVOLT_POLITY_FOUNDED: { category: 'revolt' },
  REVOLT_NEGOTIATION_STARTED: { category: 'revolt' },
  // Revolt 帰結 (v0.38 Phase 3): province ref を持つ。叛乱の決着を地方史に乗せる。
  REVOLT_SUPPRESSED: { category: 'revolt' },
  REVOLT_SETTLED: { category: 'revolt' },
  REVOLT_POLITY_ESTABLISHED: { category: 'revolt' },
  REVOLT_ESCALATED: { category: 'revolt' },
  REVOLT_REGIME_CHANGED: { category: 'revolt' },
  // v0.46 共和国整備: 建国式・任期 leader 交代 (governance 史)
  REPUBLIC_FOUNDED: { category: 'governance' },
  REPUBLIC_LEADER_ELECTED: { category: 'governance' },
  // Disaster
  FAMINE: { category: 'disaster' },
  PLAGUE: { category: 'disaster' },
  // v0.48 Crisis: 解決/失効は低頻度・高 signal なので chronicle 可。holding ref 限定で fan-out 抑制
  //   (per-holding CRISIS_CREATED は登録せず Polity/House 国史を埋めない, §4.5)。
  CRISIS_RESOLVED: { category: 'disaster', retainRefKinds: ['holding'] },
  CRISIS_EXPIRED: { category: 'disaster', retainRefKinds: ['holding'] },
  // Development
  COUNTRY_LAND_DEVELOPED: { category: 'development' },
  // Office / 行政 (v0.38 Phase 3)
  //   役職任命/任期終了は人物の「経歴」として byPerson 限定で投入する。
  //   person 以外 (house/polity) の ref を index から外し、Polity/House 国史を行政ログで埋めない。
  OFFICE_ASSIGNED: { category: 'office', retainRefKinds: ['person'] },
  OFFICE_TERM_ENDED: { category: 'office', retainRefKinds: ['person'] },
  //   代官任命/退任は person+province ref を持つ。人物経歴 + 地方統治史の両方に乗せる (無制限)。
  BAILIFF_APPOINTED: { category: 'office' },
  BAILIFF_VACATED: { category: 'office' },
  // v0.48: 民衆反乱による代官罷免。revolt 史 + 当人の経歴 (person ref) の両方に残す。
  BAILIFF_DISMISSED_BY_REVOLT: { category: 'revolt' },
  // Faction / 派閥 (v0.38 Phase 3 追補): 「誰と組んだか」を人物の経歴に残す。
  //   結成/加入/離脱/指導者交代/解散。entityRefs は person(+faction kind) のみで house/polity ref を持たず、
  //   faction kind は chronicle index 対象外 (§5.2) なので retainRefKinds 不要で自然に byPerson だけに載る。
  //   → 中核 panel (Polity/House/Province) は汚れず、関係する人物全員の panel に時系列で現れる。
  FACTION_FOUNDED: { category: 'faction' },
  PERSON_RECRUITED_TO_FACTION: { category: 'faction' },
  FACTION_MEMBER_ABANDONED: { category: 'faction' },
  FACTION_LEADER_CHANGED: { category: 'faction' },
  FACTION_DISSOLVED: { category: 'faction' },
  FACTION_NESTED: { category: 'faction' },
  // Life
  IMPORTANT_PERSON_DIED: { category: 'life' },
  // v0.40 §11: retainRefKinds は指定しない。byPerson/byHouse/byPolity の振り分けは
  //   emit 時の entityRefs 出し分け（一般=person のみ / 主要=person+house+polity）で実現する。
  PERSON_CAME_OF_AGE: { category: 'life' },
  PERSON_ENTERED_OLD_AGE: { category: 'life' },
  // v0.44 §10.5: 成果成長・評判。person ref のみ retain して byPerson index に限定する
  //   (高頻度イベントを byHouse/byPolity に載せない — office=byPerson 限定と同方針)。
  PERSON_ABILITY_GREW: { category: 'life', retainRefKinds: ['person'] },
  PERSON_REPUTATION_GAINED: { category: 'life', retainRefKinds: ['person'] },
  PERSON_REPUTATION_DAMAGED: { category: 'life', retainRefKinds: ['person'] },
  // v0.45 天才の誕生。低頻度 (1%) かつ家にとっても画期なので house ref も retain する
  PERSON_GENIUS_BORN: { category: 'life' },
  // v0.47.4: 婚姻・出生を永続化する。家の構成変化 (婿入り・縁組・世継ぎ) を後から辿れるよう
  //   履歴書・家の記録の双方に残す。いずれも retainRefKinds 指定なし＝全 ref 保持で、
  //   婚姻は groom/bride/家、出生は子/父/母/家に紐づく。頻度は marriage≈低・child_born≈年十数件で
  //   既存 chronicle 対象 (OFFICE_ASSIGNED/BATTLE_OCCURRED) と同オーダー。importance は gate に
  //   無関係 (allowlist 方式) なので minor の CHILD_BORN も投入される。
  MARRIAGE_FORMED: { category: 'life' },
  CHILD_BORN: { category: 'life' },
}
