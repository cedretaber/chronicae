# Chronicae プロトタイプ仕様書

最終更新: 2026-05-14（v0.6 時点）

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
  ├── cli/        # CLI モード（headless 実行）
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

### 2.2 CLI モード

ブラウザなしでシミュレーションを headless 実行できる。

```bash
cd prototype
npm run cli -- --seed <seed> --years <n> [--integrity-check] [--json]
```

コーディングエージェントがバグ検出・動作確認に利用することを想定している。

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
  baseTax: number        // 1..10
  manpower: number       // 1..10
  unrest: number         // 0..100
  development: number    // -100..100
  countryControl: number // 0..100
  houseControl: number   // 0..100
}
```

- `development`: 土地の荒廃・発展。-100 = 完全荒廃、0 = 通常、+100 = 高度発展
- `countryControl`: 国家による実効支配力
- `houseControl`: 領主 House による実効支配力
- 名目所有（`countryId` / `ownerHouseId`）は支配力が 0 になっても変わらない

### 3.2 Country（国家）

```ts
type Country = {
  id: CountryId
  name: string
  rulerHouseId: HouseId
  houseIds: HouseId[]
  treasury: number           // >= 0
  legitimacy: number         // 0..100
  adminPower: number         // 0..100
  stability: number          // 0..100
  roleAssignments: Partial<Record<RoleType, PersonId>>
  active: boolean
  lastWarMonth?: number
  capitalProvinceId: ProvinceId
}
```

- `capitalProvinceId`: 国家支配力の中心。その Country に属する Province でなければならない

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
  prestige: number           // 0..100
  cohesion: number           // 0..100
  loyaltyToCountry: number   // 0..100
  wealth: number             // >= 0
  seatProvinceId: ProvinceId
}
```

- `seatProvinceId`: 家支配力の中心。その House が所有する Province でなければならない
- House は常に本拠地を保持する（v0.5 では本拠地移転・喪失は扱わない）

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

## 4. セレクター

### 4.1 Development セレクター

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
| 3 | ControlSystem | 毎月 |
| 4 | LordshipTransitionSystem | 毎月 |
| 5 | EconomySystem | 毎月 |
| 6 | DisasterSystem | 毎年1月 |
| 7 | MortalitySystem | 毎月 |
| 8 | EmergenceSystem | 毎年1月 |
| 9 | SuccessionSystem | 毎月 |
| 10 | AppointmentSystem | 毎年1月 |
| 11 | AmbitionSystem | 毎月 |
| 12 | PublicSpendingSystem | 毎年1月 |
| 13 | HouseDevelopmentSystem | 毎年1月 |
| 14 | PlotSystem | 毎月 |
| 15 | WarSystem | 毎月 |
| 16 | RebellionSystem | 毎月 |
| 17 | StabilitySystem | 毎月 |
| 18 | GovernanceSystem | 毎月 |
| 19 | IntegrityCheck | 毎月 |

順序の理由：DevelopmentSystem → ControlSystem の順で development 変化を支配力計算に反映し、LordshipTransition 後の ownerHouseId に基づいて EconomySystem が収入を計算する。

---

## 6. 各システムの仕様

### 6.1 DevelopmentSystem（毎月）

全 Province に対して自然減衰・回復を適用：

```
development > 0 → development = max(0, development - developmentPositiveMonthlyDecay)
development < 0 → development = min(0, development + developmentNegativeMonthlyRecovery)
結果を clamp(-100, 100)
```

### 6.2 ControlSystem（毎月）

Country ごとに首都から BFS、House ごとに本拠地から BFS を行い、各 Province の支配力を更新する。

**支配力上限（二段階 clamp）**:

```ts
// 距離ベースの上限
baseMaxControl = clamp(100 - distance * controlMaxDistancePenalty, controlMaxMinimum, 100)
// 能力補正後の上限（能力最低床を別途設定）
maxControl = clamp(baseMaxControl + maxControlBonus, controlAbilityMinimumFloor, 100)
// 首都 / 本拠地は常に上限 100
```

`maxControlBonus` は宰相（countryControl）・家長（houseControl）の admin stat から算出される（§14 参照）。

**到達可能な Province**:

```ts
if (control < maxControl) control = Math.min(control + effectiveGrowth, maxControl)
if (control > maxControl) control = Math.max(control - controlDecayPerMonth, maxControl)
```

