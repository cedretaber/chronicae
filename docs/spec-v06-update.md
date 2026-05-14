# Chronicae v0.6 仕様書 — 人物能力効果システム

## 1. 目的

v0.6 では、既存の人物能力値（`stats` / `traits`）を、役職任命や重要度スコアだけでなく、国家・家・Province の実際の推移により強く反映させる。

現在の実装では、人物能力は主に以下に使われている。

* 役職任命時の候補者スコア
* 家の軍事力算出における `martial` 最大値
* 陰謀・反乱の発動傾向
* UI 上の重要度スコア

v0.6 ではこれを拡張し、以下のような歴史的変化が自然に発生することを目指す。

* 優秀な宰相のもとで国家支配力が伸びる
* 無能な宰相の時代に辺境支配が弱まる
* 優秀な家長のもとで家領支配が強まる
* 無能な家長のもとで辺境領が隣接有力家に吸収されやすくなる
* 優秀な財務官のもとで国庫収入が改善する
* 名将の存在が戦争勝率に影響する
* 野心的で大胆な将軍のもとで積極的な戦争が起こりやすくなる
* 慎重で低野心な宰相のもとで土地開発や財政安定が選好される
* `ambition` と `caution` はどちらの方向にも意味があり、人物像に立体性が生まれる

## 2. 基本方針

v0.6 では新しい能力値は追加しない。

既存の `Person` が持つ以下の値を、既存システムへ接続する。

```ts
type Person = {
  stats: {
    admin: number    // 0..10
    martial: number  // 0..10
  }
  traits: {
    ambition: number          // 0.0..1.0
    loyaltyToCountry: number  // 0.0..1.0
    caution: number           // 0.0..1.0
  }
}
```

各値の意味づけは以下とする。

| 能力・特性              | v0.6 での意味                 |
| ------------------ | ------------------------- |
| `admin`            | 統治、支配力維持、税務、開発実務に影響する     |
| `martial`          | 戦争時の軍事力、戦争勝率に影響する         |
| `ambition`         | **忠実・現状維持 ↔ 野心的・栄光志向** の軸。高ければ拡張・記念碑・宣戦を促進する。低ければ国家・主君への忠実さを表す |
| `loyaltyToCountry` | 国家への協力、反乱抑制、役職適性に影響する     |
| `caution`          | **大胆・即断 ↔ 慎重・堅実** の軸。高ければ土地開発・財政安定・戦争抑制を促進する。低ければ大胆さ・好機への突進を表す |

`ambition` と `caution` は高低どちらにも長所と短所がある価値中立な性格軸であり、状況によって優位性が変わる。

実装補助変数として以下を定義する。

```ts
const ambition   = person.traits.ambition   // 0.0..1.0 (低=忠実・現状維持, 高=野心的・栄光志向)
const caution    = person.traits.caution    // 0.0..1.0 (低=大胆・即断, 高=慎重・堅実)
const lowAmbition = 1 - ambition  // 高いほど「忠実・自己抑制・現状維持」
const boldness    = 1 - caution   // 高いほど「大胆・即断・賭けに出る」
```

ただし、計算式では `normalizedTrait` を通じて中立値（0.5）からの差分として扱うため、`lowAmbition`/`boldness` を直接数値として使うのではなく、既存の `normalizedTrait` 関数と係数の符号で表現する（§4.2 参照）。

典型的な人物像として次のような組み合わせが自然に生まれることを意図する。

| ambition | caution | 人物像              | 傾向                           |
| -------: | ------: | ---------------- | ---------------------------- |
|        高 |       低 | 野心的で大胆な征服者・改革者  | 征服・記念碑・無謀な賭け。成功すれば英雄、失敗すれば危機 |
|        高 |       高 | 慎重な野心家・計画者      | 好機を待ちながら着実に動く陰謀家・長期戦略家       |
|        低 |       低 | 忠実で大胆な猛将        | 主君のために危険を厭わない。判断は危ういが行動力がある  |
|        低 |       高 | 堅実な官僚・守成の宰相     | 反乱せず・財政を守り・土地開発を進める。拡張力は低い   |

設計上の原則は以下とする。

* `admin` / `martial` は「できるか」を表す
* `traits` は「どう使うか」を表す
* 能力補正は単発で世界を壊すほど大きくしない
* 毎月・毎年の積み重ねで差が出るようにする
* v0.6 では地方官、血縁、人物間関係、複数将軍制などは扱わない

