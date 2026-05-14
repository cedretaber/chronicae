# Chronicae 現状仕様まとめ（v0.3 実装済み）

最終更新: 2026-05-14

本ドキュメントは、現在の実装コードから導いた「実際に動いている仕様」をまとめたものである。
設計意図や背景は `SPEC.md`（v0.2）・`spec-v03-update.md` を参照すること。

---

## 1. データ構造

### 1.1 WorldState

```typescript
type WorldState = {
  currentYear: number
  currentMonth: number
  provinces: Record<ProvinceId, Province>
  countries: Record<CountryId, Country>
  houses: Record<HouseId, House>
  persons: Record<PersonId, Person>
  activePlots: Record<PlotId, Plot>
}
```

WorldState はスナップショットのみを保持する。イベント履歴は `SimulationSession` 側が管理する。

### 1.2 Province

```typescript
type Province = {
  id: ProvinceId
  name: string
  x: number         // グリッド座標（100 刻み）
  y: number
  neighbors: ProvinceId[]
  ownerHouseId: HouseId
  countryId: CountryId
  baseTax: number   // 1..10（固定）
  manpower: number  // 1..10（固定）
  unrest: number    // 0..100
}
```

- `baseTax` / `manpower` はワールド生成時に決まり、以後変化しない
- `unrest` のみが動的に変動する
- 所有関係の source of truth は `Province.ownerHouseId`

### 1.3 Country

```typescript
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
  lastWarMonth?: number // 宣戦時の通算月（warCooldown 判定用）
}
```

- `active: false` になった国家は UI 上のアクティブ一覧から除外される
- `lastWarMonth` は `currentYear * 12 + currentMonth` の通算月で記録

### 1.4 House

```typescript
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

### 1.5 Person

```typescript
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

役職は `Person` に持たない。`Country.roleAssignments` が source of truth であり、`getPersonRole(state, personId)` で取得する。

### 1.6 RoleType

```typescript
type RoleType = 'chancellor' | 'general' | 'treasurer'
```

### 1.7 Plot

```typescript
type Plot = {
  id: PlotId
  type: PlotType          // 'replace_house_head' | 'seize_role' | 'prepare_rebellion'
  status: PlotStatus      // 'active' | 'succeeded' | 'failed' | 'cancelled'
  startedYear: number
  startedMonth: number
  durationMonths: number
  elapsedMonths: number
  leaderId: PersonId
  participantIds: PersonId[]
  targetPersonId?: PersonId
  targetHouseId?: HouseId
  targetCountryId?: CountryId
  targetRole?: RoleType
  power: number    // 0..100
  secrecy: number  // 0..100
  risk: number     // 0..100
}
```

---

## 2. SimulationConfig（実装値）

```typescript
type SimulationConfig = {
  // 人物補充
  minLivingMembersPerHouse: number     // デフォルト: 4
  maxNewPersonsPerHousePerYear: number // デフォルト: 2

  // 陰謀・反乱
  basePlotSuccess: number      // デフォルト: 0.35
  rebellionThreshold: number   // デフォルト: 70
  plotThreshold: number        // デフォルト: 65
  replacementThreshold: number // デフォルト: 15

  rebellionSuccessMode: 'independence' | 'ruler_change' // デフォルト: 'independence'

  // イベント上限
  maxRawEvents: number      // デフォルト: 10000
  maxChronicleEvents: number // デフォルト: 1000

  // 戦争・征服
  warEnabled: boolean                    // デフォルト: true
  warCostPerProvince: number             // デフォルト: 20
  maxProvincesPerWar: number             // デフォルト: 3
  maxWarsPerTick: number                 // デフォルト: 1
  warCooldownMonths: number              // デフォルト: 24
  minAttackerWinChanceToDeclare: number  // デフォルト: 0.45

  // 災害
  disasterEnabled: boolean                    // デフォルト: true
  famineBaseChancePerYear: number             // デフォルト: 0.08
  plagueBaseChancePerYear: number             // デフォルト: 0.03
  bountifulHarvestBaseChancePerYear: number   // デフォルト: 0.05
  disasterReliefCostPerProvince: number       // デフォルト: 20

  // 公共支出
  publicSpendingEnabled: boolean      // デフォルト: true
  monumentBaseCost: number            // デフォルト: 120
  almsBaseCost: number                // デフォルト: 50
  publicSpendingYearlyChance: number  // デフォルト: 0.35
}
```

---

## 3. ワールド生成

- グリッド: 8 列 × 5 行 = 40 プロヴィンス
- 国家: 3（seed プロヴィンスをマンハッタン距離 ≥ 5 で配置し、flood fill で領域割り当て）
- 家: 国家あたり 5（各国 25 家）
- 人物: 家あたり 6 人前後

