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
  | 'PLOT_STARTED'
  | 'PLOT_SUCCEEDED'
  | 'PLOT_FAILED'
  | 'PLOT_CANCELLED'
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
  | 'POP_LAND_DEVELOPED'
  | 'POP_HARDSHIP'
  | 'POP_PROSPERITY'
  | 'POP_UNREST_RISING'
  | 'POP_DECLINED'
  | 'PROVINCE_REVOLT_STARTED'
  | 'PROVINCE_REVOLT_SUCCEEDED'
  | 'PROVINCE_REVOLT_FAILED'
  | 'REVOLT_POLITY_FOUNDED'
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
  | 'POLITY_LANDLESS'
  | 'FACTION_FOUNDED'
  | 'FACTION_DISSOLVED'
  | 'FACTION_LEADER_CHANGED'
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

export type EventEntityParam = {
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

export function getEntityRefsByKind(
  event: { entityRefs: readonly EventEntityRef[] },
  kind: EventEntityKind,
): EventEntityRef[] {
  return event.entityRefs.filter((r) => r.kind === kind)
}

export function getEntityRefByRole(
  event: { entityRefs: readonly EventEntityRef[] },
  role: string,
): EventEntityRef | undefined {
  return event.entityRefs.find((r) => r.role === role)
}

export function hasEntityId(event: { entityRefs: readonly EventEntityRef[] }, id: string): boolean {
  return event.entityRefs.some((r) => r.id === id)
}

export function renderEventSummary(event: {
  messageKey: string
  messageParams: EventMessageParams
}): string {
  return resolveMessageTemplate(event.messageKey, event.messageParams)
}

function resolveMessageTemplate(messageKey: string, params: EventMessageParams): string {
  const template = EVENT_TEMPLATES[messageKey]
  if (!template) return messageKey
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = params[key]
    if (value === undefined) return `{{${key}}}`
    if (typeof value === 'string') return value
    if (typeof value === 'number') return String(Math.round(value))
    if (typeof value === 'boolean') return String(value)
    if (value.kind === 'name') return value.key
    if (value.kind === 'entity') return value.id
    return String(value)
  })
}