`effectiveGrowth = controlGrowthPerMonth * growthModifier`（宰相・家長の admin stat による）。

**到達不能な Province**（飛び地など）:

```ts
control = Math.max(0, control - disconnectedControlDecayPerMonth)
```

BFS 通行条件:
- countryControl: 首都から同一 Country の Province のみ通行可
- houseControl: 本拠地から同一 Country の Province（他 House 領も通行可）。更新対象はその House の Province のみ

### 6.3 LordshipTransitionSystem（毎月）

隣接する強力な領主による Province 吸収を処理する。スナップショットパターンで実装（連鎖防止）。

**target の条件**:
- `target.houseControl < lordshipAbsorptionTargetThreshold`
- `target.id !== ownerHouse.seatProvinceId`

**neighbor 候補の条件**:
- `neighbor.countryId === target.countryId`
- `neighbor.ownerHouseId !== target.ownerHouseId`
- `neighbor.houseControl >= lordshipAbsorptionSourceMinimum`
- `neighbor.houseControl >= target.houseControl * lordshipAbsorptionRatio`

最高 houseControl の neighbor を採用（同値はランダム）。確率 `lordshipAbsorptionMonthlyChance` で発動。

**効果**:
```
target.ownerHouseId = neighbor.ownerHouseId
target.houseControl = clamp(neighbor.houseControl - penalty, newControlMin, newControlMax)
```

イベント: `LORDSHIP_TRANSFERRED`（importance: `minor`）
```
summary: "${新House.name} absorbed ${province.name} from ${旧House.name}."
```

### 6.4 EconomySystem（毎月）

Province ごとに支配力に基づいて収入を分配する。支配力不足により収入ロスが発生する。

```ts
const provinceIncome = getEffectiveProvinceTax(province)
const cc = province.countryControl / 100
const hc = province.houseControl / 100
const totalControl = cc + hc

if (totalControl <= 0) continue  // 収入なし

const countryIncome = provinceIncome * (cc / totalControl) * cc
const houseIncome   = provinceIncome * (hc / totalControl) * hc
```

国庫への収入には財務官の能力補正（`taxEfficiency`）が乗算される（§14 参照）。家収入への補正はない。

例（Province 収入 100 の場合）:
| countryControl | houseControl | 国収入（taxEfficiency=1） | 家収入 | ロス |
|---|---|---|---|---|
| 100 | 100 | 50 | 50 | 0 |
| 100 | 50 | 66.7 | 16.7 | 16.6 |
| 50 | 50 | 25 | 25 | 50 |
| 100 | 0 | 100 | 0 | 0 |

### 6.5 DisasterSystem（毎年1月）

国家ごとに独立して判定。同一国に複数の災害が同時発生し得る。

| 災害 | 確率 | 効果 |
|------|------|------|
| Famine（飢饉） | `famineBaseChancePerYear` (8%) | 救済あり: dev -= (devastation - relief)、unrest +5、stability -10、legitimacy +5<br>救済なし: dev -= devastation、unrest +15、stability -10、legitimacy -8 |
| Plague（疫病） | `plagueBaseChancePerYear` (3%) | dev -= plagueDevastation、unrest +10、stability -8 |
| BountifulHarvest（豊作） | `bountifulHarvestBaseChancePerYear` (5%) | dev += gain、unrest -5、stability +5 |

飢饉救済判定: `country.treasury >= countryProvinceCount * disasterReliefCostPerProvince`

### 6.6 MortalitySystem（毎月）

人物の自然死亡を処理。死亡した人物が役職・家長を担っていた場合は後継処理へ。

### 6.7 EmergenceSystem（毎年1月）

家の生存メンバーが `minLivingMembersPerHouse` を下回る場合、新人物を補充（最大 `maxNewPersonsPerHousePerYear` 人/年）。

### 6.8 SuccessionSystem（毎月）

家長が死亡または存在しない場合、生存メンバーから新家長を選出。

### 6.9 AppointmentSystem（毎年1月）

国家の各役職に対して、スコアの低い担当者を `replacementThreshold` 未満で交代。

### 6.10 AmbitionSystem（毎月）

人物・家ごとに野心スコアを計算し、将来の陰謀・反乱の素地を作る。

### 6.11 PublicSpendingSystem（毎年1月）

