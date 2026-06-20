# 4. セレクター

### 4.1 Development セレクター

```ts
// HoldingImprovement から development を算出
// development = sum(improvement.level * scorePerLevel[improvement.kind])
function getHoldingDevelopment(state: WorldState, config: SimulationConfig, holdingId: HoldingId): number

// development modifier（production 側でのみ使用。class capacity からは除外）
// modifier = clamp(1.0 + development / 150, 0.75, 1.75)
// development 0 → 1.0（ペナルティなし）、development 62 → 1.41（最大）
function getHoldingDevelopmentModifier(state: WorldState, config: SimulationConfig, holdingId: HoldingId): number

// Holding の Improvement level を取得（存在しなければ 0）
function getHoldingImprovementLevel(state: WorldState, holdingId: HoldingId, kind: HoldingImprovementKind): number

// Province の development は Holding の weight 加重平均（getHoldingDevelopment 経由で算出）
// config を省略すると 0 を返す。selector は landContractSelectors.ts に存在する
function getProvinceDevelopmentFromHoldings(state: WorldState, provinceId: ProvinceId, config?: SimulationConfig): number

// state 非依存の純粋 capacity helper（selector / worldgen seeding が共有し計算ズレを防ぐ）
// capacity = (base + improvementDerivedCapacity) * weight * landQuality（devMod 不使用）
function computeHoldingClassCapacity(holdingKind, weight, landQuality, terrain, features, improvements, config): number

// state 非依存の建設可否判定（selector / worldgen 初期生成が共有）
function canBuildHoldingImprovementPure(holdingKind, terrain, features, currentLevel, kind, config): boolean

// state を取る薄いラッパ。currentLevel は既存 improvement から導出
function canBuildHoldingImprovement(state: WorldState, config: SimulationConfig, holdingId: HoldingId, kind: HoldingImprovementKind): boolean
```

`Holding.development` 保存値は持たない。development は HoldingImprovement の level から selector で算出する。production path は `getProvinceDevelopmentMultiplier` ではなく `getHoldingDevelopmentModifier` を使う。

development と class capacity は分離されている（§4.2）。`getHoldingDevelopmentModifier` は production 側でのみ使い、capacity からは外した（二重計上の回避）。pure helper（`computeHoldingClassCapacity` / `canBuildHoldingImprovementPure`）は `selectors/holdingImprovementSelectors.ts` に置き、selector・worldgen・taskSystem・integrity から共有する。

`getEffectiveProvinceTax` / `getEffectiveProvinceManpower` は存在しない。代わりに POP Economy セレクターを使用する。

### 4.2 POP セレクター

#### Holding POP セレクター

```ts
// Holding の全 PopGroup を返す（popIndex.byHolding 経由）
function getHoldingPops(state: WorldState, holdingId: HoldingId): PopGroup[]

function getHoldingPopsByClass(state: WorldState, holdingId: HoldingId, popClass: PopClass): PopGroup[]

function getHoldingPopsByClassAndEmployment(state: WorldState, holdingId: HoldingId, popClass: PopClass, employed: boolean): PopGroup[]

function getHoldingPopSizeByClass(state: WorldState, holdingId: HoldingId, popClass: PopClass): number

function getHoldingEmployedPopSize(state: WorldState, holdingId: HoldingId, popClass: PopClass): number

function getHoldingUnemployedPopSize(state: WorldState, holdingId: HoldingId, popClass: PopClass): number
```

#### Class capacity セレクター

```ts
// Holding のクラス別キャパシティ（computeHoldingClassCapacity へ委譲）
//   = (base + improvementDerivedCapacity) * weight * landQuality
//   improvementDerivedCapacity = Σ level * capacityPerLevel[kind] * terrainMult * featureMult
//   terrainMult = terrainCapacityMultiplier[kind]?.[terrain] ?? 1.0（clamp なし）
//   featureMult = clamp(Π(featureCapacityMultiplier[kind]?.[f] ?? 1.0), 0.75, 1.50)（feature 無→空積 1.0）
// devMod は使わない（§4.1 / 二重計上回避）
function getHoldingClassCapacity(state: WorldState, config: SimulationConfig, holdingId: HoldingId): number

// 残容量: capacity - used
function getHoldingClassRemainingCapacity(state: WorldState, config: SimulationConfig, holdingId: HoldingId): number

// 労働力不足 = remainingCapacity
function getHoldingLaborShortage(state: WorldState, config: SimulationConfig, holdingId: HoldingId): number

// 雇用 POP の合計サイズ
function getHoldingEmployedPopSize(state: WorldState, holdingId: HoldingId, popClass: PopClass): number

// 無職 POP の合計サイズ
function getHoldingUnemployedPopSize(state: WorldState, holdingId: HoldingId, popClass: PopClass): number

// 雇用率: 1 - (unemployed / total)
function getHoldingEmploymentRateByClass(state: WorldState, holdingId: HoldingId, popClass: PopClass): number
```

#### Province POP セレクター（Holding POP から集計）

```ts
// Province の全 PopGroup を Holding 経由で集計
function getProvincePops(state: WorldState, provinceId: ProvinceId): PopGroup[]

// POP size の合計（総人口）
function getProvincePopulation(state: WorldState, provinceId: ProvinceId): number

// POP wealth の人口加重平均
function getProvinceAveragePopWealth(state: WorldState, provinceId: ProvinceId): number

// POP unrest の人口加重平均
function getProvinceUnrest(state: WorldState, provinceId: ProvinceId): number

// carrying capacity = Province 内全 Holding のクラス別キャパシティ合計
function getProvinceCarryingCapacity(state: WorldState, config: SimulationConfig, provinceId: ProvinceId): number

// population pressure: clamp(population / carryingCapacity, 0, 2)
function getProvincePopulationPressure(state: WorldState, config: SimulationConfig, provinceId: ProvinceId): number

// class 別の unrest（Province 内の該当 class POP の人口加重平均）
function getPopUnrestByClass(state: WorldState, provinceId: ProvinceId, popClass: PopClass): number

// class 別の wealth（Province 内の該当 class POP の人口加重平均）
function getPopWealthByClass(state: WorldState, provinceId: ProvinceId, popClass: PopClass): number
```

### 4.3 POP Economy セレクター

```ts
// POP 1件の生産量（employment multiplier、Holding 単位 dev/control）
// pop.size * productivityByClass[pop.class] * (pop.employed ? employedProductivityMultiplier : unemployedProductivityMultiplier)
//   * (pop.wealth / 100) * holdingDevelopmentModifier * holdingControlModifier
function getPopProduction(state: WorldState, config: SimulationConfig, popId: PopGroupId): number

// Province の総生産量（全 Holding POP の生産量合計）
function getProvinceProduction(state: WorldState, config: SimulationConfig, provinceId: ProvinceId): number

// Province の税基盤: getProvinceProduction * (polityControl / 100)
function getProvinceTaxBase(state: WorldState, config: SimulationConfig, provinceId: ProvinceId): number

// Polity 用の Province 兵力基盤（employment manpower multiplier 含む）
// sum(pop.size * manpowerFactorByClass[pop.class] * (pop.employed ? employedManpowerMultiplierByClass[pop.class] : unemployedManpowerMultiplier) * (polityControl / 100))
function getProvinceCountryManpowerBase(state: WorldState, config: SimulationConfig, provinceId: ProvinceId): number

// House 用の Province 兵力基盤: polityManpowerBase と同等 (houseControl は持たない)
function getProvinceHouseManpowerBase(state: WorldState, config: SimulationConfig, provinceId: ProvinceId): number

// 後方互換 wrapper: getProvinceCountryManpowerBase を呼ぶ
function getProvinceManpowerBase(state: WorldState, config: SimulationConfig, provinceId: ProvinceId): number
```