初期パラメータ範囲:

| エンティティ | フィールド | 範囲 |
|---|---|---|
| Province | baseTax | 1..10 |
| Province | manpower | 1..10 |
| Province | unrest | 0..20 |
| Country | treasury | 100..300 |
| Country | legitimacy | 45..80 |
| Country | adminPower | 35..70 |
| Country | stability | 45..80 |
| House | prestige | 20..80 |
| House | cohesion | 40..80 |
| House | loyaltyToCountry | 40..80 |
| House | wealth | 30..150 |
| Person | admin / martial | 0..10 |
| Person | ambition / loyaltyToCountry / caution | 0.0..1.0 |
| Person | prestige | 0..30 |

---

## 4. tick 処理順序

1 tick = 1 か月。以下の順で処理する。

```
1.  advanceTime             — 年月を進める
2.  runEconomySystem        — 税収計算・家と国家に分配
3.  runDisasterSystem       — 災害発生・被害・救済判断
4.  runMortalitySystem      — 自然死・事故死
5.  runEmergenceSystem      — 人物補充（年次＋即時）
6.  runSuccessionSystem     — 家長死亡時の後継者選出
7.  runAppointmentSystem    — 役職任命（年次＋空席時）
8.  runAmbitionSystem       — 野心・反乱傾向スコア評価
9.  runPublicSpendingSystem — 記念碑・施し（年次）
10. runPlotSystem           — 陰謀進行・解決
11. runWarSystem            — 戦争・征服（毎月、cooldown 制御）
12. runRebellionSystem      — 反乱判定・解決
13. runStabilitySystem      — 平時の安定度・正統性回復
14. runGovernanceSystem     — adminPower 再計算（年次）
15. runIntegritySystem      — 整合性チェック
```

---

## 5. 各システムの仕様

### 5.1 EconomySystem（毎月）

各プロヴィンスから税収を計算し、ownerHouse と country に分配する。

```
effectiveTax = baseTax × (1 - unrest / 100)
house.wealth  += effectiveTax × 0.6
country.treasury += effectiveTax × 0.4
```

`inactive` な国家（`active: false`）は treasury を受け取らない。

### 5.2 DisasterSystem（毎月、確率判定）

毎月、active な各国家に対して以下を判定する。確率は `baseChancePerYear / 12` に変換して毎月適用。

#### 凶作（Famine）

確率: `famineBaseChancePerYear / 12`（デフォルト年率 8%）

被害:
- その国のプロヴィンス全体の unrest +10
- country.stability -5

救済判断（同 tick 内）:
- `treasury >= reliefCost` かつ `loyaltyToCountry ≥ 0.5` なら救済
- reliefCost = `provinceCount × disasterReliefCostPerProvince`
- 救済成功: treasury 減少、unrest -5、stability +2、legitimacy +2 → `DISASTER_RELIEF_FUNDED`
- 救済失敗: legitimacy -5、stability -3 → `DISASTER_RELIEF_FAILED`

発生イベント: `FAMINE`、`DISASTER_RELIEF_FUNDED` / `DISASTER_RELIEF_FAILED`

#### 疫病（Plague）

確率: `plagueBaseChancePerYear / 12`（デフォルト年率 3%）

被害:
- 国の人物に対し追加死亡判定（全生存人物を走査し `roll < 0.05` で死亡）
- country.stability -8

発生イベント: `PLAGUE`

#### 豊作（Bountiful Harvest）

確率: `bountifulHarvestBaseChancePerYear / 12`（デフォルト年率 5%）

効果:
- 各プロヴィンスの unrest -5（下限 0）
- country.stability +3
- ownerHouse の wealth += baseTax × 0.3（上位）
- country.treasury += 合計 baseTax × 0.2

発生イベント: `BOUNTIFUL_HARVEST`

### 5.3 MortalitySystem（毎月）

各生存人物に対して死亡判定を行う。

死亡確率（月次）:
- 0〜39 歳: 0.1%
- 40〜59 歳: 0.3%
- 60〜69 歳: 1.0%
- 70 歳以上: 3.0%
- 事故（全年齢共通）: 0.05%

死亡時の処理:
- `alive = false`
- 役職を保持していた場合、該当役職を `roleAssignments` から削除
- 重要人物（役職者・家長・家の prestige ≥ 60）は `IMPORTANT_PERSON_DIED`、それ以外は `PERSON_DIED`

### 5.4 EmergenceSystem（毎月）

各 active House の生存人物数が `minLivingMembersPerHouse` 未満のとき、毎年1月に補充する。
生存人物が 0 になった場合は即時補充。

