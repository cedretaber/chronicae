# 歴史シミュレーション技術検証プロトタイプ仕様書 v0.2

## 1. 概要

本仕様書は、歴史シミュレーションゲーム開発に先立って作成する技術検証プロトタイプの設計方針・データ構造・処理順序・UI 方針を定める。

本プロトタイプの目的は、完成品のゲームを作ることではなく、以下を検証することである。

* 自律的に動く小さな歴史世界を構築できるか
* 個人・家・国家の相互作用によって、歴史らしい変化が発生するか
* プレイヤーが直接操作しなくても、観戦対象として面白いか
* イベントログと因果説明によって、発生した出来事に納得感を持てるか
* seed 付き乱数による決定的リプレイが成立するか
* 将来的にシミュレーションコアを Rust/WASM 等へ置き換えられるよう、UI とコアを分離できるか

本プロトタイプでは、プレイヤーは特定の国家・人物・家を操作しない。プレイヤーは世界を観察する「傍観者」または「神」に近い立場であり、必要に応じて間接的な介入を行う。

---

## 2. コンセプト

### 2.1 プロトタイプの定義

本プロトタイプは、以下のように定義する。

> 個人・家・国家が自律的に動く小さな歴史世界を、Web UI で観戦する技術検証作品。

### 2.2 検証の中心

本プロトタイプで最も重要なのは、以下の構造が面白く動くかどうかである。

> 人物が所属組織と自分の野心の間で揺れ、その結果として家や国家が動く。

この部分が成立すれば、将来的に POP、宗教、文化、詳細な戦争、制度、経済などを追加する価値がある。

逆に、この部分が面白く動かなければ、後から要素を追加しても根本的な改善にはならない可能性が高い。

---

## 3. スコープ

### 3.1 このプロトタイプに含めるもの

* Web UI
* シード付きランダム世界生成
* プロヴィンス
* 国家
* 家
* 個人
* 役職
* 月次 tick による時間進行
* 経済の最小処理
* 死亡
* 継承
* 人物補充
* 任命
* 陰謀
* 反乱
* 国家分裂
* 支配家交代
* イベントログ
* 重要イベント通知
* 因果説明
* ウォッチリスト
* 最小限の神の介入

### 3.2 このプロトタイプに含めないもの

以下は重要な要素だが、技術検証第一段階では扱わない。

* POP
* 詳細な人口動態
* 血縁・婚姻・親子関係
* 文化変容
* 宗教改革
* 思想運動
* 詳細な外交
* 詳細な戦争シミュレーション
* 戦争エンティティ War
* 交易ネットワーク
* 法制度
* 技術発展
* 複雑な地形・気候モデル
* 本格的な地図エディタ
* セーブデータ互換性の長期保証

---

## 4. 技術方針

### 4.1 推奨技術構成

プロトタイプ段階では、以下を基本とする。

```text
React + TypeScript + Vite
```

UI 補助として以下を検討してよい。

* Tailwind CSS
* shadcn/ui
* Zustand
* SVG または Canvas
* React Flow
* Recharts

ただし、これらの UI 技術はプロトタイプ用であり、次フェーズで捨ててもよい。

### 4.2 シミュレーションコアの独立

シミュレーションコアは React に依存してはならない。

コアは純粋な TypeScript モジュールとして実装し、UI から呼び出される構造にする。

将来的には、以下のような置き換えを想定する。

* TypeScript 製コアから Rust 製コアへ移植
* Rust 製コアを WASM 化して Web UI から呼ぶ
* Rust サーバ + Web クライアント構成に移行

そのため、コアの入出力境界を明確に保つ。

### 4.3 コア関数の基本形

```ts
function tick(input: TickInput): TickResult
```

```ts
type TickInput = {
  state: WorldState
  rng: RngState
  config: SimulationConfig
}

type TickResult = {
  state: WorldState
  rng: RngState
  events: SimEvent[]
}
```

重要な原則：

* `Math.random()` を使用しない
* すべての乱数は seed 付き RNG 経由で行う
* tick は UI に依存しない
* tick は DOM、localStorage、Zustand、React state に依存しない
* 発生した出来事は必ず `events` として返す

---

## 5. ディレクトリ構成案

```text
src/
  sim/
    types/
      ids.ts
      world.ts
      province.ts
      country.ts
      house.ts
      person.ts
      role.ts
      plot.ts
      event.ts
      config.ts

    config/
      defaultConfig.ts

    rng/
      rng.ts
      hashSeed.ts

    worldgen/
      generateWorld.ts
      nameGenerators.ts

    systems/
      economySystem.ts
      mortalitySystem.ts
      emergenceSystem.ts
      successionSystem.ts
      appointmentSystem.ts
      ambitionSystem.ts
      plotSystem.ts
      rebellionSystem.ts
      stabilitySystem.ts
      governanceSystem.ts
      integritySystem.ts

    mutations/
      transferProvince.ts
      moveHouse.ts
      assignRole.ts
      createCountry.ts
      changeRulerHouse.ts

    selectors/
      countrySelectors.ts
      houseSelectors.ts
      personSelectors.ts
      riskSelectors.ts
      mapSelectors.ts
      roleSelectors.ts

    explain/
      explainRebellion.ts
      explainAppointment.ts
      explainPlot.ts
      explainSuccession.ts

    tick.ts

  app/
    stores/
      simulationStore.ts

    components/
      layout/
      controls/
      map/
      panels/
      logs/
      timeline/
      watchlist/
      notifications/

    pages/
      SimulationPage.tsx
```

---

## 6. 数値スケール

### 6.1 基本スケール

```ts
// 比率・性格・確率補正系
type Ratio = number // 0.0 .. 1.0

// 能力値。0 = 無能、10 = 卓越
type StatValue = number // 0 .. 10

// 政治・組織状態値。0 = 最低、100 = 最高
type Score100 = number // 0 .. 100

// 金銭・兵力・税収などの量
type Amount = number // 0以上
```

### 6.2 clamp 規約

更新後、以下の値は必ず範囲内に clamp する。

* `0 .. 1`: traits
* `0 .. 10`: stats
* `0 .. 100`: legitimacy, stability, adminPower, prestige, cohesion, loyaltyToCountry, unrest
* `0以上`: treasury, wealth

---

## 7. ID 型

