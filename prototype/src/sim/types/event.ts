import type { EventId } from './ids'

export type EventType =
  | 'PERSON_DIED'
  | 'IMPORTANT_PERSON_DIED'
  | 'PERSON_CAME_OF_AGE'
  | 'PERSON_ENTERED_OLD_AGE'
  | 'HOUSE_EXTINCT'
  | 'MARRIAGE_FORMED'
  | 'CHILD_BORN'
  | 'HOUSE_SPLIT'
  | 'SUCCESSION_CRISIS'
  | 'POLITY_SPLIT'
  | 'OMEN'
  | 'FAMINE'
  | 'BOUNTIFUL_HARVEST'
  | 'PLAGUE'
  | 'WAR_DECLARED'
  | 'WAR_WON'
  | 'WAR_LOST'
  | 'PROVINCE_CONQUERED'
  | 'POLITY_ANNEXED'
  | 'DISASTER_RELIEF_FUNDED'
  | 'DISASTER_RELIEF_FAILED'
  | 'COUNTRY_LAND_DEVELOPED'
  // v0.53 押領 (RealEstateSeizure)
  | 'REAL_ESTATE_SEIZURE_STARTED'
  | 'REAL_ESTATE_SEIZURE_RESOLVED'
  | 'REAL_ESTATE_SEIZURE_LEGALIZED'
  | 'REAL_ESTATE_SEIZURE_CANCELLED'
  // v0.53 土地契約不履行 (LandContractDefault)
  | 'LAND_CONTRACT_DEFAULT_STARTED'
  | 'LAND_CONTRACT_DEFAULT_RESOLVED'
  | 'LAND_CONTRACT_DEFAULT_LEGALIZED'
  | 'LAND_CONTRACT_DEFAULT_CANCELLED'
  | 'POP_LAND_DEVELOPED'
  | 'POP_HARDSHIP'
  | 'POP_PROSPERITY'
  | 'POP_UNREST_RISING'
  | 'POP_DECLINED'
  | 'PROVINCE_REVOLT_STARTED'
  | 'PROVINCE_REVOLT_SUCCEEDED'
  | 'PROVINCE_REVOLT_FAILED'
  | 'REVOLT_POLITY_FOUNDED'
  // v0.48 Crisis (災害・戦災・反乱前段の entity 化)
  | 'CRISIS_CREATED'
  | 'CRISIS_RESOLVED'
  | 'CRISIS_EXPIRED'
  // v0.48.1 設備維持管理: condition 0 到達で設備が破壊 (レベルダウン / 全壊)
  | 'FACILITY_BREAKDOWN'
  // v0.48.2 定期保守: 代官が要保守帯の設備を保守し condition を回復
  | 'FACILITY_MAINTAINED'
  // v0.46 共和国整備: established commonwealth の建国式 / 任期 leader 交代。
  | 'REPUBLIC_FOUNDED'
  | 'REPUBLIC_LEADER_ELECTED'
  | 'OFFICE_ASSIGNED'
  | 'OFFICE_REVOKED'
  | 'OFFICE_SALARY_UNPAID'
  | 'OFFICE_SALARY_PARTIALLY_PAID'
  | 'POLITY_LEADER_CHANGED'
  | 'POLITY_OWNER_CHANGED'
  | 'POLITY_EXTINCT'
  | 'HOUSE_LEADER_CHANGED'
  | 'SHARE_SHIFTED'
  | 'ESTATE_SETTLED'
  | 'ESTATE_DISPUTED'
  | 'LAND_CONTRACT_GRANTED'
  | 'LAND_CONTRACT_TRANSFERRED'
  | 'LAND_CONTRACT_INSERTED'
  | 'LAND_CONTRACT_REPLACED'
  | 'LAND_CONTRACT_TAX_CHANGED'
  | 'LAND_CONTRACT_REVOKED'
  | 'LAND_CONTRACT_PURCHASED'
  | 'BAILIFF_APPOINTED'
  | 'BAILIFF_VACATED'
  | 'BAILIFF_PLACEHOLDER_INSTALLED'
  // v0.48: 民衆反乱の代官罷免要求が成功し、代官が罷免された
  | 'BAILIFF_DISMISSED_BY_REVOLT'
  | 'POLITY_LANDLESS'
  | 'FACTION_FOUNDED'
  | 'FACTION_DISSOLVED'
  | 'FACTION_LEADER_CHANGED'
  | 'FACTION_NESTED'
  | 'PERSON_RECRUITED_TO_FACTION'
  | 'OFFICE_TERM_ENDED'
  | 'PERSON_FADED_FROM_HISTORY'
  | 'PERSON_BORN_IN_OBSCURITY'
  | 'HOUSE_MEMBERS_DISPERSED'
  | 'FACTION_FUNDS_SHORTAGE'
  | 'FACTION_MEMBER_ABANDONED'
  | 'FACTION_LEADER_BANKRUPT'
  // v0.18 Stage B §18.1
  | 'REVOLT_NEGOTIATION_STARTED'
  | 'REVOLT_SETTLED'
  | 'REVOLT_SUPPRESSED'
  | 'REVOLT_POLITY_ESTABLISHED'
  | 'REVOLT_ESCALATED'
  | 'REVOLT_REGIME_CHANGED'
  | 'DIPLOMATIC_PLAY_STARTED'
  // v0.43 §17: supporter が DiplomaticPlay の一方 side への支援を宣言した
  | 'DIPLOMATIC_SUPPORT_DECLARED'
  | 'DIPLOMATIC_PLAY_PROGRESS'
  | 'DIPLOMATIC_PLAY_SETTLED'
  | 'DIPLOMATIC_PLAY_FAILED'
  | 'DIPLOMATIC_PLAY_RESOLVED_BY_CONFLICT'
  // v0.18 Stage D §18.1
  | 'DIPLOMATIC_PLAY_ESCALATED'
  // v0.18 Stage F §18.1: land_claim outcome の色分け event
  | 'LAND_CONTRACT_CEDED'
  | 'LAND_CONTRACT_CONQUERED'
  // v0.18 contract_tax_revision
  | 'CONTRACT_TAX_REVISED'
  | 'CONTRACT_ELIMINATED'
  // v0.22 Goal/Aim events
  | 'GOAL_CREATED'
  | 'GOAL_SUCCEEDED'
  | 'GOAL_FAILED'
  | 'GOAL_ABANDONED'
  | 'GOAL_REVIEWED'
  | 'AIM_CREATED'
  | 'AIM_SUCCEEDED'
  | 'AIM_FAILED'
  | 'AIM_ABANDONED'
  | 'HOUSE_POLICY_INFLUENCE'
  | 'HOUSE_PATRONIZED_ARTIST'
  | 'HOUSE_COMMISSIONED_CHRONICLE'
  // v0.23 Person Goal/Aim/Task
  | 'PERSON_GOAL_CREATED'
  | 'PERSON_AIM_CREATED'
  | 'PERSON_AIM_SUCCEEDED'
  | 'PERSON_AIM_FAILED'
  | 'TASK_COMPLETED'
  | 'TASK_FAILED'
  | 'TASK_CANCELLED'
  // v0.26 Project
  | 'PROJECT_STARTED'
  | 'PROJECT_COMPLETED'
  | 'PROJECT_FAILED'
  | 'PROJECT_CANCELLED'
  // v0.60: 資金集めラウンドが成立し budget に上乗せされた
  | 'PROJECT_FUNDED'
  // v0.60: 建設・取得系 Project が完成し「誰が建てたか」を Chronicle に残す (development)
  | 'PROJECT_BUILT'
  // v0.29 Phase C Pressure
  | 'PRESSURE_CREATED'
  | 'PRESSURE_RESOLVED'
  | 'PRESSURE_CANCELLED'
  // v0.31 House Founding
  | 'HOUSE_FOUNDED'
  | 'CADET_HOUSE_FOUNDED'
  // v0.32 Clan
  | 'CLAN_FOUNDED'
  // v0.34 War (WAR_DECLARED / WAR_WON / WAR_LOST は既存を流用)
  //   v0.35: WAR_SCORE_CHANGED は廃止 (warScore 変化は BATTLE_* の warScoreDelta/After で表現)
  | 'WAR_ENDED'
  // v0.43 §10.4: copy filter を通過した supporter が War に参戦した
  | 'WAR_PARTICIPANT_JOINED'
  // v0.42: 勝率/性格ゲートで開戦を見送った (escalated play を cancel)。
  | 'WAR_AVERTED'
  | 'PEACE_SETTLEMENT_APPLIED'
  // v0.35 War Maneuver (§11)
  | 'BATTLE_OCCURRED'
  | 'BATTLE_AVOIDED'
  | 'WAR_CAPTAIN_GENERAL_CHANGED'
  // v0.36 補充・再編成: destroyed Regiment が active に再編成された (minor)。
  //   strength の通常補充は organization recovery と同じく silent (イベント無し)。
  | 'REGIMENT_REFORMED'
  // v0.42 PoliticalRight (spec §17)。GRANTED = acquire project 完了 / REVOKED = rightConsistency
  //   の drift 回収 (mutation cascade は office と同じく silent) / TRANSFERRED = holder 付替
  //   (v0.42 では通常発火経路なし — unit test と将来の PeaceSettlement / regime change 用)。
  | 'POLITICAL_RIGHT_GRANTED'
  | 'POLITICAL_RIGHT_REVOKED'
  | 'POLITICAL_RIGHT_TRANSFERRED'
  // v0.51 陰謀リファイン: 影響力毀損陰謀の完遂 (InfluenceModifier 生成)
  | 'INFLUENCE_UNDERMINED'
  // v0.51 陰謀リファイン: 分家当主交代陰謀の完遂 (旧 PLOT_SUCCEEDED/replace_house_leader 相当)
  | 'HOUSE_LEADER_REPLACED'
  // v0.44 成果成長・評判 (spec §10)。ability ごと / reputation source 1 件ごとに emit。
  | 'PERSON_ABILITY_GREW'
  | 'PERSON_REPUTATION_GAINED'
  | 'PERSON_REPUTATION_DAMAGED'
  // v0.45 天才の誕生 (major でメインログに流す)
  | 'PERSON_GENIUS_BORN'
  // v0.47 称号・分封・領邦再編 (spec §17)
  | 'POLITY_RANK_PROMOTED'
  | 'POLITY_TITULARIZED'
  | 'POLITY_ABOLISHED'
  | 'POLITY_GRANTED'
  | 'POLITY_TITLE_TRANSFERRED'
  | 'HOUSE_FOUNDED_BY_LAND_GRANT'
  | 'HOUSE_FOUNDED_IN_REPUBLIC'
  | 'CADET_BRANCH_FOUNDED_BY_LAND_GRANT'
  | 'CADET_BRANCH_FOUNDED_BY_TITLE_TRANSFER'
  | 'LAND_CONTRACT_CONSOLIDATED'
  // v0.61 商会・交易
  | 'MERCHANT_COMPANY_DISSOLVED'
  // v0.51 兵站・補給・消耗
  | 'SUPPLY_PLUNDER'
  | 'SUPPLY_HARSH_REQUISITION'
  | 'SUPPLY_ATTRITION'