`publicSpendingYearlyChance`（35%）で発動。monumentScore vs landDevelopmentScore を比較し実行：

スコア計算に宰相の ability 補正が加算される（§14 参照）:
```
monumentScore      += chancellorAmbitionMonumentScoreBonus + chancellorCautionMonumentScoreBonus
landDevelopmentScore += chancellorCautionLandDevelopmentScoreBonus + chancellorAmbitionLandDevelopmentScoreBonus
```

**記念碑建設（MONUMENT_BUILT）**:
- 条件: monumentScore > landDevelopmentScore かつ treasury >= monumentBaseCost
- 対象 Province: 首都から接続済み、countryControl < 100 の中から以下スコアで選択:
  ```
  score = (100 - countryControl) * 1.0 + development * 0.5 - unrest * 0.5
  ```
- 効果: treasury -= monumentBaseCost、**countryControl += monumentCountryControlGain**、legitimacy += monumentLegitimacyGain、rulerHouse.prestige += 2

**国家土地開発（COUNTRY_LAND_DEVELOPED）**:
- 条件: treasury >= effectiveCost（財務官 admin による割引あり）
- 効果: development += gain（clamp）、**houseControl += landDevelopmentHouseControlGain**、**unrest -= landDevelopmentUnrestReduction**、stability +2、treasury -= effectiveCost

### 6.12 HouseDevelopmentSystem（毎年1月）

`houseDevelopmentEnabled` が true のとき動作。全 active House に対して：

- 条件: `house.wealth >= houseLandDevelopmentBaseCost + houseWealthReserve`
- 発動確率:
  ```
  chance = clamp(houseDevelopmentYearlyChance + wealthBonus + abilityChanceBonus, 0, 1)
  wealthBonus      = clamp((wealth - cost - reserve) / 300, 0, 0.25)
  abilityChanceBonus = 家長 admin / caution による補正（§14 参照）
  ```
- 効果:
  ```
  effectiveGain = houseLandDevelopmentGain * (1 - max(0, development) / 100)
  development += effectiveGain（clamp）
  houseControl += landDevelopmentHouseControlGain（clamp）
  unrest -= landDevelopmentUnrestReduction（clamp）
  house.wealth -= houseLandDevelopmentBaseCost
  ```
- イベント: `HOUSE_LAND_DEVELOPED`

### 6.13 PlotSystem（毎月）

野心スコアが `plotThreshold` を超えた人物が陰謀を実行。成功率 `basePlotSuccess`。

### 6.14 WarSystem（毎月）

`warEnabled` が true のとき動作。国家が他国に宣戦布告し、Province を奪取する。

- 宣戦条件: `effectiveMinWinChanceToDeclare`（将軍の ambition/caution で変動、§14 参照）以上の勝率見込み、warCooldown 明け
- 軍事力: `baseMilitaryPower * warPowerModifier`（将軍 martial stat による、§14 参照）
- **本拠地保護**: `seatProvinceId` の Province は征服対象から除外する
- 征服後、defender の非 seat Province がすべてなくなった場合（seat のみ残存）に `annexCountry` を呼び出す
- 荒廃効果（攻撃側勝利時）:
  - 征服 Province: development -= warConqueredProvinceDevastation
  - 境界 Province（非征服）: development -= warBorderProvinceDevastation
- 荒廃効果（攻撃側敗北時）:
  - 攻撃側の境界 Province: development -= failedWarBorderDevastation

**annexCountry mutation**:

```
1. defeatedCountry の全 Province.countryId を winnerCountry に変更
2. defeatedCountry の全 House.countryId / Person.countryId を winnerCountry に変更
3. defeatedCountry.rulerHouse は seatProvinceId 以外の Province を失う
4. 非 rulerHouse の ownerHouseId は維持
5. rulerHouse から取り上げた Province は winnerCountry.rulerHouse に割り当て
6. 全 Province の countryControl = annexedCountryControl（35）
7. 非 rulerHouse 領の houseControl は維持
8. winnerCountry.rulerHouse に新規割当された Province の houseControl = newRulerHouseControl（35）
9. defeatedCountry.active = false
```

### 6.15 RebellionSystem（毎月）

反乱傾向が `rebellionThreshold` を超えた家が反乱を起こす。