ID は文字列とする。
型安全性を高める場合、branded type を使ってもよい。

```ts
type ProvinceId = string
type CountryId = string
type HouseId = string
type PersonId = string
type PlotId = string
type EventId = string
```

ID 生成は seed 付き RNG に依存させるか、生成順序に基づく連番でよい。
決定性を保つため、同じ seed と同じ生成手順なら同じ ID が生成されること。

---

## 8. ワールドモデル

### 8.1 WorldState

```ts
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

`WorldState` は現在の世界状態のみを表す。
完全なイベント履歴は `WorldState` に含めない。

イベント履歴は `SimulationSession` 側で保持する。

```ts
type SimulationSession = {
  initialSeed: string
  currentState: WorldState
  rng: RngState
  eventHistory: SimEvent[]
}
```

### 8.2 Province

プロヴィンスは地理的な最小単位である。

```ts
type Province = {
  id: ProvinceId
  name: string

  x: number
  y: number
  neighbors: ProvinceId[]

  ownerHouseId: HouseId
  countryId: CountryId

  baseTax: number   // 1 .. 10
  manpower: number  // 1 .. 10
  unrest: number    // 0 .. 100
}
```

初期プロトタイプでは、本物の地図ではなく、ノードグラフとして表示する。

`x` / `y` は UI 描画用の座標であり、シミュレーションロジック上は必須ではない。

### 8.3 Country

国家は複数の家とプロヴィンスを内包する政治単位である。

```ts
type Country = {
  id: CountryId
  name: string

  rulerHouseId: HouseId
  houseIds: HouseId[]

  treasury: number     // 0以上
  legitimacy: number   // 0 .. 100
  adminPower: number   // 0 .. 100
  stability: number    // 0 .. 100

  roleAssignments: Partial<Record<RoleType, PersonId>>
}
```

主な値：

* `treasury`: 国庫
* `legitimacy`: 正統性。低いほど反乱が起きやすい
* `adminPower`: 統治力。初期プロトタイプでは保存値として扱う
* `stability`: 安定度。短期的な混乱の指標

### 8.4 House

家は、人物が所属し、領地を持ち、国家内で競争する中間組織である。

```ts
type House = {
  id: HouseId
  name: string
  active: boolean

  countryId: CountryId
  provinceIds: ProvinceId[]
  memberIds: PersonId[]
  headId: PersonId

  prestige: number          // 0 .. 100
  cohesion: number          // 0 .. 100
  loyaltyToCountry: number  // 0 .. 100
  wealth: number            // 0以上
}
```

主な値：

* `prestige`: 家の威信。高いほど野心的行動の基盤になる
* `cohesion`: 家の結束。低いと家内陰謀が起きやすい
* `loyaltyToCountry`: 国家への忠誠
* `wealth`: 家の資産
* `active`: 断絶・無効化されていないか

### 8.5 Person

個人は本プロトタイプの中心的存在である。

```ts
type Person = {
  id: PersonId
  name: string

  age: number
  alive: boolean

  houseId: HouseId
  countryId: CountryId

  stats: {
    admin: number     // 0 .. 10
    martial: number   // 0 .. 10
  }

  traits: {
    ambition: number          // 0.0 .. 1.0
    loyaltyToCountry: number  // 0.0 .. 1.0
    caution: number           // 0.0 .. 1.0
  }

  prestige: number // 0 .. 100
}
```

`Person.role` は持たない。
役職は `Country.roleAssignments` を source of truth とし、人物の役職表示は selector で取得する。

```ts
function getPersonRole(state: WorldState, personId: PersonId): RoleType | null
```

### 8.6 RoleType

```ts
type RoleType =
  | "chancellor"
  | "general"
  | "treasurer"
```

---

## 9. Source of Truth 規約

### 9.1 Province / House / Country の所有関係

所有関係の source of truth は、以下のように定める。

```text
Province.ownerHouseId が、プロヴィンス所有者の正本である。
Province.countryId は、ownerHouseId が所属する House.countryId と一致していなければならない。
```

ただし、UI と検索性能のため、`House.provinceIds` と `Country.houseIds` はキャッシュとして保持する。

### 9.2 プロヴィンス所有者変更

プロヴィンス所有者を変更する場合は、必ず専用関数を使う。

```ts
function transferProvinceToHouse(
  state: WorldState,
  provinceId: ProvinceId,
  newOwnerHouseId: HouseId
): WorldState
```

この関数は以下を一括更新する。

* `Province.ownerHouseId`
* `Province.countryId`
* 旧 House の `provinceIds`
* 新 House の `provinceIds`

`Province.countryId` は `newOwnerHouse.countryId` と一致させる。

### 9.3 House の国家移籍

家が国家を移る、または独立国家を形成する場合も、専用関数を使う。

```ts
function moveHouseToCountry(
  state: WorldState,
  houseId: HouseId,
  newCountryId: CountryId
): WorldState
```

この関数は以下を一括更新する。

* `House.countryId`
* 旧 Country の `houseIds`
* 新 Country の `houseIds`
* 当該 House が所有する全 Province の `countryId`
* 当該 House に属する全 Person の `countryId`

### 9.4 Role の source of truth

役職の source of truth は、`Country.roleAssignments` とする。

```ts
type Country = {
  roleAssignments: Partial<Record<RoleType, PersonId>>
}
```

任命・解任は専用関数を使う。

```ts
function assignRole(
  state: WorldState,
  countryId: CountryId,
  role: RoleType,
  personId: PersonId
): WorldState

function revokeRole(
  state: WorldState,
  countryId: CountryId,
  role: RoleType
): WorldState
```

任命時の前提条件：

* person は alive である
* person.countryId が countryId と一致する
* person が active House に所属する
* 初期プロトタイプでは、同一人物の複数役職は禁止する

---

## 10. RNG と決定性

### 10.1 採用 RNG

プロトタイプでは、実装が容易で決定性を確保しやすい `mulberry32` を採用する。

将来的により高品質な RNG が必要になった場合は、PCG 等へ差し替える。
ただし、その場合も RNG インターフェイスは維持する。

### 10.2 Seed 文字列の hash

外部入力としての seed は文字列を許容する。
内部では FNV-1a 32bit により 32bit unsigned integer に変換する。

```ts
type RngState = {
  seedText: string
  state: number // uint32
}
```

```ts
function hashSeedToUint32(seedText: string): number {
  let hash = 0x811c9dc5

  for (let i = 0; i < seedText.length; i++) {
    hash ^= seedText.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }

  return hash >>> 0
}
```

初期プロトタイプでは、JavaScript の `charCodeAt` に基づく UTF-16 code unit 列をそのまま hash 対象とする。
Unicode 正規化までは行わない。

### 10.3 RNG インターフェイス

```ts
type RngResult<T> = {
  value: T
  rng: RngState
}

