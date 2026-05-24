# Chronicae v0.25 仕様書

## 代官システム改修: Bailiff, Local Extraction, Revenue Task

## 0. この仕様の目的

v0.25 では、`HoldingOfficeAssignment` によって表現される **代官職**を、単なる「Holding に紐づいた人物」から、以下を担う実務的・物語的な主体へ拡張する。

```text
- 現地 POP からの徴税・負担調整
- 末端土地契約者への送金
- 代官本人の取り分取得
- POP から代官への Attitude 形成
- placeholder 代官と通常人物代官の差別化
- 通常人物代官の月次 Task 化
```

v0.25 の基本方針は、**制度が直接結果を出すのではなく、制度が人物に仕事を発生させ、その人物の能力・性格・方針・Task 処理状況を通じて結果が変わる**という方向への第一歩である。

ただし、このバージョンでは対象を代官職に限定する。Polity / House の通常役職全般を Task 化する大規模改修は行わない。

### 0.1 レビュー決定事項

本仕様書は初回ドラフトに対するコードレビューと設計検討を経て改訂された。主な決定事項:

```text
- 収入フロー: extraction モデルを採用する (レビュー B案)。
  現行経済は収入過多・支出過少であり、既存 treasury 流入量を維持する必要はない。
  LandContract chain には grossHoldingRevenue ではなく remittanceToTerminal を流す。

- Task outcome: TaskSystem に多段階判定を入れない (レビュー C案)。
  Task は completed / none の 2値扱いとし、
  collectionEfficiency は LandRevenueSystem 側で代官能力から計算する。

- 既存報酬経路: bailiffRevenueShare と officeCompensationSystem の bailiff 給与を廃止し、
  bailiffFeeRate に一本化する。

- localExtractionRate 標準は約 50% (五公五民) を目標に設定する。
```

### 0.2 実装 Phase

v0.25 は 3 Phase に分けて実装する。各 Phase 完了時に `npm run check` + CLI 検証を行い、壊れていないことを確認してから次へ進む。

#### Phase A: 基盤 (型・Config・Selector)

```text
対象セクション: §3, §4, §5, §7, §8, §14, §20.1

実装内容:
- 型定義 (BailiffPolicy, BailiffRevenueTaskStatus,
  HoldingOfficeAssignment 拡張, TaskKind / TaskTargetRef 拡張)
- Config 追加 + bailiffRevenueShare 廃止
- Worldgen / assignment 作成箇所の更新
- 全 selector:
  getBailiffStewardshipScore, getHoldingAverageUnrest,
  getBailiffPolicy / getBailiffPolicyScores,
  getBailiffLocalExtractionRate, getBailiffCollectionEfficiency,
  getBailiffFeeRate, computeBailiffBurdenComponents,
  getRecentBailiffRevenueTaskStatus
- Selector 単体テスト

完了条件:
- npm run check 通過
- 新規 selector の単体テストが全て pass
- 既存テスト全 pass (selector は追加のみで既存ロジックに未接続のため)
```

#### Phase B: システム改修 (本丸)

```text
対象セクション: §9, §10, §11, §12, §13, §15, §20.2-20.5

実装内容:
- bailiffRevenueTaskSystem 新設 (ScheduledSystem として tick.ts に追加)
  - 4 週ごとに collect_holding_revenue Task を生成
  - 前月未完了 Task の期限切れ処理 (failTaskAsExpired)
  - placeholder 除外
- TaskSystem の autoCancelTasksMut に holding_office_assignment 対応追加
- LandRevenueSystem 改修:
  - extraction モデル導入 (chain 入力を remittanceToTerminal に差し替え)
  - retainedToPop を provinceCollected ベースに再定義
  - burden 分解 (actualExtraction / collectionFriction / total)
  - POP wealth: retainedToPop で回復 + collectionFrictionBurdenRate で損耗
  - POP unrest: totalBurdenRate が comfort 超過分で上昇
  - POP → Bailiff Attitude 更新
- giveSingleHoldingBailiffSalary() 廃止
- officeCompensationSystem の bailiff 給与廃止
- overExtractionPenalty を burden 分解処理に置換
- Debug log ([DEBUG:BAILIFF])

完了条件:
- npm run check 通過
- CLI 300 年 × 4 seed 完走 (IntegrityCheck violation 0)
- NaN / Infinity なし
- Person wealth が異常増殖しない
- POP unrest が全 Holding で即座に 100 に張り付かない
```

#### Phase C: UI + 検証

```text
対象セクション: §16, §17

実装内容:
- IntegrityCheck 拡張 (§17 の全項目)
- Holding 詳細 UI に代官情報を表示:
  代官名, BailiffPolicy, localExtractionRate, collectionEfficiency,
  bailiffFeeRate, totalBurdenRate, collectionFrictionBurdenRate,
  recent Task status, POP → 代官 Attitude
- i18n キー追加

完了条件:
- npm run check 通過
- CLI 300 年 × 4 seed 完走
- UI でブラウザ確認: Holding 詳細に代官情報が表示される
```

---

## 1. v0.25 のスコープ

### 1.1 v0.25 で実装するもの

```text
- HoldingOfficeAssignment に代官徴税条件を追加する
- BailiffPolicy を selector で導出する
- placeholder 代官を passive fallback として扱う
- 通常人物代官に月次 collect_holding_revenue Task を生成する
- 前月 Task 未処理時は期限切れとして締める
- LandRevenueSystem に localExtractionRate / collectionEfficiency / bailiffFeeRate を挟む
- LandContract chain への入力を grossHoldingRevenue から remittanceToTerminal に変更する
- 代官本人の wealth に取り分を加算する
- POP wealth / unrest に現地負担を反映する
- POP から代官への Attitude を更新する
- UI に代官方針・実効負担・徴税効率・直近 Task status を表示する
- IntegrityCheck を拡張する
```

### 1.2 v0.25 で廃止するもの

```text
- config.bailiffRevenueShare および giveSingleHoldingBailiffSalary()
  → bailiffFeeRate に一本化する
- officeCompensationSystem の bailiff 給与支払い処理
  → 代官は Polity treasury から月給を受け取らない。
    代官の収入は、徴税処理で発生する bailiffFee を基本とする。
- Province レベルの overExtractionPenalty
  → Holding レベルの effectiveBurdenRate ベース処理に置換する
```

### 1.3 v0.25 では実装しないもの

```text
- 独立 BailiffContract エンティティ
- 代官契約履歴・監査・再契約
- 代官による上位者交渉
- 代官による住民調停 Task
- 代官の反乱指導者化
- Project / Improvement による土地開発
- 代官による開発 Task
- LocalSettlement / 慣習権 / 都市特権
- 農奴制・移動制限
- POP occupation の詳細細分化
- Polity / House 役職全般の定例 Task 化
- 組織規模に応じた行政 Task 発生量
- TaskSystem の汎用 success/partial/failure 判定
```

反乱システムとの接続、特に「住民に支持された代官が反乱指導者になる」ルートは将来課題とする。

---

## 2. 基本概念

### 2.1 LandContract 上納と現地徴税を分ける

既存の `LandContract.terms.taxRateToGrantor` は、土地契約 chain 上で下位契約者が上位契約者へ納める上納率である。

これは v0.25 でも維持する。

```text
LandContract.terms.taxRateToGrantor
= 下位契約者から上位契約者への上納率
```

一方、現地 POP が実際に負担する税・賦役・徴収は別概念として扱う。

```text
localExtractionRate / local burden
= 代官が現地 POP から実際に徴収する負担
  標準で約 50% (五公五民)
```

v0.25 では次を分離する。

