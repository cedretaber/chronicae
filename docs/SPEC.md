# Chronicae プロトタイプ仕様書

最終更新: 2026-05-17（v0.11 時点）

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

`--debug` フラグを追加すると `config.debug = true` で動作し、以下が変化する：

- **イベント出力（stdout）にエンティティ ID を付記**：`PERSON_DIED: Irmela has died at age 35. [pe-42, h-3, c-0]`
- **構造化デバッグログを stderr に出力**：`[DEBUG:TAG] key=value ...` 形式（SUCCESSION / BIRTH / MARRIAGE / HOUSE_SPLIT / HOUSE_EXTINCT / INTEGRITY / YEAR）。タグ単位で `grep` による機械的抽出が可能
- **IntegrityCheck 違反が非致死的**：例外の代わりに `[DEBUG:INTEGRITY] error=...` として stderr に出力し、シミュレーションを継続する

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
  habitability: number    // 0..100
  development: number     // -100..100
  countryControl: number  // 0..100
  houseControl: number    // 0..100
  popGroupIds: PopGroupId[]
}
```

- `habitability`: Province の基礎的な居住性・土地ポテンシャル。0 = ほぼ居住不能、100 = 非常に居住・生産に適した土地
- `development`: 土地の荒廃・発展。-100 = 完全荒廃、0 = 通常、+100 = 高度発展
- `countryControl`: 国家による実効支配力
- `houseControl`: 領主 House による実効支配力
- 名目所有（`countryId` / `ownerHouseId`）は支配力が 0 になっても変わらない
- `baseTax` / `manpower` / `unrest` は v0.8 で廃止。これらは POP から selector で算出する

### 3.2 PopClass / PopGroup（民衆集団）

```ts
type PopClass = 'peasants' | 'townsmen' | 'nobles'

type PopGroup = {
  id: PopGroupId
  provinceId: ProvinceId
  class: PopClass
  size: number       // 抽象人口規模（実人数ではない）
  wealth: number     // 0..100（豊かさ指数。金額ではない）
  unrest: number     // 0..100
  attitudes: AttitudeMap  // 対 Country などへの態度（v0.11）
}
```

| class | 意味 | 主な役割 |
|-------|------|----------|
| peasants | 農民・村落民 | 人口・基礎生産・兵力の中心 |
| townsmen | 都市民・商工民 | 税収・富・都市的発展 |
| nobles | 在地貴族・有力者 | 兵力・家支配・貴族的不満 |

各 Province は必ず peasants / townsmen / nobles の 3 PopGroup を持つ。PopGroup は消滅しない（`minPopSizeByClass` で下限保証）。

Province の unrest は POP unrest の人口加重平均として selector で算出する（§4 参照）。

### 3.3 Country（国家）

```ts
type Country = {
  id: CountryId
  name: string
  rulerHouseId: HouseId
  houseIds: HouseId[]
  treasury: number           // >= 0
  adminPower: number         // 0..100（キャッシュ値。毎1月に GovernanceSystem が再計算）
  legacyPrestige: number     // 0..100（歴史的権威・伝統の蓄積）
  roleAssignments: Partial<Record<RoleType, PersonId>>
  active: boolean
  lastWarMonth?: number
  capitalProvinceId: ProvinceId
}
```

- `capitalProvinceId`: 国家支配力の中心。その Country に属する Province でなければならない
- `legitimacy`・`stability` は v0.11 で削除。セレクターで動的計算（§4.5 参照）
- `adminPower` はキャッシュ値として維持。毎1月に GovernanceSystem が `getCountryAdminPower` で再計算（§4.5 / §6.23 参照）

### 3.4 House（家）

```ts
type House = {
  id: HouseId
  name: string
  active: boolean
  countryId: CountryId
  provinceIds: ProvinceId[]
  memberIds: PersonId[]      // 生存・死亡を問わず登録されたすべてのメンバー
  headId: PersonId
  founderId?: PersonId       // 家の創設者（分裂新設家のみ設定）
  parentHouseId?: HouseId    // 分裂元の家
  cadetHouseIds: HouseId[]   // 分裂で生まれた傍系家のリスト
  nameSource?: 'pool' | 'province' | 'founder' | 'fallback'
  legacyPrestige: number     // 0..100（家の権威・伝統の蓄積）
  wealth: number             // >= 0
  seatProvinceId: ProvinceId
}
```

- `seatProvinceId`: 家支配力の中心。その House が所有する Province でなければならない
- House は常に本拠地を保持する（本拠地移転・喪失は今後の課題）
- `prestige`・`cohesion`・`loyaltyToCountry` は v0.11 で削除。セレクターで動的計算（§4.5 参照）

### 3.5 Person（人物）

```ts
export type Sex = 'male' | 'female'
export type BirthStatus = 'legitimate' | 'illegitimate' | 'unknown'

type Person = {
  id: PersonId
  name: string
  sex: Sex
  age: number
  alive: boolean
  houseId: HouseId
  countryId: CountryId
  fatherId?: PersonId        // 父親（既知の場合）
  motherId?: PersonId        // 母親（既知の場合）
  spouseId?: PersonId        // 配偶者（婚姻中のみ）
  childIds: PersonId[]       // 子のリスト
  birthStatus: BirthStatus   // 嫡出・非嫡出・不明
  stats: {
    admin: number    // 0..10
    martial: number  // 0..10
  }
  traits: {
    ambition: number  // 0.0..1.0
    caution: number   // 0.0..1.0
  }
  legacyPrestige: number    // 0..100（個人の歴史的評価の蓄積）
  attitudes: AttitudeMap    // 対 Country / House / Person への態度（v0.11）
}
```

- `spouseId`: 生存中の配偶者のみを指す。配偶者が死亡した場合は `undefined` に戻る
- 親子・配偶者関係は双方向整合性が保証される（IntegrityCheck §6.24 参照）
- `prestige` / `traits.loyaltyToCountry` は v0.11 で削除。Attitude から動的計算（§4.5 参照）

### 3.6 Attitude（態度）

v0.11 追加。Person と PopGroup が持つ対エンティティへの態度を表す。

```ts
type Attitude = {
  affection: number  // -100..100（感情的な好意・嫌悪）
  respect: number    // -100..100（能力・権威への評価）
}

type AttitudeKey = string  // 形式: 'country:{id}' | 'house:{id}' | 'person:{id}'

type AttitudeMap = Record<AttitudeKey, Attitude>
```

- `affection`: 感情的な好意（正）または嫌悪（負）
- `respect`: 能力・権威への尊敬（正）または軽蔑（負）
- エントリが存在しない場合は `{ affection: 0, respect: 0 }` として扱う
- AttitudeDecaySystem により毎月 `attitudeMonthlyRetentionRate`（0.995）倍に減衰

### 3.6 役職（RoleType）

`chancellor`（宰相）、`general`（将軍）、`treasurer`（財務官）の 3 種。国家ごとに 1 名ずつ任命可能。

---

## 4. セレクター

### 4.1 Development セレクター

```ts
// development multiplier: clamp(1 + development / 100, 0, 2)
// development -100 → 0倍、0 → 1倍、+100 → 2倍
function getProvinceDevelopmentMultiplier(province: Province): number
```

`getEffectiveProvinceTax` / `getEffectiveProvinceManpower` は v0.8 で廃止。代わりに POP Economy セレクターを使用する。

### 4.2 POP セレクター

```ts
// Province の全 PopGroup を返す
function getProvincePops(state: WorldState, provinceId: ProvinceId): PopGroup[]

// POP size の合計（総人口）
function getProvincePopulation(state: WorldState, provinceId: ProvinceId): number

// POP wealth の人口加重平均
function getProvinceAveragePopWealth(state: WorldState, provinceId: ProvinceId): number

// POP unrest の人口加重平均
function getProvinceUnrest(state: WorldState, provinceId: ProvinceId): number

