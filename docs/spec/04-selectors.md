# 4. セレクター

### 4.1 Development セレクター

```ts
// development multiplier: clamp(1 + development / 100, 0, 2)
// development -100 → 0倍、0 → 1倍、+100 → 2倍
function getProvinceDevelopmentMultiplier(development: number): number

// v0.20: Province の development は Holding の weight 加重平均
function getProvinceDevelopmentFromHoldings(state: WorldState, provinceId: ProvinceId): number
```

`getEffectiveProvinceTax` / `getEffectiveProvinceManpower` は v0.8 で廃止。代わりに POP Economy セレクターを使用する。

### 4.2 POP セレクター（v0.24 更新）

#### Holding POP セレクター

```ts
// Holding の全 PopGroup を返す（popIndex.byHolding 経由）
function getHoldingPops(state: WorldState, holdingId: HoldingId): PopGroup[]

function getHoldingPopsByClass(state: WorldState, holdingId: HoldingId, popClass: PopClass): PopGroup[]

function getHoldingPopsByClassAndOccupation(state: WorldState, holdingId: HoldingId, popClass: PopClass, occupation: PopOccupation): PopGroup[]

function getHoldingPopSizeByClass(state: WorldState, holdingId: HoldingId, popClass: PopClass): number

function getHoldingPopSizeByClassAndOccupation(state: WorldState, holdingId: HoldingId, popClass: PopClass, occupation: PopOccupation): number
```

#### Occupation capacity セレクター

```ts
// Holding の職業キャパシティ: baseCapacity * weight * landQuality * devMod
// occupation === 'none' の場合は 0 を返す
function getHoldingOccupationCapacity(state: WorldState, config: SimulationConfig, holdingId: HoldingId, popClass: PopClass, occupation: PopOccupation): number

// 残容量: capacity - used
function getHoldingOccupationRemainingCapacity(state: WorldState, config: SimulationConfig, holdingId: HoldingId, popClass: PopClass, occupation: PopOccupation): number

// 労働力不足 = remainingCapacity
function getHoldingLaborShortage(state: WorldState, config: SimulationConfig, holdingId: HoldingId, popClass: PopClass, occupation: PopOccupation): number

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

// v0.24: carrying capacity = Province 内全 Holding の全職業キャパシティ合計
// 旧来の habitability × populationCapacityPerHabitability ベースの算出は廃止
function getProvinceCarryingCapacity(state: WorldState, config: SimulationConfig, provinceId: ProvinceId): number

// population pressure: clamp(population / carryingCapacity, 0, 2)
function getProvincePopulationPressure(state: WorldState, config: SimulationConfig, provinceId: ProvinceId): number

// class 別の unrest（Province 内の該当 class POP の人口加重平均）
function getPopUnrestByClass(state: WorldState, provinceId: ProvinceId, popClass: PopClass): number

// class 別の wealth（Province 内の該当 class POP の人口加重平均）
function getPopWealthByClass(state: WorldState, provinceId: ProvinceId, popClass: PopClass): number
```

### 4.3 POP Economy セレクター（v0.24 更新）

```ts
// POP 1件の生産量（v0.24: occupation multiplier 追加、Holding 単位 dev/control）
// pop.size * productivityByClass[pop.class] * occupationProductivityMultiplier[pop.occupation]
//   * (pop.wealth / 100) * holdingDevelopmentModifier * holdingControlModifier
function getPopProduction(state: WorldState, config: SimulationConfig, popId: PopGroupId): number

// Province の総生産量（全 Holding POP の生産量合計）
function getProvinceProduction(state: WorldState, config: SimulationConfig, provinceId: ProvinceId): number

// Province の税基盤: getProvinceProduction * (polityControl / 100)
function getProvinceTaxBase(state: WorldState, config: SimulationConfig, provinceId: ProvinceId): number

// Polity 用の Province 兵力基盤（v0.24: occupation manpower multiplier 追加）
// sum(pop.size * manpowerFactorByClass[pop.class] * occupationManpowerMultiplier[pop.occupation] * (polityControl / 100))
function getProvinceCountryManpowerBase(state: WorldState, config: SimulationConfig, provinceId: ProvinceId): number

// House 用の Province 兵力基盤 (v0.16): polityManpowerBase と同等 (houseControl は廃止)
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

### 4.5 Status セレクター（v0.11 / v0.15）

v0.11 で legitimacy / stability / prestige / cohesion / loyaltyToPolity が格納フィールドから動的計算セレクターに移行した。v0.15 で Country → Polity rename。

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
//   0.30*adminEffectiveStat*10 + 0.20*treasurerEffectiveStat*10 + 0.20*stability + 0.20*rulerPrestige + 0.10*treasuryScore
//   各 stat は getEffectiveOfficeStat（役職担当者の能力・人数・協調ペナルティを考慮）
function getPolityAdminPower(state: WorldState, config: SimulationConfig, polityId: PolityId): number
```

**attitudeValueToScore の変換**:
- affection / respect の値 (-100..100) → score (0..100)
- 0 → 50、正 → 50+、負 → 50- の線形変換

### 4.6 Office / Share セレクター（v0.12 / v0.15）