```text
上位契約への上納率:
  LandContract.terms.taxRateToGrantor

末端契約者が代官に期待する送金条件:
  HoldingOfficeAssignment.contractedRemittanceRate

慣習的・契約上認められた代官取り分:
  HoldingOfficeAssignment.expectedFeeRate

代官が実際に POP に課す現地負担:
  selector getBailiffLocalExtractionRate(...)

実際の徴税成功度:
  selector getBailiffCollectionEfficiency(...)

実際の代官取り分率:
  selector getBailiffFeeRate(...)
```

### 2.2 既存経済モデルからの移行

現行 LandRevenueSystem は `holdingRevenue` (POP 生産量合計) の 100% を LandContract chain に流す。v0.25 では、chain に流入するのは代官が実際に徴収して送金する `remittanceToTerminal` のみとなる。

```text
現行:
  chain 入力 = holdingRevenue (全額)
  bailiff 取り分 = terminal retained × bailiffRevenueShare (0.10)

v0.25:
  chain 入力 = grossHoldingRevenue × localExtractionRate × collectionEfficiency - bailiffFee
  bailiff 取り分 = collected × bailiffFeeRate
```

これにより Polity treasury 収入は現行より減少する。これは意図的な経済再調整である。

```text
現行経済の問題:
  - 国・家が大量の wealth / treasury を蓄積しやすい
  - 収入が多すぎ、支出が少なすぎる
  - 代官の能力や方針が経済に影響しない

v0.25 の狙い:
  - 現地代官の能力・方針が treasury 収入に影響する
  - POP が生産の過半を保持する (五公五民)
  - 代官の取り分が人物経済に影響する
  - 全体的な収入減を許容する
```

---

## 3. データ構造変更

### 3.1 BailiffPolicy

`BailiffPolicy` は **保存フィールドではなく selector の戻り値**とする。

```ts
export type BailiffPolicy =
  | 'passive'
  | 'loyal_remittance'
  | 'profit_seeking'
  | 'protect_residents'
```

各方針の意味:

```text
passive:
  最低限のみ行い、問題を放置する。placeholder 的。

loyal_remittance:
  末端契約者への送金を優先する。

profit_seeking:
  自分の取り分を増やす。

protect_residents:
  住民負担を下げようとする。
```

将来的には以下を追加可能だが、v0.25 では扱わない。

```ts
| 'maintain_order'
| 'develop_holding'
| 'build_local_power'
```

### 3.2 HoldingOfficeAssignment の拡張

`HoldingOfficeAssignment` に制度上・契約上の徴税条件を追加する。

```ts
export type HoldingOfficeRole = 'bailiff'

export type HoldingOfficeAssignment = {
  id: HoldingOfficeAssignmentId
  holdingId: HoldingId
  role: HoldingOfficeRole
  holderPersonId: PersonId
  appointingPolityId: PolityId
  active: boolean
  startWeek: number
  unpaidCount: number

  // v0.25 追加
  contractedRemittanceRate: number
  expectedFeeRate: number
}
```

`unpaidCount` は既存互換のため維持する。v0.25 では代官報酬を `bailiffFeeRate` に一本化するため、`officeCompensationSystem` による bailiff 給与未払い判定には使わない。将来、俸給型役職と徴税請負型役職を分ける際に再整理する。

### 3.3 BailiffRevenueTaskStatus

collect_holding_revenue Task の状態は 2 値で扱う。

```ts
export type BailiffRevenueTaskStatus =
  | 'completed'
  | 'none'
```

```text
completed:
  代官が今月の徴税業務に時間を割り、Task を完了した

none:
  以下のいずれか:
  - placeholder 代官
  - 初月で Task 履歴がまだない
  - 前月 Task が完了しなかった (期限切れ)
  - 対象 Task が存在しない
```

TaskSystem に多段階 outcome 判定 (success/partial/failure) は導入しない。理由:

```text
- TaskSystem は汎用的な人物行動処理であり、徴税専用の多段階判定は責務が広がる
- v0.25 の主題は LandRevenueSystem と代官徴税の接続であり、効率計算は LRS 側に置く
- 多段階 outcome は将来 TaskSystem 全体を拡張する際にまとめて導入する
```

### 3.4 保存しない値

以下は保存せず、selector で導出する。

```text
BailiffPolicy
localExtractionRate
collectionEfficiency
bailiffFeeRate
actualExtractionBurdenRate
collectionFrictionBurdenRate
totalBurdenRate
recent collect_holding_revenue Task status
```

理由:

```text
- BailiffPolicy は人物の資質・性格・現地状況から導出されるべき
- 実効負担や徴税効率は Task 処理状況や能力で変化する
- 保存すると派生状態の不整合が起こりやすい
```

---

## 4. SimulationConfig 追加

### 4.1 Config フィールド

v0.25 で以下の config を追加する。

```ts
export type SimulationConfig = {
  // existing...

  // Bailiff terms defaults
  defaultContractedRemittanceRate: number
  defaultExpectedBailiffFeeRate: number

  // Local extraction
  minLocalExtractionRate: number
  maxLocalExtractionRate: number
  comfortableLocalExtractionRate: number

  // Collection efficiency
  minBailiffCollectionEfficiency: number
  baseBailiffCollectionEfficiency: number
  placeholderBailiffCollectionEfficiency: number

  // Collection friction
  collectionFrictionFactor: number

  // Bailiff fee
  maxBailiffFeeRate: number

  // Task status modifiers
  bailiffTaskCompletedCollectionModifier: number
  bailiffTaskNoneCollectionModifier: number

  // POP burden effects
  localExtractionWealthPenalty: number
  localExtractionUnrestGain: number

  // POP -> Bailiff attitude effects
  bailiffBurdenAffectionPenaltyFactor: number
  bailiffProtectResidentsAffectionBonus: number
  bailiffTaskCompletedRespectGain: number
}
```

### 4.2 廃止する Config フィールド

```ts
// 廃止
bailiffRevenueShare: number  // → bailiffFeeRate に置換
```

`officeCompensationSystem` 内の bailiff 給与関連処理も廃止する。

### 4.3 推奨デフォルト

```ts
defaultContractedRemittanceRate: 0.40
defaultExpectedBailiffFeeRate: 0.10
// base localExtractionRate = 0.50 (五公五民)

minLocalExtractionRate: 0.10
maxLocalExtractionRate: 0.80
comfortableLocalExtractionRate: 0.35

minBailiffCollectionEfficiency: 0.30
baseBailiffCollectionEfficiency: 0.55
placeholderBailiffCollectionEfficiency: 0.40

maxBailiffFeeRate: 0.25

collectionFrictionFactor: 0.5

bailiffTaskCompletedCollectionModifier: 0.05
bailiffTaskNoneCollectionModifier: 0.00

localExtractionWealthPenalty: 4
localExtractionUnrestGain: 3

bailiffBurdenAffectionPenaltyFactor: 2
bailiffProtectResidentsAffectionBonus: 0.2
bailiffTaskCompletedRespectGain: 0.2
```

### 4.4 内部定数 (config 昇格可)

以下は調整頻度が低いため、初期実装では内部定数としてよい。バランス調整で頻繁に変更する場合は config に昇格する。

```ts
// Policy modifiers for localExtractionRate
const BAILIFF_POLICY_EXTRACTION_MODIFIER: Record<BailiffPolicy, number> = {
  passive: 0.00,
  loyal_remittance: 0.03,
  profit_seeking: 0.08,
  protect_residents: -0.05,
}

// Policy modifiers for bailiffFeeRate
const BAILIFF_POLICY_FEE_MODIFIER: Record<BailiffPolicy, number> = {
  passive: 0.00,
  loyal_remittance: 0.00,
  profit_seeking: 0.05,
  protect_residents: -0.03,
}

// Policy modifiers for collectionEfficiency
const BAILIFF_POLICY_COLLECTION_MODIFIER: Record<BailiffPolicy, number> = {
  passive: -0.05,
  loyal_remittance: 0.02,
  profit_seeking: 0.05,
  protect_residents: -0.03,
}
```