## 3. 追加 Config

`SimulationConfig` に以下を追加する。

```ts
// v0.6 Person Ability Effects
personAbilityEffectsEnabled: boolean

// Chancellor / country control
chancellorAdminControlGrowthEffect: number
chancellorAdminControlMaxBonusPerAdmin: number

// House head / house control
houseHeadAdminControlGrowthEffect: number
houseHeadAdminControlMaxBonusPerAdmin: number

// Treasurer / economy
treasurerAdminTaxEfficiencyEffect: number
treasurerCautionTaxEfficiencyEffect: number
treasurerTaxEfficiencyMin: number
treasurerTaxEfficiencyMax: number
treasurerAdminDevelopmentCostEffect: number

// General / war
generalMartialWarPowerEffect: number
generalAmbitionDeclareThresholdEffect: number
generalCautionDeclareThresholdEffect: number
minWarDeclareThreshold: number
maxWarDeclareThreshold: number

// Public spending personality effects
chancellorAmbitionMonumentScoreEffect: number
chancellorCautionMonumentScoreEffect: number
chancellorAmbitionLandDevelopmentScoreEffect: number
chancellorCautionLandDevelopmentScoreEffect: number

// House development personality effects
houseHeadAdminDevelopmentChanceEffect: number
houseHeadCautionDevelopmentChanceEffect: number

// Control system ability floor
controlAbilityMinimumFloor: number
```

デフォルト値は以下とする。

| 項目                                            |  デフォルト | 説明                                          |
| --------------------------------------------- | -----: | ------------------------------------------- |
| `personAbilityEffectsEnabled`                 | `true` | v0.6 の人物能力補正を有効化                            |
| `chancellorAdminControlGrowthEffect`          | `0.25` | 宰相 admin による国家支配力成長補正。admin 0..10 で ±25%    |
| `chancellorAdminControlMaxBonusPerAdmin`      |    `1` | 宰相 admin 1 差あたりの国家支配力上限補正                   |
| `houseHeadAdminControlGrowthEffect`           | `0.25` | 家長 admin による家支配力成長補正。admin 0..10 で ±25%     |
| `houseHeadAdminControlMaxBonusPerAdmin`       |    `1` | 家長 admin 1 差あたりの家支配力上限補正                    |
| `treasurerAdminTaxEfficiencyEffect`           | `0.15` | 財務官 admin による国税収補正                          |
| `treasurerCautionTaxEfficiencyEffect`         | `0.10` | 財務官 caution による国税収補正                        |
| `treasurerTaxEfficiencyMin`                   |  `0.8` | 国税収補正の下限                                    |
| `treasurerTaxEfficiencyMax`                   |  `1.2` | 国税収補正の上限                                    |
| `treasurerAdminDevelopmentCostEffect`         | `0.10` | 財務官 admin による国家土地開発コスト補正。最大 ±10%            |
| `generalMartialWarPowerEffect`                | `0.15` | 将軍 martial による戦争時軍事力補正。martial 0..10 で ±15% |
| `generalAmbitionDeclareThresholdEffect`       | `0.10` | 将軍 ambition による宣戦閾値低下補正                     |
| `generalCautionDeclareThresholdEffect`        | `0.10` | 将軍 caution による宣戦閾値上昇補正                      |
| `minWarDeclareThreshold`                      | `0.30` | 補正後宣戦閾値の下限                                  |
| `maxWarDeclareThreshold`                      | `0.75` | 補正後宣戦閾値の上限                                  |
| `chancellorAmbitionMonumentScoreEffect`          |   `20` | 宰相 ambition による記念碑スコア補正（高野心→+、低野心→−）           |
| `chancellorCautionMonumentScoreEffect`           |   `10` | 宰相 caution による記念碑スコア補正（大胆→+、慎重→−）              |
| `chancellorAmbitionLandDevelopmentScoreEffect`   |   `10` | 宰相 ambition による土地開発スコア補正（低野心→+、高野心→−）          |
| `chancellorCautionLandDevelopmentScoreEffect`    |   `20` | 宰相 caution による土地開発スコア補正（慎重→+、大胆→−）             |
| `houseHeadAdminDevelopmentChanceEffect`       | `0.10` | 家長 admin による家土地開発発動率補正                      |
| `houseHeadCautionDevelopmentChanceEffect`     | `0.10` | 家長 caution による家土地開発発動率補正                    |
| `controlAbilityMinimumFloor`                  |   `35` | 能力補正後の支配力上限の絶対下限。`controlMaxMinimum = 40` より低く設定し、無能な人物の辺境ペナルティを機能させる |