### 4.4 Military セレクター

```ts
// House 軍事力: (levyPower + mercenaryPower) * commanderModifier
//   levyPower       = sum(house.provinceIds.map(pid => getProvinceHouseManpowerBase(pid))) * houseManpowerPowerFactor
//   mercenaryPower  = min(log1p(max(0, wealth - reserve)) * factor, levyPower * maxMercenaryPowerRatio)
//   commanderModifier = clamp(1 + normalizedStat(bestMartial) * effect, min, max)
function calcHouseMilitaryPower(state: WorldState, config: SimulationConfig, houseId: HouseId): number

// Polity 軍事力: adminPower * factor + sum(houseContributions)
//   owner 家門は 100% 寄与。非 owner 家門は getHouseLoyaltyToPolity に応じた寄与
function calcPolityMilitaryPower(state: WorldState, config: SimulationConfig, polityId: PolityId): number
```

**War Maneuver セレクター（`warManeuverSelectors.ts`。§6.45 で使用）**:

```ts
isEligibleWarPerson(state, personId): boolean              // 総大将になりうる person（生存・条件）
selectCaptainGeneralForWarSide(state, polityId, config?): PersonId?  // warCommand スコア順に総大将を選出
isEligibleBattleCommander(state, personId): boolean        // v0.43: 人物条件のみ（生存・非 placeholder・成人）。military office 保有は要件でない
buildWarSideCommanderCandidates(state, polityIds, captainGeneralId, config?): PersonId[]  // v0.43: 全 polity participant の宮廷人材プール（military holder + House メンバー + 派閥食客）から選出。participant polity の leader は CG 兼任時のみ候補。uncapped・warCommand desc / personId asc
finalizeWarCommanderCandidates(attackerCandidates, defenderCandidates, cap): { attacker, defender }  // v0.43: 両属人物を双方から除外 → 各 side を cap (maxWarCommanderCandidatesPerSide) に切り詰め
getWarGoalProvince(state, war): ProvinceId?                 // battle 対象 Province の解決
generateCandidateBattlefield(province, rng, config): RngResult<BattlefieldKind>  // terrain/features → 戦場。rng を 0-2 回 draw して進める
getWarSidePrimaryPolityActor(war, sideKey): OrganizationRef?  // war side の主 Polity actor
getWarSidePolityActors(war, sideKey): PolityId[]            // v0.43: side の全 polity participant（primary 先頭 + supporter 追加順）
buildBattleSimCommanderInputs(state, commanderPersonIds): BattleSimCommanderInput[]  // commander PersonId[] を battle sim 入力へ変換。v0.49 で fieldCommandScore/breakthroughScore に加え pursuitScore(=command·0.5+insight·0.35+valor·0.15) と command/insight/valor 個別値を付与（突破/追撃の現場指揮官能力。§6.45）
```

戦力は `getActorMilitaryPower`（actorSelectors）を用い、指揮官補正は WarManeuverSystem 内の `commanderModifier` / `captainGeneralEfficiency`（`getRoleScore(person, 'warCommand')`）で乗算する。

**開戦前勝率推定セレクター（`warEstimateSelectors.ts`。§6.44 開戦ゲートで使用）**: `estimateWarSidePower(state, config, actor)` は**実戦闘と同じ戦力源**（動員可能な常設連隊＝`status==='active'` かつ `currentWarId===undefined` の `getRegimentEffectivePower` 合計、連隊記録ゼロ時のみ `getActorMilitaryPower` フォールバック、記録ありで動員可能ゼロは 0）で推定する。`estimateAttackerWinChance` = `atk/(atk+def)`。WarManeuver は動員後の `getRegimentPowerForWarSide`（byWar 索引）を使うのに対し、開戦前は byOwner から動員可能分を見る点が異なる（同じ effectivePower 規則を共有）。

### 4.5 Status セレクター

legitimacy / stability / prestige / cohesion / loyaltyToPolity は格納フィールドではなく動的計算セレクターで算出する。

```ts
// Polity 正統性: 0.35*personScore + 0.45*popScore + 0.2*legacyPrestige
//   personScore: Polity 関係 Person の対 Polity attitude (affection*0.35 + respect*0.65) 平均
//   popScore:    Polity 内 PopGroup の対 Polity attitude (affection*0.40 + respect*0.60) 人口加重平均
function getPolityLegitimacy(state: WorldState, polityId: PolityId): number

// Polity 安定度: Province の安定度を首都からの距離で重み付け平均
//   provinceStability = 0.70*(100-unrest) + 0.30*polityControl
//   weight = 1 / (1 + distance)  ※到達不能は distance=5 扱い
function getPolityStability(state: WorldState, config: SimulationConfig, polityId: PolityId): number

// House 結束度: 家臣メンバーの家長への attitude 平均
//   score = affection*0.45 + respect*0.55（attitudeValueToScore で 0..100 正規化）
//   メンバーが 0 の場合は fallback 50
function getHouseCohesion(state: WorldState, houseId: HouseId): number

// House 忠誠度: 家メンバーの対 Polity attitude 平均
//   score = affection*0.55 + respect*0.45
function getHouseLoyaltyToPolity(state: WorldState, houseId: HouseId): number

// Prestige = 0.70 * legacyPrestige + 0.30 * averageRespectScore
//   respectScore: 世界全体の Person/PopGroup からの attitude.respect 平均（attitudeValueToScore 正規化）
function getPolityPrestige(state: WorldState, polityId: PolityId): number
function getHousePrestige(state: WorldState, houseId: HouseId): number
function getPersonPrestige(state: WorldState, personId: PersonId): number

// Polity 行政力: 毎年 GovernanceSystem がキャッシュ
//   clamp100((rulerContrib + adminContrib + treasurerContrib) * adminEfficiency * 0.5
//            + stability * 0.2 + legacyPrestige * 0.15 + treasuryScore * 0.15)
//   rulerContrib     = getEffectiveOfficeStat(leader)      * rulerAdminCapacityFactor
//   adminContrib     = getEffectiveOfficeStat(administrator)* administratorCapacityFactor
//   treasurerContrib = getEffectiveOfficeStat(treasurer)   * treasurerCapacityFactor
//   adminEfficiency  = getAdministrativeEfficiency(...)
//   各 stat は getEffectiveOfficeStat（役職担当者の能力・人数・協調ペナルティを考慮）
//   v0.49: getEffectiveOfficeStat の能力換算を非線形化（spec §10.0）。
//     value = abilityOutputFactor(getRoleScore(governance), config) * 5
//     （中立 roleScore 50 → 5 = 旧 50/10。平均的役職保持者は不変、能力差のみ ~2x に増幅）。
//     これで adminPower 経由の征服・開発・収益も人物能力に一貫して連動する。
//     なお adminPower は stability/prestige/treasury の institutional 項と混合するため、
//     polity 全体の実効 adminPower 比は stat 比（2x）より緩やかになる（制度の寄与は意図的）。
function getPolityAdminPower(state: WorldState, config: SimulationConfig, polityId: PolityId): number
```