---

## 5. Worldgen / 既存データ初期化

### 5.1 HoldingOfficeAssignment 作成時

新規 `HoldingOfficeAssignment` 作成時、追加フィールドにデフォルト値を入れる。

```ts
contractedRemittanceRate = config.defaultContractedRemittanceRate
expectedFeeRate = config.defaultExpectedBailiffFeeRate
```

### 5.2 既存 save / worldstate 互換

プロトタイプ段階なので破壊的変更を許容する場合は migration 不要。

ただし、既存 worldstate を読み込む経路がある場合は、欠損時に default を補完する。

```ts
assignment.contractedRemittanceRate ??= config.defaultContractedRemittanceRate
assignment.expectedFeeRate ??= config.defaultExpectedBailiffFeeRate
```

---

## 6. Placeholder 代官

### 6.1 基本方針

placeholder 代官は、Person としては存在するが、無人格な fallback 執行者として扱う。

```text
- 最低限の徴税は行う
- collect_holding_revenue Task は生成しない
- ActivityLog も生成しない
- BailiffPolicy は passive 固定
- 積極的な開発・交渉・問題解決はしない
- 強い収奪もしない
- 住民問題を放置しがち
- POP から代官への Attitude 更新をしない
```

### 6.2 selector 上の扱い

placeholder 判定は `person.kind === 'placeholder'` のみを使う。

```ts
if (person.kind === 'placeholder') {
  return 'passive'
}
```

`Person.kind` は optional フィールドであり、通常人物では `undefined` の場合がある。したがって、`person.kind === 'normal'` による判定は使わない。

徴税効率は 0 ではなく、低めの固定値を使う。

```ts
collectionEfficiency = config.placeholderBailiffCollectionEfficiency
```

---

## 7. BailiffPolicy selector

### 7.1 selector 追加

```ts
export function getBailiffPolicy(
  state: WorldState,
  config: SimulationConfig,
  assignmentId: HoldingOfficeAssignmentId,
): BailiffPolicy
```

必要ならデバッグ・UI 用に score も返せるようにする。

```ts
export function getBailiffPolicyScores(
  state: WorldState,
  config: SimulationConfig,
  assignmentId: HoldingOfficeAssignmentId,
): Record<BailiffPolicy, number>
```

### 7.2 入力

v0.25 で使用する入力は最小限にする。

```text
- holderPersonId
- placeholder 判定
- numeracy
- learning
- insight
- charisma
- command
- ambition
- caution
- Holding 内 POP の平均 unrest
```

v0.25 では以下をまだ使わない。

```text
- POP から代官への Attitude
- 任命者から代官への Attitude
- Goal / Aim
- ActivityLog 履歴
```

これらは将来的に方針変化へ組み込めるが、v0.25 では feedback loop を強くしすぎない。

### 7.3 共通 helper: getBailiffStewardshipScore

BailiffPolicy 判定と collectionEfficiency 計算の両方で使用する共通 helper。

```ts
export function getBailiffStewardshipScore(person: Person): number {
  const a = person.abilities
  const t = person.traits
  return (
    a.numeracy * 0.50 +
    a.learning * 0.20 +
    a.insight * 0.20 +
    t.caution * 120 * 0.10
  )
}
```

能力値スケールは 0..120、trait は 0..1。stewardship の理論最大値は 120。

### 7.4 getHoldingAverageUnrest selector

BailiffPolicy 判定で使用する新規 selector。

```ts
export function getHoldingAverageUnrest(
  state: WorldState,
  holdingId: HoldingId,
): number
```

仕様:

```text
- holdingId に属する PopGroup を集める
- size 加重平均で unrest を返す
- POP が存在しない場合は 0 を返す
- 戻り値の範囲は 0..100
```

### 7.5 推奨判定式

```ts
function getBailiffPolicyScores(
  state: WorldState,
  config: SimulationConfig,
  assignmentId: HoldingOfficeAssignmentId,
): Record<BailiffPolicy, number> {
  const assignment = getHoldingOfficeAssignmentOrThrow(state, assignmentId)
  const person = getPersonOrThrow(state, assignment.holderPersonId)

  if (person.kind === 'placeholder') {
    return {
      passive: 999,
      loyal_remittance: 0,
      profit_seeking: 0,
      protect_residents: 0,
    }
  }

  const a = person.abilities
  const t = person.traits

  const stewardship = getBailiffStewardshipScore(person)

  const localUnrest = getHoldingAverageUnrest(state, assignment.holdingId)

  const passive =
    Math.max(0, 70 - stewardship)

  const loyal_remittance =
    stewardship * 0.60 +
    a.command * 0.10 +
    t.caution * 120 * 0.30

  const profit_seeking =
    t.ambition * 120 * 0.60 +
    (1 - t.caution) * 120 * 0.20 +
    a.numeracy * 0.20

  const protect_residents =
    a.charisma * 0.25 +
    a.insight * 0.30 +
    t.caution * 120 * 0.20 +
    localUnrest * 0.25

  return {
    passive,
    loyal_remittance,
    profit_seeking,
    protect_residents,
  }
}
```

`getBailiffPolicy` は最大 score の policy を返す。

同点時の優先順位は、プロトタイプでは安定性重視で固定する。

```text
protect_residents
profit_seeking
loyal_remittance
passive
```

または実装者判断で deterministic な tie-break を使う。

---

## 8. 代官徴税 selector

### 8.1 localExtractionRate

```ts
export function getBailiffLocalExtractionRate(
  state: WorldState,
  config: SimulationConfig,
  assignmentId: HoldingOfficeAssignmentId,
): number
```

計算式:

```ts
const base =
  assignment.contractedRemittanceRate +
  assignment.expectedFeeRate

const policy = getBailiffPolicy(state, config, assignmentId)

const policyModifier =
  BAILIFF_POLICY_EXTRACTION_MODIFIER[policy]

return clamp(
  base + policyModifier,
  config.minLocalExtractionRate,
  config.maxLocalExtractionRate,
)
```

デフォルトの base は `0.40 + 0.10 = 0.50` (五公五民)。

意味:

```text
localExtractionRate:
  POP に課される現地負担の強さ。
  高いほど POP wealth 低下・unrest 上昇・代官への affection 低下。
```

### 8.2 collectionEfficiency

```ts
export function getBailiffCollectionEfficiency(
  state: WorldState,
  config: SimulationConfig,
  assignmentId: HoldingOfficeAssignmentId,
  recentTaskStatus: BailiffRevenueTaskStatus,
): number
```

計算式:

```ts
const assignment = ...
const person = ...

if (person.kind === 'placeholder') {
  return clamp(
    config.placeholderBailiffCollectionEfficiency,
    config.minBailiffCollectionEfficiency,
    1.0,
  )
}

const stewardship = getBailiffStewardshipScore(person)
const a = person.abilities
const t = person.traits

const skillModifier =
  (stewardship / 120) * 0.25 +
  (a.command / 120) * 0.05 +
  (a.charisma / 120) * 0.05 +
  t.caution * 0.05

const policy = getBailiffPolicy(state, config, assignmentId)
const policyModifier =
  BAILIFF_POLICY_COLLECTION_MODIFIER[policy]

const taskModifier =
  recentTaskStatus === 'completed'
    ? config.bailiffTaskCompletedCollectionModifier
    : config.bailiffTaskNoneCollectionModifier

return clamp(
  config.baseBailiffCollectionEfficiency + skillModifier + policyModifier + taskModifier,
  config.minBailiffCollectionEfficiency,
  1.0,
)
```