## 4. 能力補正ユーティリティ

各 System に直接計算式を重複実装しないため、人物能力補正用の selector / utility を追加する。

推奨ファイル例:

```txt
prototype/src/sim/selectors/personAbilityEffects.ts
```

### 4.1 無効化の一元管理

`personAbilityEffectsEnabled === false` の場合、各 System に個別の分岐を持たせるのではなく、**このファイル内の補正関数が常に中立値を返す**ことで無効化を実現する。

```ts
// personAbilityEffects.ts の各補正関数は config を受け取り、
// personAbilityEffectsEnabled === false のときは中立値を返す。
// 各 System 側は personAbilityEffectsEnabled を参照しない。
```

これにより、各 System の実装は `personAbilityEffectsEnabled` を意識せず、常に補正関数の返り値をそのまま使う。

### 4.2 基本 helper

```ts
function normalizedStat(value: number): number {
  // 0..10 を -1..+1 に変換する。5 が中立。
  return (value - 5) / 5
}

function normalizedTrait(value: number): number {
  // 0.0..1.0 を -0.5..+0.5 に変換する。0.5 が中立。
  return value - 0.5
}
```

### 4.3 役職者取得 helper

既存の `roleAssignments` を参照し、死亡人物や存在しない人物は無視する。

```ts
// 役職者（chancellor / general / treasurer）を取得する。
// 役職が空席、または担当者が死亡している場合は undefined を返す。
function getAssignedLivingPerson(
  state: WorldState,
  country: Country,
  role: RoleType,
): Person | undefined

// 人物 ID から生存人物を取得する。
// 死亡している場合は undefined を返す。家長取得などに使用する。
function getLivingPerson(
  state: WorldState,
  personId: PersonId,
): Person | undefined
```

`WorldState` は `prototype/src/sim/types/world.ts` の既存型を使用する。

**家長について**: SuccessionSystem により `house.headId` は常に生存人物を指すことが保証されているため、`getLivingPerson` の undefined 戻り値は理論上発生しない。ただし型安全のためガードは必要。

該当役職者が存在しない場合、各補正は中立値として扱う。

中立値:

* `admin`: 5
* `martial`: 5
* `ambition`: 0.5
* `loyaltyToCountry`: 0.5
* `caution`: 0.5

## 5. ControlSystem への補正

### 5.1 宰相 admin による countryControl 補正

国家支配力の成長量と上限に、宰相の `admin` を反映する。

対象:

* `countryControl` の月次成長量
* `countryControl` の距離別上限

補正式:

```ts
const chancellor = getAssignedLivingPerson(state, country, 'chancellor')
const admin = chancellor?.stats.admin ?? 5

const growthModifier =
  1 + normalizedStat(admin) * config.chancellorAdminControlGrowthEffect

const maxControlBonus =
  (admin - 5) * config.chancellorAdminControlMaxBonusPerAdmin
```

`countryControl` の到達可能 Province 更新時、既存の `controlGrowthPerMonth` に `growthModifier` を掛ける。

```ts
const effectiveGrowth = config.controlGrowthPerMonth * growthModifier
```

距離別上限は以下とする。

```ts
const baseMaxControl = clamp(
  100 - distance * config.controlMaxDistancePenalty,
  config.controlMaxMinimum,
  100,
)

const maxControl = clamp(
  baseMaxControl + maxControlBonus,
  config.controlAbilityMinimumFloor,  // 能力補正後の絶対下限（35）
  100,
)
```

`baseMaxControl` の clamp には `controlMaxMinimum = 40` を使い、能力補正後の clamp には `controlAbilityMinimumFloor = 35` を使う。これにより、`admin = 0` の宰相は辺境の支配力上限を最大 35 まで引き下げることができる。

ただし、首都 Province の `countryControl` 上限は常に 100 とする。

```ts
if (province.id === country.capitalProvinceId) {
  maxControl = 100
}
```