export type EventReason = {
  label: string
  value?: number
  contribution?: number
}

export type EventEffect = {
  label: string
  value?: number
}

export type EventEntityKind =
  | 'person'
  | 'house'
  | 'polity'
  | 'province'
  | 'holding'
  | 'popGroup'
  | 'landContract'
  | 'diplomaticPlay'
  | 'faction'
  | 'goal'
  | 'aim'
  | 'project'
  | 'pressure'
  | 'clan'
  // v0.49: 戦争・会戦系 ChronicleEntry を chronicleIndex.byWar に振るための ref kind (§16.2)。
  | 'war'
  // 会戦再生 UI: major BATTLE_OCCURRED の ChronicleEntry から恒久 BattleLog へのリンク用 ref kind。
  //   index bucket は持たない (indexBucketForKind の default で無視) — ナビゲーション専用。
  | 'battleLog'
  // v0.61 商会・交易 (§26.1)。商会設立/破産/休眠/消滅 → merchant_company、
  //   交易路開設/拡張/閉鎖 → trade_route、支店開設/本店拡張 → merchant_company + holding。
  | 'merchant_company'
  | 'trade_route'

export type EventEntityRef = {
  kind: EventEntityKind
  id: string
  role?: string
  nameKey?: string
}

export type LocalizedNameParam = {
  kind: 'name'
  category: string
  key: string
}