- 荒廃効果:
  - 反乱開始時: rebelProvinces に development -= rebellionStartedDevastation
  - 反乱成功時: rebelProvinces に development -= rebellionSucceededDevastation
  - 反乱失敗時: rebelProvinces に development -= rebellionFailedDevastation
- 成功時の処理（`rebellionSuccessMode` で分岐）:
  - `independence`: 反乱家が独立国を形成（国名: `{house.name}領`）
  - `ruler_change`: 反乱家が支配家に就く

### 6.16 StabilitySystem / GovernanceSystem（毎月）

各国の Stability・Legitimacy の自然回復と行政処理。

### 6.17 IntegrityCheck（毎月）

以下を検証し、違反があれば例外を投げる：

1. 死亡人物が役職を持たない
2. 活動中の家の家長が生存している
3. House.provinceIds と Province.ownerHouseId の双方向整合性
4. Province.countryId と ownerHouse.countryId の一致
5. 生存 Person.countryId と House.countryId の一致
6. Province.development が -100..100 の範囲内
7. Country.rulerHouseId が active な House を指している
8. Country.capitalProvinceId がその Country に属する Province を指している
9. House.seatProvinceId がその House の provinceIds に含まれている
10. Province.countryControl が 0..100 の範囲内
11. Province.houseControl が 0..100 の範囲内

---

## 7. Worldgen 初期化

### 7.1 seatProvinceId の決定

各 House の本拠地は、その House が所有する Province のうち `development` が最も高いもの。同値は Province ID 昇順。

### 7.2 capitalProvinceId の決定

各 Country の首都は、支配家（rulerHouse）の `seatProvinceId`。

### 7.3 countryControl / houseControl の初期値

ControlSystem と同じ距離上限計算で初期化する。

```
countryControl = maxControl(capitalProvinceId からの BFS 距離)
houseControl   = maxControl(seatProvinceId からの BFS 距離)
```

接続不能な Province: `countryControl = 30`、`houseControl = 30`

### 7.4 エンティティ名称の生成

Country / House / Province / Person の `name` は、`sim/worldgen/namePool.ts` に定義された名前プールから seed 付き RNG で選択する。

- Country・House・Province: `pickUniqueName` による重複回避。プール不足時は `Country-N` / `House-N` / `Province-N` にフォールバック
- Person（worldgen 初期生成・EmergenceSystem による補充ともに）: `pickName` による重複あり選択（中世欧州風に同名人物が複数存在し得る）

---

## 8. イベント型一覧

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
| LORDSHIP_TRANSFERRED | minor | 隣接吸収による領主交代 |

---