**`applyControl` 関数への受け渡し方針**: 現在の `applyControl(current, distance, config)` は config のみを受け取っている。v0.6 では呼び出し側（国ループ・家ループ）で `effectiveGrowth` と `maxControl` を算出し、`applyControl` に渡す。関数シグネチャを `applyControl(current, maxControl, effectiveGrowth, config)` の形に拡張する。

### 5.2 家長 admin による houseControl 補正

家支配力の成長量と上限に、家長の `admin` を反映する。

対象:

* `houseControl` の月次成長量
* `houseControl` の距離別上限

補正式:

```ts
const head = getLivingPerson(state, house.headId)
const admin = head?.stats.admin ?? 5

const growthModifier =
  1 + normalizedStat(admin) * config.houseHeadAdminControlGrowthEffect

const maxControlBonus =
  (admin - 5) * config.houseHeadAdminControlMaxBonusPerAdmin
```

`houseControl` の到達可能 Province 更新時、既存の `controlGrowthPerMonth` に `growthModifier` を掛ける。

```ts
const effectiveGrowth = config.controlGrowthPerMonth * growthModifier
```

距離別上限は以下とする。

```ts
const baseMaxControl = clamp(
  100 - distance * config.controlMaxDistancePenalty,
  config.controlMaxMinimum,
  100,
)

const maxControl = clamp(
  baseMaxControl + maxControlBonus,
  config.controlAbilityMinimumFloor,  // 能力補正後の絶対下限（35）
  100,
)
```

ただし、本拠地 Province の `houseControl` 上限は常に 100 とする。

```ts
if (province.id === house.seatProvinceId) {
  maxControl = 100
}
```

## 6. EconomySystem への補正

### 6.1 財務官 admin / caution による国税収補正

財務官の `admin` と `caution` によって、国家収入に補正を加える。

対象は `countryIncome` のみとし、`houseIncome` には直接影響しない。

これにより、財務官の能力は「国家官僚制・徴税実務の効率」として表現される。

補正式:

```ts
const treasurer = getAssignedLivingPerson(state, country, 'treasurer')
const admin = treasurer?.stats.admin ?? 5
const caution = treasurer?.traits.caution ?? 0.5

const taxEfficiency = clamp(
  1
    + normalizedStat(admin) * config.treasurerAdminTaxEfficiencyEffect
    + normalizedTrait(caution) * config.treasurerCautionTaxEfficiencyEffect,
  config.treasurerTaxEfficiencyMin,
  config.treasurerTaxEfficiencyMax,
)
```

既存の EconomySystem において、支配力によって算出された `countryIncome` に対して適用する。

```ts
countryIncome *= taxEfficiency
```

### 6.2 収入ロスとの関係

v0.5 の EconomySystem では、`countryControl` / `houseControl` が低い場合に収入ロスが発生する。このロス構造は以下の式に由来する。

```ts
const cc = province.countryControl / 100
const hc = province.houseControl / 100
const totalControl = cc + hc

const countryIncome = provinceIncome * (cc / totalControl) * cc
const houseIncome   = provinceIncome * (hc / totalControl) * hc
```

各勢力の収入は「支配力比率で按分した後、さらにその支配力を掛ける」構造になっており、支配力が低いほど二乗的に収入が減少する。合計収入 `countryIncome + houseIncome` は常に `provinceIncome` 以下となり、差分がロスとなる。

| countryControl | houseControl | 国収入 | 家収入 | ロス |
|---|---|---|---|---|
| 100 | 100 | 50 | 50 | 0 |
| 100 | 50 | 66.7 | 16.7 | 16.6 |
| 50 | 50 | 25 | 25 | 50 |
| 100 | 0 | 100 | 0 | 0 |

（Province 収入 = 100 の場合）

v0.6 の財務官補正は、このロス構造を置き換えない。

計算順は以下とする。

1. Province の実効税収を計算
2. `countryControl` / `houseControl` に基づいて国・家の基礎収入を算出（ロス発生）
3. 国収入にのみ `taxEfficiency` を掛ける
4. 国庫・家 wealth に加算する

つまり、財務官は支配力不足そのものを消すのではなく、国家が徴収できた分を効率よく処理する。支配力が低い Province では財務官が優秀でも収入は小さいままである。

## 7. WarSystem への補正