// carrying capacity: max(minProvinceCarryingCapacity, habitability * populationCapacityPerHabitability * devMod)
// devMod = clamp(1 + development / 200, 0.5, 1.5)
function getProvinceCarryingCapacity(state: WorldState, config: SimulationConfig, provinceId: ProvinceId): number

// population pressure: clamp(population / carryingCapacity, 0, 2)
function getProvincePopulationPressure(state: WorldState, config: SimulationConfig, provinceId: ProvinceId): number

// class 別の unrest を返す（該当 class の PopGroup の unrest 値。見つからない場合は 0）
function getPopUnrestByClass(state: WorldState, provinceId: ProvinceId, popClass: PopClass): number

// class 別の wealth を返す（該当 class の PopGroup の wealth 値。見つからない場合は 0）
function getPopWealthByClass(state: WorldState, provinceId: ProvinceId, popClass: PopClass): number
```

### 4.3 POP Economy セレクター

```ts
// POP 1件の生産量
// pop.size * productivityByClass[pop.class] * (pop.wealth / 100) * (province.countryControl / 100)
function getPopProduction(state: WorldState, config: SimulationConfig, popId: PopGroupId): number

// Province の総生産量（全 POP の生産量合計）
function getProvinceProduction(state: WorldState, config: SimulationConfig, provinceId: ProvinceId): number

// Province の税基盤: getProvinceProduction * (houseControl / 100)
function getProvinceTaxBase(state: WorldState, config: SimulationConfig, provinceId: ProvinceId): number

// Country 用の Province 兵力基盤: sum(pop.size * manpowerFactorByClass[pop.class] * (countryControl / 100))
function getProvinceCountryManpowerBase(state: WorldState, config: SimulationConfig, provinceId: ProvinceId): number

// House 用の Province 兵力基盤: sum(pop.size * manpowerFactorByClass[pop.class] * (houseControl / 100))
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

// Country 軍事力: adminPower * factor + sum(houseContributions)
//   支配家門は 100% 寄与。非支配家門は getHouseLoyaltyToCountry に応じた寄与
function calcCountryMilitaryPower(state: WorldState, config: SimulationConfig, countryId: CountryId): number
```

### 4.5 Status セレクター（v0.11）

v0.11 で legitimacy / stability / prestige / cohesion / loyaltyToCountry が格納フィールドから動的計算セレクターに移行した。

```ts
// Country 正統性: 0.35*personScore + 0.45*popScore + 0.2*legacyPrestige
//   personScore: 国内 Person の対 Country attitude (affection*0.35 + respect*0.65) 平均
//   popScore:    国内 PopGroup の対 Country attitude (affection*0.40 + respect*0.60) 人口加重平均
function getCountryLegitimacy(state: WorldState, countryId: CountryId): number

// Country 安定度: Province の安定度を首都からの距離で重み付け平均
//   provinceStability = 0.70*(100-unrest) + 0.30*countryControl
//   weight = 1 / (1 + distance)  ※到達不能は distance=5 扱い
function getCountryStability(state: WorldState, config: SimulationConfig, countryId: CountryId): number

// House 結束度: 家臣メンバーの家長への attitude 平均
//   score = affection*0.45 + respect*0.55（attitudeValueToScore で 0..100 正規化）
//   メンバーが 0 の場合は fallback 50
function getHouseCohesion(state: WorldState, houseId: HouseId): number

// House 忠誠度: 家メンバーの対 Country attitude 平均
//   score = affection*0.55 + respect*0.45
function getHouseLoyaltyToCountry(state: WorldState, houseId: HouseId): number

// Prestige = 0.70 * legacyPrestige + 0.30 * averageRespectScore
//   respectScore: 世界全体の Person/PopGroup からの attitude.respect 平均（attitudeValueToScore 正規化）
function getCountryPrestige(state: WorldState, countryId: CountryId): number
function getHousePrestige(state: WorldState, houseId: HouseId): number
function getPersonPrestige(state: WorldState, personId: PersonId): number

// Country 行政力: 毎1月 GovernanceSystem がキャッシュ
//   0.30*chancellorAdmin*10 + 0.20*treasurerAdmin*10 + 0.20*stability + 0.20*rulerPrestige + 0.10*treasuryScore
function getCountryAdminPower(state: WorldState, config: SimulationConfig, countryId: CountryId): number
```

**attitudeValueToScore の変換**:
- affection / respect の値 (-100..100) → score (0..100)
- 0 → 50、正 → 50+、負 → 50- の線形変換

---

## 5. Tick システム順序

毎月 1 回 tick が実行される。以下の順序でシステムが動く：

| 順序 | システム | 頻度 |
|------|----------|------|
| 1 | advanceTime | 毎月 |
| 2 | DevelopmentSystem | 毎月 |
| 3 | ControlSystem | 毎月 |
| 4 | LordshipTransitionSystem | 毎月 |
| 5 | **PopSystem** | 毎月 |
| 6 | EconomySystem | 毎月 |
| 7 | DisasterSystem | 毎年1月 |
| 8 | MortalitySystem | 毎月 |
| 9 | SuccessionSystem | 毎月 |
| 10 | MarriageSystem | 毎年1月 |
| 11 | BirthSystem | 毎年1月 |
| 12 | AppointmentSystem | 毎年1月 |
| 13 | AmbitionSystem | 毎月 |
| 14 | PublicSpendingSystem | 毎年1月 |
| 15 | HouseDevelopmentSystem | 毎年1月 |
| 16 | **PopDevelopmentSystem** | 毎月 |
| 17 | PlotSystem | 毎月 |
| 18 | WarSystem | 毎月 |
| 19 | **ProvinceRevoltSystem** | 毎月 |
| 20 | RebellionSystem | 毎月 |
| 21 | **AttitudeDecaySystem** | 毎月 |
| 22 | GovernanceSystem | 毎年1月 |
| 23 | normalizePopSizes | 毎月 |
| 24 | IntegrityCheck | 毎月 |

順序の理由：PopSystem を EconomySystem より前に置くことで、当月の POP 状態変化（人口成長・pressure・wealth/unrest）を反映して生産量を計算する。PopDevelopmentSystem を Country/House 開発システムより後に置くことで、当月の収入分配後に POP に残った余剰富による地元の自主開発を表現する。ProvinceRevoltSystem を RebellionSystem の前に置くことで、Province / POP 起点の社会不安が House 反乱に波及する経路を表現する（ただし同一 tick での直接連鎖はしない）。AttitudeDecaySystem を反乱・revolt の後に置くことで、各システムが当月に書き込んだ態度変化が減衰前に反映される。GovernanceSystem（adminPower キャッシュ計算）は1月のみ実行され、次の1年間の各システムで使われる。

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

`maxControlBonus` は宰相（countryControl）・家長（houseControl）の admin stat から算出される（§10 参照）。

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

### 6.4 PopSystem（毎月）

POP の月次自然変化を処理する。Province の carrying capacity に基づいた人口圧制御、wealth/unrest の自然変化を担当する。

**6.4.1 人口成長**

```ts
const pressure = getProvincePopulationPressure(state, config, province.id)
const growthFactor = clamp(1 - pressure, -0.5, 1.0)
const baseGrowth = config.baseMonthlyGrowthByClass[pop.class]
const wealthFactor = clamp(0.5 + pop.wealth / 100, 0.5, 1.5)
const unrestFactor = clamp(1 - pop.unrest / 150, 0.3, 1)
const delta = pop.size * baseGrowth * growthFactor * wealthFactor * unrestFactor
```

**6.4.2 population pressure の影響**

pressure が閾値を超えると土地不足・過密に相当する影響が発生する：

```ts
if (pressure > config.populationPressureThreshold) {
  const excess = pressure - config.populationPressureThreshold
  pop.wealth -= excess * config.populationPressureWealthPenalty
  pop.unrest += excess * config.populationPressureUnrestGain
}
```

**6.4.3 poverty / prosperity 効果**

```ts
// 貧困: wealth が低い POP は不満が上がりやすい
if (pop.wealth < config.povertyWealthThreshold) {
  pop.unrest += (config.povertyWealthThreshold - pop.wealth) * config.povertyUnrestGain
}
// 繁栄: wealth が高い POP は不満が下がりやすい
if (pop.wealth > config.prosperityWealthThreshold) {
  pop.unrest -= (pop.wealth - config.prosperityWealthThreshold) * config.prosperityUnrestReduction
}
```

**6.4.4 clamp**

```ts
pop.size = Math.max(config.minPopSizeByClass[pop.class], pop.size + delta)
pop.wealth = clamp(pop.wealth, 0, 100)
pop.unrest = clamp(pop.unrest, 0, 100)
```

**normalizePopSizes**（IntegrityCheck 直前）: 全 POP について `size < minPopSizeByClass[class]` の場合、最低値に切り上げる。疫病・戦争などでサイズが最低値を下回った場合のフェイルセーフ。

### 6.5 EconomySystem（毎月）

Province ごとに POP の生産量を算出し、支配力に基づいて国・家・POP に富を分配する。

**6.5.1 生産量算出**

```ts
const production = getProvinceProduction(state, config, province.id)
// = sum(pop.size * productivityByClass[pop.class] * (pop.wealth/100) * (countryControl/100))
```

**6.5.2 回収式**

支配力不足によるロスの思想は維持する。ロス分は POP に残る富となる。

```ts
const cc = province.countryControl / 100
const hc = province.houseControl / 100
const totalControl = cc + hc