type EventEntityParam = {
  kind: 'entity'
  entityKind: EventEntityKind
  id: string
}

export type EventMessageParamValue =
  | string
  | number
  | boolean
  | LocalizedNameParam
  | EventEntityParam

export type EventMessageParams = Record<string, EventMessageParamValue>

export function nameParam(category: string, nameKey: string): LocalizedNameParam {
  return { kind: 'name', category, key: nameKey }
}

export function entityRef(
  kind: EventEntityKind,
  id: string,
  role?: string,
  nameKey?: string,
): EventEntityRef {
  return {
    kind,
    id,
    ...(role !== undefined ? { role } : {}),
    ...(nameKey !== undefined ? { nameKey } : {}),
  }
}

export function getEntityIdsByKind(
  event: { entityRefs: readonly EventEntityRef[] },
  kind: EventEntityKind,
): string[] {
  return event.entityRefs.filter((r) => r.kind === kind).map((r) => r.id)
}

export function getFirstEntityId(
  event: { entityRefs: readonly EventEntityRef[] },
  kind: EventEntityKind,
): string | undefined {
  const ref = event.entityRefs.find((r) => r.kind === kind)
  return ref?.id
}

export function hasEntityId(event: { entityRefs: readonly EventEntityRef[] }, id: string): boolean {
  return event.entityRefs.some((r) => r.id === id)
}

export type EventImportance = 'minor' | 'normal' | 'major' | 'critical'

export type SimEvent = {
  id: EventId
  year: number
  weekOfYear: number
  type: EventType
  importance: EventImportance
  messageKey: string
  messageParams: EventMessageParams
  entityRefs: EventEntityRef[]
  reasons: EventReason[]
  effects: EventEffect[]
}