function randomFloat(rng: RngState): RngResult<number> // 0 <= value < 1
function randomInt(rng: RngState, min: number, maxInclusive: number): RngResult<number>
function chooseOne<T>(rng: RngState, items: readonly T[]): RngResult<T>
function shuffle<T>(rng: RngState, items: readonly T[]): RngResult<T[]>
```

### 10.4 禁止事項

* `Math.random()` の直接使用は禁止
* 現在時刻をシミュレーション結果に混ぜることは禁止
* 非ソートの `Object.values()` による処理順依存は禁止

### 10.5 イテレーション規約

`Record<Id, T>` を走査する場合、必ず ID をソートしてから処理する。

```ts
const personIds = Object.keys(state.persons).sort() as PersonId[]
for (const personId of personIds) {
  const person = state.persons[personId]
  // process
}
```

同様に、国家・家・プロヴィンス・陰謀なども、処理順が結果に影響する場合は必ず ID ソートを行う。

UI 表示用のソートと、シミュレーション処理順のソートは分離する。

---

## 11. 世界生成

### 11.1 生成目標

初期値：

```ts
provinceCount = 40
countryCount = 3
housesPerCountry = 5
personsPerHouse = 6
```

結果として以下を生成する。

* Province: 40
* Country: 3
* House: 15
* Person: 約90

### 11.2 プロヴィンスグラフ

最初は格子ベースで生成する。

手順：

1. 8 x 5 の格子を作る
2. 各セルを Province とする
3. 上下左右を neighbors にする
4. 一部の辺をランダムに追加して自然な接続を作る
5. x / y は格子座標から決める

完全ランダムグラフは避ける。
国家領域の連続性が崩れやすいためである。

### 11.3 国家 seed province の配置

国家ごとに seed province を選ぶ。
8 x 5 格子で 3国家を生成する場合、国家 seed province は互いにマンハッタン距離 5 以上となるように選ぶ。

```text
minimumSeedDistance = 5
maxSeedPlacementAttempts = 100
```

seed 候補が条件を満たさない場合、再抽選する。
100回試行しても条件を満たせない場合、`minimumSeedDistance` を 1 ずつ下げて再試行する。

### 11.4 国家割り当て

国家 seed province から flood fill 的に近隣 Province を獲得させ、連続した領域を形成する。

手順：

1. Country を3つ生成
2. 互いに離れた seed province を選ぶ
3. 各 Country が隣接未割当 Province を順番に取得
4. 全 Province がいずれかの Country に所属するまで繰り返す

### 11.5 家の割り当て

各 Country に5家を生成する。

その国の Province を House に分配する。

* rulerHouse: その国の Province の 25〜35% を持つ
* majorHouse: 15〜25%
* minorHouse: 残りを分配

### 11.6 人物生成

各 House に6人前後を生成する。

年齢分布：

```text
16-25歳: 25%
26-40歳: 35%
41-60歳: 30%
61-75歳: 10%
```

家長は以下の条件で選ぶ。

* 30歳以上
* prestige が高い
* admin または martial が比較的高い

該当者がいない場合、最年長者を家長にする。

### 11.7 初期パラメータ範囲

Province:

```text
baseTax: 1 .. 10
manpower: 1 .. 10
unrest: 0 .. 20
```

Country:

```text
treasury: 100 .. 300
legitimacy: 45 .. 80
adminPower: 35 .. 70
stability: 45 .. 80
```

House:

```text
active: true
prestige: 20 .. 80
cohesion: 40 .. 80
loyaltyToCountry: 40 .. 80
wealth: 30 .. 150
```

Person:

```text
admin: 0 .. 10
martial: 0 .. 10
ambition: 0.0 .. 1.0
loyaltyToCountry: 0.0 .. 1.0
caution: 0.0 .. 1.0
prestige: 0 .. 30
```

---

## 12. 時間進行

### 12.1 時間単位

1 tick = 1か月 とする。

理由：

* 死亡、任命、陰謀、反乱を扱いやすい
* 年単位よりも変化が細かく見える
* 日単位ほどイベント数が爆発しない

### 12.2 推奨シミュレーション期間

プロトタイプでは以下を目安とする。

* 50年: 最低限の動作確認
* 100年: 世代交代と国家変化の確認
* 200年: 長期安定性の確認

### 12.3 tick 更新順序

tick の更新順序は非常に重要である。
不適切な順序にすると、死亡済み人物が反乱する、反乱で失った領地から税収を得る、継承前後の人物が同時に家長になる、といった矛盾が生じる。

基本順序：

1. 時間を進める
2. 経済処理
3. 死亡処理
4. 人物補充処理
5. 継承処理
6. 任命処理
7. 個人の欲求・不満・野心評価
8. 陰謀処理
9. 反乱処理
10. 安定度・正統性・忠誠の変化
11. 統治力更新
12. 整合性チェック
13. イベント返却

疑似コード：

```ts
function tick(input: TickInput): TickResult {
  let ctx = createTickContext(input)

  ctx = advanceTime(ctx)
  ctx = runEconomySystem(ctx)
  ctx = runMortalitySystem(ctx)
  ctx = runEmergenceSystem(ctx)
  ctx = runSuccessionSystem(ctx)
  ctx = runAppointmentSystem(ctx)
  ctx = runAmbitionSystem(ctx)
  ctx = runPlotSystem(ctx)
  ctx = runRebellionSystem(ctx)
  ctx = runStabilitySystem(ctx)
  ctx = runGovernanceSystem(ctx)
  ctx = runIntegrityCheck(ctx)

  return ctx.toResult()
}
```

---

## 13. SimulationConfig

主要パラメータは `SimulationConfig` に切り出す。

```ts
type SimulationConfig = {
  minLivingMembersPerHouse: number
  maxNewPersonsPerHousePerYear: number

  basePlotSuccess: number

  rebellionThreshold: number
  plotThreshold: number

  replacementThreshold: number

  rebellionSuccessMode: "independence" | "ruler_change"

  maxRawEvents: number
  maxChronicleEvents: number
}
```

初期値：

```ts
const defaultConfig: SimulationConfig = {
  minLivingMembersPerHouse: 4,
  maxNewPersonsPerHousePerYear: 2,

  basePlotSuccess: 0.35,

  rebellionThreshold: 70,
  plotThreshold: 65,

  replacementThreshold: 15,

  rebellionSuccessMode: "independence",

  maxRawEvents: 10000,
  maxChronicleEvents: 1000,
}
```

---

## 14. システム仕様

## 14.1 EconomySystem

### 目的

各プロヴィンスから税収を発生させ、家と国家に分配する。

### 簡易ルール

* 各 Province は `baseTax` を持つ
* 税収は ownerHouse と country に分配される
* unrest が高いほど税収は低下する

例：

```ts
unrestPenalty = province.unrest / 100
effectiveTax = province.baseTax * (1 - unrestPenalty)
houseIncome = effectiveTax * 0.6
countryIncome = effectiveTax * 0.4
```

通常収入は原則としてイベント化しない。

イベント化してよいもの：

* 国庫破綻
* 極端な収入低下
* 反乱地域からの税収喪失

---

## 14.2 MortalitySystem

### 目的

人物の自然死・事故死を処理する。

### ルール

* 年齢に応じて死亡確率が上昇する
* 低確率で事故死が発生する
* 死亡した人物は `alive = false` になる
* 死亡した人物が役職を持っていた場合、役職は空席になる

死亡確率の目安：

```text
0-39歳: 非常に低い
40-59歳: 低い
60-69歳: 中程度
70歳以上: 高い
```

発生イベント：

* PERSON_DIED
* IMPORTANT_PERSON_DIED

重要人物の死亡は Chronicle / News にも表示する。

---

## 14.3 EmergenceSystem

### 目的

出生・血縁関係を扱わずに、家の人物数を補充する。

これは「一族内の分家・若手・家臣・遠縁の成人が政治的に登場した」ことを抽象化する。

### 通常補充

毎年1月、各 active House について人物数を確認する。

```text
houseLivingMembers < minLivingMembersPerHouse の場合、新人物を生成する。
```

初期値：

```text
minLivingMembersPerHouse = 4
maxNewPersonsPerHousePerYear = 2
```

通常補充人物：

```text
age: 16 .. 30
admin: 0 .. 10
martial: 0 .. 10
ambition: 0.0 .. 1.0
loyaltyToCountry: 0.0 .. 1.0
caution: 0.0 .. 1.0
prestige: 0 .. 10
```

### 即時補充例外

以下の場合は、同一 tick 内で即時に最低1名を補充する。

```text
active House の livingMembers が 0 になった場合
```

即時補充人物：

```text
age: 25 .. 45
prestige: 10 .. 25
admin: 1 .. 8
martial: 1 .. 8
ambition: 0.0 .. 1.0
loyaltyToCountry: 0.0 .. 1.0
caution: 0.0 .. 1.0
```

通常補充よりもやや有力な人物として生成する。
これは「遠縁の成人継承者」「分家の有力者」「家臣団から推戴された人物」などを抽象化したものである。

### 家を断絶させたい場合

反乱失敗などで意図的に家を滅ぼす場合は、即時補充を行わず `HOUSE_EXTINCT` を発生させる。

この場合は、RebellionSystem などが明示的に以下を指定する。

```ts
allowImmediateHouseRecovery = false
```

発生イベント：

* PERSON_EMERGED

通常補充は Raw Event Log の minor event とする。
重要イベントにはしない。

---

## 14.4 SuccessionSystem

### 目的

家長死亡時に後継者を選ぶ。

### ルール

* 家長が死亡した場合、同じ家の生存人物から後継者を選ぶ
* EmergenceSystem の即時補充により、原則として active House の生存人物は 0 にならない
* 後継者候補がいない場合、その家は断絶または rulerHouse へ吸収される

後継者スコア：

```text
successionScore =
  age * 0.2
  + prestige * 0.5
  + admin * 2
  + martial * 2
  + ambition * 5