if (totalControl > 0) {
  countryIncome = production * (cc / totalControl) * cc
  houseIncome   = production * (hc / totalControl) * hc
}

const extracted = countryIncome + houseIncome
const retained  = Math.max(0, production - extracted)
```

支配力の例（Province 生産量 100 の場合）:
| countryControl | houseControl | 国収入（taxEfficiency=1） | 家収入 | POP 残留 |
|---|---|---|---|---|
| 100 | 100 | 50 | 50 | 0 |
| 100 | 50 | 66.7 | 16.7 | 16.6 |
| 50 | 50 | 25 | 25 | 50 |
| 100 | 0 | 100 | 0 | 0 |

**6.5.3 財務官の taxEfficiency**

国庫収入には財務官の能力補正が乗算される（§10 参照）。POP から余分に徴収するのではなく、徴収・輸送・汚職抑制の効率を表す。

```ts
country.treasury += countryIncome * taxEfficiency
house.wealth     += houseIncome
```

**6.5.4 retained wealth の POP 反映**

回収されなかった富は `retainedRatio * retainedWealthGainByClass[class]` として POP wealth に反映される：

```ts
const retainedRatio = production > 0 ? retained / production : 0
// POP class ごとに adjustProvincePopWealthByClass で適用
```

**6.5.5 過剰徴収ペナルティ**

高支配地域での高徴収は正常だが、POP が貧しく不満を抱えている場合にのみペナルティが発生する：

```ts
if (
  extractionRatio > config.overExtractionThreshold &&
  (averageWealth < config.overExtractionWealthSafeThreshold ||
   provinceUnrest > config.overExtractionUnrestSafeThreshold)
) {
  const over = extractionRatio - config.overExtractionThreshold
  adjustProvincePopWealth(state, province.id, -over * config.overExtractionWealthPenalty)
  adjustProvincePopUnrest(state, province.id, over * config.overExtractionUnrestGain)
}
```

### 6.6 DisasterSystem（毎年1月）

国家ごとに独立して判定。同一国に複数の災害が同時発生し得る。

| 災害 | 確率 | 効果 |
|------|------|------|
| Famine（飢饉） | `famineBaseChancePerYear` (8%) | Province dev 低下、treasury 消費（救済）、peasants wealth/size 低下 |
| Plague（疫病） | `plagueBaseChancePerYear` (3%) | Province dev 低下、全 POP wealth/size 低下 |
| BountifulHarvest（豊作） | `bountifulHarvestBaseChancePerYear` (5%) | Province dev 上昇、peasants/townsmen wealth 上昇・unrest 低下 |

**Famine の詳細**:
- 救済判定: `country.treasury >= countryProvinceCount * disasterReliefCostPerProvince`
- 救済あり: dev -= (famineDevastation - famineReliefDevelopmentRecovery)、country.legacyPrestige +1、POP 効果を `famineReliefDamageMultiplier`（0.3）倍に軽減
- 救済なし: dev -= famineDevastation、POP 効果フル適用
- POP 効果: `adjustProvincePopWealthByClass(state, pid, 'peasants', -famineWealthPenalty * multiplier)` / `adjustProvincePopSizeByClass(state, pid, 'peasants', -famineSizeDamage * multiplier)`

**Plague の詳細**:
- `adjustProvincePopWealth(state, pid, -plagueWealthPenalty)`（全 POP）
- `adjustProvincePopSize(state, pid, -plagueSizeDamage)`（全 POP）

**BountifulHarvest の詳細**:
- treasury への直接加算なし。翌月以降の EconomySystem で POP production 上昇により国庫が増加する
- `adjustProvincePopWealthByClass(state, pid, 'peasants', +bountifulHarvestPeasantWealthGain)`
- `adjustProvincePopUnrestByClass(state, pid, 'peasants', -bountifulHarvestPeasantUnrestReduction)`
- `adjustProvincePopWealthByClass(state, pid, 'townsmen', +bountifulHarvestTownsmanWealthGain)`
- `adjustProvincePopUnrestByClass(state, pid, 'townsmen', -bountifulHarvestTownsmanUnrestReduction)`

### 6.7 MortalitySystem（毎月）

人物の自然死亡を処理。死亡した人物が役職・家長を担っていた場合は後継処理へ。

### 6.8 MarriageSystem（毎年1月）

`marriageEnabled` が true のとき動作。未婚の男性候補を一覧し、それぞれに対して婚姻判定を行う。

- **候補条件（男性）**: 生存・未婚・対象年齢（`marriageMaleMinAge`〜`marriageMaleMaxAge`）・所属家が active
- **候補条件（女性）**: 生存・未婚・対象年齢（`marriageFemaleMinAge`〜`marriageFemaleMaxAge`）・所属家が active
- **禁止組み合わせ**: 同一家・近親関係（`isForbiddenMarriagePair` によるチェック）
- **国内婚ボーナス**: 同一国の女性には `sameCountryMarriageBonus`（+0.10）を加算
- **異国婚ペナルティ**: 異なる国の女性には `differentCountryMarriagePenalty`（-0.05）を加算

婚姻成立時の処理：
- 女性が男性の家に `movePersonToHouse` で移動
- `spouseId` を双方向に設定（`setSpouse`）
- `house.memberIds` に女性を追加

イベント: `MARRIAGE_FORMED`（importance: `normal`）

### 6.9 BirthSystem（毎年1月）

`birthEnabled` が true のとき動作。対象年齢（`fatherMinChildAge`〜`fatherMaxChildAge`）の生存男性を走査し、出生判定を行う。

**出生確率補正**:
```
livingCount <= criticalLivingPersons → birthMultiplier = criticalPopulationBirthMultiplier (3.0)
livingCount < targetLivingPersons   → birthMultiplier = lowPopulationBirthMultiplier (1.5)
それ以外                              → birthMultiplier = 1.0
birthChance = baseBirthChancePerMalePerYear * birthMultiplier
```

**母親の決定**:
- 配偶者が対象年齢（`motherMinChildAge`〜`motherMaxChildAge`）の場合、`spouseMotherChance`（0.9）で嫡出子
- それ以外は非嫡出子（`illegitimate`）として処理

**性別の決定**:
- 成人男性が全人口の 40% 未満の場合: `maleBirthChanceWhenAdultMaleShortage`（0.65）
- それ以外: `maleBirthChance`（0.52）

誕生した子：
- `houseId` は父親と同じ
- `fatherId` / `motherId` を設定（嫡出の場合）
- 父・母の `childIds` に追加
- `house.memberIds` に追加

イベント: `CHILD_BORN`（importance: `minor`）

### 6.10 SuccessionSystem（毎月）

家長が死亡または存在しない場合、生存メンバーから新家長を選出。

**後継者選出（成人候補あり）**:
- `getAdultSuccessionCandidates` で成人（age >= `adultAge`）かつ生存の家メンバーを列挙
- スコアが最高の候補を後継者に選ぶ
- スコア 2 位との差が `successionCrisisScoreGap` を超える場合、`SUCCESSION_CRISIS` イベントを発火
- 継承後に `maybeSplitHouseAfterSuccession` を呼び出す（§6.11 参照）

**後継者選出（未成年のみ）**:
- 最年長の未成年を仮の家長に任命
- 未成年当主ペナルティ（§6.12 参照）が以後毎月適用される

**後継者なし**: `extinctHouseAfterFailedSuccession`（§6.13 参照）を呼び出す。

### 6.11 HouseSplitSystem（SuccessionSystem から呼び出し）

継承が発生した際に、分裂条件を満たせば家の分裂を実行する。

**分裂条件（AND）**:
1. `houseSplitEnabled: true`
2. `house.provinceIds.length >= minProvincesForHouseSplit`（デフォルト 3）
3. `splitCandidates.length >= 1`（後継者以外の成人候補が存在する）
4. `getHouseCohesion(house) < houseSplitCohesionThreshold`（デフォルト 60）

**分裂確率**:
```
currentCohesion = getHouseCohesion(house)   // Attitude から動的計算（§4.5 参照）
splitChance = baseHouseSplitChance
            + splitter.ambition        * houseSplitAmbitionFactor
            + splitter.legacyPrestige  * houseSplitPrestigeFactor
            + splitter.martial         * houseSplitMartialFactor
            - currentCohesion          * houseSplitCohesionFactor