意味:

```text
collectionEfficiency:
  予定された現地徴収額をどれだけ実際に徴収できるか。
  100% を超えない。
  placeholder でも 0 にはならない。
  代官の能力・方針・Task 処理状況から LandRevenueSystem 側で計算する。
```

### 8.3 bailiffFeeRate

```ts
export function getBailiffFeeRate(
  state: WorldState,
  config: SimulationConfig,
  assignmentId: HoldingOfficeAssignmentId,
): number
```

計算式:

```ts
const base = assignment.expectedFeeRate
const policy = getBailiffPolicy(state, config, assignmentId)
const policyModifier = BAILIFF_POLICY_FEE_MODIFIER[policy]

return clamp(
  base + policyModifier,
  0,
  config.maxBailiffFeeRate,
)
```

人物の性格 (ambition/caution) は `BailiffPolicy` selector に反映されるため、feeRate では直接補正しない。

意味:

```text
bailiffFeeRate:
  実際に徴収された額のうち代官本人が得る割合。
  これは必ずしも腐敗ではなく、任地収入・徴税代行報酬を含む。
```

### 8.4 徴税負担の分解

`collectionEfficiency` は、単に「厳しく取り立てる能力」ではなく、**徴税過程の摩擦を減らす能力**として扱う。帳簿管理、徴税、交渉、送金、現地把握を秩序立てて行い、取り漏れ・二重徴収・中抜き・隠匿・逃散・混乱を減らす能力である。

POP への負担を 2 成分に分解する。

```ts
export function computeBailiffBurdenComponents(
  localExtractionRate: number,
  collectionEfficiency: number,
  collectionFrictionFactor: number,
): {
  actualExtractionBurdenRate: number
  collectionFrictionBurdenRate: number
  totalBurdenRate: number
} {
  const actualExtractionBurdenRate =
    localExtractionRate * collectionEfficiency

  const collectionFrictionBurdenRate =
    localExtractionRate *
    (1 - collectionEfficiency) *
    collectionFrictionFactor

  return {
    actualExtractionBurdenRate,
    collectionFrictionBurdenRate,
    totalBurdenRate: actualExtractionBurdenRate + collectionFrictionBurdenRate,
  }
}
```

各値の意味:

```text
actualExtractionBurdenRate:
  実際に徴収された分による負担。
  collectionEfficiency が高いほど増える。
  retainedToPop の減少として経済的にはすでに表現されている。

collectionFrictionBurdenRate:
  徴税過程の非効率・混乱・隠匿・逃散・賄賂・二重徴収などによる社会的負担。
  collectionEfficiency が低いほど増える。
  POP wealth への追加損耗として使う。

totalBurdenRate:
  POP unrest / Attitude に使う総合的な徴税負担。
  数学的には旧 effectiveBurdenRate と同値:
    totalBurdenRate = localExtractionRate * (0.5 + 0.5 * collectionEfficiency)
    (collectionFrictionFactor = 0.5 のとき)
```

この分解により、collectionEfficiency の上昇は以下の効果を持つ:

```text
支配者:
  collected が増えるため有利。

POP:
  実際に取られる額は増えるが、
  徴税摩擦・混乱・社会的損耗は減る。

代官:
  有能な代官として respect を得やすい。
```

v0.25 では、collectionEfficiency の低さによって生じる未徴収分・中抜き・隠匿・逃散・混乱は、具体的な受益者を持つ wealth transfer としては追跡しない。これは `collectionFrictionBurdenRate` として抽象化し、POP wealth / unrest / Attitude / terminal income にのみ反映する。

---

## 9. collect_holding_revenue Task

### 9.1 TaskKind 追加

`TaskKind` に以下を追加する。

```ts
| 'collect_holding_revenue'
```

意味:

```text
代官が任地 Holding の徴税・帳簿確認・送金準備・現地負担調整を行う月次定例業務。
```

### 9.2 TaskTargetRef 拡張

```ts
export type TaskTargetRef =
  | { kind: 'aim'; id: AimId }
  | { kind: 'intent'; id: ActorIntentId }
  | { kind: 'diplomatic_play'; id: DiplomaticPlayId }
  | { kind: 'holding_office_assignment'; id: HoldingOfficeAssignmentId }
```

`collect_holding_revenue` は必ず `holding_office_assignment` を target にする。

```ts
targetRef: {
  kind: 'holding_office_assignment',
  id: assignment.id,
}
```

### 9.3 Task 生成条件

4 週ごとに、active な代官職を走査する。

```text
条件:
- assignment.role === 'bailiff'
- assignment.active === true
- holderPersonId が通常人物 (kind !== 'placeholder')
- holderPersonId が alive
```

placeholder 代官には Task を生成しない。

### 9.4 代官兼任について

現行仕様では代官の兼任はできない。

そのため、v0.25 では「複数 Holding を処理しきれない負荷」は考慮しない。

```text
- 1 人の通常人物代官は、最大 1 HoldingOfficeAssignment のみを持つ
- collect_holding_revenue は月内に処理できる軽量 Task とする
```

将来、兼任を許可する場合は `effortRequired` / `priority` / 行政負荷システムを見直す。

### 9.5 Task パラメータ

推奨値:

```ts
kind: 'collect_holding_revenue'
actionCost: config.taskActionCostLight
effortRequired: Math.ceil(config.taskEffortRequiredLight * BAILIFF_REVENUE_EFFORT_MULTIPLIER)
deadlineWeek: createdWeek + 4
priority: 1
```

`BAILIFF_REVENUE_EFFORT_MULTIPLIER = 1.5` は内部定数。通常 Task より少し重い月次業務を表す。

`priority: 1` は既存 Task と同じスケール。collect_holding_revenue は重要な月次業務だが、他 Task を常に圧倒する必要はない。

actionCost / effortRequired はハードコードせず、既存 config の taskActionCostLight / taskEffortRequiredLight を基準にする。これにより Task 全体のバランス調整時に代官業務も連動する。

### 9.6 前月 Task の締め処理

4 週ごとの生成時に、同じ `holding_office_assignment` を target に持つ未完了 `collect_holding_revenue` Task が残っている場合、その Task は期限切れとして締める。

処理順:

```text
1. active collect_holding_revenue Task を検索
2. 前月分が残っていれば期限切れとして削除
3. PersonActivityLog を作成 (kind='task_expired', taskKind='collect_holding_revenue')
4. 今月分の collect_holding_revenue Task を新規作成
```

`failTaskAsExpired()` を専用 helper/mutation として定義する。この処理は `bailiffRevenueTaskSystem` 内で行い、TaskSystem 全体に deadline failure 機構は導入しない。

### 9.7 Task capacity の共有

`collect_holding_revenue` は既存 Task と weeklyActionCapacity を共有する。

```text
代官が他の Task (perform_office_duties, study_law 等) を多数抱えている場合、
collect_holding_revenue が処理されない可能性がある。
これは、人物が多忙で職務を処理しきれないことを表す意図的な挙動である。
```

---

## 10. ActivityLog / Event / Debug log

### 10.1 ActivityLog

`collect_holding_revenue` の完了時には `PersonActivityLog` を残す。

記録する情報:

```text
- personId
- week
- taskKind: collect_holding_revenue
- targetRef: holding_office_assignment
- outcome: success (TaskSystem の既存完了処理に合わせる)
```

期限切れ時にも ActivityLog を残す。