```

発生イベント：

* HOUSE_HEAD_CHANGED
* HOUSE_EXTINCT

### IntegrityCheck との関係

`House.headId` はその家の現在の家長を表す source of truth である。

家長が死亡した場合、同一 tick 内の SuccessionSystem で必ず後継者を設定する。

IntegrityCheck の「家長が死亡していないか」は、以下を意味する。

```text
SuccessionSystem 実行後にも House.headId が死亡人物を指している場合、それはエラーである。
```

死亡直後から SuccessionSystem までの一時的な状態は許容されるが、tick 終了時点では許容されない。

---

## 14.5 AppointmentSystem

### 目的

国家が有能な人物を役職に任命する。

### 任命タイミング

毎年1月、および役職が空席になった tick に任命評価を行う。

### 任命対象

* alive
* 同じ Country に所属
* active House に所属
* 役職を持っていない

### 役職別スコア

```text
chancellorScore = admin * 8 + loyaltyToCountry * 20 + prestige * 0.3 - ambition * 10

generalScore = martial * 8 + prestige * 0.3 + ambition * 5

treasurerScore = admin * 7 + loyaltyToCountry * 25 + caution * 10 - ambition * 15
```

最高スコアの人物を任命する。

任命変更は、現職との差が一定以上ある場合のみ行う。

```text
replacementThreshold = 15
```

任命の効果：

* 任命された人物の prestige 上昇
* 所属家の prestige 上昇
* 冷遇された有力家の不満上昇

発生イベント：

* ROLE_ASSIGNED
* ROLE_REVOKED

---

## 14.6 AmbitionSystem

### 目的

人物や家が現在どれほど危険な状態にあるかを評価する。

このシステムは、直接イベントを発生させるというより、陰謀や反乱の前提となるスコアを計算する。

代表的な派生値：

* personAmbitionPressure
* rebellionTendency
* plotTendency
* houseDissatisfaction

反乱傾向の例：

```text
rebellionTendency =
  house.prestige * 0.3
  + house.provinceCount * 4
  + head.traits.ambition * 30
  + (100 - country.legitimacy) * 0.3
  + (100 - house.loyaltyToCountry) * 0.4
  + (1.0 - head.traits.loyaltyToCountry) * 30
  - head.traits.caution * 20
  - country.adminPower * 0.2