### 7.1 将軍 martial による戦争軍事力補正

戦争勝率計算において、攻撃国・防衛国それぞれの将軍 `martial` を軍事力補正として反映する。

補正式:

```ts
const general = getAssignedLivingPerson(state, country, 'general')
const martial = general?.stats.martial ?? 5

const warPowerModifier =
  1 + normalizedStat(martial) * config.generalMartialWarPowerEffect
```

国家の基礎軍事力に対して適用する。

```ts
const effectiveMilitaryPower = baseMilitaryPower * warPowerModifier
```

この補正は攻撃側・防衛側の双方に適用する。

**既存計算との関係**: 基礎軍事力（`calcCountryMilitaryPower`）はすでに House メンバー全員の `martial` 最大値 × 2 を含んでいる。v0.6 の `warPowerModifier` はこれに乗算する「指揮官として全軍をまとめる能力補正」として位置づける。二重反映を避けるため、デフォルト値を `0.15`（±15%）に抑える。

### 7.2 将軍 ambition / caution による宣戦判断補正

将軍の性格は、戦争勝率そのものではなく、宣戦判断の閾値に影響させる。

補正式:

```ts
const general = getAssignedLivingPerson(state, attacker, 'general')
const ambition = general?.traits.ambition ?? 0.5
const caution = general?.traits.caution ?? 0.5

const effectiveMinWinChanceToDeclare = clamp(
  config.minAttackerWinChanceToDeclare
    - normalizedTrait(ambition) * config.generalAmbitionDeclareThresholdEffect
    + normalizedTrait(caution) * config.generalCautionDeclareThresholdEffect,
  config.minWarDeclareThreshold,
  config.maxWarDeclareThreshold,
)
```

宣戦条件は以下に変更する。

```ts
if (estimatedWinChance >= effectiveMinWinChanceToDeclare) {
  // declare war
}
```

`generalAmbitionDeclareThresholdEffect = 0.10` / `generalCautionDeclareThresholdEffect = 0.10` の場合、最大補正は ±0.05（5ポイント）。基準値 `minAttackerWinChanceToDeclare = 0.45` に対して `0.40〜0.50` の範囲に収まる。`%` ではなく閾値の**絶対値ポイント**で動く点に注意。

これにより、以下の差が発生する。

| 将軍                   | 挙動            |
| -------------------- | ------------- |
| martial 高・ambition 高 | 勝てる戦争を積極的に始める |
| martial 高・caution 高  | 勝率の高い戦争だけを選ぶ  |
| martial 低・ambition 高 | 無謀な戦争を始めやすい   |
| martial 低・caution 高  | 戦争を避けやすい      |

## 8. PublicSpendingSystem への補正

### 8.1 宰相 ambition / caution による支出方針補正

公共支出の選択に、宰相の性格を反映する。

`ambition` と `caution` は価値中立な軸であり、記念碑・土地開発への選好は両方の特性の組み合わせで決まる。

* 野心的（`ambition` 高）で大胆（`caution` 低）な宰相は記念碑を最も好む
* 慎重（`caution` 高）で低野心（`ambition` 低）な宰相は土地開発を最も好む
* 野心的（`ambition` 高）でも慎重（`caution` 高）な宰相は、記念碑への傾きが相殺されてやや抑制される

**`rulerHead.traits` との役割分担**: 既存実装では支配家家長（`rulerHead`）の traits が `monumentScore` / `landDevelopmentScore` の主要な推進力になっている（例: `rulerHead.traits.ambition * 30`）。これは「君主・支配家の政治的意志」を表す。v0.6 の宰相補正は、この既存計算を置き換えるのではなく**追加補正**として加算する。これにより「実務官僚（宰相）の性格が君主の意志を補強・緩和する」という構造になる。

既存の `monumentScore` / `landDevelopmentScore` に補正を加える。

