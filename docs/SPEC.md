# Chronicae プロトタイプ仕様書

最終更新: 2026-05-14（v0.4 時点）

---

## 1. 概要

Chronicae は、個人・家・国家が自律的に動く歴史世界を観察する歴史鑑賞シミュレーションである。

プレイヤーは特定の国家・人物・家を操作しない。世界を観察する「傍観者」または「神」に近い立場であり、必要に応じて Config による間接的な調整を行う。

### 1.1 プロトタイプの検証目的

- 自律的に動く小さな歴史世界を構築できるか
- 個人・家・国家の相互作用によって、歴史らしい変化が発生するか
- プレイヤーが直接操作しなくても、観戦対象として面白いか
- seed 付き乱数による決定的リプレイが成立するか
- UI とシミュレーションコアを分離できるか

---

## 2. 技術構成

- **フロントエンド**: React + TypeScript + Vite + Tailwind CSS
- **状態管理**: Zustand
- **シミュレーションコア**: 純粋な TypeScript モジュール（React 非依存）
- **ディレクトリ構造**:
  ```
  prototype/src/
  ├── app/        # UI 層（components, stores）
  └── sim/        # シミュレーション層（types, tick, selectors, worldgen, rng）
  ```
- **パスエイリアス**: `@sim/*` → `prototype/src/sim/*`、`@/*` → `prototype/src/*`

### 2.1 コア関数

```ts
function tick(input: TickInput): TickResult
```

- `Math.random()` 不使用。すべての乱数は seed 付き RNG 経由
- tick は純粋関数。副作用なし
- `TickContext` はイミュータブルに更新される

---

## 3. エンティティ型

### 3.1 Province（プロヴィンス）

```ts
type Province = {
  id: ProvinceId
  name: string
  x: number
  y: number
  neighbors: ProvinceId[]
  ownerHouseId: HouseId
  countryId: CountryId
  baseTax: number      // 1..10
  manpower: number     // 1..10
  unrest: number       // 0..100
  development: number  // -100..100
}
```

- `development`: 土地の荒廃・発展を表す。-100 = 完全荒廃、0 = 通常、+100 = 高度発展
- 初期値: `randomInt(rng, -10, 10)`

### 3.2 Country（国家）

```ts
type Country = {
  id: CountryId
  name: string
  rulerHouseId: HouseId
  houseIds: HouseId[]
  treasury: number      // >= 0
  legitimacy: number    // 0..100
  adminPower: number    // 0..100
  stability: number     // 0..100
  roleAssignments: Partial<Record<RoleType, PersonId>>
  active: boolean
  lastWarMonth?: number
}
```

### 3.3 House（家）

```ts
type House = {
  id: HouseId
  name: string
  active: boolean
  countryId: CountryId
  provinceIds: ProvinceId[]
  memberIds: PersonId[]
  headId: PersonId
  prestige: number          // 0..100
  cohesion: number          // 0..100
  loyaltyToCountry: number  // 0..100
  wealth: number            // >= 0
}
```

### 3.4 Person（人物）

```ts
type Person = {
  id: PersonId
  name: string
  age: number
  alive: boolean
  houseId: HouseId
  countryId: CountryId
  stats: {
    admin: number    // 0..10
    martial: number  // 0..10
  }
  traits: {
    ambition: number          // 0.0..1.0
    loyaltyToCountry: number  // 0.0..1.0
    caution: number           // 0.0..1.0
  }
  prestige: number  // 0..100
}
```

### 3.5 役職（RoleType）

`chancellor`（宰相）、`general`（将軍）、`treasurer`（財務官）の 3 種。国家ごとに 1 名ずつ任命可能。

---

## 4. Development セレクター

```ts
// development multiplier: clamp(1 + development / 100, 0, 2)
// development -100 → 0倍、0 → 1倍、+100 → 2倍
function getProvinceDevelopmentMultiplier(province: Province): number

// 実効税収: baseTax * (1 - unrest/100) * multiplier
function getEffectiveProvinceTax(province: Province): number

// 実効兵力: manpower * (1 - unrest/200) * multiplier
function getEffectiveProvinceManpower(province: Province): number
```

---

## 5. Tick システム順序

毎月 1 回 tick が実行される。以下の順序でシステムが動く：