**attitudeValueToScore の変換**:
- affection / respect の値 (-100..100) → score (0..100)
- 0 → 50、正 → 50+、負 → 50- の線形変換

### 4.6 Office / Share セレクター

```ts
// 指定組織・役職のアクティブ担当者 ID 一覧
function getActiveOfficeHolders(state: WorldState, org: OrganizationRef, role: OfficeRole): PersonId[]

// Polity の指導者（polity:leader Office holder）
function getPolityLeader(state: WorldState, polityId: PolityId): PersonId | undefined

// Polity の指導者の所属家
function getPolityLeaderHouse(state: WorldState, polityId: PolityId): HouseId | undefined

// 家の家長（house:leader のホルダー）
function getHouseLeader(state: WorldState, houseId: HouseId): PersonId | undefined

// House 内の上位 share holder 一覧（v0.42c: house 専用に縮小。旧 polity 系
// getDominantPolityHouse / getHousePolitySharePercent は polity share 全廃で削除 —
// 置換先は influenceSelectors の getDominantInfluenceHolder / getActorInfluenceInPolity）
function getTopShareholders(state: WorldState, houseId: HouseId, limit?: number): Array<{ holderPersonId: PersonId; rawPower: number; percent: number }>

// Person が House に持つ Share 割合（0〜100）
function getPersonHouseSharePercent(state: WorldState, houseId: HouseId, personId: PersonId): number

// 行政キャパシティ: basePolityInstitutionalCapacity + ruler*factor + administrator*factor + treasurer*factor
function getAdministrativeCapacity(state: WorldState, config: SimulationConfig, polityId: PolityId): number

// 行政負荷: Province数 * adminLoadPerProvince + officeCount * adminLoadPerPolityOffice
function getAdministrativeLoad(state: WorldState, config: SimulationConfig, polityId: PolityId): number

// 行政効率: clamp(capacity / load, minAdministrativeEfficiency, maxAdministrativeEfficiency)
function getAdministrativeEfficiency(state: WorldState, config: SimulationConfig, polityId: PolityId): number
```

### 4.6a2 Polity Influence / PoliticalRight selector（v0.42）

`influenceSelectors.ts` — Polity の権力分布 read-model（§6.64）。percent は 0〜100。

```ts
// 対象 Polity の influence breakdown（entry 母集合・11 domain〈reputation / standing 含む。standing = InfluenceModifier〉・percent。total 降順）
function getPolityInfluenceBreakdown(state, config, polityId): PolityInfluenceBreakdown

// actor (house | person) の influence score / percent
function getActorInfluenceInPolity(state, config, actor, polityId): { score: number; percent: number }

// 前計算済み breakdown から引く版（候補者ループでの再計算回避 — perf 規約）
function getActorInfluenceFromBreakdown(breakdown, actor): { score: number; percent: number }

// 最大 influence holder（domain 指定可）/ 上位 N 件
function getDominantInfluenceHolder(state, config, polityId, domain?): PolityInfluenceEntry | undefined
function getTopInfluenceHoldersInPolity(state, config, polityId, limit?, domain?): PolityInfluenceEntry[]

// 家の支配率（house aggregate influence・§6.64a-(10)）= 家 entry + 家中の生存メンバー person entry の合算。
//   個人帰属化した influence を家単位の支配力評価で再集約する統一指標（goalSelectors / 継承 / 有力家門判定が共有）。
function getHouseAggregateInfluenceInPolity(state, config, houseId, polityId): { score: number; percent: number }
function getHouseAggregateInfluenceFromBreakdown(state, breakdown, houseId): { score: number; percent: number }

// UI 二重円用：breakdown を「家の支配率」単位にグループ化した read-model（read-only・tick 非経路）。
//   groups（家本体 + メンバー内訳・aggregatePercent 降順）/ othersPercent。minGroupPercent 未満は「その他」へ集約。
function getGroupedPolityInfluence(state, config, polityId, minGroupPercent?): GroupedPolityInfluence
```

```ts
// v0.43: Polity の「targetPolity への influence 加重意見」(-100..100)。
//   holder が Person なら本人 / House なら leader の attitude を percent で加重平均
//   (leader 不在 entry は weight ごと除外、有効 holder 0 なら 0)。
//   v0.43 では joinScore の politicalOpinion 休眠項 (weight 0) としてのみ配線。
function getWeightedOpinionFromInfluenceBreakdown(state, breakdown, targetPolityId): number
```

**perf 規約**: getPolityInfluenceBreakdown は province / office / right / faction を歩くため、
候補者ループ内で呼ばない。polity ごとに 1 回前計算して getActorInfluenceFromBreakdown で引く
（appointmentSystem / goalSelectors / factionSelectors が採用）。

`diplomaticSupportSelectors.ts` — v0.43 supporter 候補選定と joinScore（§6.55 TaskSystem の seek_diplomatic_support）。

```ts
// §8.1 hard exclude 全適用の候補列挙 (PolityId 昇順・決定的)。side 非依存 (exclude は両 side 対称)
function enumerateSupportCandidates(state, play): PolityId[]

// polity の LandContract chain を上向きに辿った直接・間接の宗主 polity 集合 (循環は visited で防御)
function getPolityOverlordPolityIds(state, polityId): Set<string>

// joinScore = Σ(weight × score)。各項は 0..100 / -100..100 正規化済み (§9 — config weight 表参照)
function computeJoinScore(state, config, play, side, candidateId): JoinScoreBreakdown

// score 降順・同点 PolityId 昇順 (列挙順の先勝ち)。RNG 不使用
function selectBestSupportCandidate(state, config, play, side): { polityId; score } | undefined

// 個別 score (proximity / militarySparePower / treasury / threatContainment / lastWarPenalty) も export
// candidate が active War に参加中か (terminal War の retention 残留は不問)
function isPolityInActiveWar(state, polityId): boolean
```

`politicalRightSelectors.ts` — PoliticalRight の index 経由 derivation。