```ts
const chancellor = getAssignedLivingPerson(state, country, 'chancellor')
const ambition = chancellor?.traits.ambition ?? 0.5
const caution = chancellor?.traits.caution ?? 0.5

// 記念碑スコア補正:
//   ambition 高（野心的）→ +、ambition 低（忠実）→ −
//   caution 低（大胆）  → +、caution 高（慎重）  → −
monumentScore +=
  normalizedTrait(ambition) * config.chancellorAmbitionMonumentScoreEffect
  - normalizedTrait(caution) * config.chancellorCautionMonumentScoreEffect

// 土地開発スコア補正:
//   caution 高（慎重）  → +、caution 低（大胆）  → −
//   ambition 低（忠実） → +、ambition 高（野心的）→ −
landDevelopmentScore +=
  normalizedTrait(caution) * config.chancellorCautionLandDevelopmentScoreEffect
  - normalizedTrait(ambition) * config.chancellorAmbitionLandDevelopmentScoreEffect
```

`caution` の記念碑補正で符号が `-` になっている点に注意。`normalizedTrait(caution)` は caution が高いほど正値になるが、記念碑への寄与は「大胆さ（=低 caution）」が正なので反転する。

### 8.2 財務官 admin による国家土地開発コスト補正

国家土地開発のコストに、財務官 `admin` を反映する。

補正式:

```ts
const treasurer = getAssignedLivingPerson(state, country, 'treasurer')
const admin = treasurer?.stats.admin ?? 5

const costModifier =
  1 - normalizedStat(admin) * config.treasurerAdminDevelopmentCostEffect

const effectiveCost = Math.max(1, Math.round(
  config.countryLandDevelopmentBaseCost * costModifier,
))
```

`admin = 10` なら最大 10% 安くなり、`admin = 0` なら最大 10% 高くなる。

財政チェックおよび国庫減算には補正後の `effectiveCost` を使用する。

```ts
// 財政チェック
if (country.treasury < effectiveCost) continue

// 国庫減算
updatedCountry.treasury -= effectiveCost
```

これにより、優秀な財務官は本来実行できなかった土地開発を可能にする場合がある。

## 9. HouseDevelopmentSystem への補正

### 9.1 家長 admin / caution による家土地開発発動率補正

家の土地開発発動率に、家長の `admin` と `caution` を反映する。

* `admin` が高い家長は開発を実務的に進めやすい
* `caution` が高い家長は安定的な土地開発を好みやすい

補正式:

```ts
const head = getLivingPerson(state, house.headId)
const admin = head?.stats.admin ?? 5
const caution = head?.traits.caution ?? 0.5

const abilityChanceBonus =
  normalizedStat(admin) * config.houseHeadAdminDevelopmentChanceEffect
  + normalizedTrait(caution) * config.houseHeadCautionDevelopmentChanceEffect
```

既存の発動確率に加算する。

```ts
// wealthBonus は既存実装の wealth による上乗せ（上限 baseChance + 0.25 でクリップ済み）
// abilityChanceBonus を加算した後、最終的に 0..1 でクランプする
const chance = clamp(
  baseChance + wealthBonus + abilityChanceBonus,
  0,
  1,
)
```

**wealth bonus との上限関係**: 既存実装では wealth bonus は `houseDevelopmentYearlyChance + 0.25` を上限として先にクリップされる。人物能力補正はその後に加算し、最終的に `1.0` でクリップする。

## 10. AppointmentSystem との関係

v0.6 では AppointmentSystem の基本構造は変更しない。

ただし、役職者能力が各システムに直接影響するようになるため、任命結果の重要度が上がる。

既存の任命スコアは当面維持する。

将来的には、v0.6 実装後の挙動を見て以下を検討する。

* 宰相任命における `loyaltyToCountry` の重み調整
* 財務官任命における `caution` の重み調整
* 将軍任命における `ambition` ペナルティまたはボーナス
* 支配家との関係、家門バランス、派閥性の導入

v0.6 の範囲では、任命ロジックの大改修は行わない。

## 11. AmbitionSystem / RebellionSystem との関係

v0.6 では AmbitionSystem / RebellionSystem の基本式は変更しない。

ただし、ControlSystem への能力補正により、間接的に反乱・領主交代が起こりやすくなる。

例:

1. 無能な宰相により辺境 `countryControl` が伸びない
2. 国家収入と安定が弱くなる
3. 家の不満・野心が抑えきれなくなる
4. 反乱が発生しやすくなる

または、

1. 無能な家長により辺境 `houseControl` が伸びない
2. 隣接有力家の `houseControl` が相対的に強くなる
3. LordshipTransitionSystem により Province が吸収される

このように、v0.6 では人物能力を直接反乱式に足すのではなく、支配力・経済・戦争を通じて間接的な歴史変化を増やす。