通常補充（毎年1月）:
- age: 16..30、prestige: 0..10、admin/martial: 0..10、traits: 0.0..1.0

即時補充（生存 0 の場合）:
- age: 25..45、prestige: 10..25、admin/martial: 1..8

発生イベント: `PERSON_EMERGED`（minor）

### 5.5 SuccessionSystem（毎月）

家長（`headId`）が死亡していた場合、後継者を選出する。

後継者スコア:
```
successionScore = age × 0.2 + prestige × 0.5 + admin × 2 + martial × 2 + ambition × 5
```

候補が存在しない場合、EmergenceSystem の即時補充後に選出する。

発生イベント: `HOUSE_HEAD_CHANGED`、`HOUSE_EXTINCT`

### 5.6 AppointmentSystem（毎年1月 + 空席時）

各役職について最適候補を評価し、現職との差が `replacementThreshold`（デフォルト 15）以上あれば再任命する。

役職別スコア:
```
chancellorScore = admin × 8 + loyaltyToCountry × 20 + prestige × 0.3 - ambition × 10
generalScore    = martial × 8 + prestige × 0.3 + ambition × 5
treasurerScore  = admin × 7 + loyaltyToCountry × 25 + caution × 10 - ambition × 15
```

任命条件: alive / 同国 / active House / 役職未保持

発生イベント: `ROLE_ASSIGNED`、`ROLE_REVOKED`

### 5.7 AmbitionSystem（毎月）

各 House の反乱傾向・陰謀傾向を計算する（直接イベントは発生させず、PlotSystem・RebellionSystem のインプットとなる）。

主要スコア:
```
rebellionTendency =
  house.prestige × 0.3
  + house.provinceCount × 4
  + head.traits.ambition × 30
  + (100 - country.legitimacy) × 0.3
  + (100 - house.loyaltyToCountry) × 0.4
  + (1.0 - head.traits.loyaltyToCountry) × 30
  - head.traits.caution × 20
  - country.adminPower × 0.2
```

### 5.8 PublicSpendingSystem（毎年1月）

`publicSpendingEnabled: true` かつ `currentMonth === 1` のときのみ処理する。

各 active 国家について `roll < publicSpendingYearlyChance`（デフォルト 35%）を判定し、通過した場合に記念碑 vs 施しを比較する。

記念碑スコア:
```
monumentScore =
  (100 - country.legitimacy) × 0.3
  + rulerHead.traits.ambition × 30
  + rulerHouse.prestige × 0.1
  + treasurySurplus   // max(0, treasury - monumentBaseCost)
  - rulerHead.traits.caution × 25
  + treasurerAdmin × 2
```

施しスコア:
```
almsScore =
  (100 - country.stability) × 0.4
  + avgUnrest × 0.5
  + rulerHead.traits.loyaltyToCountry × 20
  + rulerHead.traits.caution × 10
  - treasuryShortage  // max(0, almsBaseCost - treasury)
  + chancellorAdmin × 2
```

記念碑選択（`monumentScore > almsScore`）:
- `treasury -= monumentBaseCost`（資金不足ならスキップ）
- `legitimacy += 10`、`rulerHouse.prestige += 5`
- → `MONUMENT_BUILT`（major）

施し選択:
- `treasury -= almsBaseCost`（資金不足ならスキップ）
- `stability += 8`、各プロヴィンスの `unrest -= 5`
- → `ALMS_DISTRIBUTED`（normal）

### 5.9 PlotSystem（毎月）

active な各陰謀の `elapsedMonths` を進め、`durationMonths` に達したら解決判定を行う。

durationMonths 範囲:
- `replace_house_head`: 3..6 か月
- `seize_role`: 2..5 か月
- `prepare_rebellion`: 4..12 か月

成功率:
```
plotSuccessChance = clamp(
  basePlotSuccess
  + leaderAbilityBonus   // ((admin + martial) / 20) × 0.10
  + participantPowerBonus // power / 100 × 0.15
  + secrecyBonus          // secrecy / 100 × 0.10
  - targetDefensePenalty  // targetDefense / 100 × 0.20
  - riskPenalty,          // risk / 100 × 0.20
  0.05, 0.95
)
```

発生イベント: `PLOT_STARTED`、`PLOT_SUCCEEDED`、`PLOT_FAILED`、`PLOT_CANCELLED`

### 5.10 WarSystem（毎月、cooldown 制御）

`warEnabled: true` のとき、active な各国家ペアについて宣戦を評価する。
1 tick あたり `maxWarsPerTick` 件まで。