```text
- personId
- week
- taskKind: collect_holding_revenue
- kind: task_expired (既存 ActivityLog schema に合わせる)
- outcome: failure
```

### 10.2 Event

通常 Event は原則発生させない。

理由:

```text
- collect_holding_revenue は月次・Holding 単位で大量発生する
- 通常 Event に出すと歴史ログが汚れる
```

将来的には、bailiffFeeRate が高い状態が続く、または effectiveBurdenRate が高い状態が続く場合、監査・告発・住民請願・反乱前兆 Event へ接続する。v0.25 では debug log のみとする。

### 10.3 Debug log

`config.debug === true` の場合、代官徴税処理の debug log を stderr に出す。

形式は既存 debug log に合わせる。

例:

```text
[DEBUG:BAILIFF] week=124 holding=hl-12 bailiff=pe-33 task=completed policy=loyal_remittance localExtractionRate=0.53 collectionEfficiency=0.72 feeRate=0.10 collected=38.2 bailiffFee=3.82 remittance=34.38 friction=0.074 totalBurden=0.456
```

通常 Event とは別系統とする。

---

## 11. LandRevenueSystem 改修

### 11.1 基本フロー

v0.25 では、LandRevenueSystem の処理を Holding 単位に細分化し、代官による現地徴収を挟む。

概念フロー:

```text
[Holding 単位]
Holding gross revenue (POP 生産量合計)
→ localExtractionRate により徴収予定額を決める
→ collectionEfficiency により実際の徴収額を決める
→ bailiffFeeRate により代官取り分を差し引く
→ remittanceToTerminal を LandContract chain へ流す

[Province 単位]
→ LandContract chain に沿って上位へ上納
→ taxEfficiency を掛けて Polity treasury に加算

[Holding 単位]
→ burden 分解: actualExtractionBurdenRate / collectionFrictionBurdenRate / totalBurdenRate
→ POP wealth: retainedToPop で回復 + collectionFrictionBurdenRate で損耗
→ POP unrest: totalBurdenRate が comfort を超えた分で上昇
→ POP から代官への Attitude を更新
```

### 11.2 廃止する既存処理

```text
- giveSingleHoldingBailiffSalary(): 代官給与を terminal retained から計算する処理を廃止
- config.bailiffRevenueShare: 廃止
- officeCompensationSystem 内の bailiff 給与支払い: 廃止
- Province レベルの overExtractionPenalty: Holding レベルの totalBurdenRate 処理に置換
```

### 11.3 推奨計算式

```ts
const grossHoldingRevenue = getHoldingProduction(state, config, holdingId)

const assignment = getActiveBailiffAssignmentForHolding(state, holding.id)
const recentTaskStatus = getRecentBailiffRevenueTaskStatus(
  state,
  assignment.id,
)

const localExtractionRate =
  getBailiffLocalExtractionRate(state, config, assignment.id)

const collectionEfficiency =
  getBailiffCollectionEfficiency(
    state,
    config,
    assignment.id,
    recentTaskStatus,
  )

const collected =
  grossHoldingRevenue *
  localExtractionRate *
  collectionEfficiency

const bailiffFeeRate =
  getBailiffFeeRate(state, config, assignment.id)

const bailiffFee =
  collected * bailiffFeeRate

const remittanceToTerminal =
  collected - bailiffFee
```

### 11.4 Person wealth 加算

通常人物代官の場合:

```ts
person.wealth += bailiffFee
```

placeholder 代官の場合は加算しない。

```text
placeholder は無人格な fallback 執行者であり、資産形成主体ではない。
```

### 11.5 terminal Polity 収入と LandContract chain

`remittanceToTerminal` を、既存 LandContract chain の入力額として使う。

既存 chain 処理は terminal → root に走査しながら各段で配分する形式。v0.25 では chain の処理ロジック自体は維持し、入力額だけを `grossHoldingRevenue` から `remittanceToTerminal` に差し替える。

ただし、chain 処理内の bailiff 給与計算 (`giveSingleHoldingBailiffSalary`) は廃止するため、`bailiffRevenueShare` の差し引きは行わない。

### 11.6 POP 保持分 (retained wealth)

POP 保持分は、v0.25 では以下のように再定義する。

```text
現行:
  retainedToPop = max(0, provinceProduction - provinceGrossTax)
  ここで provinceGrossTax = Σ(holdingRevenue)

v0.25:
  provinceCollected = Σ(collected)  // 各 Holding で実際に徴収された額の合計
  retainedToPop = max(0, provinceProduction - provinceCollected)
```

`provinceCollected` は `grossHoldingRevenue` 全額ではなく、代官が実際に徴収した額の合計。extraction モデルにより、POP は生産の過半を保持する。

既存の `retainedWealthGainByClass` による class 別 POP wealth 回復は維持する。

### 11.7 taxEfficiency との関係

既存 `taxEfficiency` (Polity の treasurer の stewardship/caution に基づく 0.8..1.2 倍率) は、treasury 加算時に適用される。

```text
bailiff collectionEfficiency:
  Holding 現地で徴収予定額をどれだけ実際に集められるか

polity taxEfficiency:
  Polity 側の会計・送金・上位上納処理の効率 (treasury 加算時に適用)
```

これら 2 つは意味が異なるため両方維持する。

### 11.8 overExtractionPenalty の置換

既存の Province レベル `overExtractionPenalty` は、v0.25 で Holding レベルの `totalBurdenRate` ベース処理に置換する。

```text
現行:
  extractionRatio = provinceGrossTax / provinceProduction
  if extractionRatio > overExtractionThreshold (0.95):
    Province 内全 POP に wealth penalty / unrest gain

v0.25:
  Holding ごとに burden を計算:
    { actualExtractionBurdenRate, collectionFrictionBurdenRate, totalBurdenRate }
      = computeBailiffBurdenComponents(localExtractionRate, collectionEfficiency, config.collectionFrictionFactor)

  POP wealth:
    retainedToPop による回復 (actual extraction の影響)
    + collectionFrictionBurdenRate による追加損耗

  POP unrest:
    totalBurdenRate が comfortableLocalExtractionRate を超えた分で上昇

旧 overExtractionPenalty は削除し、二重適用しない。
```

---

## 12. POP wealth / unrest 反映

### 12.1 徴税負担の計算

Holding ごとに、§8.4 の分解を適用する。

```ts
const { actualExtractionBurdenRate, collectionFrictionBurdenRate, totalBurdenRate } =
  computeBailiffBurdenComponents(
    localExtractionRate,
    collectionEfficiency,
    config.collectionFrictionFactor,
  )
```

### 12.2 POP wealth 更新

POP wealth は 2 系統から更新される。

```text
1. retainedToPop による回復:
   実際に手元に残った余剰 (grossHoldingRevenue - collected) による回復。
   actual extraction の影響はここで表現されている。

2. collectionFrictionBurdenRate による追加損耗:
   徴税摩擦・混乱・社会的損耗による追加のダメージ。
   actual extraction 分は retainedToPop で表現済みなので、ここでは friction のみ。
```

Holding 内の各 PopGroup に対して:

```ts
pop.wealth -=
  collectionFrictionBurdenRate *
  config.localExtractionWealthPenalty
```

### 12.3 POP unrest 更新

POP unrest には、実際の徴収負担と摩擦の両方を反映する。

Holding 内の各 PopGroup に対して:

```ts
const burdenOverComfort = Math.max(
  0,
  totalBurdenRate - config.comfortableLocalExtractionRate,
)

pop.unrest +=
  burdenOverComfort *
  config.localExtractionUnrestGain
```

### 12.4 clamp

実際の実装では既存の POP wealth / unrest 更新ロジックに合わせて clamp する。