## 12. イベント

v0.6 では、人物能力補正そのものによる新規イベントは必須としない。

ただし、デバッグ・観察性向上のため、将来的に以下のようなイベントを追加できる余地を残す。

* `EXCELLENT_CHANCELLOR_GOVERNS`
* `POOR_CHANCELLOR_WEAKENS_CONTROL`
* `EXCELLENT_TREASURER_IMPROVES_REVENUE`
* `GREAT_GENERAL_LEADS_ARMY`

v0.6 では、既存イベントの発生頻度・結果の変化によって能力差を観察することを優先する。

## 13. UI 表示

v0.6 では UI の大改修は行わない。

ただし、DetailPanel に以下を表示できると望ましい。

### CountryDetail

* 宰相名と admin
* 財務官名と admin / caution
* 将軍名と martial
* 国税収補正値
* 国家支配力成長補正値
* 戦争軍事力補正値

### HouseDetail

* 家長名と admin / caution
* 家支配力成長補正値
* 家土地開発発動率補正値

### PersonDetail

既存の stats / traits 表示がある場合は維持する。

可能であれば、その人物が現在役職に就いている場合、役職効果の概要を表示する。

例:

```txt
宰相効果: 国家支配力成長 +15%、支配力上限 +3
財務官効果: 国税収 +8%、土地開発費 -6%
将軍効果: 軍事力 +20%、宣戦閾値 -3%
```

## 14. テスト方針

### 14.1 Unit Test

以下の補正 selector / utility を単体テストする。

* `normalizedStat`
* `normalizedTrait`
* 宰相 admin による countryControl growth modifier
* 宰相 admin による countryControl max bonus
* 家長 admin による houseControl growth modifier
* 財務官 admin / caution による tax efficiency
* 将軍 martial による war power modifier
* 将軍 ambition / caution による declare threshold
* 財務官 admin による development cost modifier
* 家長 admin / caution による house development chance bonus

境界値として以下を確認する。

* stat 0 / 5 / 10
* trait 0.0 / 0.5 / 1.0
* clamp 下限・上限
* 役職者不在時に中立値になること
* 死亡役職者が無視されること

### 14.2 Integration Test

#### ControlSystem

* admin 10 の宰相を持つ国は、admin 5 の国より countryControl が速く伸びる
* admin 0 の宰相を持つ国は、admin 5 の国より countryControl が遅く伸びる
* 首都 Province の上限は常に 100
* admin 10 の家長を持つ家は、admin 5 の家より houseControl が速く伸びる
* 本拠地 Province の上限は常に 100

#### EconomySystem

* 財務官 admin 10 / caution 1.0 の国は国税収が増える
* 財務官 admin 0 / caution 0.0 の国は国税収が減る
* houseIncome は財務官補正で直接変化しない

#### WarSystem

* martial 10 の将軍を持つ国は、martial 5 の国より戦争勝率が上がる
* ambition 1.0 の将軍を持つ国は宣戦閾値が下がる
* caution 1.0 の将軍を持つ国は宣戦閾値が上がる
* 閾値は `minWarDeclareThreshold` / `maxWarDeclareThreshold` に clamp される

#### PublicSpendingSystem

* ambition 高の宰相は記念碑建設を選びやすくなる
* caution 高の宰相は土地開発を選びやすくなる
* admin 高の財務官は国家土地開発費を軽減する

#### HouseDevelopmentSystem

* admin / caution 高の家長は家土地開発を実行しやすくなる

### 14.3 CLI Smoke Test

以下を確認する。

```bash
cd prototype
npm run check
npm run cli -- --seed 1 --years 50 --integrity-check
npm run cli -- --seed 2 --years 50 --integrity-check
npm run cli -- --seed 3 --years 50 --integrity-check
```

確認観点:

* integrity check が失敗しない
* 国庫・家 wealth が極端に爆発しない
* 戦争頻度が極端に増えすぎない
* 全国家が早期に消滅しない
* LordshipTransition が過剰発生しない

## 15. 実装範囲

v0.6 で実装する。