宣戦スコア（攻撃側視点）:
```
warScore =
  general.martial × 3
  + rulerHead.traits.ambition × 20
  + rulerHouse.prestige × 0.1
  + (100 - country.stability) × 0.1  // 内部不安は戦争を誘発
  - treasuryShortage                  // 国庫不足はペナルティ
  - rulerHead.traits.caution × 15
```

宣戦条件:
- 攻撃国・防衛国ともに `active: true`
- 隣接プロヴィンスが存在する（地理的隣接）
- 攻撃側の `attackerWinChance >= minAttackerWinChanceToDeclare`（デフォルト 0.45）
- 両国ともに cooldown 期間（`warCooldownMonths`）を超えている

戦力計算:
```
countryMilitaryPower = sum(houseMilitaryPower) + adminPower × 0.3

houseMilitaryPower =
  sum(province.manpower)
  + bestMartialInHouse × 2
  + house.wealth / 20
```

戦争解決:
```
attackerWinChance = attackerPower / (attackerPower + defenderPower)
attackerWins = roll < attackerWinChance
```

攻撃側勝利時:
- 防衛側の国境プロヴィンス 1〜`maxProvincesPerWar` 枚を攻撃側 rulerHouse に移転
- 防衛側: `treasury -= warCostPerProvince × 取得枚数`、`stability -= 15`、`legitimacy -= 10`
- 攻撃側: `treasury -= warCostPerProvince × 取得枚数 × 0.5`、`rulerHouse.prestige += 10`
- 国家消滅判定: 防衛側のプロヴィンスが 0 になった場合 `active = false`

攻撃側敗北時:
- 攻撃側: `treasury -= warCostPerProvince × 隣接枚数 × 0.3`、`stability -= 10`、`legitimacy -= 8`
- 防衛側: `legitimacy += 5`、`rulerHouse.prestige += 5`

発生イベント: `WAR_DECLARED`、`WAR_WON`、`WAR_LOST`、`PROVINCE_CONQUERED`、`COUNTRY_ANNEXED`

国家消滅時: 残存 House をすべて勝利国に `moveHouseToCountry` で移籍。

### 5.11 RebellionSystem（毎月）

各 active 国家の非支配家を走査し、反乱傾向が `rebellionThreshold`（デフォルト 70）を超えた家について確率判定する。

```
rebelChance = clamp(rebellionTendency / 200, 0, 1)
```

反乱開始時（勝敗に関わらず）:
- `country.stability -= 10`
- `country.legitimacy -= 5`

戦力計算: WarSystem と共通の `calcHouseMilitaryPower`

```
rebelSuccessChance = rebelPower / (rebelPower + loyalistPower + 1)
loyalistPower = country.adminPower × 0.5 + treasury / 50 + sum(他 active 家の militaryPower)
```

反乱成功（`rebellionSuccessMode: 'independence'`）:
- 新国家を作り反乱家が独立 → `COUNTRY_SPLIT`

反乱成功（`rebellionSuccessMode: 'ruler_change'`）:
- `changeRulerHouse` → `RULER_HOUSE_CHANGED`

反乱失敗:
- `rebelHouse.prestige -= 20`
- `rebelHouse.loyaltyToCountry -= 20`
- `country.stability += 5`
- `country.legitimacy += 3`

発生イベント: `REBELLION_STARTED`、`REBELLION_SUCCEEDED`、`REBELLION_FAILED`、`COUNTRY_SPLIT`、`RULER_HOUSE_CHANGED`

### 5.12 StabilitySystem（毎月）

平時の緩やかな回復:
```
country.stability  += 0.2
country.legitimacy += 0.05
```

### 5.13 GovernanceSystem（毎年1月）

`adminPower` を役職者能力と国家状態から再計算する:
```
adminPower = clamp100(
  30
  + chancellorAdmin × 3
  + treasurerAdmin × 2
  + stability × 0.2
  + rulerHousePrestige × 0.1
  + treasuryBonus     // clamp(treasury / 100, 0, 10)
)
```

役職が空席の場合、その能力値は 0 として計算する。

### 5.14 IntegritySystem（毎月、tick 末尾）

以下の整合性を検査し、違反があればコンソールに警告を出力する:

- 死亡人物が役職に就いていない
- Province.ownerHouseId の House が存在する
- active House の家長が生存している
- Country.rulerHouseId が active House を指している
- Province.ownerHouseId と House.provinceIds が一致する
- Province.countryId と House.countryId が一致する
- Person.countryId と House.countryId が一致する
- activePlots が存在する人物・家・国家を参照している

---

## 6. イベントタイプ一覧