```

分裂実行時の処理：
- 新 House を生成（`id: h-{parentId}-{year}`）
- 分裂者・その配偶者・子を新 House の `memberIds` に設定
- Province の一部（`houseSplitControlMin`〜`houseSplitControlMax` の割合）を新 House に移管
- 元 House の `cadetHouseIds` に追加、新 House の `parentHouseId` を設定
- 国の `houseIds` に新 House を追加

イベント: `HOUSE_SPLIT`（importance: `major`）+ `SUCCESSION_CRISIS`（importance: `major`）

**cohesion（結束度）について**:
- v0.11 より `house.cohesion` フィールドは廃止。`getHouseCohesion` セレクターで動的計算（§4.5 参照）
- 結束度は家メンバーの家長への attitude から計算されるため、態度変化イベントにより自然に変動する

### 6.12 未成年当主ペナルティ（SuccessionSystem 内）

当主が未成年（age < `adultAge`）の間、毎月適用。v0.11 以降は格納フィールドの直接変更ではなく、Attitude の調整を通じて cohesion・loyaltyToCountry に間接影響を与える（実装上は `minorHeadCohesionPenaltyPerMonth` / `minorHeadLoyaltyPenaltyPerMonth` の config 値が引き続き参照される）。

### 6.13 HouseExtinctionSystem（SuccessionSystem から呼び出し）

後継者が存在しない家（生存メンバーが 0 または全員未成年かつ成人後継者なし）に対して断絶処理を行う。

**通常家の断絶（非支配家）**:
- 同国内の別の active House を継承先に選択
- `moveLivingMembersToHouse` で生存メンバーを継承先に移動
- 断絶家の Province を継承先に `transferProvinceToHouse` で移管
- 断絶家を `active: false`、`memberIds: []` に設定
- 国の `houseIds` から除外

**支配家の断絶（rulerHouse）**:
- 同国内に別の active House がある場合:
  - 最も Province 数が多い House を新支配家に選択
  - `changeRulerHouse` mutation で国の `rulerHouseId` を更新
  - 生存メンバーを新支配家に移動・Province も移管
  - `RULER_HOUSE_CHANGED` イベントを発火後に断絶処理
- 同国内に House がない場合（完全孤立）:
  - 隣接国の最大 House に Province・生存メンバーを移動し国ごと併合
  - 内部的に `handleRulerHouseExtinction` のアネクサーパスを実行

イベント: `HOUSE_EXTINCT`（importance: `major`）または `RULER_HOUSE_EXTINCT`（importance: `critical`）

### 6.14 AppointmentSystem（毎年1月）

国家の各役職に対して、スコアの低い担当者を `replacementThreshold` 未満で交代。

### 6.15 AmbitionSystem（毎月）

人物・家ごとに野心スコアを計算し、将来の陰謀・反乱の素地を作る。

### 6.16 PublicSpendingSystem（毎年1月）

`publicSpendingYearlyChance`（35%）で発動。monumentScore vs landDevelopmentScore を比較し実行：

スコア計算に宰相の ability 補正が加算される（§10 参照）:
```
monumentScore      += chancellorAmbitionMonumentScoreBonus + chancellorCautionMonumentScoreBonus
landDevelopmentScore += chancellorCautionLandDevelopmentScoreBonus + chancellorAmbitionLandDevelopmentScoreBonus
```

**記念碑建設（MONUMENT_BUILT）**:
- 条件: monumentScore > landDevelopmentScore かつ treasury >= monumentBaseCost
- 対象 Province: 首都から接続済み、countryControl < 100 の中から最高スコアで選択
- 効果: treasury -= monumentBaseCost、**countryControl += monumentCountryControlGain**、legitimacy += monumentLegitimacyGain、rulerHouse.prestige += 2

**国家土地開発（COUNTRY_LAND_DEVELOPED）**:
- 条件: treasury >= effectiveCost（財務官 admin による割引あり）
- 効果: development += gain（clamp）、**houseControl += landDevelopmentHouseControlGain**、treasury -= effectiveCost

### 6.17 HouseDevelopmentSystem（毎年1月）

`houseDevelopmentEnabled` が true のとき動作。全 active House に対して：

- 条件: `house.wealth >= houseLandDevelopmentBaseCost + houseWealthReserve`
- 発動確率:
  ```
  chance = clamp(houseDevelopmentYearlyChance + wealthBonus + abilityChanceBonus, 0, 1)
  wealthBonus      = clamp((wealth - cost - reserve) / 300, 0, 0.25)
  abilityChanceBonus = 家長 admin / caution による補正（§10 参照）
  ```
- 効果:
  ```
  effectiveGain = houseLandDevelopmentGain * (1 - max(0, development) / 100)
  development += effectiveGain（clamp）
  houseControl += landDevelopmentHouseControlGain（clamp）
  house.wealth -= houseLandDevelopmentBaseCost
  ```
- イベント: `HOUSE_LAND_DEVELOPED`

### 6.18 PopDevelopmentSystem（毎月）

`popDevelopmentEnabled` が true のとき動作。地元共同体・都市民・在地有力者による小規模な土地改善を表す。

POP 自主開発は Country / House 開発より明確に弱く、局所的・低効率に留める：

| 開発主体 | development gain | 財源 |
|----------|-----------------|------|
| POP | +0.25（微少） | Province に残った POP wealth |
| House | +6 | House wealth |
| Country | +8 以上 | Country treasury |

**発動条件**:
```ts
if (averageWealth < config.popDevelopmentWealthThreshold) continue
if (unrest > config.popDevelopmentUnrestMax) continue
if (province.development >= config.popDevelopmentMaxDevelopment) continue
```

**発動確率**:
```ts
chance = clamp(
  popDevelopmentMonthlyChance
    + (averageWealth - popDevelopmentWealthThreshold) * popDevelopmentWealthChanceFactor
    - unrest * popDevelopmentUnrestPenaltyFactor,
  0,
  popDevelopmentMaxMonthlyChance,
)
```

**効果**:
```ts
province.development += popDevelopmentGain  // clamp(-100, 100)
adjustProvincePopWealth(state, province.id, -popDevelopmentCost)
```

countryControl / houseControl には影響しない。

イベント: `POP_LAND_DEVELOPED`（importance: `minor`）
```
summary: "The people of ${province.name} improved their lands."
```

### 6.19 PlotSystem（毎月）

野心スコアが `plotThreshold` を超えた人物が陰謀を実行。成功率 `basePlotSuccess`。

### 6.20 WarSystem（毎月）

`warEnabled` が true のとき動作。国家が他国に宣戦布告し、Province を奪取する。

- 宣戦条件: `effectiveMinWinChanceToDeclare`（将軍の ambition/caution で変動、§10 参照）以上の勝率見込み、warCooldown 明け
- 軍事力: `baseMilitaryPower * warPowerModifier`（将軍 martial stat による、§10 参照）
- **本拠地保護**: `seatProvinceId` の Province は征服対象から除外する
- 征服後、defender の非 seat Province がすべてなくなった場合（seat のみ残存）に `annexCountry` を呼び出す

**荒廃・POP 効果**:
- 攻撃側勝利時（征服 Province）: development -= warConqueredProvinceDevastation、全 POP wealth 低下・unrest 上昇・peasants/townsmen size 軽度減少
- 攻撃側勝利時（境界 Province）: development -= warBorderProvinceDevastation、全 POP wealth 低下・unrest 上昇
- 攻撃側敗北時（攻撃側境界 Province）: development -= failedWarBorderDevastation、全 POP wealth 低下・unrest 上昇

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

### 6.21 RebellionSystem（毎月）

反乱傾向が `rebellionThreshold` を超えた House が反乱を起こす（HouseRebellionSystem）。Province / POP 起点の反乱は §6.22 ProvinceRevoltSystem が担当する。

**反乱傾向の計算**:

`calcAmbitionScores` による基本傾向に加え、POP 状態から以下を加算する。

```ts
rebellionTendency += avgNoblesUnrest * houseRebellionNobleUnrestFactor
rebellionTendency += avgProvinceUnrest * houseRebellionProvinceUnrestFactor
rebellionTendency += (100 - avgCountryControl) * houseRebellionLowControlFactor
```

**戦力計算**:

- 反乱側: `calcHouseMilitaryPower(state, config, rebelHouseId)`
- 鎮圧側: 支配家門は 100% 寄与、非支配家門は `getHouseLoyaltyToCountry`（§4.5）に応じた寄与 + `adminPower * factor` + `treasury / divisor`

**荒廃効果**:
- 反乱開始時: rebelProvinces に development -= rebellionStartedDevastation
- 反乱成功時: rebelProvinces に development -= rebellionSucceededDevastation
- 反乱失敗時: rebelProvinces に development -= rebellionFailedDevastation

**成功時の処理**（`rebellionSuccessMode` で分岐）:
- `independence`: 反乱家が独立国を形成（国名: `{house.name}領`）
- `ruler_change`: 反乱家が支配家に就く

### 6.22 ProvinceRevoltSystem（毎月）

Province / POP を起点とする社会的反乱を処理する。

毎月、全 active Province に対して POP class ごとの反乱傾向を評価し、最も傾向が高い class 1 つを候補とする。スナップショットパターンで実装（連鎖防止）。

**反乱傾向**:

```ts
revoltTendency =
  pop.unrest * provinceRevoltUnrestFactor
  + (100 - houseControl) * provinceRevoltLowHouseControlFactor
  + (100 - countryControl) * provinceRevoltLowCountryControlFactor
  - country.stability * provinceRevoltStabilitySuppressionFactor
  + [class 別補正]