* `SimulationConfig` への項目追加
* 人物能力補正 selector / utility の追加
* ControlSystem への宰相 / 家長 admin 補正
* EconomySystem への財務官 admin / caution 補正
* WarSystem への将軍 martial / ambition / caution 補正
* PublicSpendingSystem への宰相 ambition / caution、財務官 admin 補正
* HouseDevelopmentSystem への家長 admin / caution 補正
* 必要な Unit Test / Integration Test
* 可能であれば DetailPanel への補正表示

v0.6 では実装しない。

* 新能力値の追加
* 新 traits の追加
* 地方官・総督・代官システム
* 人物間関係
* 血縁・婚姻
* 汚職システム
* War エンティティ化
* 複数将軍・軍団制
* POP システム
* 外交関係

## 16. 期待される挙動

v0.6 実装後、以下のような差が観察できることを期待する。

### 優秀な宰相の時代

* `countryControl` が伸びやすい
* 遠隔地の支配上限がやや高い
* 国庫収入が安定しやすい
* 長期的に国家がまとまりやすい

### 無能な宰相の時代

* `countryControl` が伸びにくい
* 遠隔地支配が弱くなりやすい
* 支配力不足による収入ロスが増えやすい
* 反乱や国家分裂の遠因になりやすい

### 優秀な家長の時代

* `houseControl` が伸びやすい
* 家領がまとまりやすい
* 土地開発が進みやすい
* 隣接領主に吸収されにくい

### 無能な家長の時代

* `houseControl` が伸びにくい
* 辺境領が弱くなりやすい
* 隣接有力家に Province を吸収されやすい

### 名将の時代

* 戦争勝率が上がる
* 国家が拡大しやすい
* ただし ambition が高い場合、無謀な戦争も増える

### 慎重な指導者の時代

* 土地開発や財政安定を選びやすい
* 戦争を避けやすい
* 急拡大はしにくいが、内部は安定しやすい

## 17. バランス調整方針

v0.6 の人物能力補正は、初期値では控えめに設定する。

目安:

| 対象       |              最大補正 |
| -------- | ----------------: |
| 支配力成長    |              ±25% |
| 支配力上限    |           ±5ポイント |
| 国税収      |         0.8〜1.2 倍 |
| 戦争軍事力    |              ±15% |
| 宣戦判断閾値   | ±0.05（絶対値5ポイント） |
| 国家土地開発費  |              ±10% |
| 家土地開発発動率 |         おおむね ±7.5% |

補正値が強すぎる場合は、以下の順に弱める。

1. 税収補正
2. 戦争軍事力補正
3. 支配力上限補正
4. 宣戦閾値補正

特に税収補正と戦争補正は、雪だるま式の拡大を生みやすいため注意する。

## 18. 将来拡張への接続

v0.6 は、将来の以下のシステムへの土台となる。

* 人物間関係
* 派閥
* 宮廷政治
* 忠誠対象の階層化
* 家門間外交
* 官僚制
* 地方官・総督
* 汚職
* POP・文化・宗教
* 詳細外交
* 継承権・請求権

特に、今後 `loyaltyToCountry` を以下のように分解する可能性がある。

* 国家への忠誠
* 支配家への忠誠
* 自家への忠誠
* 個人主君への忠誠
* 宗教・文化共同体への忠誠

ただし v0.6 では、既存の単一 `loyaltyToCountry` を維持する。

## 19. まとめ

v0.6 では、既存の人物能力を以下の形で世界の動きに反映する。

| 人物  | 能力       | 影響先              |
| --- | -------- | ---------------- |
| 宰相  | admin    | 国家支配力の成長・上限      |
| 宰相  | ambition | 記念碑建設志向（+）、土地開発志向（−）|
| 宰相  | caution  | 土地開発志向（+）、記念碑建設志向（−）|
| 財務官 | admin    | 国税収、国家土地開発費      |
| 財務官 | caution  | 国税収安定            |
| 将軍  | martial  | 戦争軍事力            |
| 将軍  | ambition | 宣戦判断を攻撃的にする      |
| 将軍  | caution  | 宣戦判断を慎重にする       |
| 家長  | admin    | 家支配力の成長・上限、家土地開発 |
| 家長  | caution  | 家土地開発志向          |

この変更により、人物の誕生・死亡・任命・継承が、国家や家の長期的な興亡により強く影響するようになる。

v0.6 の目標は、個々の能力値を細かく増やすことではなく、既存の単純な能力値が歴史世界の推移に意味を持つようにすることである。