```ts
function getRightForTarget(state, target): PoliticalRight | undefined        // 1 target 1 right
// v0.42 slot 化: office right は (polity, role, slotIndex) 単位
function getPolityOfficeAppointmentRight(state, polityId, role, slotIndex): PoliticalRight | undefined
function getHoldingOfficeAppointmentRight(state, holdingId): PoliticalRight | undefined
function getRegimentControllerRight(state, regimentId): PoliticalRight | undefined  // Regiment 型にフィールドは無い
function getRightsByHolder(state, holder): PoliticalRight[]
function getRightsByPolity(state, polityId): PoliticalRight[]
// acquire_political_right の target 選定（kind 優先度 + role 内は slot 若い順 + 近接優先の
// 決定的簡略化 — §6.64。slot 列挙に effectiveMax が要るため config を取る）
function findAcquirableRightTarget(state, config, houseId, polityId): PoliticalRightTargetRef | undefined
// v0.51 陰謀: revoke_political_right の target 選定。conspiring 家以外（自家・自家 member 除外）が
// holder の active right を返す。person holder 優先、targetKey 昇順で決定的（§6.26）
function findRevocableRightTarget(state, conspiringHouseId, polityId): PoliticalRightTargetRef | undefined
```

acquire の候補 polity 列挙（非 owner 開放 — §6.64）は `goalSelectors.ts` 側:

```ts
// 家が influence を持ちうる polity の集合 (昇順ソートで決定的)。
// influence breakdown の entry 導入 source と 1:1 被覆: owned + 宗主チェーン全段 +
// 生存 member の polity office / bailiff / active faction leader + 既保有 right
function collectAcquireRightCandidatePolityIds(state, houseId, ownedPolityIds): PolityId[]
```

### 4.6b Polity 関係 selector

House / Person が Polity に所属しない設計（§3.3 参照）のため、関係取得は `prototype/src/sim/selectors/polityRelations.ts` の selector に集約する。

```ts
// Province → Polity / House
function getProvincePolity(state: WorldState, provinceId: ProvinceId): Polity | undefined
function getProvinceOwnerHouse(state: WorldState, provinceId: ProvinceId): House | undefined

// Polity 内 Province / House / Person
function getPolityProvinceIds(state: WorldState, polityId: PolityId): ProvinceId[]
function getPolityHouseIds(state: WorldState, polityId: PolityId): HouseId[]
// ↑ Polity 自身の ownerHouse に加え、Polity が chain 上に出現する各 Holding を
//   terminal 支配する Polity の ownerHouse の集合 (active House のみ)。
//   Holding 粒度で判定するため、1 Province を複数 Polity が holding 単位で分有する
//   場合 (反乱 commonwealth が 1 holding だけ seizure 等) に他家が混入しない。
//   commonwealth (ownerHouse なし) は 0 House を返す。
function getPolityPersonIds(state: WorldState, polityId: PolityId): PersonId[]
// ↑ Polity 関係 House の alive member。複数 Polity 跨ぎ House の人物は重複可

// House → Polity
function getHouseProvinceIdsByPolity(state: WorldState, houseId: HouseId, polityId: PolityId): ProvinceId[]
function getHousePolityIds(state: WorldState, houseId: HouseId): PolityId[]
// ↑ House が Province を所有している active Polity 一覧
function getHousePrimaryPolityId(state: WorldState, houseId: HouseId): PolityId | undefined
// ↑ 表示・候補選定用の便宜的 primary Polity
//   1) house.seatProvinceId の polity を最優先
//   2) Province 数が最大の Polity
//   3) 同数なら development 合計が最大
//   4) それも同じなら PolityId 昇順

// Person → Polity
function getPersonRelevantPolityIds(state: WorldState, personId: PersonId): PolityId[]
function getPersonPrimaryPolityId(state: WorldState, personId: PersonId): PolityId | undefined

// House の Polity 内拠点（capital 移転や Polity 内中心地を求めるとき）
function getHouseSeatProvinceInPolity(
  state: WorldState,
  houseId: HouseId,
  polityId: PolityId,
): ProvinceId | undefined
//   1) house.seatProvinceId が対象 Polity 内なら、それを返す
//   2) そうでなければ Polity 内の所有 Province から development 最大を選ぶ
```

### 4.6c LandContract / HoldingOffice selector

`prototype/src/sim/selectors/landContractSelectors.ts` および `provinceOfficeSelectors.ts` に集約。

```ts
// LandContract chain — Province ベース (legacy)
function getProvinceLandContractChain(state, provinceId): LandContract[]  // root → terminal
function getProvinceRootContract(state, provinceId): LandContract | undefined
function getProvinceDominantTerminalContract(state, provinceId): LandContract | undefined
function getProvinceTerminalPolityId(state, provinceId): PolityId | undefined
function getProvinceEffectiveOwnerHouseId(state, provinceId): HouseId | undefined

// LandContract chain — Holding ベース (正規)
function getHoldingLandContractChain(state, holdingId): LandContract[]  // root → terminal
function getHoldingTerminalPolityId(state, holdingId): PolityId | undefined

// Holding selector
function getProvinceHoldings(state, provinceId): Holding[]
function getProvinceDevelopmentFromHoldings(state, provinceId, config?): number  // weight 加重平均（config 省略時 0）
function getProvincePolityControlFromHoldings(state, provinceId): number   // weight 加重平均
function getProvinceTerminalPolityBreakdown(state, provinceId): Array<{ polityId; holdingCount; weight }>
function getProvinceDominantTerminalPolityId(state, provinceId): PolityId | undefined
function selectTargetHoldingInProvince(state, provinceId): HoldingId | undefined  // 最大 weight

// Polity → Province
function getPolityGrantedProvinceIds(state, polityId): ProvinceId[]
function getPolityTerminalProvinceIds(state, polityId): ProvinceId[]
function getPolityOverlordProvinceIds(state, polityId): ProvinceId[]

// House → Polity / Province
function getHouseOwnedPolityIds(state, houseId): PolityId[]
function getHouseControlledProvinceIds(state, houseId): ProvinceId[]
function getHouseRelevantProvinceIds(state, houseId): ProvinceId[]

// grantor 派生
function getLandContractGrantor(state, contractId): LandContractGrantor | undefined
function getGrantorRank(state, grantor): number   // root は 0

// placeholder Person 判定
function isPlaceholderPerson(state, personId): boolean

// HoldingOffice / Bailiff (Holding 単位)
function getHoldingBailiffPerson(state, holdingId): Person | undefined
```

### 4.7 Ability / 派生 selector

`prototype/src/sim/selectors/abilitySelectors.ts` に集約。

```ts
export type AppliedRoleKey =
  | 'governance'
  | 'stewardship'
  | 'diplomacy'
  | 'intrigue'
  | 'warCommand'
  | 'strategy'      // v0.51: 参謀・軍師の作戦判断。warSupplySystem staff 選出に使用

// 応用ロールの基礎能力からの重み付き和を返す（0..120 を保証、ABILITY_HARD_CAP でクランプ）
function getRoleScore(state: WorldState, personId: PersonId, role: AppliedRoleKey): number

// 能力 k における年齢 age での「自然到達水準」を返す（0..1 の係数）
// 各能力の AGE_CURVE （lifelongGrowth / youthPeak / midLifePeak）に基づく
function naturalFraction(k: AbilityKey, age: number, config: SimulationConfig): number

// aptitude（才能上限）を独立ガウス分布でサンプル。値域 [0, ABILITY_GENERATION_MAX=100]
function sampleAptitudes(rng: RngState, config: SimulationConfig): RngResult<AbilityScores>

// 両親平均と populationMean(=50) を heritability で混合して子の aptitude を生成
function inheritAptitudes(father: Person, mother: Person, rng: RngState, config: SimulationConfig): RngResult<AbilityScores>

// 年齢曲線に基づき aptitude * naturalFraction(age) を中央値として ability をサンプル
// 不変条件: ability ≤ aptitude
function sampleAbilitiesFromAptitudes(aptitudes: AbilityScores, age: number, rng: RngState, config: SimulationConfig): RngResult<AbilityScores>

// 能力 k について、当該 person が「関連経験」を持つか判定（PersonGrowthSystem の effectiveCeiling 切替に使用）
function hadRelevantExperience(state: WorldState, personId: PersonId, k: AbilityKey): boolean
```