## 9. SimulationConfig デフォルト値

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
| **Control System** | | |
| controlMaxDistancePenalty | 10 | 距離 1 あたりの支配力上限ペナルティ |
| controlMaxMinimum | 40 | 支配力上限の最低値 |
| controlGrowthPerMonth | 2 | 支配力月次増加量 |
| controlDecayPerMonth | 1 | 支配力月次減少量（上限超過時） |
| disconnectedControlDecayPerMonth | 5 | 接続不能 Province の月次減衰量 |
| **Monument** | | |
| monumentCountryControlGain | 10 | 記念碑による countryControl 上昇量 |
| monumentLegitimacyGain | 5 | 記念碑による legitimacy 上昇量 |
| **Land Development** | | |
| landDevelopmentHouseControlGain | 5 | 土地開発による houseControl 上昇量 |
| landDevelopmentUnrestReduction | 1 | 土地開発による unrest 低下量 |
| **Person Ability Effects（v0.6）** | | |
| personAbilityEffectsEnabled | true | 人物能力効果の有効/無効 |
| chancellorAdminControlGrowthEffect | 0.25 | 宰相 admin による支配力成長補正係数 |
| chancellorAdminControlMaxBonusPerAdmin | 1 | 宰相 admin 1 点あたりの支配力上限ボーナス |
| houseHeadAdminControlGrowthEffect | 0.25 | 家長 admin による家支配力成長補正係数 |
| houseHeadAdminControlMaxBonusPerAdmin | 1 | 家長 admin 1 点あたりの家支配力上限ボーナス |
| controlAbilityMinimumFloor | 35 | 能力補正後の支配力上限最低値 |
| treasurerAdminTaxEfficiencyEffect | 0.15 | 財務官 admin による税収効率補正係数 |
| treasurerCautionTaxEfficiencyEffect | 0.10 | 財務官 caution による税収効率補正係数 |
| treasurerTaxEfficiencyMin | 0.8 | 税収効率の最小値 |
| treasurerTaxEfficiencyMax | 1.2 | 税収効率の最大値 |
| treasurerAdminDevelopmentCostEffect | 0.10 | 財務官 admin による開発コスト削減係数 |
| generalMartialWarPowerEffect | 0.15 | 将軍 martial による戦闘力補正係数 |
| generalAmbitionDeclareThresholdEffect | 0.10 | 将軍 ambition による宣戦閾値変動係数 |
| generalCautionDeclareThresholdEffect | 0.10 | 将軍 caution による宣戦閾値変動係数 |
| minWarDeclareThreshold | 0.30 | 宣戦閾値の下限 |
| maxWarDeclareThreshold | 0.75 | 宣戦閾値の上限 |
| chancellorAmbitionMonumentScoreEffect | 20 | 宰相 ambition による monumentScore 補正係数 |
| chancellorCautionMonumentScoreEffect | 10 | 宰相 caution による monumentScore 補正係数（低 caution が正に働く） |
| chancellorAmbitionLandDevelopmentScoreEffect | 10 | 宰相 ambition による landDevelopmentScore 補正係数（低 ambition が正に働く） |
| chancellorCautionLandDevelopmentScoreEffect | 20 | 宰相 caution による landDevelopmentScore 補正係数 |
| houseHeadAdminDevelopmentChanceEffect | 0.10 | 家長 admin による開発確率補正係数 |
| houseHeadCautionDevelopmentChanceEffect | 0.10 | 家長 caution による開発確率補正係数 |
| **Lordship Transition** | | |
| lordshipAbsorptionTargetThreshold | 50 | 吸収対象となる houseControl の上限 |
| lordshipAbsorptionSourceMinimum | 60 | 吸収源となるための最低 houseControl |
| lordshipAbsorptionRatio | 2 | 吸収源 houseControl が対象の何倍必要か |
| lordshipAbsorptionMonthlyChance | 0.05 | 月次吸収発動確率 |
| lordshipAbsorptionNewControlMin | 50 | 吸収後 houseControl の下限 |
| lordshipAbsorptionNewControlMax | 70 | 吸収後 houseControl の上限 |
| lordshipAbsorptionNewControlPenalty | 10 | 吸収後 houseControl のペナルティ |
| **Annexation** | | |
| annexedCountryControl | 35 | 併合後の Province countryControl |
| newRulerHouseControl | 35 | 征服国 rulerHouse に割当られた Province の houseControl |

---

## 10. 人物能力効果（v0.6）

`personAbilityEffectsEnabled` が false の場合、全関数は中立値（倍率 1.0、ボーナス 0）を返す。

### 10.1 正規化関数

```ts
normalizedStat(value: number): number   // (value - 5) / 5  → -1.0 (stat=0) .. 0 (stat=5) .. +1.0 (stat=10)
normalizedTrait(value: number): number  // value - 0.5      → -0.5 (trait=0.0) .. 0 (trait=0.5) .. +0.5 (trait=1.0)
```

### 10.2 Trait の解釈（価値中立な軸）

| Trait | 低値（0.0側） | 高値（1.0側） |
|---|---|---|
| ambition | 忠実・現状維持 | 野心的・栄光志向 |
| caution | 大胆・即断 | 慎重・堅実 |

どちらの極も状況によって有利・不利が生じる。

### 10.3 ControlSystem への効果

**宰相（chancellor）→ countryControl**:
```ts
growthModifier = 1 + normalizedStat(admin) * chancellorAdminControlGrowthEffect
maxControlBonus = normalizedStat(admin) * chancellorAdminControlMaxBonusPerAdmin * 10
```

**家長（house head）→ houseControl**:
```ts
growthModifier = 1 + normalizedStat(admin) * houseHeadAdminControlGrowthEffect
maxControlBonus = normalizedStat(admin) * houseHeadAdminControlMaxBonusPerAdmin * 10
```

支配力上限は二段階 clamp:
```ts
baseMaxControl = clamp(100 - distance * controlMaxDistancePenalty, controlMaxMinimum, 100)
maxControl     = clamp(baseMaxControl + maxControlBonus, controlAbilityMinimumFloor, 100)
// 首都 / 本拠地は 100 固定
```