```

class 別補正:

| class | 補正内容 |
|-------|----------|
| peasants | 貧困 wealth ペナルティ + 人口圧力 |
| townsmen | 低 wealth 時のみ搾取ペナルティ + 生産量補正 |
| nobles | 低忠誠度補正 + 低正統性補正 |

**発生判定**: `revoltTendency >= provinceRevoltThreshold` のとき、`clamp(tendency / chanceDivisor, 0, maxChance)` の確率で発生。

**戦力比較**:
- 反乱側: `pop.size * popRevoltPowerFactorByClass[class] * (0.5 + unrest/100)`
- 鎮圧側: Province の house/country manpower + log1p(treasury) + log1p(houseWealth)

**成功 outcome**:

| outcome | 条件 | 効果 |
|---------|------|------|
| `concession` | 小幅成功 | 支配力低下・house wealth 低下、不満低下 |
| `lordship_change` | 中〜大成功 | 新 Person・新 House を生成し Province の領主を交代 |
| `independence` | nobles 反乱かつ両支配力が極低値かつ大差勝利 | 新 Person・新 House・新 Country を生成し Province が独立 |

**反乱失敗**: 反乱 POP の unrest 低下・Province 荒廃・反乱 POP wealth 低下、鎮圧側 country.legacyPrestige +1。他 class の unrest が collateral として小幅上昇。

**イベント**:

| 状況 | イベント |
|------|---------|
| 発生 | `PROVINCE_REVOLT_STARTED` |
| concession 成功 | `PROVINCE_REVOLT_SUCCEEDED` |
| lordship_change 成功 | `LORDSHIP_USURPED` |
| independence 成功 | `REVOLT_COUNTRY_FOUNDED` |
| 失敗 | `PROVINCE_REVOLT_FAILED` |

**旧 ownerHouse の処置（lordship_change / independence）**: 領地がゼロになった House は即 inactive 化し、生存メンバーを rulerHouse に移動。`HOUSE_EXTINCT` イベントを発火。

### 6.23 AttitudeDecaySystem（毎月）

全 Person および全 PopGroup の `attitudes` を毎月 `attitudeMonthlyRetentionRate`（0.995）倍に減衰させる。`affection` / `respect` どちらも同率で 0 に近づく。エントリを持たない（未設定の）態度への影響なし。

### 6.23b GovernanceSystem（毎年1月）

`getCountryAdminPower`（§4.5）で `adminPower` を再計算し、`country.adminPower` にキャッシュとして書き込む。

```ts
adminPower = 0.30*chancellorAdmin*10 + 0.20*treasurerAdmin*10
           + 0.20*getCountryStability + 0.20*getHousePrestige(rulerHouse) + 0.10*clamp(log1p(treasury)*10, 0, 100)