```ts
pop.wealth = clamp(pop.wealth, 0, 100)
pop.unrest = clamp(pop.unrest, 0, 100)
```

---

## 13. POP -> Bailiff Attitude 更新

### 13.1 対象

Holding 内の全 PopGroup が、代官 Person に対して Attitude を持つ。

キー:

```ts
personAttitudeKey(bailiffPersonId)
```

対象:

```text
- 通常人物代官のみ
- placeholder 代官には Attitude 更新しない
```

placeholder に attitude を持たせても物語的意味が薄く、ログノイズになるため。

### 13.2 更新式

月次 LandRevenueSystem 処理時に、小さく更新する。

```ts
const { collectionFrictionBurdenRate, totalBurdenRate } =
  computeBailiffBurdenComponents(
    localExtractionRate,
    collectionEfficiency,
    config.collectionFrictionFactor,
  )

let affectionDelta = 0
let respectDelta = 0

const burdenOverComfort = Math.max(
  0,
  totalBurdenRate - config.comfortableLocalExtractionRate,
)

// 高負担 (extraction + friction) → affection 低下
affectionDelta -=
  burdenOverComfort *
  config.bailiffBurdenAffectionPenaltyFactor

// protect_residents → affection 上昇
if (policy === 'protect_residents') {
  affectionDelta += config.bailiffProtectResidentsAffectionBonus
}

// Task completed → respect 上昇
if (recentTaskStatus === 'completed') {
  respectDelta += config.bailiffTaskCompletedRespectGain
}
```

clamp:

```ts
// 負方向の振れ幅を大きくしている。
// 重税・収奪による不満は、軽い善政による好意よりも強く蓄積する。
affectionDelta = clamp(affectionDelta, -1.0, 0.5)
respectDelta = clamp(respectDelta, -0.5, 0.5)
```

### 13.3 解釈

```text
affection (感情的好悪):
  高い totalBurdenRate → affection 低下
  protect_residents → affection 上昇

respect (有能さへの評価):
  Task completed → respect 上昇
  Task none → respect 変化なし (v0.25 ではペナルティにしない)
```

これにより、以下のような人物評価が表現できる。

```text
有能で秩序ある代官:
  respect は高いが、affection は必ずしも高くない

住民保護型の代官:
  affection が高くなりやすい

強欲で有能な代官:
  respect は高いが、affection は低い (高 extraction + 低 friction)

無能な代官:
  collected は低く、friction は高く、respect も affection も下がる
```

### 13.4 Attitude decay との関係

既存 AttitudeDecaySystem の減衰速度を確認し、月次の POP -> Bailiff Attitude 更新が完全に無意味にならないように調整する。

```text
POP → Bailiff Attitude の月次更新量は、既存 AttitudeDecaySystem の減衰量と比較し、
数年単位で評価が形成される程度に調整する。
```

---

## 14. Recent Task status selector

### 14.1 追加 selector

```ts
export function getRecentBailiffRevenueTaskStatus(
  state: WorldState,
  assignmentId: HoldingOfficeAssignmentId,
): BailiffRevenueTaskStatus
```

### 14.2 仕様

対象:

```text
- taskKind === 'collect_holding_revenue'
- targetRef.kind === 'holding_office_assignment'
- targetRef.id === assignmentId
- 完了済み ActivityLog (kind === 'task_completed')
```

直近 4 週以内に完了 ActivityLog があれば `'completed'` を返す。なければ `'none'`。

```text
- ActivityLog を personActivityLogIndex.byPerson で検索
- 直近 4 週以内の task_completed + collect_holding_revenue を探す
- 見つかれば 'completed'
- 見つからなければ 'none'
```

LandRevenueSystem は直近完了済み Task を参照する。基本的には前月の業務実績が今月の徴税効率に反映される。

---

## 15. Tick 順序

### 15.1 新規 ScheduledSystem

以下を tick.ts に追加する。

```ts
{
  name: 'bailiffRevenueTaskSystem',
  intervalWeeks: 4,
  phaseOffsetWeeks: 0,
  run: runBailiffRevenueTaskSystem,
}
```

責務:

```text
- 前回の未完了 collect_holding_revenue Task を期限切れ処理する
- 今月分の collect_holding_revenue Task を生成する
- placeholder 代官は除外する
```

Task の実際の処理 (effort 消費 → 完了) は既存 TaskSystem に任せる。

### 15.2 順序

```text
... 既存システム ...
bailiffRevenueTaskSystem (4週ごと) ← 新規追加
... 既存システム ...
taskSystem (毎週)
... 既存システム ...
landRevenueSystem (4週ごと)
... 既存システム ...
```

LandRevenueSystem は「直近完了済み collect_holding_revenue Task」を参照する。これは基本的に前月の業務実績である。TaskSystem と LandRevenueSystem の既存順序を入れ替える必要はない。

---

## 16. UI 改修

### 16.1 Holding 詳細表示

Holding card / Holding 詳細に以下を表示する。

```text
Bailiff:
- 代官名
- placeholder / normal
- BailiffPolicy
- contractedRemittanceRate
- expectedFeeRate
- localExtractionRate
- collectionEfficiency
- bailiffFeeRate
- totalBurdenRate (実効負担)
- collectionFrictionBurdenRate (徴税摩擦)
- recent collect_holding_revenue Task status
- POP から代官への平均 affection / respect
```

### 16.2 表示名

日本語 i18n キー例:

```yaml
bailiff.policy.passive: "消極"
bailiff.policy.loyal_remittance: "送金重視"
bailiff.policy.profit_seeking: "私益重視"
bailiff.policy.protect_residents: "住民保護"

task.collect_holding_revenue: "徴税業務"

bailiff.localExtractionRate: "現地負担"
bailiff.collectionEfficiency: "徴税効率"
bailiff.feeRate: "代官取り分"
bailiff.totalBurdenRate: "実効負担"
bailiff.collectionFrictionBurdenRate: "徴税摩擦"
bailiff.recentTaskStatus: "直近徴税業務"
bailiff.recentTaskStatus.completed: "完了"
bailiff.recentTaskStatus.none: "未処理"
```

### 16.3 Person 詳細パネル

Person 詳細パネルにも、その人物が代官職を持っている場合、以下を表示する。

```text
- 任地名 (Province 名リンク)
- BailiffPolicy (色分け: passive=灰, loyal_remittance=青, profit_seeking=橙, protect_residents=緑)
```

これにより、人物一覧から代官の方針を一目で把握できる。

### 16.4 最小 UI

実装量を抑える場合、最小表示は以下でよい。

```text
- 代官名
- policy
- localExtractionRate
- collectionEfficiency
- recent Task status
```

---

## 17. IntegrityCheck

v0.25 で以下を追加する。

### 17.1 HoldingOfficeAssignment

```text
- active HoldingOfficeAssignment の holdingId が存在する
- active HoldingOfficeAssignment の holderPersonId が存在する
- active HoldingOfficeAssignment の holderPersonId は alive または placeholder
- active HoldingOfficeAssignment の appointingPolityId が active Polity を指す
- contractedRemittanceRate が 0..1
- expectedFeeRate が 0..1
- contractedRemittanceRate + expectedFeeRate <= config.maxLocalExtractionRate * 1.1
- 同一 Holding に active bailiff assignment が複数存在しない
- 同一通常人物が active bailiff assignment を複数持たない
```

最後の条件は、現行仕様では代官兼任不可であるため追加する。

### 17.2 Task