### 10.4 EconomySystem への効果

**財務官（treasurer）→ 国庫税収効率**:
```ts
taxEfficiency = clamp(
  1 + normalizedStat(admin) * treasurerAdminTaxEfficiencyEffect
    + normalizedTrait(caution) * treasurerCautionTaxEfficiencyEffect,
  treasurerTaxEfficiencyMin,
  treasurerTaxEfficiencyMax,
)
// 国庫収入 *= taxEfficiency。家収入への影響なし
```

**財務官（treasurer）→ 国家土地開発コスト**:
```ts
costModifier = 1 - normalizedStat(admin) * treasurerAdminDevelopmentCostEffect
effectiveCost = max(1, round(countryLandDevelopmentBaseCost * costModifier))
```

### 10.5 WarSystem への効果

**将軍（general）→ 戦闘力**:
```ts
warPowerModifier = 1 + normalizedStat(martial) * generalMartialWarPowerEffect
// 攻撃側・防衛側それぞれ独立して適用
```

**将軍（general）→ 宣戦閾値**:
```ts
// ambition 高（野心的）→ 閾値を下げる（積極的に開戦）
// caution 高（慎重）→ 閾値を上げる（消極的）
effectiveThreshold = clamp(
  minAttackerWinChanceToDeclare
    - normalizedTrait(ambition) * generalAmbitionDeclareThresholdEffect
    + normalizedTrait(caution)  * generalCautionDeclareThresholdEffect,
  minWarDeclareThreshold,
  maxWarDeclareThreshold,
)
```

### 10.6 PublicSpendingSystem への効果

**宰相（chancellor）→ スコア補正**:
```ts
// ambition 高 → monumentScore 上昇（栄光志向）
// caution 低（大胆）→ monumentScore 上昇（果断な建設）
monumentScoreBonus = normalizedTrait(ambition) * chancellorAmbitionMonumentScoreEffect
                   - normalizedTrait(caution)  * chancellorCautionMonumentScoreEffect

// caution 高 → landDevelopmentScore 上昇（堅実な内政）
// ambition 低 → landDevelopmentScore 上昇（現状維持志向）
landDevelopmentScoreBonus = normalizedTrait(caution)  * chancellorCautionLandDevelopmentScoreEffect
                           - normalizedTrait(ambition) * chancellorAmbitionLandDevelopmentScoreEffect
```

### 10.7 HouseDevelopmentSystem への効果

**家長（house head）→ 開発発動確率**:
```ts
abilityChanceBonus = normalizedStat(admin)    * houseHeadAdminDevelopmentChanceEffect
                   + normalizedTrait(caution) * houseHeadCautionDevelopmentChanceEffect
chance = clamp(houseDevelopmentYearlyChance + wealthBonus + abilityChanceBonus, 0, 1)
```

---

## 11. UI 構成

- **MapPanel**: Province を SVG で描画。クリックで Province 選択
- **Sidebar**: 人物一覧。重要度スコア順。ウォッチリスト対応
- **DetailPanel**: 選択エンティティ（Province / Country / House / Person）の詳細表示
  - ProvinceDetail: development / countryControl / houseControl / 収入見込み
  - CountryDetail: 首都名（capitalProvinceId）/ legitimacy / treasury
  - HouseDetail: 本拠地名（seatProvinceId）/ Province 数 / wealth / prestige
- **EventLog**: Chronicle（major/critical）と全イベントの 2 ビュー
- **ConfigPanel**: シミュレーションパラメータをリアルタイム調整

---

## 12. 今後の課題（未実装）

- **首都・本拠地移転**: 征服・滅亡・特別イベントによる移転
- **支配力による反乱・独立**: countryControl / houseControl が閾値を下回る Province での反乱
- **記念碑エンティティ化**: 建設場所、継続効果、破壊、monumentLevel
- **一強状態への対策**: 大国ペナルティ、継承問題、外部新興勢力
- **POP システム**: 社会階層・文化・宗教・支持対象
- **詳細な戦争**: War エンティティ、戦場、包囲戦
- **施設システム**: 城塞・道路・港・市場
- **詳細外交**: 同盟・条約・婚姻
- **血縁・婚姻関係**: 継承権・請求権
- **House の多国所領**: House が複数 Country に所領を持つ仕組み