```

---

## 14.7 PlotSystem

### 目的

人物または家が陰謀を企てる。

陰謀は即時解決ではなく、複数 tick にわたる状態として扱う。
ただし、初期プロトタイプでは 2〜12か月程度の短期状態とする。

### Plot 型

```ts
type PlotType =
  | "replace_house_head"
  | "seize_role"
  | "prepare_rebellion"

type PlotStatus =
  | "active"
  | "succeeded"
  | "failed"
  | "cancelled"

type Plot = {
  id: PlotId
  type: PlotType
  status: PlotStatus

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

  power: number        // 0 .. 100
  secrecy: number      // 0 .. 100
  risk: number         // 0 .. 100
}
```

### Plot の進行

毎 tick、active な Plot の `elapsedMonths` を進める。

`elapsedMonths >= durationMonths` になったら解決判定を行う。

### durationMonths

Plot の `durationMonths` は種類ごとに決める。

```text
replace_house_head: 3 .. 6 months
seize_role: 2 .. 5 months
prepare_rebellion: 4 .. 12 months
```

範囲内で seed 付き RNG によりランダムに決める。

### Plot power / secrecy / risk の初期値

共通補助値：

```text
leaderAdmin = leader.stats.admin
leaderMartial = leader.stats.martial
leaderAmbition = leader.traits.ambition
leaderCaution = leader.traits.caution
leaderPrestige = leader.prestige
housePrestige = leaderHouse.prestige
houseCohesion = leaderHouse.cohesion
```

#### replace_house_head

```text
power = clamp100(
  30
  + leaderPrestige * 0.3
  + leaderAmbition * 20
  + leaderAdmin * 2
  - houseCohesion * 0.2
)

secrecy = clamp100(
  50
  + leaderCaution * 20
  + leaderAdmin * 2
  - leaderAmbition * 10
)

risk = clamp100(
  40
  + houseCohesion * 0.3
  - leaderCaution * 20
)
```

#### seize_role

```text
power = clamp100(
  25
  + leaderPrestige * 0.4
  + leaderAdmin * 2
  + leaderAmbition * 15
)

secrecy = clamp100(
  45
  + leaderCaution * 15
  + leaderAdmin
)

risk = clamp100(
  35
  + targetRoleImportance * 10
  - leaderCaution * 15
)
```

`targetRoleImportance`:

```text
chancellor: 3
general: 2
treasurer: 2
```

#### prepare_rebellion

```text
power = clamp100(
  30
  + housePrestige * 0.3
  + leaderMartial * 2
  + leaderAmbition * 20
  + provinceCountOfHouse * 3
)

secrecy = clamp100(
  40
  + leaderCaution * 15
  + leaderAdmin
  - provinceCountOfHouse
)

risk = clamp100(
  50
  + countryAdminPower * 0.2
  + countryStability * 0.2
  - leaderCaution * 15
)
```

### Plot 成功率

Plot 成功率は、初期プロトタイプでは clamp 上限に頻繁に張り付かないよう、やや保守的な補正値にする。

```text
plotSuccessChance = clamp(
  basePlotSuccess
  + leaderAbilityBonus
  + participantPowerBonus
  + secrecyBonus
  - targetDefensePenalty
  - riskPenalty,
  0.05,
  0.95
)
```

初期値：

```text
basePlotSuccess = 0.35
```

補正：

```text
leaderAbilityBonus = ((leader.admin + leader.martial) / 20) * 0.10
participantPowerBonus = plot.power / 100 * 0.15
secrecyBonus = plot.secrecy / 100 * 0.10
targetDefensePenalty = targetDefense / 100 * 0.20
riskPenalty = plot.risk / 100 * 0.20
```

最大プラス補正：

```text
leaderAbilityBonus: 最大 +10%
participantPowerBonus: 最大 +15%
secrecyBonus: 最大 +10%
合計: 最大 +35%
```

したがって、防御側・リスク側のペナルティが 0 の極端なケースでも、基本成功率 35% から最大 70% 程度に留まる。
95% clamp は、将来的なイベント補正・神の介入・特殊 trait 補正などが加わった場合の安全装置として残す。

`targetDefense` は陰謀種別ごとに以下を使う。

```text
replace_house_head: targetHouse.cohesion
seize_role: country.adminPower
prepare_rebellion: country.adminPower * 0.5 + country.stability * 0.5
```

### 陰謀種別ごとの効果

#### replace_house_head

対象: 初期プロトタイプでは自分の家のみ。

成功時：

* `House.headId` が `leaderId` に変更される
* 旧家長は生存したまま prestige を失う
* 旧家長の prestige -20
* 新家長の prestige +15
* House.cohesion -10

失敗時：

* leader の prestige -15
* leader が低確率で死亡または追放される
* House.cohesion -5

#### seize_role

対象: 国家役職。

成功時：

* 対象 role が leader に割り当てられる
* leader prestige +10
* leader の House prestige +5

失敗時：

* leader prestige -10
* leader の House loyaltyToCountry -5

#### prepare_rebellion

対象: 所属国家。

成功時：

* leader の House の rebellionTendency に一時補正を与える
* 同 tick または後続 tick の RebellionSystem が反乱候補として評価する

失敗時：

* leader prestige -10
* House loyaltyToCountry -10
* Country stability -5

発生イベント：

* PLOT_STARTED
* PLOT_SUCCEEDED
* PLOT_FAILED
* PLOT_CANCELLED

---

## 14.8 RebellionSystem

### 目的

家が国家に対して反乱する。

### 基本方針

初期プロトタイプでは、反乱は War として永続管理しない。
`War` 型および `activeWars` は導入しない。

反乱は以下の二段階で扱う。

1. `REBELLION_STARTED` を発生
2. 同一 tick 内で数値解決

### 反乱条件

反乱は以下の条件が重なったときに起きやすい。

* 国家の正統性が低い
* 国家の統治力が低い
* 家の威信が高い
* 家の領地が多い
* 家長の野心が高い
* 家長の国家忠誠が低い
* 家の忠誠が低い
* prepare_rebellion Plot が成功している

### 反乱の処理順

```text
1. 反乱候補 House を評価
2. 閾値を超えた House が反乱開始
3. REBELLION_STARTED イベント生成
4. rebelPower / loyalistPower を計算
5. RNG で勝敗判定
6. 成功または失敗イベント生成
7. 状態変更を即時適用
```

### 戦力計算

Province.manpower は RebellionSystem の戦力計算に使う。

```text
houseMilitaryPower =
  sum(province.manpower)
  + bestMartialInHouse * 2
  + house.wealth / 20