| 順序 | システム | 頻度 |
|------|----------|------|
| 1 | advanceTime | 毎月 |
| 2 | DevelopmentSystem | 毎月 |
| 3 | EconomySystem | 毎月 |
| 4 | DisasterSystem | 毎年1月 |
| 5 | MortalitySystem | 毎月 |
| 6 | EmergenceSystem | 毎年1月 |
| 7 | SuccessionSystem | 毎月 |
| 8 | AppointmentSystem | 毎年1月 |
| 9 | AmbitionSystem | 毎月 |
| 10 | PublicSpendingSystem | 毎年1月 |
| 11 | HouseDevelopmentSystem | 毎年1月 |
| 12 | PlotSystem | 毎月 |
| 13 | WarSystem | 毎月 |
| 14 | RebellionSystem | 毎月 |
| 15 | StabilitySystem | 毎月 |
| 16 | GovernanceSystem | 毎月 |
| 17 | IntegrityCheck | 毎月 |

---

## 6. 各システムの仕様

### 6.1 DevelopmentSystem（毎月）

全 Province に対して自然減衰・回復を適用：

```
development > 0 → development = max(0, development - developmentPositiveMonthlyDecay)
development < 0 → development = min(0, development + developmentNegativeMonthlyRecovery)
結果を clamp(-100, 100)
```

### 6.2 EconomySystem（毎月）

Province ごとに実効税収を計算し分配：

```
effectiveTax = getEffectiveProvinceTax(province)
house.wealth  += effectiveTax * 0.6
country.treasury += effectiveTax * 0.4
```

### 6.3 DisasterSystem（毎年1月）

国家ごとに独立して判定。同一国に複数の災害が同時発生し得る。

| 災害 | 確率 | 効果 |
|------|------|------|
| Famine（飢饉） | `famineBaseChancePerYear` (8%) | 救済あり: development -= (famineDevastation - famineReliefDevelopmentRecovery)、unrest +5、stability -10、legitimacy +5<br>救済なし: development -= famineDevastation、unrest +15、stability -10、legitimacy -8 |
| Plague（疫病） | `plagueBaseChancePerYear` (3%) | development -= plagueDevastation、unrest +10、stability -8 |
| BountifulHarvest（豊作） | `bountifulHarvestBaseChancePerYear` (5%) | development += bountifulHarvestDevelopmentGain、unrest -5、stability +5、taxBonus |

飢饉救済判定: `country.treasury >= countryProvinceCount * disasterReliefCostPerProvince`

### 6.4 MortalitySystem（毎月）

人物の自然死亡を処理。死亡した人物が役職・家長を担っていた場合は後継処理へ。

### 6.5 EmergenceSystem（毎年1月）

家の生存メンバーが `minLivingMembersPerHouse` を下回る場合、新人物を補充（最大 `maxNewPersonsPerHousePerYear` 人/年）。

### 6.6 SuccessionSystem（毎月）

家長が死亡または存在しない場合、生存メンバーから新家長を選出。

### 6.7 AppointmentSystem（毎年1月）

国家の各役職に対して、スコアの低い担当者を `replacementThreshold` 未満で交代。

### 6.8 AmbitionSystem（毎月）

人物・家ごとに野心スコアを計算し、将来の陰謀・反乱の素地を作る。

### 6.9 PublicSpendingSystem（毎年1月）

`publicSpendingYearlyChance`（35%）で発動。monumentScore vs landDevelopmentScore を比較し実行：

**記念碑建設（MONUMENT_BUILT）**:
- 条件: monumentScore > landDevelopmentScore かつ treasury >= monumentBaseCost
- 効果: treasury -= monumentBaseCost、legitimacy +10、rulerHouse.prestige +5

**土地開発（COUNTRY_LAND_DEVELOPED）**:
- 条件: treasury >= countryLandDevelopmentBaseCost
- 対象 Province 選択スコア:
  ```
  recoveryBonus = max(0, -development) * 1.0
  highValueBonus = baseTax * 4 + manpower * 2
  rulerHouseBonus = ownerHouseId === rulerHouseId ? 15 : 0
  unrestPenalty = unrest * 0.4
  score = recoveryBonus + highValueBonus + rulerHouseBonus - unrestPenalty
  ```
- 効果: development += countryLandDevelopmentGain（clamp）、stability +2、treasury -= countryLandDevelopmentBaseCost

### 6.10 HouseDevelopmentSystem（毎年1月）

`houseDevelopmentEnabled` が true のとき動作。全 active House に対して（ID ソート順）：

- 条件: `house.wealth >= houseLandDevelopmentBaseCost + houseWealthReserve`
- 発動確率:
  ```
  chance = houseDevelopmentYearlyChance + clamp((wealth - cost - reserve) / 300, 0, 0.25)
  ```