**ROLE_WEIGHTS（応用ロールの定義）**:

```ts
governanceScore   = numeracy*0.30 + learning*0.30 + charisma*0.20 + insight*0.20
stewardshipScore  = numeracy*0.60 + learning*0.20 + insight*0.20
diplomacyScore    = charisma*0.50 + insight*0.30 + learning*0.20
intrigueScore     = insight*0.70 + charisma*0.20 + learning*0.10
warCommandScore   = command*0.60 + insight*0.20 + learning*0.10 + valor*0.10
strategyScore     = insight*0.40 + learning*0.30 + command*0.20 + numeracy*0.10
```

* 既存システム（successionSelectors / personAbilityEffects / militarySelectors / officeSelectors 等）は `getRoleScore(state, p.id, role) / 10` で正規化して旧 admin/martial（0..10）相当のスケールに揃える
* 通常範囲は 0..10、限界突破帯では最大 12

### 4.8 Task / Goal セレクター

```ts
// Person Goal の currentFulfillment（baseFulfillment + 現在状況 modifier、0..100）
function getPersonGoalFulfillment(state: WorldState, personId: PersonId): number

// Person の週あたり行動力（base 2.0 + ambition bonus - age penalty）
function getPersonWeeklyActionCapacity(state: WorldState, config: SimulationConfig, personId: PersonId): number

// Aim / ActivityLog ベースの任官補正値
function getAppointmentTaskModifier(
  state: WorldState, config: SimulationConfig,
  personId: PersonId, organization: OrganizationRef, role: OfficeRole
): number

// Task の effectivePriority（ownerDutyBonus + goalAlignmentBonus + urgencyBonus + taskKindPriorityBonus - overloadPenalty）
function computeEffectivePriority(state: WorldState, config: SimulationConfig, task: Task): number
```

### 4.8a 陰謀 drive セレクター（conspiracySelectors, v0.51）

`prototype/src/sim/selectors/conspiracySelectors.ts` — covert Goal `pursue_covert_agenda` の起案 drive（§6.26）。
RNG 非消費・on-demand 計算。

```ts
// 旧 plotTendency をそのまま移植した raw 値（ゲート前。テスト・診断用に分離）。
// = 当主 ambition×30 + 家格 legacyPrestige×0.2 + 低 houseLoyalty×0.3 + 低 overlord loyalty×20
//   − caution×15 − adminPower×0.1。primary polity / house leader 不在は 0。
function computeRawConspiracyDrive(state: WorldState, houseId: HouseId): number

// ゲート済み drive。閾値 conspiracyDriveThreshold 未満 or cooldown（conspiracyCooldownWeeks）中は 0。
function computeConspiracyDrive(state: WorldState, config: SimulationConfig, houseId: HouseId): number
```

### 4.9 Project / Task outcome selector

`prototype/src/sim/selectors/taskSelectors.ts` および `prototype/src/sim/selectors/projectSelectors.ts` に集約。

```ts
// Task のデフォルト difficulty / relevantAbility（TaskKind ごとの定数マッピング）
function getTaskDefaultDifficulty(kind: TaskKind): number
function getTaskDefaultRelevantAbility(kind: TaskKind): AbilityKey

// ProjectKind → relevantAbility マッピング（prepare_project / advance_project 用）
const PROJECT_KIND_ABILITY_MAP: Record<ProjectKind, AbilityKey>

// v0.51 陰謀: 陰謀 Project の effortRequired / difficulty を「重い・高難度」に上書き（スパム抑止 — §6.26）。
// revoke_political_right は target right の holder が家のとき difficulty に家保有ボーナスを加算
// （家任命権は個人任命権よりずっと取り消しにくい）。陰謀以外は undefined を返し既定値のまま。
function getConspiracyTaskOverride(
  state: WorldState, config: SimulationConfig, project: Project,
): { effortRequired: number; difficulty: number } | undefined

// Task 完了時の outcome 判定
// effectiveScore = abilityScore + roll*100 vs threshold = difficulty*2
function determineTaskOutcome(
  state: WorldState, config: SimulationConfig, task: Task, rng: RngState,
): { outcome: TaskOutcomeKind; rng: RngState }

// Project の関連エンティティ参照（ProjectKind ごとに異なる）
function getProjectRelatedRefs(project: Project): EntityRef[]

// Person の Project workload（active Task + supervised Project + Office）
function getPersonProjectWorkload(state: WorldState, personId: PersonId): number

// Project creator / supervisor 選定
function selectProjectCreator(state: WorldState, config: SimulationConfig, aim: Aim): PersonId | undefined
function selectProjectSupervisor(state: WorldState, config: SimulationConfig, owner: DecisionSubjectRef, projectKind: ProjectKind, creatorPersonId: PersonId): PersonId | undefined
```

スコアリングは両者とも `能力/10 + officeBonus + leaderBonus(+creatorBias) − workload×0.5`。

**候補母集合**: creator は owner 組織の内部の人間のみ（polity → owner 家＋土地チェーン上の家のメンバー
= `getPolityPersonIds` / house → memberIds）。supervisor はそれに加えて**派閥のメンバー（客分・食客）**
を含む — polity の Project では owner polity に anchor された active 派閥のメンバー（派閥の介入は
anchor Polity のみ、という Faction の原則に整合）、house の Project ではその家の生存メンバーが率いる
active 派閥のメンバー（家の食客）。Project の発案は組織内部に限り、派閥は実務の担い手としてのみ参加する。

### 4.9b 代官 selector

`prototype/src/sim/selectors/bailiffSelectors.ts` に集約。