```text
- collect_holding_revenue Task の targetRef.kind は holding_office_assignment
- targetRef.id が存在する HoldingOfficeAssignment を指す
- target の HoldingOfficeAssignment は active
- placeholder 代官を holder とする collect_holding_revenue Task が存在しない
- 同一 assignment を target とする active collect_holding_revenue Task が複数存在しない
```

ただし、生成時に前月 Task を期限切れ締めするため、通常は重複しない。

### 17.3 Selector range

debug / integrity-check モードでは以下も検証してよい。

```text
- localExtractionRate が minLocalExtractionRate..maxLocalExtractionRate
- collectionEfficiency が minBailiffCollectionEfficiency..1.0
- bailiffFeeRate が 0..maxBailiffFeeRate
- totalBurdenRate が 0..maxLocalExtractionRate
```

---

## 18. 実装時確認事項

コーディングエージェントは、実装前に以下を確認すること。

```text
1. LandRevenueSystem が Holding revenue をどの変数で計算しているか
   → getHoldingProduction() で取得。grossHoldingRevenue として扱う
2. 現行 taxEfficiency がどこで掛かっているか
   → treasury 加算時に掛かる。collectionEfficiency とは役割が異なるため両方維持
3. LandContract chain の上納処理が terminal → root で実装されていること
   → chain 入力額を remittanceToTerminal に差し替える
4. POP wealth / retained wealth 更新がどこで行われているか
   → provinceCollected (= Σ collected) ベースに再定義する
5. 既存 overExtractionPenalty の削除
   → effectiveBurdenRate ベースの Holding レベル処理に置換
6. 既存 giveSingleHoldingBailiffSalary() の削除
   → bailiffFee に置換
7. 既存 officeCompensationSystem の bailiff 給与の削除
   → bailiffFee に一本化
8. Person.wealth 加算 mutation (addPersonWealth) が既にあるか
   → ある場合はそれを使う
9. ActivityLog から直近 Task status を取得する方法
   → personActivityLogIndex.byPerson で直近 4 週を検索
10. Tick 順序: bailiffRevenueTaskSystem を既存システム間に追加
11. AttitudeDecaySystem の decay 速度と POP→Bailiff 月次更新量のバランス
```

特に重要なのは以下。

```text
- collectionEfficiency と既存 taxEfficiency の意味が重複しないこと (→ 重複しない)
- totalBurdenRate と既存 overExtractionPenalty が二重適用されないこと (→ 旧処理は削除)
- placeholder 代官から大量の Task / ActivityLog / Event / Attitude が出ないこと
- 既存 bailiffRevenueShare / officeCompensation bailiff 給与が確実に廃止されること
```

---

## 19. 実装ステップ案

### Step 1: 型定義 + Config

```text
- BailiffPolicy 追加
- BailiffRevenueTaskStatus 追加
- HoldingOfficeAssignment に contractedRemittanceRate / expectedFeeRate 追加
- TaskKind に collect_holding_revenue 追加
- TaskTargetRef に holding_office_assignment 追加
- Config 追加 (§4)
- config.bailiffRevenueShare を廃止
```

### Step 2: worldgen / assignment 作成箇所修正

```text
- 新規 HoldingOfficeAssignment に default 値を入れる
- placeholder assignment にも同じ default を入れる
```

### Step 3: selector 追加 + 単体テスト

```text
- getBailiffStewardshipScore
- getHoldingAverageUnrest
- getBailiffPolicy / getBailiffPolicyScores
- getBailiffLocalExtractionRate
- getBailiffCollectionEfficiency
- getBailiffFeeRate
- computeBailiffBurdenComponents
- getRecentBailiffRevenueTaskStatus
```

### Step 4: bailiffRevenueTaskSystem 追加

```text
- 新規 ScheduledSystem として tick.ts に追加
- 4 週ごとに collect_holding_revenue Task を生成
- placeholder は除外
- 前回 active Task が残っていれば期限切れ処理 (failTaskAsExpired)
- ActivityLog 記録
```

### Step 5: LandRevenueSystem 改修

```text
- giveSingleHoldingBailiffSalary() を廃止
- Holding revenue から local extraction を計算
- collectionEfficiency を掛ける
- bailiffFee を Person.wealth に加算
- remittanceToTerminal を LandContract chain へ流す (入力額差し替え)
- provinceCollected ベースで retainedToPop を再計算
- overExtractionPenalty を削除し、burden 分解処理 (§8.4, §12) に置換
- POP wealth: retainedToPop で回復 + collectionFrictionBurdenRate で損耗
- POP unrest: totalBurdenRate が comfort 超過分で上昇
- POP -> Bailiff Attitude を更新
```

### Step 6: officeCompensationSystem 修正

```text
- bailiff 給与支払い処理を削除
```

### Step 7: UI

```text
- Holding card / detail に代官関連値を表示
```

### Step 8: IntegrityCheck / Debug log

```text
- 新規不変条件追加
- config.debug 時に [DEBUG:BAILIFF] ログ出力
```

---

## 20. テスト観点

### 20.1 Selector unit test

```text
- placeholder の getBailiffPolicy は passive
- placeholder の collectionEfficiency は placeholderBailiffCollectionEfficiency
- localExtractionRate は clamp される
- localExtractionRate のデフォルトは約 0.50
- collectionEfficiency は 1.0 を超えない
- bailiffFeeRate は maxBailiffFeeRate を超えない
- protect_residents は localExtractionRate / feeRate / collectionEfficiency を下げる
- profit_seeking は localExtractionRate / feeRate / collectionEfficiency を上げる
- getBailiffStewardshipScore が BailiffPolicy と collectionEfficiency で共通に使われる
- Task completed は collectionEfficiency に小ボーナス
- Task none は collectionEfficiency にペナルティなし (0.00)
```

### 20.2 Task test

```text
- 通常人物代官には 4 週ごとに collect_holding_revenue Task が生成される
- placeholder 代官には Task が生成されない
- 前月 Task が残っている場合期限切れ処理される
- 同一 assignment に active Task が重複しない
- Task 完了時に ActivityLog が残る
- Task priority は 1
```

### 20.3 Revenue test

```text
- 代官 fee が通常人物代官の wealth に加算される
- placeholder 代官には fee が加算されない (placeholder bailiff の wealth 不変)
- collectionEfficiency が高いほど terminal 側収入が増える
- localExtractionRate が高いほど POP unrest が上がる
- collectionFrictionBurdenRate が POP wealth を損耗させる
- retainedToPop が collected ベースで計算される (actual extraction は retainedToPop に反映)
- collectionEfficiency は 100% を超えない
- LandContract chain の上納不変条件が壊れない
- 既存 bailiffRevenueShare による二重取りがないこと
- officeCompensationSystem による bailiff 月給が廃止されていること
- retainedToPop が provinceCollected ベースで計算されること
```

### 20.4 Attitude test

```text
- 高 totalBurdenRate で POP -> Bailiff affection が下がる
- protect_residents で affection が上がる
- Task completed で respect が上がる
- Task none で respect が変化しない
- placeholder 代官には Attitude 更新しない
```

### 20.5 Long-run test

```text
- standard world 300 年 × 4 seed
- IntegrityCheck violation 0
- NaN / Infinity なし
- Person wealth が異常増殖しない
- POP unrest が全 Holding で即座に 100 に張り付かない
- terminal Polity treasury が負にならない
```

---

## 21. バランス調整メモ

### 21.1 経済影響の予測

デフォルト値での概算:

```text
localExtractionRate = 0.50 (base)
collectionEfficiency = 0.70 (average normal bailiff)
collected = grossHoldingRevenue × 0.50 × 0.70 = grossHoldingRevenue × 0.35
bailiffFee = collected × 0.10 = grossHoldingRevenue × 0.035
remittanceToTerminal = grossHoldingRevenue × 0.315
retainedToPop = grossHoldingRevenue × 0.65

actualExtractionBurdenRate = 0.50 × 0.70 = 0.35
collectionFrictionBurdenRate = 0.50 × 0.30 × 0.5 = 0.075
totalBurdenRate = 0.425

→ chain に流入するのは gross の約 32%
→ 現行 (100%) から大幅減。意図的。
→ POP は生産の約 65% を保持する
→ POP wealth penalty: friction のみ (0.075 × 4 = 0.30/月)
→ POP unrest: totalBurdenRate が comfort (0.35) を超えた分 (0.075 × 3 = 0.225/月)
```

### 21.2 代官方針別の挙動目標

```text
普通の代官:
  collectionEfficiency 0.60..0.80

有能な代官 + Task completed:
  collectionEfficiency 0.80..0.95

placeholder:
  collectionEfficiency 0.40 前後

profit_seeking:
  localExtractionRate ≈ 0.58, feeRate ≈ 0.15
  terminal income は増えることもあるが、POP affection / unrest が悪化

protect_residents:
  localExtractionRate ≈ 0.45, collectionEfficiency やや低下
  POP affection は改善するが、terminal income はやや減る

loyal_remittance:
  localExtractionRate ≈ 0.53, collectionEfficiency やや向上
  terminal income は安定するが、POP 負担はやや高い
```

### 21.3 comfortableLocalExtractionRate の設定

```text
comfortableLocalExtractionRate = 0.35

この値を超える effectiveBurdenRate に対して POP wealth/unrest ペナルティが発生する。
標準の effectiveBurdenRate ≈ 0.50 × 0.85 = 0.425 → burdenOverComfort ≈ 0.075

protect_residents は effectiveBurdenRate を comfort 近くまで下げられる。
profit_seeking は effectiveBurdenRate が高く、POP が苦しむ。
```

### 21.4 treasury 不足への対応

chain 流入減により treasury が不足する場合、以下で調整可能。

```text
- grossHoldingRevenue (POP 生産量) の引き上げ
- taxRateToGrantor の調整
- 支出システムの見直し (surplus distribution, salary 等)
```

v0.25 で必要な調整量は、実装後の 300 年 × 4 seed テストで判断する。

---

## 22. 将来拡張

v0.25 は、将来の「職務 Task 化」の先行実装である。

将来的には以下に拡張できる。

```text
Polity treasurer:
  manage_treasury Task

Polity chancellor:
  govern_polity_affairs Task

General:
  organize_muster Task

House steward:
  manage_house_estates Task

Bailiff:
  mediate_pop_grievances Task
  negotiate_tax_relief Task
  suppress_local_disorder Task
  supervise_holding_development Task
```

また、組織規模に応じて Task 発生量を増やすことで、

```text
大国:
  行政 Task が多く、人材不足だと効率低下

小国:
  少数の人物でも統治しやすい

有能な官僚層:
  Task 処理能力が高く、安定

人材不足:
  Task が滞留し、徴税・治安・外交・開発が停滞
```

という方向に発展できる。

将来的には「俸給官僚」と「徴税請負型代官」を分ける余地もある。v0.25 の bailiffFee は後者の原型であり、前者は officeCompensationSystem の発展版として再導入可能。

また、TaskSystem 全体に success/partial/failure の多段階 outcome 判定を導入することで、Task 結果の多様性を拡張できる。v0.25 では collect_holding_revenue を completed/none の 2 値に限定したが、将来は全 TaskKind で多段階判定を行える設計に向かう。

### 22.1 Collection leakage と非公式経済

v0.25 では、collectionEfficiency の低さによって生じる未徴収分・中抜き・隠匿・逃散・混乱は、具体的な受益者を持つ wealth transfer としては追跡しない。これは `collectionFrictionBurdenRate` として抽象化している。

将来的には、以下のような受益者を明示的に表現できる:

```text
- 中抜きする代官・下級役人 (汚職)
- 徴税請負人
- 地元有力者
- 犯罪組織
- 密輸業者
- 帳簿外経済に関与する商人
- 税逃れできる富裕 POP
- 不正な保護を売る武装集団
```

これらを導入する場合、`collectionFrictionBurdenRate` の一部を具体的な wealth transfer に分解し、corruptionNetwork / informalEconomy として追跡する設計に発展できる。

ただし、これらは v0.26 以降の課題とする。

---

# 付録 A: 主要疑似コード

## A.1 月次代官 Task 生成

```ts
function runBailiffRevenueTaskSystem(ctx: TickContext): TickContext {
  if (ctx.absoluteWeek % 4 !== 0) return ctx

  let state = ctx.state

  for (const assignment of Object.values(state.holdingOfficeAssignments)) {
    if (!assignment) continue
    if (!assignment.active) continue
    if (assignment.role !== 'bailiff') continue

    const person = state.persons[assignment.holderPersonId]
    if (!person) continue
    if (person.kind === 'placeholder') continue
    if (!person.alive) continue

    // 前回の未完了 Task を期限切れ処理
    const existing = findActiveCollectRevenueTask(state, assignment.id)

    if (existing) {
      state = failTaskAsExpired(state, existing.id, ctx.absoluteWeek)
    }

    // 今月分の Task を生成
    state = createTask(state, {
      kind: 'collect_holding_revenue',
      actorPersonId: person.id,
      targetRef: {
        kind: 'holding_office_assignment',
        id: assignment.id,
      },
      actionCost: 1,
      effortRequired: 1,
      priority: 1,
      deadlineWeek: ctx.absoluteWeek + 4,
    })
  }

  return { ...ctx, state }
}
```

## A.2 LandRevenueSystem 差し込み

```ts
function processHoldingRevenue(
  state: WorldState,
  config: SimulationConfig,
  holding: Holding,
  grossHoldingRevenue: number,
): { state: WorldState; collected: number } {
  const assignment = getActiveBailiffAssignmentForHolding(state, holding.id)

  if (!assignment) {
    return { state, collected: 0 }
  }

  const recentTaskStatus =
    getRecentBailiffRevenueTaskStatus(state, assignment.id)

  const localExtractionRate =
    getBailiffLocalExtractionRate(state, config, assignment.id)

  const collectionEfficiency =
    getBailiffCollectionEfficiency(
      state,
      config,
      assignment.id,
      recentTaskStatus,
    )

  const collected =
    grossHoldingRevenue *
    localExtractionRate *
    collectionEfficiency

  const bailiffFeeRate =
    getBailiffFeeRate(state, config, assignment.id)

  const bailiffFee =
    collected * bailiffFeeRate

  const remittanceToTerminal =
    collected - bailiffFee

  let next = state

  // 代官取り分を Person.wealth に加算 (通常人物のみ)
  const person = next.persons[assignment.holderPersonId]
  if (person && person.kind !== 'placeholder') {
    next = addPersonWealth(next, assignment.holderPersonId, bailiffFee)
  }

  // remittanceToTerminal を LandContract chain へ流す
  // (既存 chain 処理の入力額を差し替え)

  // POP 負担の分解
  const { collectionFrictionBurdenRate, totalBurdenRate } =
    computeBailiffBurdenComponents(
      localExtractionRate,
      collectionEfficiency,
      config.collectionFrictionFactor,
    )

  const policy = getBailiffPolicy(state, config, assignment.id)

  // POP wealth / unrest / Attitude 更新
  next = applyLocalBurdenToHoldingPops(
    next,
    config,
    holding.id,
    assignment.holderPersonId,
    collectionFrictionBurdenRate,
    totalBurdenRate,
    policy,
    recentTaskStatus,
  )

  return { state: next, collected }
}
```

---

以上。