- 対象 Province 選択スコア（自領のみ）:
  ```
  recoveryBonus = max(0, -development) * 1.0
  developmentPotentialBonus = (100 - max(0, development)) * 0.3
  highValueBonus = baseTax * 4 + manpower * 2
  unrestPenalty = unrest * 0.4
  score = recoveryBonus + developmentPotentialBonus + highValueBonus - unrestPenalty
  ```
- 効果:
  ```
  effectiveGain = houseLandDevelopmentGain * (1 - max(0, development) / 100)
  development += effectiveGain（clamp）
  house.wealth -= houseLandDevelopmentBaseCost
  ```
- イベント: HOUSE_LAND_DEVELOPED

### 6.11 PlotSystem（毎月）

野心スコアが `plotThreshold` を超えた人物が陰謀を実行。成功率 `basePlotSuccess`。

### 6.12 WarSystem（毎月）

`warEnabled` が true のとき動作。国家が他国に宣戦布告し、Province を奪取する。

- 宣戦条件: `minAttackerWinChanceToDeclare` 以上の勝率見込み、warCooldown 明け
- 荒廃効果（攻撃側勝利時）:
  - 征服 Province: development -= warConqueredProvinceDevastation
  - 境界 Province（非征服）: development -= warBorderProvinceDevastation
- 荒廃効果（攻撃側敗北時）:
  - 攻撃側の境界 Province: development -= failedWarBorderDevastation

### 6.13 RebellionSystem（毎月）

反乱傾向が `rebellionThreshold` を超えた家が反乱を起こす。

- 荒廃効果:
  - 反乱開始時: rebelProvinces に development -= rebellionStartedDevastation
  - 反乱成功時: rebelProvinces に development -= rebellionSucceededDevastation
  - 反乱失敗時: rebelProvinces に development -= rebellionFailedDevastation
- 成功時の処理（`rebellionSuccessMode` で分岐）:
  - `independence`: 反乱家が独立国を形成（国名: `{house.name}領`）
  - `ruler_change`: 反乱家が支配家に就く

### 6.14 StabilitySystem / GovernanceSystem（毎月）

各国の Stability・Legitimacy の自然回復と行政処理。

### 6.15 IntegrityCheck（毎月）

以下を検証し、違反があれば例外を投げる：

1. 死亡人物が役職を持たない
2. 活動中の家の家長が生存している
3. House.provinceIds と Province.ownerHouseId の双方向整合性
4. Province.countryId と ownerHouse.countryId の一致
5. 生存 Person.countryId と House.countryId の一致
6. Province.development が -100..100 の範囲内
7. Country.rulerHouseId が active な House を指している

---

## 7. イベント型一覧

| EventType | importance | 説明 |
|-----------|------------|------|
| ROLE_ASSIGNED | normal | 役職任命 |
| ROLE_REVOKED | normal | 役職解任 |
| PERSON_DIED | normal | 人物死亡 |
| IMPORTANT_PERSON_DIED | major | 重要人物死亡 |
| PERSON_EMERGED | minor | 新人物出現 |
| HOUSE_HEAD_CHANGED | normal | 家長交代 |
| HOUSE_EXTINCT | major | 家の断絶 |
| PLOT_STARTED | normal | 陰謀開始 |
| PLOT_SUCCEEDED | major | 陰謀成功 |
| PLOT_FAILED | normal | 陰謀失敗 |
| PLOT_CANCELLED | minor | 陰謀中断 |
| REBELLION_STARTED | critical | 反乱勃発 |
| REBELLION_SUCCEEDED | critical | 反乱成功 |
| REBELLION_FAILED | major | 反乱失敗 |
| COUNTRY_SPLIT | critical | 国家分裂 |
| RULER_HOUSE_CHANGED | critical | 支配家交代 |
| OMEN | normal | 兆し |
| FAMINE | major | 飢饉 |
| PLAGUE | major | 疫病 |
| BOUNTIFUL_HARVEST | normal | 豊作 |
| DISASTER_RELIEF_FUNDED | normal | 災害救済成功 |
| DISASTER_RELIEF_FAILED | normal | 災害救済失敗 |
| WAR_DECLARED | major | 宣戦布告 |
| WAR_WON | major | 戦争勝利 |
| WAR_LOST | major | 戦争敗北 |
| PROVINCE_CONQUERED | major | Province 征服 |
| COUNTRY_ANNEXED | critical | 国家消滅（併合） |
| MONUMENT_BUILT | major | 記念碑建設 |
| COUNTRY_LAND_DEVELOPED | normal | 国家による土地開発 |
| HOUSE_LAND_DEVELOPED | normal | 家による土地開発 |