```

```text
rebelPower = houseMilitaryPower(rebelHouse)

loyalistPower =
  sum(houseMilitaryPower(loyalHousees))
  + country.adminPower * 0.5
  + country.treasury / 50
```

### 反乱成功時の結果

初期プロトタイプでは、デフォルトで「新国家として独立」とする。

```ts
rebellionSuccessMode = "independence"
```

設定により「rulerHouse 交代」も選択可能にする。

```ts
rebellionSuccessMode: "independence" | "ruler_change"
```

### 新国家として独立

```ts
function createCountryFromRebelHouse(
  state: WorldState,
  rebelHouseId: HouseId
): WorldState
```

新国家の初期値：

```ts
newCountry = {
  id: generateCountryId(),
  name: `${rebelHouse.name}領`,
  rulerHouseId: rebelHouseId,
  houseIds: [rebelHouseId],
  treasury: Math.floor(rebelHouse.wealth * 0.5),
  legitimacy: 45,
  adminPower: 30,
  stability: 40,
  roleAssignments: {}
}
```

旧国家側の処理：

* 旧 Country.houseIds から rebelHouseId を除去
* rebelHouse.countryId を新 Country に変更
* rebelHouse の全 Province.countryId を新 Country に変更
* rebelHouse の全 Person.countryId を新 Country に変更
* 旧国家の legitimacy -10
* 旧国家の stability -15
* 旧国家の adminPower -5

外交関係は初期プロトタイプでは扱わない。

### rulerHouse 交代

```ts
function changeRulerHouse(
  state: WorldState,
  countryId: CountryId,
  newRulerHouseId: HouseId
): WorldState
```

処理内容：

* `Country.rulerHouseId = newRulerHouseId`
* 国庫 treasury は維持する
* Country.legitimacy -= 15
* Country.stability -= 20
* newRulerHouse.prestige += 20
* oldRulerHouse.prestige -= 25
* oldRulerHouse.loyaltyToCountry -= 20
* Country.roleAssignments は一度すべて空にする
* 次の AppointmentSystem で新政権の役職者を任命する

旧 rulerHouse は滅亡しない。
ただし prestige と loyalty を大きく失い、将来的な反乱要因になりうる。

### 反乱開始時の即時ペナルティ

反乱が開始した tick に、反乱の勝敗に関わらず以下を適用する。

```text
country.stability -= 10
country.legitimacy -= 5
```

### 反乱失敗時の結果

* rebelHouse.prestige -20
* rebelHouse.loyaltyToCountry -20
* country.stability +5
* country.legitimacy +3
* 反乱家長は低確率で死亡または失脚
* 明示的に家を滅ぼす場合は HOUSE_EXTINCT を発生させる

発生イベント：

* REBELLION_STARTED
* REBELLION_SUCCEEDED
* REBELLION_FAILED
* COUNTRY_SPLIT
* RULER_HOUSE_CHANGED

---

## 14.9 StabilitySystem

### 目的

何も起きていないときの、国家の緩やかな平時回復を担う。

反乱・陰謀・任命といった個別イベントに起因する状態変化は、それぞれのシステムが責任を持つ。
StabilitySystem は「平時のじわじわとした回復」のみを行う。

### 平時回復

毎月：

```text
country.stability += 0.2
country.legitimacy += 0.05
```

---

## 14.10 GovernanceSystem

### 目的

Country.adminPower を更新する。

### 方針

Phase 1〜3 では、`adminPower` は Country の保存値として扱う。

将来的には selector による導出値へ移行してもよい。

### 更新タイミング

毎年1月、または役職変更があった tick の終端で再計算する。

```text
adminPower = clamp100(
  30
  + chancellorAdmin * 3
  + treasurerAdmin * 2
  + stability * 0.2
  + rulerHousePrestige * 0.1
  + treasuryBonus
)
```

```text
treasuryBonus = clamp(treasury / 100, 0, 10)
```

役職が空席の場合、その役職者の能力値は 0 とする。

---

## 14.11 House Extinction

### 目的

家の断絶処理を定義する。

### 断絶条件

以下の場合、家は断絶する。

```text
生存 member が 0 かつ補充処理でも維持しない設定の場合
```

初期プロトタイプでは、原則として補充により家の断絶を避ける。
ただし、反乱失敗などで明示的に家を滅ぼす場合は HOUSE_EXTINCT を発生させる。

### 領地移転先

家が断絶した場合、その領地は同じ Country の rulerHouse に移転する。

```text
断絶 House の全 Province.ownerHouseId = rulerHouseId
```

この処理には `transferProvinceToHouse` を使う。

### House の削除

初期プロトタイプでは、断絶した House は `houses` から物理削除せず、`active = false` として無効化する。

断絶時：

* `active = false`
* `provinceIds = []`
* Country.houseIds からは除去
* memberIds は履歴参照用に残してよい

---

## 14.12 IntegritySystem

### 目的

tick 終了時点で、WorldState の整合性を検査する。

### チェック項目

* 死亡人物が役職に就いていないか
* 存在しない家がプロヴィンスを所有していないか
* active House の家長が死亡していないか
* 国家に存在しない家が登録されていないか
* Province.ownerHouseId と Province.countryId が矛盾していないか
* House.provinceIds と Province.ownerHouseId が矛盾していないか
* Person.countryId と House.countryId が矛盾していないか
* Country.rulerHouseId が active House を指しているか
* activePlots が存在しない人物・家・国家を参照していないか

整合性エラーは、開発中は例外として扱う。
リリース相当のプロトタイプでは、エラーログとして表示してもよい。

---

## 15. イベント仕様

### 15.1 イベントの役割

イベントは、単なるログではない。
本プロトタイプでは、イベントは観戦体験とデバッグの中心である。

すべての重要なシミュレーション結果は、イベントとして記録する。

### 15.2 SimEvent

```ts
type SimEvent = {
  id: EventId
  year: number
  month: number

  type: EventType
  importance: "minor" | "normal" | "major" | "critical"

  actorIds: PersonId[]
  houseIds: HouseId[]
  countryIds: CountryId[]
  provinceIds: ProvinceId[]

  summary: string
  description?: string

  reasons: EventReason[]
  effects: EventEffect[]
}
```

```ts
type EventReason = {
  label: string
  value?: number
  contribution?: number
}
```

```ts
type EventEffect = {
  label: string
  value?: number
}
```

### 15.3 EventType

```ts
type EventType =
  | "ROLE_ASSIGNED"
  | "ROLE_REVOKED"
  | "PERSON_DIED"
  | "IMPORTANT_PERSON_DIED"
  | "PERSON_EMERGED"
  | "HOUSE_HEAD_CHANGED"
  | "HOUSE_EXTINCT"
  | "PLOT_STARTED"
  | "PLOT_SUCCEEDED"
  | "PLOT_FAILED"
  | "PLOT_CANCELLED"
  | "REBELLION_STARTED"
  | "REBELLION_SUCCEEDED"
  | "REBELLION_FAILED"
  | "COUNTRY_SPLIT"
  | "RULER_HOUSE_CHANGED"
  | "OMEN"
  | "FAMINE"
  | "BOUNTIFUL_HARVEST"
  | "PLAGUE"
