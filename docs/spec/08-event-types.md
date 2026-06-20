# 8. イベント型一覧

| EventType | importance | 説明 |
|-----------|------------|------|
| OFFICE_ASSIGNED | normal | 役職任命 |
| OFFICE_REVOKED | normal | 役職解任 |
| OFFICE_SALARY_UNPAID | minor | 給与未払い |
| OFFICE_SALARY_PARTIALLY_PAID | minor | 給与部分払い |
| OFFICE_TERM_ENDED | normal | 役職任期満了（officeTermSystem が任期到来で発火） |
| POLITY_LEADER_CHANGED | critical | Polity leader の交代 |
| POLITY_OWNER_CHANGED | major | Polity の ownerHouseId 交代 |
| POLITY_EXTINCT | major | Polity が自己消滅（ownerHouse 不在 / Province 数 0） |
| HOUSE_LEADER_CHANGED | normal | 家長交代 |
| SHARE_SHIFTED | minor | Share 分布の有意な変化 |
| PERSON_DIED | normal | 人物死亡 |
| IMPORTANT_PERSON_DIED | major | 重要人物死亡（`mortalitySystem` が notable death＝house / polity leader 相当を `PERSON_DIED` から type 昇格して emit。単一イベント・重複なし。Chronicle の life カテゴリを成立させる。§6.62） |
| PERSON_CAME_OF_AGE | minor / normal | adolescence→young_adulthood 遷移時に `lifeStageProgressionSystem` が emit（messageKey `person.came_of_age`）。一般人物=minor / 主要人物=normal。importance で entityRefs を出し分け（一般=`[person]` / 主要=`[person, house, polity]`）。主要人物のみメイン EventLog に表示（§11）。全人物が個人 Chronicle に残る（§6） |
| PERSON_ENTERED_OLD_AGE | minor / normal | mature_adulthood→old_age 遷移時に emit（messageKey `person.entered_old_age`）。importance / entityRefs 方針は PERSON_CAME_OF_AGE と同じ |
| PERSON_BORN_IN_OBSCURITY | minor | 無家人物が在野に出現（houselessPersonGenerationSystem） |
| PERSON_FADED_FROM_HISTORY | minor | 無家人物が歴史から消滅（houselessPersonGenerationSystem） |
| HOUSE_EXTINCT | major | 家の断絶（後継者不在。旧 RULER_HOUSE_EXTINCT も統合） |
| HOUSE_MEMBERS_DISPERSED | normal | 家断絶時のメンバー離散（worldStructureExtinction） |
| MARRIAGE_FORMED | normal | 婚姻成立 |
| CHILD_BORN | normal | 子誕生。messageParams に両親（father / 母不在の稀なケースを除き mother）と出生時の所属家（house）を含める（messageKey `person.born` / 母不在時 `person.born_no_mother`）。家の所属は後に変わりうるため「生まれた時どの家にいたか」を記録する意義がある |
| HOUSE_SPLIT | major | 家の分裂（傍系家の独立） |
| CADET_HOUSE_FOUNDED | major | 分家の創設 |
| HOUSE_FOUNDED | major | 無家人物による新 House の創設 |
| CLAN_FOUNDED | major | 氏族の成立。entityRefs: clan, rootHouse, founder（任意） |
| SUCCESSION_CRISIS | major | 継承危機 |
| INFLUENCE_UNDERMINED | normal | 影響力毀損陰謀の完遂（InfluenceModifier 生成）。v0.51。旧 PLOT_* を置換 |
| HOUSE_LEADER_REPLACED | major | 分家当主交代陰謀の完遂（旧 PLOT_SUCCEEDED/replace_house_leader 相当）。v0.51 |
| POLITY_SPLIT | critical | Polity 分裂（旧 COUNTRY_SPLIT を rename） |
| POLITY_LANDLESS | major | Polity が landless 化（terminal Province 0。polityOwnerConsistencySystem が Province 数 0 到達時に発火し、続けて inactive 化 + POLITY_EXTINCT を出す。§11） |
| OMEN | normal | 兆し |
| FAMINE | major | 飢饉（v0.48: Province レベルの物語ビートとして残置。実体は Crisis） |
| PLAGUE | major | 疫病（同上） |
| BOUNTIFUL_HARVEST | normal | 豊作 |
| CRISIS_CREATED | minor | v0.48: Crisis 発生（holding 単位。災害/戦災/反乱前段）。chronicle 非登録（fan-out 抑制） |
| CRISIS_RESOLVED | normal | v0.48: Crisis 対処成功（handle_crisis 完了 / unrest 鎮圧） |
| CRISIS_EXPIRED | normal | v0.48: Crisis 期限切れで放置確定（unrest 除く。unrest は武装蜂起へ） |
| DISASTER_RELIEF_FUNDED | normal | 災害救済成功（旧。現状未発火） |
| DISASTER_RELIEF_FAILED | normal | 災害救済失敗（旧。現状未発火） |
| WAR_DECLARED | major | 宣戦布告（WarCreationSystem が War 作成時に発火。casus belli として「対象 Province + 戦争前状態 + 目標」を記録。WarGoal kind で messageKey 分岐: `war.declared.change_tax`（`subject`/`fromRate`/`toRate`）/ `war.declared.transfer_land`（`subject`/元保持者 `from`）/ goal 不在時 `war.declared.generic`） |
| WAR_PARTICIPANT_JOINED | normal | supporter の参戦（v0.43。WarCreationSystem の copy filter 通過 supporter ごとに発火。messageKey `war.participant_joined`。params: `warId` / `supporter` / `primary`（参戦先 side の primary）。`DIPLOMATIC_SUPPORT_DECLARED` とのペア有無で「宣言したが参戦しなかった」を読める） |
| WAR_WON | major | 戦争勝利（PeaceSettlementSystem が attacker_won / defender_won の勝者に発火） |
| WAR_LOST | major | 戦争敗北（同・敗者に発火） |
| BATTLE_OCCURRED | normal | 戦闘発生（WarManeuverSystem。messageKey `war.battle_occurred`。params: `warId` / `province` / `battlefieldKind` / `result` / `warScoreDelta` / `warScoreAfter` / `battleId`（§3.9c Battle 参照）/ `attackerRegimentCount` / `defenderRegimentCount`（counts-only）/ `outcomeQuality` / `ticksElapsed` / `frontage` / `attackerInitialFrontlineCount` / `defenderInitialFrontlineCount` / `attackerRoutedCount` / `defenderRoutedCount` / `breakthroughSide` / `pursuitOccurred`（counts は Battle entity の ID 配列から導出）/ `outnumberedVictory`（勝者側の連隊数 < 敗者側の連隊数。chronicle template が連隊数を表示して「数的劣勢を覆した」と描写するため、判定根拠も連隊数に一致させる。effectivePower 基準ではない）/ `decisiveVictory`（`outcomeQuality === 'rout'`）。`selectBattleTemplate` がこの 2 boolean と既存 routed count から数的不利勝利 / 大勝 / 辛勝 / 通常の chronicle template を選ぶ（§6.62）。`battlefieldKind`・`result`・`outcomeQuality`・`breakthroughSide` は raw enum 値で持ち、表示時に i18n（`enum.<key>.<value>`）が label 化する。warScore 変化は本 event で表現する） |
| BATTLE_AVOIDED | minor | 戦闘回避（WarManeuverSystem。messageKey `war.battle_avoided`。params: `warId` / `province` / `battlefieldKind` / `avoidingSide`（attacker / defender / both）。両者回避は warScoreDelta=0） |
| WAR_CAPTAIN_GENERAL_CHANGED | major/normal | 総大将の交代/喪失（WarManeuverSystem。messageKey `war.captain_general_changed`。新総大将が undefined（喪失）のとき major、交代は normal。初回任命は発火しない） |
| REGIMENT_REFORMED | minor | destroyed Regiment が active に再編成された（補充・再編成 RegimentReinforcementSystem。messageKey `regiment.reformed`。params: `owner` / `province`）。**strength の通常補充は organization recovery と同じく silent（イベント無し）**——大量発生する補充をイベント化しない方針 |
| POLITICAL_RIGHT_GRANTED | normal | v0.42: acquire_political_right project 完了で PoliticalRight が授与された |
| POLITICAL_RIGHT_REVOKED | normal | v0.42: RightConsistencySystem の drift 回収（regime change 等）で right が失効した。v0.51: 任命権失効陰謀（revoke_political_right Project）の完遂でも発火（revokeReason='revoked_by_conspiracy'）|
| POLITICAL_RIGHT_TRANSFERRED | normal | v0.42: right の holder 付替（通常発火経路なし — 将来の PeaceSettlement / regime change 用） |
| WAR_ENDED | major | 勝敗が明確でない終結（white_peace timeout / stale 安全終結 / cancelled orphan。messageKey `war.ended`） |
| WAR_AVERTED | minor | 勝率 × 指導者性格ゲートで開戦を見送った（WarCreationSystem §6.44。escalated play を cancel。messageKey `war.averted`。params: `attacker` / `defender` / `winChance` / `threshold`（整数%）） |
| PEACE_SETTLEMENT_APPLIED | major | tax WarGoal を state に反映（PeaceSettlementSystem。tax は before→after の税率を `fromRate`/`toRate`（整数%）で記録。transfer は底層 mutation の LAND_CONTRACT_* に委譲し本 event は出さない） |
| PROVINCE_CONQUERED | major | Province 征服（現状未発火。武力による土地奪取は LAND_CONTRACT_CONQUERED に置換済み。union 宣言と UI アイコンのみ残置） |
| COUNTRY_LAND_DEVELOPED | normal | 国家による土地開発（develop_holding Intent による Holding 開発も含む。v0.52: develop_real_estate / acquire_real_estate / upgrade_owned_real_estate の完了時にも同一 EventType で発火。Chronicle の Holding 開発史（byHolding）に載せるため holding ref を 1 件追加。§6.62） |
| POP_LAND_DEVELOPED | minor | POP 自主開発（現状未発火。PopDevelopment 無効化のため発火源なし、将来 POP Project で再導入予定） |
| PROVINCE_REVOLT_STARTED | normal | Province / POP 反乱が発生（現状未発火。反乱ライフサイクルは REVOLT_* 系に移行済み。union 宣言と UI アイコンのみ残置） |
| PROVINCE_REVOLT_SUCCEEDED | major | Province 反乱が concession で成功（現状未発火。REVOLT_SETTLED 等に置換） |
| PROVINCE_REVOLT_FAILED | normal | Province 反乱が失敗・鎮圧（現状未発火。REVOLT_SUPPRESSED 等に置換） |
| REVOLT_POLITY_FOUNDED | critical | Province 反乱の独立により新 Polity が成立 |
| REPUBLIC_FOUNDED | major | established commonwealth（共和国）の建国式。非 leader office を功臣で seed（§6.68・v0.46）。Chronicle `governance` |
| REPUBLIC_LEADER_ELECTED | major | 共和国 leader の任期交代（§6.68・v0.46）。Chronicle `governance` |
| LAND_CONTRACT_GRANTED | major | LandContract 新規付与（現状未発火、Faction 段階で配線） |
| LAND_CONTRACT_TRANSFERRED | major | terminal grantee の差し替え（§13 case A。landContract transfer mutation（landContractMutations.ts）が発火） |
| LAND_CONTRACT_INSERTED | major | 中間契約の挿入（§13 case B-1、現状未発火） |
| LAND_CONTRACT_REPLACED | major | 下位契約の差し替え（§13 case B-2、現状未発火） |
| LAND_CONTRACT_TAX_CHANGED | normal | 上納率の変更（case C、現状未発火） |
| LAND_CONTRACT_REVOKED | major | 契約解消（現状未発火） |
| LAND_CONTRACT_PURCHASED | major | 金銭による契約譲渡が成立（補償あり土地購入） |
| LAND_CONTRACT_CEDED | major | 補償なし土地譲渡 |
| LAND_CONTRACT_CONQUERED | major | 武力による土地奪取 |
| REAL_ESTATE_SEIZURE_STARTED | major | v0.53: House 所有 RealEstateAsset の owner income を現地 terminal Polity が押領開始（seize_real_estate_income Project 成功で RealEstateSeizure 作成）。Chronicle category=land。entityRefs: holding / province / seizerPolity / rightfulOwnerHouse |
| REAL_ESTATE_SEIZURE_RESOLVED | normal | v0.53: 押領が enforce_obligation 成功で解消（RealEstateSeizure → resolved）。Chronicle category=land |
| REAL_ESTATE_SEIZURE_LEGALIZED | major | v0.53: 20年時効で押領が既成事実化（prescriptionSystem。`asset.owner = undefined`、RealEstateSeizure → legalized）。Chronicle category=land |
| REAL_ESTATE_SEIZURE_CANCELLED | minor | v0.53: 前提崩壊・dangling で押領を取消（obligationConsistencySystem。絶家 / asset 消滅 / seizerPolity 非 active 等。RealEstateSeizure → cancelled）。Chronicle category=land |
| LAND_CONTRACT_DEFAULT_STARTED | major | v0.53: LandContract chain の上納義務不履行が発生（origin=tax_default は withhold_land_contract_tax Project 成功、revolt_independence は反乱独立。LandContractDefault 作成）。Chronicle category=land。entityRefs: holding / province / occupiedByPolity / claimantPolity |
| LAND_CONTRACT_DEFAULT_RESOLVED | normal | v0.53: 上納不履行が enforce 成功で解消（LandContractDefault → resolved。self-executed enforce 経路の専用 event。play/war 経由は settlement event で narrate）。Chronicle category=land |
| LAND_CONTRACT_DEFAULT_LEGALIZED | major | v0.53: 20年時効で不履行が既成事実化（prescriptionSystem。`spliceOutClaimantContract` で直近 grantor 1 段を splice、LandContractDefault → legalized）。Chronicle category=land |
| LAND_CONTRACT_DEFAULT_CANCELLED | minor | v0.53: 前提崩壊・dangling / 反乱鎮圧で不履行を取消（obligationConsistencySystem / suppressRevolt。occupiedBy・claimant 非 active / 契約消滅 / holding 消滅等。LandContractDefault → cancelled）。Chronicle category=land |
| PROJECT_STARTED | minor | Project 開始 |
| PROJECT_COMPLETED | normal | Project 完了 |
| PROJECT_FAILED | minor | Project 失敗 |
| PROJECT_CANCELLED | minor | Project 中止 |
| DIPLOMATIC_PLAY_STARTED | normal | 外交劇開始 |
| DIPLOMATIC_SUPPORT_DECLARED | normal | 支援宣言（v0.43。seek_diplomatic_support 成功 + joinScore 閾値到達で supporter が play の一方 side への支援を宣言。messageKey `diplomatic_play.support_declared`。params: `supporter` / `supported` / `opponent`。Chronicle category=diplomacy） |
| DIPLOMATIC_PLAY_SETTLED | major | 外交劇妥協成立 |
| DIPLOMATIC_PLAY_FAILED | normal | 外交劇失敗（現状未発火） |
| DIPLOMATIC_PLAY_ESCALATED | major | 外交劇決裂・戦争化（決裂時は本 event 発火後に warCreationSystem が WAR_DECLARED を出す） |
| DIPLOMATIC_PLAY_RESOLVED_BY_CONFLICT | major | 外交劇が武力衝突で解決（現状未発火。武力解決の経路は DIPLOMATIC_PLAY_ESCALATED → WAR_DECLARED） |
| DIPLOMATIC_PLAY_PROGRESS | normal | 外交劇進捗（現状未発火（予約）。union 宣言と template のみ存在） |
| CONTRACT_TAX_REVISED | normal | 税率改定成功（歴史記述用に before→after を `fromRate`/`toRate`（整数%）で記録。`rate`(after) は後方互換のため残置） |
| CONTRACT_ELIMINATED | major | 契約破棄 |
| REVOLT_NEGOTIATION_STARTED | normal | 叛乱交渉開始（popular_tax_relief demand を含む） |
| REVOLT_SETTLED | major | 叛乱交渉成功・税率引下 |
| REVOLT_SUPPRESSED | major | 叛乱鎮圧。messageKey: suppressed_executed / suppressed_pardoned |
| REVOLT_POLITY_ESTABLISHED | critical | 叛乱勝利・commonwealth 成立 |
| REVOLT_ESCALATED | major | 叛乱激化・武力化 |
| REVOLT_REGIME_CHANGED | critical | rank 5 内部政変・体制転覆 |
| BAILIFF_APPOINTED | normal | placeholder → 通常人物への Bailiff 交代 |
| BAILIFF_VACATED | normal | Bailiff が不在化 |
| BAILIFF_PLACEHOLDER_INSTALLED | minor | terminal Polity 変更時の Bailiff placeholder 設置 |
| GOAL_CREATED | minor | Goal 生成 |
| GOAL_SUCCEEDED | normal | Goal 達成 |
| GOAL_FAILED | normal | Goal 失敗（予約。現状未発火） |
| GOAL_ABANDONED | minor | Goal 放棄 |
| GOAL_REVIEWED | minor | Goal レビュー |
| AIM_CREATED | minor | Aim 生成 |
| AIM_SUCCEEDED | normal | Aim 達成 |
| AIM_FAILED | minor | Aim 失敗 |
| AIM_ABANDONED | minor | Aim 放棄 |
| HOUSE_POLICY_INFLUENCE | minor | House の政策誘導 |
| HOUSE_PATRONIZED_ARTIST | normal | 芸術家後援 |
| HOUSE_COMMISSIONED_CHRONICLE | normal | 年代記編纂 |
| PERSON_GOAL_CREATED | minor | Person Goal 生成 |
| PERSON_AIM_CREATED | minor | Person Aim 生成 |
| PERSON_AIM_SUCCEEDED | normal | Person Aim 達成 |
| PERSON_AIM_FAILED | minor | Person Aim 失敗 |
| TASK_COMPLETED | minor | Task 完了 |
| TASK_FAILED | minor | Task 失敗（現状未発火。Task 失敗は TASK_CANCELLED で表現される） |
| TASK_CANCELLED | minor | Task キャンセル |
| PRESSURE_CREATED | minor | 外交的圧力の発生 |
| PRESSURE_RESOLVED | minor | 外交的圧力の解決 |
| PRESSURE_CANCELLED | minor | 外交的圧力の撤回 |
| FACTION_FOUNDED | normal | 派閥の結成（factionLifecycleSystem） |
| FACTION_DISSOLVED | normal | 派閥の解散（factionLifecycleSystem） |
| FACTION_LEADER_CHANGED | normal | 派閥指導者の交代（factionLifecycleSystem） |
| FACTION_NESTED | normal | 弱小派閥が庇護者の傘下に入った（入れ子形成・factionLifecycleSystem） |
| FACTION_LEADER_BANKRUPT | normal | 派閥指導者の破産（factionLifecycleSystem） |
| PERSON_RECRUITED_TO_FACTION | normal | 派閥への勧誘成立（factionRecruitmentSystem） |
| FACTION_FUNDS_SHORTAGE | normal | 派閥資金の不足（factionPatronageSystem） |
| FACTION_MEMBER_ABANDONED | minor | 派閥メンバーの離反（factionDefectionSystem） |
| POP_HARDSHIP | minor | POP の困窮（将来実装） |
| POP_PROSPERITY | minor | POP の繁栄（将来実装） |
| POP_UNREST_RISING | normal | Province unrest 上昇警告（将来実装） |
| POP_DECLINED | normal | Province 人口大幅低下（将来実装） |
| ESTATE_SETTLED | minor / normal / major | 死亡時の wealth 分配（家長 or wealth≥house*20% で normal、polity leader で major） |
| ESTATE_DISPUTED | minor | 複数相続人候補による争い（記録のみ、ESTATE_SETTLED と並んで発火） |
| PERSON_ABILITY_GREW | minor | v0.44 成果成長（§6.66、sourceKind=project/diplomatic_play/war）+ 自然成長（§6.24 追補、sourceKind=duty/natural）。ability ごとに emit。能力の漸進的成長は「子誕生（normal）」より軽い日常的変化なため、notable 含め一律 minor（個人 Chronicle には残る） |
| PERSON_REPUTATION_GAINED | minor / normal | v0.44 正評判の獲得。reputation source 1 件につき 1 event |
| PERSON_REPUTATION_DAMAGED | minor / normal | v0.44 負評判 |
| PERSON_GENIUS_BORN | major | v0.45 天才の誕生（§6.67、geniusType=commander/chancellor/universal）。CHILD_BORN に続けて emit。メインログ表示 |
| POLITY_RANK_PROMOTED | major | v0.47 陞爵（§6.69、rank 昇格） |
| POLITY_TITULARIZED | normal | v0.47 landless rank2〜4 Polity の称号化（§6.69） |
| POLITY_ABOLISHED | normal | v0.47 landless rank5 Polity の廃止（§6.69） |
| POLITY_GRANTED | normal | v0.47 分封による rank5 Polity 新設（§6.69） |
| POLITY_TITLE_TRANSFERRED | normal | v0.47 Polity 譲渡による分家創設（§6.69） |
| HOUSE_FOUNDED_BY_LAND_GRANT | normal | v0.47 無家人物の分封による新 House（§6.69） |
| HOUSE_FOUNDED_IN_REPUBLIC | normal | v0.47 共和国役職者の landless House 創設（§6.69） |
| CADET_BRANCH_FOUNDED_BY_LAND_GRANT | normal | v0.47 有家人物の分封による分家（§6.69） |
| CADET_BRANCH_FOUNDED_BY_TITLE_TRANSFER | normal | v0.47 宗家 Polity 譲渡による分家（§6.69） |
| LAND_CONTRACT_CONSOLIDATED | minor / normal | v0.47 House 一円支配の自家内 contract 集約（§6.69） |
| SUPPLY_PLUNDER | major | v0.51 補給不足による略奪（§6.43a。improvement condition 大幅低下・POP wealth/unrest 被害・war_damage Crisis。params: warId/side/holding/damagedKinds/conditionDrop/wealthDelta/unrestDelta/supplyPressureReduction） |
| SUPPLY_HARSH_REQUISITION | normal | v0.51 補給不足による強制徴発（§6.43a。improvement condition 低下・POP wealth/unrest 被害。params: warId/side/holding/conditionDrop/wealthDelta/unrestDelta/supplyPressureReduction） |
| SUPPLY_ATTRITION | normal / major | v0.51 補給欠乏による連隊消耗（§6.43a。collapsed>0 で major。params: warId/side/supplyPressure/strengthDamage/organizationDamage/moraleDamage/collapsedRegimentCount） |

POP_HARDSHIP / POP_PROSPERITY / POP_UNREST_RISING / POP_DECLINED は EventType 宣言のみ。実際の発火ロジックは将来実装する。

---