const EVENT_TEMPLATES: Record<string, string> = {
  'person.died': '{{person}} has died at age {{age}}.',
  'person.born': '{{child}} was born.',
  'person.born_in_obscurity': 'An unknown {{occupation}} named {{person}} appeared.',
  'person.faded_from_history': '{{person}} faded from the chronicles.',
  'marriage.formed': '{{male}} married {{female}}.',
  'house.split': '{{person}} has split from {{house}} to form a new house.',
  'house.extinct': '{{house}} has become extinct with no surviving house to inherit its legacy.',
  'house.extinct_inherited':
    '{{house}} has become extinct; its realm is inherited by another house.',
  'house.extinct_legacy': '{{house}} has become extinct; its legacy passes to another house.',
  'house.extinct_fallen': '{{house}} has fallen from power after losing all lands.',
  'house.members_dispersed': 'The remnants of {{house}} dispersed into obscurity.',
  'house.leader_changed': '{{person}} has become the new head of {{house}}.',
  'polity.leader_changed': '{{person}} has become the new ruler of {{polity}}.',
  'polity.owner_changed':
    "{{polity}}'s ruling house changed to {{newHouse}}, and the capital moved to {{province}}.",
  'polity.owner_changed_initial':
    "{{polity}}'s ruling house is now {{newHouse}}; capital set to {{province}}.",
  'polity.owner_changed_extinction':
    "{{polity}}'s ruling house changed from {{oldHouse}} to {{newHouse}} after the extinction.",
  'polity.extinct_no_provinces': '{{polity}} has dissolved without remaining provinces.',
  'polity.extinct_no_owner': '{{polity}} has dissolved without an owning house.',
  'polity.extinct_lost_owner': '{{polity}} has dissolved after losing its owning house.',
  'polity.landless': '{{polity}} no longer holds any land.',
  'polity.land_developed': '{{polity}} invested in land development in {{province}}.',
  'succession.crisis': 'A succession crisis has erupted in {{house}}!',
  'succession.crisis_split': 'A succession crisis has erupted due to the house split!',
  'plot.started': '{{person}} began a {{plotType}} plot.',
  'plot.succeeded': "{{person}}'s {{plotType}} plot succeeded.",
  'plot.failed': "{{person}}'s {{plotType}} plot failed.",
  'office.assigned_polity': '{{person}} was appointed as {{role}} of {{polity}}.',
  'office.assigned_house': '{{person}} was appointed as {{role}} of {{house}}.',
  'office.revoked':
    "Office of {{role}} in {{organization}} was revoked as the holder's house no longer holds province in this polity.",
  'office.term_ended': "{{person}}'s term as {{role}} ended.",
  'office.salary_unpaid': 'Salary unpaid for office holder.',
  'office.salary_partially_paid': 'Salary partially unpaid for office holder.',
  'estate.settled':
    "{{person}}'s estate of {{wealth}} distributed: {{houseAmount}} to house, {{heirAmount}} to heirs.",
  'estate.disputed': "Multiple heirs ({{count}}) contest {{person}}'s estate.",
  'disaster.famine': 'Famine strikes {{province}}!',
  'disaster.plague': 'Plague spreads through {{province}}!',
  'disaster.bountiful_harvest': 'A bountiful harvest blesses {{province}}.',
  'pop.land_developed': 'The people of {{province}} improved their lands.',
  'war.won': '{{winner}} prevailed in war against {{loser}}.',
  'war.lost': '{{loser}} was defeated by {{winner}}.',
  'war.declared': '{{attacker}} declared war on {{defender}} over {{issue}}.',
  'war.ended': 'The war between {{attacker}} and {{defender}} ended without a decisive victor.',
  'political_right.granted':
    '{{holder}} was granted the {{rightKind}} over {{target}} in {{polity}}.',
  'political_right.revoked':
    '{{holder}} lost the {{rightKind}} over {{target}} in {{polity}} ({{revokeReason}}).',
  'political_right.transferred':
    'The {{rightKind}} over {{target}} in {{polity}} passed to {{holder}}.',
  'war.peace_settlement.transfer_land':
    '{{attacker}} took {{holding}} from {{defender}} in the peace settlement.',
  'war.peace_settlement.change_tax':
    'The peace settlement revised the tax terms of {{holding}} in favor of {{attacker}}.',
  'revolt.negotiation_started':
    'A {{rebelClass}} revolt has broken out in {{province}} — negotiations begin.',
  'revolt.polity_founded':
    '{{polity}} has been founded by {{person}} through revolt in {{province}}!',
  'revolt.triumphant': 'The revolt in {{province}} has triumphed — independence is achieved.',
  'revolt.settled':
    'The revolt in {{province}} has been settled by negotiation — its leader {{aftermathText}}, and the province returns to {{restorePolity}}.',
  'revolt.suppressed':
    'The revolt in {{province}} has been suppressed — its leader {{aftermathText}}, and the province returns to {{restorePolity}}.',
  'revolt.escalated': 'The revolt in {{province}} has escalated to armed conflict.',
  'revolt.regime_changed': 'The regime in {{province}} has been overthrown by popular revolt.',
  'diplomatic_play.started_with_offer':
    '{{initiator}} negotiates with {{target}} for {{province}}.',
  'diplomatic_play.started_no_offer': '{{initiator}} pressures {{target}} to cede {{province}}.',
  'diplomatic_play.progress': 'Diplomatic negotiations continue over {{province}}.',
  'diplomatic_play.settled_revolt':
    'Revolt negotiation in {{province}} settled — concessions granted.',
  'diplomatic_play.settled_tax': 'Tax revision for {{province}} settled.',
  'diplomatic_play.settled_purchase':
    '{{initiator}} purchased {{province}} from {{defender}} for {{price}} gold.',
  'diplomatic_play.settled_cession':
    '{{defender}} ceded {{province}} to {{initiator}} under pressure.',
  'diplomatic_play.failed_revolt': 'Revolt negotiation in {{province}} ended without resolution.',
  'diplomatic_play.failed_claim': "{{initiator}}'s claim on {{province}} faded out.",
  'diplomatic_play.escalated_revolt': 'Deadlocked revolt in {{province}} erupts at deadline.',
  'diplomatic_play.escalated_claim':
    'Deadlocked claim erupts: {{initiator}} attacks for {{province}}.',
  'diplomatic_play.resolved_by_conflict': '{{summary}}',
  'conflict.land_seized': '{{attacker}} seized {{province}} from {{defender}}.',
  'conflict.land_repelled': "{{defender}} repelled {{attacker}}'s claim on {{province}}.",
  'conflict.tax_won': '{{attacker}} prevailed in the tax dispute over {{province}}.',
  'conflict.tax_repelled': '{{defender}} repelled the tax revision demand for {{province}}.',
  'conflict.revolt_rebel_victory': 'The conflict over {{province}} ended with rebel victory.',
  'conflict.revolt_suppressed': 'The revolt in {{province}} was put down by force.',
  'land_contract.transferred': '{{holding}} transferred from {{from}} to {{to}} ({{reason}}).',
  'land_contract.purchased': '{{to}} purchased {{holding}} from {{from}}.',
  'land_contract.ceded': '{{from}} ceded {{holding}} to {{to}}.',
  'land_contract.conquered': '{{to}} conquered {{holding}} from {{from}}.',
  'land_contract.tax_revised':
    'Tax rate for {{province}} revised to {{rate}}% between {{initiator}} and {{defender}}.',
  'land_contract.eliminated':
    'Contract chain for {{province}} altered between {{initiator}} and {{defender}}.',
  'bailiff.appointed': '{{person}} was appointed bailiff of {{province}}.',
  'bailiff.vacated': '{{person}} stepped down as bailiff of {{province}}.',
  'bailiff.placeholder_installed': 'An anonymous placeholder oversees {{province}}.',
  'faction.founded': '{{person}} founded the faction {{faction}}.',
  'faction.dissolved': "{{leader}}'s faction dissolved ({{reason}}).",
  'faction.leader_changed': '{{newLeader}} succeeded {{oldLeader}} as the head of {{faction}}.',
  'faction.leader_bankrupt':
    "{{person}}'s fortunes are exhausted, putting {{faction}} in jeopardy.",
  'faction.member_recruited': '{{person}} joined {{faction}}.',
  'faction.member_abandoned': '{{person}} abandoned {{faction}}.',
  'faction.funds_shortage': "{{person}}'s {{faction}} faces a financial crisis.",
  'goal.created': '{{owner}} set a new goal: {{kind}}.',
  'goal.succeeded': '{{owner}} achieved their goal of {{kind}}.',
  'goal.failed': '{{owner}} failed to achieve {{kind}}.',
  'goal.abandoned': '{{owner}} abandoned the goal of {{kind}}.',
  'goal.reviewed': '{{owner}} reviewed their goal of {{kind}}.',
  'aim.created': '{{owner}} began working on {{kind}} targeting {{target}}.',
  'aim.succeeded': '{{owner}} successfully completed {{kind}}.',
  'aim.failed': '{{owner}} failed at {{kind}}.',
  'aim.abandoned': '{{owner}} abandoned {{kind}}.',
  'house.policy_influence': '{{house}} influenced the policies of {{polity}}.',
  'house.patronized_artist': '{{house}} patronized an artist, gaining prestige.',
  'house.commissioned_chronicle': '{{house}} commissioned a chronicle of their deeds.',
  'person.goal.created': '{{owner}} set a personal goal: {{kind}}.',
  'person.aim.created': '{{owner}} began pursuing {{kind}}.',
  'person.aim.succeeded': '{{owner}} successfully achieved {{kind}}.',
  'person.aim.failed': '{{owner}} failed at {{kind}}.',
  'task.cancelled': "{{person}}'s task {{task}} was cancelled ({{reason}}).",
  'task.review_waiting': '{{person}} is waiting for an opportunity regarding {{kind}}.',
  'house.founded': '{{person}} founded the house {{house}}.',
  'house.cadet_founded':
    '{{person}} founded the cadet house {{house}}, branching from {{parentHouse}}.',
  'clan.founded':
    'The descendants of {{rootHouseName}} are now recognized as the {{rootHouseName}} Clan.',
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