```

旧 StabilitySystem は v0.11 で廃止。Stability は `getCountryStability` セレクターで毎回計算する。

### 6.24 IntegrityCheck（毎月）

以下を検証し、違反があれば例外を投げる（`debug` モード時は警告のみ）：

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
12. Person.sex が `'male'` または `'female'` のいずれか
13. 生存 Person の spouseId が双方向かつ有効（相互参照の一致）
14. 生存 Person の spouseId が死亡者を指さない
15. 親子関係の双方向整合性（fatherId/motherId と childIds の相互参照）
16. House の cadet 関係の双方向整合性（parentHouseId と cadetHouseIds の相互参照）
17. PopGroup.provinceId が有効な Province を指している
18. Province.popGroupIds の全 ID が有効な PopGroup を指している
19. Province.popGroupIds と PopGroup.provinceId の双方向整合性
20. 各 Province が peasants / townsmen / nobles を 1 つずつ持つ
21. PopGroup.size >= minPopSizeByClass[class]
22. PopGroup.wealth が 0..100 の範囲内
23. PopGroup.unrest が 0..100 の範囲内
24. active Country.houseIds に rulerHouseId が含まれる
25. active House.memberIds に headId が含まれる
26. House.memberIds に重複がない（v0.11）
27. House.provinceIds に重複がない（v0.11）
28. Country.legacyPrestige が 0..100 の範囲内（v0.11）
29. House.legacyPrestige が 0..100 の範囲内（v0.11）

---

## 7. Worldgen 初期化

### 7.1 Province habitability の生成

worldgen 時に各 Province に `habitability` を乱数で生成する：

```ts
habitability = randomInt(30, 90)
```

将来的には地形・沿岸・河川・気候などで補正する。

### 7.2 PopGroup 初期生成

各 Province に peasants / townsmen / nobles の 3 PopGroup を生成する。

**size の初期値**（carrying capacity に基づく）:
```ts
const capacity = max(minProvinceCarryingCapacity, habitability * populationCapacityPerHabitability * devMod)
peasants.size  = capacity * randomInt(55, 75) / 100
townsmen.size  = capacity * randomInt(5, 15) / 100
nobles.size    = capacity * randomInt(2, 5) / 100
```

**wealth の初期値**（class ごとに差をつける）:
```ts
peasants.wealth  = randomInt(35, 60)
townsmen.wealth  = randomInt(45, 70)
nobles.wealth    = randomInt(50, 80)
```

**unrest の初期値**（低〜中程度）:
```ts
peasants.unrest  = randomInt(10, 30)
townsmen.unrest  = randomInt(10, 25)
nobles.unrest    = randomInt(5, 25)
```

### 7.3 seatProvinceId の決定

各 House の本拠地は、その House が所有する Province のうち `development` が最も高いもの。同値は Province ID 昇順。

### 7.4 capitalProvinceId の決定

各 Country の首都は、支配家（rulerHouse）の `seatProvinceId`。

### 7.5 countryControl / houseControl の初期値

ControlSystem と同じ距離上限計算で初期化する。

```
countryControl = maxControl(capitalProvinceId からの BFS 距離)
houseControl   = maxControl(seatProvinceId からの BFS 距離)
```

接続不能な Province: `countryControl = 30`、`houseControl = 30`

### 7.6 エンティティ名称の生成

Country / House / Province / Person の `name` は、`sim/worldgen/namePool.ts` に定義された名前プールから seed 付き RNG で選択する。

- Country・House・Province: `pickUniqueName` による重複回避。プール不足時は `Country-N` / `House-N` / `Province-N` にフォールバック
- Person（worldgen 初期生成・BirthSystem による出生ともに）: `pickNameBySex` による重複あり選択（中世欧州風に同名人物が複数存在し得る）
- `debug` モード時もエンティティ名は通常と同じ名前プールから生成される（連番 ID 方式は廃止）。デバッグ追跡はエンティティ固有 ID（`pe-42`, `h-3` 等）で行う

---

## 8. イベント型一覧

| EventType | importance | 説明 |
|-----------|------------|------|
| ROLE_ASSIGNED | normal | 役職任命 |
| ROLE_REVOKED | normal | 役職解任 |
| PERSON_DIED | normal | 人物死亡 |
| IMPORTANT_PERSON_DIED | major | 重要人物死亡 |
| HOUSE_HEAD_CHANGED | normal | 家長交代 |
| HOUSE_EXTINCT | major | 家の断絶（非支配家） |
| RULER_HOUSE_EXTINCT | critical | 支配家の断絶 |
| MARRIAGE_FORMED | normal | 婚姻成立 |
| CHILD_BORN | minor | 子誕生 |
| HOUSE_SPLIT | major | 家の分裂（傍系家の独立） |
| SUCCESSION_CRISIS | major | 継承危機 |
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
| POP_LAND_DEVELOPED | minor | POP 自主開発（§6.18） |
| PROVINCE_REVOLT_STARTED | normal | Province / POP 反乱が発生 |
| PROVINCE_REVOLT_SUCCEEDED | major | Province 反乱が concession で成功 |
| PROVINCE_REVOLT_FAILED | normal | Province 反乱が失敗・鎮圧 |
| LORDSHIP_USURPED | major | 反乱により Province の ownerHouse が交代 |
| REVOLT_COUNTRY_FOUNDED | critical | Province 反乱の独立により新 Country が成立 |
| POP_HARDSHIP | minor | POP の困窮（将来実装） |
| POP_PROSPERITY | minor | POP の繁栄（将来実装） |
| POP_UNREST_RISING | normal | Province unrest 上昇警告（将来実装） |
| POP_DECLINED | normal | Province 人口大幅低下（将来実装） |

POP_HARDSHIP / POP_PROSPERITY / POP_UNREST_RISING / POP_DECLINED は EventType 宣言のみ。実際の発火ロジックは v1.0 以降に実装する。

---

## 9. SimulationConfig デフォルト値

| 項目 | デフォルト | 説明 |
|------|-----------|------|
| debug | false | デバッグモード（イベント行への ID 付記・構造化デバッグログ・非致死的 IntegrityCheck） |
| basePlotSuccess | 0.35 | 陰謀基本成功率 |
| rebellionThreshold | 90 | 反乱発動閾値 |
| plotThreshold | 65 | 陰謀発動閾値 |
| replacementThreshold | 15 | 役職交代閾値 |
| rebellionSuccessMode | 'independence' | 反乱成功時の処理 |
| maxRawEvents | 10000 | 全イベント保持上限 |
| maxChronicleEvents | 1000 | Chronicle イベント保持上限 |
| **Marriage & Birth** | | |
| marriageEnabled | true | 婚姻システム有効 |
| marriageMaleMinAge | 16 | 婚姻可能最低年齢（男性） |
| marriageMaleMaxAge | 60 | 婚姻可能最高年齢（男性） |
| marriageFemaleMinAge | 15 | 婚姻可能最低年齢（女性） |
| marriageFemaleMaxAge | 45 | 婚姻可能最高年齢（女性） |
| marriageYearlyChance | 0.08 | 年間婚姻確率（基本） |
| sameCountryMarriageBonus | 0.10 | 同国婚姻の確率ボーナス |
| differentCountryMarriagePenalty | -0.05 | 異国婚姻の確率ペナルティ |
| birthEnabled | true | 出生システム有効 |
| fatherMinChildAge | 15 | 父親になれる最低年齢 |
| fatherMaxChildAge | 60 | 父親になれる最高年齢 |
| motherMinChildAge | 15 | 母親になれる最低年齢 |
| motherMaxChildAge | 45 | 母親になれる最高年齢 |
| baseBirthChancePerMalePerYear | 0.06 | 男性 1 人あたりの年間出生確率（基本） |
| spouseMotherChance | 0.90 | 配偶者が母親になる確率 |
| maleBirthChance | 0.52 | 男子出生確率（通常） |
| maleBirthChanceWhenAdultMaleShortage | 0.65 | 男子出生確率（成人男性不足時） |
| targetLivingPersons | 180 | 出生倍率 1.0 となる生存人数の目標 |
| criticalLivingPersons | 90 | 危機的人口（出生倍率 3.0 が発動する閾値） |
| lowPopulationBirthMultiplier | 1.5 | 人口不足時の出生倍率 |
| criticalPopulationBirthMultiplier | 3.0 | 危機的人口時の出生倍率 |
| adultAge | 15 | 成人年齢（継承・婚姻・出生の判定基準） |
| **Succession & House Split** | | |
| successionCrisisScoreGap | 10 | 後継者スコア差がこの値を超えると継承危機が発生 |
| minorHeadCohesionPenaltyPerMonth | 0.5 | 未成年当主の月次 cohesion 影響係数（Attitude 経由） |
| minorHeadLoyaltyPenaltyPerMonth | 0.3 | 未成年当主の月次 loyaltyToCountry 影響係数（Attitude 経由） |
| houseSplitEnabled | true | 家の分裂有効 |
| minProvincesForHouseSplit | 3 | 分裂に必要な最小 Province 数 |
| houseSplitCohesionThreshold | 60 | 分裂条件の cohesion 上限（getHouseCohesion が未満でないと不発） |
| baseHouseSplitChance | 0.10 | 分裂基本確率 |
| houseSplitAmbitionFactor | 0.25 | 分裂確率への野心補正係数 |
| houseSplitPrestigeFactor | 0.002 | 分裂確率への legacyPrestige 補正係数 |
| houseSplitMartialFactor | 0.02 | 分裂確率への martial 補正係数 |
| houseSplitCohesionFactor | 0.003 | 分裂確率への cohesion 減少係数 |
| houseSplitControlMin | 30 | 分裂 Province 割合の下限（%） |
| houseSplitControlMax | 80 | 分裂 Province 割合の上限（%） |
| houseSplitWealthShare | 0.25 | 分裂時に新 House が受け取る wealth 割合 |
| houseSplitUnrestGain | 5 | 分裂 Province への POP unrest 増加量（PopMutation 経由） |
| extinctionUnrestGain | 8 | 家断絶後の継承 Province への POP unrest 増加量 |
| **War** | | |
| warEnabled | true | 戦争有効 |
| warCostPerProvince | 20 | Province あたり戦費 |
| maxProvincesPerWar | 3 | 1 戦争あたり最大征服数 |
| maxWarsPerTick | 1 | 1 tick あたり最大宣戦数 |
| warCooldownMonths | 24 | 戦争クールダウン（月） |
| minAttackerWinChanceToDeclare | 0.45 | 宣戦布告に必要な最低勝率 |
| warWealthDamage | 8 | 戦争時の全 POP wealth 低下量 |
| warUnrestDamage | 10 | 戦争時の全 POP unrest 上昇量 |
| warPeasantSizeDamage | 0.5 | 戦争時の peasants size 減少量 |
| warTownsmanSizeDamage | 0.3 | 戦争時の townsmen size 減少量 |
| **Disaster** | | |
| disasterEnabled | true | 災害有効 |
| famineBaseChancePerYear | 0.08 | 飢饉発生率/年 |
| plagueBaseChancePerYear | 0.03 | 疫病発生率/年 |
| bountifulHarvestBaseChancePerYear | 0.05 | 豊作発生率/年 |
| disasterReliefCostPerProvince | 20 | 救済費用/Province |
| famineWealthPenalty | 15 | 飢饉による peasants wealth 低下量 |
| famineSizeDamage | 2 | 飢饉による peasants size 減少量 |
| famineReliefDamageMultiplier | 0.3 | 救済成功時の POP 効果軽減係数 |
| plagueWealthPenalty | 10 | 疫病による全 POP wealth 低下量 |
| plagueSizeDamage | 3 | 疫病による全 POP size 減少量 |
| bountifulHarvestPeasantWealthGain | 10 | 豊作による peasants wealth 上昇量 |
| bountifulHarvestPeasantUnrestReduction | 5 | 豊作による peasants unrest 低下量 |
| bountifulHarvestTownsmanWealthGain | 2 | 豊作による townsmen wealth 上昇量 |
| bountifulHarvestTownsmanUnrestReduction | 1 | 豊作による townsmen unrest 低下量 |
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
| monumentLegacyPrestigeGain | 3 | 記念碑による rulerHouse.legacyPrestige 上昇量（v0.11） |
| **Land Development** | | |
| landDevelopmentHouseControlGain | 5 | 土地開発による houseControl 上昇量 |
| landDevelopmentUnrestReduction | 1 | 土地開発によるスコア評価に用いる unrest 低下量 |
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
| **Military（v0.9）** | | |
| houseManpowerPowerFactor | 1.0 | House manpower を軍事力へ変換する係数 |
| houseMilitaryWealthReserve | 100 | 軍事力換算から除外する House wealth 予備 |
| houseWealthMilitaryFactor | 8.0 | log1p(availableWealth) の軍事力換算係数 |
| maxMercenaryPowerRatio | 0.5 | 傭兵力の上限（levyPower の 50%） |
| houseCommanderMartialEffect | 0.25 | martial による軍事力倍率補正係数 |
| minCommanderModifier | 0.75 | 指揮官補正の下限 |
| maxCommanderModifier | 1.25 | 指揮官補正の上限 |
| countryAdminMilitaryFactor | 0.3 | 国家 adminPower の軍事力寄与係数 |
| minHouseMilitaryContribution | 0.25 | 非支配家門の最低軍事寄与率 |
| **HouseRebellion（v0.9）** | | |
| houseRebellionNobleUnrestFactor | 0.15 | nobles unrest の反乱傾向加算係数 |
| houseRebellionProvinceUnrestFactor | 0.05 | Province 全体 unrest の反乱傾向加算係数 |
| houseRebellionLowControlFactor | 0.10 | 低 countryControl による反乱傾向加算係数 |
| rebellionTreasuryPowerDivisor | 50 | 国庫を鎮圧戦力へ換算する除数 |
| **ProvinceRevolt（v0.9）** | | |
| provinceRevoltThreshold | 90 | Province 反乱発動の傾向閾値 |
| provinceRevoltChanceDivisor | 300 | 傾向値を月次確率へ変換する除数 |
| provinceRevoltMaxChance | 0.35 | 月次発生確率の上限 |
| provinceRevoltUnrestFactor | 0.8 | unrest の傾向加算係数 |
| provinceRevoltLowHouseControlFactor | 0.2 | 低 houseControl の傾向加算係数 |
| provinceRevoltLowCountryControlFactor | 0.2 | 低 countryControl の傾向加算係数 |
| provinceRevoltStabilitySuppressionFactor | 0.2 | stability による傾向抑制係数 |
| peasantRevoltPovertyFactor | 0.5 | peasants 貧困補正係数 |
| peasantRevoltPressureFactor | 10 | peasants 人口圧補正係数 |
| townsmenRevoltProductionFactor | 0.02 | townsmen 生産量補正係数 |
| townsmenRevoltExtractionFactor | 5 | townsmen 搾取補正値 |
| nobleRevoltHouseDisloyaltyFactor | 0.2 | nobles 低忠誠度補正係数 |
| nobleRevoltLowLegitimacyFactor | 0.2 | nobles 低正統性補正係数 |
| popRevoltPowerFactorByClass | {peasants:0.02, townsmen:0.015, nobles:0.08} | class 別反乱戦力係数 |
| provinceRevoltHouseSuppressionFactor | 1.0 | House manpower の鎮圧力換算係数 |
| provinceRevoltCountrySuppressionFactor | 0.8 | Country manpower の鎮圧力換算係数 |
| provinceRevoltTreasurySuppressionFactor | 2.0 | log1p(treasury) の鎮圧力換算係数 |
| provinceRevoltHouseWealthSuppressionFactor | 2.0 | log1p(houseWealth) の鎮圧力換算係数 |
| provinceRevoltConcessionCountryControlLoss | 10 | 譲歩時の countryControl 低下量 |
| provinceRevoltConcessionHouseControlLoss | 15 | 譲歩時の houseControl 低下量 |
| provinceRevoltConcessionUnrestReduction | 20 | 譲歩時の反乱 POP unrest 低下量 |
| provinceRevoltConcessionLegitimacyLoss | 3 | 譲歩時の legitimacy 低下量 |
| provinceRevoltConcessionHouseWealthLoss | 20 | 譲歩時の House wealth 低下量 |
| provinceRevoltLordshipChangeSuccessMargin | 0.15 | lordship_change に必要な最低 successMargin |
| provinceRevoltLordshipChangeCountryControlLoss | 10 | 領主交代後の countryControl 低下量 |
| provinceRevoltNewHouseControl | 50 | 新領主の初期 houseControl |
| provinceRevoltIndependenceCountryControlMax | 10 | 独立条件: countryControl の上限 |
| provinceRevoltIndependenceHouseControlMax | 10 | 独立条件: houseControl の上限 |
| provinceRevoltIndependenceSuccessMargin | 0.20 | 独立に必要な最低 successMargin |
| provinceRevoltNewCountryControl | 40 | 独立後の新国家 countryControl |
| provinceRevoltFailedUnrestReduction | 10 | 反乱失敗時の反乱 POP unrest 低下量 |
| provinceRevoltFailedDevastation | 4 | 反乱失敗時の Province 荒廃量 |
| provinceRevoltFailedWealthPenalty | 8 | 反乱失敗時の反乱 POP wealth 低下量 |
| provinceRevoltSuppressionCollateralUnrestGain | 2 | 鎮圧時の他 class への collateral unrest |
| revoltHouseInitialLegacyPrestige | 10 | 反乱新設 House の初期 legacyPrestige（v0.11） |
| revoltHouseInitialWealth | 30 | 反乱新設 House の初期 wealth |
| revoltCountryInitialTreasury | 50 | 独立新設 Country の初期 treasury |
| revoltCountryInitialLegacyPrestige | 20 | 独立新設 Country の初期 legacyPrestige（v0.11） |
| **POP システム（v0.8）** | | |
| popSystemEnabled | true | POP システム有効 |
| minPopSizeByClass | {peasants:5, townsmen:1, nobles:1} | POP size の下限（class 別） |
| populationCapacityPerHabitability | 10 | habitability 1 あたりの人口キャパシティ |
| minProvinceCarryingCapacity | 50 | Province の最小 carrying capacity |
| productivityByClass | {peasants:1.0, townsmen:1.5, nobles:0.6} | POP 生産性係数（class 別） |
| manpowerFactorByClass | {peasants:0.03, townsmen:0.01, nobles:0.06} | 兵力換算係数（class 別） |
| baseMonthlyGrowthByClass | {peasants:0.0010, townsmen:0.0008, nobles:0.0004} | 月次基本成長率（class 別） |
| populationPressureThreshold | 0.90 | pressure がこれを超えると wealth/unrest に影響 |
| populationPressureWealthPenalty | 0.2 | pressure 超過時の wealth 低下係数 |
| populationPressureUnrestGain | 0.3 | pressure 超過時の unrest 上昇係数 |
| povertyWealthThreshold | 25 | 貧困閾値（これ未満で unrest 上昇） |
| povertyUnrestGain | 0.02 | 貧困による unrest 上昇係数 |
| prosperityWealthThreshold | 70 | 繁栄閾値（これ超過で unrest 低下） |
| prosperityUnrestReduction | 0.01 | 繁栄による unrest 低下係数 |
| retainedWealthGainByClass | {peasants:0.30, townsmen:0.45, nobles:0.25} | 残留富 1 に対する wealth 増加量（class 別） |
| overExtractionThreshold | 0.95 | 過剰徴収判定の回収率閾値 |
| overExtractionWealthSafeThreshold | 55 | この wealth 以上ならペナルティ回避 |
| overExtractionUnrestSafeThreshold | 45 | この unrest 以下ならペナルティ回避 |
| overExtractionWealthPenalty | 1.0 | 過剰徴収による wealth 低下係数 |
| overExtractionUnrestGain | 1.5 | 過剰徴収による unrest 上昇係数 |
| **POP 自主開発（v0.8）** | | |
| popDevelopmentEnabled | true | POP 自主開発有効 |
| popDevelopmentMonthlyChance | 0.02 | 月次発動基本確率 |
| popDevelopmentMaxMonthlyChance | 0.08 | 月次発動確率の上限 |
| popDevelopmentWealthThreshold | 65 | 発動に必要な最低 avgWealth |
| popDevelopmentUnrestMax | 35 | 発動を阻害する unrest 上限 |
| popDevelopmentWealthChanceFactor | 0.001 | wealth による確率上昇係数 |
| popDevelopmentUnrestPenaltyFactor | 0.0005 | unrest による確率低下係数 |
| popDevelopmentCost | 3 | 発動時の全 POP wealth 低下量 |
| popDevelopmentGain | 0.25 | 発動時の development 上昇量 |
| popDevelopmentMaxDevelopment | 40 | POP 自主開発の development 上限 |
| **Attitude システム（v0.11）** | | |
| attitudeMonthlyRetentionRate | 0.995 | 態度の月次保持率（1-rate が減衰率） |
| initialCountryLegacyPrestigeMin | 20 | Country 初期 legacyPrestige の下限 |
| initialCountryLegacyPrestigeMax | 60 | Country 初期 legacyPrestige の上限 |
| initialHouseLegacyPrestigeMin | 20 | House 初期 legacyPrestige の下限 |
| initialHouseLegacyPrestigeMax | 80 | House 初期 legacyPrestige の上限 |
| initialPersonLegacyPrestigeMin | 0 | Person 初期 legacyPrestige の下限 |
| initialPersonLegacyPrestigeMax | 20 | Person 初期 legacyPrestige の上限 |
| rulerHouseExtinctionPrestigeLoss | 10 | 支配家断絶時の旧 Country legacyPrestige 低下量 |
| rulerExtinctionAnnexPrestigeWeight | 0.3 | 支配家断絶・併合時の legacyPrestige 継承重み |

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
// 国庫収入 *= taxEfficiency。家収入・POP wealth への影響なし
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
- **DetailPanel**: 選択エンティティ（Province / Country / House / Person / PopGroup）の詳細表示
  - ProvinceDetail:
    - **Population** セクション: habitability / Carrying Capacity / Total Population / Pop. Pressure（90% 超で赤表示）/ Avg Wealth / Unrest（60 超で赤表示）/ Production / Country Manpower / House Manpower
    - **POP Groups** セクション: class 別に size / wealth / unrest（60 超で赤表示）を一覧表示。各 POP カードはクリッカブルで PopGroupDetail へ遷移（v0.11）
    - **Revolt Risk** セクション: class 別反乱傾向値（Peasants / Townsmen / Nobles）
  - CountryDetail: 首都名（capitalProvinceId）/ Legitimacy（セレクター値）/ treasury / Total Military Power（Ruler House / Loyalist 内訳）
  - HouseDetail: 本拠地名（seatProvinceId）/ Province 数 / wealth / Prestige（セレクター値）/ Military（Levy / Mercenary / Commander Modifier / Total）
  - PersonDetail: 基本情報 / Stats / Traits / Family リンク / **Attitudes セクション**（v0.11）: 対エンティティの affection/respect を色分け表示。エンティティ名クリックで遷移
  - **PopGroupDetail**（v0.11）: size / wealth / unrest（60 超で赤表示）/ 所属 Province リンク / **Attitudes セクション**
- **EventLog**: Chronicle（major/critical）と全イベントの 2 ビュー
- **ConfigPanel**: シミュレーションパラメータをリアルタイム調整

---

## 12. 今後の課題（未実装）

- **大分裂（House 独立）**: 全土統一後、国力が一定規模を超えると支配家から傍系家が独立し複数国家が成立する「中国史的分裂」メカニズム。現状は Province Revolt から新勢力が生まれるが、House 単位での大規模独立はまだ弱い
- **国家規模ペナルティ**: Province 数・House 数が増えるほど Legitimacy（getCountryLegitimacy）が低下しやすくなり、大国が自重で崩れる仕組み
- **家の分裂の作り込み**: Attitude 経由の cohesion 変動をより細かく制御、分裂閾値の調整、一強状態でも分裂が自然発生する仕組み
- **POP_HARDSHIP / POP_PROSPERITY / POP_UNREST_RISING / POP_DECLINED イベントの発火ロジック**: 閾値超過時のみ発火する条件付きイベント（EventType 宣言のみ実装済み）
- **首都・本拠地移転**: 征服・滅亡・特別イベントによる移転
- **記念碑エンティティ化**: 建設場所、継続効果、破壊、monumentLevel
- **POP の移住**: population pressure・wealth・unrest・戦争荒廃に応じた Province 間移動
- **文化・宗教**: PopGroup への cultureId / religionId 追加、同化・改宗・弾圧・寛容政策
- **食料生産**: carrying capacity / population pressure を foodProduction / foodDemand に拡張
- **詳細な戦争**: War エンティティ、戦場、包囲戦
- **施設システム**: 城塞・道路・港・市場
- **詳細外交**: 同盟・条約・婚姻
- **継承権・請求権**: 血縁関係に基づく他家への継承権主張
- **House の多国所領**: House が複数 Country に所領を持つ仕組み