---

## 8. SimulationConfig デフォルト値

| 項目 | デフォルト | 説明 |
|------|-----------|------|
| minLivingMembersPerHouse | 4 | 家の最低生存人数 |
| maxNewPersonsPerHousePerYear | 2 | 年間最大補充人数 |
| basePlotSuccess | 0.35 | 陰謀基本成功率 |
| rebellionThreshold | 70 | 反乱発動閾値 |
| plotThreshold | 65 | 陰謀発動閾値 |
| replacementThreshold | 15 | 役職交代閾値 |
| rebellionSuccessMode | 'independence' | 反乱成功時の処理 |
| maxRawEvents | 10000 | 全イベント保持上限 |
| maxChronicleEvents | 1000 | Chronicle イベント保持上限 |
| **War** | | |
| warEnabled | true | 戦争有効 |
| warCostPerProvince | 20 | Province あたり戦費 |
| maxProvincesPerWar | 3 | 1 戦争あたり最大征服数 |
| maxWarsPerTick | 1 | 1 tick あたり最大宣戦数 |
| warCooldownMonths | 24 | 戦争クールダウン（月） |
| minAttackerWinChanceToDeclare | 0.45 | 宣戦布告に必要な最低勝率 |
| **Disaster** | | |
| disasterEnabled | true | 災害有効 |
| famineBaseChancePerYear | 0.08 | 飢饉発生率/年 |
| plagueBaseChancePerYear | 0.03 | 疫病発生率/年 |
| bountifulHarvestBaseChancePerYear | 0.05 | 豊作発生率/年 |
| disasterReliefCostPerProvince | 20 | 救済費用/Province |
| **Public Spending** | | |
| publicSpendingEnabled | true | 公共支出有効 |
| monumentBaseCost | 120 | 記念碑建設コスト |
| publicSpendingYearlyChance | 0.35 | 公共支出年間発動確率 |
| **Development** | | |
| developmentPositiveMonthlyDecay | 0.1 | 正 development の月次減衰 |
| developmentNegativeMonthlyRecovery | 0.25 | 負 development の月次回復 |
| warConqueredProvinceDevastation | 8 | 征服 Province への荒廃 |
| warBorderProvinceDevastation | 3 | 境界 Province への荒廃（戦争勝利時） |
| failedWarBorderDevastation | 3 | 境界 Province への荒廃（戦争敗北時） |
| rebellionStartedDevastation | 2 | 反乱開始時の荒廃 |
| rebellionSucceededDevastation | 3 | 反乱成功時の荒廃 |
| rebellionFailedDevastation | 5 | 反乱失敗時の荒廃 |
| famineDevastation | 5 | 飢饉による荒廃 |
| famineReliefDevelopmentRecovery | 2 | 飢饉救済による荒廃軽減 |
| plagueDevastation | 8 | 疫病による荒廃 |
| bountifulHarvestDevelopmentGain | 3 | 豊作による development 上昇 |
| countryLandDevelopmentBaseCost | 70 | 国家土地開発コスト |
| countryLandDevelopmentGain | 8 | 国家土地開発による development 上昇 |
| houseDevelopmentEnabled | true | 家の土地開発有効 |
| houseDevelopmentYearlyChance | 0.25 | 家の土地開発年間基本確率 |
| houseLandDevelopmentBaseCost | 40 | 家の土地開発コスト |
| houseLandDevelopmentGain | 6 | 家の土地開発による development 上昇（基本値） |
| houseWealthReserve | 50 | 家が開発前に確保する wealth 予備 |

---

## 9. UI 構成

- **MapPanel**: Province を SVG で描画。クリックで Province 選択
- **Sidebar**: 人物一覧。重要度スコア順。ウォッチリスト対応
- **DetailPanel**: 選択エンティティ（Province / Country / House / Person）の詳細表示
  - ProvinceDetail: development / Eff.Tax / Eff.Manpower を表示
- **EventLog**: Chronicle（major/critical）と全イベントの 2 ビュー
- **ConfigPanel**: シミュレーションパラメータをリアルタイム調整

---

## 10. 今後の課題（未実装）

- **一強状態への対策**: 大国ペナルティ、継承問題、外部新興勢力など
- **POP システム**: 社会階層・文化・宗教・支持対象
- **詳細な戦争**: War エンティティ、戦場、包囲戦
- **記念碑エンティティ化**: 建設場所、継続効果、破壊
- **施設システム**: 城塞・道路・港・市場
- **詳細外交**: 同盟・条約・婚姻
- **血縁・婚姻関係**: 継承権・請求権