```typescript
type EventType =
  // 人物
  | 'PERSON_DIED'
  | 'IMPORTANT_PERSON_DIED'
  | 'PERSON_EMERGED'
  // 家
  | 'HOUSE_HEAD_CHANGED'
  | 'HOUSE_EXTINCT'
  // 役職
  | 'ROLE_ASSIGNED'
  | 'ROLE_REVOKED'
  // 陰謀
  | 'PLOT_STARTED'
  | 'PLOT_SUCCEEDED'
  | 'PLOT_FAILED'
  | 'PLOT_CANCELLED'
  // 反乱
  | 'REBELLION_STARTED'
  | 'REBELLION_SUCCEEDED'
  | 'REBELLION_FAILED'
  | 'COUNTRY_SPLIT'
  | 'RULER_HOUSE_CHANGED'
  // 戦争・征服
  | 'WAR_DECLARED'
  | 'WAR_WON'
  | 'WAR_LOST'
  | 'PROVINCE_CONQUERED'
  | 'COUNTRY_ANNEXED'
  // 災害
  | 'FAMINE'
  | 'PLAGUE'
  | 'BOUNTIFUL_HARVEST'
  | 'DISASTER_RELIEF_FUNDED'
  | 'DISASTER_RELIEF_FAILED'
  // 公共支出
  | 'MONUMENT_BUILT'
  | 'ALMS_DISTRIBUTED'
  // その他
  | 'OMEN'
```

---

## 7. Selector・Mutation 一覧

### Selector

| ファイル | 関数 | 概要 |
|---|---|---|
| `roleSelectors.ts` | `getPersonRole(state, personId)` | 人物の役職を取得 |
| `militarySelectors.ts` | `calcHouseMilitaryPower(state, houseId)` | 家の軍事力計算 |
| `militarySelectors.ts` | `calcCountryMilitaryPower(state, countryId)` | 国家の軍事力計算 |
| `importanceSelectors.ts` | `calcPersonImportanceScore(state, personId, eventHistory)` | 重要人物スコア |
| `ambitionSystem.ts` | `calcAmbitionScores(state, houseId)` | 反乱傾向・陰謀傾向スコア |

### Mutation

| ファイル | 関数 | 概要 |
|---|---|---|
| `transferProvince.ts` | `transferProvinceToHouse(state, provinceId, newOwnerHouseId)` | プロヴィンス所有権移転 |
| `moveHouse.ts` | `moveHouseToCountry(state, houseId, newCountryId)` | 家の国家移籍 |
| `assignRole.ts` | `assignRole(state, countryId, role, personId)` | 役職任命 |
| `createCountry.ts` | `createCountryFromHouse(state, houseId, countryId)` | 独立国家生成 |
| `changeRulerHouse.ts` | `changeRulerHouse(state, countryId, newRulerHouseId)` | 支配家交代 |

---

## 8. 軍事力計算（共通）

`militarySelectors.ts` に切り出された共通ロジック。
RebellionSystem と WarSystem の両方から参照される。

```
houseMilitaryPower =
  sum(province.manpower for provinces owned by house)
  + bestMartialInHouse × 2
  + house.wealth / 20

countryMilitaryPower =
  sum(houseMilitaryPower for all active houses)
  + country.adminPower × 0.3
```

---

## 9. Province 属性の役割まとめ

| 属性 | 型 | 変動 | 使われる場所 |
|---|---|---|---|
| `baseTax` | 1..10 | なし（固定） | EconomySystem（税収計算） |
| `manpower` | 1..10 | なし（固定） | militarySelectors（軍事力計算） |
| `unrest` | 0..100 | あり | EconomySystem（税収ペナルティ）、PublicSpendingSystem（施し対象）、DisasterSystem（被害・回復）、StabilitySystem は間接的 |

`baseTax` と `manpower` は現在固定値であり、プロヴィンス間の個性はこれらの初期値の差のみで表現されている。

---

## 10. 未実装・将来対応

v0.3 時点で仕様書には記載があるが実装されていない機能:

- `hold_festival`（祝祭）/ `raise_extraordinary_tax`（臨時徴税）
- officerCostPerRole / maintenanceCostPerProvince 等の維持費系
- EventLog の WAR / DISASTER / PUBLIC_SPENDING カテゴリ別色分け
- 詳細な `reasons` / `effects` の多くは summary 文字列のみで代替

次フェーズ候補（SPEC.md §23 より）:
- POP（人口・文化・宗教）
- 宗教・文化システム
- 本格戦争エンティティ（War 型）
- 制度・法
- 詳細な経済（交易・産物・都市）
- プロヴィンス個性の拡張（発展度・地形・荒廃度）