```ts
// 代官の事務能力スコア（BailiffPolicy 判定と collectionEfficiency で共用）
// numeracy*0.50 + learning*0.20 + insight*0.20 + caution*120*0.10
function getBailiffStewardshipScore(person: Person): number

// Holding 内 POP の size 加重平均 unrest（POP なしは 0）
function getHoldingAverageUnrest(state: WorldState, holdingId: HoldingId): number

// 代官方針: 能力・性格・現地 unrest から最大スコアの policy を返す
// placeholder は 'passive' 固定
function getBailiffPolicy(state: WorldState, config: SimulationConfig, assignmentId: HoldingOfficeAssignmentId): BailiffPolicy

// 方針スコア詳細（デバッグ・UI 用）
function getBailiffPolicyScores(state: WorldState, config: SimulationConfig, assignmentId: HoldingOfficeAssignmentId): Record<BailiffPolicy, number>

// 現地徴収率: contractedRemittanceRate + expectedFeeRate + policyModifier, clamp [min, max]
function getBailiffLocalExtractionRate(state: WorldState, config: SimulationConfig, assignmentId: HoldingOfficeAssignmentId): number

// 徴税効率: base + skill + policy + task modifier, clamp [min, 1.0]
// placeholder は placeholderBailiffCollectionEfficiency 固定
function getBailiffCollectionEfficiency(state: WorldState, config: SimulationConfig, assignmentId: HoldingOfficeAssignmentId, recentTaskStatus: BailiffRevenueTaskStatus): number

// 代官取り分率: expectedFeeRate + policyModifier, clamp [0, max]
function getBailiffFeeRate(state: WorldState, config: SimulationConfig, assignmentId: HoldingOfficeAssignmentId): number

// 徴税負担の分解: actualExtraction + collectionFriction = totalBurden
function computeBailiffBurdenComponents(
  localExtractionRate: number,
  collectionEfficiency: number,
  collectionFrictionFactor: number,
): { actualExtractionBurdenRate: number; collectionFrictionBurdenRate: number; totalBurdenRate: number }

// 直近 4 週の collect_holding_revenue Task 完了状態
function getRecentBailiffRevenueTaskStatus(state: WorldState, assignmentId: HoldingOfficeAssignmentId): BailiffRevenueTaskStatus
```

### 4.10 House / Person 可用性セレクター

```ts
// 支配者家門: 1 つ以上の active Polity の ownerHouseId になっている active normal House
function isRulingHouse(state: WorldState, houseId: HouseId): boolean

// 非支配者家門: active normal House だが ownerHouse として保持する active Polity が 0
function isNonRulingHouse(state: WorldState, houseId: HouseId): boolean

// 支配者家門 ID 一覧
function getRulingHouseIds(state: WorldState): HouseId[]

// 非支配者家門 ID 一覧
function getNonRulingHouseIds(state: WorldState): HouseId[]

// 有力家門 (Polity Share 限定): ownerHouse でない Polity で Share 比率が閾値以上
function isInfluentialHouseInAnyPolity(
  state: WorldState,
  config: { influentialHousePolityShareThreshold: number },
  houseId: HouseId,
): boolean

// 有力家門 (汎用判定): 以下のいずれかを満たす
//   isRulingHouse || isInfluentialHouseInAnyPolity || wealth >= threshold || legacyPrestige >= threshold
function isInfluentialHouse(
  state: WorldState,
  config: {
    influentialHousePolityShareThreshold: number
    influentialHouseWealthThreshold: number
    influentialHouseLegacyPrestigeThreshold: number
  },
  houseId: HouseId,
): boolean

// 無家人物: houseId を持たない normal Person (placeholder 除外)
function isHouselessPerson(state: WorldState, personId: PersonId): boolean

// 無家人物 ID 一覧
function getHouselessPersons(state: WorldState): PersonId[]

// 政治的に関与している人物 (以下のいずれかに該当):
//   - 所属 House が支配者家門 / 有力家門
//   - active Faction 所属
//   - active Office holder
//   - active Project の supervisor
//   - DiplomaticPlay の delegate
function isPoliticallyEngagedPerson(
  state: WorldState,
  config: { influentialHousePolityShareThreshold: number },
  personId: PersonId,
): boolean

// 在野人物 (登用候補): alive, normal, 政治的に非関与
function isRecruitableOutsiderPerson(
  state: WorldState,
  config: { influentialHousePolityShareThreshold: number },
  personId: PersonId,
): boolean

// 非支配者・非有力家門の土地なし House メンバー
function isLandlessHouseMember(state: WorldState, personId: PersonId): boolean
```

### 4.10b Clan セレクター

`prototype/src/sim/selectors/clanSelectors.ts` に集約。

```ts
// Clan 取得
function getClan(state: WorldState, clanId: ClanId): Clan | undefined

// House の所属 Clan（house.clanId 経由 O(1)）
function getHouseClan(state: WorldState, houseId: HouseId): Clan | undefined

// Clan の active House 一覧
function getClanActiveHouseIds(state: WorldState, clanId: ClanId): HouseId[]

// Clan の extinct House 一覧
function getClanExtinctHouseIds(state: WorldState, clanId: ClanId): HouseId[]

// Clan 生存メンバー数（active House の memberIds.length 合計）
function getClanLivingMemberCount(state: WorldState, clanId: ClanId): number

// Clan 総資産（active House の wealth 合計）
function getClanTotalWealth(state: WorldState, clanId: ClanId): number

// Clan 総威信（active House の legacyPrestige 合計）
function getClanTotalLegacyPrestige(state: WorldState, clanId: ClanId): number

// Clan の支配者家門一覧
function getClanRulingHouseIds(state: WorldState, clanId: ClanId): HouseId[]

// Clan の有力家門一覧
function getClanInfluentialHouseIds(state: WorldState, config, clanId: ClanId): HouseId[]

// House の Clan 内の立場
function getHouseClanRole(state: WorldState, houseId: HouseId): 'root' | 'descendant' | undefined

// rootHouseId から下方向に再帰して到達する全 descendant House（汎用 utility、clanId フィルタなし）
function getDescendantHouseIdsIncludingSelf(state: WorldState, rootHouseId: HouseId): HouseId[]
```

`getClanMemberHouseIds` は独立 selector として実装しない（`getClan(state, clanId)?.memberHouseIds` で直接参照可能）。

---

### 4.11 Chronicle セレクター

`prototype/src/sim/selectors/chronicleSelectors.ts` に集約。**表示専用**であり simulation system からは使用しない（§3.14）。いずれも entry を時系列降順（新しい順）に並べて返す。`noUncheckedIndexedAccess` 下なので id 配列を `?? []` で受け、解決できない id を filter で除外する。

```ts
// 各 index 軸の ChronicleEntry 取得（byPerson / byHouse / byPolity / byProvince / byHolding）
function getChronicleEntriesForPerson(state: WorldState, personId: PersonId): ChronicleEntry[]
function getChronicleEntriesForHouse(state: WorldState, houseId: HouseId): ChronicleEntry[]
function getChronicleEntriesForPolity(state: WorldState, polityId: PolityId): ChronicleEntry[]
function getChronicleEntriesForProvince(state: WorldState, provinceId: ProvinceId): ChronicleEntry[]
function getChronicleEntriesForHolding(state: WorldState, holdingId: HoldingId): ChronicleEntry[]

// v0.49: chronicleIndex.byWar 経由で取得する（旧: byWar 無しで全走査）。war event の entityRef('war')
//   自動付与（§6.45 / §6.35）により byWar が成立し、全 chronicleEntries 走査を解消した。
function getChronicleEntriesForWar(state: WorldState, warId: WarId): ChronicleEntry[]
```

---


### 4.12 名前解決セレクター（nameRefSelectors, v0.41）

`prototype/src/sim/selectors/nameRefSelectors.ts` に集約。イベント emit 経路で `(category, nameKey)` を nameSource-aware に導出する純粋 helper。i18n に依存せず category 文字列と nameKey のペアを返すだけ（実際の表示文字列解決は `app/` / `i18n/` の責務）。