```

### 15.4 イベント例

```json
{
  "type": "REBELLION_STARTED",
  "importance": "critical",
  "summary": "ヴァルケン家がエルディア王国に対して反乱を開始した。",
  "reasons": [
    { "label": "王国の正統性が低い", "value": 32, "contribution": 31 },
    { "label": "ヴァルケン家の威信が高い", "value": 81, "contribution": 24 },
    { "label": "家長レオンの野心が高い", "value": 0.88, "contribution": 18 },
    { "label": "家長の国家忠誠が低い", "value": 0.21, "contribution": 16 }
  ],
  "effects": [
    { "label": "北部3プロヴィンスが反乱側に参加" },
    { "label": "王国の安定度が低下", "value": -12 }
  ]
}
```

### 15.5 eventHistory の扱い

`WorldState` には完全な `eventHistory` を持たせない。
tick は `events` を返し、UI 側または `SimulationSession` 側が履歴を蓄積する。

UI 表示用には、Raw Event Log の保持上限を設定する。

```ts
maxRawEvents = 10000
maxChronicleEvents = 1000
```

完全な履歴保存は、後のセーブ/エクスポート機能で検討する。

---

## 16. UI仕様

## 16.1 基本レイアウト

```text
┌──────────────────────────────────────────────┐
│ 上部バー：年月 / 再生停止 / 速度 / seed / 世界生成 │
├───────────────┬──────────────────────────────┤
│ 左サイドバー   │ メインビュー                   │
│ 国家・家・人物 │ 地図またはネットワーク表示       │
│ ウォッチリスト │                              │
├───────────────┴──────────────────────────────┤
│ 下部：イベントログ / 年表 / 重要イベント         │
└──────────────────────────────────────────────┘
```

### 16.2 上部バー

機能：

* 現在年月表示
* 一時停止
* 1か月進める
* 1年進める
* 自動再生
* 速度変更
* seed 表示
* seed 入力
* 新世界生成
* リセット

### 16.3 メインビュー

初期プロトタイプでは、プロヴィンスをノードとして表示する。

表示：

* プロヴィンスノード
* 隣接線
* 国家ごとの色分け
* 家の支配地の表示
* 選択中対象のハイライト
* 反乱中地域の強調
* unrest の視覚化

### 16.4 左サイドバー

タブ構成：

* Countries
* Houses
* Persons
* Watchlist

各リストは検索・ソート可能にする。

推奨ソート：

* 国家: 正統性、領土数、反乱リスク
* 家: 威信、領土数、反乱傾向
* 人物: 重要人物スコア、年齢、役職、野心

### 16.5 詳細パネル

選択対象に応じて表示を切り替える。

#### 国家詳細

* 国名
* 支配プロヴィンス数
* 所属する家
* 国庫
* 正統性
* 統治力
* 安定度
* 反乱リスク
* 役職者
* 最近のイベント
* 状態コメント

#### 家詳細

* 家名
* 所属国家
* 家長
* 領地
* 威信
* 結束
* 国家への忠誠
* 資産
* 反乱傾向
* 主な反乱理由
* 家内人物一覧
* 最近のイベント

#### 個人詳細

* 名前
* 年齢
* 生死
* 所属家
* 所属国家
* 役職
* 行政能力
* 軍事能力
* 野心
* 国家忠誠
* 慎重さ
* prestige
* 現在の危険傾向
* 生涯ログ

### 16.6 イベントログ

イベントログは二層に分ける。

#### Raw Event Log

すべてのイベントを表示する。
開発・デバッグ用途も兼ねる。

#### Chronicle / News

重要イベントのみ表示する。

対象：

* 国家分裂
* 大反乱
* 有力人物死亡
* 王家交代
* 家の断絶
* 大規模災害

### 16.7 ウォッチリスト

プレイヤーは以下をウォッチできる。

* 国家
* 家
* 個人
* プロヴィンス

ウォッチ対象に関係するイベントは強調表示する。

### 16.8 重要イベント通知

重要イベント発生時、画面上に通知を表示する。

例：

```text
大事件: ヴァルケン家が反乱を開始
大事件: エルディア王が死亡
大事件: 北部王国が独立
```

---

## 17. 神の介入

### 17.1 基本方針

プレイヤーは直接命令を出さない。
国家や人物を直接操作することはできない。

ただし、「神」または「観測者」として、間接的な介入は可能にする。

### 17.2 初期プロトタイプでの介入候補

* 豊穣
* 凶作
* 疫病
* 事故率上昇
* 不穏な噂
* 吉兆
* 凶兆

### 17.3 介入の性質

介入は、原則として状態変数に影響を与える。

例：

```text
凶作
→ 対象地域の税収低下
→ 家の wealth 低下
→ unrest 上昇
→ 国家 stability 低下
→ 反乱スコア上昇
```

人物を直接殺すボタンなどは、ゲーム内の神の介入ではなく、デバッグ操作として扱う。

---

## 18. 重要人物スコア

人物が多くなると、プレイヤーは誰を見ればよいか分からなくなる。
そのため、プロトタイプでも重要人物スコアを導入する。

例：

```text
重要人物スコア =
  役職補正
  + 所属家の威信補正
  + 本人 prestige
  + admin / martial 補正
  + ambition 補正
  + 最近のイベント関与数