```ts
// 指定組織・役職のアクティブ担当者 ID 一覧
function getActiveOfficeHolders(state: WorldState, org: OrganizationRef, role: OfficeRole): PersonId[]

// Polity の指導者（polity:leader Office holder）
function getPolityLeader(state: WorldState, polityId: PolityId): PersonId | undefined

// Polity の指導者の所属家
function getPolityLeaderHouse(state: WorldState, polityId: PolityId): HouseId | undefined

// 家の家長（house:leader のホルダー）
function getHouseLeader(state: WorldState, houseId: HouseId): PersonId | undefined

// 指定組織で rawPower が最も多い House（Dominant House）
function getDominantPolityHouse(state: WorldState, polityId: PolityId): HouseId | undefined

// 指定組織の上位株主一覧（holder・rawPower・percent）
function getTopShareholders(state: WorldState, org: OrganizationRef, limit?: number): Array<{ holder: ShareHolderRef; rawPower: number; percent: number }>

// House が Polity に持つ Share 割合（%）
function getHousePolitySharePercent(state: WorldState, polityId: PolityId, houseId: HouseId): number

// Person が House に持つ Share 割合（%）
function getPersonHouseSharePercent(state: WorldState, houseId: HouseId, personId: PersonId): number

// 行政キャパシティ: basePolityInstitutionalCapacity + ruler*factor + administrator*factor + treasurer*factor
function getAdministrativeCapacity(state: WorldState, config: SimulationConfig, polityId: PolityId): number

// 行政負荷: Province数 * adminLoadPerProvince + officeCount * adminLoadPerPolityOffice
function getAdministrativeLoad(state: WorldState, config: SimulationConfig, polityId: PolityId): number

// 行政効率: clamp(capacity / load, minAdministrativeEfficiency, maxAdministrativeEfficiency)
function getAdministrativeEfficiency(state: WorldState, config: SimulationConfig, polityId: PolityId): number
```

### 4.6b Polity 関係 selector（v0.15）

House / Person が Polity に所属しない設計（§3.3 参照）のため、関係取得は `prototype/src/sim/selectors/polityRelations.ts` の selector に集約する。

```ts
// Province → Polity / House
function getProvincePolity(state: WorldState, provinceId: ProvinceId): Polity | undefined
function getProvinceOwnerHouse(state: WorldState, provinceId: ProvinceId): House | undefined

// Polity 内 Province / House / Person
function getPolityProvinceIds(state: WorldState, polityId: PolityId): ProvinceId[]
function getPolityHouseIds(state: WorldState, polityId: PolityId): HouseId[]
// ↑ Polity 内に Province を 1 つ以上所有する active House の集合
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

### 4.6c LandContract / HoldingOffice selector（v0.16 / v0.20）

`prototype/src/sim/selectors/landContractSelectors.ts` および `provinceOfficeSelectors.ts` に集約。

```ts
// LandContract chain — Province ベース (legacy)
function getProvinceLandContractChain(state, provinceId): LandContract[]  // root → terminal
function getProvinceRootContract(state, provinceId): LandContract | undefined
function getProvinceTerminalContract(state, provinceId): LandContract | undefined
function getProvinceTerminalPolityId(state, provinceId): PolityId | undefined
function getProvinceOverlordPolityIds(state, provinceId): PolityId[]
function getProvinceEffectiveOwnerHouseId(state, provinceId): HouseId | undefined

// LandContract chain — Holding ベース (v0.20 正規)
function getHoldingLandContractChain(state, holdingId): LandContract[]  // root → terminal
function getHoldingTerminalPolityId(state, holdingId): PolityId | undefined

// Holding selector (v0.20)
function getProvinceHoldings(state, provinceId): Holding[]
function getProvinceDevelopmentFromHoldings(state, provinceId): number     // weight 加重平均
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

// system house / placeholder Person 判定
function isPlaceholderPerson(state, personId): boolean
function getAnonymousHouseId(): HouseId
function isSystemHouse(state, houseId): boolean

// HoldingOffice / Bailiff (v0.20: Province → Holding に移行)
function getHoldingBailiffPerson(state, holdingId): Person | undefined
```

### 4.7 Ability / 派生 selector（v0.14）

`prototype/src/sim/selectors/abilitySelectors.ts` に集約。

```ts
export type AppliedRoleKey =
  | 'governance'
  | 'stewardship'
  | 'diplomacy'
  | 'intrigue'
  | 'warCommand'

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
```

* 既存システム（successionSelectors / personAbilityEffects / militarySelectors / officeSelectors / publicSpendingSystem / plotSystem 等）は `getRoleScore(state, p.id, role) / 10` で正規化して旧 admin/martial（0..10）相当のスケールに揃える
* 通常範囲は 0..10、限界突破帯（v0.15 以降の機構）では最大 12

### 4.8 Task / Goal セレクター（v0.23）

```ts
// Person Goal の currentFulfillment（baseFulfillment + 現在状況 modifier、0..100）
function getPersonGoalFulfillment(state: WorldState, personId: PersonId): number

// Person の週あたり行動力（base 2.0 + ambition bonus - age penalty）
function getPersonWeeklyActionCapacity(state: WorldState, config: SimulationConfig, personId: PersonId): number

// Aim / ActivityLog ベースの任官補正値
function getAppointmentTaskModifier(
  state: WorldState, config: SimulationConfig,
  personId: PersonId, organization: PoliticalActorRef, role: OfficeRole
): number

// Task の effectivePriority（ownerDutyBonus + goalAlignmentBonus + urgencyBonus + taskKindPriorityBonus - overloadPenalty）
function computeEffectivePriority(state: WorldState, config: SimulationConfig, task: Task): number
```

### 4.9 代官 selector（v0.25）

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

---