```ts
type SimNameRef = { category: string; nameKey: string }

// manor → {province, holding.nameKey} / city → {city, holding.nameKey} / 不在 → {province, id}
function getHoldingNameRefForEmit(state, holdingId): SimNameRef
// pool → {polity, nameKey} / holding → getHoldingNameRefForEmit / 不在 → {polity, id}
function getPolityNameRefForEmit(state, polityId): SimNameRef
function getPolityNameRefForEmitFromPolity(state, polity): SimNameRef
// category 非依存な代表 nameKey（entityRef スナップショット / debug summary / pool used-set 用）
function getPolityEmitNameKey(state, polityId): string
```

- `PolityNameSource.kind` の switch は exhaustive（将来 variant 追加時の漏れを `never` で検出）。
- `nameParam('polity', polity.nameKey)` の直接 emit はこの helper 経由にする（holding 由来 Polity は category が `province`/`city` になるため、`'polity'` 固定だと翻訳済みでも raw key 表示になる）。汎用 resolver（`getOwnerNameRefForEmit` for DecisionSubjectRef / warEvents の `actorEmitCategory` for OrganizationRef）も同様に category-aware。
- House は v0.41 では `nameKey` 維持・category 固定 `house` のため、`getHouseNameRefForEmit` は導入しない（未使用 union member を先に増やさない方針）。
- **app 層表示 helper**（`src/app/hooks/entityNameHelpers.ts`）: `getPolityShortName/QualifiedName`・`getHoldingShortName/QualifiedName`。`state` と `resolveName`（`useEntityName`）に依存し nameSource/kind 分岐を行う。`sim/ → i18n/` 禁止のため sim には置けない。
- **eventRenderer の注意点**: `resolveOwnerCategory`（`i18n/eventRenderer.ts`）は owner の name category を goal/aim の `kind` ラベル名前空間に流用する。holding 由来 Polity owner は category が `province`/`city` になるため、地名 category は `polity` に丸めて kind ラベルを解決する（owner の「種別」名前空間と name 表示 category の乖離を吸収）。

### 4.13 PersonReputation セレクター（v0.44）

`prototype/src/sim/selectors/personReputationSelectors.ts` に集約（§6.66）。

- `getCurrentPersonReputationScore(reputation, absoluteWeek, config)` — 現在値。`baseScore × personReputationMonthlyRetentionRate^(経過月)`
- `computeReputationExpiryWeek(baseScore, createdWeek, config)` — 作成時の expiryWeek 事前計算。`abs(baseScore) <= personReputationCleanupThreshold` なら `undefined`（reputation を作成しない）
- `getPersonReputationModifierForCategories(state, config, personId, categories)` — 任用補正の中核。byPerson の現在値を category filter で等価合算し ±`appointmentReputationModifierCap` に clamp。注入先係数は呼び出し側 wrapper で 1 回だけ掛ける
- `getReputationCategoriesForOfficeRole(role)` — OfficeRole → 参照 category 表（§6.66）
- `getAppointmentReputationModifier(state, config, personId, role)` — office 用薄 wrapper（× `officeReputationScoreFactor`）

`notablePersonSelectors.ts`（v0.44）— `isNotablePerson(state, personId)`: 安価な index ベースの主要人物判定（house leader / primary polity leader / active office holder）。lifeStageProgressionSystem §6.25 のインライン判定を共通化し、award 系イベントの importance 出し分けと共有する。

成果 award の本体 helper は `prototype/src/sim/helpers/awardHelpers.ts`（`applyImmediateAbilityGrowthMut` / `awardPersonReputationMut` / `awardDiplomaticPlayOutcomeMut` / `awardWarOutcomeCtx` / `getProjectExperienceWeights` / `PROJECT_REPUTATION_CATEGORY_MAP`）。

### 4.14 家系図セレクター（Family Tree）

`prototype/src/sim/selectors/familyTreeSelectors.ts`。**表示専用**の read-only 純関数で、家系図 UI（§11）が描画するグラフを構築する。locale 中立（nameKey / ID のみ返す）・決定的（memberIds から sorted 反復）。

```
buildHouseFamilyTree(state, houseId): { nodes: FamilyTreeNode[]; edges: FamilyTreeEdge[] }
```

- 対象集合 = 家門 H の `memberIds ∪ deceasedMemberIds`（**全世代**・故人含む）。
- ノードは家門 H から見た関係を持つ:
  - `blood` — H の血統（founder / 親が家内 / 起源シード）
  - `married_in` — 婚姻で H に加入した配偶者。`otherHouseId` = 出生家（親の houseId から best-effort 導出。「出生家」の明示フィールドは無い）
  - `married_out` — blood メンバーの子で別家へ移った者（**一段のみ**）。`otherHouseId` = 現在の家
- 分類は複数パスで順序非依存（A: founder/親が家内→blood、B1: blood の配偶者(live spouse)を持つ未分類→married_in、B2: 親が家内に無いが出生家が別家と判明→married_in、B3: 残り→blood）。**B2 が重要**: 配偶者の `spouseId` は死亡時に `clearSpouse` で消える（§6 mortality）ため、live spouse だけに頼ると死別した婚入配偶者が blood に誤分類される。出生家（親の houseId）からも婚入を判定して死別後も married_in を保つ。
- エッジ: `parent_child`（fatherId/motherId 両方分・ノード集合内）/ `spouse`（aId<bId 正規化 + dedupe）。spouse は live `spouseId` に加え `formerSpouseIds`（死別した元配偶者・§3）からも張るため、子の無い夫婦も死別後に結べる。B1 の married_in 判定も現・元配偶者の双方を見る。
- 世代（generation）: 親エッジを持たない blood 根を 0 とし parent_child で BFS（子=親より深い世代）。married_in は配偶者と同世代。
- 家門間リンクは **婚姻のみ**（分家 cadet・本家 parent リンクは将来拡張）。レイアウト座標は UI 側の責務（§11）。

### 4.15 共和国セレクター（republicSelectors, v0.46）

`prototype/src/sim/selectors/republicSelectors.ts`。established commonwealth（共和国・§6.68）の内部政治を扱う read-only selector 群。すべて RNG 不使用・決定的。