```

このスコアを使い、人物一覧で「注目人物」を表示する。

---

## 19. テスト方針

### 19.1 決定性テスト

最低限、以下をテストする。

* 同一 seed で同じ初期世界が生成される
* 同一 seed と同一 tick 数で同じイベント列が出る
* `Math.random()` を使っていない
* ID ソート規約により処理順が安定している

### 19.2 整合性テスト

最低限、以下をテストする。

* 100年回しても参照切れが起きない
* 死亡人物が役職に残らない
* 存在しない家が領地を持たない
* 存在しない国家に家が所属しない
* active House の家長が生存している
* Province.ownerHouseId と House.provinceIds が一致する
* Province.countryId と House.countryId が一致する
* Person.countryId と Person.houseId の House.countryId が一致する

### 19.3 長期実行テスト

* 50年: 最低限の動作確認
* 100年: 世代交代と国家変化の確認
* 200年: 長期安定性の確認

---

## 20. 開発タスク分割

### Phase 1: 基盤

* Vite + React + TypeScript プロジェクト作成
* sim/ と app/ の分離
* ID 型定義
* RNG 実装
* FNV-1a seed hash 実装
* WorldState 型定義
* Source of Truth 用 mutation 関数の作成
* generateWorld 実装

### Phase 2: tick 最小実装

* 時間進行
* economySystem
* mortalitySystem
* emergenceSystem
* successionSystem
* event 生成
* integritySystem
* 決定性テスト

### Phase 3: 政治システム

* appointmentSystem
* governanceSystem
* ambitionSystem
* plotSystem
* rebellionSystem
* stabilitySystem
* 反乱理由の explain 実装

### Phase 4: UI 基礎

* 上部コントロールバー
* 地図/ネットワーク表示
* 左サイドバー
* 詳細パネル
* イベントログ

### Phase 5: 観戦体験強化

* Chronicle / News
* ウォッチリスト
* 重要イベント通知
* タイムライン
* 重要人物スコア
* パラメータ調整パネル

### Phase 6: 検証

* 50年 / 100年 / 200年シミュレーション
* 反乱頻度の調整
* 世代交代の観察
* 国家分裂の観察
* UI上の見やすさ確認
* 次フェーズに進むべき要素の洗い出し

---

## 21. 成功条件

### 21.1 最低成功

* 30〜50プロヴィンスの世界が生成される
* 3国家、15家、90〜100人程度が存在する
* 月次 tick で世界が進む
* 任命、死亡、補充、継承、陰謀、反乱が発生する
* イベントログに理由が出る
* seed 固定で同じ展開を再現できる
* Web UI で国家・家・人物を観察できる

### 21.2 十分成功

* プレイヤーが自然に「この人物を追いたい」と思える
* 反乱や国家崩壊に納得感がある
* パラメータ調整で世界の雰囲気が変わる
* 100〜200年回して、家系や国家の盛衰が見える
* UI 上で「歴史を見ている」感がある

### 21.3 大成功

* 何も介入しなくても眺めていられる
* イベントログを読むだけで物語になる
* 「次は POP を入れたい」「宗教を入れたい」と自然に思える
* コア設計の不足点が見えてくる

---

## 22. 予想される課題

### 22.1 反乱が多すぎる / 少なすぎる

反乱の発生頻度は、最初に大きく崩れやすい。
これはパラメータ調整とモデル設計の両方に関わる。

### 22.2 ログが多すぎる

Raw Event Log と Chronicle を分けることで対処する。

### 22.3 誰を見ればよいか分からない

重要人物スコア、ウォッチリスト、重要イベント通知で対処する。

### 22.4 因果が見えない

すべての重要イベントに `reasons` を持たせることで対処する。

### 22.5 状態整合性が壊れる

tick 末尾で integrity check を行う。

---

## 23. 次フェーズ候補

本プロトタイプで個人・家・国家の相互作用が面白く動くことを確認できた場合、次フェーズでは以下を検討する。

### 23.1 POP の導入

Province 内に POP を導入し、以下を扱う。

* 身分
* 職業
* 文化
* 宗教
* 思想
* 支持対象
* 不満
* 所得

### 23.2 宗教・文化

* 宗教対立
* 改宗
* 異端
* 文化同化
* 少数派保護

### 23.3 戦争の詳細化

* 軍隊ユニット
* 指揮官
* 補給
* 戦線
* 包囲
* 戦争目的

### 23.4 制度・法

* 継承法
* 中央集権度
* 貴族特権
* 課税制度
* 宗教政策

### 23.5 経済の詳細化

* 産物
* 交易
* 都市
* 市場
* 物流
* 階層別所得

---

## 24. コーディングエージェント向け要約

このプロジェクトは、歴史シミュレーションゲームの技術検証プロトタイプである。

完成品ではなく、以下を検証するための Web アプリを作る。

* 月次 tick で進む自律的な歴史世界
* 個人・家・国家の相互作用
* seed 付き乱数による決定的リプレイ
* イベントログと因果説明による観戦体験
* 将来的な Rust/WASM 化を見据えたシミュレーションコアの分離

実装上の最重要方針：

* `src/sim/` は React に依存しない
* 乱数は seed 付き RNG に統一する
* seed 文字列の hash は FNV-1a 32bit を使う
* `Math.random()` は禁止
* Record の処理順は必ず ID ソートで決定する
* 重要イベントには必ず reasons を持たせる
* UI はリッチにしてよいが、コアから分離する
* プロトタイプなので UI は後で捨ててもよい
* コアの入出力境界は将来残す前提で設計する
* `Province.ownerHouseId` を領地所有の source of truth とする
* `Country.roleAssignments` を役職の source of truth とする
* `Person.role` は持たない
* `War` 型は導入せず、反乱は即時解決する
* `WorldState` に完全な eventHistory は持たせない

以上。