```ts
// 共和国判定（active && kind === 'commonwealth' && revoltState?.kind === 'established'）。
// system / selector / UI で共有する単一の判定点
function isEstablishedCommonwealthRepublic(state: WorldState, polityId: PolityId): boolean

// PolityOrigin の kind 差（popular_revolt / regime_changed_by_popular_revolt）を吸収する origin helper
function getRepublicOriginHoldingIds(origin: PolityOrigin): HoldingId[]
function getRepublicFoundingWeek(origin: PolityOrigin): number | undefined

// OfficeRole → AppliedRoleKey（admin→governance / treasurer→stewardship / military→warCommand /
// advisor→diplomacy / leader→diplomacy）。getRoleScore（house 非依存）に渡す role 適性軸
function appliedRoleKeyForOfficeRole(role: OfficeRole): AppliedRoleKey

// office seed / leader election / obtain_office target で共有する候補者列挙。
// 供給源: 現 leader / office holder / right holder とその家 member / origin leader /
// holding bailiff / houseless / recruitable outsider / landless House member。
// 基本除外（dead / placeholder / young_adulthood 未満 / 極端な悪意 / workload 過剰）。PersonId 昇順
function getRepublicPoliticalCandidatePersons(state, config, polityId): Person[]

// person が foothold（本人の office / personal right、家の right / member office）を持つ
// 共和国のみを返す（obtain_office の polity fallback 拡張用。normal polity は対象外）
function getRepublicFootholdPolityIds(state: WorldState, personId: PersonId): PolityId[]

// 用途別 scoring。getRoleScore を主軸に prestige / wealth / attitude / office 経験 /
// houseless・landless ボーナス / workload を加減算。性別ゲートは score に混ぜず選定側で適用
function scoreRepublicOfficeCandidate(state, config, personId, polityId, role): number
function scoreRepublicLeaderCandidate(state, config, personId, polityId): number

// 共和国の権力分布 read-model（保存状態を作らない。UI 表示のみ）。
// topHolder / topPercent / top3Percent / effectiveHolderCount（Herfindahl 逆数・total>0 entry のみ）/
// leader influence / office・right control by holder（count 降順 → holder key 昇順の決定的ソート）
function getRepublicPowerProfile(state, config, polityId): RepublicPowerProfile | undefined
```

### 4.16 派閥図セレクター（Faction Tree）

`prototype/src/sim/selectors/factionTreeSelectors.ts`。**表示専用**の read-only 純関数で、派閥図 UI（§11）が描画する人物ノード木を構築する。locale 中立（PersonId / FactionId のみ返す）・決定的（byParent を id 昇順反復・RNG 不使用）。家系図（§4.14）の派閥版だが、入れ子は単一親の厳密木ゆえ家系図より単純（couple / placeholder / generation 機構は無い）。

```
buildFactionTree(state, factionId): { rootFactionId, rootPersonId, nodes: FactionTreeNode[] } | null
```

- **木は `parentFactionId` 入れ子（§6.19）を辿る**。子派閥の leader は親の member には**ならない**（§6.753・モデル A）ため、membership 再帰では入れ子を辿れない。各人物ノードの親（上にぶら下がる人物）は: メンバー → 自派閥の leader、傘下 leader → 親派閥の leader（庇護者）、root leader → null。
- 入口 factionId が属する木の **root を `parentFactionId` で上方向に辿って特定**し（inactive 親で停止）、root から `byParent` を DFS して人物ノードを preorder で返す。faction / person の cycle guard 付き。
- `addFactionMembership` が単一 active membership を強制する（§6.19・§4.4）ため、各人物は木内に**一意に出現**する（重複ノード無し）。active faction / active membership のみ対象。
- ノードは `role`（leader / member）と `depth`（root leader=0）を持つ。レイアウト座標は UI 側の責務（§11・`factionTreeLayout.ts`）。

### 4.17 押領・上納拒否セレクター（v0.53）

権利と実効支配のズレ（RealEstateSeizure / LandContractDefault / PolityThreats）を扱う read-only セレクター群（§6 押領・土地契約不履行）。すべて純 sim（app/i18n 非依存）・RNG 不使用・決定的。

`prototype/src/sim/selectors/realEstateSeizureSelectors.ts` — House-owned RealEstateAsset の owner income 押領。index（`realEstateSeizureIndex`）は active entity のみ保持するため、index 経由 getter は active seizure のみ返す。

```ts
// asset 単位の active seizure（byAsset は単数値・active 最大 1）
function getActiveSeizureForAsset(state, assetId): RealEstateSeizure | undefined
// holding / rightfulOwner House 単位の active seizure 一覧
function getActiveSeizuresForHolding(state, holdingId): RealEstateSeizure[]
function getActiveSeizuresForOwnerHouse(state, houseId): RealEstateSeizure[]

// 時効までの残り（lastContestedWeek ?? startedWeek を基点・§13.2）。
//   weeks は 0 以下で時効到達、years は max(0, weeks / WEEKS_PER_YEAR)
function getSeizurePrescriptionRemainingWeeks(state, config, seizure): number
function getSeizurePrescriptionRemainingYears(state, config, seizure): number

// owner House の独立抵抗力（§8.3。seize opportunity / enforce strength gate の両方で共用）
//   = calcHouseMilitaryPower(ownerHouse)
//     + owner House が所有する各 polity の overlord 群（getPolityOverlordPolityIds）の
//       calcPolityMilitaryPower 合計（seizerPolity は除外・overlord は dedupe）。
//   polity を所有しない House は protector 0（自家戦力のみ）
function computeOwnerHouseResistance(state, config, ownerHouseId, seizerPolityId): number

// holding 内で最も脆弱な House-owned asset を選ぶ（C1: Aim scoring と Project 作成で同一 selector を共用）。
//   Phase 1 制約（§4.3）でフィルタ: owner.kind==='house' / owner House active /
//   owner House != seizer Polity の ownerHouse / 当該 asset に active seizure なし。
//   resistance 最小を選び、走査は asset id 昇順（tie-break = asset id 昇順で決定的）。
//   返り値 { asset, resistance }
function selectMostVulnerableHouseOwnedAsset(state, config, seizerPolityId, holdingId): VulnerableAssetPick | undefined
```

`prototype/src/sim/selectors/landContractDefaultSelectors.ts` — LandContract chain の上納義務不履行（tax_default / revolt_independence）。index（`landContractDefaultIndex`）は active のみ保持。

```ts
// contract 単位の active default（byContract は単数値・active 最大 1）
function getActiveDefaultForContract(state, contractId): LandContractDefault | undefined
// claimant（被害）/ occupier（加害）Polity 単位の active default 一覧
function getActiveDefaultsForClaimantPolity(state, polityId): LandContractDefault[]
function getActiveDefaultsForOccupierPolity(state, polityId): LandContractDefault[]

// 時効までの残り年数（lastContestedWeek ?? startedWeek 基点・§13.2）= max(0, weeks / WEEKS_PER_YEAR)。
//   seizure 側と異なり remaining weeks 版は private（非 export）
function getDefaultPrescriptionRemainingYears(state, config, d): number
```

`prototype/src/sim/selectors/polityThreatSelectors.ts` — Polity が受けている脅威（Pressure / 領内 Crisis）を集約する UI 用セレクター（§17.3 PolityThreats パネル）。

```ts
// この Polity が target の active Pressure。pressureIndex.byTarget（decisionSubjectKey）を
//   引いて status==='active' で filter する（index は inactive も載るため filter 必須）
function getActivePressuresForPolity(state, polityId): Pressure[]

// この Polity が実効支配する holding で進行中の active Crisis（dedup 済み）。
//   landContractIndex.byGranteePolity の各契約のうち byParent に子契約が無い（= terminal）
//   holding の crisisIndex.byHolding を走査し、status==='active' を seen Set で重複排除して返す。
//   crisis は holding 単位（owner は live 解決）のため、terminal 契約の holding で判定する
function getActiveCrisesForPolity(state, polityId): Crisis[]
```
