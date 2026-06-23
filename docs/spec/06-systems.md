# 6. 各システムの仕様

### 6.1 ControlSystem（4週ごと）

Polity ごとに首都から BFS、House ごとに本拠地から BFS を行い、各 Province の支配力を更新する。

**支配力上限（二段階 clamp）**:

```ts
// 距離ベースの上限
baseMaxControl = clamp(100 - distance * controlMaxDistancePenalty, controlMaxMinimum, 100)
// 能力補正後の上限（能力最低床を別途設定）
maxControl = clamp(baseMaxControl + maxControlBonus, controlAbilityMinimumFloor, 100)
// 首都 / 本拠地は常に上限 100
```

`maxControlBonus` は Polity administrator（polityControl）の admin stat から算出される（§10 参照）。

**到達可能な Province**:

```ts
if (control < maxControl) control = Math.min(control + effectiveGrowth, maxControl)
if (control > maxControl) control = Math.max(control - controlDecayPerMonth, maxControl)
```

`effectiveGrowth = controlGrowthPerMonth * growthModifier`（Polity administrator の admin stat による）。

**到達不能な Province**（飛び地など）:

```ts
control = Math.max(0, control - disconnectedControlDecayPerMonth)
```

BFS 通行条件:
- polityControl: 首都 (`capitalProvinceId`) から全 Province を通行可

polityControl は Province ではなく **Holding 単位**で更新する。BFS は Province graph 上を走査し、到達した Province 内の各 Holding の `polityControl` を距離に応じて更新する。Province レベルの polityControl は selector (`getProvincePolityControlFromHoldings`) で Holding の weight 加重平均から算出する。

### 6.2 PopSystem（4週ごと）

POP の自然変化を処理する。Province の carrying capacity に基づいた人口圧制御、雇用 overflow（employed POP の capacity 超過 → 失業 POP 生成）、wealth/unrest の自然変化を担当する。

**6.2.1 人口成長**

成長抑制式は `1 - pressure²`（二次関数）を使用する。未就業（`employed: false`）POP は成長が鈍化する。

```ts
const pressure = getProvincePopulationPressure(state, config, province.id)
const growthFactor = clamp(1 - pressure * pressure, -0.5, 1.0)
const baseGrowth = config.baseMonthlyGrowthByClass[pop.class]
const wealthFactor = clamp(0.5 + pop.wealth / 100, 0.5, 1.5)
const unrestFactor = clamp(1 - pop.unrest / 150, 0.3, 1)
const employmentGrowthModifier =
  pop.employed ? 1 : config.unemployedGrowthModifierByClass[pop.class]
const delta = pop.size * baseGrowth * growthFactor * wealthFactor * unrestFactor * employmentGrowthModifier
```

**6.2.1b 人口増加時の overflow**

人口増加分はまず元 POP に追加する。ただし就業（`employed: true`）POP で class capacity を超える場合、超過分は同 Holding / 同 class の未就業（`employed: false`）POP に移す。未就業 POP の増加はそのまま未就業 POP に留まる。

```ts
if (pop.employed) {
  const capacity = getHoldingClassCapacity(state, config, pop.holdingId, pop.class)
  const current = getHoldingEmployedPopSize(state, pop.holdingId, pop.class)
  const room = Math.max(0, capacity - current)
  const toOriginal = Math.min(delta, room)
  const overflow = delta - toOriginal
  pop.size += toOriginal
  if (overflow > 0) {
    addToOrCreatePopGroupMut(state, { holdingId: pop.holdingId, class: pop.class, employed: false, size: overflow, inheritFrom: pop })
  }
}
```

実装注意: PopSystem は mutable draft パターンを使用し、ループ開始前に POP リストの snapshot を取る。overflow で生成された新 POP が同 tick 内で二重処理されないようにする。

**6.2.2 population pressure の影響**

pressure が閾値を超えると土地不足・過密に相当する影響が発生する：

```ts
if (pressure > config.populationPressureThreshold) {
  const excess = pressure - config.populationPressureThreshold
  pop.wealth -= excess * config.populationPressureWealthPenalty
  pop.unrest += excess * config.populationPressureUnrestGain
}
```

**6.2.3 poverty / prosperity 効果**

```ts
if (pop.wealth < config.povertyWealthThreshold) {
  pop.unrest += (config.povertyWealthThreshold - pop.wealth) * config.povertyUnrestGain
}
if (pop.wealth > config.prosperityWealthThreshold) {
  pop.unrest -= (pop.wealth - config.prosperityWealthThreshold) * config.prosperityUnrestReduction
}
```

**6.2.4 unrest 自然減衰**

```ts
pop.unrest *= 1 - config.unrestNaturalDecayRate
```

**6.2.4b 未就業 POP ペナルティ**

```ts
if (!pop.employed) {
  pop.wealth -= config.unemployedWealthDecayByClass[pop.class]
  pop.unrest += config.unemployedUnrestGainByClass[pop.class]
}
```

**6.2.5 clamp**

就業（`employed: true`）POP は `minPopSizeByClass` で下限保証。未就業（`employed: false`）POP は 0 まで減少可能。

```ts
const minSize = pop.employed ? config.minPopSizeByClass[pop.class] : 0
pop.size = Math.max(minSize, newSize)
pop.wealth = clamp(pop.wealth, 0, 100)
pop.unrest = clamp(pop.unrest, 0, 100)
```

**normalizePopSizes**（IntegrityCheck 直前）: 就業（`employed: true`）POP は `minPopSizeByClass` で下限保証。未就業（`employed: false`）POP は size が `popSizeEpsilon` 以下で削除する。

### 6.3 EmploymentRebalanceSystem（4週ごと）

PopSystem 直後、LandRevenueSystem 直前に実行。Holding × PopClass ごとに class capacity 超過の強制失業化と、未就業 POP の再就業を処理する。v0.52 で occupation ベースから employed boolean ベースに移行。

**処理順**:
1. 各 Holding / class で就業 POP の合計が class capacity を超過していれば、超過分を未就業（`employed: false`）に移す
2. 未就業 POP を確認。class capacity に空きがあれば再就業（`employed: true`）

```ts
for (const holdingId of Object.keys(ws.holdings).sort() as HoldingId[]) {
  for (const popClass of POP_CLASSES) {
    // Phase 1: 強制失業化
    const capacity = getHoldingClassCapacity(ws, config, holding.id, popClass)
    const currentEmployed = getHoldingEmployedPopSize(ws, holding.id, popClass)
    if (currentEmployed > capacity) {
      const excess = currentEmployed - capacity
      const employedPops = getHoldingPopsByClassAndEmployment(ws, holding.id, popClass, true)
      movePopEmploymentMut(ws, { sourcePopId, targetEmployed: false, size: excess })
    }

    // Phase 2: 再就業
    const unemployedPops = getHoldingPopsByClassAndEmployment(ws, holding.id, popClass, false)
    const room = Math.max(0, capacity - currentAfterForced)
    if (room > 0) {
      for (const uPop of unemployedPops) {
        movePopEmploymentMut(ws, { sourcePopId: uPop.id, targetEmployed: true, size: moveAmount })
      }
    }
  }
}
```

再就業時の wealth / unrest / attitudes は移動元と移動先の人口加重平均で統合される。

> **v0.56 拡張**: Holding 単位の Phase1/Phase2 コアを `normalizePopEmploymentMut(ws, config, holdingId)` に抽出し、本体はこの helper を全 holding に適用する薄い形になった（mobility 後の `PopEmploymentNormalizeSystem` でも再利用）。
>
> **v0.57 で上書き（重要）**: 上記の §6.3 Phase1/Phase2 擬似コード（class capacity 単位）と、v0.56 の「再就業 Phase2 を demand-aware 化（同一 stratum 内で `shortageByType` が大きい PopType を跨いで優先充足）」は、**v0.57 で stratum 単位から PopType 単位ハード枠へ再設計され置換された**（§6.x.v0.57）。現行 `normalizePopEmploymentMut` は PopType ごとに独立処理し、Phase1 で各 PopType の容量超過を強制失業、Phase2 で空き枠を**同一 PopType の未就業のみ**で補充する（処理順は 非 maxRatioTo → maxRatioTo）。stratum を跨ぐ shortage 優先の再就業は行わない。helper 抽出・全 holding 再適用・mobility 後の再利用という構造は不変。

### 6.3b POP 転職・移住システム（v0.56、4週ごと）

EmploymentRebalanceSystem の後・ResourceEconomySystem の前に、POP が recipe 労働需要・生活条件に応じて **転職**（同一 holding 内の職種/階層変更）と **移住**（同一 StateRegion 内の holding 間移動）を少しずつ行う。tick 順は `EmploymentRebalance → PopJobChange → PopMigration → PopEmploymentNormalize → ResourceEconomy`。RNG は使わず、全反復を sorted key 順に固定（dump-world bit-identical 維持）。実装の確定設計の経緯は `docs/drafts/spec-v056-update.md`（r2）参照。

- **共通 mutation `movePopSizeToKeyMut(ws, sourcePopId, target, amount, options?)`**: source POP から `amount` を別の merge key（`{holdingId, class, popType, employed}`）へ移す。`addToOrCreatePopGroupMut` を再利用し、既存 target があれば人口加重平均で merge、無ければ新規作成。`target.class === getPopStratum(target.popType)` を検査。source は `minSourceSize`（default = `popSizeEpsilon`）を割らない。promotion cost 等の incoming wealth/unrest は **合成 `inheritFrom` で create/merge 両パスに一貫反映**（helper シグネチャ不変）。**人口保存**: 移動後の残りが epsilon 以下の sliver になる場合は source を丸ごと移して除去する（minSourceSize 分の population leak を防ぐ）。**v0.58 money 保存**: `money` は extensive のため `inheritFrom.money = source.money × (actualAmount/source.size)`（比例移送）で渡し source 残量からも同額減算する（`{ ...source }` の全額コピーを必ず上書き。さもないと merge で money が複製される）。merge は money を **sum**。同じ規約を `movePopEmploymentMut`（雇用状態変更）にも適用。`popMobilityMinMoveAmount` 未満の移動可否判定は呼び出し側 system が担う。

- **read-model selector**: `computeHoldingPopTypeDemand`（holding 単位の `idealShareByType`〔施設駆動の容量比を **holding 全体正規化**〕/ `desiredEmployedByType`〔= 施設駆動の PopType 雇用容量〕/ `currentEmployedByType` / `shortage` / `surplus`）と `computePopTypeMoneyQuantiles`（StateRegion × **PopType**・size 加重の **per-capita money** p25/median/p75。promotion/demotion の相対 gate 用。v0.58 で wealth から移行）。
  - **v0.57.1 移動単位の Class 統一**: POP の「移動」（転職・移住・昇格・降格）の判断は **PopType（Class）単位**で行い、stratum は集計・社会構造の記述専用とする。これに伴い (1) wealth 相対 gate の比較母集団を stratum プールから **同じ職能** へ、(2) `idealShare`/`currentShare` の正規化を stratum 内から **holding 全体** へ、(3) `classifyMobilityKind` の判定を stratum 順序から **エッジ所属（lateral/promotion/demotion pair）** へ変更した。移動の速度・コストの config（`popMigrationMonthlyRateByStratum` / `popPromotionWealthCostByTargetStratum`）は「どこへ動くか」ではなく tuning 粒度なので stratum 据え置き。

- **PopJobChangeSystem**: holding ごとに **候補優先度ループ**で処理。cap は **holding 人口比率**（`totalPop × popJobChangeMaxFractionPerHoldingPerMonth`、`…HardCap` で頭打ち）。各 source（surplus を持つ employed / unemployed）× 許可遷移 target（`popMobilityDefinitions.ts` の lateral/promotion/demotion 表、kind は **エッジ所属から導出**〔v0.57.1〕）を評価し、優先度（unemployed 優先→shortage 大→低 wealth→ID 昇順）で 1 件選び、demand を再評価しながら cap を消化する。
  - **capacity gate は「employed 人数を増やす move のみ」**（`increasesEmployedHeadcount = target.employed && (!source.employed || target.class !== source.class)`）。同一 stratum の employed→employed lateral は雇用総量不変なので gate を掛けない（capacity 一杯の holding でも構成是正が進む）。
  - **promotion/demotion の wealth gate は相対分位（v0.57.1 から同じ職能内）**: promotion は `source.wealth ≥ p75 かつ > median + popPromotionEpsilon`、demotion は `unemployed または (≤ p25 かつ < median − popDemotionEpsilon)`。分位の母集団は **その PopType の StateRegion 内 POP**（旧 stratum プール）。分布が潰れている（同職能の全員が同 wealth）ときは epsilon ガードで不発（失業者のみ demotion 候補）。promotion cost は移動 cohort の incoming wealth にのみ反映（source pool は下げない）。demotion 後の `employed` は §A5 表（employed source + 雇用余地 → employed、それ以外 → unemployed）。

- **PopMigrationSystem**: StateRegion ごとに、月初固定の holding 単位 cache（demand / size 加重 wealth・unrest / `holdingJobCongestion` = totalPop / Σcapacity / terminalPolity / capacity ceiling〔構造由来・月内不変〕）を構築。migration pressure = `(unemployed?40:0) + max(0,50−wealth)×0.6 + unrest×0.3 + max(0,congestion−1)×30`。pressure ≥ threshold の source について、同一 region 内の各 target holding の opportunity score = `vacancy×45 + popTypeDemandScore×25 + targetWealth×15 + lowUnrest×15 − crossPolityPenalty` を計算（**`popTypeDemandScore` は vacancy ではなく理想構成からのズレ** `max(0, idealShare − currentShare)/idealShare`〔idealShare/currentShare とも **holding 全体正規化**、v0.57.1〕で B2 の二重計上を回避）。最良 target（score 降順→holdingId 昇順）が source-stay score を `popMigrationScoreGapThreshold` 超で上回れば、人口比 outflow/inflow cap 内で移住（target は原則 `employed: true`）。capacity は live（cache 済 ceiling − live employed）で読み、超過を防ぐ。terminal polity 跨ぎは禁止せず score penalty。

- **PopEmploymentNormalizeSystem**: mobility 後に全 holding へ `normalizePopEmploymentMut` を再適用（capacity 整合の保険）。

- **v0.59 追補（POP 移動 cap の per-source 再設計 ＋ 移動/雇用分離 ＋ 実効容量判断）**: 上記 v0.56〜v0.57.1 の「holding 共有 cap・移動先で直接 employed・生容量で判断」を以下へ改める。設計原理は「集団は一気に変化しないが、変化量は**変化元のサイズ**で決まり、**変化先のサイズは問わない**」。
  - **per-source cap**: holding 共有予算（`popJobChangeMaxFractionPerHoldingPerMonth` / `…HardCap` / `popMigrationMax*Fraction*` / `…HardCap`、計 6 config）を**全廃**。各 source POP は自分の `size × kind/stratum 別レート`（`popJobChangeMonthlyRateByKind` / `popMigrationMonthlyRateByStratum`）まで /月 移動する。holding 総流量はその総和として創発。これにより小 holding（総 size<10）でも移動が**凍結しない**（旧: holding 予算 < `popMobilityMinMoveAmount` で全凍結していた）。PopJobChange は holding ごとに各 source POP を id 昇順に 1 回ずつ処理（旧 greedy while ループを廃止、demand は holding 月初 1 回算出）。
  - **移動と雇用の分離**: 転職（lateral/promotion/demotion）・移住とも、移動先では **`employed: false`（失業）で着地**する。雇用は後段 `PopEmploymentNormalizeSystem`（rebalance）が PopType 別職枠＋同数上限の範囲で確定する。「職があると聞いて移住したが各地から殺到し結局失業」が成立する。
  - **昇格だけ移動先の実効職枠を gate（非対称）**: 降格・移住は**移動先非依存**（変化元サイズで決まる）。昇格のみ「社会的余地」として移動先の実効昇格枠（`getHoldingPopTypeRemainingCapacity` − 同月内 `consumedPromotionByType`）> 0 を必須にする。移住先選定は opportunity score の実効 vacancy（行く理由）を見るが、移動**量**は移動先残枠で縛らない（オーバーシュート許容＝開拓ブーム/反動）。
  - **判断系は maxRatio 後の実効容量を見る**: 熟練職（自作農≤小作農 / 親方≤職人）の同数上限で「下層不足で埋まらない枠」を `shortage` / 空き枠 / 移住 vacancy に計上しないよう、共有 helper `clampCapacityByMaxRatio`（生容量を `refEmployed × ratio` で絞る・判断系と rebalance が同一式を共有）と `getHoldingPopTypeEffectiveCapacity` を追加し、`shortageByType`/`surplusByType`・`getHoldingPopTypeRemainingCapacity`・移住 cache の vacancy 用 `capacityByType` をこれに差し替えた。`idealShareByType`/`desiredEmployedByType` は構造的推定値なので**生容量のまま**。移住の `holdingJobCongestion`（物理的混雑）も**生容量を分母**にする（実効容量で割ると下層不足 holding が過大な移住圧になるため）。`employmentRebalanceSystem` 本体（生容量＋動的 `refEmployed` ループ）は挙動不変だが clamp 式は共有 helper に集約した。
  - 数値（各レート・`popMobilityMinMoveAmount`・maxRatio ratio）は default 据え置き（balance-defer §4）。観察項目: per-source レートの妥当性・移住オーバーシュートの振動・失業上位（職なし貴族）の量。150年×4seed integrity green・determinism 維持（移動挙動が変わるため dump-world は本追補適用前と非互換＝期待挙動）。

- **read-model `WorldState.monthlyPopMobility`**（optional・latest のみ毎月上書き）: `jobChangedTotal` / `migratedTotal` / `byState`（state 別 jobChanged/migratedIn/Out）/ `topMovements`（PopJobChange が初期化・PopMigration が append して merge）。各 entry は `kind`（'job_change' | 'migration'）/ `amount` / source・target holding / from・to popType / from・to employed を持つ。**UI 表示（v0.56 UI 改修）**:
  - **Holding detail** = 移住のみ。topMovements の migration entry をこの holding に出入りする相手 holding 別に集計し「流入元 / 流出先」を表示（相手 holding はクリックで遷移）。
  - **POP detail** = 階層移動・転職。topMovements の job_change entry のうちこの POP を target/source とするものを相手職種別に集計し、`classifyMobilityKind(from, to)` で昇格/降格/転職に分類して「転入 / 転出」を表示。
  - **Province detail** には出さない（v0.56 UI 改修で state 集計セクションを撤去。情報は Holding/POP に集約）。
  - **bound**: 旧 global top-N（20）は per-entity drill-down で大半の小移動を捨てるため（実測 small で月 ~411 件 → 95% 喪失）、`popMobilityTopMovementLimit` を **store-all 相当の高い safety cap（4000）** に引き上げ、先月分を per-Holding / per-POP で完全に再構成できるようにした。snapshot は毎月上書きで累積しないため state 肥大化はしない。
  - SimEvent / Chronicle には出さない（月次大量発生のため）。

- **read-model `WorldState.monthlyPopChange`（v0.59 人口変動）**（optional・latest のみ）: 先月（直近 4 週）の純人口変動を **自然増減 (`natural`) と移住 (`migrationIn`/`migrationOut`) に分解**して holding 単位（`byHolding`）と POP グループ単位（`byPopGroupKey`、key = `${holdingId}|${class}|${popType}|${employed}`）で保持する。
  - **lifecycle**: `PopSystem`（月次サイクルで最初の人口システム）が月初に **リセット生成**し、自身の自然増減 delta（`finalSize − size`）を `natural` に累積。`CrisisSystem`（週次）が飢饉・疫病・戦災の死を `reduceHoldingPopSizeProportionalMut` の `onReduce` callback 経由で `natural`（負）に累積。`PopMigrationSystem`（同月）が holding 間移動を流出元 `migrationOut` / 流入先 `migrationIn` に累積（`movePopSizeToKeyMut` の sliver bump で実移動量が要求 `amount` を eps だけ超えうるため、source の size 差分＝実移動量で累積し holding 合計の等式を厳密に保つ）。すべて in-place・RNG 不使用で dump-world bit-identical を維持。窓は `monthlyPopMobility` と同じ 4 週に揃う。
  - **整合**: holding 合計の純変動 = `natural + migrationIn − migrationOut`（転職・雇用調整は holding 内で純ゼロ、epsilon 除去は <0.01 のノイズ）。POP グループ単位では転職・雇用変動でも size が動くため `natural + migration` は size の素の差分とは一致しない（転職分は `monthlyPopMobility` の階層移動セクションに集約）。
  - **UI 表示（v0.59）**: Holding detail / POP detail に「人口変動 (先月)」セクション。`getHoldingMonthlyPopChange` / `getPopGroupMonthlyPopChange` で取得し、純変動（符号付き `formatPopDelta`）＋自然増減＋移住（流入 / 流出）を表示。POP detail は「自然増減 + 移住の小計」である旨を注記。

- **IntegrityCheck**: 既存の POP 不変条件（stratum 整合・merge key 一意・byHolding 整合・wealth/unrest clamp）で十分。capacity 整合は normalize が運用上保証し hard invariant にはしない（成長後の一時超過で誤検知を避ける）。

> **balance-defer（観測済み・調整保留）**: 実測では POP wealth が経済劣化で ~0 に潰れるため、相対 gate 下でも **promotion は不発・demotion / migration のみ発火**（下方移動偏重）。閾値の妥当性検証は経済 wealth 崩壊の是正待ち。また inflow cap = `pop × fraction` のため空 holding は移民を受け入れられない（将来「空 holding の植民」が必要なら別途設計）。fraction cap 0.001 は中央 holding 人口 ~30 で月 ~0.03 とやや遅い。これらは機能完成後のバランス調整対象。

#### 6.x.v0.57 雇用の職能細分化（PopType ハード枠 + 職能効果）

v0.55/56 では雇用枠は PopStratum 単位で、PopType は生産の soft modifier に過ぎなかった。v0.57 で **雇用を施設駆動の PopType 単位ハード枠**に再設計し、各職能に意味（生産力差・スループット・治安・維持）を与える。

- **施設駆動の職能構成（ハード枠）**: 雇用容量は施設 kind が PopType 比率で決める。`RealEstateEmploymentSlot` / `ImprovementEmploymentSlot` を **PopType キー**化（`{popType, capacityPerLevel, maxRatioTo?}`）。
  - 不動産: 工房=職人:親方:書記 6:3:1 / 農園=小作農:自作農 7:3 / 鉱山・山林=労働者:書記:家士 8:1:1。
  - 改善 establishment（外生定員・生産容量とは別プール）: 領主館=貴族:家士:兵士:労働者 1:2:3:4（total 20/lv）/ 市庁舎=都市貴族:官僚:兵士:労働者 1:2:3:4 / 倉庫=労働者:商人:書記 8:1:1。
  - **容量セレクタ**: `computeHoldingClassCapacity`（stratum 集計＝`getPopStratum(slot.popType)`、既存消費者互換）に加え `computeHoldingPopTypeCapacity` / `computeHoldingAllPopTypeCapacities`（1 パス）を新設。terrain/feature/overuse の乗数は不変（v0.59: landQuality 乗数は廃止）。
- **同数上限（`maxRatioTo`、`POP_TYPE_MAX_RATIO`）**: 熟練職（親方→職人 / 自作農→小作農、ratio 1）は主要職能の**実雇用数**までしか雇えない。rebalance が主要職能を先に確定 → 熟練を実数 × ratio で動的にキャップ。**v0.59 追補**: この絞り込みは rebalance だけでなく**判断系（shortage / 空き枠 / 移住 vacancy）にも実効容量として一貫適用**する（`getHoldingPopType(All)EffectiveCapacit*`）。下層が薄く埋まらない熟練職枠を需要として誤計上しない（§6.3b v0.59 追補）。
- **EmploymentRebalanceSystem**: stratum 単位から **PopType 単位**へ。各 PopType で容量超過を強制失業 → 空き枠を同 PopType の未就業で補充（処理順は非 maxRatioTo → maxRatioTo の順で参照先を先に確定）。`computeHoldingPopTypeDemand` の `desired` は施設由来の PopType 容量そのもの（recipe 集計は廃止）。
- **PopJobChange / PopMigration**: capacity gate を PopType 別残枠（`getHoldingPopTypeRemainingCapacity` / cache の `capacityByType`）に変更。v0.59 追補でこれらは**実効容量**（maxRatio 後）を返し、昇格 gate と移住 vacancy に効く（降格・移住量自体は移動先非依存）。
- **生産効果**: 親方/自作農 `directOutputPower 1.5`（一次の 1.5 倍生産）、書記 `throughputBonus 0.5`（同原材料で産出 +最大 50%）。詳細は §6.3c.2。
- **非生産効果**:
  - **治安（兵士・家士）**: holding 単位の `securityCoverage = (employed soldiers+ministeriales)/total pop` に応じて月次 unrest を低減（`securityUnrestReductionAtFull=2.0` × clamp(coverage/`securityFullCoverageRatio=0.1`)）。`popSystem` で適用。
  - **維持（労働者）**: 改善の condition 減衰を holding の労働者充足率 `min(employed laborers / laborer capacity,1)` で緩和（`facilityMaintenanceDecayReductionMax=0.5`）。`facilityMaintenanceSystem` で適用。
  - **管理（貴族・官僚・都市貴族・商人）= 将来送り**: 「establishment 充足率が capacity/品質ボーナスをゲート」する案は、改善の唯一の効果が establishment 雇用枠そのものであり**循環**になるため v0.57 では実装しない。これらの職能は establishment を占めて失業を吸収するに留め、能動効果は新機構（例: 統治効力/生産容量への寄与）導入時に設計する。
- **検証**: 150年×4seed（tiny）で integrity green。治安効果で unrest 平均が低下（実測 ~28-37 → ~8-18）。POP wealth の経年崩壊は v0.55 から続く既知の経済問題で v0.57 では悪化させていない（balance-defer）。
- **worldgen 初期配置も PopType 駆動（v0.57.1）**: worldgen の POP seed を施設駆動の PopType ハード枠に比例させる。旧実装は stratum 容量を全 holding 共通の固定職能分布（`WORLDGEN_POP_TYPE_DISTRIBUTION`: peasants 55% / artisans 15% 等）で分割していたため、施設に枠の無い PopType（例: 工房しか無い都市の小作農、領主館しか無い荘園の都市貴族）を seed して**初期から大量失業**が出ていた。現実装は `computeHoldingAllPopTypeCapacities` で holding ごとの PopType 別容量を求め、`size = cap × fillRatio`（`fillRatio` は holding 単位 1 回抽選の 0.70–0.95）で seed する。cap=0 の PopType は seed しない（枠の無い職能を播かない）。`fillRatio<1` なので `size ≤ cap`＝`employed:true` が常に成立し、同数上限（親方≤職人 / 自作農≤小作農）も施設比が ratio 1 未満のため自動的に満たされる。雇用枠を持つ施設が無い holding のみ、ghost holding 回避のため最低限の小作農（`minPopSizeByClass.lower`・unemployed）を 1 つ seed する。wealth/unrest は従来どおり stratum 単位で抽選し同 stratum の全 PopType に適用（RNG draw 順不変）。実測（20年・seed1）で middle empRate 73.7%→94.7% / upper 63.4%→90.1% に改善。150年×4seed integrity green。
  - **残る balance-defer**: lower の失業（実測 ~11%）は seed 不一致ではなく人口成長・churn・mobility 遅延に由来する通常事象で、バランスフェーズの対象。POP wealth の経年崩壊も v0.55 から続く既知問題（v0.57 で悪化させていない）。

### 6.3c ResourceEconomySystem（4週ごと、v0.54 / v0.55 で商品経済へ拡張）

EmploymentRebalanceSystem の後・LandRevenueSystem の直前に実行する月次の資源経済。旧来の「POP / development が直接 money revenue を生む」モデル（getPopProduction）を廃止し、**資源生産 → StateRegion 市場で売却 → money revenue** に置換する。RNG を消費せず、全 Record 反復を sorted key 順に固定する（dump-world bit-identical 維持。`Object.keys(state.states).sort()` 等）。出力は `marketResourcePrices` / `monthlyHoldingResourceRevenue` の 2 read-model slice と POP wealth/unrest への反映のみで、treasury / owner / chain は変更しない（分配は LandRevenueSystem の責務）。

> **v0.55 拡張**: v0.54 の 3 資源（food/raw_materials/processed_goods）を **21 ResourceKind の商品経済**へ拡張した。market-clearing の基本骨格（imbalance ベース価格・全量 revenue/cost・§6.3c.1）は不変だが、(1) 資源を 21 種化、(2) POP 需要を NeedCategory 化、(3) recipe 投入を InputCategory 化、(4) 2 段清算を **DAG 依存順 1-pass** へ一般化、(5) PopType 別の理想労働構成（laborTypeFulfillmentModifier）、(6) recipeSlots 自動入れ替え（§6.3d）、(7) 建設 Project の建築資材需要を市場へ注入、を追加した。詳細は §6.3c.2、ドラフト spec `docs/drafts/spec-v055-update.md`（§4–§25、正本）参照。

- **資源（v0.55）**: `ResourceKind` 21 種（§3.2c）。食料・飲料 6 / 原料 8 / 加工品 7。dual-use（grain は staple_food かつ beer の input、fabric は basic_clothing かつ clothes の input、等）を扱う。
- **生産（v0.55 / v0.57 で改訂）**: RealEstateAsset は `recipeSlots`（20 slot = 100%、slot は労働配分比率で生産量乗数ではない）で 23 種 recipe（§3.2c）を採用する。holding の employed POP を **各 PopStratum** ごとに per-asset の capacity×stratum weight 比で按分（`computeAllocatedLaborByAsset`、RealEstateAsset は複数 stratum を同時雇用、§13.4。upper は雇用しない）。`recipeLabor = allocatedLabor × (slot/totalSlots)`。**v0.57**: `basePotential = recipeLabor × effectiveLaborMult × baseOutputPerLabor × recipeScaleMultiplier × productionFacilityModifier × polityControlModifier`、**産出 = basePotential × throughputMult**（熟練 directOutputPower と書記 throughput、§6.3c.2）。v0.55 の `laborTypeFulfillmentModifier` は撤去。**asset.level は雇用枠（`capacityPerLevel × level` = 施設サイズ）にのみ効き、労働あたり生産性には掛けない**。development modifier は production path から撤去。
- **地形と生産（v0.55 の効き方 ＋ v0.59 地形特性）**: terrain / feature は **asset の雇用容量（capacity）の乗数**として生産に効く（`realEstateTerrainCapacityMultiplier` / `realEstateFeatureCapacityMultiplier` を assetTerm に乗算、§4.1 / §9）。容量が増えれば雇用できる POP が増え総産出が増える。**v0.59: `landQuality` は廃止**（容量乗数から除去、実質 1.0・平均不変。holding 単位の変動表現は「広闊な地形」trait の不動産スロット数に移譲）。
  - **v0.59 地形特性 (TerrainTrait) による産出ブースト**: terrain/feature に相関した名前付き特性を Province 単位で持ち（`Province.traits`、§3）、`output` 効果を持つ特性は該当 raw 資源の **per-output 産出倍率**として効く。`resourceProductionSelectors` の output 確定点（`potentialOutputs[resource] += potential × amount × traitMult`）で乗算し、`getProvinceOutputTraitMultiplier(state, config, holdingId, resource)` が holding→province の traits から倍率を返す（複数 trait は乗算・該当無し 1.0）。**input（`basePotential` 基準）には掛けない**ため、同じ労働・入力で産出だけ増える純生産性ボーナスになる。これが v0.55 で「未実装の将来枠」とされた地形→per-labor 産出チャネルの実装（recipe 単位ではなく Province trait 単位で実現）。
  - **対象は input を持たない raw/採掘産出に限る**（grain/fish/iron_ore/gems/stone/timber/fur/fruit 等）。加工品に output trait を掛けると input 据え置きのまま output が増え「無償財」になるため、config 定義側で raw 資源のみを対象にする。
  - **広闊な地形 (open_terrain) trait**: `slot` 効果で holding の不動産スロット上限を +N する（`computeSlotCapacity(config, holdingKind, province.traits)` に集約。worldgen 初期建設・develop Project・overuse 判定で共通利用）。雇用ばらつきを「1 施設内の雇用者数」ではなく「施設の数」で表現する。
  - 初期 4+1 特性（balance-defer の default、§9）: fertile_land（plains/hills→grain×1.3,fruit×1.2）/ rich_fishery（水辺 feature→fish×1.4）/ rich_lode（mountains/hills→iron_ore/gems/stone×1.3）/ dense_forest（forest/hills→timber×1.4,fur×1.2）/ open_terrain（plains/wetlands→slot+1）。付与は worldgen で地形/feature 相関・複数可・確率付与（決定的、`assignTerrainTraits`）。密度は `terrainTraitDensityMultiplier` で一括調整可。
  - なお RealEstateKind 単位の `allowedTerrains`（§3.2c）は asset の建設可否ゲートで産出量には効かない。fishing_hut は farm recipe の一つで水辺 feature を要求しないため内陸 farm でも採用でき魚を産する（漁場の高効率化は rich_fishery trait で表現）。
- **市場（v0.55 DAG 化）**: 市場単位は StateRegion（`marketKey = stateRegionId`）。在庫なし。**Victoria 3 型の抽象市場清算（§6.3c.1）**は不変。v0.55 では清算順を「raw を先・processed を後」の固定 2 段から、**resource dependency graph の topological order（level 昇順）1-pass** へ一般化（§6.3c.2）。価格は平滑化して履歴保存（`marketResourcePriceHistoryLimit`=120 = 10年分）。新 21 資源は初月 history が無いため `smoothedPrice` 不在時は `basePrice` を fallback（§4.3a）。
- **snapshot**: asset / holding 単位の月次 `RealEstateProductionResult` / `HoldingResourceRevenueSnapshot`（per-month。owner 会計は持たず生の per-asset netRevenue のみ）。asset の `grossRevenue = Σ sellOrders × marketPrice`、`inputCost = Σ actualInputConsumed × marketPrice`、`netRevenue = grossRevenue − inputCost`。**netRevenue は負になり得る**（input 不足の workshop は input 代を払いつつ floor 倍しか産出できない）。`totalNetRevenue = Σ max(0, asset netRevenue)`（赤字資産は 0 床留め）。**v0.58 賃金 carve**: `RealEstateProductionResult.wageShare`（= `max(0, netRevenue) × wageShareOfNetRevenue`、暫定 0.3）を持つ。ResourceEconomySystem の**最終 pass**（全 market 清算・snapshot 確定後）で、各 asset の `wageShare` を雇用 PopType の PopGroup へ `computeAssetPopTypeShares × wageRoleWeightByRole`（役割重み: skilled 1.4 / primary 1.0 / throughput 0.6）の正規化比で `PopGroup.money` に mint する（§6.3c.5）。`wageShare` は**実際に mint された合計**を記録し、雇用 PopType が不在なら 0（owner から carve しない＝carve==mint を構造保証）。LandRevenue はこの `wageShare` を控除する（後述）。**v0.56 read-model 追加**: `RealEstateProductionResult.recipeBreakdown`（recipe 別の `outputs`/`inputs`/`grossRevenue`/`inputCost`/`netRevenue`/`inputFulfillment`/`laborTypeFulfillment`）を保持。システムは元々 recipe 単位で計算してから asset へ集約していたため新規計算は無く、UI で「原材料 → ⚙ → 産出」と充足率をレシピ別に提示するための内訳保存のみ（integrity・分配・生産計算は非参照、月次上書き、`market.recipes` 出現順で決定的）。**充足率の見せ方**: asset 集約値（`inputFulfillment`/`laborTypeFulfillment` の slotCount 加重平均）は一次生産レシピ=1 が混ざりボトルネックが鈍るため UI 要約には使わず、施設要約・Holding カードは **min（最低レシピ＝ボトルネック）**、不動産詳細は **レシピ別**に提示する（入力充足は原材料を持つレシピのみ）。
- **POP needSatisfaction（v0.58 で wealth から置換、§6.3c.5）**: v0.55 の「shortage → wealth/unrest delta」を退役し、**予算制約消費の結果**で `needSatisfaction`(0..100) を決める。per-tier 充足 = `affordByTier[tier] × marketFill[tier]`（買えた割合 × 市場で満たせた割合の**積**）、これを `needSatisfactionTierWeight`（essential 0.6 / ordinary 0.3 / luxury 0.1）で加重平均 ×100 → `needSatisfactionSmoothing`(0.5) で平滑化。afford×fill の積にすることで「金が無い（貧困）」も「市場に無い（欠乏）」も両方シグナルに乗る。unrest はここでは即時更新せず、popSystem が needSatisfaction を介して駆動する（poverty/prosperity/growth）。旧 v0.55 の wealth/unrest 即時 delta（`needShortageWealthPenaltyByTier` 等）は撤去。
- **POP money（v0.58 貨幣経済、§6.3c.5）**: `PopGroup.money`（≥0）は **extensive な財産 stock**。労働所得（賃金 mint）で増え、消費（v0.58 Phase 2 予算制約消費の burn）で減る source/sink モデル（抽象市場は非保存のまま流用）。**worldgen seed** = essential N ヶ月分相当（`worldgenPopMoneyMonthsOfEssential`=4）× stratum 倍率（lower 1.0 / middle 1.5 / upper 3.0）× size。**人口変動での保存**: 移動/転職/雇用変更/merge は **per-capita 保存**（`movePopSizeToKeyMut` / `movePopEmploymentMut` は size 比で money を比例移送、`addToOrCreatePopGroupMut` の merge は money を **sum**＝extensive、wealth/needSatisfaction は size 加重平均＝intensive）。死亡（size 減）は money を `finalSize/oldSize` で比例 burn、出生（size 増）は据え置き（per-capita 希釈・相続なし）。global の money は非保存（賃金 mint・消費 burn・死亡 burn・sub-epsilon POP 除去）だが「移動/merge で保存」は単体テストで担保（narrow conservation）。**v0.58 Phase 1 段階**では money は蓄積するのみで消費は旧 wealth 経路（Phase 2 で予算制約消費へ移行し wealth 指数を退役、§6.3c.5）。
- **needSatisfaction（v0.58、§6.3c.5）**: `PopGroup.needSatisfaction`（0..100 intensive）。Phase 2 で need 充足度（afford × market-fill）として unrest を駆動する。Phase 1 では worldgen で seed するのみ（未使用）。

#### 6.3c.1 市場清算モデル（Victoria 3 型、v0.54 market-clearing rewrite）

各 StateRegion × ResourceKind 市場を、buy/sell order の不均衡で清算する。`MarketResourceSnapshot` の基本語彙は `sellOrders`（生産者が売りに出した量、原則全量 revenue 化）/ `buyOrders`（POP・workshop が求めた量、原則全量 cost 評価）。旧 `supply` / `effectiveDemand` / `sold` / `unsold` は内部互換名として残してよいが、仕様の基本語彙は sell/buy orders とする。

- **清算**: `producerRevenue = sellOrders × price`、`consumerCost = buyOrders × price`。buy/sell は一致しなくてよい。
- **価格式（imbalance ベース、旧 `ratio^elasticity` 廃止）**:

  ```text
  imbalance = (buyOrders − sellOrders) / max(min(buyOrders, sellOrders), ε)
  priceMultiplier = 1.0 + marketPriceSwing × clamp(imbalance, −1.0, 1.0)
  price = basePrice × priceMultiplier
  ```

  `marketPriceSwing = 0.75`（全資源共通）→ 価格幅は `basePrice × [0.25, 1.75]`。資源ごとの個別 min/max/elasticity は廃止（`basePrice` のみ資源別に維持）。
- **エッジケース（formula ではなく明示分岐）**: imbalance 式は `min(buy,sell)` で割るため、`buy=0` / `sell=0` は式ではなく分岐で扱う。
  - `buy=0, sell=0`: `price=basePrice` / revenue=cost=0 / shortage=false / severity=0（debug は inactive）。
  - `buy=0, sell>0`: `price=basePrice×(1−swing)`（下限）/ producerRevenue=sell×price / consumerCost=0 / shortage=false（需要ゼロでも下限価格で全量売れた扱い＝市場抽象化の副作用、debug/digest で観察）。
  - `buy>0, sell=0`: `price=basePrice×(1+swing)`（上限）/ producerRevenue=0 / consumerCost=buy×price / fulfillmentRatio=0 / shortage=true / severity=1。
- **fulfillmentRatio / shortage**:

  ```text
  fulfillmentRatio = buyOrders ≤ 0 ? 1.0 : clamp(sellOrders / buyOrders, 0, 1)
  shortage = buyOrders > 0 && fulfillmentRatio < resourceShortageFulfillmentThreshold   (=0.5)
  shortageSeverity = shortage ? clamp((threshold − fulfillmentRatio) / threshold, 0, 1) : 0
  ```

  buyOrders が全量購入扱いでも、`fulfillmentRatio` は welfare / input throughput の penalty に使う。v0.54 は日次蓄積型 modifier を持たず、月次で当月 severity を即時適用（将来は蓄積・回復へ拡張）。
- **shortage penalty**: (a) **recipe input（v0.55 改訂、§6.3c.2）** — 旧「`output = potential × rawFulfillmentRatio`（供給0→産出0 の strict Liebig）」を廃止し、**floor 付き `inputShortageModifier`** へ置換（`floor + (1−floor)×inputFulfillmentScale`、floor=0.25）。input が枯渇しても floor 倍で稼働し続け、希少 input を高値で買うため赤字になる（価格シグナルが凍結しない）。(b) **POP（v0.55）** — NeedCategory 別 shortage を NeedTier 係数で wealth−/unrest+ に反映（§16）。
- **marketValueDelta = producerRevenue − consumerCost**: v0.54 は会計保存しない（市場抽象化による価値の生成/消滅）。`sell > buy` → 正（生成）、`buy > sell` → 負（破棄）。
- **2 つの「保存」を混同しない**: (1) 上記 `marketValueDelta` は**市場レイヤで非保存**（抽象化）。(2) LandRevenue 分配レイヤの保存則 `Σ ownerPaid + Σ holdingTaxable == Σ positiveNet`（§6.4.2 / §21.4）は **不変**。`positiveNet = max(0, netRevenue)` が負を床留めするため、netRevenue が深く負になっても分配は保存される。この market-clearing rewrite は「money 保存を壊す」ものではない。
- **consumerCost の二層性（実装上の最重要分岐）**: recipe の **input buyOrders は実コスト**で asset の `inputCost` → `netRevenue` に効く。一方 POP の **NeedCategory buyOrders は POP の money を burn する**（v0.58 で「観察値のみ」から変更。`PopGroup.money` から smoothedPrice 評価額 × marketFill を引く。§6.3c.5）。この二層を取り違えると recipe inputCost の脱落 or POP の money 二重計上を招く。POP の支払いは抽象市場の producer 収入には還流しない（市場は非保存）。
- **integrity 不変条件（更新）**: 各市場の `price ∈ basePrice × [1−swing, 1+swing]`、`fulfillmentRatio ∈ [0,1]`、`shortageSeverity ∈ [0,1]`。`marketResourcePrices` の key / 非負・履歴上限、`monthlyHoldingResourceRevenue` の week 整合は従来どおり。

#### 6.3c.2 v0.55 商品経済の拡張（DAG 清算・需要/投入カテゴリ・労働適性）

- **resource level と DAG 1-pass**（`resourceGraph.ts`）: ProductionRecipe の input/output から resource dependency graph を構築。`raw resource`（input を持たない recipe の output、または誰の output でもない）= level 0、`recipe output` = `1 + max(level(input resource))`、複数 recipe が同じ resource を産むときは **max**。level は静的 config から**定義時に 1 回計算**（毎清算で再計算しない）。清算は level 昇順 1-pass で行い、各 level 内は `RESOURCE_KINDS` sorted order。**cycle は IntegrityCheck で error**（`integrityResourceEconomyChecks.ts`）。1-pass の既知近似（M9）: 下流の input demand は labor-based potential output 基準で立つ（上流 shortage で actual が減っても demand は減らない）。反復収束はしない方針。
- **NeedCategory 需要展開（§5）**: POP は NeedCategory 単位で需要を持つ（`PopNeedProfile`: 12 PopType × 8 NeedCategory、`popNeedDefinitions.ts`）。category 内の ResourceKind 選択は **greedy ではなく utilityPerMoney 比率配分**（`utility_i = contributionValue_i / smoothedPrice_i`、`share_i = utility_i^β / Σ`、`needResourceChoiceBeta=2`）。これにより加工品（clothes は basic_clothing に contribution 2.0、smoked_fish/processed_meat は protein に 1.5）が必ず正の需要 share を得て死蔵を構造的に回避する。value→units 変換: `buyOrders_i = share_i × desiredCategoryValue / contributionValue_i`。**v0.58**: `desiredCategoryValue = amountPerPop × size × tierScale` の **full desired**（旧 `purchasingPowerFactor(tier)` は撤去）。`tierScale` は essential tier に `popEssentialNeedScale`（v0.58 balance=**0.5**）を掛け、それ以外は 1（過少消費是正の調整ダイヤル、後述）。予算制約は呼び出し側（resourceEconomySystem）が start-of-tick の `PopGroup.money` を **essential→ordinary→luxury の tier 優先**で充当し、placed buyOrders = full × `affordByTier`（一律スケールにしない＝貧困 POP は「食料満額・贅沢ゼロ」になる）。価格は終始 smoothedPrice で評価し burn ≤ budget（money は負にならない）。§6.3c.5。
- **InputCategory（§6）**: recipe の inputs は InputCategory 参照（例 `textile_fiber` = flax 0.9 / wool 1.0）。市場 buyOrders への ResourceKind 選択は NeedCategory と同一の比率配分（`inputResourceChoiceBeta=2`）。単一 resource の category（metal=iron_ore 等）は share 1.0。
- **複数 input / Liebig + floor（§12.4/§12.5）**: `inputFulfillmentScale = min over category ( Σ share_i × fulfillmentRatio_i )`。これを直接 actualOutput に掛けず、floor 付き `inputShortageModifier = inputShortageOutputFloor + (1−floor)×inputFulfillmentScale`（floor=0.25）へ変換。`actualOutput = potentialOutput × inputShortageModifier`、`actualInputConsumed_i = desiredInput_i × inputShortageModifier`、`actualInputCost_i = consumed_i × marketPrice_i`（律速側に合わせ pro-rate。満額課金しない）。raw recipe は modifier=1。
- **労働構成と生産効果（v0.57 §雇用細分化で改訂）**: v0.55 の soft modifier（`laborTypeFulfillmentModifier`、floor 0.70 のヒストグラム交差）は撤去し、**施設駆動の PopType ハード枠 + 明示的な職能効果**に置換した。`RecipeLaborDemand`（`RECIPE_LABOR_PROFILES`、施設 kind 単位の構成）は `idealWeight`（雇用比率）/ `directOutputPower`（労働あたり産出倍率: 一次=1.0 / 熟練=1.5 / 非生産=0）/ `throughputBonus`（書記のスループット）を持つ。`computeLaborProduction`（`resourceProductionSelectors.ts`）が asset の実 PopType 構成から `effectiveLaborMult = Σ_t actualShare_t × directOutputPower_t` と `throughputMult = 1 + Σ_throughput(throughputBonus × coverage)`（coverage = min(actual/ideal, 1)）を算出。`basePotential = recipeLabor × effectiveLaborMult × baseOutputPerLabor × scale × facility × control`、**産出 = basePotential × throughputMult**、**入力は basePotential（throughput 適用前）で算出**（＝同原材料で産出のみ増える）。構成のズレはハード枠（rebalance の PopType 別容量・同数上限）が強制するため別 soft modifier は不要。旧 `inputEfficiencyBonus`（admin input 軽減）は throughput へ移行し未使用。
- **建設 Project の建築資材需要（§18）**: active な建設・修繕 Project（develop_holding / develop_real_estate / upgrade_owned_real_estate / handle_crisis の war_damage・disrepair）が timber / stone / tools の buyOrders を対象 Holding の StateRegion 市場に注入する。profile は **target 別 2 段キー**（real_estate / holding_improvement / crisis_repair の kind 別、`projectMaterialDefinitions.ts`）。Project budget は週次 Task completion で smoothedPrice により資材費として消費（§6.x Project / §19、二重消費しない）。
- **飢饉・干魃の商品経済整合（v0.55 後追い、§6.6 CrisisSystem 参照）**: 干魃は active な drought holding の食料 recipe 産出を severity 倍率で減衰（resourceEconomySystem の供給集計と per-asset 売却益の双方）。飢饉は物理的 pressure（perCapitaFoodNeed ベース）駆動の急性餓死。詳細は §6.6 および draft §C。

#### 6.3c.5 v0.58 POP 貨幣経済（賃金・予算制約消費・needSatisfaction）

POP の財産を 0..100 wealth 指数から具体的な **money 残高(stock)** へ移行した。source/sink モデル（賃金=mint・消費=burn、抽象市場は非保存のまま流用）。`PopGroup` は `money`(extensive) ＋ `needSatisfaction`(intensive 0..100) の 2 本立てで、0..100 `wealth` を退役。

- **賃金 mint（労働所得チャネル）**: resourceEconomySystem の**最終 pass**（全 market 清算・snapshot 確定後）で、各 asset の `wageShare = max(0, netRevenue) × wageShareOfNetRevenue`(v0.58 balance=**0.5**＝粗利の半分を労働者へ) を雇用 PopType の PopGroup へ mint する。配分比 = `computeAssetPopTypeShares(state, asset) × wageRoleWeightByRole[role]` を正規化（役割: skilled 1.4 / primary 1.0 / throughput 0.6、`popWageDefinitions.ts`）。`wageShare` は**実際に mint された合計**を記録し、雇用 PopType 不在なら 0（owner から carve しない＝**carve==mint** を構造保証）。LandRevenue は `positiveNet = max(0, netRevenue − wageShare)` で控除するため owner/税/国庫が wageRate 分縮む（労使ゼロサムの山分け）。
- **upper 配当 mint（所有者・支配者の取り分）**: 上流(nobles/patricians)は「給料」でなく**配当**を受ける。同じ最終 pass で holding 単位に `dividendBudget = Σ_assets max(0, netRevenue) × upperDividendShareOfNetRevenue`(v0.58 balance=**0.03**) を、**雇用枠に就いている upper POP にのみ** size 比例で mint する（`ar.ownerDividendShare` に asset 別 carve 額を記録）。雇用 upper 不在なら carve しない（carve==mint）。**失業 upper は受け取らない**＝没落（money 枯渇→既存の降格機構で下位転落、`popJobChangeSystem`）。賃金とは別 carve で、LandRevenue は `positiveNet = max(0, netRevenue − wageShare − ownerDividendShare)` で両方控除する。背景: production asset(farm/workshop)の雇用枠は lower/middle のみで upper を雇わないため、これが無いと upper POP が賃金経路に乗らず現金 0・needSatisfaction 0 になっていた。配当率を抑えめ(0.03)にしているのは、upper の needSatisfaction が luxury 財の marketFill に律速され ~45 で頭打ちのため money が死蔵に回りやすく、高率では owner 再投資減で lower/middle welfare を過度に削るため（将来 Project 資金集めで死蔵 money を還流できれば引上げ可、§13）。
- **施設(improvement)労働者の俸給（holding 収入から、施設労働者本人へ）**: 施設(manor_house/town_hall/storage)は収益を生まないので、施設に雇用される POP の給料は holding 収入(owner 取り分)から確保する。給与水準は同 stratum の生産 per-capita 相当にする。実装は **2 段**: (1) stratum 単位で施設人件費総額 `supplementByStratum_s = (同 stratum 生産者の生産賃金総額) × facCap_s/prodCap_s` を求める(`facCap_s`=施設雇用枠容量 / `prodCap_s`=生産 asset 雇用枠容量、level 込み。この総額は従来式と同一で owner 影響を変えない)。`prodCap_s=0` の stratum(upper)は生産賃金ゼロ→対象外(別途配当)。(2) `supplementByStratum_s` を各 stratum の**施設 slot を持つ popType** へ施設 facCap 比で按分し、**その popType の雇用 PopGroup 本人**へ mint する。該当 popType の雇用 POP が不在(slot 未充足)なら carve しない(`carve==mint`)。mint 総額を asset へ `max(0,netRevenue)` 比で按分し `wageShare` に合算して LandRevenue が控除する(施設俸給も労働コスト=owner 収入から)。**v0.58 で受取人を是正**: 旧実装は施設人件費を**生産者 POP** に上乗せ mint しており、生産 asset に登場しない**施設専用 popType(soldiers / bureaucrats / merchants 等。soldiers は `realEstateDefinitions` に無く improvement 専用)は収入経路ゼロ→money 枯渇→needSat 0** に張り付いていた。これを「施設人件費は施設労働者本人へ」に付け替え、soldiers 等が同 stratum 生産者と同 per-capita 相当の収入を得るようにした(生産者には上乗せしない)。総額・stratum カバレッジは従来どおりで owner 影響はほぼ不変(実測 seed1/40年: wageShare 62.7%→63.6%、+0.9pp=trajectory 差の範囲)。soldiers pcMoney(emp) 3.5→16.6 等、施設専用 popType の購買力が改善。determinism: byHolding/slot/popType 固定順・RNG 非消費。
- **POP 資産課税（lower/middle の死蔵 sink、land 税と合流）**: POP.money の唯一の sink は消費(marketFill 律速)のため、mint > goods だと lower/middle に money が死蔵する。これを削るため `popWealthTaxRate`(0.03 月次) で **per-capita floor(`popWealthTaxFloorPerCapita`=2.0)超過分**に課税する。**land 税と同じ holding 収入(holdingTaxable)へ合流**させ、代官の徴収(localExtractionRate × collectionEfficiency)・手数料・契約 chain で treasury へ流す共通経路に乗せる（landRevenueSystem）。**納税額(POP burn)= nominal × localExtractionRate**(代官の取り立て分)、**徴税額(treasury 到達)= nominal × localExtractionRate × collectionEfficiency**。差分(徴税効率ロス=不正・賄賂)は**世界から消滅**する意図的 sink（抽象市場が買い手なしでも mint する分と source/sink で総量均衡。死蔵の過剰 money 供給を削る効果も持つ）。**floor 以下の貧困層は非課税**(累進)・**upper は除外**(死蔵は将来 Project 出資で使う、§13)。史実の間接税/賦課が持つ「持てる者により多く」の累進 intent を stock 課税で抽象化したもの。実測(80年): POP.money 死蔵が課税なし比 ~71400→~17153 に縮小。徴収分の一部は代官手数料として Person.wealth へ、残りは treasury へ。国別の課税方式多様化(人頭税/資産税・対象層)は将来の「国の制度」で対応(§13)。
- **予算制約消費（tier 優先）**: §6.3c.2 の通り、demand は full desired を start-of-tick `money` で essential→ordinary→luxury に充当。placed = full × `affordByTier`。
- **needSatisfaction**: per-tier 充足 = `affordByTier × marketFill`（買えた×市場で満たせた）の tier 重み加重平均 ×100 を平滑化。money burn = `Σ allocatedByTier × marketFill`（smoothedPrice 基準で ≤ budget）。
- **tick 内循環の解消**: 予算 cap は start-of-tick money、賃金 mint は同 system の最終 pass。よって今 tick の賃金は**次 tick から使える**。価格は終始 smoothedPrice で評価するため money は負にならない。
- **money の人口保存（narrow conservation）**: money は extensive。移動/転職/雇用変更（`movePopSizeToKeyMut` / `movePopEmploymentMut`）は size 比で比例移送、merge（`addToOrCreatePopGroupMut` / 重複統合）は **sum**。死亡（size 減）は比例 burn、出生（size 増）は据え置き（per-capita 希釈・相続なし）。昇格コストは `moneyCostPerCapita` で移送 money から burn（sink）。global の money は非保存（mint/burn/死亡 burn/sub-epsilon 除去）だが「移動/merge で保存」は単体テストで担保。
- **unrest/mobility の駆動**: unrest は popSystem が needSatisfaction（poverty/prosperity）で駆動。昇格/降格 gate は **per-capita money**（`computePopTypeMoneyQuantiles`、money/size の size 加重分位）。移住 pressure は needSatisfaction 低下、opportunity は移住先 needSatisfaction。revolt/warSupply の welfare 読み取りも needSatisfaction（`getProvinceAveragePopNeedSatisfaction` / `getPopNeedSatisfactionByClass`）。
- **worldgen seed**: 初期 money = essential N ヶ月分（`worldgenPopMoneyMonthsOfEssential`=4）× stratum 倍率（lower 1.0 / middle 1.5 / upper 3.0）× size。
- **config**: `wageShareOfNetRevenue`(0.5) / `upperDividendShareOfNetRevenue`(0.03) / `popEssentialNeedScale`(0.5) / `wageRoleWeightByRole` / `needSatisfactionTierWeight` / `needSatisfactionSmoothing` / `worldgenPopMoney*`。制約: `wageShareOfNetRevenue + upperDividendShareOfNetRevenue < 1`。
- **v0.58 balance 校正（過少消費の是正）**: 初版（wageRate 0.3・essentialScale 1.0）は **賃金が essential 消費 desire の ~15% しか賄えず全 POP が貧困床（needSatisfaction 中央値 ~5）に貼り付く過少消費**になっていた。構造原因は (1) 賃金=粗利の30%と労働分配率が低い (2) 粗利総額ですら essential desire の ~57% で賃金率単独では原理的に届かない、の 2 点。**essential 消費 desire を半減（`popEssentialNeedScale` 0.5）＋ 賃金率を 0.3→0.5（労働者が粗利の半分）** の併用で afford_essential を ~0.15→~0.6 に引上げ、needSatisfaction 中央値 ~5→~45（旧 wealth が想定していた ~50 域に着地、下流の rescaling 不整合も自然解消）、人口・雇用率が回復、不穏度は calm（high>50: 0/15）。150年×4seed integrity green・determinism bit-identical 維持。**upper 配当の追加（過少消費是正の続き）**: 上記の賃金是正後も upper(nobles/patricians) POP は production asset の雇用枠外で賃金ゼロ・needSatisfaction 0 だったため、**雇用 upper への配当チャネル**（`upperDividendShareOfNetRevenue`=0.03、上記 bullet）を追加。雇用 upper の needSatisfaction が 0→~45、明確な富の勾配（employed upper の money が庶民の数十倍）が出現。失業 upper は没落して降格。150年×4seed integrity green・determinism bit-identical 維持。**残課題（balance-defer）**: lower/middle の蓄財は依然 modest（中央値 subsistence ~0.2）。配当率は将来 Project 資金集め（死蔵 money の現地開発還流）が入れば引上げ余地あり（§13）。seed によっては生産・marketFill 不足で needSatisfaction が低い世界もある（high money/low needSat、配当非起因の pre-existing・seed 固有）。
- **将来**: 労働需給に応じた動的賃金率、施設別の富格差可視化、Project 資金集めフェーズ（upper POP の死蔵 money を現地開発へ還流＋配当率引上げ）、完全保存市場（§13 将来課題）。

### 6.3d RecipeSwitchSystem（四半期=12週ごと、v0.55、§17）

`ResourceEconomySystem` の**直後**に実行する recipe slot の自動入れ替え（当月の最新 `smoothedPrice` を読み、当月の revenue snapshot を壊さず、変更は翌月以降の生産に反映）。RNG 不使用。

- 各 RealEstateAsset は四半期に最大 **1 slot** だけ recipe を入れ替える（commit 44312b3 で月次→四半期。一斉転換 herding 抑制のため throttle を強化。config `recipeSwitchIntervalWeeks=12`）。
- **best-improvement**（§17.3）: 可能な 1-slot 移動（recipe A から 1 減・recipe B へ 1 増、B は asset の RealEstateKind で許可される recipe）全 (A,B) ペアを `expectedAssetProfit` で評価し最大の 1 件を選ぶ。gain が `profitBefore × (1 + recipeSwitchMinGainRate)`（minGainRate=0.02）を超える場合のみ適用。
- `expectedAssetProfit` は snapshot（現採用 recipe の結果のみ）を使わず `computeAssetRecipePotentials` 相当を再計算し、価格を `basePrice` ではなく `smoothedPrice`（不在時 basePrice）に差し替える（§17.5）。
- **deterministic**: 候補 (A,B) は recipeId sorted order で列挙、同点は recipeId 昇順 tiebreak、atomic な −1/+1 で slot 合計を常に `realEstateRecipeSlotCount` に保つ。mutable draft では `realEstateAssets` slice のみ書き戻す。

### 6.4 LandRevenueSystem（4週ごと）

各 Holding の資源売却益（ResourceEconomySystem の月次 snapshot）を source に、RealEstate owner income / holding due の分割と代官による現地徴収を挟んだ上で、各 Holding の LandContract chain に沿って上納する。distribution（owner / bailiff / chain / treasury）は v0.53 までの構造を温存し、source だけを資源経済へ差し替えた（v0.54）。

**6.4.1 source（月次 resource snapshot）**

旧来の per-pop 生産合計（getPopProduction / getHoldingProduction）は廃止。各 Holding の収益は ResourceEconomySystem が出力した `monthlyHoldingResourceRevenue[holdingId]` の per-asset netRevenue を source とする。snapshot は同月の ResourceEconomySystem（tick 順で直前）が出力済み。

**6.4.2 holding taxable / owner income / holding due（per-asset、v0.54 §17）**

snapshot の `assetResults` を **資産ごとに反復**し、bailiff / chain の課税基盤となる `holdingTaxableRevenueBeforeBailiff` を組み立てる。**v0.58**: `positiveNet = max(0, asset.netRevenue − asset.wageShare − asset.ownerDividendShare)`（賃金 carve ＋ upper 配当 carve 後が owner/税/国庫の原資。`positiveNet` を 1 箇所変えるだけで owner income / holdingDue / taxable / 代官 / treasury すべてが `wageShare + ownerDividendShare` 分縮む。労使ゼロサムの山分け）。赤字資産は 0 寄与で床留め。read-model の owner income 推定（`estimateMonthlyOwnerIncome`、obligation accrual / 不動産売値 / house finance / UI が参照）も同じ carve 後 `positiveNet` を base にする（snapshot 経路）。

```text
所有なし asset:        holdingTaxable += positiveNet              （全額）
所有あり・非押領:      holdingDue = positiveNet × realEstateHoldingDueRate(0.10)
                       holdingTaxable += holdingDue
                       ownerIncome = positiveNet − holdingDue → owner へ支払い
所有あり・押領中:      holdingTaxable += positiveNet              （due + 押領分を holding 側へ吸収、§6.4.2c）
```

owner 支払いは owner.kind 別: `house` → House.wealth / `person` → Person.wealth / `polity` → Polity.treasury（税フロー効率の対象外で直接加算）。**owner が不在/inactive/死亡で支払えなかった ownerIncome は holdingTaxable に戻す**（保存則 Σ ownerPaid + Σ holdingTaxable == Σ positiveNet を維持。旧 owner income も inactive house 分は holding 側に残していた）。`realEstateHoldingDueRate` は v0.54 暫定の地代・市場税・法人税の抽象化で、将来 POP cash / wage / tax を導入したら縮小・廃止する。

この `holdingTaxable` が旧 `revenueAfterOwnerIncome` を置き換える。以降の bailiff extraction / chain 上納 / treasury 反映ロジックは入力値だけ差し替えて温存する。

各 Holding の代官による現地徴収を挟む。

```ts
const localExtractionRate = getBailiffLocalExtractionRate(state, config, assignment.id)
const collectionEfficiency = getBailiffCollectionEfficiency(state, config, assignment.id, recentTaskStatus)
const collected = holdingTaxable * localExtractionRate * collectionEfficiency
const bailiffFeeRate = getBailiffFeeRate(state, config, assignment.id)
const bailiffFee = collected * bailiffFeeRate
const remittanceToTerminal = collected - bailiffFee
```

通常人物代官には `bailiffFee` を `person.wealth` に加算する。placeholder 代官には加算しない。

**6.4.2b chain 上納**

各 Holding について、`remittanceToTerminal` を chain に流す。chain 配分時には treasurer の taxEfficiency を掛けず、生の `remittanceToTerminal` で開始する。

```ts
let remaining = remittanceToTerminal
for (const contract of chain.slice().reverse()) {
  const tax = remaining * contract.terms.taxRateToGrantor
  treasuryDeltas[granteePolityId] += (remaining - tax)
  remaining = tax
}
```

`root contract` の `taxRateToGrantor` は 0 固定なので、world に流出する分は無い。

**6.4.2c 義務不履行による収益の留保（v0.53、read-only）**: chain 上納と owner income 支払いは、active な押領・上納拒否を反映して実効値を変える（詳細は §6.70）。LandRevenueSystem はこれらの entity を作成・変更せず、**読むだけ**である。

- **active RealEstateSeizure**: 対象 RealEstateAsset の `holdingDue` は通常通り holding taxable に入れ、`ownerIncome` を rightfulOwner（House）に支払わず holding 側へ吸収する（= 押領中は positiveNet 全額が holding taxable になり、bailiff extraction / chain 上納の対象）。`asset.owner` record は active 中も保持し、20年時効で legalized したときのみ `undefined` 化する。
- **active LandContractDefault**: `targetLandContractId` を `byContract` で引き、当該 contract の `taxRateToGrantor` を**実効 0** とみなす（contract record の値は不変）。tax_default / revolt_independence の両 origin に適用する。revolt_independence の nominal occupation contract は `revoltOccupationNominalTaxRate`（=0.5）の正税率を持つが active default 中はこの実効 0 で上書きされる。terminal contract を実効 0 にすると直近 grantor だけでなく**上流 chain 全体**へ流れる revenue が止まる（remaining が上に繰り上がらない）。

**6.4.3 Polity treasurer の taxEfficiency**

taxEfficiency は chain 配分の後、各 grantor polity 単位で集計した収入デルタに対して適用される。多段 chain では各 overlord polity が自分の treasurer の効率を自分の取り分に個別適用する。あわせて `config.taxFlowEfficiency`（既定 1.0）を同時に乗算する。

```ts
treasury += treasuryDeltas[polityId] * calcTreasurerTaxEfficiency(polityId) * config.taxFlowEfficiency
```

treasurer の能力補正については §10 参照。`collectionEfficiency`（代官の現地徴収能力）とは別概念。

**6.4.4 Holding 単位の徴税負担処理**

Holding 単位の `totalBurdenRate` ベースで POP の wealth / unrest と代官への attitude を処理する。

```ts
const { collectionFrictionBurdenRate, totalBurdenRate } =
  computeBailiffBurdenComponents(localExtractionRate, collectionEfficiency, config.collectionFrictionFactor)

// POP wealth: 徴税摩擦による追加損耗（wealth 比例）
pop.wealth -= collectionFrictionBurdenRate * config.localExtractionWealthPenalty * (pop.wealth / 100)

// POP unrest: totalBurdenRate が comfort を超えた分で上昇
const burdenOverComfort = Math.max(0, totalBurdenRate - config.comfortableLocalExtractionRate)
pop.unrest += burdenOverComfort * config.localExtractionUnrestGain

// POP → Bailiff Attitude（通常人物代官のみ）。affection(好悪) と respect(尊敬/軽蔑) は独立軸。
// affection: 徴税の苛烈さ(負担)と方針の優しさで決まる
affectionDelta -= burdenOverComfort * config.bailiffBurdenAffectionPenaltyFactor
if (policy === 'protect_residents') affectionDelta += config.bailiffProtectResidentsAffectionBonus
affectionDelta = clamp(affectionDelta, -1.0, 0.5)

// v0.49 respect: 代官の「有能さ＋実績」で決まる（苛烈さ=affection とは独立）。
//   苛斂誅求でも有能なら恐れつつ尊敬され、低能力なら好かれても軽蔑される。軽蔑(負方向)は能力ドリフトが駆動。
const competence = governanceCompetence(bailiff) // command*0.5 + learning*0.5、0..120
respectDelta = (competence - config.bailiffRespectNeutralScore) * config.bailiffAbilityRespectFactor  // 有能↑/低能力↓
              + (recentTaskStatus === 'completed' ? config.bailiffTaskCompletedRespectGain : 0)  // 実績で加点
respectDelta = clamp(respectDelta, -config.bailiffRespectMaxDelta, config.bailiffRespectMaxDelta)
// NB: recentTaskStatus は 'completed'|'none' の2値。'none' は「直近4週に徴税タスク完了が無い(未割当含む)」で
//     失敗ではないため減点しない（自動徴収できている有能代官を不当に軽蔑させない）。
```

respect は **尊敬・軽蔑が蓄積される土台**として用意した段階で、これを読み取って何かを変える下流はまだ無い
（反乱の代官罷免分岐 `decideRevoltDemand` は affection のみ参照）。将来 respect を参照する系を追加する。

**6.4.5 retained wealth の POP 反映**

`retainedToPop` を `provinceCollected`（各 Holding で実際に徴収された額の合計）ベースで計算する。分母・分子とも**同一月の resource snapshot 由来**にし（v0.54 §17.3）、分母は province 内 holding の `holdingTaxable` 合計（`provinceTaxable`）を使う（旧 `getProvinceProduction` の live 再計算は混ぜない）。owner に支払った owner income は POP の手元に残った富ではないので分子・分母とも taxable から除外済み（押領で holding 側に吸収された分は taxable に含まれ、bailiff に徴収されなかった分だけ POP retained に残る）。

```ts
const provinceCollected = sum(collected for each Holding)
const retainedToPop = Math.max(0, provinceTaxable - provinceCollected)
```

`retainedWealthGainByClass` による class 別 POP wealth 回復は維持。

**6.4.6 debug log**

`config.debug === true` 時に `[BAILIFF]` ログを stderr に出力する。holdingId / collected / bailiffFee / remittance / rates / burden 等。

### 6.5 PolitySurplusDistributionSystem（4週ごと）

各 Polity treasury から **Polity Influence（§6.64）に比例して House に分配**する（v0.42: 旧 Polity share 比例から変更）。給与・維持費 (OfficeCompensationSystem §6.20) は別 system で支払う。

```ts
// reserveTarget を所領規模に応じて動的に計算
const holdingCount = /* polity の terminal province 全体の holding 数 */
const reserveTarget = config.polityTreasuryReserveBase
  + config.polityTreasuryReservePerHolding * holdingCount

const distributable = Math.max(
  0,
  polity.treasury - reserveTarget
) * config.politySurplusDistributionRate

// influence breakdown の House entry に entry.percent / 100 で分配
const breakdown = getPolityInfluenceBreakdown(state, config, polityId)
for (const entry of breakdown.entries) {
  if (entry.holder.kind !== 'house') continue  // Person entry (commonwealth leader 等) には分配しない
  house.wealth += distributable * (entry.percent / 100)
}
polity.treasury -= distributedTotal
```

`reserveTarget` は `polityTreasuryReserveBase`（暫定 50）+ `polityTreasuryReservePerHolding`（暫定 50）× holding 数で動的に算出される。大国ほど多くの運営資金を確保し、プロジェクト費用や給与の支払いに備える。後続の OfficeCompensationSystem の給与原資となる。

1 サイクルの `distributable = max(0, treasury - reserveTarget) × distributionRate` の計算は `getPolityDistributablePerCycle`（landContractSelectors）に集約され、本 system と House の投影年間収入 `getHouseProjectedAnnualIncome`（§6.19 支払能力ゲート）の両方から呼ぶ単一の正本となっている（式の二重定義による drift 防止）。

**commonwealth の扱い (v0.42)**: House entry が存在しない（leader Person entry のみの）commonwealth では surplus は treasury に残る。旧 person-holder share への分配は廃止。

### 6.6 CrisisSystem（毎週。年次発生ロールを内包）

> **v0.48 で旧 DisasterSystem を「Crisis エンティティ + 対処 Project」モデルに再設計した。** 旧実装は state に残らない単発即時ダメージ（peasants wealth −8 / population −10% 等）で、担当者・予算・有効期間・救済・attitude 影響がすべて欠落していた。v0.48 は不作（famine）/ 疫病（plague）/ 干魃（drought）/ 戦災（war_damage）/ 反乱前段（unrest）を **対処を要する局所的事態（Crisis）** としてエンティティ化し、「有能な代官が災害を凌ぐ / 無能・無予算が放置し被害が拡大する」という holding ごとの差分ドラマを生む。豊作（BountifulHarvest）は副作用が異なるため §6.6a HarvestSystem に分離した。

**Crisis = 局所的ハザード（能動）**。holding 単位で発生し、誰も対処しなくても毎週 severity 比例のデバフを与え続ける（型は §3）。kind は `famine / plague / drought / war_damage / unrest` の 5 種 + **v0.48.1 で追加した `disrepair`（設備の機能不全）**。`severity`（0..100）は被害の大きさで、対処 Project の進捗に応じて派生同期される。**disrepair は他 5 種と異なり condition 駆動**（severity は表示専用で `HoldingImprovement.condition` から導出、deadline・週次 pop デバフを持たない）であり、ライフサイクルの本体は §6.6b FacilityMaintenanceSystem が所有する。disrepair の対処 Project は既存 `handle_crisis` をそのまま再利用する（新 ProjectKind を作らない）。

**対処 = handle_crisis Project（受動）**。既存 Project の task 経済に乗る（develop_holding の鏡像）。`find_supervisor → secure_budget → mitigate` の stage 列で `advance_project` task を発行し progress を積む。担当者の能力・予算は task の難易度・成功率に反映される（人物能力効果は respond_to_pressure と同様）。`severity = max(0, targetProgress − project.progress)`（targetProgress = 初期 severity）で同期し、progress が積まれて severity が 0 になると **resolved**。

**発生（年次ロール、年初週のみ）**: famine/plague/drought を Province 単位で独立判定し、当たった Province 内の該当 holding に Crisis を 1 つずつ生成する。

```ts
const pressureExcess = Math.max(0, pressure - config.populationPressureThreshold)
// v0.55: 飢饉は「食料生産が物理的扶養力を割った結果」。発火は購買力中立の pressure（人口/扶養力）の
//   famineOnsetPressure 超過分に比例。base は既定 0（任意の背景飢饉率ノブ）。
const famineDeficit = Math.max(0, pressure - config.famineOnsetPressure)
const famineChance  = config.famineBaseChancePerYear  + config.faminePressureChanceBonus  * famineDeficit
const plagueChance  = config.plagueBaseChancePerYear  + config.plaguePressureChanceBonus * pressureExcess
// v0.55: 干魃は気候イベント。人口圧と独立した base のみ（食料生産を減衰させ飢饉の原因となる）。
const droughtChance = config.droughtBaseChancePerYear
```

> **v0.55 §B（飢饉・干魃の商品経済整合）**: 旧実装では famine も drought も pressureExcess（人口圧）駆動で発火し、固定率の人口ショックを直接与えていた。商品ベース経済では (1)「食料生産が人口を養えない」は carrying-capacity 経由で**慢性的に**既にモデル化されており（popSystem の `growthFactor = 1 − pressure²` が pressure>1 で負転、§6.5）、(2) market は価格上限で食料を実質無限購入させてしまう抽象化のため、生産不足が「餓死」に結びつかなかった。v0.55 で**消費（結果）を時間軸で分担**する: carrying-capacity が慢性の成長抑制を担い、**飢饉は急性の餓死を担う**。market fulfillment は購買力加重で「買えない＝飢える」層ほど需要が下がり充足が高く出る（逆向き）ため、信号には用いず物理的な pressure（perCapitaFoodNeed ベース）を使う。

> **v0.58 balance（famineOnsetPressure 1.0→1.3）**: 過少消費是正で食料 desire を半減（`popEssentialNeedScale` 0.5、§6.3c.5）した結果、人口が食料生産限界まで増えて food pressure が平時から ~1 に張り付き、「**穀物は安値（需要半減で oversupply）なのに飢饉**」が頻発した（生存閾値 `perCapitaFoodNeed`=1.0 が実消費 ~0.6 より高く、満腹の POP まで餓死判定された）。飢饉は人口抑制の load-bearing な機構（消すと食料 cap 解放で人口爆発・失業・welfare 悪化）のため**消さず**、onset を 1.3 へ上げて**急性飢饉を深刻な不足（干魃等）のみに限定**し、平時の人口抑制は滑らかな `growthFactor` に委ねた。実測（tiny seed1）: 飢饉イベント -83%・雇用率 74→87%・人口安定。**残課題**: 食料の内訳（grain vs protein/fine_food）が乖離してくれば、飢饉を **grain 単独 × 低 survival 閾値**へ分離する案が「survival＝穀物」をより正しく表現できる（現状は grain が総食料の 76–90% で両者がほぼ連動するため効果小・将来の磨き込み）。

- **spawn フィルタ**: famine/drought は農業 peasants を持つ holding のみ、plague は POP を持つ holding。
- **初期 severity** = `crisisInitialSeverityByKind[kind] + pressureExcess * crisisSeverityPressureBonus`（上限 100）。
- **初期ショック**（一回限りの人口減）= `crisisInitialShockSizeRateByKind[kind]`。plague/war_damage は table 値（plague は全 class、war_damage は peasants）。**v0.55: 飢饉の餓死は table 値ではなく不足分比例の急性死** `min(famineMaxMortalityRate, famineMortalityPerDeficit × max(0, pressure − famineOnsetPressure))`（peasants）。**干魃は直接の人口ショックを持たず（table 0）**、後述の食料生産減衰で扶養力を下げて飢饉を誘発する。holding スコープで 1 回適用（province ラッパーの多重適用を回避）。
- **干魃の食料生産被害（v0.55 §B）**: active な drought Crisis を持つ holding の食料 recipe 産出を、`resourceEconomySystem` の市場清算で乗算減衰する: `倍率 = max(droughtFoodOutputFloor, 1 − droughtFoodOutputPenaltyRate × severity/100)`。供給集計と per-asset 売却益の双方に同じ倍率を適用（決定的、crisis key sorted 反復）。食料以外の産出（鉱石等）は影響しない。干魃は state 食料供給・当該 holding 収益を確かに押し下げる（実測: 干魃多発で grain fulfillment mean 0.989→0.953）。
  - **granularity の注意（実測）**: carrying capacity / pressure は **state 単位**で集計される（`getStateCarryingCapacity` / `getStatePopulation`）一方、干魃は **holding 単位**で発生するため、1 件の局所的な干魃の食料減は state 全体で希釈される。均衡 pressure（~0.77）は `famineOnsetPressure`（1.0）から遠いため、**default 値では単発の干魃が飢饉の閾値を越えることは稀**で、飢饉は主に過剰人口（pressure overshoot）由来で発火する。「広域・甚大な干魃が飢饉を引き起こす」連鎖を信頼できる動力学にするには holding 単位の食料 granularity 化が必要（将来。`project_disaster_relief_future` 参照）。現状は (1) 干魃＝食料経済への被害（収益・供給。検証済）と (2) 飢饉＝物理的食料不足（pressure>1）の結果（検証済）という 2 つの独立した修正であり、両者を強く連結させるのは scope 外。
- **設備による被害軽減（v0.48.1）**: `crisisMitigationByKind[kind]` に「軽減する設備種別 + レベルあたり軽減率」を持つ kind は、その holding の当該設備の**実効レベル**（`level × conditionEffectiveness(condition)`、§6.6b）に応じて severity と初期ショックを乗算で下げる（`factor = max(0, 1 − reductionPerLevel × 実効レベル)`、決定的で RNG を引かない）。既定は **灌漑設備（irrigation_infrastructure）→ 干魃** / **貯蔵設備（storage_infrastructure）→ 飢饉**（各 0.25/level、健全・max level 3 で最大 75% 軽減＝25% 残る）。「灌漑された農地は干魃に強い / 蔵があれば飢饉を凌げる」という設備の固有性を与える。**機能不全（condition < 閾値）の設備は実効レベルが下がり軽減効果も低下、condition 0 で軽減ゼロ**（壊れた蔵/灌漑は守れない＝設備維持管理と連動）。未登録 kind（plague 等）は軽減なし。
  - **定期保守点検（v0.48.2 で実装）**: 「機能不全になってから修理する」reactive モデルに対し、普段の保守点検で機能不全を未然に防ぐ proactive な仕組みを condition 3 段モデルとして追加した（§6.6b）。要保守帯（50〜80）で代官＋owner 財政により condition を回復し、保守の失敗（代官不在・財政難）だけが機能不全 Crisis の入口になる。
- **後方互換**: Province レベルの物語ビートとして旧 `FAMINE` / `PLAGUE` イベントを 1 件だけ残す（drought は新規 kind で legacy event を持たず per-holding `CRISIS_CREATED` のみ）。
- **kill-switch**: 年次発生ロールは `disasterEnabled`（default true）で抑制できる（旧 DisasterSystem 互換）。war_damage / unrest は別経路で spawn されるため影響しない。
- war_damage は PeaceSettlementSystem の領地移転後（§6.46）、unrest は ProvinceRevoltSystem（§6.29）から spawn される。

**担当者割当（`resolveCrisisHandlers`）**: holding に代官（bailiff）がいれば代官を creator=supervisor に据える（「有能な代官が凌ぐ」現地ドラマ）。**代官不在時は Pressure と同様**、owner polity の指導者（`getPolityLeader`）を creator に立て `selectProjectSupervisor` で能力ベースに担当者を探す（見つからなければ指導者自身）。指導者すら不在のときだけ対処 Project を生成しない＝放置。代官を `selectProjectSupervisor` に通さないのは、代官が holding office 保有者で polity owner に対する officeBonus が付かず別の polity 役職者に displace されてしまうため（現地ドラマが死ぬ）。supervisor の死亡は `projectMaintenanceSystem` が再選定／failed で処理（既存機構を継承）。

**予算（ProjectBudget, owner Polity 国庫）**: `required = min(floor(treasury * crisisBudgetTreasuryRatio), crisisBudgetCapByKind[kind])`。secure_budget stage で国庫から確保する。treasury 不足なら secure_budget で停滞＝「予算不足の放置」。実行 deadline は `Crisis.deadlineWeek`（spawn 時に `crisisDeadlineWeeksByKind[kind]` で設定）を単一の真実とする（getProjectDeadlineWeeks に handle_crisis 分岐は無い）。

**週次処理（毎週）**:
- **severity 比例デバフ**: 対象 class の POP に wealth −（`crisisWeeklyWealthPenaltyPerSeverity * severity`）/ unrest +（`crisisWeeklyUnrestPerSeverity * severity`）。対象 class は plague=全 class、unrest=反乱 class（`demand.claimantPopClass`）、その他=peasants。放置 Crisis も severity 据え置きでデバフ継続。
- **放置時の attitude 低下**（対処 Project 無し or secure_budget 停滞中）: その holding の POP の **代官 affection ↓ + Polity affection ↓** を毎週わずかに（`crisisNeglectAffectionDropPerWeek*`）。**owner house は対象外**（災害放置では secession を焚き付けない）。
- **owner live 解決**: owner polity が inactive / holding terminal 喪失なら expired+purge（EC2/EC5）。所有移転で Project.owner がずれたら旧 Project を cancel し、新 owner で `resolveCrisisHandlers` 経由で対処 Project を張り直す（EC1 自己修復。担当者が立たなければ放置）。
- **放置リトライ（EC6）**: 対処 Project がない active crisis に毎週 `resolveCrisisHandlers` を再試行する。commonwealth 成立直後など人材不足で spawn 時に Project を立てられなかった crisis が、行政官配置後に回復できるようにする。担当者が見つかれば即座に `createHandleCrisisProjectMut` で Project を生成する。
- **期限処理**: `absoluteWeek >= deadlineWeek` で未解決 → expired。追加 affection 低下（`crisisExpiredAffectionDrop*`）。unrest 以外は `CRISIS_EXPIRED` を emit して即 purge。**unrest は expired を mark するだけで purge せず**、UnrestCrisisSystem（§6.29a）が同 tick で武装蜂起を適用してから purge する。

**完了（resolved）**: handle_crisis Project が completed すると ProjectOutcomeSystem（§6.41）が Crisis を resolved にして即 purge（`flushTerminalEntities` は Project 専用・年末のみなので Crisis を残せない）。`CRISIS_RESOLVED` を emit。**unrest だけは purge せず resolved を mark** し、UnrestCrisisSystem が譲歩/鎮圧を適用してから purge する。

CrisisSystem は ProjectOutcomeSystem の **後** に走り（resolved/progress を読んで severity を同期できるよう）、UnrestCrisisSystem はその直後に走る（mark→action を同 tick で完結）。整合性不変条件は §6.35（C1–C5）で検査する。

### 6.6a HarvestSystem（48週ごと = 毎年）

旧 DisasterSystem の豊作（BountifulHarvest）を分離した年次 system。`disasterEnabled` で抑制できる。

- treasury への直接加算なし。翌週以降の LandRevenueSystem で POP production 上昇により国庫が増加する
- `adjustProvincePopWealthByClass(state, pid, 'peasants', +bountifulHarvestPeasantWealthGain)`
- `adjustProvincePopUnrestByClass(state, pid, 'peasants', -bountifulHarvestPeasantUnrestReduction)`
- `adjustProvincePopWealthByClass(state, pid, 'townsmen', +bountifulHarvestTownsmanWealthGain)`
- `adjustProvincePopUnrestByClass(state, pid, 'townsmen', -bountifulHarvestTownsmanUnrestReduction)`

### 6.6b FacilityMaintenanceSystem（4週ごと、CrisisSystem の後）

> **v0.48.1 で導入。** それまで `HoldingImprovement.condition` は 100 固定生成で integrity の `[0,100]` 検査にしか使われない死蔵フィールドだった。設備は一度作れば永遠に残り、最終的に開発対象が枯渇する。本 system は condition を生きたスカラーにし、**減衰 → 機能不全（disrepair Crisis）→ 人手+予算で修理 → 放置で破壊** のライフサイクルを与える。狙いは「無限開発の歯止め」: 恒常的な作業 sink になるのは `develop_holding` ではなく **修理（`handle_crisis`）** であり、開発の自然な上限は (a) 修理が奪い合う予算・人手の有界性 と (b) レベルダウン（維持しきれない設備は持続可能なレベルへ縮む）の 2 つが作る。

**condition 駆動モデル**: condition が真実の源で、Crisis 中も独立に減衰し 0 で破壊。Crisis の `severity` は表示用に condition から導出するだけ（§6.6 disrepair 分岐）。本 system は ProjectOutcomeSystem と **同 interval(4)・同 offset(0)** で走り登録順で CrisisSystem の後に置く。これにより「同サイクルに完了した修理（ProjectOutcome が condition を回復）が先に処理され → その後で本 system が減衰・破壊判定」が毎回保証され、完了直前の improvement の誤破壊を防ぐ。1 tick 1 draft で `holdingImprovements` / `holdingImprovementIndex.byHolding` / Crisis slice / Project slice を clone し in-place mut する（condition 書込は必ず `{ ...imp, condition }` の per-object spread）。走査は `Object.keys().sort()` で順序固定（採番決定性）。本 system は RNG を引かない。

**condition 3 段モデル（v0.48.2）**: condition を 3 帯に分け、軽い保守と重い Crisis を段階化する。
- **健全（condition ≥ `facilityMaintenanceThreshold`=80）**: 出力ペナルティなし。何もしない。
- **要保守（`facilityDisrepairThreshold`=50 ≤ condition < 80）**: 出力ペナルティはまだ無い（`conditionEffectiveness` は閾値以上で 1.0）。**代官による定期保守**の対象帯。
- **機能不全（condition < 50）**: 出力が崖状に低下し disrepair Crisis（重い機構）が発火。
- **破壊（condition 0）**: レベルダウン / 全壊。

不変条件: `facilityDisrepairThreshold < facilityMaintenanceThreshold ≤ 100`。減衰は常に進むので、保守が機能する限り condition は要保守帯で 100 に戻り続け、保守が**失敗した結果**（代官不在・財政難）だけが機能不全 Crisis の入口になる。「代官が常駐する領地は地味に維持され、空席・財政難で初めて荒廃が始まる」歴史らしいドラマと、代官という役職への常時の存在価値を与える。

処理（各 improvement を sort 順に）:
- **減衰**: `condition' = max(0, condition − facilityConditionDecayPerCyclePerLevel × level)`。レベル比例（高レベルほど維持コストが重く、修理が予算・人手をより多く奪う）。修理中も減衰は止めない（間に合わなければ崩壊）。
- **閾値割れ → disrepair Crisis 発火**: condition < `facilityDisrepairThreshold` で、その improvement を指す active disrepair Crisis が無ければ `spawnDisrepairCrisisMut`（ws ベース。`spawnCrisisForHolding` の鏡像）で生成。dedup は `targetImprovementId` 込み。owner は live 解決（`getHoldingTerminalPolityId`、active owner polity が無ければ生成しない）。担当者は `resolveCrisisHandlers`（代官 or 指導者+`selectProjectSupervisor`）。spawn 時 `severity = crisisInitialSeverityByKind.disrepair`（= 修理工数 = Project の targetProgress）。表示用 severity（threshold−condition）は CrisisSystem が毎サイクル上書きする。
- **要保守帯 → 代官による定期保守（v0.48.2）**: `facilityDisrepairThreshold` ≤ condition < `facilityMaintenanceThreshold` の improvement について、**active な代官**（`getActiveBailiff`、`bailiffSelectors.ts` 共有。placeholder/死亡/空席は不在扱い）**かつ** owner polity（live 解決・active）の `treasury` が費用（`facilityMaintenanceCostPerLevel × level`）以上なら、treasury から費用を引き（per-object spread。`polities` slice も draft に clone）condition を `facilityMaintenanceConditionRestore`(100) に回復し `FACILITY_MAINTAINED`（minor、messageParams: holding / improvementKind）を emit。代官不在・財政難（treasury < 費用）のどちらかで保守は行われず減衰が継続し、いずれ機能不全（disrepair Crisis）に至る。**treasury は払える時だけ引く**（treasury<0 integrity 違反 §C6 を防ぐ、load-bearing）。1 holding 複数 improvement は各々が個別に費用を払い、treasury が尽きれば sort 順で以降スキップ（決定的）。RNG は引かない。
- **condition 0 → 破壊**（`degradeHoldingImprovementMut`）: `level − 1`。level ≥ 1 が残れば condition を `facilityRepairConditionRestore`(100) に戻して部分崩壊（lower-level として健全化）、level 0 なら improvement を削除し `holdingImprovementIndex.byHolding` から除去（filter 後に空配列なら key ごと delete）。いずれも対応する active disrepair Crisis を purge（`removeCrisisMut`）+ 進行中の修理 Project を cancel（`cancelActiveResponseProjectMut(..., 'target_destroyed')`）してから `FACILITY_BREAKDOWN`（messageParams: holding / improvementKind / breakdownOutcome ∈ degraded|destroyed）を emit。
- **防御 sweep**: 対象 improvement が消滅した dangling disrepair Crisis を検出したら purge/tolerate（throw でなく。破壊経路で通常 purge 済みのため belt-and-suspenders）。

**修理（`handle_crisis` 再利用）**: 修理 Project は既存 Crisis 機構（find_supervisor → secure_budget → mitigate）に乗る。targetProgress = 修理工数（spawn 時 severity）で creation 時のみ設定（表示 severity 上書きでは壊れない）。完了で ProjectOutcomeSystem の `applyHandleCrisisMut` が disrepair 分岐で対象 improvement の condition を `facilityRepairConditionRestore`(100) に回復してから purge（**load-bearing**: 回復を省くと condition が閾値以下のまま再 spawn される無限 churn）。**disrepair はタイマー無し**: 終端は repaired / destroyed のみで、Crisis 側（deadline 失効スキップ）と Project 側（secure_budget 通過時に `deadlineWeek` を undefined にし残存タイマーを断つ）の両方で deadline 経路を通さない。

**生産への影響（機能不全 = 段階的低下）**: `conditionEffectiveness(condition, threshold, minFloor) = condition ≥ threshold ? 1 : max(minFloor, condition/threshold)`（`holdingImprovementSelectors.ts`）。閾値以上は full(1.0)、未満は線形低下（下限 `facilityDisrepairMinEffectiveness`、通常 0）。bimodal（健全はフラット稼働 / 機能不全で初めて出力が崖状に落ちる）。`getHoldingDevelopment`（development 寄与）と `computeHoldingClassCapacity`（雇用 capacity）の improvement level 寄与に乗算。capacity helper の要素型は `condition` を必須にして全 builder に注入を強制する（optional だと渡し忘れが静かに死ぬ）。二重計上ではない（capacity は state 非依存で development を参照しない並列の consumer）。

**戦争連動**: `spawnWarDamageCrisis`（PeaceSettlement の領地移転後）で対象 holding の全 improvement の condition を `warDamageConditionDrop` 減少させる（improvement 2 slice を draft に追加・per-object spread）。閾値割れは翌サイクル以降に本 system が disrepair として拾う（パイプライン再利用）。war_damage Crisis と disrepair Crisis は同 holding に同居しうる（dedup は kind 別）。**再戦災（案 B, v0.48.1）**: 同 holding に既に active な war_damage Crisis がある場合は新規生成せず、既存 Crisis の `deadlineWeek` をリセット（対処猶予の延長。active 対処 Project があれば deadline を同期）+ 設備 condition を再損傷させる（CRISIS_CREATED は再 emit しない）。

**worldgen 第1波の desync**: worldgen の improvement は condition を 100 固定でなく決定論 jitter（`facilityConditionSeedJitterMin`..100、improvement id 由来の剰余）で生成する。全 condition 100 出発だと同レベル設備が同週に一斉閾値割れする同期波を時間方向にばらす。新たな RNG draw は引かない（worldgen の draw 順を不変に保つ）。回復はどのみち 100 に戻るので jitter は初期世代のみに効く。

**disrepair の neglect 緩和（v0.48.1 レビュー反映）**: disrepair は唯一 deadline を持たない Crisis 種で、放置時の neglect attitude 低下が他種（12〜32週で失効）と違い破壊までの multi-year（level 1 で ~224週、高 level ほど短い）にわたって蓄積する。neglect 自体は仕様意図（放置中に代官/Polity affection を下げる）だが、長期蓄積が過大にならないよう disrepair の週次 affection 低下を `crisisDisrepairNeglectMultiplier`（既定 0.4 = 他 Crisis の 40%）で穏やかにする（`applyNeglectAttitude`）。

**develop_holding による condition リセット（v0.48.1 レビュー反映）**: `develop_holding` 完了で**既存** improvement をレベルアップする際、condition を `facilityRepairConditionRestore`(100) にリセットする（新規生成 condition:100 と対称）。disrepair 中の設備を develop した場合は修繕も完了したとみなし、対象の active disrepair Crisis を purge + 修理 Project を `target_repaired` で cancel する（condition だけ戻して Crisis を残すと健全な設備に active disrepair Crisis がぶら下がる不整合になるため）。

**balance-watch（balance フェーズで観察、CLAUDE.md §4）**:
- 生産・capacity の二経路が閾値未満で同時低下し急峻な崖になる（→ wealth → unrest 連鎖）。同期波（worldgen jitter で緩和）以外では平常時に起動しない設計。
- 再戦災（案 B）で設備が複数回損傷しうるため、戦争が頻発する holding では設備破壊が加速する。破壊頻度の妥当性は balance フェーズで観察。

### 6.7 MortalitySystem（4週ごと）

人物の自然死亡を処理。

**死亡率（v0.45.1 で U 字年齢曲線 + config 化）**: 4 週ごと判定 1 回あたりの率（年 12 回判定）。年齢境界（3/15/40/60/70）はコード内固定、率のみ config。

| 年齢帯 | config key | default | 年率換算 |
|---|---|---|---|
| 0–2 歳 | `mortalityRateInfant` | 0.004 | 4.7% |
| 3–14 歳 | `mortalityRateChild` | 0.0012 | 1.4% |
| 15–39 歳 | `mortalityRatePrime` | 0.0008 | 1.0% |
| 40–59 歳 | `mortalityRateMiddle` | 0.003 | 3.5% |
| 60–69 歳 | `mortalityRateSenior` | 0.01 | 11.4% |
| 70 歳以上 | `mortalityRateElder` | 0.03 | 30.5% |

期待生存率は 出生→15 歳 ≈ 73% / →40 歳 ≈ 57% / →60 歳 ≈ 28% / →70 歳 ≈ 8%。旧実装（v0.45 以前）は 0–39 歳一律 0.4%/回のハードコードで、出生→40 歳の生存率が 14.6% しかなく夭折がデフォルトだった。幼児死亡率は高いまま残し、小児〜壮年を下げて「生き延びた者は壮年に届く」分布にしている。

**天才の死亡率補正（v0.45.1）**: `geniusType` を持つ人物は判定率に `geniusMortalityMultiplier`（default 0.5、1 で無効）を乗じる。天才の夭折（15 歳未満死）は U 字化との複合で約 15%（通常人物は約 26%）となり、「稀に起こる物語」として残る。

**在野人物も自然死する（v0.45.1）**: 旧実装は `houseId` を持たない人物を死亡判定から除外しており、在野人物は刈り込み（§6.18）以外で死なない実質不死だった。v0.45.1 から在野人物も同じ率で自然死する（死亡ロール自体は旧実装でも消費されていたため、RNG 消費数は不変）。在野の死では house/polity leader 判定は常に false、死亡イベントの entityRefs に house は含まれない。

死亡が確定した Person について `markPersonDead` mutation を呼び、以下を一括で処理する：

1. `person.alive = false`
2. `clearSpouse` で配偶者側の `spouseId` も解除
3. `revokeOfficesByHolder` で当人が保有する全 OfficeAssignment を inactive 化
4. 所属 House の `memberIds` から除外し `deceasedMemberIds` に移動

家長（house:leader）が死亡した場合の後継選出は SuccessionSystem（§6.11）が担当する。

死亡者の `wealth` 分配は直後の EstateSettlementSystem（§6.8）が処理する。MortalitySystem は死者を `TickContext.deathsThisTick` に追記し、`wasHouseLeader` / `wasPolityLeader` の役職情報を `TickContext.deathRolesThisTick` に保存して estate 処理に引き継ぐ（mortalitySystem 内で role を取得しないと markPersonDead が office を revoke するため後段では復元できない）。

### 6.8 EstateSettlementSystem（4週ごと）

`MortalitySystem` 直後・`SuccessionSystem` 前に実行。`deathsThisTick` に含まれる死亡者で `wealth > 0` の者について、家中 Share に応じた家回収率で家・相続人に wealth を分配する。

**家回収率**:
```
share = getPersonHouseSharePercent(state, houseId, personId) / 100
houseRecoveryRate = clamp(
  estateBaseRecoveryRate - estateShareEffectStrength * share,
  estateRecoveryRateMin,
  estateRecoveryRateMax,
)
toHouse = floor(wealth * houseRecoveryRate)
toHeirsPool = wealth - toHouse
```

* 家中 Share が高い人物ほど家回収率が下がる（子に多く残せる）
* 家に所属していない人物は houseRecoveryRate = 0 で全額相続人へ

**相続人決定（`findHeirs`）**: 最初にマッチした集合で確定:
1. 嫡出子のうち alive な者 全員
2. 配偶者（alive）
3. 同 fatherId の兄弟姉妹（alive / 同 house、嫡出非嫡出を問わない）
4. 家長（自分自身が家長だった場合は除外）
5. なし → wealth は全額家に回収（家もなければ消滅）

相続人は age 降順 + id 昇順 でソート（決定論性保持）。端数は最年長相続人 `heirs[0]` に寄せる。

**Mutation API**: `addPersonWealth`, `clearPersonWealth`, `addHouseWealth`（§12.2 参照）。

**イベント**:
* `ESTATE_SETTLED` は対象人物ごとに必ず発火
* 加えて、嫡出子 2 人以上または兄弟相続で 2 人以上の場合は `ESTATE_DISPUTED` を ESTATE_SETTLED と並んで追加発火（記録のみ、後続処理なし）
* importance: 故人が polity leader だった場合 `major`、家長または `wealth ≥ house.wealth * estateSettledNormalWealthRatio` の場合 `normal`、それ以外 `minor`

`deathsThisTick` と `deathRolesThisTick` は次 tick の `advanceTime` で空にリセットされる。

### 6.9 MarriageSystem（4週ごと）

`marriageEnabled` が true のとき動作。未婚の男性候補を一覧し、それぞれに対して婚姻判定を行う。

- **候補条件（男性）**: 生存・未婚・対象年齢（`marriageMaleMinAge`〜`marriageMaleMaxAge`）・normal（placeholder 除外）。houseId がある場合は所属家が active であること。houseId がなくても候補に含める
- **候補条件（女性）**: 生存・未婚・対象年齢（`marriageFemaleMinAge`〜`marriageFemaleMaxAge`）・normal（placeholder 除外）。houseId がある場合は所属家が active であること。houseId がなくても候補に含める。**所属 House の house:leader である女性は候補から除外する**（家を出て他家に移ると当主不在になるため）
- **禁止組み合わせ**: 同一家・近親関係（`isForbiddenMarriagePair` によるチェック）。**無家×無家は婚姻不可**
- **同 Polity 婚ボーナス**: `getPersonPrimaryPolityId` で primary Polity を取得し、男女で一致なら `samePrimaryPolityMarriageBonus`（+0.08）を加算

婚姻成立時の処理：
- 男女とも House 所属: 女性が男性の家に `movePersonToHouse` で移動（既存ルール）
- 片方が無家: 無家側が有家側の House に `movePersonToHouse` で移動
- `spouseId` を双方向に設定（`setSpouse`）
- `house.memberIds` に移動者を追加

イベント: `MARRIAGE_FORMED`（importance: `normal`）

### 6.10 BirthSystem（4週ごと）

`birthEnabled` が true のとき動作。対象年齢（`fatherMinChildAge`〜`fatherMaxChildAge`）の生存男性を走査し、出生判定を行う。**`houseId` がない人物は出生対象外**。家を持たない在野人物が子を残すには、まず家系を創設する必要がある。

**出生確率補正（v0.45.1 で baseline 比例化 + 上限ダンパー追加）**:

人口閾値は `WorldState.worldgenLivingPersonsBaseline`（worldgen 完了時の生存人口。placeholder 除く）に係数を掛けて算出する。旧実装の絶対値閾値（target 180 / critical 90）は tiny preset の初期人口 ~92 の ×2 / ×1 を偶然ハードコードしたものでマップ規模（preset）に追従しない欠陥があった。

```
baseline = state.worldgenLivingPersonsBaseline（未設定なら倍率制御無効 = 常に 1.0）
livingCount <= baseline × criticalLivingPersonsFactor (1.0) → criticalPopulationBirthMultiplier (3.0)
livingCount <  baseline × targetLivingPersonsFactor (2.0)   → lowPopulationBirthMultiplier (1.5)
livingCount >= baseline × highLivingPersonsFactor (3.0)     → highPopulationBirthMultiplier (0.5)
それ以外                                                      → 1.0
birthChance = baseBirthChancePerMalePerYear * birthMultiplier
```

high 帯（上限ダンパー）は v0.45.1 の死亡率 U 字化（§6.7）で純再生産率が 1 を超え人口が無限増殖したため新設した。出生以外にも houseFounding の配偶者・子サンプリングや在野補充（§6.18）という人口流入があるため平衡が押し上がる。v0.45.4 で `highLivingPersonsFactor` を 3.0 → **4.0** に引き上げ（人口を増やす要望。×1.0 帯を広げる正方向のレバー）、出生性比の男性多め化（後述）と合わせて平衡は baseline ×5.5〜7 程度（tiny 300 年実測で ~510-630 に安定）。**人口をさらに増減したい場合の主レバーはこの `highLivingPersonsFactor` の単独調整**（出生性比から独立）。

**母親の決定**:
- 配偶者が対象年齢（`motherMinChildAge`〜`motherMaxChildAge`）の場合、`spouseMotherChance`（0.9）で嫡出子
- それ以外は非嫡出子（`illegitimate`）として処理

**性別の決定（v0.45.4 で config 化・男性多め化）**:
- 成人男性が全人口の `adultMaleShortageThreshold`（**0.4**）未満の場合: `maleBirthChanceWhenAdultMaleShortage`（**0.85**）
- それ以外: `maleBirthChance`（**0.75** = 男:女 ≈ 3:1）
- 出生は **per-male**（生存男性ごとに判定）なので、男性多め化で出生数は減らない（人口は上記ダンパーが自己調整）。性別役職適格ゲート（§6.19）で可視化された男性人材不足への人口側の対応
- `adultMaleShortageThreshold` を **0** にするとコントローラ無効。これと `maleBirthChance` を下げる＋`femaleRoleEligibilityChance: 1`＋`allowFemaleRolesWhenNoMaleCandidate: true` を組み合わせると「女性多め＋女性の役職制限なし」のプレイが可能（§9 のレシピ参照）。コントローラを残したまま `maleBirthChance` だけ下げても、不足判定が発動して男性比を引き戻し続けるため 0 化が必要
- worldgen の初期人物性比も `maleBirthChance` を参照（§7）。ただし worldgen は defaultConfig 直参照のため `--config` では変わらず、runtime 出生で徐々に drift する

**天才ロール（v0.45）**: aptitude 確定（`inheritAptitudes` / `sampleAptitudes`）直後に `rollGeniusType` を実行。出現した場合は `applyGeniusAptitudes` で対応能力の天賦を引き上げてから `birthChild` に渡す（詳細 §6.67）。

誕生した子：
- `houseId` は父親と同じ
- `fatherId` / `motherId` を設定（嫡出の場合）
- 父・母の `childIds` に追加
- `house.memberIds` に追加

イベント: `CHILD_BORN`（importance: `minor`）。天才の場合は続けて `PERSON_GENIUS_BORN`（importance: `major` — メインログに流す）を emit

### 6.11 SuccessionSystem（4週ごと）

家長（house:leader の OfficeAssignment ホルダー）が死亡または存在しない場合、生存メンバーから新家長を選出。

**後継者選出（成人候補あり）**:
- `getAdultSuccessionCandidates` で成人（age >= `adultAge`）かつ生存の家メンバーを列挙
- スコアが最高の候補を後継者に選ぶ
- スコア 1 位と 2 位の差が `successionCrisisScoreGap` 以下（接戦）の場合、`SUCCESSION_CRISIS` イベントを発火
- 継承後に `maybeSplitHouseAfterSuccession` を呼び出す（§6.12 参照）

**後継者選出（未成年のみ）**:
- 最年長の未成年を仮の家長に任命
- 未成年当主ペナルティ（§6.14 参照）が以後 4 週ごとに適用される

**後継者なし**: `extinctHouseAfterFailedSuccession`（§6.15 参照）を呼び出す。

家長交代は `house:leader` の OfficeAssignment を新設し、旧ホルダーの assignment を inactive にすることで記録する。`HOUSE_LEADER_CHANGED` イベントを発火する。新家長が active な代官（HoldingOfficeAssignment）を保持していた場合、自動的に vacate して placeholder に置換する。

**Polity ruler succession**: 同 system 内で active Polity に polity:leader Office が無い場合、`getPolityHouseIds` のうち ownerHouse もしくは primaryPolity 一致の active House を候補とし、controlled Province 数が最大の House の leader を polity:leader に立てる（ownerHouse は常に候補に含まれるが、必ずしも ownerHouse leader が立つわけではない）。`polity.kind === 'commonwealth'` の場合は skip し、rebel founder 死亡後も leader 空席のまま polity を存続させる（commonwealth は rebel founder 個人を象徴とする一代政体として扱う）。

**年末 re-pass**: 本 system は週次スケジュール上では他の多くの system より前 (mortalitySystem の直後) に走るが、後続の death-causing system（戦争・処刑等）が year-end tick で house:leader を殺すと、その tick では succession が走り終えており House が leaderless のまま年末 integrity check（§6.35 ルール 17）に到達してしまう。通常は翌年 week 1 の succession で自己修復する一過性状態だが、leaderless detector がこれを違反として throw する。これを防ぐため、**`tick.ts` は year-end (week = WEEKS_PER_YEAR) の integrity check 直前に `runSuccessionSystem` を再実行する**。leaderless な House/Polity が無い通常時は no-op（RNG 消費なし）であり、これにより「active 通常 House は年末時点で必ず house:leader を持つ」invariant が構造的に保証される。再実行は通常の succession と同じく、後継者がいれば新家長を任命し、**後継者不在なら `extinctHouseAfterFailedSuccession` で House を断絶させる**（leaderless のまま年末に残さない）。

### 6.11a realEstateOwnerSuccessionSystem（4週ごと、v0.52）

不動産（RealEstateAsset）の owner 参照整合性維持と簡易相続。estateSettlementSystem（§6.8）/ successionSystem（§6.11）の後に実行。

- owner が Person: 死亡/不在 → `person.houseId` の active House に fallback → なければ `undefined`
- owner が House: 非 active → `undefined`
- owner が Polity: 非 active → `undefined`

変更がある場合のみ `realEstateAssets` / `realEstateAssetIndex`（byHolding / byOwner）を clone し `changeRealEstateAssetOwnerMut` で書き換え。deterministic（RNG 不要）。

### 6.12 HouseSplitSystem（SuccessionSystem から呼び出し）

継承が発生した際に、分裂条件を満たせば家の分裂を実行する。実体の状態書き換えは `splitHouse` mutation（`worldStructureMutations.ts`）に集約されている。

**分裂条件（AND）**:
1. `houseSplitEnabled: true`
2. `getHouseControlledProvinceIds(state, houseId).length >= minProvincesForHouseSplit`（デフォルト 3）
3. `splitCandidates.length >= 1`（後継者以外の成人候補が存在する）
4. `getHouseCohesion(house) < houseSplitCohesionThreshold`（デフォルト 60）

**splitter（分家 founder）候補の制約**:
- 当主（succession path では新当主 successor）を候補から除外する。
- さらに **継承順位上位 `houseSplitExcludeTopSuccessionRanks` 人（default 1）を除外**する。跡継ぎ（次期当主の最有力候補）が自ら分家を興すのは不自然なため。`getAdultSuccessionCandidates` の血統スコアは「house 内の死亡メンバー」基準で算出されるため、当主が生存している evaluation path（§6.13）では継承順位順にならない。そこで現当主（succession path では新当主）を基準に `getTopHeirIds(candidates, head, count, …)` で継承順位を再計算し、上位 `count` 人を除外する（候補プールは `getAdultSuccessionCandidates` と同一に保ち、sex gate の不一致で「除外したい跡継ぎが splitter プールに居ない」ズレを防ぐ）。
- evaluation path（§6.13）では加えて splitter を `young_adulthood` 以降に限る（§6.25）。

**分裂確率**:
```
currentCohesion = getHouseCohesion(house)   // Attitude から動的計算（§4.5 参照）
splitChance = baseHouseSplitChance
            + splitter.ambition        * houseSplitAmbitionFactor
            + splitter.legacyPrestige  * houseSplitPrestigeFactor
            + (getRoleScore(state, splitter.id, 'warCommand') / 10) * houseSplitMartialFactor
            - currentCohesion          * houseSplitCohesionFactor
```

分裂実行時の処理：
- 新 House を生成（`id: h-{parentId}-{year}`）
- 分裂者・その配偶者・子を新 House の `memberIds` に設定
- Province の一部（`houseSplitControlMin`〜`houseSplitControlMax` の割合）を新 House に移管
- 元 House の `cadetHouseIds` に追加、新 House の `parentHouseId` を設定
- 国の `houseIds` に新 House を追加

イベント: `HOUSE_SPLIT`（importance: `major`）+ `CADET_HOUSE_FOUNDED`（importance: `major`）+ `SUCCESSION_CRISIS`（importance: `major`、`fromSuccession` 時のみ）

**Share / cooldown 処理**:
- 分家に `creationKind: 'cadet_branch'` と `creationReason` (`'succession'` or `'house_split'`) を設定
- `initializeHouseShares` で新 House の HouseShare を即時初期化
- 移動元 House の古い Share を `removePersonSharesInHouse` で整理
- 両 House に `lastSplitWeek = absoluteWeek` を設定（cooldown 用）
- `houseSplitCooldownWeeks`（default 48）以内の再分裂を防止

### 6.13 HouseSplitEvaluationSystem（config 依存の周期）

巨大 House を定期評価して分家を生む scheduled system。`houseSplitEvaluationIntervalWeeks`（default 12）ごとに実行。

**条件**:
1. `houseSplitEnabled: true`
2. `house.kind !== 'system'`
3. cooldown 中でないこと（`lastSplitWeek + houseSplitCooldownWeeks > absoluteWeek` なら skip）
4. `livingMemberCount >= houseSplitMinLivingMembers`
5. `house.wealth >= houseSplitMinWealth`
6. `house.legacyPrestige >= houseSplitMinLegacyPrestige`
7. `getHouseControlledProvinceIds >= minProvincesForHouseSplit`
8. `getHouseCohesion < houseSplitCohesionThreshold`

候補選出は `getAdultSuccessionCandidates` → leader 除外 → 継承順位上位除外 + `young_adulthood` ゲート（§6.12「splitter 候補の制約」参照）→ `chooseSplitter`。

**succession path との違い**: evaluation path では `SUCCESSION_CRISIS` event を発火しない。`creationReason` は `'house_split'`

**cohesion（結束度）について**:
- `house.cohesion` フィールドは存在しない。`getHouseCohesion` セレクターで動的計算（§4.5 参照）
- 結束度は家メンバーの家長への attitude から計算されるため、態度変化イベントにより自然に変動する

### 6.14 未成年当主ペナルティ（SuccessionSystem 内）

当主が未成年（age < `adultAge`）の間、4 週ごとに適用。格納フィールドの直接変更ではなく、Attitude の調整を通じて cohesion・loyaltyToPolity に間接影響を与える（実装上は `minorHeadCohesionPenaltyPerMonth` / `minorHeadLoyaltyPenaltyPerMonth` の config 値が参照される）。

**配線**: ロジックは `successionSystem.ts` の `applyMinorHeadPenalties` に存在し、`successionSystem` の直後に専用 system `minorHeadPenaltySystem`（`intervalWeeks: 4`）として配線される。年末 succession re-pass（§6.11）は `runSuccessionSystem` のみを再実行するため、ペナルティを `runSuccessionSystem` 内に置かず独立 system にすることで week 48 での二重適用を回避している。

### 6.15 HouseExtinctionSystem（SuccessionSystem から呼び出し）

後継者が存在しない家（生存メンバーが 0 または全員未成年かつ成人後継者なし）に対して断絶処理を行う。実体の状態書き換えは `extinctHouse` mutation（`worldStructureMutations.ts`）に集約されている。

**House active 判定**: House active は memberIds（血統）ベースで判定され、土地を完全に失っても active=true のまま「無領家」として存続する（`house.provinceIds.length === 0` では断絶しない）。お家再興 / 復古試行は将来の Faction 段階で動的に発生する想定で、現状はデータ上の存続のみ許す。

**affectedPolityIds スナップショット**:

```ts
type HouseExtinctionInput = {
  houseId: HouseId
  affectedPolityIds: PolityId[]  // 喪失前の getHousePolityIds スナップショット
}
```

呼び出し側で所領喪失前の Polity 集合を取得しておき、メンバー移住先選定のスコープとして使う。

**継承先 House の選定**:

選定アルゴリズム `chooseReceiverHouse(state, extinctHouseId, scopePolityIds, excludeHouseIds?)`。
**Polity 単位**で呼び出す（後述の分割継承）。`excludeHouseIds` に含まれる House は
全 stage からハード除外する。

1. `scopePolityIds` 内で最大 controlled Province 数を持つ active 通常 House (system house 除外)
2. `scopePolityIds` 内で最大 Polity Share を持つ active 通常 House
3. 旧 `seatProvinceId` に隣接する Province の effective ownerHouse
4. 世界全体で最大 controlled Province 数を持つ active 通常 House (system house 除外)。
   count=0 の tie-break が House の挿入順に依存しないよう houseId 昇順で安定走査する
5. 見つからない場合、メンバーは inactive のまま House 解散

**Polity 継承（分割継承、two-phase decide → apply）**:

断絶家が ownerHouse である Polity は **Polity 単位で個別に**継承先を選ぶ。これにより、
「領土数が最大の House が空いた Polity 群を丸ごと総取りする」rich-get-richer ラチェット
（複数世代で全 Polity が単一 House に集中する退化）を防ぐ。

- **Phase 1 (decide)**: 断絶**前**の凍結 state に対し、断絶家が ownerHouse である各 Polity の継承先を
  独立に選ぶ。
  - **分家優先継承**: 断絶家に active な分家（`cadetHouseIds`）があれば、それを最優先で継承先にする。
    分家が無ければ active な親家（`parentHouseId`）。kin（分家群、無ければ親家）リストは凍結 state から
    1 回だけ算出し、各 Polity を `i % kin.length` の巡回で割り当てる:
    - 分家が 1 家 → 全 Polity をその分家が継ぐ（王朝が唯一の分家として存続）
    - 分家が複数 → 巡回で複数分家に分散（下記 rich-get-richer 防止と両立）
    kin 経路は同一王朝内での集約であり、「無関係な House のグローバル rich-get-richer」とは別物。
  - **kin が居ない場合**は従来どおり `chooseReceiverHouse` で選定し、各選定で `usedReceivers`
    （この断絶で既に他 Polity を割り当てた House 集合）をハード除外して別々の House へ分配する。
    除外で候補が尽きた場合のみ緩和して重複継承を許容する。
  - 逐次に owner を書き換えながら選定すると、先に継いだ House が controlled Province 最大になり
    stage 4 で残りも総取りするため、評価は必ず凍結 state に対して行う。
- **Phase 2 (apply)**: 各 Polity を Phase 1 の割当先へ継承させる（王朝交代）:
  - `Polity.ownerHouseId = receiver.id`
  - `polityIndex.byOwnerHouse` 同期更新
  - `polity:leader` Office を receiver House の leader に差し替え
  - `POLITY_OWNER_CHANGED` event を Polity ごとに発火
- LandContracts は変更しない（Polity と Province の関係は不変、王朝のみ交代）
- 生存メンバーは `moveLivingMembersToHouse` で **主継承先**（先頭 Polity の継承先。Polity を持たない
  断絶は従来スコープ `affectedPolityIds` で 1 House を選定）へ移動する（narrative のみ。土地は Polity
  単位で個別に動く）
- **財産（wealth）継承**: 断絶家の `wealth` を Polity 継承先へ按分する。継承先（`polityReceivers`）を
  normative source とし、受領 Polity 数で比例配分する（端数は主継承先へ）。分家優先で分家が receiver に
  なっていれば wealth も自動的に分家へ流れる。Polity を持たない没落（`polityReceivers` 空で継承先が
  定まらない）は据え置き（断絶家に残る）。
- 断絶家を `active: false`、`memberIds: []` に設定（wealth を継承した場合は `wealth: 0`）

**Polity の inactive 化は HouseExtinctionSystem で行わない**:
Polity の active 制御は §6.31 PolityOwnerConsistencySystem に一本化する。
これにより HouseExtinction → 所領消失 → 当月内に PolityOwnerConsistency が owner 補充または `POLITY_EXTINCT` 発火、という分離した責務になる。

イベント: `HOUSE_EXTINCT`（importance: `major`）

### 6.16 HouseFoundingSystem（config 依存の周期）

無家人物が条件を満たすと新 House を創設する system。`houseFoundingIntervalWeeks`（default 4）ごとに実行。

**候補条件**: alive / normal / `houseId === undefined` で、以下のいずれかを満たす:
- `wealth >= houseFoundingMinWealth` → reason: `'wealth'`
- `legacyPrestige >= houseFoundingMinPrestige` → reason: `'prestige'`
- active な OfficeAssignment または HoldingOfficeAssignment を保持 → reason: `'office'`
- `personActivityLogIndex` のログ数が `houseFoundingMinActivityLogs` 以上 → reason: `'prestige'`

**処理フロー**:
1. 候補を収集し、shuffle（RNG 順序保証）
2. 候補ごとに `houseFoundingMonthlyChance` で確率ロール
3. `seatProvinceId` を決定（優先順: HoldingOffice の Province → Polity Office の capitalProvince → ランダム Province）
4. 新 House を生成（`creationKind: 'self_made_foundation'`、`creationReason` は判定条件由来）
5. founder の wealth の `houseFoundingWealthTransferRate`（default 0.5）を新 House に移転
6. `legacyPrestige` を `floor(founder.legacyPrestige * 0.5)` で設定
7. founder を `house:leader` Office に任命
8. `founderFamilyGenerationEnabled` が true なら家族を後付け生成（配偶者・子供、年齢に応じた確率）
9. `initializeHouseShares` で HouseShare を即時初期化
10. `HOUSE_FOUNDED` event を発火

**1 月あたり最大** `houseFoundingMaxPerMonth` 家まで創設。

イベント: `HOUSE_FOUNDED`（importance: `major`）

### 6.17 ClanFormationSystem（config 依存の周期）

年 1 回（`clanFormationIntervalWeeks`, default 48）。2 つの処理を行う。

**Part 1: 新規 Clan 成立判定**

active / normal / clanId undefined の各 House を root candidate として以下を評価:

1. **分家数条件**: active direct cadet 数 >= `clanFormationMinDirectCadetHouses`
2. **影響力条件**: formation group に ruling house が含まれる、または `isInfluentialHouse` が `clanFormationMinInfluentialHouses` 以上
3. **量的条件**: formation group の total living members / wealth / legacyPrestige のいずれかが閾値以上

3 条件すべてを満たすと Clan を成立させる。所属範囲は formation group（direct cadet のみ）ではなく、rootHouseId から下方向の全 descendant House。すでに別の clanId を持つ descendant とその下位はスキップする。**inactive（断絶）House は Clan メンバーに含めない**：`collectMemberHouseIds` は active な House のみを memberHouseIds に積む（clanId 付与・カウント汚染を防ぐ）。ただし inactive な中間 House の配下に active な子孫がある場合に到達できるよう、traversal 自体は inactive House も貫通する。

イベント: `CLAN_FOUNDED`（importance: `major`）

**Part 2: 既存 Clan の年次保守**

- member House の cadet に clanId 未設定の normal House があれば同 Clan に追加（防御的フォールバック）
- `syncClanActive`: memberHouseIds のうち active normal House が 0 になれば `clan.active = false`

House 絶滅時の即時 `syncClanActive` は `handleNormalHouseExtinction`（`worldStructureMutations.ts`）の末尾で実行される。

### 6.18 HouselessPersonGenerationSystem（4週ごと）

無家人物を生成・維持する。config key は `houseless*`（`houselessPersonsPerHolding` / `houselessMaleRatio` / `targetHouselessPersons` / `softMaxHouselessPersons` / `hardMaxHouselessPersons` / `houselessProtectionYears`）。

無家人物は `houseId === undefined` の normal Person として `state.persons` に直接追加される。House の `memberIds` には含まれない。

**刈り込み（fading）の除外条件**: プールが softMax を超えた場合、dwell の長い低 prestige 人物から `faded_from_history` で除去する。ただし以下は除外: 保護期間内（`houselessProtectionYears`）/ prestige・wealth が閾値以上 / active office 保有 / active faction 所属 / **`geniusType` 持ち（v0.45.1 — notable 人物の無言消滅を防ぐ。自然死は §6.7 で在野にも適用されるため不死にはならない）**。

### 6.19 AppointmentSystem（12週ごと = 3ヶ月ごと）

Polity と House それぞれの役職（leader 以外の 4 種）に対して、空席を最適候補で補充する。

**対象役職**:
- Polity: administrator / treasurer / military / advisor
- House: administrator / treasurer / military / advisor
- leader は AppointmentSystem が直接補充しない（SuccessionSystem が担当）

**候補スコア（Polity 役職）**:
```ts
score = relevantStat(role) * 1.0          // military → warCommand、他 → governance（派生 selector）
      + (prestige / 100) * 8              // getPersonPrestige
      + leaderRespect * 4                 // polity leader の attitude.respect（0..1 正規化）
      + polityAffection * 3               // 候補者の対 Polity attitude.affection
      + (houseInfluencePct + personInfluencePct) * polityInfluenceAppointmentFactor  // 候補者の家＋本人の Polity Influence%（§6.64、既定 0.25。v0.42: 旧 share%。personInfluencePct は影響力個人中心化 §6.64a-(9) で追加）
      + personSharePct * houseShareAppointmentFactor  // 候補者個人の House Share 割合（既定 0.08）
      + ownerHouseBonus                   // 候補者の家が polity.ownerHouseId なら ownerHouseAppointmentBonus（既定 4）
      + appointmentRightBonus             // v0.42: 対象 role に polity_office_appointment right がある場合の補正（下記）
      - getOfficeCompatibilityPenalty(...)  // 兼任互換ペナルティ。compatible-pair の軽減入力も influence%（v0.42）
      - sameHousePolityOfficePenalty * (1 - houseInfluencePct / 100) * sameHousePolityOfficeCount  // 同 House の Polity Office 数を influence 重みで減点
      - oldAgeAppointmentScorePenalty      // old_age なら固定減算（§6.25）
```

**候補者条件**: alive かつ `young_adulthood` 以降 / active House 所属 / 同 role を未保有 / 以下のいずれか:
1. その House が対象 Polity 内に Province を所有する
2. その House が対象 Polity の `ownerHouseId` である（owner が一時的に Province を失っていても候補に残す）

また、active な HoldingOffice (Bailiff) を保有する人物は Polity / House / factional の各候補プールから除外する。候補収集は 'traditional' 候補に加え faction が推す 'factional' 候補も含む。

**性別役職適格ゲート (v0.45.3)**: 時代背景（古代〜近世）上、女性の役職持ちは「非常に稀」とする。女性は `isRoleEligibleBySex`（`selectors/roleEligibilitySelectors.ts`）を通過した者のみ候補プールに入る:
- 女性ごとに personId の決定論 hash（`hashSeedToUint32`、salt 付き）で一度だけ適格性が決まる。適格率は `femaleRoleEligibilityChance`（既定 0.03）。RNG state を使わないため pure selector（総大将/指揮官の lazy refresh）からも安全に呼べ、tick 間で値が揺れない
- 適格な女性は男性と**同一の実力競争**に乗る（稀さと実力突破を分離 — 例外的な「女武将・女傑」は実力で登場できる）
- **適用先**: 本 system（polity/house office、gated 評価は right → factional → traditional の cascade 全体に適用）/ BailiffAppointmentSystem（§6.22）/ WarManeuverSystem の総大将 military 経路・指揮官候補プール（§6.45）/ FactionLifecycleSystem の首領継承・結成 founder・**結成時の初期メンバー選定**（v0.45.6）/ **FactionRecruitmentSystem の年次募集候補プール**（v0.45.6）/ `selectProjectSupervisor`（§6.38・§6.58）/ worldgen 初期 polity office（§7）
- **派閥構成員にも適用する理由 (v0.45.6)**: 派閥は任官を得るためのネットワークであり、任官が男性中心（上記）なのに派閥加入が男女無差別だと女性が派閥に滞留して仕組みが噛み合わない。founder と同じく **ungated 再試行はしない**（加入は欠員補充でなく裁量行為）。同一 hash 述語を使うため「派閥に入れる女性＝任官にも乗れる女性」となり任官パイプラインと整合する。女性のネットワーク表現は将来「サロン」（人脈形成・文化活動・消費）で別途扱う予定。実測（100 年 × seed 42）: active 派閥メンバー女性比 25.4%（106M/36F）→ 0%（148M/0F）
- **対象外（女当主・女王の例外は構造で実現）**: 当主・君主の継承（SuccessionSystem の既存男子優先ロジックが司る — 男子不在時は `allowFemaleHouseHeadWhenNoMaleHeir` で女性が継ぐ）/ 総大将の leader fallback（女王の親征を許容 — §6.45）/ delegate（役職保持者・leader 由来で自動派生）/ project creator（提案者であり地位ではない）/ creator 自身が自 project の supervisor に倒れる経路。**現職 leader への helper 内免除は置かない** — 入れると「女当主が将軍職も兼ねる」漏れが起き、実測で女性 office holder の主因だった
- **fallback**: gated 候補が空振りした場合、`allowFemaleRolesWhenNoMaleCandidate`（v0.7 で宣言・v0.45.3 で初配線、**既定 false**）が true なら ungated 再試行を 1 回だけ行う。再試行は per-path でなく **cascade 全体が空になった後に 1 箇所**（per-path だと「traditional に適格男性が残っているのに factional の不適格女性を着座」が起きる）。既定 false の理由: 男性プールの局所払底（小家系・成人男性 ≈ 1 人/席）が常態のため、true だと fallback が支配経路になり「非常に稀」が成立しない（実測: 代官の女性比 ~30% が fallback 由来）
- 実測効果（150 年 × seed 1/42、累積 distinct）: 非 leader office 女性 143/99 → 5/3、代官 138/138 → 4/7、現場指揮官 125/162 → 6/7、派閥首領 163/193 → 5/6。女性総大将は「女王の親征 13 + hash 適格 2」のみ（ゲート漏れ 0）。女当主・女王（leader office）は不変

**polity_office_appointment right の接続 (v0.42)**: 充足対象 slot（下記「任命判定」）に active な `polity_office_appointment` right（§6.64 — v0.42 slot 化で right は (polity, role, slot) 単位）がある場合:
- **unrelated factional path は使わない**（任命権は制度的権利として派閥推薦より優先）。ただし **right-backed faction（下記）の active member は候補 pool に加える**（v0.49）— 任命権は「無関係な派閥」を排除するが「保持者自身の派閥」は排除せず優先する、という設計。これにより保持者の派閥に属する人材は landless でも right-gated 役職に届く（従来は factional path 丸ごと skip で、`rightBackedFactionBonus` が「pool に居ない人物」へ計算されるだけの死に挙動だった抜け穴を塞ぐ）
- right holder の候補を pool に追加する（traditional pool 外の House member / Person 本人も対象）
- スコア補正: holder House の member に `polityOfficeAppointmentRightHouseBonus`（既定 30 — influence% 項の最大値を上回る水準。それでも能力差で覆りうる）、holder Person 本人に `polityOfficeAppointmentRightPersonBonus`（35）、その家の member に同 AssociatedBonus（18）
- **right-backed faction（最大 1 つ）**: right holder と最も関係の強い anchor Faction を 5 段階（holder Person の所属 → holder House leader の所属 → member 最多 → faction leader が holder House 所属 → factionId 昇順）で 1 つ選定し、**その active member（adult・非 placeholder・active HoldingOffice 非保有）を候補 pool に追加**（v0.49）したうえで `rightBackedFactionBonus`（10 < HouseBonus）を加算。NP 閾値は不問（access は任命権由来であって NP ではない）。pool 追加は `getFactionActiveMemberIds` のソート順で決定的に行い run-to-run 決定性（同 seed → 同結果）を保つ（本変更自体は任命結果を変えるので変更前と bit-identical ではない）

**House factional path の廃止 (v0.42)**: House office 任命への factional path は廃止（Faction は Polity 内政治装置 — §6.31 anchor 参照）。House office は traditional スコアリングのみ。また faction opportunity（member cap 原資）から House office slot を除外し、polity slot の share% 参照は influence% に置換。

**member cap の再設計 (派閥拡大 WI-1)**: `getFactionMemberCap` は旧来 `max(minimumFactionMembers, floor(officeSlots))` だったが、これは floor マスクで事実上の定数 2 に潰れ、`initialFactionMemberMax`（3）> cap（2）のため募集が初手 no-op になり集積力（派閥が大きくなる力）が死んでいた。新式は patron（leader）が配れる「席」と才能を加算する:
```
cap = clamp(
  minimumFactionMembers + floor(officeSlots) + appointmentSeats + meritSeats,
  minimumFactionMembers, factionHardCap)
```
- `officeSlots` = `computeAvailableOfficeSlots(leader.houseId)`（house-wide。従来どおり influence% 加重 polity slot）
- `appointmentSeats` = leader 個人 ∪ leader 家が保有する `polity_office_role` / `holding_office_role` の任命権の数（patron が任命で配れる席。`regiment_control` は人材庇護と無関係なので除外）
- `meritSeats` = `floor(max(0, getBestRoleScore(leader) − factionCapMeritFloor) / factionCapMeritDivisor)`（才能ある patron ほど多く抱える。role-score は 0–120、典型 30–60）
- `factionHardCap`（7）で上限クランプ（§3 anti-snowball: 一人の patron が無限に人材を独占しない）

実測（tiny 100年, seed 1/42）: cap 平均が 2 固定 → 4.25/5.00、member 平均 2 → 3.4、最大 7。旧来「全派閥が cap 律速で member=2」だった状態から、cap に余裕が生まれ「供給律速（member<cap）」の派閥が出現する＝集積の天井が機能し始めた。空いた容量は WI-0（引力勾配）/ WI-2（募集拡大）が埋める。

**募集の引力勾配 (派閥拡大 WI-0)**: FactionRecruitmentSystem に「優秀な patron がより強く人材を引く / 各 picker が才能を評価する」を明示 merit 項で注入する。cap（WI-1）を上げても、募集スコアが attitude 支配で faction-id 先着消費だと「権力者が友人を集める」一様膨張になり、北極星（優秀な個人に集中）が創発しないため。
- **(a) talent 比重**: `computeRecruitmentScore` の `getBestRoleScore(candidate)` 係数を 0.3 固定 → `recruitmentTalentWeight`（既定 1.0）。見知らぬ相手では attitude≈0 で才能が効くが、既知相手では attitude（affection×1.5 等）が才能を swamp していた。引上げで各 picker が才能を評価する。
- **(b) 引力順序**: `runFactionRecruitmentSystem` の faction 処理順を faction-id（≒設立順）先着 → **patron attractiveness 降順**に。shared base pool は先着消費（二重所属は §4.4 invariant が弾く）なので、強く優秀で prestige の高い patron が才能 pool から先に選ぶ。`attractiveness = w_power·(patronPower/10) + w_merit·(leaderBestRoleScore/100) + w_prestige·(leaderPrestige/100)`（0–1 正規化後に重み付け、tiebreak は faction-id 昇順）。`patronPower` = `getFactionLeaderPatronPower` = officeSlots + appointmentSeats（meritSeats は含まない）。M1≈0（power は才能の代理でない）ゆえ **meritWeight を最大（2.0）** にして merit を load-bearing にする。順序はループ前に 1 回 snapshot（patronPower/merit は recruit 中に動かない）。**RNG 非消費**なので並べ替えは他 system の RNG ストリームを壊さない（非 bit-identical だが決定的）。
- **wealth は順序に混ぜない**: `recruitForFaction` は `leader.wealth < cost` で break。wealth を attractiveness に入れず**意図的 friction として残す**（貧しい patron は強くても sponsor しきれない自然な天井。集積が wealth 追従になるのを避ける）。
- **(c) candidate-centric assignment**（才能人材が魅力的な patron を選ぶ）は ripple 大のため後段保留。

検証（diag [7][8]・A/B vs baseline）: 集積 engine の成否は **corr(faction size, leader 才能)** の符号と **M2（所属 vs 非所属 eligible pool の才能差）**で測る（corr(patronPower,才能) ではない — power は富/血筋の代理で才能と無相関のままが正常）。才能ある leader ほど cap が大きく（meritSeats）募集も先頭（attractiveness）なので大派閥になり、各 picker が才能順に skim する。

**帰属（単独 A/B で WI-1 と WI-0 を分離した結果）**: 集積 engine の主役は **WI-1（cap 式の meritSeats）** であり、WI-0 の限界寄与は小さい。
- corr(size,score)（tiny 100年 seed1/42/123）: main −0.28/+0.12/−0.58 → **WI-1 のみ +0.26/+0.08/−0.10** → HEAD（+WI-0）+0.27/+0.20/+0.54。WI-1 で既にほぼ正転し、WI-0 は seed42/123（特に 123 の −0.10→+0.54）を sharpen する。
- M2 gap（standard 40年 seed1、pool 生存）: main 所属−pool ≈ **−0.1**（才能選別ゼロ）→ **WI-1 のみ +4.5** → HEAD（+WI-0）**+4.9**。M2 の大半も WI-1 由来（大 cap × 既存の talent 比重 0.3 で skim）で、WI-0（比重 1.0 + attractiveness 順）の上乗せは +0.4。
- tiny/small では WI-1 で cap が増え募集が eligible pool を吸い切るため pool 枯渇（n=0）で M2 測定不能 = 集積が供給を吸収している裏返し（SR-3）。M2 は pool が残る standard で測る。

WI-0 を残す理由（測定上は小さくとも構造的に必要）: attractiveness 順序は **供給が逼迫した時** に「強い patron が先に選ぶ」を保証する装置で、pool に余裕のある定常 snapshot では効果が小さく見える。WI-2（募集拡大）/ WI-3（崩壊で pool が churn）後に効きが増す前提。**バランス方針（§機能完成後にまとめて調整）に従い、WI-0 の weight sweep は今は行わない**（測定従属の定数より式の形を優先）。

**無役待機トラッカーと housed 募集 (派閥拡大 WI-2)**: 従来の募集 base pool は houseless または landless（無領家のメンバー）のみ。これに **家持ち・有領だが無役で長く待機している成人** を野望連動で解禁し、「家の中で役に就けず燻る人材が他家の派閥に流れる」流動を作る。`Person.idleSinceWeek?`（optional）に「成人で active office を失った／持たない週」を記録する。
- **lazy sweep**: 設計の「office assign/revoke の mutation サイトで set/clear」案ではなく、`runFactionRecruitmentSystem` が既に 12 週ごとに行う `livingPersonIds` 全走査の 1 パスに idle 追跡を畳み込む（`maintainIdleAndBuildPool`）。無役で clock 未設定なら `idleSinceWeek = absoluteWeek` を set、有役なら clear。never-employed（一度も着任しない housed 成人）も自然に clock 開始でき、revoke が 1 職ずつである「最後の 1 職を失ったか」判定を持ち込まずに済む。12 週粒度の誤差は多年閾値に対し無視できる。idleSinceWeek は変化した person のみ immutable に書き換える（mutable-draft）。
- **解禁条件**: houseless/landless は従来どおり無条件。housed+landed 無役は `idleWeeks >= thresholdYears × 48` のときのみ解禁。`thresholdYears = factionCrossHouseBaseIdleYears × (1 − factionCrossHouseAmbitionReduction × ambition)`（野望 1.0 で半減）。応募先選択は WI-0 の attractiveness 順を流用（才能人材が魅力的な patron を選ぶ）。
- 実測（tiny 100年）: 供給律速だった派閥が housed 無役の流入で cap を埋める（seed1 供給律速 15→0、seed42 17→11）。eligible pool は最終 snapshot で吸い切られ 0（集積が供給を吸収）。

**派閥の崩壊機構 (派閥拡大 WI-3)**: 集積を有限化しスノーボールを防ぐ振動の片翼。各機構を config フラグで個別 toggle 可能にし（SR-6: 崩壊 OFF の中間計測で A/B 帰属）、単独 A/B で default を確定する。

- **FactionDefectionSystem（v0.51.1 改修）**: 離脱判定の idle 起点を `joinedWeek`（加入時点）から `FactionMembership.lastActiveWeek`（最後に「仕事」を保持していた時点）に変更。「仕事」の定義は active な Office/Bailiff に加え、**国 (polity) または家 (house) が owner の active Project の supervisor** を含む（個人 Project は除外）。判定時に仕事を保持しているメンバーは `lastActiveWeek` を現在週にリセットしてスキップ。grace period は `factionDefectionGraceYears` = 1（旧: 8）。判定頻度は四半期ごと（12週間隔、旧: 年1回）に引き上げ、離脱確率は据え置き（実効的に年4倍の離脱速度）。これにより、長期無役メンバーの回転が速まり、人材の流動性が向上する。
- **崩壊1 不完全な継承 (succession scatter・`factionCollapseSuccessionEnabled` default true)**: `handleFactionLeaderVacancy` で新 leader 着座後、求心力の弱い跡継ぎに対し高野望・高才能・低忠誠の member を離散させる（pool へ戻り再結集・rival 募集の素材になる）。「先代のスター子飼いが跡継ぎを認めず独立する」。deterministic（RNG 非消費）: `scatterScore = ambition × (1 − loyaltyToNewLeader) × (0.5 + talent)`（loyalty は新 leader への attitude を 0–1 化、talent は bestRoleScore/100）が `factionSuccessionScatterThreshold`（0.35）超で離散。離散は `FACTION_MEMBER_ABANDONED` を再利用。
- **崩壊2 過伸長離脱加速 (overreach defection・`factionCollapseOverreachEnabled` default false)**: `FactionDefectionSystem` の離脱確率を `base × (1 + overreachWeight×(1−placementRatio)) × (1 + ambitionWeight×ambition)` に拡張（placementRatio = 役職を配れた member 比。低い＝過伸長）。**default OFF の理由**: 単独 A/B（固定分母＝支配 house 派閥員/成人人口、tiny 150年 seed1）で overreach 単独は 17.9%（=崩壊 OFF と同じ＝無害）だが、succession と組むと 34.4% の超加法的 entrenchment（強い patron が役職を配れて defection を免れ、弱小派閥だけが member を失う rich-get-richer）を生み北極星に逆行する。accumulation が無限化する nesting（Phase 2）後に再評価する前提で実装は残しフラグで OFF。
- **崩壊3 rival 闘争 (`factionCollapseRivalEnabled` default false)**: measure-first（SR-5）。既存の OfficeTermSystem（任期交代）・acquire_political_right が現職 patron 基盤を実際に削るか観測してから構築する方針で、現状は未構築（フラグ予約のみ）。
- **default 決定の根拠（単独 A/B・tiny 150年）**: 固定分母（支配 house 派閥員/成人人口）max = OFF 17.9% / succession のみ 23%（軽度）/ overreach のみ 17.9% / 両方 34.4%。succession は崩壊機構の主力（SR-5「先に作る」）かつ単独 entrenchment が軽微なので ON。abandonment 件数（60年 seed1）は OFF 62 → succession ON 80（+29% の dispersal 仕事）。**tiny は hardCap（WI-1）+ 自然死による継承で既に dominance が bounded（崩壊 OFF でも支配 house シェアは ~30% 上限・turnover 6 で振動）であり、WI-3 の anti-snowball としての本領は accumulation が無限化する nesting（Phase 2）後に検証する**（崩壊は分離可能な insurance・SR-6）。

**入れ子派閥（nested faction・Phase 2-a）**: 大物の庇護者が傘下の弱小派閥を束ねる木構造を導入する（集積の規模拡大・崩壊の劇化）。モデル A（`Faction.parentFactionId?`）を採用 — 子派閥のリーダーは親の member には**ならず**、派閥同士のポインタで表現するため §4.4・FactionMembership・募集ロジックを無改修で保つ。`FactionIndex.byParent`（親→子 FactionId[]）を追加。
- **形成（`formNestedFactions`・FactionLifecycle 年次）**: 低迷した弱小 root 派閥 W（NP < 閾値・存続 `factionNestingMinAgeYears` 超）が、同一 polity（case X・越境 case Y は defer）の強い root 派閥 P（NP ≥ 閾値・分岐余裕 `factionNestingMaxBranches` 未満）の傘下に入る。スコア = W リーダー → P リーダーの attitude + P の NP（強く親しい庇護者を選ぶ・RNG 非消費）。深さは `1 + subtreeDepth(W) ≤ factionNestingMaxDepth` で制限（W が既に木を持つ場合は深くなりすぎないよう attach しない）。成立で `FACTION_NESTED` を emit。
- **解散 cascade（§4.5）**: `deactivateFaction` を choke point とし、解散する派閥の子は orphan 化（`parentFactionId` 除去で root 昇格）、自身が子なら親の `byParent` から外し、`byParent[self]` を削除する。`dissolveFactionsAnchoredToPolity`（polity 消滅 cascade）は親子双方を deactivate するため、処理順に関わらず byParent が clean に保たれる。
- **integrity F9**: active faction の `parentFactionId` は active faction を指し（inactive 親は違反）、case X ゆえ親子の anchor polity は一致し、`byParent` index と双方向同期する。F9 は liveness test（inactive 親 / index desync / index 欠落で実際に error が出ることを確認）で非 vacuous を担保済み。
- **消費（Phase 2-b・親が子孫から人材と推進力を吸い上げる）**: `collectSubtreeMemberWeights(faction)` が自前 ∪ 子孫の active member を深さ重み付き（own=1.0、子孫=`factionNestingNpDiscount`^depth・BFS で `factionNestingMaxDepth` 打ち切り）で集める（§4.2-4.3）。各 person は §4.4 で 1 membership のみゆえ subtree 内に 1 度しか現れない。
  - **faction leader の self-membership（重要・前提）**: faction leader は own faction の memberIds に active な self-membership を持つ（設立時に作られ、`removeDeadMemberships` が生存 leader 分を保持、昇格新 leader も既存 membership を保つ）。よって `getFactionActiveMemberIds` は各派閥の leader を返し、**子孫派閥の leader（=副官）は `collectSubtreeMemberWeights` の member ループで既に集まり、NP / bailiff 候補プールに自然に乗る**（専用の leader 追加処理は不要）。
  - `getFactionNominationPower`: 子孫メンバー（self-membership により子孫 leader 含む）の house influence / person influence / polity office bonus を深さ割引して親 NP に加算（house dedup は own を先に見るため own-house は weight 1.0 を保つ）。root のみの非入れ子派閥では従来式と一致する。
  - `collectBailiffFactionalCandidates`: NP ≥ 閾値の親の実効候補プール = 自前 ∪ 子孫メンバー（self-membership により子孫 leader 含む）（depth で score 割引）。NP < 閾値で自立できない弱小子派閥のメンバー・leader も、強い親の傘下に入ることで親の席に届く（protégé が sub-leader の推薦を通して着座）。
  - **polity 役職の factional 経路（v0.50「副官のみ引き上げ」）**: `collectFactionalCandidates` は **親の自前メンバー（weight 1.0）しか見ず subtree を辿らない**ため、子孫派閥の leader は（self-membership があっても親の memberIds には居らず）polity 候補に入らなかった。v0.50 で `collectSubtreeLeaderWeights`（子孫 depth≥1 の leader だけ・depth で score 割引）を追加し、**自前メンバー + 子孫派閥の leader（副官）**を候補化する。子孫の **一般メンバーは polity には流入させない**（§8 の広域再帰=「傘全体を polity 役職プールに開く」は依然保留）。lift した副官は `getFactionalCandidateScore × depthWeight` で評価し、自前メンバーは weight 1.0 で従来と bit-identical。対象 role は administrator/treasurer/military/advisor のみ（leader=君主/元首席は factional 任命の対象外 — 世襲は継承、共和制は選挙 `getRepublicPoliticalCandidatePersons` で別途決まる）。NP / bailiff 側は self-membership により従来から子孫 leader を含むので、この経路の追加は polity だけ。
  - 抑制レバー = `factionNestingNpDiscount`（深さ減衰）/ `factionNestingMaxDepth` / `factionNestingMaxBranches`。最終バランスは forced harness でなく通常 config で判断（[[project_faction_unemployed_retention_structural]] の教訓）。**決定性**: v0.50 は polity factional 経路にだけ子孫 leader を追加するため、NP / bailiff は不変（`collectSubtreeMemberWeights` は無改変）。polity 候補が変わるのは入れ子派閥のみで非入れ子は bit-identical。run-to-run 決定性（同 seed → 同結果）は BFS の depth 昇順・faction-id 昇順・`getFactionActiveMemberIds` ソートで保たれる。

**候補スコア（House 役職）**:
```ts
score = relevantStat(role) * 1.0
      + (prestige / 100) * 10
      + leaderRespect * 5                // 家長の attitude.respect
      + houseAffection * 3              // 候補者の対 House attitude.affection
      + personSharePct * 0.1            // 候補者の House Share 割合
      - getOfficeCompatibilityPenalty(...)  // 兼任互換ペナルティ（§14.5）
      - oldAgeAppointmentScorePenalty      // old_age なら固定減算（§6.25）
```

**任命判定**:
- 最高スコア候補が `minAppointmentScore` 未満の場合は任命しない（空席を維持）
- **Polity 役職は slot ベースの空席判定（v0.42 slot 化）**: `getEffectiveOfficeMaxHolders` で動的
  slot 数を算出し、slot 0..effectiveMax-1 のうち**未着座の最若 slot 1 つ**を 1 回の実行で充足する
  （人数 count ベースではない — 縮小直後に「後ろの slot に着座者が残り count == max だが前の slot
  が空き」というケースがあり、count 判定だと前の空き slot が永久に埋まらない）。right の参照・
  `createOfficeAssignment` への slot 明示渡しもこの充足対象 slot に対して行う
  - Polity 役職: `polityOfficeMaxByRank[rank][role]` × province 数係数で決定。`rankCap = 0` の場合はその役職を設置不可（例: rank 4 伯領は administrator のみ）
    - **commonwealth 例外**: `polity.kind === 'commonwealth'` の場合は専用テーブル `polityOfficeMaxByRankCommonwealth[rank][role]` を用い、**全 role を rank に依らず解放（>=1）**、**province 数係数は適用しない**（政体の格 = rank が席数を決める）。理由: commonwealth の権力闘争は役職争奪で駆動されるが、通常テーブル + province 係数では rank 5（≈1 province）の commonwealth で administrator/treasurer が hard cap 3 × 0.4 で必ず 1 に潰れ、争奪対象が宰相 1 席のみになって権力闘争が成立しない。titular の場合は commonwealth でも leader 以外 0（titular ガードが優先）
  - House 役職: leader 以外は一律 maxHolders = 1（slot は常に 0）
- 死亡者の役職は自動的に revoke される

**House 役職の支払能力ゲート**: House 役職（有給 = administrator/treasurer/military/advisor）は、家が定常的に得る年間収入で既存役職＋新規役職の年間給与を賄えない場合は任命しない（leader は `baseSalary=0` なので常に対象外。Polity 役職は財庫から支払われ実測上ほぼ未払いにならないため不問）。
- 投影年間収入 `getHouseProjectedAnnualIncome` = 家が定常的に得る収入の投影。定常収入は **PolitySurplusDistribution（§6.5、v0.42: influence 比例）のみ**で、estate settlement や外交移転など不定期な収入は含めない。`Σ_polity（家の influence% × getPolityDistributablePerCycle）× 12`（走査対象は家が土地で関与する polity。office/right のみの取り分は投影に含めず過小評価側に倒す）。
- 任命可否: `getHouseAnnualOfficeSalary（既存 active house 役職の baseSalary 合計）+ 新役職 baseSalary ≤ 投影年間収入` のときのみ任命。
- 動機: 収入の無い landless 小家系が役職を抱え、`OFFICE_SALARY_UNPAID` を量産する不自然さを解消（実測で家由来の未払いイベントが 100 年あたり 22〜27 万件 → 0 に）。有力 landed 大家系は投影収入が十分で全役職を維持する（landless→有給役職 0、landed→従来どおり、という二分が観測される）。
- UI: House DetailPanel に「想定年収 / 役職給与 / 役職収支」を表示（`getHouseProjectedAnnualBalance`）。
- 既存役職は本ゲートの対象外。`OfficeTermSystem`の任期満了 revoke を経て自然に再任命ゲートを通るため、収入を失った家の役職は数年のラグで減衰する。
- 将来: 形骸化した帝国/王国の Polity 役職を「名誉職」として残す仕組みは今後の課題。現状は単純に収入ベースの役職数とする。

**Task 補正**: `getAppointmentTaskModifier(state, personId, organization, role)` による Person Aim / Task 効果の補正を候補スコアに加算。obtain_office / retain_office Aim が active、または seek_office_support / display_competence の直近 ActivityLog がある候補は +appointmentTaskModifierValue（デフォルト 4）の補正を受ける。

**イベント**: `OFFICE_ASSIGNED`（importance: `normal`）

### 6.20 OfficeCompensationSystem（4週ごと）

アクティブな OfficeAssignment に対して、`baseSalary`（§3.7 参照）に基づく給与を支払う。

- 支払元: Polity 役職 → `polity.treasury`、House 役職 → `house.wealth`
- 支払先: `person.wealth += paid`
- 資金不足時は部分支払いまたは未払い
- 未払い・部分支払い時: `office.unpaidCount` を増加し、Person の Attitude（対 Polity / 対 House の affection・respect）にペナルティを付与
  - ペナルティは `officeDignityUnpaidPenaltyReduction` × dignity 値で軽減
- `unpaidCount` が 0 の完全支払い時にはリセット

bailiff（HoldingOfficeAssignment）の給与支払いは本 system では行わない。代官の収入は LandRevenueSystem 内の `bailiffFee`（§6.4.2）に一本化されている。

House 役職の `OFFICE_SALARY_UNPAID` は AppointmentSystem の支払能力ゲート（§6.19）で発生源を抑止する（収入で賄えない家にはそもそも有給役職を任命しない）。本 system 自体の支払いロジックには影響しない。

**イベント**: `OFFICE_SALARY_UNPAID`（importance: `minor`）/ `OFFICE_SALARY_PARTIALLY_PAID`（importance: `minor`）

### 6.21 BailiffRevenueTaskSystem（4週ごと）

代官の月次徴税業務 Task を管理する。

**責務**:
1. 前回の未完了 `collect_holding_revenue` Task を期限切れ処理する
2. 今月分の `collect_holding_revenue` Task を生成する
3. placeholder 代官は除外する

**生成条件**:
- `assignment.role === 'bailiff'` / `assignment.active === true`
- `holderPersonId` が通常人物（`kind !== 'placeholder'`）かつ `alive`

**期限切れ処理**: 同じ `holding_office_assignment` を target に持つ active `collect_holding_revenue` Task が残っている場合、`failTaskAsExpired` で締め、`PersonActivityLog`（`kind: 'task_expired'`, `outcome: 'failure'`）を作成する。

**Task パラメータ**:
```ts
kind: 'collect_holding_revenue'
targetRef: { kind: 'holding_office_assignment', id: assignment.id }
priority: 1
actionCost: config.taskActionCostLight
effortRequired: Math.ceil(config.taskEffortRequiredLight * 1.5)
deadlineWeek: absoluteWeek + 4
```

Task の実際の処理（effort 消費 → 完了）は既存 TaskSystem に任せる。`collect_holding_revenue` は既存 Task と `weeklyActionCapacity` を共有する。

### 6.22 BailiffAppointmentSystem（12週ごと = 季節ごと）

terminal Polity ごとに HoldingOfficeAssignment (Bailiff) を走査し、placeholder Person で空席化している **Holding** を通常人物で埋める。逆に、通常人物の Bailiff が死亡・離反などで不在化した場合は placeholder Person に戻す。

**holding 粒度の絞り込み (v0.45.5)**: 走査対象は `getPolityTerminalProvinceIds`（Province 粒度 = この Polity が
1 つ以上の holding を terminal 支配する Province）が返す各 Province の holding のうち、
`holdingTerminalPolityCache[holdingId] === polityId` を満たすもの**のみ**に絞る。分割 Province（例: 反乱
commonwealth が Province 内の 1 holding だけを seizure し、残りは旧 grantor が保持）では、この絞り込みを
怠ると旧 grantor が**自分が terminal 支配しない holding の bailiff を毎サイクル再任命**し、下記の land 移転時
bailiff リセットを打ち消してしまう（→ §6.64 influence リークの再発源）。

**land 移転時の bailiff リセット (v0.45.5)**: holding の terminal Polity が変わったら、その holding の bailiff
（HoldingOfficeAssignment）を「新 terminal Polity 任命の placeholder」に差し替える。これは tick system ではなく
**land contract mutation の choke point**（`recomputeTerminalCacheAndResyncBailiffs` — 末端 cache 再計算を通る
全経路: createChildLandContract〔叛乱 seizure〕/ transferLandContractGrantee・insertIntermediateLandContract・
transferAllProvincesToPolity〔戦争土地移転・家滅亡継承〕/ removeContract）で eager に行う。旧 terminal の支配家の
代官が残留すると、その家が奪った側 Polity の influence 母集合に居座る（§6.64）。任命権（PoliticalRight
holding_office_role）側は §6.65 RightConsistencySystem が terminal 不一致を `regime_change` で revoke するが、
assignment 側にはこの同期が無かった（さらに commonwealth は本 system にスキップされ既存 cleanup も届かない）。
Regiment owner 同期（§6.49 `syncRegimentOwnerToHomeTerminalMut`）が lazy では即開戦に間に合わなかった先例に倣い、
mutation 側で eager に処理する（terminal が消滅した holding は任命主が無いので vacate のみ）。placeholder は
houseless で influence 寄与ゼロ。bailiff を持つ通常 Polity なら次サイクルの本 system が実在人物へ昇格する。

**任期判定**: `absoluteWeek - office.startWeek >= termYears * WEEKS_PER_YEAR`。

**候補者選定（v0.42: Tier 制）**:
- **Tier 0**: 当該 Holding に `holding_office_appointment` right（§6.64）があれば、right holder（House なら free adult member / Person なら本人）を最優先。**v0.49: right holder 候補に加え、right-backed faction（§6.20 polity office と同じ 5 段階選定）の active member も Tier 0 で「最初から」併合し `bailiffAbilityScore` で競争させる**（NP 閾値不問 — access は任命権由来。`selectRightBackedFaction` を共用。fall-through の Tier 1 を待たずに保持者の派閥人材が landless でも届く）
- **Tier 1**: factional 候補（NP ≥ threshold の faction の active member。v0.42: faction の任命介入は **anchor Polity が terminal の Holding に限定** — NP が非 anchor polity に対して 0 を返すことで実現）
- **Tier 2**: ownerHouse の free adult member（numeracy + insight 降順）
- 適任者が居なければ placeholder のまま
- **commonwealth アリーナ化（派閥拡大 Phase 7）**: 旧来 `ownerHouseId` を持たない polity（commonwealth）は本 system に丸ごとスキップされ、その holding の代官席は永久に placeholder のままだった。これを撤廃し、**established commonwealth（`isEstablishedCommonwealthRepublic`）も代官を任命する**。Tier 2 の候補母集合は `ownerHouse.memberIds` の代わりに `getRepublicPoliticalCandidatePersons`（§6.68 — commonwealth 関係の人物プール）を用いる。Tier 0/1 は変更なし（commonwealth-anchor 派閥は anchor 限定 NP で Tier 1 に乗る）。実測（tiny 100年）: commonwealth 代官席の placeholder 4/5 → 0/9（全席着座）、commonwealth-anchor 派閥 2 → 6。これにより「分権の極（共和制）でも人材政治が動く」寡頭アリーナが成立する。
- **性別役職適格ゲート (v0.45.3)**: 3 tier すべてに `isRoleEligibleBySex` を適用する（§6.19）。gated で 3 tier が空振りした場合のみ、`allowFemaleRolesWhenNoMaleCandidate`（既定 false）が true なら ungated 再試行を 1 回行う。実装上 tier cascade は `pickBailiff(gate)` クロージャに集約され、ownerHouse 候補の消費は破壊的 shift から走査（着座者は bookedThisTick で除外）に変更された（gated/ungated の 2 回呼びで候補列が壊れないため。挙動は同等）
- **無収入 leader 肩書きの候補解禁 (v0.48)**: 候補フィルタは従来「active office を 1 つでも持つ人物」（`hasActiveOffice`）を除外していたが、これを `hasGainfulOffice`（§4 houseFinanceSelectors）に置換する。`house:leader` / `polity:leader` は給与 0 の地位であり（officeDefinitions baseSalary 0）、無領地の家の家長・国庫が枯れた名目 Polity の家長は「家長という肩書きを持つだけで実収入ゼロ」なのに代官候補から弾かれていた。`hasGainfulOffice` は leader 役職を「家の定常年間収入（`getHouseProjectedAnnualIncome`）> 0」のときだけ実職とみなすため、収入を生む Polity を持つ家の家長（必ず polity:leader を兼任し income > 0）は従来どおり除外され、無収入の家長のみ代官候補に復帰する。非 leader 役職（administrator 等）保持者は従来どおり実職扱い。**実測（tiny 100年 seed1）**: `BAILIFF_APPOINTED` 904→896 とほぼ不変で、tiny preset では候補プールが派閥/所有家経由で既に充足しているため代官席への影響は小さい（実効は §後述 obtain_office aim 側）。本変更は「給与 0 の地位が稼ぎ口探しを塞ぐ」論理矛盾の除去が主目的であり、人口/役職不均衡の解消そのものは別途のバランス調整（action 経済）に委ねる。

- **stewardship 評判による後順位化 (v0.48)**: 候補ソートスコアを `numeracy + insight` から `numeracy + insight + getPersonReputationModifierForCategories(state, config, id, ['stewardship']) * officeReputationScoreFactor`（実効 ±5）に拡張する（`bailiffAbilityScore`、Tier 0 right holder ソート・Tier 2 ownerHouse ソートに適用。Tier 1 factional 候補は `getFactionalCandidateScore` 由来スコアに同 modifier を加算）。民衆反乱で罷免された代官は負の stewardship 評判（§6.29、`revoltBailiffReputationPenalty` 既定 -12）を負うため、評判が減衰回復するまで後順位化される（= 事実上の再任用クールダウン。専用フィールド不要・能力差を覆さない控えめな nudge）。

**fall-through の設計意図 (v0.42)**: right があっても Tier 0 が候補を出せない場合は Tier 1 / 2 へ落ちる。
これは polity office（right がある role では unrelated factional path を skip）と**意図的に異なる**扱いで、
形式上の不統一ではなく役職の性質の違いによる — bailiff は Holding の徴税・管理を実務的に担う現場職であり、
空席・placeholder が長く続くと土地収益や develop_holding 周辺に悪影響が出るため、行政実務を止めない。
（polity office は空席のままでも国は回る。）

**commonwealth の扱い**: `ownerHouseId` を持たない commonwealth / rebel polity は本 system の対象外（現行スキップ）。
そのため holding right があってもこれらの Polity では v0.42 時点で行使されない（統治機構整理は future）。

**イベント**:
- `BAILIFF_APPOINTED`（importance: `minor`）: placeholder → 通常人物に交代
- `BAILIFF_VACATED`（importance: `normal`）: 通常人物が不在化
- `BAILIFF_PLACEHOLDER_INSTALLED`（importance: `minor`）: terminal Polity 変更時に placeholder を新規設置

commonwealth (`ownerHouseId === undefined`) Polity の Bailiff 候補者選定は Faction 段階まで持ち越し。

### 6.23 HouseShareUpdateSystem（48週ごと = 毎年）

House の Share 分布を毎年更新する（v0.42: 旧 ShareUpdateSystem。Polity share は全廃され、
Polity の権力分布は Polity Influence read-model（§6.64）で導出される。Polity share 更新枝・
shareYearlyRetentionRate・person-holder polity share はすべて削除）。

**House Share 更新（Person ホルダーの Share を計算）**:
```ts
newRawPower = houseShareBase
            + (isLeader ? houseShareLeaderBonus : 0)
            + houseOfficeCount * houseShareOfficeBonus
            + person.legacyPrestige * houseSharePrestigeFactor
            + person.wealth * houseShareWealthFactor
            + (governance + warCommand) * houseShareStatFactor   // getRoleScore(governance + warCommand) / 10
```

**イベント**: `SHARE_SHIFTED`（importance: `minor`）— Share 分布に有意な変化があった場合

### 6.24 PersonGrowthSystem（48週ごと = 毎年）

`OfficeCompensationSystem` の直後に実行。48 週ごと（ScheduledSystem で制御）。

毎年 1 月に全 alive Person の 6 基礎能力それぞれについて、**成長判定** と **衰退判定** を行う。

**成長判定**:
```ts
const naturalCeil    = aptitude[k] * naturalFraction(k, age, config)
const effectiveCeil  = hadRelevantExperience(state, personId, k) ? aptitude[k] : naturalCeil
if (ability[k] < effectiveCeil) {
  const gainChance = abilityGrowthChanceBase * (1 - ability[k] / effectiveCeil)
  if (rng < gainChance / 100) {
    // v0.45: 成長量はギャップ比例 (成功時最低 +1)。round(effectiveCeil) と HARD_CAP で clamp
    const amount = max(1, round((effectiveCeil - ability[k]) * abilityGrowthGapFactor))
    ability[k] = min(ability[k] + amount, max(round(effectiveCeil), ability[k] + 1), ABILITY_HARD_CAP)
  }
}
```

**ギャップ比例成長 (v0.45)**: 旧来の固定 +1 では「天井到達の時定数 ≒ 天井値 (年)」となり、高天賦 (80+) は寿命内に原理的に到達不能だった。成功時の伸び幅を天井との差に比例させる (`abilityGrowthGapFactor` 0.1) ことで、天井から遠いほど速く伸びる: 天才の幼少期 (天賦 110 × 年齢曲線の天井を毎年追走) や、登用直後の上限解放 (naturalCeil → aptitude) が高速成長として表現される。天井への漸近は依然遅く、天賦を使い切るのは稀なまま。

* **経験あり** → `effectiveCeil = aptitude[k]`（能力は aptitude を目指して伸びる）
* **経験なし** → `effectiveCeil = naturalCeil`（年齢曲線の自然到達水準で頭打ち）

**訓練経験 (v0.44 で廃止)**: 旧 `personTrainingExperience`（improve_ability Task 由来の gainChance bonus + 年次 decay）は v0.44 で全廃した。Task 完了は能力成長を直接発生させず、成果単位の即時成長（§6.66）に置き換えられている。

**自然成長イベント (v0.44 追補)**: 成長判定で +1 が発生するたびに `PERSON_ABILITY_GREW` を emit する。`sourceKind` は成長の帯で出し分ける:

- `'duty'`: 成長時の `ability >= naturalCeil`（= `hadRelevantExperience` による上限解放がなければ起こり得なかった、職務経験由来の成長）
- `'natural'`: それ以外（年齢曲線内の自然成長）

importance は §6.66 の award 経路と同じ notable=`normal` / 一般=`minor`（`isNotablePerson`）。メイン EventLog は major/critical のみ表示するため（§6.62 / EventLog `isMainLogEvent`）、これらは Person Chronicle（byPerson）にのみ蓄積される。RNG は消費しない（emit のみ・シミュレーション軌跡は不変）。実測 (100年 seed 1): natural ≈ 351 件/年・duty ≈ 16 件/年で、Chronicle エントリの約 8 割を占める（観賞対象は人物詳細パネルの履歴）。

**衰退判定**: `youthPeak` / `midLifePeak` 曲線の能力で、`ability > naturalCeil` の場合に発火。経験あり人物は `abilityActiveDeclineMultiplier`（0.3）で衰退速度が鈍化する。`lifelongGrowth`（numeracy / learning）は衰退しない。

**経験イベント対応表（hadRelevantExperience）**:

| 経験 | 成長対象 |
|---|---|
| Polity leader 在任 | command, charisma, insight, learning |
| House leader 在任 | command, charisma, insight |
| Polity administrator (chancellor) 在任 | numeracy, learning, charisma |
| Polity/House treasurer 在任 | numeracy, learning |
| Polity military (general) 在任 | command, learning |
| House military (marshal) 在任 | command, valor |
| 戦争 active 期間中（48 週以内に lastWarWeek）の在国 | valor, command |
| 進行中の陰謀 Project（undermine/revoke/replace）の supervisor | insight |

### 6.25 LifeStage システム群（48週ごと = 毎年）

人物に人生段階（`LifeStage`）を導入し、年次で一方向に進める。社会活動資格・登用優先度・幼少期の社会的影響（Attitude / 能力成長補助）を LifeStage で表現する。

**重要原則（二重適用の禁止）**: 能力成長カーブ（`ABILITY_AGE_CURVES` + `naturalFraction`）は **LifeStage で補正しない**。age-curve が伸び/衰退を既に表現しており、LifeStage 乗算を重ねるとバランスが崩れる。LifeStage が能力に関与するのは「親能力ボーナス」のみ（下記）。

#### LifeStageInfluenceSystem（HarvestSystem 直後・LifeStageProgressionSystem 直前）

幼年期 / 思春期の人物が、親・家 leader・同家成人・親 faction member の Attitude を少しずつ継承する（「思想」形成の最初の実装）。**RNG 不使用の決定的処理**。

- 対象: alive / normal / `lifeStage === 'childhood' || 'adolescence'`（placeholder 除外）。
- 影響元収集順（deterministic）: 父 → 母 → 同 House leader → 同家成人（`young_adulthood` 以降、PersonId 昇順）→ 親 active faction の active member（PersonId 昇順）。重複排除のうえ合計上限 `maxLifeStageInfluencersPerChild`（5）。father/mother を最優先。
- 継承 target: influencer の attitudes のうち **person / house を指すもののみ**（polity は継承しない）。さらに **現存するエンティティのみ**（`person:` は生存している人物 `alive`、`house:` は active な家）。故人・消滅した家への感情は継承しない（噂でだけ知る対象は現段階では非対象。将来拡張候補は §13）。`abs(affection)+abs(respect)` 降順・key 昇順で上位 `maxAttitudeTargetsInheritedPerInfluencer`（3）を、この**現存フィルタ適用後**に選ぶ。child 自身を指す target は除外。
- 適用: `lerpAttitude(current, target, rate)` で child の attitude を influencer の attitude へ rate だけ近づける（clamp ±100）。rate は影響元種別 × LifeStage のテーブル（§9 config）。
- 既存 `attitudeDecaySystem` とは独立に毎年作用する。

#### LifeStageProgressionSystem（LifeStageInfluenceSystem 直後）

`advanceTime` で age が上がった後に走り、age が遷移範囲に達した人物を確率的に次段階へ進める。

- 対象: alive / normal / `lifeStage !== 'old_age'`（placeholder 除外）。`livingPersonIds` を iterate。
- 遷移先ごとに `config.lifeStageTransitionAges[next]` の `{minAge, standardAge, maxAge}` を参照。`age < minAge` は遷移しない / `minAge <= age < standardAge` は early 確率 / `standardAge <= age < maxAge` は standard 確率 / `age >= maxAge` は必ず遷移。
- RNG は既存の関数型パターン（`randomFloat` で thread）。逆行は writer 側で構造的に防ぐ（IntegrityCheck は逆行検査をせず、緩い age-lifeStage envelope のみ。§6.35 / §13）。
- **life event emit**: `adolescence→young_adulthood` で `PERSON_CAME_OF_AGE`、`mature_adulthood→old_age` で `PERSON_ENTERED_OLD_AGE`（他の遷移は emit しない）。
  - **notable 判定（安価な index ベースに限定）**: house leader / polity leader / active office holder / 天才（`geniusType` あり。v0.45）のいずれかなら notable。`calcPersonImportanceScore` は全人物の年次遷移ごとに呼ぶには高コストのため**使わない**。war 時の field commander / captain general は O(1) index がなく（war side の soft reference のみ）、コスト優先で notable 判定からは**省略**する。
  - importance: notable=`normal` / 一般=`minor`。entityRefs を出し分け（一般=`[person]` → byPerson のみ / 主要=`[person, house, polity]` → byPerson+byHouse+byPolity）。Chronicle allowlist は `{ category: 'life' }`（`retainRefKinds` 無指定。§6.62）。
  - 全人物の成人・老年入りが個人 Chronicle（byPerson）に残り、主要人物のみ House/Polity Chronicle とメイン EventLog に載る（§11）。

#### 親能力ボーナス（PersonGrowthSystem §6.24 内）

childhood / adolescence の人物について、`personGrowthSystem` の**成長ブロック内**（`ability < effectiveCeil && effectiveCeil > 0`）でのみ、living な父母の該当 ability 平均が子より高ければ `gainChance` に `parentalAbilityGrowthChanceBonus`（2.0pp）を加算する。死亡済み親は含めない。`aptitudes` / `effectiveCeil` / `naturalFraction` は不変（age-curve には触れない）。新生児は `effectiveCeil = 0` で成長ブロックに入らずボーナスも効かない。

#### 社会活動資格の `young_adulthood` 化

`age >= config.adultAge`（15）で見ていた**社会活動・政治活動の資格**を `isLifeStageAtLeast(lifeStage, 'young_adulthood')`（標準 19 歳相当）へ置換する。置換対象: Appointment 候補 / Faction 成立・参加・recruitment / PersonGoal・PersonAim 生成 / Plot 参加 / Project actor・Bailiff candidate / House founding（founder 本人）/ House split（splitter＝cadet house の founder）。

**据え置き（age config のまま）**: Succession（`adultAge`=15。minor-heir ペナルティ経路と結合するため）/ Marriage / Birth / BailiffMinAge / WeeklyActionCapacity / Worldgen 初期 leader。House split は succession 用 `getAdultSuccessionCandidates`（age 15）を変えず、splitter にのみ `young_adulthood` フィルタを追加する。

#### old_age 登用ペナルティ

old_age の人物は新規登用・指揮官選定で優先度が下がる（引退・除外ではない）。

- **Appointment / delegate（固定減算）**: `computePolityScoreV017` / `computeHouseScoreV017` の候補スコアに `- oldAgeAppointmentScorePenalty`（5）。これらのスコアは `compatibilityPenalty` 等で負値になりうるため、乗算でなく**固定減算**で単調に不利化する。delegate は office 優先順（advisor→administrator→leader）で選ばれスコアを持たないため、old_age 反映は上流の appointment スコアで実現する（delegate 専用の減算 path は無い）。
- **commander / captain general（乗算）**: `warManeuverSelectors` の選定スコア（`warCommand` role score ベース＝常に非負）に `* oldAgeCommandScoreMultiplier`（0.8）。候補からの**除外はしない**（指揮官不在を避ける）。選定（候補ソート順）にのみ適用し、battle 内部の `fieldCommandScore`（戦闘効果）には適用しない。

### 6.26 陰謀システム（Project 化 — v0.51 陰謀リファイン）

**旧 AmbitionSystem / PlotSystem（専用 Plot エンティティ・固定期間待機・一括解決）は廃止し、陰謀を
すべて既存の Project パイプライン（Goal → Aim → Task → Project → projectOutcomeSystem）に乗せた。**
担当者 = Project supervisor で、担当者の能力（insight）が Task の進捗速度・成否を決める（他アクションと同じ）。

#### 起案トリガー — covert Goal `pursue_covert_agenda`

旧 PlotSystem の「全家走査 + plotTendency >= plotThreshold」という goal 非依存トリガーを、専用の
HouseGoalKind `pursue_covert_agenda` で再現する。`goalSelectors.scoreHouseGoalKind` でこの goal の
スコア = `conspiracySelectors.computeConspiracyDrive`（旧 `plotTendency` 計算を移植: 当主 ambition×30 +
家格 legacyPrestige×0.2 + 低 houseLoyalty×0.3 + 低 overlord loyalty×20 − caution×15 − adminPower×0.1）。
owned polity の有無に依らず、野心高・
低忠誠の不満家がこの goal を採る。閾値 `conspiracyDriveThreshold`（既定 75）未満 or cooldown 中は
drive を 0 にして抑止する。primary polity / house leader 不在は drive 0（RNG 非消費・on-demand 計算）。

`旧 rebellionTendency`（prepare_rebellion 用）は廃止した（民衆反乱は別系統の §6.29 ProvinceRevoltSystem
が担う）。`computeConspiracyDrive` は `plotTendency` 側のみを移植している。

#### 3 つの陰謀 Project（すべて House owned・budget なし・単一 final stage）

| 陰謀 | HouseAimKind | ProjectKind | target | outcome |
|---|---|---|---|---|
| 影響力毀損 | `undermine_rival_influence` | `undermine_influence` | 同 Polity の自家以外 rival（家/人物） | 負の InfluenceModifier を生成（§3.x InfluenceModifier）|
| 任命権失効 | `revoke_rival_right` | `revoke_political_right` | ライバル保有の PoliticalRight | `removePoliticalRight` で国に返却（現職 OfficeAssignment は不変）|
| 分家当主交代 | `intervene_cadet_succession` | `replace_house_leader` | 自家の分家（cadet House）| 分家当主を prestige 最上位の生存成人に交代（旧 plot ロジック移植）|

- **target 候補化（空回り排除）**: `pickHouseAim` の covert 分岐で「妥当な target を持つ陰謀のみ」候補化する。
  undermine = 同 Polity に自家以外の influence entry がある / revoke = 自家以外の holder が持つ active right が
  ある（`findRevocableRightTarget`、person holder 優先）/ replace = 生存当主を持つ自家分家がある。
  候補スコアに `conspiracyAimPriorityFactor`（既定 0.5）を掛けて多発を抑制する。
- **重さ（スパム防止）**: 陰謀 Task は `projectTaskGenerationSystem` で effortRequired を
  `conspiracyTaskEffortRequired`（既定 6・HEAVY 上限より重い）に、difficulty を陰謀専用値に上書きする。
  成否は `ability + roll(0-100) vs difficulty*2 + margin` で判定（担当者能力が効く）。
- **holder 種別による難度差（任命権失効）**: person holder right は `conspiracyRevokeRightBaseDifficulty`
  （既定 60）、house holder right は `+ conspiracyRevokeHouseRightDifficultyBonus`（既定 +30 → 実効 90）。
  **家保有の任命権は個人保有よりずっと取り消しにくい**（高 difficulty で成否確率に表現）。
- **outcome handler の前提**: `project.status === 'completed'` を前提に副作用のみ適用（失敗・target 消滅時は no-op）。
  revoke は削除前に holder がまだライバルか再検証する。
- **insight 経験**: 進行中の陰謀 Project の supervisor は `hadRelevantExperience` で insight 経験ありと判定される
  （旧 activePlots ループの置換）。

#### cooldown（連発防止）

陰謀 Project が terminal（completed/failed）になると、owner 家に `House.lastConspiracyResolvedWeek` を記録し、
`conspiracyCooldownWeeks`（既定 52 週）経過するまで `computeConspiracyDrive` が 0 を返す（covert goal/aim を
抑止）。これが無いと完了直後に同じ家が即再立案する（旧 Klaus ループ）。cooldown は家に記録し、当主交代・死亡で
引き継ぐ（「一族の策謀疲れ」）。

> v1 では発覚・露見（secrecy）、現職者排除、共謀者、陰謀コスト（budget）は導入しない（将来拡張）。
> InfluenceModifier は正の delta（恩賞・祭礼で一時的に influence を上げる）にも使える汎用機構。

### 6.28 TaxRevisionSystem（48週ごと）

土地保有者 Polity が LandContract の税率を引き上げる。provinceRevoltSystem より前に実行し、税率↑ → unrest↑ → 叛乱の循環を形成する。

対象: active Polity の terminal holding（commonwealth・nominal occupation 契約〔v0.53 で revolt_seizure 契約から置換。active revolt_independence default 紐付け〕・cooldown 中・active revolt_negotiation 対象を除外）。

判断: increaseScore（treasury 不足・低 unrest・leader ambition・戦争中）vs avoidScore（高 unrest・recent revolt・高税率・leader caution/insight）で判定。上昇幅 +0.02〜0.05、`taxRevisionSystemMaxRate` でキャップ。`taxIncreaseCooldownUntilWeek` で連続増税を防止。

### 6.29 ProvinceRevoltSystem（12週ごと）

Holding 単位で判定する。**v0.48 以降、反乱ロール成功時はまず unrest Crisis を生成し**（§6.6 / §3.12a）、期限内に鎮静/譲歩できなければ武装蜂起（交渉用 commonwealth + `revolt_negotiation` DiplomaticPlay 生成 → 即 escalation）へ進む。

**Holding 単位 revoltTendency**:

```
revoltTendency =
  pop.unrest * unrestFactor
  + (100 - polityControl) * (provinceRevoltLowHouseControlFactor + provinceRevoltLowCountryControlFactor)  // 既定 0.2 + 0.2 = 0.4
  - stability * stabilityFactor
  - (governorScore - revoltAbilityNeutralScore) * revoltAbilitySuppressionFactor   // v0.49: 統治者の統率/学識
  + [class 別補正]
  + taxBurden * taxBurdenWeight
  + recentTaxIncrease * weight * decay
  - recentSuppression * reduction * decay
```

低 polityControl 項は `provinceRevoltLowHouseControlFactor`（0.2）と `provinceRevoltLowCountryControlFactor`（0.2）の 2 つの factor を同じ `(100 - polityControl)` に乗じて加算する（合計係数 0.4）。

**v0.49 統治者の能力による反感低減**（`getHoldingGovernorAbilityScore`）: 領地の実質統治者の `command*0.5 + learning*0.5`（0..120）を `governorScore` とし、中立 `revoltAbilityNeutralScore`（既定 50）からの差に `revoltAbilitySuppressionFactor`（既定 0.4）を乗じて tendency から減算する（対称項: 有能 80/80 → -12 で鎮静、無能 20 → +12 で煽る）。統治者は **代官（holding の active な非placeholder bailiff）を優先**し、不在なら領主家長（`getHouseLeader(ownerHouse)`）に fallback。両者不在なら本項なし。「統率と学識の高い領主・代官は住民から反感を買いにくい」という人物中心史観（§10.0）の反乱版。

taxBurden = `max(0, currentTaxRate - defaultTaxRateByRank(rank))`。

**発生時の処理（v0.48 Crisis 化）** (`resolveHoldingRevolt`): 反乱ロール成功時、**即座に commonwealth / 外交劇を生成せず**、demand を確定して unrest Crisis を生成する（§6.6 CrisisSystem の対処 Project に乗せる）。「反乱前段＝対処を要する局所的事態」として、代官・指導者が期限内に鎮静/譲歩できれば武装蜂起を回避し、放置・失敗すれば蜂起する分岐を作る。
1. **demand 分岐（`decideRevoltDemand`）** で demand を確定（下記。secession / bailiff_dismissal は対象 class・`bailiffPersonId` も Crisis に保持）
2. `spawnUnrestCrisis` で unrest Crisis を生成（severity = `crisisInitialSeverityByKind.unrest`、deadline = `crisisDeadlineWeeksByKind.unrest`）。代官がいれば代官、不在なら owner polity の指導者が対処 Project の担当者になる（§6.6 `resolveCrisisHandlers`）
3. demand が bailiff_dismissal の時のみ site①の house 悪感情（下記）を付与
4. `CRISIS_CREATED`（minor）event。commonwealth 生成・`REVOLT_POLITY_FOUNDED` / `REVOLT_NEGOTIATION_STARTED` は **期限切れ（武装蜂起）時へ遅延** する（§6.29a）

**二重トリガーガード**: `collectHoldingCandidates` は同 holding に **active な unrest Crisis** がある間は候補から除外する（旧 play / commonwealth key 判定を `crisisIndex.byHolding` の kind=unrest&active 判定へ置換）。蜂起後に生成される commonwealth は既存の `polity.kind === 'commonwealth'` guard が引き続き弾く。

**v0.48 民衆反乱の目的分岐（`decideRevoltDemand`）**:

反乱 class の pop の**生の attitude（`attitudeValueToScore` を通さない `.affection`）**を上から順に判定し、demand を 3 種から選ぶ:

1. POP→ownerHouse affection ≤ `revoltIndependenceHouseAffectionThreshold`（既定 -30）→ **独立**（`secession` demand）
2. POP→現 bailiff person affection ≤ `revoltBailiffDismissalAffectionThreshold`（既定 -20）かつ bailiff が非placeholder → **代官罷免**（`bailiff_dismissal` demand）
3. それ以外 → **税率改定**（`popular_tax_relief` demand、従来挙動）

狙う創発フロー: 代官の悪政が問題なら ①まず代官罷免を求め、②代官交代直後（閾値超だが代官への恨みは浅い）は税率改定にフォールバックし、③悪政が繰り返され領主家への悪感情が蓄積すると独立反乱に進む。

**POP→ownerHouse 悪感情の生成（v0.48）**: 従来 POP→house attitude を負に書くコードは存在せず、noble disloyalty 項は実質定数だった。v0.48 は `worsenPopAttitudeTowardOwnerHouse`（反乱 class の pop のみ対象、ownerHouse 不在なら no-op）で負の affection を付与する。設計上は 3 サイトを用意したが、**unrest Crisis 化（案 A）で実際に発火するのは site①のみ**:
- site①代官排除反乱の発生時（spawn 時、`resolveHoldingRevolt`）: `revoltBailiffRevoltHouseAffectionPenalty`（既定 -3）— **発火する**
- site②代官罷免要求が拒否され武力化した時 / site③税率改定交渉が fizzle した時（`applyBailiffDismissalFailure` -8 / `applyTaxReliefFizzle` -5）: いずれも `progressRevoltNegotiation`（48 週交渉窓の*進行*）からのみ呼ばれる。案 A では `escalateUnrestCrisis` が play 生成直後に即 `applyRevoltEscalation` するため交渉窓が進行せず、**両サイトは到達不能（dead code）**。関数・config は残置（balance フェーズで secession 到達性を再設計する際の素材）。

attitude は自然減衰しないため累積し、閾値 -30 到達で次回反乱が独立分岐に進む。site② / site③ が死んだため house 悪感情の蓄積経路が site①（代官排除反乱の発生）に限られ、**tax_relief 反乱からの secession 急進は到達しにくくなった**。**balance coupling 注意**: この値は branch 選択と noble disloyalty tendency 項（§6.29 tendency 式）の両方が読むため、閾値・delta は noble 反乱頻度に影響する（balance-defer。CLAUDE.md §4）。

**対処成功（resolved）/ 期限切れ（蜂起）の結果**: unrest Crisis は CrisisSystem では resolved/expired を **mark するだけ**で、UnrestCrisisSystem（§6.29a）が同 tick で以下を適用してから Crisis を purge する。
- **resolved（担当者が severity を削りきった）— demand 別の譲歩 / 鎮圧**:
  - popular_tax_relief（`applyUnrestConcession` → `applyPopularTaxReliefSettlement`）: 税率引き下げ + `termsProtectedUntilWeek` 設定 + unrest 削減 + `REVOLT_SETTLED`
  - bailiff_dismissal（`applyBailiffDismissalSettlement`）: 現 bailiff を再読し demand.bailiffPersonId と一致する場合のみ `vacateHoldingBailiff` で罷免 + 当人に負 stewardship 評判（`revoltBailiffReputationPenalty` 既定 -12、source `revolt`、月次減衰で自然回復）+ unrest 削減 + `BAILIFF_DISMISSED_BY_REVOLT`。交渉中に代官が交代済みなら後任を罷免・減点せず平和裏に終結（staleness ガード）
  - secession（`applySecessionSuppression`）: 譲歩を伴わず反乱 class の unrest を下げ holding に `lastRevoltSuppressedWeek` を記録（鎮圧）+ `CRISIS_RESOLVED`。house 悪感情（根本不満）は解消しないため cooldown 明けに再蜂起しうる
- **expired（期限内に severity を削りきれず武装蜂起）**: `escalateUnrestCrisis` が `createNegotiatingCommonwealth`（landless、rank 5、treasury 0、leader は在野優先→不在時新規生成）+ vestigial `revolt_negotiation` play を生成し、`REVOLT_POLITY_FOUNDED` + `REVOLT_NEGOTIATION_STARTED` の後 **即座に `applyRevoltEscalation`** で既存 War 配管へ直行する（48 週交渉窓の進行部分は廃止、play エンティティは war 化のために残置）。secession は妥結経路を持たないので必ずこの蜂起へ進む。
- escalation 時の rank 判定基準（v0.47.x 修正、demand 種別に依らず共通）: 分岐は **escalation 時点の「現」terminal holder の rank** で決める。play.target は play 生成時の terminal holder で固定されるため、交渉期間中に当該 holding が land_grant / 契約移管で再分封されると stale になる（例: 交渉中に rank 3 領主が新設の rank 5 land_grant Polity へ holding を分封すると、play.target=rank 3 のままだが現 terminal holder は rank 5）。そこで `applyRevoltEscalation` は `landContractIndex.byHolding` 末尾の terminal contract から現 grantee を取得し、その rank と commonwealth rank（5）を比較する。terminal holder が消失していれば play を fail（stale 縮退）。
- escalation (現 terminal holder rank 2-4): **nominal occupation 子契約追加（v0.53）** → Local Levy 生成 → **奪取 holding の既存常設連隊（worldgen 由来 levy/noble_retinue 等）の owner を commonwealth へ即同期** → `escalated` → warCreationSystem が War 化。**v0.53 で revolt_seizure 子契約を廃止**: 旧実装は `taxRateToGrantor=0` の tax-0 子契約 + `revolt_seizure` specialStatus を作っていたが、これを `taxRateToGrantor=revoltOccupationNominalTaxRate`（=0.5）の **nominal occupation contract** + `LandContractDefault.origin='revolt_independence'`（claimant=旧 terminal holder、occupier=commonwealth、targetLandContractId=nominal contract）へ置換した。nominal tax 0.5 は terminal-holder 意味論維持と非 root tax-0 invariant 回避のための構造値で、active default 中は LandRevenue 上で実効 0（§6.4 / §6.70）。`Polity.revoltState.revoltSeizureContractIds` も default ids へ置換
  - 奪取で holding の terminal Polity は commonwealth に変わるが、owner 付け替えを担う RegimentMaintenanceSystem（§6.49）は warManeuverSystem の**後**に走るため、奪取→即開戦の叛乱には間に合わない（放置すると当該常設連隊が領主=defender 側として動員され、叛乱側は Local Levy 1 個のみで戦う）。そこで escalation 時点で当該 holding の Regiment 群（`regimentIndex.byHomeHolding[holdingId]`）に `syncRegimentOwnerToHomeTerminalMut`（§6.49 と同一ヘルパー＝同一ルール）を eager 適用し、開戦前に叛乱側へ移管する。直前に生成した Local Levy（owner=commonwealth）は no-op、動員済の連隊は owner だけ移り当該 War では `currentWarId` 判定でスキップされる。叛乱敗北で holding が領主へ revert すれば §6.49 が owner を領主へ戻す（active 連隊プールは枯渇しない）。
- escalation (現 terminal holder rank 5 = commonwealth と同 rank): internal revolt 即時解決（§6.30）。rank 5 terminal holder の下に occupation 子契約（grantee=rank 5 commonwealth）を作ると grantor rank ≥ grantee rank となり LandContract 不変条件 §25 #7 を破るため、子契約を作らず現 terminal holder の regime change に分岐する（v0.53 でも同様。子契約 origin は問わない）。

### 6.29a UnrestCrisisSystem（毎週、CrisisSystem の直後）

v0.48 Phase C で導入。unrest Crisis の **terminal 処理を ctx ベースで行う** weekly system。CrisisSystem（ws-mutable）は unrest を resolved/expired に **mark するだけ**で purge しない。本 system が mark 済み unrest を消費し、ctx-immutable な既存 applier（譲歩 / 鎮圧 / 蜂起 escalation）を呼んでから purge する。

**なぜ分離したか（Decision 1）**: 譲歩・蜂起の applier（`applyUnrestConcession` / `applyRevoltEscalation` 等）は ctx を受け取り events を積む immutable な関数で、CrisisSystem の 1-tick-1-draft な ws-mutable ループ内では呼べない。そこで CrisisSystem では status を mark するに留め、本 system が **CrisisSystem の直後**（同 tick 内で mark→action が完結する順）に走って消費する。

**処理**（id 昇順で決定的に走査。mark 済み unrest Crisis のみ対象）:
- **resolved** → demand 別に `applySecessionSuppression`（secession）/ `applyUnrestConcession`（tax_relief / bailiff_dismissal、§6.29 参照）を適用。grievance を実際に解消する（無限再発防止）
- **expired** → `escalateUnrestCrisis`（§6.29。commonwealth + vestigial play 生成 → 即 `applyRevoltEscalation` で武装蜂起）
- いずれも適用後に当該 Crisis を `removeCrisisMut` で purge

### 6.30 Rank 5 Internal Popular Revolt

rank 5 Polity 内の叛乱は War 化せず、diplomaticPlaySystem 内で即時解決する。

力の比較: rebelPower（POP size × unrest + leader charisma/command/ambition）vs defenderPower（polityControl + leader command/caution）。

成功時: 既存 Polity を commonwealth に変換（`origin: regime_changed_by_popular_revolt`、`revoltState: established`）。旧 leader revoke、rebel leader 任命、Share 差替、税率引下、POP attitude ブースト、旧 ownerHouse attitude ペナルティ。`REVOLT_REGIME_CHANGED` event。

失敗時: commonwealth 解散（leader executed/pardoned）、unrest 低下、`lastRevoltSuppressedWeek` 記録。`REVOLT_SUPPRESSED` event。

**v0.53 反乱独立の contract 処理（`suppressRevolt` / `establishCommonwealth`）**: 反乱占拠は nominal occupation contract + `LandContractDefault.origin='revolt_independence'` で表す（§6.29 / §6.70）。鎮圧・確立・時効時の操作は:

- **鎮圧（war 敗北 / suppress）**: nominal occupation contract を `eliminateContractFromChain` で eliminate（子を親に再接続）し、紐づく LandContractDefault を `cancelled` にする。
- **確立（war 勝利 / establish）または時効（prescription）**: `spliceOutClaimantContract`（§6.70）で直近 grantor 1 段を chain から除去し occupation contract を祖父へ旧条件で昇格（claimant が root なら occupation contract を root 化）し、default を `legalized` にする。

旧実装の「specialStatus を剥がして tax-0 contract を残す」（establishCommonwealth）は v0.53 で廃止した。

**commonwealth 解散の cascade**（`dissolveNegotiatingCommonwealth` — settlement / 鎮圧 / revolt War 敗北の `suppressRevolt` で共通）: polity を inactive 化する際、§6.31 Step 1 の Polity 消滅と同等の cascade を実行する — 全 office revoke + `removeRightsByPolity`（R2）+ anchor Faction の即時解散（F8、`FACTION_DISSOLVED` reason=anchor_polity_dissolved）。Faction cascade は §6.31 と共有の `dissolveFactionsAnchoredToPolity` ヘルパーに集約されており、polity を inactive 化する経路は必ずこれを経由する（FactionLifecycle の anchor_polity_dissolved 判定は年次実行のため安全網にしかならず、cascade 欠落は年末 integrity F8 違反として顕在化する）。

さらに leader executed の場合、処刑された leader の assign 済み active Task と supervisor を務める active Project を即時 cascade する — Task は `cancelTasksOfDeadAssignee`（task 削除 + DiplomaticPlay activeTaskIds 参照解除 + owner Aim の activeTaskId 解除。taskSystem の週次 cancel と同じ整合面）、Project は `reassignProjectsOfDeadSupervisor`（§6.40 と同じ規則で再選定し、不能なら failed + `PROJECT_FAILED`）。本関数は war 系 system（tick 順で taskSystem / ProjectMaintenanceSystem より後）から呼ばれるため、通常の週次/4週ごとの回収では年末 integrity（「Task assignee is dead」/「active project but supervisor is dead」）より先に回収できないことがある（supervisor 候補に派閥メンバー＝食客が入ったことで「revolt 指導者が他組織の supervisor を兼ねる」重なりが現実化し、Project 側は 300年 seed 123 で実発生した）。

### 6.31 PolityOwnerConsistencySystem（毎週）

War / Rebellion / ProvinceRevolt 等の所領変動 system の直後に走り、`Polity.ownerHouseId` の整合性を補正する。

**intervalWeeks=1（v0.47.3）**: 旧 interval 4 では年末 IntegrityCheck tick（`absoluteWeek ≡ 47 mod 48`）に実行週が当たらず、週 45〜47 で landless 化した Polity（granted polity が holding を失う等。`getPolityProvinceIds` は estate/peace settlement で `byGranteePolity` が空になると 0 を返す）が titular 化 / abolish されないまま §25 #17（landless active Polity = 違反）に捕まる窓があった。`cancelOrphanedWarsSystem`（§6.35）/ `rightConsistencySystem` を weekly 化したのと同一の理由（interval 4 系は年末 tick をカバーしない §3.4）で本 system も weekly 化し、landless 検出 → titular 化 / abolish を年末 tick でも実行する。発覚契機: land_claim grace（§6.69）導入で granted polity が holding 喪失後に再取得できず landless が年末まで持続したため顕在化した（grace 自体は正しく、これは露出した既存の timing gap）。

active Polity を id 昇順に走査し、以下のステップを順に行う（疑似コード）:

```
for each polity in active polities:
  provinceIds = getPolityProvinceIds(state, polity.id)

  // Step 1: provinceIds = 0 なら Polity 自体を消滅させる
  // ただし negotiating/established commonwealth (kind === 'commonwealth' && revoltState != null) は除外する
  if provinceIds.length === 0 and not (polity.kind === 'commonwealth' and polity.revoltState != null):
    emit POLITY_LANDLESS   // importance: major。deactivate 前に発火
    deactivate polity
    revokeOfficesByOrganization({ kind: 'polity', id: polity.id })
    removeRightsByPolity(polity.id)        // v0.42: PoliticalRight の即時 cascade (§6.64)
    dissolveAnchoredFactions(polity.id)    // v0.42: anchor Faction の即時解散 (F8 を年末 integrity 前に守る。
                                           //   FactionLifecycle は年次 weekOfYear 1 実行のため安全網にしかならない)
    emit POLITY_EXTINCT (+ FACTION_DISSOLVED)
    continue

  eligibleHouseIds = getPolityHouseIds(state, polity.id)

  // established commonwealth の緊急 leader 補充:
  // kind === 'commonwealth' && revoltState?.kind === 'established' で polity:leader が居ない場合、
  // selectOrCreateCommonwealthLeader で leader を選定/生成し、leader Office を作成して continue
  // （commonwealth を headless にしない）。
  // v0.42c: 旧「100% person-direct share」は polity share 全廃に伴い作成しない。
  // commonwealth leader の影響力は Polity Influence の ruler domain（§6.64）で表現される。
  if polity.kind === 'commonwealth' and polity.revoltState?.kind === 'established' and no polity:leader:
    selectOrCreateCommonwealthLeader(...)  // leader Office のみ
    continue

  // Step 2: ownerHouseId 未設定なら新規補充
  if polity.ownerHouseId === undefined:
    if polity.kind === 'commonwealth': continue  // commonwealth は undefined を恒常的に許容
    newOwner = chooseOwner(eligibleHouseIds)  // eligibleHouseIds が空なら findFallbackOwnerHouse
    polity.ownerHouseId = newOwner
    polity.capitalProvinceId = getHouseSeatProvinceInPolity(newOwner, polity.id)
    replace polity:leader Office (revoke + assign new owner-house leader)
    emit POLITY_OWNER_CHANGED

  // Step 3: ownerHouse が inactive または Polity 内に Province なしなら交代
  if ownerHouse is invalid:
    if polity.kind === 'commonwealth': continue  // defensive skip
    newOwner = chooseOwner(eligibleHouseIds)  // eligibleHouseIds が空なら findFallbackOwnerHouse
    polity.ownerHouseId = newOwner
    polity.capitalProvinceId = getHouseSeatProvinceInPolity(newOwner, polity.id)
    replace polity:leader Office
    emit POLITY_OWNER_CHANGED
```

**chooseOwner（§10.2 選定順）**:

1. 対象 Polity 内に保有する Holding 数が最大（`holdingCount` = 当該 Polity 内の house 所有 Province の `holdingIds.length` 合計）
2. 同数なら local military proxy（Polity 内 Province の `getProvinceDevelopmentFromHoldings` 合計を proxy として使用）が最大
3. 同値なら `house.legacyPrestige` が最大
4. 同値なら HouseId 昇順

**findFallbackOwnerHouse（global fallback）**: `eligibleHouseIds` が空の場合は Polity を消滅させず、`findFallbackOwnerHouse` が世界全体から legacyPrestige 最大の active normal House を選んで owner に据える（その House が当該 Polity 内に Province を持たなくてもよい）。これは chain 長 1 で eligible house が居なくなり LandContract grantee が dangling 化するのを防ぐための救済。

**事後条件**:
- 全 active Polity について `ownerHouseId` が存在する。通常は ownerHouse が active かつ Polity 内に Province を持つが、global fallback で選ばれた owner は当該 Polity 内に Province を持たないことがある
- 全 Polity の `capitalProvinceId` はその Polity 内の Province を指す
- owner 交代と同月内に `polity:leader` Office が補充されている

イベント: `POLITY_LANDLESS`（importance: `major`）/ `POLITY_OWNER_CHANGED`（importance: `major`）/ `POLITY_EXTINCT`（importance: `major`）

### 6.32 OrganizationConsistencySystem（4週ごと）

PolityOwnerConsistencySystem の直後に走り、Polity Office の保持資格を監査する。
（v0.42c: 旧 Step 1「不適格 Polity share 削除」は polity share 全廃に伴い削除。）

```
for each polity in active polities:
  eligibleHouseIds = getPolityHouseIds(state, polity.id)

  // Step 2: 不適格 Polity Office revoke
  for each active office where organization is { kind: 'polity', id: polity.id }:
    person = state.persons[office.holderPersonId]
    if not person.alive: continue  // 別系統の不整合（IntegrityCheck で検知）
    if polity.kind === 'commonwealth': continue
      // commonwealth holder は houseId 不問で eligible (person-direct モデル)

    // v0.42: Right 由来任命の例外（狭い判定）。着座 slot に active な
    // polity_office_appointment right (§6.64) があり、holder が House なら同 House の
    // holder を、Person なら本人のみを eligible 扱いする。
    // この例外が無いと right による任命が最大 4 週で黙って revoke され right system が機能しない。
    // right が失効・移転した後の holder は保護を失い通常 revoke の対象に戻る（許容挙動）。
    // v0.42 slot 化: 保護は着座 slot (office.slotIndex) の right に限る。
    // 同 role の別 slot の right では保護されない（slot 照合）。
    right = getPolityOfficeAppointmentRight(state, polity.id, office.role, office.slotIndex)
    if right and ((right.holder is House and person.houseId === right.holder.id)
               or (right.holder is Person and office.holderPersonId === right.holder.id)):
      continue

    // v0.47.x: 無家/有家を分岐させず単一の eligibility 判定に統合する。旧実装は
    // houseless 分岐 (if not person.houseId → 無条件 revoke) が派閥を見ておらず、下の
    // 不変条件「active な派閥に所属する人物は eligible」を houseless だけ取りこぼしていた
    // （factional 任命経路 getFactionalCandidateScore は house ゲートなし で着座した
    // 無家派閥員を誤って解任していた）。house が undefined でも isFactionMember を見る。
    house = person.houseId ? state.houses[person.houseId] : undefined
    houseEligible = house and house.active and house.id in eligibleHouseIds
    // active な派閥に所属する人物は eligible 扱い（派閥経由の任命を維持するため）
    isFactionMember = getActiveFactionMembership(state, office.holderPersonId) !== undefined
    if houseEligible or isFactionMember: continue
    revokeOfficeAssignment(office.id)
    // 文言は原因で出し分ける: 有家 (この国に領地喪失/断絶) = office.revoked /
    // 無家 (派閥の後ろ盾喪失) = office.revoked_houseless
    emit OFFICE_REVOKED (messageKey = house ? 'office.revoked' : 'office.revoked_houseless')

  // Step 3: rank ベースの定員超過 revoke
  // polity の rank / province 数に対して getEffectiveOfficeMaxHolders を超える役職者を解任する。
  // v0.42 slot 化: slotIndex の大きい（列の後ろの）着座者から順に解任（旧: startYear 降順）。
  // 先頭スロットほど縮小時に生き残る = 先頭 slot の right の価値が高い、の over-max 側の実装。
  for each role in [administrator, treasurer, military, advisor]:
    effectiveMax = getEffectiveOfficeMaxHolders(state, config, polityRef, role)
    holderIds = getActiveOfficeHolders(state, polityRef, role)
    if holderIds.length <= effectiveMax: continue
    // slotIndex desc でソートし、超過分（列の後ろから）を revoke
    excess = assignments sorted by slotIndex desc, take (count - effectiveMax)
    for each excess assignment:
      revokeOfficeAssignment(assignment.id)
      // 理由は rank 降格による定員削減 (領地喪失/無家ではない)
      emit OFFICE_REVOKED (messageKey = 'office.revoked_capacity')
```

これにより:
- Polity Office holder は常に以下のいずれかに限定される:
  - 対象 Polity 内に Province を持つ active House の人物
  - commonwealth Polity の houseless rebel founder（`polity.kind === 'commonwealth' && !person.houseId`）
  - active な派閥に所属する人物（**有家・無家を問わない**。無家でも factional 任命経路で
    着座でき、派閥所属が続く限り eligible。派閥が解散すれば次回チェックで revoke される。
    v0.47.x: 旧実装は無家を派閥に関わらず revoke していた不整合を修正）
  - polity_office_appointment right による任命者（v0.42 — right が active な間のみ）
- Step 3 により、Polity の rank 降格時に定員超過の役職者が自動的に整理される
- rebel founder が死亡したら `markPersonDead → revokeOfficesByHolder` 経路で Office が revoke される

### 6.33 AttitudeDecaySystem（4週ごと）

全 Person および全 PopGroup の `attitudes` を 4 週ごとに `attitudeMonthlyRetentionRate`（0.995）倍に減衰させる。`affection` / `respect` どちらも同率で 0 に近づく。エントリを持たない（未設定の）態度への影響なし。

### 6.34 GovernanceSystem（48週ごと = 毎年）

`getPolityAdminPower`（§4.5）で `adminPower` を再計算し、`polity.adminPower` にキャッシュとして書き込む。

```ts
adminPower = clamp100(
    (rulerContrib + adminContrib + treasurerContrib) * adminEfficiency * 0.5
  + stability * 0.2
  + legacyPrestige * 0.15
  + treasuryScore * 0.15
)
// rulerContrib      = getEffectiveOfficeStat(...,'leader')        * rulerAdminCapacityFactor
// adminContrib      = getEffectiveOfficeStat(...,'administrator') * administratorCapacityFactor
// treasurerContrib  = getEffectiveOfficeStat(...,'treasurer')     * treasurerCapacityFactor
// adminEfficiency   = getAdministrativeEfficiency(...)
// stability         = getPolityStability(...)
// legacyPrestige    = country.legacyPrestige
// treasuryScore     = clamp(log1p(treasury)*10, 0, 100)
```

`getEffectiveOfficeStat` は役職担当者の能力・複数担当者の協調ペナルティを考慮した実効能力値を返す。leader / administrator / treasurer の 3 役職の寄与に administrative efficiency を乗じ、stability・legacyPrestige・treasuryScore を加重する。Stability は `getPolityStability` セレクターで毎回計算する。

### 6.35 IntegrityCheck（3モード制・年末実行）

各種不変条件を検証し、違反があれば例外を投げる。フル integrity check と直前の flush は `currentWeekOfYear === WEEKS_PER_YEAR`（年末）のときのみ走る。integrity invariants は設計上「年末（cleanup 後 + flush 後）」にのみ成立する契約のため、週次では走らせない。

**3 モード**:

1. **非 debug・年末**: 違反を検知したら throw（プロセス停止）
2. **debug・年末**: 違反を catch してログ出力（停止しない）
3. **`--integrity-per-system`（opt-in debug）**: 各 system 実行直後に per-system で integrity を走らせ、違反を catch してログ出力（原因 system 特定用）

各項目は error throw / 型レベル保証 / コードレビューのいずれかで担保される。詳細は `integritySystem.ts` 冒頭コメント参照。

**IntegrityCheck 項目（要旨）**:

LandContract / chain 整合性:
1. chain は root contract を 1 つだけ持つ
2. root contract の `taxRateToGrantor` は 0。**非 root contract の `taxRateToGrantor=0` は violation（v0.53）**: 上納の止まった状態は税率 0 の通常契約ではなく `LandContractDefault` で表すため、非 root で税率 0 を禁止する（root のみ 0 を維持）
3. chain の granteePolityId は active Polity
4. chain は循環しない
5. terminal contract のみ Bailiff が紐付く
6. chain 内の各段で granteePolityId は重複しない
7. (削除) 旧 landContractIndex.byProvince の chain 順検証は byProvince 撤去に伴い廃止。chain 整合は #9 (byGranteePolity) / #10 (byParent) と holdingTerminalPolityCache 検証が担保
8. grantor rank < grantee rank
9. landContractIndex.byGranteePolity の整合
10. landContractIndex.byParent (parent → child) の整合
11. provinceTerminalPolityCache が getProvinceTerminalPolityId と一致

Polity / House:
12. Polity.ownerHouseId が有効な House を指す (undefined は許容)
13. Polity.capitalProvinceId が存在する Province
14. polityIndex.byOwnerHouse の整合
15. landless Polity (terminal Province 0) は active=false
16. active Polity は active `polity:leader` Office を持つ (placeholder leader を許容)
17. active 通常 House は active `house:leader` Office を持つ

Holding / Polity 命名（v0.41）:
- H7: 全 Holding が非空 `nameKey` を持つ
- H8: 各 Province の `holdingIds` 内で `Holding.nameKey` が一意（Province.nameKey との衝突・異 Province 間の重複は検査しない＝許容）
- P-name: `Polity.nameSource` の妥当性。`kind==='pool'` → `nameKey` 非空 / `kind==='holding'` → `holdingId` が実在 Holding を指す。switch は exhaustive

ProvinceOffice / Bailiff:
18. 全 Province が ProvinceOfficeAssignment (Bailiff) を持つ
19. provinceOfficeIndex の 3 方向整合 (byProvince / byHolderPerson / byAppointingPolity)
20. Bailiff の appointingPolityId が当該 Province の terminal Polity と一致

AnonymousHouse / placeholder:
21. AnonymousHouse (`h-anon`, kind: 'system') が 1 つだけ存在する
22. AnonymousHouse の memberIds はすべて placeholder Person
23. 通常 House の memberIds に placeholder Person が混入していない
24. placeholder Person の houseId は AnonymousHouse を指す
25. placeholder Person は marriage / spouse / childIds を持たない

Person / House の不変条件:
26. 死亡人物が役職を持たない
27. Person.sex が `'male' | 'female'`
28. 生存 Person の spouseId が双方向かつ有効、死亡者を指さない
29. 親子関係の双方向整合 (fatherId / motherId / childIds)
30. House の cadet 関係の双方向整合 (parentHouseId / cadetHouseIds)
31. House.memberIds に重複がない
32. Province.development / polityControl / PopGroup.size/wealth/unrest が範囲内
33. ability ≤ aptitude かつ両者が `[0, ABILITY_HARD_CAP=120]` の範囲内、死亡者の wealth が 0

PopGroup / Polity 数値範囲:
- Polity.legacyPrestige / House.legacyPrestige が 0..100 (型レベル + 範囲チェック)
- PopGroup.holdingId が有効な Holding を指す
- PopGroup.class が有効な PopClass、PopGroup.employed が boolean
- 同一 merge key (holdingId + class + employed) の POP が複数存在しない
- popIndex.byHolding の整合性（POP の holdingId と index が一致）
- OrganizationRef.kind は `'polity' | 'house'` のみ (型レベル)
- AttitudeTarget / attitude key に `country:` が残っていない (型レベル)

Project:
- 全 Project の id が key と一致
- terminal Project が state に残っていない
- creator / supervisor Person が存在する
- active Project の supervisor は alive
- origin.kind === 'aim' の場合、Aim が存在する
- projectIndex の 6 方向整合（byOwner / byAim / byParentProject / byCreatorPerson / bySupervisorPerson / byRelatedEntity）

Task:
- active Task の difficulty が 0〜100 の範囲内
- active Task の relevantAbility が有効な AbilityKey

DiplomaticOffer:
- terminal play の offer が cleanup 後に残っていない（残留 offer 検査）
- active/escalated play の currentOffer がある場合、issue-demand 整合性を検証:
  - land_claim: offer に `change_contract_tax_rate` が含まれない、`transfer_land_contract.holdingId === issue.holdingId`
  - contract_tax_revision: offer に `transfer_land_contract` が含まれない、`change_contract_tax_rate.landContractId === issue.landContractId`

DiplomaticPlay:
- land_claim / contract_tax_revision の active play は issue を持つ
- issue.kind と play.kind が一致する
- currentOfferId がある場合、対応する DiplomaticOffer が存在し offer.playId === play.id
- offerHistoryIds の全 offer が存在し全 offer.playId === play.id
- 非 revolt play に primaryDemand が存在しない

DiplomaticPlay status / 参加者:
- すべての entry の status ∈ {'active', 'escalated'} (terminal status は tick 末で削除される前提)
- initiator / target が存在する
- progress / tension は 0..100
- primaryDemand が有効な対象を指す（revolt_negotiation のみ）

DiplomaticPlay supporter（v0.43）:
- supporter actor は polity のみ・active（inactive supporter は cleanupTerminalDiplomacy §6.52 の sweep が無音除去する前提）
- initiator / target（primary）が supporters に混入しない
- 同一 side 内・両 side をまたいだ supporter 重複なし

Revolt:
- revolt_negotiation の initiator は commonwealth Polity
- revolt_negotiation の target は normal Polity

Commonwealth Polity:
- kind === 'commonwealth' なら ownerHouseId === undefined を許容
- commonwealth の active DiplomaticPlay の initiator になるのは revolt_negotiation のみ

HoldingOfficeAssignment:
- active HoldingOfficeAssignment の holderPersonId が alive または placeholder
- `contractedRemittanceRate` が 0..1
- `expectedFeeRate` が 0..1
- `contractedRemittanceRate + expectedFeeRate` <= `maxLocalExtractionRate * 1.1`
- 同一 Holding に active bailiff assignment が複数存在しない
- 同一通常人物が active bailiff assignment を複数持たない

collect_holding_revenue Task:
- targetRef.kind は `'holding_office_assignment'`
- targetRef.id が存在する active HoldingOfficeAssignment を指す
- placeholder 代官を holder とする collect_holding_revenue Task が存在しない
- 同一 assignment を target とする active collect_holding_revenue Task が複数存在しない

HoldingImprovement:
- id prefix が `hi-`
- holdingId が存在する
- kind が有効な HoldingImprovementKind
- level >= 1、level <= max level for Holding kind
- condition が 0..100（**v0.48.1 以降は生きたスカラー**: FacilityMaintenanceSystem §6.6b が減衰・回復・破壊を駆動。減衰 `max(0,…)` / 回復 100 / 部分崩壊 reset-100 / 全壊 delete は全て範囲内）
- 同一 holdingId + kind が複数存在しない
- `holdingImprovementIndex.byHolding` と実体が一致

ProjectStage（develop_holding のみ）:
- currentStageKey が有効な ProjectStageKey
- execute_project stage: progress / targetProgress は BaseProject の不変量に準ずる

ProjectBudget（develop_holding のみ）:
- budget.required / allocated / remaining / spent が >= 0
- active Project: `budget.allocated = budget.remaining + budget.spent`
- secure_budget 未完了なら allocated / remaining / spent は 0

Crisis（v0.48）:
- C1: Crisis.holdingId が実在する（holding は削除されない構造）
- C2: Crisis.responseProjectId は **存在する場合のみ** kind が `handle_crisis`。**不在は許容**（Pressure P1 パターン。担当者不在の放置 Crisis / cleanup 遅延を許す）
- C3: terminal（resolved / expired）Crisis は purge 済みで state に残らない（active のみ）。crisisIndex（byHolding / byProject）の forward 整合
- C4: active handle_crisis Project の budget 不変条件（非負・allocated = remaining + spent）+ holdingId 実在。**crisisId が指す Crisis の不在は許容**（C2 と対称。Project は `deadlineWeek = Crisis.deadlineWeek` を持つので dangling は必ず期限で解消）
- C5: Crisis.severity は 0..100、`deadlineWeek >= createdWeek`
- C6（v0.48.1）: kind=='disrepair' は `targetImprovementId` 必須（構造不変条件）。ただし指す improvement の**消滅（dangling）は throw せず許容**（FacilityMaintenanceSystem の防御 sweep が purge。transient window の誤検知回避、C2 と同型）

develop_holding Project:
- holdingId が存在する
- improvementKind が有効
- targetImprovementLevel が max level 以下
- 同一 holdingId に active develop_holding Project が複数ない

Selector range（debug モードのみ。`if (debug && config)` でゲート）:
- `localExtractionRate` が `[minLocalExtractionRate, maxLocalExtractionRate]`
- `collectionEfficiency` が `[minBailiffCollectionEfficiency, 1.0]`
- `bailiffFeeRate` が `[0, maxBailiffFeeRate]`
- `totalBurdenRate` が `[0, maxLocalExtractionRate]`

Province:
- terrain が有効な ProvinceTerrain
- features が配列で、各値が有効な ProvinceFeature、重複なし

HoldingImprovement（max-level access 反転）:
- valid kind は `VALID_HOLDING_IMPROVEMENT_KINDS = new Set(Object.keys(IMPROVEMENT_DEFINITIONS))` で判定（二重管理解消）
- max-level access を `holdingImprovementMaxLevelByKind[kind][holdingKind] ?? 0` に反転。`0`（未定義含む）= 建設不可なので `level > maxLevel` で違反（improvement entity / develop_holding project の 2 箇所）
- canBuild の terrain / feature ゲートは terrain 不変＋ improvement 生成が常に canBuild 経由のため構造的に保証（専用 runtime ループは設けない）

Config / Definition（const を回すのみ）:
- `IMPROVEMENT_DEFINITIONS` と config の各数値 Record が全 HoldingImprovementKind を持つ（コンパイル時保証の二重の保険）
- `allowedHoldingKinds` に含まれる holdingKind は maxLevel >= 1、含まれない holdingKind は maxLevel が undefined または 0、負値は不正
- `capacityRole === 'capacity'` の kind は `employmentSlots` の `capacityPerLevel` が正値で存在
- terrain / feature multiplier の invalid キーはコンパイル時担保（runtime チェック省略）

Capacity:
- 全 holding × class で `getHoldingClassCapacity` が NaN / Infinity / 負を返さない

Critical infrastructure（v0.52）:
- manor Holding は `manor_house` improvement を持つ
- city Holding は `town_hall` improvement を持つ

RealEstateAsset（v0.52）:
- id prefix が `re-`
- holdingId が存在する
- realEstateKind が有効な RealEstateKind（`REAL_ESTATE_DEFINITIONS` に存在）
- level >= 1、level <= maxLevel（`maxLevelByHoldingKind[holdingKind]`）
- kind が当該 holding の `allowedHoldingKinds` に含まれる
- owner が Person の場合: 当該 Person が存在する
- owner が House の場合: 当該 House が存在する
- owner が Polity の場合: 当該 Polity が存在する
- `realEstateAssetIndex.byHolding` / `byOwner` と実体が双方向整合（rebuild して件数比較）

RealEstateSeizure / LandContractDefault（v0.53、§6.70）:

**FK 存在検査は active entity のみ**: terminal（resolved / legalized / cancelled）entity は cancel 原因（asset 消滅・絶家・契約消滅など）により dangling 参照を持ちうるため、`terminalObligationRetentionWeeks` の retention 中は FK 免除（既存 terminal レコードと同じ扱い）。

- RealEstateSeizure（active のみ FK）: holdingId / assetId / seizerPolityId / rightfulOwner House が存在し `asset.holdingId === holdingId`。index `byAsset`（一意）/ `byHolding` / `byRightfulOwnerHouse`（配列を set 比較）が active のみで同期
- LandContractDefault（active のみ FK）: holdingId / occupiedByPolityId / claimantPolityId / targetLandContractId が存在。index `byContract`（一意）/ `byHolding` / `byClaimantPolity` / `byOccupierPolity`（配列 set 比較）が active のみで同期
- 全 entity: RealEstateSeizure の id prefix は `rs-`、LandContractDefault は `lcd-`。同一 asset に active seizure は最大 1、同一 contract に active default は最大 1、同一 holding に active `revolt_independence` default は最大 1。`origin` は `tax_default | revolt_independence`、`targetLandContractId` は両 origin で必須。`startedWeek <= absoluteWeek`、`lastContestedWeek` があれば `startedWeek <= lastContestedWeek <= absoluteWeek`、`accumulatedUnpaidAmount >= 0`、`originalTaxRateToGrantor >= 0`

War（`integritySystem.ts` §14 セクションに実装）:

War 基本:
- `war.id` が record key と一致・重複なし、`status` が有効な WarStatus、`startedWeek` が finite
- `endedWeek` がある場合 `endedWeek >= startedWeek`
- `warScore` が finite かつ `-100..100`、`targetWarScore` が `0 < x <= 100`

active / terminal 整合:
- `status === 'active'` → `endedWeek` は undefined
- `status !== 'active'` → `endedWeek` は defined

participant（v0.43 で multi-participant 化）:
- `attacker.key === 'attacker'` / `defender.key === 'defender'`
- 各 side `participants.length >= 1`（v0.43 で 1 件固定から緩和）、primary participant は各 side ちょうど 1 人
- 全 participant.actor.kind === 'polity'（v0.43。DiplomaticPlay→War の経路が polity 限定のため）
- 同一 side 内で actor 重複なし / attacker・defender side 間で actor 重複なし（v0.43）
- **active War のみ** participant actor（primary / supporter とも）が active であること（`isActiveActor`）を要求。terminal War（cancelled / attacker_won / defender_won / white_peace）は retention 中の inactive 化を許容。この検査が成立するのは `cancelOrphanedWarsSystem`（§6.47）が primary 消滅 active War を cancelled 化し、inactive supporter を participant から無音除去するため（いずれも integrity より前）

WarGoal（**参照存在は active War のみ要求。participant 検査と対称**）:
- transfer_land_contract: holding / fromPolityId / toPolityId が存在、`fromPolityId !== toPolityId`、`requiredWarScore > 0`
- change_contract_tax_rate: holding / landContract が存在、`landContract.holdingId === goal.holdingId`、`newTaxRateToGrantor` が `0..1`、`requiredWarScore > 0`
- **存在検査（holding / polity / landContract）は `status === 'active'` の War のみに適用する。** terminal War（attacker_won / defender_won / white_peace / cancelled）の WarGoal は和平適用済みの**凍結履歴データ**であり、`terminalWarRetentionWeeks` の retention 中に別システム（税率改定外交の contract 排除・併合など）が参照先を消しても違反としない（cleanup までの dangling を許容）。active War で参照先が stale になったケースは PeaceSettlementSystem（§6.46）が `white_peace` で安全終結させるため、active で残る dangling は無い。
- range / value 検査（`requiredWarScore > 0`、`fromPolityId !== toPolityId`、税率 `0..1`）は凍結値の不変条件なので status に関わらず常に検査する。

originDiplomaticPlayId は weak ref のため存在検査しない（cleanup 済みを許容。§3.9a）。

warIndex（双方向。Faction index パターン踏襲）:
- `byParticipant[key]` の各 warId が存在し、その War に key 一致の participant がいる（forward）
- active War の各 participant key が `byParticipant` に warId を持つ（reverse）
- `byOriginDiplomaticPlay[playId]` の指す War が存在し `originDiplomaticPlayId` が一致（forward）

Chronicle（index↔entry の内部整合のみ）:

chronicleIndex ↔ chronicleEntries（§3.14）:
- forward: `byPerson` / `byHouse` / `byPolity` / `byProvince` / `byHolding` / `byWar`（v0.49）の各 index に載る entry id が `chronicleEntries` に実在し、その entry の entityRefs に対応する `(kind, key)` を含む
- reverse: 各 entry の 6 index 対象 kind（person / house / polity / province / holding / war）の ref が、対応 index に entry id として登録済み（faction / clan 等 index 非対象 kind の ref は検査しない）。**v0.49**: `EventEntityKind` に `'war'` を追加し `indexBucketForKind` に `case 'war' → byWar` を足した。warEvents の `emit()` が `params.warId` を持つ war event に `entityRef('war', warId)` を単一チョークポイントで自動付与し、WAR_*/PEACE_SETTLEMENT_APPLIED/BATTLE_OCCURRED を漏れなく byWar 化する
- **entityRefs の参照先が現在 state に存在するか（active か / 死亡人物か / 断絶家か / 終了 War か）は検査しない。** ChronicleEntry は過去の記録であり、消えた entity への soft reference を保持するのが正しい（warIndex の `originDiplomaticPlayId` 同様、存在検査を意図的に省く）。これは「Chronicle を simulation logic に使わない」原則（§3.14）の integrity 表現であり、存在検査へ「修正」してはならない（長期実行で誤検知を生む）。

### 6.36 ProjectPreparationSystem（4週ごと）

active Aim を走査し、必要に応じて `prepare_project` Task を生成する。走査対象は `aim.origin === 'goal_driven'`。person-owned Aim は原則除外するが、v0.44 で `improve_ability` Aim のみ allowlist で許可する（→ `personal_training` Project。§6.66）。本 system は **prepare_project Task の生成のみ**を行い、Project 本体は生成しない（Project は prepare_project Task 完了時に `buildProjectFieldsForAim` 経由で作成される。§6.55 / taskProjectCompletion）。stage の即時解決（find_supervisor / secure_budget）は ProjectStageSystem（§6.38）が担当する。

**抑制条件**: `projectIndex.byAim[aim.id]` に active Project が存在する / `aim.activeTaskId` が設定中 / `aim.activeDiplomaticPlayId` が設定中 / `nextProjectAllowedWeek` 未到達。

AimKind → ProjectKind マッピング（`aimKindToProjectKind`）:
- Polity: `consolidate_province_holdings` / `seize_weak_remote_holdings` → `acquire_land`、`develop_owned_holding` → `develop_holding`、`improve_owned_contract_terms` / `eliminate_overlord_contract` → `improve_contract_terms`、`demand_tax_increase_from_vassal` / `eliminate_vassal_contract` → `demand_tax_increase`
- House: `acquire_political_right` → 同名（v0.42 — 旧 `increase_polity_share` → `expand_polity_share` は廃止）、`steer_polity_*` → `promote_policy_shift`、`patronize_artist` / `commission_chronicle` → 同名
- Person: `improve_ability` → `personal_training`（v0.44。supervisor は本人固定で `selectProjectSupervisor` を通らない）

`selectProjectCreator` で起案者を選定（候補なしなら待機）。prepare_project Task の assignee は creator。生成後に `aim.activeTaskId` / `nextProjectAllowedWeek` を設定する。

**commonwealth アリーナ化（派閥拡大 Phase 7 追補・creator/supervisor 母集合）**: 起案者・監督者の候補母集合 `getCandidatePersonIds`（polity owner では `getPolityPersonIds` 経由）は所属 House の member を集めるため、ownerHouse を持たない established commonwealth では空になり、`selectProjectCreator` が常に undefined を返していた。結果、goalMaintenance → pickPolityAim で **Goal・Aim までは生成されるが Project に到達できず**、共和国は Goal 駆動の行動（領地集約 `acquire_land` / 開発 `develop_holding` など）を一切起こせなかった（Crisis/Pressure 経路は `getPolityLeader` を直接 creator に据えるフォールバックを持つため影響を受けず動いていた）。これを解消するため `getCandidatePersonIds` の polity 経路に `getRepublicPoliticalCandidatePersons`（§6.68）を union する（非 established / 非 commonwealth では空配列を返すため kingdom には無害・bit-identical）。creator と supervisor（`getSupervisorCandidatePersonIds` 経由）の双方に効く。実測（tiny 150年 seed1）: commonwealth 保有の aim 由来 Project が 0 →（acquire_land 4 / develop_holding 1）に回復し、kingdom と同様に Goal→Aim→Project が回るようになった。これは §6.68 派閥アリーナ化 Phase 7 の (3) として後述の代官・polity 役職と同じ候補プールを Project パイプラインへ拡張するもの。

### 6.37 SellLandProjectGenerationSystem（48週ごと）

Polity の財政難から直接 sell_land Project を生成する（prepare_project Task を経由しない）。`origin: { kind: 'system', reasonKey: 'fiscal_pressure' }`。

### 6.38 ProjectStageSystem（毎週）

active Project の immediate stage を即時解決する。毎 tick 実行（intervalWeeks: 1）。

**immediate stage handler**:
- `find_supervisor` (develop_holding): 対象 Holding に active な Bailiff がいればそれを supervisor に採用し、Project 期間中の任期交代から保護（termProtect）。Bailiff 不在時は `selectProjectSupervisor`（能力・workload ベース、母集合は owner の関係者＋食客 — §4.9 参照。v0.45.3: 性別役職適格ゲート §6.19 を適用、gated 空振り時は `allowFemaleRolesWhenNoMaleCandidate` が true の場合のみ ungated 再試行）で再選定し、候補ゼロなら creator に倒して必ず次 stage へ進む（creator 自己監督への倒れは gate 対象外 — 自分の project を自分で見るのは地位ではない）。旧実装の bailiff 候補探索カスケード（right holder 家→creator 派閥→owner 家→influence 家→influence 家系派閥の全メンバー）は廃止 — 旧仕様「担当者をそのまま代官に直接任命」の名残で、owner と無関係な人物（influence 家の派閥の平メンバー）まで負荷を見ずに supervisor へ引き込んでいた。候補ゼロ時に find_supervisor で永久 stall する経路も本変更で解消
- `secure_budget` (develop_holding): owner treasury から budget 確保
- `open_diplomatic_play` (acquire_land / sell_land / improve_contract_terms / demand_tax_increase): DiplomaticPlay を作成し、Pressure を生成。preparation / leverage / commitment を DiplomaticPlay に転写。重複チェックあり（duplicate → Project failed）。play 作成と同時に initiator の初期 DiplomaticOffer を生成
- `choose_stance` (respond_to_pressure): 軍事力比較で stance 決定（target < source×0.5 → concede、target ≥ source×1.2 → resist、else → negotiate）。この式は `selectors/pressureStanceSelectors.ts` の `predictPressureResponseStance`（閾値 `PRESSURE_CONCEDE_POWER_RATIO`=0.5 / `PRESSURE_RESIST_POWER_RATIO`=1.2）として外出しされ、外交劇の開始可否ゲート（減税系 aim 選定 §6.57、税改定 play 生成 §6.42）と**同一の式を共有**する。「開始時に予測する相手の応答」と「実際の応答」が必ず一致する単一の真実。**性格シフト（`personAbilityEffectsEnabled`、default ON）**: nominal power はそのままに、concede/resist の両境界を被圧力側（target）の意思決定者（polity=指導者 / house=当主）の性格で同量シフトする。「大胆さ」軸 `shift = ambition×pressureStanceAmbitionShift − caution×pressureStanceCautionShift`（各 0.1、`normalizedTrait` で中点 0.5 基準）を両境界から引く＝大胆な宗主は不利でも拒否しやすく譲歩しにくい / 慎重な宗主は早く譲歩する。両境界を同量動かすので concede < resist の順序は保たれる。OFF 時は厳密に従来挙動。開戦ゲート（§6.44）は regiment 勝率で別軸に判定するため、ここに regiment 戦力は持ち込まない（aim/play ゲートへ 0 動員エッジを波及させないため、勝率精度は開戦判断に閉じ込める意図的な非対称）。
- `propose_initial_offer` (respond_to_pressure): target 側が stance に基づく counter-offer を生成。concede → initiator の offer demands をコピー、negotiate → 中間案（land_claim: pay_wealth ×1.3、contract_tax_revision: halfway rate）、resist → status_quo。counter-offer 作成時に progress += counterOfferProgressDelta

**runtime fallback**: invalid な currentStageKey を持つ active Project に initial stage を補正する（防御的補正）。

### 6.39 ProjectTaskGenerationSystem（毎週）

active Project の currentStageKey に応じて Task を生成する。immediate stage はスキップ。

**(kind, stageKey) → TaskKind マッピング**:
- final stage → `advance_project` (develop_holding, acquire_political_right, etc.)
- preparatory stage → 専用 TaskKind (prepare_claim → gather_claim_evidence, prepare_offer / prepare_argument / prepare_response → prepare_argument)
- negotiate stage → `selectDiplomaticTaskKind(state, config, play, side, stance?)` で DiplomaticPlay の状態に基づき決定。respond_to_pressure の場合は stance に応じた優先度調整。**v0.43**: `seek_diplomatic_support`（supporter 勧誘）が選択肢に加わる — 基本条件（play active / 自 side supporter 数 < `maxDiplomaticSupportersPerSide` / 候補 polity が 1 つ以上）を満たし、かつ tension >= `diplomaticPlayEscalationThreshold × 0.6` または revolt rebel side なら **critical-deficit 分岐（prep/lev/commit < 30）より先に**返す（新規 play は必ず deficit 状態で始まるため、プール参加だけでは実質発火しない）。優先条件を満たさない場合も通常の候補スコアプールに base 7 + charisma 補正で参加する。**v0.47.2（ルートA）**: 旧来は revolt の suppressor=target side を基本条件で対象外にしていたが、これを撤廃し鎮圧側も支援募集できるようにした（反乱軍だけが第三国を巻き込み鎮圧側が永久に援軍ゼロという非対称が叛乱成功率を押し上げていたため）。suppressor 側は `isRevoltRebelSide` の無条件優先は持たず、tension が escalation に近づいた段階で反応的に募集を優先する（弱い反乱軍は週 1 から必死に勧誘 / 強い統治者は脅威が高まってから動く、という非対称を残す）

**negotiate stage の共通フロー** (§12.5):
1. project.diplomaticPlayId から DiplomaticPlay を取得（terminal なら Project cancelled）
2. project.owner と play.initiator/target を比較して side 判定
3. activeTaskIds の上限チェック
4. selectDiplomaticTaskKind で TaskKind 決定（stance 反映）
5. Task を生成（targetRef = diplomatic_play、assignee = delegate）
6. play の activeTaskIds に追加

**revolt_negotiation タスク生成**: Project ループの後に、active revolt_negotiation play に対して直接タスクを生成。Project を経由しないが、共通フローの手順 3-6 と同様のロジックで両陣営（initiator = commonwealth leader、target = polity delegate）にタスクを割り当てる。initiatorDelegatePersonId は play 生成時に commonwealth leader に設定される。

### 6.40 ProjectMaintenanceSystem（4週ごと）

active Project の状態更新。owner inactive → cancelled、origin Aim が non-active → cancelled、supervisor 死亡 → 再選定（失敗なら failed）、deadline 超過 → failed、progress >= targetProgress → completed。

**develop_holding 追加処理**:
- find_supervisor / secure_budget の immediate stage の解決は ProjectStageSystem（§6.38、毎週）が担当する（本 system では retry しない）
- deadline は execute_project stage のみに適用（準備段階では treasury 回復・人材確保を待機可能）。deadline は `projectDeadlineWeeksDevelopment × (targetProgress / projectDefaultTargetProgress)` で算出。Level 2 (×2) / Level 3 (×3) の大規模工事に比例した期間を確保
- budget.remaining が消費額未満の場合は Project を failed にする（追加予算は future）

**v0.59 追補③: ボトルネック資源への生産性投資（`buildProjectFieldsForAim` の develop_holding 決定）**

`develop_owned_holding` Aim から develop_holding Project を作る際、`buildProjectFieldsForAim`（§6.55 / taskProjectCompletion）が「capacity 増設（不動産 = develop_real_estate）」「productivity 改良（production_quality improvement = develop_holding）」「汎用 improvement」のいずれを建てるか決める。v0.59 追補③でこの決定木の**先頭に productivity 分岐**を追加した。

- **背景**: 旧決定木は `hasCapacityPressure || hasEmploymentSlack → capacity` で止まり、capacity をひたすら増設していた。だが食料 carrying capacity が職枠 capacity を下回る世界では、増設した職枠は食料に縛られた人口では永遠に埋まらず無駄になる（灌漑 `irrigation_infrastructure` は配線済みだが一度も建たず消滅していた）。
- **判定**: holding が生産する資源（asset の recipe outputs を asset 種別別に静的列挙 = `getHoldingProducedResourcesByAssetKind`）のうち**ボトルネック度** `getResourceBottleneckSeverity` ≥ `bottleneckShortageSeverityThreshold`(0.2) のものがあり、かつその資源を boost する buildable な production_quality 改良（`IMPROVEMENT_BOOSTED_REAL_ESTATE_KINDS` 逆引き）が存在すれば、capacity 分岐より先にその改良を建てる（`selectProductivityImprovementForBottleneck`、`selectors/productivityBottleneckSelectors.ts`）。severity 最大 → level 最小 → kind 名昇順で決定的に選ぶ。
- **ボトルネック度 = `max(市場 shortageSeverity, 食料 pressure シグナル)`**。食料資源（`FOOD_RESOURCE_VALUE`）はマルサス的に人口が供給ちょうどに自己制限するため**市場が均衡し shortageSeverity≈0** になり市場シグナルでは検出できない。代わりに人口圧（state人口/食料CC、`getProvincePopulationPressure`）が `foodBottleneckPressureThreshold`(0.9) 以上なら pressure 値を severity に採用する。非食料資源は市場 shortage のみ。
- **`hasEmploymentSlack` では gate しない**: 食料束縛 holding は人口が capacity 未満で全員就業（slack 無し）になりうるため、ボトルネック検出自体をトリガにする。自己調整的（改良 → 食料 output↑ → CC↑ → 人口↑ → pressure 低下 → capacity 建設へ戻る）で、`canBuildHoldingImprovement` の `currentLevel < maxLevel`（灌漑 max 3）が自然な上限。RNG 不使用＝決定性維持。
- **灌漑の全地形建設可（degate）**: `irrigation_infrastructure` の `allowedTerrains` / `requiredAnyFeatures` ゲートを撤去（`allowedHoldingKinds: ['manor']` は維持）。代わりに改良 kind × terrain/feature の**コスト割引テーブル** `holdingImprovementTerrainCostMultiplier` / `holdingImprovementFeatureCostMultiplier` を新設（既定: 灌漑は wetlands 0.8 / major_river 0.8 / lake 0.85、coastal=割引なし）。コストは共有 helper `computeImprovementProjectCost` で `base × level乗数 × terrain乗数 × Π feature乗数 × budget margin`。
- **balance-defer（§4・値は据え置き）**: `foodBottleneckPressureThreshold`・`bottleneckShortageSeverityThreshold`・割引率。tiny 実測では灌漑が消滅しなくなり高 pressure seed で level 2-3 へ伸びるが、集計の食料CC・人口への寄与は default 値では小さい。強度調整は後段。

### 6.41 ProjectOutcomeSystem（4週ごと）

terminal Project の効果解決・ログ出力・cleanup を担当。

- 非外交系 Project: treasury/wealth/prestige 等の直接効果を適用し、Aim progress を加算
  - **文化系 Project の afford 前提**: `patronize_artist` / `commission_chronicle` / `acquire_political_right` は完了時に `house.wealth >= cost` を要求する。これらの Project は**作成時**に afford 判定する（§6.55 `buildProjectFieldsForAim`）。作成時に払えなければ Project を生成せず Aim を待機させ、wealth 回復後に再試行する。これにより doomed Project が生成されず、完了時に資金不足で効果を何も適用しない silent no-op を防ぐ。
- 外交系 Project: DiplomaticPlay 生成は ProjectStageSystem の open_diplomatic_play handler に移管。ProjectOutcomeSystem は外交系 completed 時に追加効果を適用しない（交渉への影響は各 Task outcome で DiplomaticPlay に反映済み）
- respond_to_pressure completed: Pressure.status を 'responded' に遷移
- **義務系 Project（v0.53、§6.70）**: `seize_real_estate_income` completed → `createRealEstateSeizureMut` で RealEstateSeizure（status=active）を作成。`withhold_land_contract_tax` completed → `createLandContractDefaultMut` で `origin='tax_default'` の LandContractDefault を作成。`enforce_obligation` completed → 対象 seizure/default を resolved にし、active enforce 追跡（`entity.activeEnforceProjectId`）を解除。これら 3 kind は self-executed で reputation を付与しない（`PROJECT_REPUTATION_CATEGORY_MAP[kind] = undefined`）。作成に伴い `realEstateSeizures` / `landContractDefaults` collection・index・`next*Id` を mutable draft writeback slice に含める
- **handle_crisis completed（v0.48）**: Crisis を resolved にして即 purge し `CRISIS_RESOLVED` を emit（budget 返金は develop_holding と同一一般化）。ただし **unrest Crisis は purge せず resolved を mark** し、UnrestCrisisSystem（§6.29a）が譲歩/鎮圧を適用してから purge する
- **成果経験・評判付与（v0.44）**: 非外交 Project は削除直前に supervisor へ即時成長 + PersonReputation を付与する（§6.66）。terminal Project の `terminalReason` が未設定なら throw（terminal サイトのセット漏れを fail-fast で顕在化。年末 integrity は flush 後で検出できないため）
- Project を state.projects / projectIndex から削除

**develop_holding completed 時の追加処理**:
1. HoldingImprovement を作成（新規）または level up（既存）
2. `budget.remaining` → `supervisor.wealth`（成功報酬・節約分の取り分）
3. `project_completed` PersonActivityLog を supervisor に追加（params に improvementKind / targetLevel / holdingId）
4. creator → supervisor / owner leader → supervisor の respect を小幅上昇（`projectCompletedRespectGain`）

**develop_holding failed 時の追加処理**:
1. `budget.remaining` → owner に返金
2. `project_failed` PersonActivityLog を supervisor に追加

### 6.42 DiplomaticPlaySystem（4週ごと）

active な DiplomaticPlay を進行させる。

- structuralProgress は `structuralProgressFactor`（0.33）で弱化する。delegate 選定・交渉パラメータ更新を行う。
- Task 生成責務は ProjectTaskGenerationSystem にある。DiplomaticPlaySystem は原則として Task を生成しない（delegate 生存確認・再任、progress/tension 管理、settlement/escalation/failed/cancelled 判定を担当）。
- revolt_negotiation もタスク駆動。Project は持たないが、ProjectTaskGenerationSystem が active revolt_negotiation play に対して直接タスクを生成する（両陣営）。ハイブリッドモデル: タスク効果が主（preparation/leverage/commitment → 閾値調整）、環境因子（POP unrest/鎮圧力）が副（小幅構造的増分）。delegate の能力が交渉結果に影響する。
- settlement は accepted offer によってのみ成立する（offer-driven ハイブリッドモデル）。progress は settlement 判定に使わず UI 表示値として維持する。

**メインループ（land_claim / contract_tax_revision）**:

```txt
for each active play:
  1. orphan check (issue-based, cancelOrphanedPlays)
  2. structural update: tension += baseTensionGain * structuralFactor
  3. offer evaluation check:
     if currentOfferId exists AND currentOfferId !== lastEvaluatedOfferId:
       a. validateOffer
       b. if invalid → reject, set lastEvaluatedOfferId
       c. if valid → progress += validOfferProgressDelta, evaluateOffer
       d. if accepted → applySettledOffer, play.status = 'settled'
       e. if rejected → tension += evaluation.tensionDelta, set lastEvaluatedOfferId
  4. escalation check: tension >= escalationThreshold → escalateOrStandDown（§6.44b）
  5. deadline check: deadline 到達 → escalateOrStandDown（§6.44b、failed なし）。
     offer は step 3 で必ず評価済みのため、deadline 時点で未評価 pending offer は存在しない。
```

**escalateOrStandDown（v0.47.3 §6.44b）**: land_claim / contract_tax_revision の escalation 判断（tension・deadline の 4 サイト）は、もはや無条件に `escalated` へ倒さず、`escalateOrStandDown`（`tick/diplomaticPlayHelpers.ts`）を経由する。外交劇は「交渉」なので低勝率でも仕掛けてよいが、**戦争化が見える局面（escalation 直前）では勝てない戦争を見送る**。判定式は War 化直前の開戦ゲート（§6.44）と**完全に同一**（`winChanceWarGateEnabled && estimateAttackerWinChance < calcGeneralDeclareThreshold`、revolt_negotiation / 非 polity は対象外）＝「開始時予測 = 実際の判定」の単一の真実を共有する。勝てないと判断した場合は escalate せず `settled` / `status_quo` で撤退し（initiator smallFailure / target smallSuccess。§7.3 の award 意味論で「戦争に至らなかった測定可能な外交相互作用」を残す）、`DIPLOMATIC_PLAY_SETTLED`（messageKey `diplomatic_play.stood_down`）を emit する。勝てる場合は従来通り `markPlayEscalated` で `escalated` に倒す。なお §6.44 の War 化直前ゲートは backstop として残置する（escalateOrStandDown は同 tick の他 play による動員消費**前**、§6.44 は消費**後**に判定するため、A をすり抜け §6.44 で `WAR_AVERTED`（voided）になる play が残りうる＝「勝てなかった」終結が status_quo（撤退）と voided（war gate）の 2 ラベル併存。許容トレードオフ）。**要求幅の動的調整（低勝率なら条件を緩める / 高勝率なら吊り上げる）は未実装（A2 として宿題）**。

`revolt_negotiation` は offer-driven 化の対象外で、タスク駆動ハイブリッドモデルで進行する（下記参照）。

**evaluator の決定**: `currentOffer.proposedBy` が initiator なら evaluator は target、逆も同様。

**applySettledOffer**: accepted offer の demands を `applyDemand(ctx, play, demand, allDemands)` で順に適用する。`allDemands` 引数により `transfer_land_contract` の reason を導出（`pay_wealth` あり → 'purchase' / なし → 'cession'）。

**evaluateOffer**: PlayKind 別に offer.demands からパラメータを抽出し score を計算。score >= 0 → accepted、score < 0 → rejected。評価時点の preparation / leverage / commitment が score に反映される。

Play kind 別の処理:
- `land_claim`: demands から `transfer_land_contract` / `pay_wealth` / `status_quo` を抽出し evaluateLandClaimOffer で score 計算。settlement 時は `applySettledOffer` で demands を適用。rank ベースの契約選択 (3-a/3-b/3-c) と操作 (5-a/5-b/5-c) は維持。
- `contract_tax_revision`: demands から `change_contract_tax_rate` / `pay_wealth` / `status_quo` を抽出し evaluateContractTaxRevisionOffer で score 計算。`taxRevisionInitialDemandDelta` (0.10) を初期要求幅とする。下限 5% / 上限 80% 超で契約破棄。Play 決着時（成否問わず）に `termsProtectedUntilWeek` を設定。`applyChangeContractTaxRate` で `newRate <= taxRevisionMinRate` または `newRate >= taxRevisionMaxRate` の場合、率変更の代わりに `eliminateContractFromChain` で契約取消しを実行する（settlement / conflict 両経路共通）。status_quo 和平時は CONTRACT_TAX_REVISED を emit しない。
- `revolt_negotiation`: `popular_tax_relief` demand ベースのタスク駆動ハイブリッドモデル。タスク効果（negotiate_terms/pressure_counterparty 等）が preparation/leverage/commitment を更新し、決着閾値を調整（initiator preparation/leverage が高いほど妥結しやすく、target commitment が高いほど激化しやすい）。環境因子（acceptanceScore: POP unrest/鎮圧力/税率負担）は小幅構造的増分として副次的に作用。settlement → 税率引下+commonwealth 解散。escalation → **現 terminal holder の rank** で分岐（rank 2-4 は nominal occupation 契約〔v0.53 で revolt_seizure から置換。§6.29 / §6.70〕+Local Levy+War、rank 5 は internal revolt 即時解決（§6.30））。play.target ではなく現 terminal holder を見るのは、交渉中の再分封で play.target が stale 化しても §25 #7 を破らないため。

**契約取消し aim**: `eliminate_overlord_contract`（`taxRateToGrantor <= taxRevisionMinRateForReduction` で発火）/ `eliminate_vassal_contract`（`taxRateToGrantor >= taxRevisionMaxRateForIncrease` で発火）。既存の `improve_contract_terms` / `demand_tax_increase` project に mapping し、desiredRate が min/max 境界にクランプされる。escalation → conflict で勝利した場合に CONTRACT_ELIMINATED が発生する。両 Goal（external_expansion / internal_development）から候補に入る。

**futile な reduction-elimination の無限再発防止（v0.47.x）**: reduction 側の契約取消し（`eliminate_overlord_contract`）は「自契約の親 = overlord 契約」を `eliminateContractFromChain` で除去して grandparent に再接続する操作。overlord が**主権者（root 契約のみ保持）**の場合や、overlord 契約が既に別経路で除去済みの場合、除去対象が存在せず勝利しても構造変化が起きない。3 層で防ぐ:
  1. **aim 発火ゲート（`goalSelectors`）**: `eliminate_overlord_contract` は「自契約の親契約が存在しかつ非 root」のときのみ候補化する（除去可能な中間 overlord がある場合のみ）。
  2. **play 生成ゲート（`createContractRevisionPlayFromProjectMut`）**: reduction かつ desiredRate が境界（`<= taxRevisionMinRate`）= 取消し意図の play は、対象（自）契約の親が無い / root なら `infeasible` を返し生成しない。`improve_owned_contract_terms` aim が時間差で税率を境界まで下げてしまうケース（project 作成時は tax>0.15 でも、prep stage を経て play 生成時には ≤0.15 に下がっており境界要求になる）もここで弾く。
  3. **適用時の安全網（`applyTaxGoal` / §8.6）**: 万一 reduction-elimination の War が成立しても、除去対象の非 root 契約が chain に無ければ `applied:false` を返し `white_peace` で終結する（旧実装は `applied:true` を返し「契約が解除された」イベントを emit していたため、同一 holding への解除戦争が無限再発し偽の解除ログが連発していた）。

**取消し意図の play 生成段階での復元（v0.47.x）**: aim→project への mapping で「取消しか単なる率改定か」の区別が落ちる（両者とも `improve_contract_terms` / `demand_tax_increase` に縮退）ため、play 生成（`createContractRevisionPlayFromProjectMut`）は aim 発火と**同じ閾値条件**で desiredRate を決める — increase 側は `currentRate >= taxRevisionMaxRateForIncrease` なら `taxRevisionMaxRate`（境界）を、reduction 側は `currentRate <= taxRevisionMinRateForReduction` なら `taxRevisionMinRate`（境界）を直接要求し、それ以外は従来どおり ±`taxRevisionInitialDemandDelta` を要求する。これにより取消し意図が勝利時に確実に CONTRACT_ELIMINATED へ繋がる。**旧実装の不整合**: 旧 play 生成は常に `clamp(currentRate ± delta)` で要求していたため、increase 側は aim 発火閾値（0.6）と「+delta が上限 0.8 に届く」境界（0.7）が食い違い、税率 `[0.6, 0.7)` の取消し意図が黙って +delta の増税に縮退していた（reduction 側は閾値 0.15 = min 0.05 + delta 0.10 で偶然整合していたため bit-identical）。

**境界クランプ = 取消しシグナルの単一判定（`isContractEliminationRate(rate, config)`、`selectors/landContractSelectors.ts`）**: 「newRate が `<= taxRevisionMinRate` または `>= taxRevisionMaxRate`」を 1 関数に集約し、(1) 平和決着の CONTRACT_ELIMINATED / CONTRACT_TAX_REVISED 出し分け（`diplomaticPlayLandTax`）、(2) 戦争イベント `WAR_DECLARED` / `PEACE_SETTLEMENT_APPLIED` の描画出し分け、(3) WarDetail UI のラベル出し分けが共有する。**戦争経路の描画（v0.47.x 修正）**: 税率改定 WarGoal でも newRate が境界クランプなら「税率改定（X%→Y%）」でなく「土地契約の解除」として描画する（`war.declared.dissolve_contract` / `war.peace_settlement.dissolve_contract`、UI は `detail.war.goal_dissolve_contract`）。旧実装は戦争経路だけがこの出し分けを欠き、現税率が既に上限 80% の契約取消し War が「税率（80%→80%）を巡り宣戦布告」という no-op 表示になっていた（平和的外交劇の決着経路は当初から出し分け済み）。

**税改定 play の受諾見込みゲート（`createContractRevisionPlayFromProjectMut`）**: play 生成時に `predictPressureResponseStance(initiator, target) === 'resist'`（target が initiator の 1.2 倍以上強い）なら `{ kind: 'infeasible' }` を返し play を生成しない。呼出側（ProjectStageSystem）は project を `failed` にして actor を別行動へ解放する（`invalid_inputs` の毎 tick retry と異なり再試行ループにならない）。これは減税系 aim 選定の受諾見込みゲート（§6.57）と同一 predicate を共有する**二重の安全網**で、主因の抑止は aim 選定側が担い、本ゲートは aim 生成後に戦力比が変化した稀ケースを最終的に弾く（通常運用では発火 0）。これを欠くと「resist 確実な相手への外交劇が generate→status_quo 妥結を繰り返し、何も変わらない play が連発される」。`canTransferLandContract` の rank ゲート（§6.44）と同じ「1 式・複数ゲート」構成。

**同家 polity 間の play 禁止（v0.45.2）**: initiator / target の `ownerHouseId` が同一（`politiesShareOwnerHouse`、`selectors/polityRelations.ts`）の play は生成しない（`createLandClaimPlayFromProjectMut` は sell_land 含め `invalid_inputs`、`createContractRevisionPlayFromProjectMut` は `infeasible`）。1 つの家が宗主-臣下チェーンの両端 polity を所有した場合（分割継承等）に互いへ税改定要求 → 同家戦争が起きるのを防ぐ。主ゲートは aim 選定（§6.57）と project target 解決（`taskProjectCompletion` の `findAcquireTargetForProject` / `findImproveTargetForProject` / `findDemandTaxIncreaseTargetForProject` — 同家候補は次候補へ skip）にあり、ここは生成までの間に ownership が変わった場合の安全網。`ownerHouseId` が undefined の側（commonwealth 等）はゲート対象外（別家扱い）。副作用として、同家チェーン内の税率は play では動かなくなる（1 家複数 polity 状態自体の再設計は将来の polity 統合 / 家設立制限の課題）。

### 6.43 ConflictResolutionSystem（no-op）

revolt_negotiation の escalation は warCreationSystem 経由で War 化されるため、本 system は完全 no-op。関数名 `runConflictResolutionSystem` は後方互換のため維持するが、本体は `return ctx` のみ。

### 6.43a WarSupplySystem（毎週、v0.51）

active War の各 side について補給状態を毎週更新する。Kill-switch: `warSupplyEnabled`（default true）。`warEnabled` が false なら即 return。

**tick 順序**: ConflictResolutionSystem の後、WarManeuverSystem の前に走る。WarSupplySystem が org/morale/strength を削った結果が同週の battle effectivePower に反映される。

**staff lazy refresh**: strategist（`strategy` role）/ quartermaster（`stewardship` role）を `selectWarStaffForSide` で毎週 lazy 選出する。候補母集合は captainGeneral / commander と同じ `getPolityWarCandidatePersonIds`（side 全 polity から列挙）。captainGeneral および既選出 staff を exclude。欠員時は captainGeneral が兼任（score × `warSupplyStaffAbsentScoreMultiplier`=0.75）。

**supply ループ**: 各 active War、各 side について:
1. staff refresh → 2. province 解決（getWarGoalProvince。undefined なら decay-only skip）→ 3. regiment 集計（supplyDemand ≤ 0 なら decay-only skip）→ 4. supplyAccess / forageEfficiency 再計算 → 5. supplyPressure 蓄積更新（前週 localHostility を参照）→ 6. localHostility 蓄積更新（今週 supplyPressure を参照）→ 7. plunderPressure 蓄積更新（今週両方を参照）→ 8. shortage band 判定 → 9. regiment attrition（band 別 org/morale/strength damage。cavalry は `cavalrySupplyAttritionMultiplier` 倍）→ 10. collapse risk（catastrophic のみ、RNG ロール → `destroyRegimentMut`）→ 11. 通常徴発 condition damage（primary holding の storage_infrastructure。silent）→ 12. harsh requisition（threshold + RNG → condition/wealth/unrest damage + event）→ 13. plunder（threshold + RNG → condition/wealth/unrest damage + war_damage Crisis + event）→ 14. retroactive adjustment（supplyRelief / hostilityGain / plunderRelief を最終値に反映）→ 15. supplyState 書き戻し

**war_damage Crisis**: plunder 時に `createCrisisMut` で直接生成（`spawnWarDamageCrisis` は呼ばない。理由: 全 improvement 一律 condition -40 + POP size -2% が二重計上・POP casualties 不導入と矛盾）。既存 active war_damage があれば severity 加算 + deadline 延長。新規生成時は `resolveCrisisHandlers` + `createHandleCrisisProjectMut` + `CRISIS_CREATED` event。

**新 Event**: `SUPPLY_ATTRITION`（normal/major）、`SUPPLY_HARSH_REQUISITION`（normal）、`SUPPLY_PLUNDER`（major）。いずれも warId を messageParams に含み、entityRefs に war ref を含むため `chronicleIndex.byWar` に載る。

**新 selector ファイル**: `selectors/warSupplySelectors.ts`（computeSupplyAccess / computeForageEfficiency / computeSupplyDemand / computeCavalryRatio / computeShortageBand / selectWarStaffForSide / getProvinceAveragePopUnrest / isFriendlyTerritory）

**新 mutation ファイル**: `mutations/holdingImprovementMutations.ts`（`damageHoldingImprovementConditionMut`。選択的 condition damage。targetKinds で improvement 種別をフィルタ）

**RegimentRecoverySystem 戦時補正**: `recoveryMultiplier = wartimeRegimentRecoveryMultiplier × supplyRecoveryMultiplierByBand[band] × (1 + staffMitigation)`。recovery（baseline 未満→回復方向）にのみ適用。decay（baseline 超→減衰方向）は影響しない。

### 6.44 WarCreationSystem（4週ごと）

`status === 'escalated'` の DiplomaticPlay を即時解決せず War entity に変換する。

**対象（すべて満たす play のみ War 化）**:
- `play.kind === 'land_claim'` / `'contract_tax_revision'` / `'revolt_negotiation'`（kind-gate）
- `initiator.kind === 'polity'` かつ `target.kind === 'polity'`（polity 同士のみ。House を含むものは War 化しない）

**変換**: initiator → attacker primary participant、target → defender primary participant。WarGoal は `play.issue` のみから 1 件構築する（offer / currentOfferId は見ない）。

**supporter copy filter（v0.43）**: play の `initiatorSupporters` / `targetSupporters` を**コピー直前に再検証**した上で War の supporter participant（primary=false）としてコピーする。候補選定時（seek_diplomatic_support）の exclude は追加時点の検査にすぎず、War 化までに状態が変わりうるため必須。通過条件: supporter polity が active / 他 active War に不参加 / attacker・defender primary と非重複 / 両 side 非重複（acceptedKeys を primary 2 件で初期化し採用順に追記）/ **反対側 primary と支配家が同一でない（v0.45.2 — 家が自分の polity への攻撃に加担する不自然の防止）**。play は 1 件ずつ順に処理し、各 War の作成（= `warIndex.byParticipant` 登録）完了後に次の play の filter を評価するため、「同一 polity が 2 つの play の supporter で両方 escalate」のレースは起きない。通過した supporter ごとに `WAR_PARTICIPANT_JOINED`（normal）を emit する。落ちた supporter は無音（`DIPLOMATIC_SUPPORT_DECLARED` は取り消さない — 宣言と参戦のペア有無で「宣言したが参戦しなかった」と読める。撤回イベントは将来課題）。
- transfer_land_contract: `holdingId = issue.holdingId`、`toPolityId = initiator.id`、`fromPolityId` = 対象 holding の land contract chain 上の現 terminal grantee（原則 target.id）
- change_contract_tax_rate: `newTaxRateToGrantor = issue.desiredTaxRateToGrantor`、`landContractId` / `holdingId` は issue 由来
- popular_revolt_independence: revolt_negotiation の escalation を War 化する。`requiredWarScore = defaultPopularRevoltWarScore`。War 作成後、commonwealth polity の `revoltState.warId` を back-fill する
- `requiredWarScore` は kind 別 config（`defaultTransferLandWarScore` / `defaultChangeContractTaxWarScore` / `defaultPopularRevoltWarScore`）から設定し、`targetWarScore = max(warGoals.requiredWarScore)`

**War 化しない（cancelled に倒す）条件**: initiator / target が missing / inactive、**initiator / target の支配家が同一（`politiesShareOwnerHouse`、v0.45.2 — play 開始後に ownership が同家へ収束したケースの安全網。revolt_negotiation は commonwealth 側 `ownerHouseId` undefined で自然に素通り）**、対象 holding / contract が無い、WarGoal へ変換不能、同一 `originDiplomaticPlayId` から作成済み、**同一 issue（holdingId / landContractId）を対象とする active War が既存**（重複抑止）。escalated のまま残すと cleanupTerminalDiplomacy が terminal しか消さず無限蓄積するため、War 化できなかった escalated play は cancelled に倒す。

**transfer_land_contract goal の rank 適用可否ゲート（`isWarGoalApplicable`）**: holding / fromPolity / toPolity の存在・active・`from !== to` に加え、**`canTransferLandContract(state, holdingId, fromPolityId, toPolityId)` が true であること**を要求する。これは `applyLandContractTransferGoal` が実行時に使う `planLandContractTransfer`（feudal chain の rank invariant を検証し適用プランを決定する純粋関数。両者は `landContractMutations.ts` 内の単一の真実）と**同一ロジック**で、開戦前に適用可否を判定する。これを欠くと「warScore で勝っても rank invariant 上 land contract を移管できず PeaceSettlement が `white_peace` に倒れ、同じ seize 戦争を永久に再宣戦する（winning→white_peace ループ）」事故が起きる（例: rank 2 polity が rank 3 grantor 配下の holding を seize しようとするケース）。`seize_weak_remote_holdings` aim は軍事力比較のみで対象を選ぶため rank 非互換 holding を頻繁に狙うので、本ゲートが load-bearing。同一 predicate を play 生成（DiplomaticPlaySystem §6.42 経由の `createLandClaimPlayFromProjectMut`）でも事前適用し、適用不能な seize の play / `DIPLOMATIC_PLAY_STARTED` spam も抑止する。

**勝率 × 指導者性格による開戦ゲート（`winChanceWarGateEnabled`、default ON）**: WarGoal が適用可能（上記 rank ゲート通過）でも、War 化の直前に「攻撃側が勝てるか」を判定し、勝てないなら開戦を見送る。対象は `land_claim` / `contract_tax_revision` のみ（`revolt_negotiation` は除外＝叛乱は計算的開戦ではなく、cancel すると `revoltState.warId` 配線が宙に浮く）。
- 勝率推定 `estimateAttackerWinChance`（`selectors/warEstimateSelectors.ts`）= `atk / (atk + def)`。`estimateWarSidePower` は**実戦闘と同じ戦力源**で算出する: actor の `regimentIndex.byOwner` から**動員可能な常設連隊**（`status==='active'` かつ `currentWarId===undefined`＝`mobilizeRegimentsForWar` と同一条件）の `getRegimentEffectivePower` 合計。連隊記録ゼロのときのみ nominal power（`getActorMilitaryPower`）にフォールバックし、記録はあるが動員可能ゼロ（全員別戦争 / 全滅）は **0**。これにより「推定では勝てるが実戦では動員ゼロで全滅」（過去の attacker=0 全滅バグ）を構造的に塞ぐ。
- しきい値 `calcGeneralDeclareThreshold(attackerPolityId)`（`selectors/personAbilityEffects.ts`）= `minAttackerWinChanceToDeclare`（=0.45）を攻撃側の軍事官（`military` office holder）の性格で調整: ambition 高で下げ（不利でも挑む）、caution 高で上げ（慎重）、`[minWarDeclareThreshold, maxWarDeclareThreshold]`=`[0.3, 0.75]` に clamp。`personAbilityEffectsEnabled` OFF 時は flat 0.45。
- `winChance < threshold` なら War を作らず play を `cancelled`（既存 terminal 経路を再利用）にし、`WAR_AVERTED`（minor、winChance/threshold を百分率で記録）を発行する。決定論（RNG 不使用）。「一か八か」は per-decision の乱数でなく指導者ごとの性格分散で表現する。
- `winChanceWarGateEnabled` は `personAbilityEffectsEnabled` とは別のキルスイッチ（personality OFF でも flat-0.45 ゲートは挙動変化なので A/B 比較できるよう分離）。
- **v0.47.3**: 同一の予測式（`estimateAttackerWinChance < calcGeneralDeclareThreshold`）を **escalation 直前**にも共有する（§6.44b `escalateOrStandDown`）。escalation 段階で勝てないと判明した play は War 化を待たず `status_quo` で撤退するため、本ゲート（War 化直前）が `WAR_AVERTED` を出すのは「escalateOrStandDown をすり抜けた（同 tick の他 play が後から動員を消費し勝率が落ちた）」残余ケースに縮小する。両者は同じ閾値ゆえ二重に弾くことはなく、撤退（status_quo）と aborted（voided）の差は判定タイミング（動員消費の前か後か）だけ。

**War 作成後**: 元 play を `resolved_by_conflict`（terminal）にする。**`DIPLOMATIC_PLAY_RESOLVED_BY_CONFLICT` event は発行しない**（即時解決を含意するため）。戦争開始 event は `WAR_DECLARED`（major）のみ。

### 6.45 WarManeuverSystem（毎週）

active War ごとに「誰が指揮し・どの戦場で・戦うか回避するか」を毎週解決し、battle 結果で warScore を更新する。終結判定はしない（PeaceSettlementSystem の責務）。**乱数を使う**。selector は `warManeuverSelectors.ts`、battle/回避の数式は `warManeuverSystem.ts` のローカル関数。

各 active War に対し以下を順に実行（attacker→defender の固定順で RNG を消費）:

1. **lastWarWeek 更新**: polity actor 両陣営の `lastWarWeek = absoluteWeek`（valor/command の「直近戦争参加」ability 判定を温存）。dead-participant guard より後・early-continue より前に行う。
2. **dead-participant guard**: primary participant が missing/inactive な War は skip（消滅 actor は cancelOrphanedWarsSystem が cancelled 化）。
3. **warScore 凍結**: `|warScore| >= targetWarScore` の War は warScore を動かさず skip（PeaceSettlement 待ち。下記 cadence）。
4. **総大将 lazy refresh**（polity actor のみ。house actor war は no-op）: 現 `captainGeneralPersonId` が eligible（`isEligibleWarPerson`）なら据置、不適格/不在なら `selectCaptainGeneralForWarSide`（warCommand スコア順）で再選出。変化時 `WAR_CAPTAIN_GENERAL_CHANGED`（喪失=major / 交代=normal）。初回任命（旧 undefined）は event なし。v0.45.3: military office holder 経路には性別役職適格ゲート（§6.19）を適用する。**leader fallback はゲートしない**（女王の親征を許容 — military が gate で空でも leader fallback が逃げ道になるため ungated 再試行も不要。女当主・女王例外の構造的実現）。
   - **両陣営重複解消（v0.45.2、`dedupeCaptainGenerals`）**: refresh 直後（指揮官候補 refresh より前）、attacker / defender の `captainGeneralPersonId` が同一人物なら解消する。同一人物の両陣営 CG は「臣下国 leader が宗主国の military office を保持し、片側は military 経路・もう片側は leader fallback で同じ人物を選ぶ」形で実際に発生する。lazy refresh は現 CG が eligible なら据置のため、**refresh の変化有無と独立に毎 tick 検査する**（refresh 内に畳むと既存の重複状態が永久に残る）。タイブレークは polity leadership: 重複者が片側 primary の `getPolityLeader` ならその side が保持し、反対 side だけ当人を exclude して `selectCaptainGeneralForWarSide` で再選出（人は自分が率いる polity に背かない）。どちらの leader でもない / 両方の leader（理論上のみ）は両 side から除外して再選出（指揮官候補の両属除外と同じ「忠誠の板挟み」扱い）。exclude は累積するため再衝突しても有限回で停止。CG が変わった side は refresh と同じ規約で `WAR_CAPTAIN_GENERAL_CHANGED` を emit する。
5. **指揮官候補 lazy refresh**: `buildWarSideCommanderCandidates` で再構築（変化時のみ state 更新・event なし）。先頭が当該週の戦闘指揮官。v0.43 追補: 候補は side の**全 polity participant（supporter 含む）の宮廷人材プール**から選出する — military office holder + polity 関係 House の生存メンバー（`getPolityPersonIds`）+ anchor 派閥のメンバー（客分・食客 — supervisor 候補と同じ考え方）。役職による優遇はなく純粋に warCommand 選定スコア降順 / personId 昇順（military office の意味は総大将経路に残る）。適格条件は生存・非 placeholder・成人（young_adulthood 以上）+ 性別役職適格ゲート（§6.19、v0.45.3 — 指揮官は任意役割で CG が常在するため ungated 再試行はしない）。participant いずれかの polity の leader は CG を兼ねる場合を除き候補外。両 side のフル候補が揃った後、**両属人物（両 side の候補に同時に現れる人物）を双方から除外**し（忠誠の板挟み）、各 side を warCommand 上位 `maxWarCommanderCandidatesPerSide`（=8）名に cap する（`finalizeWarCommanderCandidates`。除外 → cap の順）。越境指揮を許容する（battle 内の指揮官割当 pool は polity 非依存で、supporter の指揮官が primary の連隊を率いてよい）。総大将は従来どおり primary polity の military office holder（→ leader fallback）のみから選出する。
6. **戦場生成**: WarGoal 対象 Province から `generateCandidateBattlefield`。major_river feature は確率 `warBattlefieldRiverCrossingChance` で `river_crossing`、coastal feature は `warBattlefieldCoastalBattleChance` で `coastal_battle`、それ以外は `TERRAIN_TO_BATTLEFIELD[terrain]`（terrain 5 種 → open_field/forest_battle/hill_battle/mountain_pass/wetland_battle の 1:1）。対象 Province 未解決なら以降 skip。
7. **回避判断**（両陣営 `decideEngagement`）: `avoidDesire = 戦力劣勢 + caution・地形回避性 − urgency(負けている側ほど高) − ambition − avoidanceCount ペナルティ + noise`。`avoidanceCount >= maxWarAvoidanceCount` は強制 accept。総大将不在は中立 traits(0.5) で計算。
8. **戦闘 or 回避の解決**:
   - **両者交戦** → mutual_engagement で battle（`effectiveFrontage = baseFrontage`）。
   - **両者回避** → warScore 不変、両 `avoidanceCount +1`、`BATTLE_AVOIDED`(minor, avoidingSide='both')。
   - **片側のみ回避**（v0.49 engagement contest。旧 `resolveAvoidanceSuccess` の単側確率を置換） → 両総大将の `insight + command`（各 0..240、CG 不在 side は 50/50 の中立 100）で捕捉/離脱を判定する。`captureChance = battleEngagementCaptureBaseChance + (catcherScore − evaderScore)/240 × battleEngagementCaptureAbilityScale − terrainAvoidability + evaderAvoidanceCount × warAvoidanceCountPenalty`（地形は回避側有利・回避を重ねた側ほど捕捉されやすい）。
     - **捕捉成功** → `*_avoidance_failed` で battle。**`effectiveFrontage` を `max(battleMinimumEffectiveFrontage, baseFrontage − battleCaughtFrontagePenalty)` に縮小**（狭い戦列で寡兵が局所的に支えられる＝戦場幅選好を slot model に接続する唯一のレバー）。
     - **捕捉失敗** → 回避側 `avoidanceCount +1`、warScore は非回避側へ `warAvoidanceWarScorePenalty`(=1.0)、`BATTLE_AVOIDED`(回避 side)。
   - battle 成立時（mutual / 捕捉成功）は `simulateBattle` で result を出し warScore 更新、`BATTLE_OCCURRED`(normal)。**戦闘後に両側の `avoidanceCount` を 0 にリセット**。

**battle 解決（`simulateBattle` 内部 tick simulation — v0.49 戦列スロットモデル）**:

> **v0.49 で会戦内部を「戦場幅を持つ戦列スロットモデル」に再構築した。** frontline を fixed-length slot 配列として扱い、戦術（三すくみ）・隣接側面攻撃・突破・追撃・戦場ログ（恒久 BattleLog、§3.9d）を導入した。War entity ライフサイクル / WarGoal / PeaceSettlement / Regiment 構造 / 「`simulateBattle` は純粋 helper、mutation は WarManeuver 側」の責務分離は維持する。旧バージョンとの bit-identical replay は維持しない（同一 v0.49 内では同一 seed → 同一結果）。設計の元案は git 外 draft `spec-v049-update.md`、本節が統合 spec の正本。

battle 解決は純粋 helper `simulateBattle`（`src/sim/helpers/simulateBattle.ts`、WorldState 非依存）で行う。WarManeuver は動員 active Regiment の snapshot（effectivePower は `getRegimentEffectivePower` で**戦闘前 1 回 frozen**）・指揮官 pool・総大将能力・地形 frontage を入力し、helper が deployment → 内部 tick loop → result / 損耗 / `tickLogs`（BattleTickLog[]）/ commander 割当を返す。戦闘内部の連隊状態は live 型 `WorkRegiment`（= `BattleRegimentState` 実体。永続化されない。`input` 参照で immutable params を保持し `organization`/`morale`/`accumulatedOrgDamage`/`routed`/`retreated`/`commanderQ`/`adjacentCommanderQ` を持つ）。**strength は snapshot で tick 中に mutate しない**（終局で 1 回算出）。

- **frontage（戦場幅）**: `baseFrontage` = 地形 `battlefieldFrontageByKind`。`effectiveFrontage` は交戦の成立形態で変動する（step 8 の捕捉戦は `max(battleMinimumEffectiveFrontage(=1), baseFrontage − battleCaughtFrontagePenalty(=1))` に縮む。mutual_engagement は `= baseFrontage`）。BattleLog は両方を保存する。
- **centerOutSlotOrder**: deploy / fill / 指揮官割当が共有する唯一の slot 順序。中線対称（frontage=4→`[1,2,0,3]`、=6→`[2,3,1,4,0,5]`。旧 `centerOutOrder` の左寄り `[1,0,2,3]` を統一＝**偶数 frontage の指揮官割当順も変わる意図的挙動変更**）。
- **deployment**: candidate = `strength > minFightingStrengthThreshold && org > retreatOrganizationThreshold`。infantry を effectivePower 降順で frontline（`centerOutSlotOrder(effectiveFrontage)` の順に着座）、cavalry は基本 reserve・frontage に満たなければ frontline へ。tie は regimentId 昇順。draw 無し。
- **attack pair（slot 探索）**: 各 frontline 連隊は自 slot `i` を基準に敵 slot を `[i, i−1, i+1]` の順で探す。正面 `i` に敵がいれば `frontal`、正面が空で隣接を撃つ場合 `flanking`（小 bonus `battleFlankingDamageMultiplier` / `battleFlankingRoutPenalty`）。対象なしの連隊は当 tick 攻撃せず draw も消費しない。1 敵が複数連隊に撃たれるのは許容。**damage は tick 開始 slot 状態から全 pair を列挙 → 対象ごとに累積 → 同時適用**（順序依存回避）。旧 wing-based flank pressure は退役し slot-based flanking に統合。
- **戦術（三すくみ）**: 毎 tick 両総大将が `BattleTactic`（`offensive` 攻勢 / `defensive` 守勢 / `disruption` 攪乱）を選ぶ（高 insight ほど相手に有利な手を選ぶ）。攻勢>攪乱 / 攪乱>守勢 / 守勢>攻勢 で有利側に `battleTacticAdvantageDamageMultiplier`(=1.2)。即勝敗ではなく modifier。
- **指揮官効果**: 割当連隊は `q = max(0, clamp((fieldCommandScore−50)/50, −1, 1) × commanderAssignedRegimentEffectMax)` で与 org `×(1+q)` / 被 org `×(1−q)` / rout 耐性。**`max(0, ·)` フロアで低能力でも無指揮官より悪くしない**（序列不変条件: 直接指揮官あり ≥ 隣接支援あり ≥ 完全無指揮官）。直接指揮官なしは `battleUncommandedDamagePenalty` / `battleUncommandedRoutPenalty`、隣接 slot(`i±1`)に指揮官がいれば `battleUncommandedAdjacentSupportRatio`(=0.5) 軽減 + 隣接 commanderQ の一部。infantry は fieldCommandScore・cavalry は breakthroughScore で割当（tie personId 昇順）。
- **総大将効果**: side-level で被 org damage 軽減（≤`captainGeneralBattleOrganizationDamageEffectMax`）と rout 耐性（≤`captainGeneralRoutResistanceEffectMax`）。benefit 方向のみ。
- **breakthrough（突破）**: combat damage 後 classify 前に per-pair 判定（`battleBreakthroughBaseChance` + 指揮官能力差 `battleBreakthroughAbilityGapThreshold` 超で eligible）。成功で対象に `routed=true` 強制 + `organization = min(org, effectiveRouteThreshold)` 押下げ + `accumulatedOrgDamage ×= battleBreakthroughOrgDamageMultiplier`(=1.3、combat damage とは別ステップ) + 同 tick pursuit chance bonus。
- **classify / 除去 / fill**: classify はマークのみ（**既に routed なら survivor に戻さない**）。除去述語は `routed || org <= retreatOrganizationThreshold`、pursuit 判定**後**に slot から外す（reserve には戻らない）。空き slot は同 tick 末に reserve から `centerOutSlotOrder` 順で補充（補充連隊は当 tick 攻撃しない）。frontline 全空きでも reserve があれば継続、両者 fighting 0 で敗北。
- **pursuit（追撃）**: 退却/敗走した敵 slot `i` を、正面味方 slot `i`（健在）→ 不在なら当 tick その敵を flanking した味方（slot index 昇順で一意）が追撃する。pursuer 不在なら判定せず draw も消費しない。chance は pursuer の `pursuitScore`(=command·0.5+insight·0.35+valor·0.15)・valor・cavalry・戦術有利・突破・地形から成る。成功で `accumulatedOrgDamage ×= battlePursuitOrgDamageMultiplier`(=1.5)。さらに destroyed 抽選（`battlePursuitDestroyedChance`）成功で当該連隊を destroyed 化する: **終局算出で `strengthAfter=0` を直接強制**し、tick ログの destroyed と `regimentResults.destroyedCause` を必ず一致させる（`regimentDestroyedStrengthThreshold=0` 対応。旧実装は `accumulatedOrgDamage` を「致死量」へ押し上げる間接式で、終局式が `strength×product` を引いた結果が浮動小数点誤差でわずかに正に残ると destroyedCause が付かず「ログは壊滅だが連隊は生存」する不整合が default config でも起きていた。原因タグを単一の真実源にして解消）。
- **内部 tick loop（最大 `battleMaxTicks`）**: combat の双方向 org damage（`battleBaseOrganizationDamage × pairPowerFactor × terrain × tactic × flank × commander × randomFactor`、org 比例 morale damage、effRoute = `routeOrganizationThreshold + max(0, baselineMorale−morale) × moraleRouteThresholdFactor`）。1 tick draw 順は **tactic(atk→def) → engagement damage(slot 昇順) → breakthrough(eligible のみ) → cavalry charge(v0.50) → classify(draw なし) → pursuit + screen(v0.50) + reserve cavalry pursuit(v0.50) → morale rally/shock(v0.50, draw なし) → remove + fill(draw なし) → log(draw なし)**。
- **cavalry charge（v0.50 騎兵突撃）**: engagement damage / breakthrough 後・classify 前。reserve cavalry に commander が割当され `breakthroughScore >= battleCavalryChargeCommanderThreshold`(=70) かつ弱った敵 frontline slot がある場合、`battleCavalryChargeBaseChance`(=0.12) × terrain multiplier で判定。成功: `applyBreakthroughEffect`（既存 breakthrough と共有）で target を rout 化。失敗: cavalry に org/morale damage。side ごと `battleCavalryChargeMaxPerBattlePerSide`(=2) 回制限。使用した cavalry は同一 tick 内で screen/pursuit に再使用不可。
- **cavalry screen（v0.50 撤退援護）**: pursuit phase の per-slot ループ内で pursuer 確定後に判定。被追撃側の reserve cavalry が `battleCavalryScreenBaseChance`(=0.40) × terrain multiplier で screen 成功すると、pursuit chance / destroyed chance / morale shock を `battleCavalryScreenPursuitReduction`(=0.50) で軽減。
- **reserve cavalry pursuit（v0.50 騎兵追撃）**: 既存 pursuit 後に reserve cavalry が routed/retreated かつ未 destroyed の敵 slot を追撃。`battleCavalryReservePursuitBaseChance`(=0.20) / `battleCavalryReservePursuitDestroyedChance`(=0.10)。
- **morale rally / shock（v0.50 士気波及）**: remove + fill の前（routed regiment がまだ slot にいるため隣接計算可能）。classify / pursuit / cavalry charge で発生した retreat/rout/destroyed を集計し、味方側に rally（勢い）/ shock（動揺）として morale を増減。per-tick cap あり。cavalry screen 成功時は shock を軽減。閾値 `battleMoraleShiftLogThreshold`(=5) 以上でのみ BattleLog に記録。
- **result 決定**: 片側 fighting 連隊が尽きれば相手勝利。maxTicks 到達は残存 org 合計の相対差 `battleMaxTicksDecisiveMarginRatio`(=0.1) 超で優勢側勝利、以下は inconclusive。
- **strength / destroyed**: loop 後に累積 org damage × role（winner/loser/routed）× outcomeQuality × powerDisadvantage で 1 回算出（**終局で一度だけ**）。destroyed 判定は caller が `strengthAfter <= regimentDestroyedStrengthThreshold` で行う（simulateBattle は mutation しない）。`BattleRegimentResult.destroyedCause`（`ordinary_attrition`/`pursuit`/`breakthrough_pursuit`）は**ログ用の原因タグ**で mutation には不要。
- **BattleLog 生成**: simulateBattle が返した tickLogs・commander 割当を基に **WarManeuver が** BattleLog entity を作成し importance を付与する（§3.9d / §6.45 末尾）。

**warScoreDelta（result から符号 + bounded magnitude）**: `computeWarScoreDelta` が internal sim の `result` から符号を決め（attacker_victory=+ / defender_victory=− / inconclusive=0）、magnitude を `base(outcomeQuality: rout は `battleRoutVictoryScoreBase`、orderly は `battleOrderlyVictoryScoreBase`) × decisiveness(敗者 routed share + 早期決着 + **v0.49: 敗者 destroyed share × `battleDestroyedWarScoreWeight`(=0.15)**。`[battleDecisivenessMin, battleDecisivenessMax]` clamp) × preBattleModifier(勝者の preBattle edge のみ、控えめ) × 勝者側 captainGeneralEfficiency` で組み、`clamp(0, maxWarScoreDeltaPerBattle)`。destroyed は routed の部分集合だが routed share とは別軸の小 weight 上乗せで二重計上を避ける。`warScoreDelta = sign × magnitude`。post-battle power 比は使わない（rout / org collapse で 0/1 に寄り delta が暴走するため）。符号は result 由来・magnitude≥0 なので **常に result と整合**。Battle entity には **rawDelta** を保存（warScore saturation で applied delta が 0 化しても符号が崩れないように）、`warScoreAfter = clamp(before + rawDelta, −100, 100)`。

**warScore 変化の表現**:
- per-tick drift は行わない。warScore 変化は `BATTLE_OCCURRED` の `warScoreDelta` / `warScoreAfter` で表現する。
- 指揮官補正は `commanderModifier` / `captainGeneralEfficiency`（`getRoleScore(person, 'warCommand')`）で反映する。
- 総大将 / 指揮官候補 / avoidanceCount は **soft reference**。lazy 選出で不在を許容し、IntegrityCheck では検査しない（person 消滅で War を壊さないため。house actor war では総大将管理を行わない）。

**cadence（毎週 maneuver × 4週 settlement）**: WarManeuver は毎週・PeaceSettlement は 4 週ごと。warScore が ±targetWarScore に到達しても settlement が走るまで最大 3 週ある。その間 step 3 が warScore を凍結し、到達済み War が余分な battle で行き過ぎるのを防ぐ。

**バランス**: warScoreDelta は magnitude 式（outcomeQuality base × decisiveness × preBattle × cgEff、clamp `maxWarScoreDeltaPerBattle`=12）で決まり、決着戦闘数は base/target 比に依存する。戦闘は残存 org 合計で決まり**数的優位が支配的**。通常消耗では strength 損耗が小さく destroyed は希少だが、**v0.49 で追撃-壊滅経路（§6.45 pursuit の destroyed 抽選）が加わり、敗走連隊が壊滅し得る**ようになった（頻度は balance 保留）。戦闘系のバランス（avgStrength・CG fairness・median・突破/追撃/壊滅の発生率等）は戦場/指揮官/消耗/兵站がひと通り入った後にまとめて調整する（現状は機能の bounded 動作を優先し config 非調整）。

**Regiment 接続（損耗ループ）**: battle の入力は永続 Regiment（§3.9b）。WarManeuverSystem は warScore 凍結判定（step 3）の後・総大将 refresh の前に **per-war mobilize prologue** を挟む（`mobilizeRegimentsForWar`。各 side の polity participant が所有する active かつ未動員 Regiment を当該 War/side へ動員する。決定的・乱数非消費・冪等）。battle が成立したら（mutual_engagement / 回避失敗）`simulateBattle` を実行し損耗を適用する:

- **損耗は per-regiment**。`simulateBattle` が連隊ごとに organization / morale / strength の after 値を返し、`updateRegimentMut` で反映する。organization は内部 tick で主に削れ（§6.45 battle 解決）、morale も削れる。strength は損耗方針で大きくは削れない。
- clamp 後 `strength <= regimentDestroyedStrengthThreshold`（既定 0）になった Regiment は `destroyed` 化（byWar から除去・status 遷移。byOwner には残す。§3.9b case(c)）。通常消耗では deployment 閾値（strength>10）により全滅前に配置外となり destroyed は希少だが、**v0.49 の追撃-壊滅経路（§6.45）は `accumulatedOrgDamage` を致死量へ押し上げて `strengthAfter=0` に到達させる**ため、敗走連隊が destroyed 化し得る。
- 1 戦闘につき `Battle` entity（§3.9c）を 1 件記録する（`createBattle`）。summary（outcomeQuality / ticksElapsed / frontage / *InitialFrontlineIds / *RoutedRegimentIds / breakthroughSide / *CommanderAssignments / pursuitOccurred / regimentResults の morale 込み）を保存する。`BATTLE_OCCURRED` event には battleId・連隊数に加え summary（outcomeQuality / ticksElapsed / frontline・routed counts / pursuitOccurred 等）を additive に載せる（§8 event 一覧）。
- **恒久 BattleLog（v0.49・§3.9d）**: `Battle` entity は War cleanup で消える短期 summary なので、後年参照用に **WarManeuver が恒久 BattleLog を別途生成**する（source of truth は BattleLog、Battle は進行中 UI 用）。`battleLogImportance(sim)` で importance を付与する: `major`（breakthrough / pursuit-destroyed / 決定的勝利 = rout 等）/ `normal`（勝者明確な通常会戦）/ **`minor` は BattleLog を作らず** `BATTLE_OCCURRED` summary のみ。`major` は恒久保存、`normal` は `battleLogNormalRetentionWeeks`(=480) 経過で cleanupBattleLogSystem（§6.51b）が purge。会戦単位 reputation は **総大将の決定的勝敗のみ**（winner CG に `+battleCaptainGeneralFeatReputationScore`(=12) / loser CG に `−battleCaptainGeneralFailureReputationScore`(=14)、source `{kind:'war', warId, battleId}`・category `military`。突破/追撃の per-regiment feat は BattleLog のみで reputation は配らない）。これらの `PERSON_REPUTATION_GAINED/DAMAGED` は chronicle（category `life`・byPerson）に projection され死後も残る武功記録になる。新 SimEvent 型（BATTLE_BREAKTHROUGH 等）は v0.49 では**追加せず**、詳細は BattleLog.tickLogs に保持する（将来課題）。
- strength の回復は RegimentReinforcementSystem（§6.50 月次）、organization / morale の回復は RegimentRecoverySystem（§6.48 baseline-aware）、destroyed の reform も §6.50。
- 総大将 / 指揮官は **warScore 経路**（勝者側 `captainGeneralEfficiency`）と **battle 内経路**（指揮官 org/rout 補正 + 総大将 side-level 補正）の両方に効く。`commanderModifier`（power 乗算）は使わず、battle 内 org/rout 補正で表現する。

### 6.46 PeaceSettlementSystem（4週ごと）

active War の warScore が閾値に達したら終結させ、WarGoal を state に反映する。冒頭に WarManeuver と同じ **dead-participant guard**。

- **revolt War の leader 死亡 guard**: revolt War（WarGoal が `popular_revolt_independence`）で `leaderPersonId` が死亡 / 不在の場合、warScore / timeout に関わらず即座に `defender_won`（後述の suppressRevolt を伴う）で終結させる。
- `warScore >= targetWarScore` → `attacker_won`。WarGoal を実行（attacker 側の目標として扱う）。`popular_revolt_independence` の場合は `establishCommonwealth` を呼ぶ。
- `warScore <= -targetWarScore` → `defender_won`。通常 WarGoal は実行せず status quo（defender counter-goal なし）。ただし `popular_revolt_independence` の revolt War では `suppressRevolt` を呼ぶ（純粋な status quo ではない）。
- `absoluteWeek - startedWeek >= maxWarDurationWeeks` かつ未決着 → `white_peace`（timeout 終結）。拮抗 War の無限累積を防ぐ終結保証。
- **同家収束 guard（v0.45.2）**: 両 primary が polity actor で支配家が同一（`politiesShareOwnerHouse`）に収束した War は、warScore / timeout に関わらず `white_peace` で能動終結する（stale → white_peace の相似形）。開戦時の同家ペアは aim / play / War 化の各ゲート（§6.42 / §6.44 / §6.57）で弾かれるため、ここは開戦後の相続・征服による mid-war 収束専用の防御ゲート（実測 600 年で発火 0。unit test でカバー）。
- WarGoal 適用が stale（対象 holding / contract / fromPolity が現状と不一致で底層 mutation が失敗）な場合は `white_peace` で安全終結し、simulation を落とさず IntegrityCheck 違反にもしない。warScore が target に到達していても WarGoal が適用不能なら**能動的に white_peace 化**する（毎週 maneuver で warScore が target に達したまま放置されると、WarGoal が指す landContract を他システムが先に消した時に dangling 参照で crash しうるため）。`establishCommonwealth` / `suppressRevolt` の失敗時も `white_peace` にフォールバックする。

**底層 mutation 呼び出し**（シグネチャが異なる）:
- transfer: `applyLandContractTransferGoal(ctx, {...reason:'war'})` → `CtxResult<void>` を unwrap。`err` 時は white_peace 安全終結。
- tax: `adjustLandContractTaxRate(state, contractId, newRate)` / `eliminateContractFromChain(state, contractId, inheritedTaxRate?)` → いずれも `WorldState` を返す（ctx は取らない）。elimination 判定条件は既存 `applyChangeContractTaxRate` / 旧 ConflictResolutionSystem を踏襲。

**event 責務（経路別）**:
- transfer: `applyLandContractTransferGoal` が `LAND_CONTRACT_*`（CONQUERED 等）を内部発行するため、PeaceSettlement 側で重複発行しない。
- tax: 底層 mutation が event を出さないため、PeaceSettlement 側で `PEACE_SETTLEMENT_APPLIED`（major）を発行する。
- 勝敗時に `WAR_WON` / `WAR_LOST`（major）、white_peace / cancelled 等の終結時に `WAR_ENDED`（major）。

**戦災（war_damage Crisis）の生成（v0.48 Phase B）**: `settleAttackerWon` の `transfer_land_contract` goal 分岐で `applyLandContractTransferGoal` が **領地移転に成功した後**、`spawnWarDamageCrisis(holdingId, owner=goal.toPolityId, sourceWarId)` で war_damage Crisis を生成する（§6.6 CrisisSystem）。**transfer goal 限定**（tax / popular_revolt goal では領地移転が無いので生成しない）。owner は終戦後の新支配 polity。land transfer の **完了後** に spawn することで旧 owner を掴まない。これにより「征服直後の荒廃を新領主が代官・予算で復興する／放置して住民の不満が燻る」ドラマが生まれる。なお treasury 直接ダメージ・厭戦（war exhaustion）は依然未実装（将来再設計）。

**成果経験・評判付与（v0.44）**: attacker_won / defender_won / white_peace の各終結サイトで `awardWarOutcomeCtx` を呼び、両 side の captain general + 現場指揮官に即時成長 + military 評判を付与する（§6.66。white_peace は経験のみ）。v0.47.1: 評判の organization tag は受賞者の所属に限定する（支援国出身指揮官は tag 無し評判=名声のみ。§6.64a-(3) 所属 gate）。

### 6.47 cancelOrphanedWarsSystem（毎週）

2 経路を持つ（v0.43 で経路 B 追加）。

**経路 A（primary）**: active War の primary participant（attacker / defender いずれか）が missing / inactive になった場合、`cancelled` 終結（`endedWeek` 設定 + `WAR_ENDED` 発行、WarGoal 不実行）にする。

**経路 B（supporter。v0.43）**: active War の supporter participant が inactive になった場合、`removeWarParticipantMut` で participants と `warIndex.byParticipant` から除去し **War は継続する**。イベントは発行しない（無音除去 — 外交的離脱ではなく polity 消滅に伴う cleanup のため。`WAR_PARTICIPANT_LEFT` は将来予約）。primary 除去は helper が reject するため 2 経路は混ざらない。

戦争は数年続くため、その間に participant polity / house が別要因（属州独立・併合・revolt など）で消滅しうる。IntegrityCheck（§6.35）が active War の participant を active 必須とするため、放置すると long-run で必ず throw する（`cancelOrphanedPlays` が DiplomaticPlay に対して存在するのと同じ理由）。安全側で `cancelled` に統一する（勝敗意味論は将来）。

**配置**: PolityOwnerConsistencySystem / OrganizationConsistencySystem の**後ろ**・cleanupWarSystem の前に独立 system として置き、**intervalWeeks=1**。理由は §5.6 / §6.35 を参照（PeaceSettlement 起因で同 tick に extinct 化した polity を参照する active War を、年末 IntegrityCheck より前に回収するため）。warScore 計算の安全は WarManeuver / PeaceSettlement 冒頭の dead-participant guard が担保するので、本 system を Maneuver / Settlement より後ろに置いても問題ない。

**成果経験・評判付与（v0.44）**: cancelled 化した War にも `awardWarOutcomeCtx` で双方に固定小経験を付与する（評判なし。§6.66）。

### 6.48 RegimentRecoverySystem（毎週、baseline-aware）

active Regiment の organization と morale を週次で **baseline へ向けて回復 / 減衰**させる（`runRegimentRecoverySystem`）。WarManeuverSystem の直後（PeaceSettlement の前）に interval 1 で走り、battle で削れた統制・士気を平時に立て直す。

- 対象は `status === 'active'`。各連隊で **org recovery は tick 開始時の morale を参照**するため `moraleAtTickStart = morale` を先に退避する。
- **organization**: `< baselineOrganization` なら `+ regimentOrganizationRecoveryPerWeek × (0.5 + moraleAtTickStart/100)`、`> baselineOrganization` なら `− regimentOrganizationDecayAboveBaselinePerWeek`。最後に `clamp(0, maxOrganization)`。baseline で静止中は変化なし。
- **morale**（org と独立）: `< baselineMorale` なら `+ regimentMoraleRecoveryPerWeek`、`> baselineMorale` なら `− regimentMoraleDecayAboveBaselinePerWeek`。`clamp(0, maxMorale)`。
- **strength は触らない**（回復は §6.50 RegimentReinforcementSystem）。
- `nextOrg === organization && nextMorale === morale`（baseline 静止）なら連隊単位で skip。全連隊変化なしなら draft を clone せず素通し（perf。lazy clone-once）。
- worldgen は initial = baseline（org 50 / morale 30）で生成するので、平時連隊は静止し recovery rate に依存しない（reform 連隊や battle 後の連隊のみ rate で baseline へ戻る）。

organization / morale はともに §3.9b の baseline/max を使う双方向収束で回復・減衰する。

### 6.49 RegimentMaintenanceSystem（毎週）

active Regiment の owner / home / war 参照を lazy に整理する（`runRegimentMaintenanceSystem`）。soft reference（currentWarId / owner active / homeHolding 存在）は IntegrityCheck の hard invariant にしない方針（§3.9b / §6.35）なので、本 system が遅延処理で整合を回復する。consistency 系の後・cleanupWarSystem の前に interval 1 で走る（cancelOrphanedWarsSystem の直後）。

active Regiment ごとに**順序を厳守**して処理する:

1. `homeHoldingId` が set で `holdings` に存在しない → **disband**（home 消失）。
2. `homeHoldingId` が set で holding 在り、`holdingTerminalPolityCache[homeHoldingId]` が現 owner（polity）と異なる → **owner 付け替え**（terminal Polity へ。basePower / strength / organization / 動員状態は維持。土地移転で Regiment 数が単調減少しないための要）。ただし `disbandAfterWar === true` の Regiment は付け替えず **disband** する。この「owner を home terminal に同期する」判定・付け替え／disband 分岐は `regimentMutations.ts` の `syncRegimentOwnerToHomeTerminalMut`（純粋判定は `regimentOwnerSyncTarget`）に集約され、**この付け替えルールの唯一の真実**である。本 system は lazy-clone gate の事前判定にのみ `regimentOwnerSyncTarget` を使い、実体は同ヘルパーを呼ぶ。`reassignRegimentOwnerMut` を直接呼ぶのは同ヘルパー内の 1 箇所のみ（叛乱奪取の eager 同期（§6.29）と共有し、二重実装による drift を防ぐ）。
3. 付け替え後の owner を再 read し `!isActorActive(owner)` → **disband**（owner 消滅）。
4. `currentWarId` が live(active) war を指していない（war 無し or terminal）→ **demobilize**（PeaceSettlement / cancel で終結した War に動員が残るのを遅延解除）。さらに `disbandAfterWar === true` の Regiment は demobilize 後に **disband** する。

`disbandAfterWar`（regiment.ts のフラグ）は revolt 用の一時連隊（local_levy）を戦争終結後に退役させる仕組み（§6.44 / §6.46 revolt levies）。disband は war 参照解除を兼ねるため demobilize と二重処理しない。多くの週は土地移転 / 滅亡 / 終戦が無く no-op で素通りする（lazy clone-once）。

### 6.49b CavalryEntitlementSystem（毎週、v0.50）

rank entitlement に基づく騎兵連隊のライフサイクルを一元管理する（`runCavalryEntitlementSystem`）。RegimentMaintenanceSystem の直後・RightConsistencySystem の前に interval 1 で走る。

騎兵連隊は `homeHoldingId` / `homeProvinceId` を持たない `Regiment`（`troopKind: 'cavalry'`, `sourceKind: 'noble_retinue'`）。RegimentReinforcementSystem は `homeHoldingId === undefined` を skip するため、騎兵の lifecycle は本 system が排他的に管理する。

処理順:
1. **titular owner cavalry → disband**: owner Polity が titular の cavalry を即 disband（§19.2 integrity violation 防止）。
2. **destroyed cooldown → disband**: `destroyedWeek + cavalryDestroyedCooldownWeeks`（24 週）経過した destroyed cavalry を disband。cooldown 中は entitlement count に含まれるため新規作成されない。
3. **entitlement 調整**: active non-titular Polity ごとに `cavalryEntitlementByRank[rank]`（default: rank2=2, rank3=1, 他=0）で必要数を算出。active + cooldown 中 destroyed を current count として過不足を調整。不足時は `createRegiment`（`basePower = cavalryEntitlementBasePower`(=10) 固定）で新規作成。超過時は destroyed 優先・effectivePower 昇順で disband。

worldgen: `generateInitialRegiments` の Pass 3 で rank-eligible 非 titular Polity に初期騎兵を生成する。

### 6.50 RegimentReinforcementSystem（月次・補充・再編成）

`organization` は §6.48 が週次回復する一方、`strength` は戦闘以外では回復しない。これを補完して active regiment プールが減る一方にならないよう、**プールを自己修復**させる（`runRegimentReinforcementSystem`）。RegimentMaintenanceSystem の**直後**に interval 4（月次）で走る。maintenance が active regiment の owner を terminal に揃え・home 消失/owner 失効を disband 済なので、整合した owner/home を前提にできる。

owner が Polity でない / `homeHoldingId` 無しは skip（worldgen は Polity owner のみ生成）。`sourceKind === 'local_levy'`（revolt 用の一時連隊。戦争終結後に disband する）は補充・再編成いずれの対象にもせず skip する。`treasury` は Polity 共有なので **RegimentId 昇順**（worldgen と同じ文字列比較）で決定的に処理する。rng は消費しない（deterministic だが strength が battle power にフィードバックするため **bit-identical ではない**）。

各 Regiment を 2 系統で処理する:

**A. active かつ `strength < maxStrength` → strength を silent 補充**（organization recovery と同じくイベント無し）。
- `homeControlFactor` = `holdingTerminalPolityCache[homeHoldingId] === owner.id ? 1 : 0`（二値。holding 消失・terminal 不明・owner 不一致は 0 = 補充不可）。0 なら skip。占領・封臣・段階的支配の反映は future。
- `popFactor` = `getRegimentHomeRecruitmentFactor`：homeHolding の該当 class POP（sourceKind→class: levy→peasants / urban_militia→townsmen / noble_retinue→nobles）を per-class reference で正規化し `[minPopFactor, maxPopFactor]` に clamp。POP は減らさない（源の厚みとして読むだけ）。
- `warStateFactor`：mobilized（`currentWarId` 在り）→ `warMultiplier × mobilizedMultiplier` / owner が active War 参加中 → `warMultiplier` / それ以外 → `peaceMultiplier`。
- `troopFactor` = cavalry なら `cavalryReinforcementMultiplier` else 1。
- `desiredGain = min(basePerMonth × popFactor × homeControl × warState × troopFactor, maxStrength − strength)`。
- **treasury は乗数でなく cap**：`costPerStrength = reinforcementCostPerStrength × (cavalry ? cavalryReinforcementCostMultiplier : 1)`、`affordable = treasury / costPerStrength`、`gain = min(desiredGain, affordable)`。`gain` 分 strength を増やし `treasury -= gain × costPerStrength`、`lastReinforcedWeek` を更新。

**B. destroyed かつ `destroyedWeek` 在り → reform（active に再編成）**。
- 条件：`currentWeek − destroyedWeek >= destroyedRegimentReformDelayWeeks` かつ homeControl=1 かつ owner active かつ `popFactor >= destroyedRegimentReformMinPopFactor` かつ `treasury >= destroyedRegimentReformCost`。
- 満たせば status を active に戻し strength/organization/morale を `destroyedRegimentReformInitial*` にリセット、`destroyedWeek` を消去、`lastReinforcedWeek` を更新、`treasury -= destroyedRegimentReformCost`、`REGIMENT_REFORMED`（minor）を emit。byOwner/byHomeHolding には destroy 後も残っているため **index 操作は不要**（byWar には居ない）。
- `disbanded` は再編成対象外（恒久解散）。

この補完により active regiment プールは戦間期に自己修復する。ただし reform には ≥`reformDelayWeeks` の平時が要り、開戦 AI は連隊在庫を見ないため、「全滅直後の Polity が攻撃側で開戦」transient は完全には解消しない（開戦 AI gate は future）。

### 6.51 cleanupWarSystem（毎週）

terminal War（active 以外）が `endedWeek` から `terminalWarRetentionWeeks` 経過したら `state.wars` および `warIndex`（byParticipant / byOriginDiplomaticPlay）から削除する。履歴は Event ログに残るため長期保持は不要。同じ削除ループで当該 War の `Battle` entity（§3.9c）も piggyback cleanup する（`battleIndex.byWar[warId]` の各 battle を `battles` から削除し、index entry も除去）。Battle は短期 entity なので、対応する War の retention 削除と同時に消える。**恒久 BattleLog（§3.9d）はここでは消さない**（War 消滅後も後年参照するため。retention は §6.51b が独立に管理）。

### 6.51b cleanupBattleLogSystem（毎週、v0.49）

恒久 BattleLog（§3.9d）の retention purge を行う。cleanupWarSystem の近傍（war 系 cleanup と同じ後段）に置く。

- `importance === 'normal' && week + battleLogNormalRetentionWeeks(=480) < absoluteWeek` の BattleLog を `state.battleLogs` から削除し、`battleLogIndex.byWar[warId]` からも除去する（空になった entry は delete）。
- `major` BattleLog は削除しない（恒久。Chronicle 同様の長期蓄積項候補だが将来ディスク退避で対処）。
- `minor` はそもそも生成されない（§6.45）ので対象外。
- BattleLog は War とは独立に生きるため、cleanupWarSystem で War が消えても BattleLog は残り、本 system の retention のみで消える。

### 6.52 CleanupTerminalDiplomacy（毎週）

terminal status の DiplomaticPlay と関連 Pressure / DiplomaticOffer を state から削除する GC。IntegrityCheck の直前に置く。intervalWeeks は 1。

**offer cascade delete**:
- terminal Play の `offerHistoryIds` をたどり、関連 DiplomaticOffer をすべて `state.diplomaticOffers` から削除
- `currentOfferId` が `offerHistoryIds` に含まれていない場合、それも削除
- **削除順序: offer 先、play 後**。play を先に削除すると `offerHistoryIds` が失われるため

**active play の supporter sweep（v0.43）**: active play の supporter polity が inactive になった場合、supporter 配列から無音除去する（play は継続。primary inactive は従来どおり play ごと削除）。

**成果経験・評判付与（v0.44）**: terminal status での削除直前に、`terminalOutcome` が設定された play について両 side delegate へ即時成長 + diplomacy 評判を付与する（§6.66）。actor-inactive による active play 削除は対象外。play は terminal 化と同 tick で削除されるため、この cleanup 内が唯一の安全な処理地点。

**grace period 設定（毎週）**:
- **contract_tax_revision**: terminal play の対象 `landContractId` に `termsProtectedUntilWeek = absoluteWeek + taxRevisionGracePeriodYears × 48` を設定（契約単位 grace。findImprove が skip）。
- **land_claim（v0.47.3 §6.69）**: terminal play の `issue.holdingId`（対象 holding）に `landClaimProtectedUntilWeek = absoluteWeek + landClaimGracePeriodYears × 48`（default 5）を設定する（税制改定と対称な holding 単位 grace）。失敗した請求を毎年再生成する churn（同一 holding を ~1.5 年ごとに再請求）を grace 期間止める。outcome で絞らない（税制改定も絞らない。勝った holding は自所有になり findAcquire が自所有を skip するため demands_met / escalated_to_war を含めても安全）。grace は **2 レベルで参照**する: (1) project レベル — `findAcquireTargetForProject`（`taskProjectCompletion.ts`）が保護中 holding を skip、(2) aim 候補レベル — `goalSelectors` の `consolidate_province_holdings`（保護中を otherCount に数えない）/ `seize_weak_remote_holdings`（候補から除外）。project レベルだけだと province の全 claimable holding が保護中でも aim が立ち年次 `AIM_ABANDONED` の二次 churn が残るため、両レベル必須。`nextHoldings` アキュムレータを新設し最終 state 合成に `holdings` を加える。**効果（実測 seed42 100年・A1 比）**: 同一 holding への急速再請求（gap < 5 年）が 25/28 → 4/27、単一 holding 最大請求数 19 → 10。残る breach は別 attacker による同時請求（grace が構造的に防げない競合）。

**Pressure 同期**:
- terminal DiplomaticPlay に紐付く Pressure を `pressureIndex.byDiplomaticPlay` で取得
- 関連 active な initiator Project（Pressure.relatedProjectId）を cancelled に
- 関連 active な respond_to_pressure Project（Pressure.responseProjectId）を cancelled に
- PRESSURE_RESOLVED / PRESSURE_CANCELLED Event を発火した後、Pressure を削除
- Project cancel 対象の判定は Pressure.status によらない（responded 状態でも関連 active Project は cancel する）

### 6.53 PersonGoalMaintenanceSystem（48週ごと）

Person Goal（人生目標）の生成と管理。成人時または初期生成時に 1 つの PersonGoalKind を選択。Person Goal は原則として固定であり、GoalMaintenanceSystem のレビュー・差し替え対象にはならない。

**生成対象**: alive / normal / `isLifeStageAtLeast(lifeStage, 'young_adulthood')` / active House 所属の Person。placeholder は除外。

**PersonGoalKind スコアリング**: trait (ambition/caution)、ability、attitude、office 保有、組織コンテキストから score を計算し、最高スコアの kind を選択。

**fulfillment**: Goal.progress を baseFulfillment として使用。`getPersonGoalFulfillment` selector で baseFulfillment + 現在状況由来の modifier を算出（0..100 に clamp）。

イベント: `PERSON_GOAL_CREATED`

### 6.54 PersonAimMaintenanceSystem（4週ごと）

Person Aim の生成・deadline 判定・waiting 再評価を管理。

**4w で実行する処理**: deadline 到達 Aim を failed に。target 無効 Aim を failed/abandoned に。waiting Aim の再評価（nextReviewWeek 到達時）。active Aim がない Person に Aim を生成。

**PersonAimKind 選択**: Goal Kind と状況に基づいてスコアリング。`support_organization_aim` を含む全 PersonAimKind が選択対象（スコアリング・target 解決・failure handling すべて実装済み）。

**Aim → Task 接続**: Aim 作成時に initial Task を生成し、activeTaskId を設定。

イベント: `PERSON_AIM_CREATED` / `PERSON_AIM_SUCCEEDED` / `PERSON_AIM_FAILED`

### 6.55 TaskSystem（毎週）

Task の生成・処理・outcome・ActivityLog・cleanup を同一 tick 内で完結する一体型 system。

**処理フロー**:
1. active Task の自動キャンセル判定（assignee 死亡/placeholder、owner inactive、target 消滅/terminal）
2. active Task を assigneePersonId ごとに集める
3. effectivePriority を計算（ownerDutyBonus + goalAlignmentBonus + urgencyBonus + taskKindPriorityBonus - overloadPenalty）
4. actionCapacity が許す限り Task を処理（base 2.0、ambition ≥ 0.7 で +0.5、age ≥ 60 で -0.5）
5. effortDone を加算（weeklyEffort = 1.0 × (1 + relevantAbility / 100)）
6. 完了した Task の outcome を判定（`determineTaskOutcome`）
7. ActivityLog を作成
8. target entity に結果を反映（outcome に応じた分岐処理）
9. 完了・失敗・キャンセルされた Task を state から削除

**outcome 判定** (`determineTaskOutcome`):
- `effectiveScore = abilityScore + roll * 100` (0〜220 の範囲)
- `threshold = difficulty * 2` (0〜200 の範囲)
- `effectiveScore >= threshold + successMargin` → success
- `effectiveScore >= threshold` → partial
- `effectiveScore < threshold` → failure

**prepare_project outcome 分岐**:
- success: Project を作成（creator を prepare_project の assignee、supervisor を selectProjectSupervisor で選定）
- partial: Project を作成するが targetProgress にペナルティ加算
- failure: Project を作成しない

**advance_project outcome 分岐**:
- success: progress += 25
- partial: progress += 10
- failure: progress += 0

**preparatory stage outcome 分岐** (targetRef.kind === 'project' かつ preparatory stage):
- success: preparation/leverage/commitment に full gain 加算（respond_to_pressure は gain 不適用）、stageAttemptCount リセット、次 stage へ遷移
- partial: partial gain 加算、同 stage に留まる（attempt 消費なし）
- failure: gain なし、stageAttemptCount increment、上限超過で Project failed

**target-side progress bridge**: DiplomaticPlay の target-side task 完了時に、`pressureIndex.byDiplomaticPlay` 経由で response Project を検索し、progress を加算する

**develop_holding budget 消費**: advance_project outcome 解決時に ProjectBudget を消費する。消費額 = `budget.required / (expectedTasks × projectBudgetMarginMultiplier)`。outcome に関わらず一律消費（費用はタスク内容に、進捗は結果に由来するため）。将来的に担当者能力による消費乗数を導入予定。

**Aim 系 Task outcome 分岐**:
- success: 通常処理（Aim progress +1、次 Task 生成等）
- partial / failure: progress を加算せず、aim は active のまま維持（次の personAimMaintenanceSystem サイクルで新 Task が生成される）

**DiplomaticPlay Task**: delegate に割り当て。side (initiator/target) で Task 種類の base score が異なる。delegate 能力が効果量に倍率（0.5 + ability/100）で影響。

**seek_diplomatic_support（v0.43）**: LIGHT task（HEAVY だと play 完了前に escalation しやすいため）・difficulty 40。**relevantAbility は v0.47.2 で charisma→learning に変更**（task の前進 = 謁見の手続き・段取りの手早さ = 学識。実際に勧誘相手が乗るかどうかの「説得力」は joinScore の persuasion 項で別途表現する、という切り分け）。他の外交 task と違い **outcome 依存**の専用効果（`applySeekDiplomaticSupportMut`）: success のとき `selectBestSupportCandidate`（`diplomaticSupportSelectors.ts`。候補列挙 PolityId 昇順 → joinScore 計算 → score 降順・同点 PolityId 昇順、RNG 不使用）で最良候補を選び、`joinScore >= diplomaticSupportJoinScoreThreshold`（**v0.47.2 で 25→40**。proximity 単独=35 では届かなくし、安易な肩入れを抑える）なら `addDiplomaticPlaySupporterMut` で supporter 追加 + `DIPLOMATIC_SUPPORT_DECLARED` emit。threshold 未満 / 候補なし / partial / failure は無効果（`[DEBUG:SUPPORT_RECRUIT]` のみ）。候補の hard exclude: inactive / primary / 既 supporter（両 side）/ 他 active play の supporter / 他 active War 参加中 / commonwealth（ただし revolt の rebel commonwealth は primary として支援を受けられる。**かつ v0.47.2 で、叛乱の rebel side=initiator が募集する場合に限り、同じ `popular_revolt` 由来の「同志の叛乱国家」commonwealth は候補に許す**）/ 宗主-臣下 LandContract chain（双方向・間接含む）。**v0.47.2（ルートA）— 叛乱鎮圧側の宗主-臣下除外緩和**: `enumerateSupportCandidates` に `side` を渡せるようにし、`revolt_negotiation` の **suppressor=target side に限り宗主-臣下 chain 除外をスキップ**する。叛乱では target（反乱された統治者）の宗主チェーン（独立により税率 0% 契約が挿入され収入を失う上位契約者）と又臣下こそが鎮圧の自然な利害当事者であり、third-party 除外で弾くと鎮圧側が永久に援軍ゼロになる（旧来の非対称）。なお nominal occupation 子契約（v0.53 で revolt_seizure 子契約から置換）により initiator=反乱軍 commonwealth の overlord 集合は target チェーンに汚染されるため、vs initiator / vs target の**両方向のチェックをまとめてスキップ**して初めて宗主が候補に乗る。side 省略時は従来どおり両 side 対称に除外を全適用する。joinScore 側に「収入喪失」動機項はまだ無く、宗主は他の近隣国と同じ joinScore で競う（弱い反乱軍に対する militarySparePower が高く出るため鎮圧側に乗りやすい。収入喪失を優先動機として明示的に favor するのは将来課題）。**反対側 primary と支配家が同一の候補は side 依存で除外する（v0.45.2）**: 同家除外は `selectBestSupportCandidate` で行う（自 side の primary と同家は除外しない — 家が自分の polity を支援するのは自然）。`addDiplomaticPlaySupporterMut` にも同チェックの安全網があり `'same_house_as_opponent'` で拒否する。joinScore = Σ(weight × score)、各項 0..100 正規化: proximity（争点 Province 隣接 terminal=100 / 同 State=50）0.35 / militarySparePower（敵 primary 比 ratio、同等=50）0.25 / treasury（1000 で満点）0.10 / threatContainment（敵 primary が強大 × candidate と近接）0.30 / lastWarPenalty（終戦から 96 週線形減衰）-0.20 / politicalOpinion（influence 加重 attitude。`getWeightedOpinionFromInfluenceBreakdown`）は **weight 0 の休眠項**（foreign polity への attitude 書き込みサイトが存在しないため。writer は将来課題）。**v0.47.2 で 2 つの加点項を追加**: (1) **persuasion** — 募集側 delegate（反乱軍なら首謀者）の能力ボーナス `(charisma×0.7 + insight×0.3)/100 × supportPersuasionScale(30)`（0..30）。candidate 非依存なので順位は変えず「最良候補が閾値を越えるか」を有能な交渉担当者ほど後押しする（delegate 不在なら 0）。(2) **rebelBacking** — 叛乱の rebel side=initiator 募集時のみ: 候補が landed polity なら `-supportRebelBackingPenalty(40)`（領地を持つ貴族が農民反乱に肩入れするのは不自然）、`popular_revolt` 由来の同志の叛乱国家なら `+supportFellowRevoltBonus(30)`。これにより反乱軍の支援者は「体制側の領主」から「同志の反乱勢力」へ移る（実測 150 年×4seed: 地主由来の肩入れ ~79%→16% / 同志由来 68% / 反乱軍勝率 ~51%→28%）。suppression=target side には rebelBacking を適用しない。

**offer_compromise**: Task 成功時に新 DiplomaticOffer を作成する。
1. progress += offerCompromiseProgressDelta (15)（既存 progressGainMedium は使わない）
2. tension -= tensionReductionSmall (5)（既存通り）
3. lastRejectedOfferId を基に妥協方向へ調整した demands で新 offer を生成（基準幅 ±30%＝`COMPROMISE_ADJUSTMENT`、initiator / target で対称）。**交渉担当者の能力スケール（`personAbilityEffectsEnabled`、default ON）**: 提案側（proposer）の delegate（`initiator/targetDelegatePersonId`）の charisma/insight 平均を 0..120 中点 60 基準で `[-1,1]` に正規化し、`adjustment = 0.3 × (1 − skillNorm × negotiatorTermQualityEffect)`（=0.1 で ±10%）で妥協幅を縮める＝巧い交渉者ほど譲歩幅が小さく理想に近い額を要求する（呑まれれば好条件）。これは受諾スコア（`evaluateOffer`）には触れない**条件生成側**の効果なので、能力が task 成功→prep/leverage/commitment→`getEvaluatorNegotiationBonus` 経由で受諾側に効く間接経路との**二重計上にならない**。OFF / delegate 不在時は基準 0.3。`contract_tax_revision` の妥協 demand 生成は side 非依存のため、未使用だった `_side` パラメータは除去済み
4. play.currentOfferId を新 offer に更新、play.offerHistoryIds に追加
5. offer_compromise による progress は offerCompromiseProgressDelta に一本化（counterOfferProgressDelta との二重加算なし）

**negotiate_terms**: progress += negotiateTermsProgressDelta (8)。

イベント: `TASK_COMPLETED` / `TASK_FAILED` / `TASK_CANCELLED`

### 6.56 GoalMaintenanceSystem（4週ごと）

Goal の生成・レビュー・abandon を管理する。tick 登録は 4w だが、生成・レビューは内部 48w ゲートで制御。

**4w で実行する処理**: inactive になった Polity / House の Goal を abandoned にする。
**48w ゲートで実行する処理**: active Goal がない主体に Goal を生成。review timing の Goal を評価し、steer_polity_* House Aim から policyInfluenceBonus を加算して差し替え判断。

`owner.kind === 'person'` の Goal はスキップ（PersonGoalMaintenanceSystem で個別管理）。

**v0.47.5: titular（称号化）Polity を生成・レビュー対象から除外**（`getPolityTerritorialStatus(polity) === 'titular'` をスキップ）。titular は landless かつ非 leader office / active right / LandContract を持たないため、Polity Aim 候補（領地開発・領地集約・契約税改定・陞爵＝いずれも territorial 前提。陞爵は `canPromotePolityRank` が territorial を明示要求）が全て空になり、`pickPolityAim` が常に `undefined` を返す。除外しないと Goal を生成しても 0-aim のまま、`goalMinimumDurationWeeks`（144週≈3年）経過ごとに keepScore≈15 < `goalSwitchThreshold`(20) で「abandon → 再生成」を空回りさせる（terminal Goal / orphan DecisionReason は `cleanupTerminalDecisions` が毎 tick GC するため **state 肥大は起きない**が、無駄な CPU と無意味な GOAL_CREATED/ABANDONED を生む）。意味のある目標を持てない owner に Goal を持たせないのが設計上正しい。称号化の瞬間に残っている active Goal は `titularizePolityInline`（§6.69）が Project / Aim と対称に abandoned へ terminal 化する（titular は active のため 4w の inactive-owner abandon に乗らず、除外後は reviewGoal も走らないため、遷移点での明示 abandon が必要）。

> **既知の gap（v0.47.5 時点・本パッチ範囲外）**: 現状 `territorialStatus` を `'territorial'` に戻す writer がコードに存在せず（書き込みは新規 polity 作成と titular 化の2箇所のみ）、**titular は事実上の終端状態**。仮に titular Polity が LandContract grantee を再取得すると、(a) 本除外により Goal 生成が永久にスキップされ非 leader office も 0 のまま凍結し、(b) §19.1 integrity（titular は grantee 0）に抵触して停止する。現状は titular が aim を持てず war/分封の grantee 側になる経路に実質到達しない（150年×4seed で未発生）ため顕在化しないが、将来 titular へ land を渡す経路を追加する場合は **territorial 復帰処理＋本除外の解除をセットで実装**すること。

GoalKind のスコアリングは `goalSelectors.ts` の `scorePolityGoalKind` / `scoreHouseGoalKind` で実装。system House は除外。

差し替え判断の keepScore は `progress*0.5 + (active Aim が 1 つでもあれば 10) + clamp(goalAge年, 0, 10)*5`。「進行中の Aim があるか」のボーナスは並列 Aim 数（§6.57）で増やさない（`Math.min(activeAims.length, 1)` でクランプ）。多数の並列 Aim が keepScore を吊り上げて Goal が永久固定されるのを防ぐため。

イベント: `GOAL_CREATED` / `GOAL_REVIEWED` / `GOAL_ABANDONED`

### 6.57 AimMaintenanceSystem（4週ごと）

Aim の生成・deadline 判定・target 無効化を管理する。tick 登録は 4w だが、Aim 新規生成は内部 48w ゲートで制御。

**4w で実行する処理**: deadline 到達 Aim を failed に。target 無効 Aim を failed/abandoned に。parent Goal が terminal の Aim を abandoned に。
**48w ゲートで実行する処理**: active Goal ごとに、並列上限 (cap) に達するまで active Aim を生成する。

**Aim 並列化（1 Goal = 複数 active Aim）**: 1 つの Goal の下に複数の active Aim を同時に持てる。これにより大国は複数の外交劇を、富裕な家は複数の開発を同時並行できる。

- **動的 cap（生成スロットル）**: `computeAimCapacityForGoal(state, config, owner)` が owner の規模/予算に応じて算出する。Polity = `aimCapacityBase + floor(terminalProvince数 / aimCapacityProvincesPerSlot) + floor(treasury / aimCapacityTreasuryPerSlot)`、House = `aimCapacityBase + floor(member数 / aimCapacityMembersPerSlot) + floor(wealth / aimCapacityWealthPerSlot)`。結果は `[1, aimParallelismCeiling]` にクランプ。treasury / wealth は **capacity の入力シグナル**であり消費はしない（経済メカニズムは別途）。
- **静的 ceiling（invariant）**: integrity（§6.24）が検査するのは動的 cap ではなく固定上限 `aimParallelismCeiling` のみ。動的 cap で検査すると国の縮小で capacity が下がった瞬間、合法に作った既存 Aim が偽の違反になるため。`aimParallelismCeiling = 1` にすると並列は無効化され旧挙動（1 Goal = 1 Aim）に戻る。
- **同一スロット重複禁止**: `aimSlotKey(kind, target?)`（target ありは `kind|targetRefKey`、なしは `kind`）が同一の Aim を二重に持つことを防ぐ。生成側（`pickAimForGoal` の候補除外 `excludedSlots`）と integrity の重複検査が **同一のキー**を共有する。target を持たない kind（`patronize_artist` 等）は同種を 2 つ並列に持てない。
- 候補が枯渇（除外後に候補なし）した時点で生成を打ち切る。

Aim target 選定は `goalSelectors.ts` の `pickAimForGoal` で実装。

- `improve_owned_contract_terms` / `demand_tax_increase_from_vassal` は `external_expansion` / `internal_development` 両方の goal で候補に入る（税率交渉は対外・内政どちらの文脈でも合理的なため）
- 対象契約の `termsProtectedUntilWeek` が現在週を超えている場合はスキップ
- **同家 polity 間の hostile aim 禁止（v0.45.2）**: 対象 polity の支配家が自分と同一（`politiesShareOwnerHouse`）の候補は aim に入れない。適用対象: `seize_weak_remote_holdings`（同家 holding は奪取対象外）/ `consolidate_province_holdings`（同家 holding は otherCount に数えない）/ 減税系 2 種（grantor が同家なら skip）/ 増税系 2 種（vassal が同家なら skip）。play 生成（§6.42）・project target 解決・War 化（§6.44）の安全網と同一 predicate を共有する「1 式・複数ゲート」構成で、主因の抑止は本 aim 選定側が担う（play 生成だけで弾くと即失敗 → 即再生成の高速ループになる — status_quo ゲートと同じ教訓）。
- **減税系 aim の受諾見込みゲート**: `improve_owned_contract_terms` / `eliminate_overlord_contract`（いずれも vassal → grantor への減税要求）は、対象契約の grantor（宗主）が polity でありかつ `predictPressureResponseStance(self, grantor) === 'resist'`（grantor が自分の `PRESSURE_RESIST_POWER_RATIO`=1.2 倍以上強い）の場合、候補に入れない。feudal chain 上、宗主はほぼ常に臣下より強く resist 確実なので、これを欠くと弱い臣下が「勝ち目のない減税要求」を量産し、外交劇は起こすが全て status_quo に終わる（「外交劇は起こすが何も変わらない」連発）。`predictPressureResponseStance`（`selectors/pressureStanceSelectors.ts`）は `choose_stance` の実 stance 決定（§6.57 / 後述）と play 開始ゲート（§6.42）で共有する単一の式で、将来 `getActorMilitaryPower` の算出が変われば予測と実応答の両方へ自動反映される。
- **political_right_target の無効化（v0.42 acquire 開放に伴う枝刈り）**: target validity 判定に
  political_right_target ケースを持つ。非 owner 開放で複数家が同一 target を狙うレースが
  起きるため、(a) 既に right が存在し holder が aim owner 自身でない（レース負け）、
  (b) target の polity が inactive、(c) office target の slot ≥ effectiveMax（縮小で取得不能化）、
  (d) holding 消滅 / regiment disbanded（destroyed は valid — right は destroyed を生き残る）の
  いずれかで aim を failed にする。holder が自家の right は valid のまま（project 成功後も
  progress 100 まで aim を回す既存 lifecycle に触れない）。失効条件は §6.65 の right 失効条件と平行。

イベント: `AIM_CREATED` / `AIM_FAILED` / `AIM_ABANDONED`

### 6.58 PressureSystem（毎週）

active Pressure に対して、**kind 別 routing** で対応 Project を自動生成する（v0.53）。すべての Pressure を一律 respond_to_pressure に流すわけではない。

- **diplomatic_land_claim / diplomatic_contract_revision**: 従来どおり respond_to_pressure 経路（下記処理）
- **real_estate_seizure / land_contract_default（v0.53、§6.70）**: enforce 系 Project を起案。real_estate_seizure の target は rightfulOwner House、land_contract_default の target は claimant Polity。

**処理（respond_to_pressure 経路）**: active かつ responseProjectId がない Pressure を走査し、target Polity の leader を取得。leader が alive / normal なら respond_to_pressure Project を作成。supervisor は `selectProjectSupervisor` で能力・workload ベースで選出（v0.45.3: 性別役職適格ゲート §6.19 適用。fallback: leader — 女性 leader でもよい、leader 例外の構造的実現）。

**target 解決（v0.53）**: pressure target を polity 決め打ちにしない。`target.kind === 'polity'` は claimant Polity の decision maker、`target.kind === 'house'` は `getHouseDecisionMaker` を使う（House target Pressure は real_estate_seizure で発生する）。

**enforce 生成（v0.53、real_estate_seizure / land_contract_default）**: respond_to_pressure ではなく `enforce_obligation`（seize 用、self-executed）/ `enforce_land_contract_default`（default 用、diplomatic）を起案する。strength gate は**生成段**に置き、勝ち目が無い（rightfulOwner House の resistance / claimant Polity の military・admin・stability が threshold 未満）なら enforce Project を**作らない**（「起案するが成功率を下げる」と失敗 Project が churn するため）。同一 seizure/default に active enforce は最大 1（`entity.activeEnforceProjectId` で追跡）、再起案 cooldown は `entity.nextEnforceAllowedWeek`（enforce 失敗 / cancel / gate 不成立後に `absoluteWeek + enforceObligationProjectCooldownWeeks` をセット）で持つ。supervisor は作成時に `selectProjectSupervisor` で選定（find_supervisor stage は持たない）。

**Project 初期値**: owner = pressure.target、origin = { kind: 'system', reasonKey: 'pressure_response' }、currentStageKey = 'choose_stance'、deadlineWeek = DiplomaticPlay.deadlineWeek or absoluteWeek + pressureResponseDefaultDeadlineWeeks。

**重複防止**: Pressure.responseProjectId が設定済みなら再生成しない。response Project が failed/cancelled でも responseProjectId を維持する（ループ防止）。

イベント: `PROJECT_STARTED`

### 6.59 AimOutcomeSystem（4週ごと）

terminal DiplomaticPlay の aimId を確認し、Play の結果に応じて Aim progress を更新する。settled / resolved_by_conflict（勝利）→ progress += `aimProgressGainLandOrContractProject` (50), successfulProjectCount +1。failed / resolved_by_conflict（敗北）→ failedProjectCount +1。activeDiplomaticPlayId をクリア。`progress >= targetProgress - aimProgressCompletionTolerance` で progress を targetProgress に丸め、Aim succeeded。

progress 加算値は targetProgress=100 ベース。非外交系 Project の Aim progress は ProjectOutcomeSystem が加算する（二重加算防止）。

イベント: `AIM_SUCCEEDED`

### 6.60 GoalOutcomeSystem（4週ごと）

terminal Aim の goalId を確認し、Aim 結果に応じて Goal progress を更新する。succeeded → +25、failed → -10、abandoned → -5（config 経由）。progress を 0..targetProgress にクランプ。progress >= targetProgress で Goal succeeded。

`owner.kind === 'person'` の Goal は progress を 0..100 にクランプし、succeeded にはしない（Person Goal は人生目標であり達成判定を行わない）。

**冪等ガード**: 本 system は毎 tick（4週）に terminal Aim を全走査する。外交系 Project が Aim を保持して CleanupTerminalDecisions が削除できない間（§6.61 retention）、同じ terminal Aim の progressDelta が Goal に再加算されないよう、Aim に `goalProgressApplied` フラグを設け、一度加算した Aim はスキップする（加算時に true をセット）。

イベント: `GOAL_SUCCEEDED`

### 6.61 CleanupTerminalDecisions（4週ごと）

terminal Goal / Aim を WorldState から削除。orphan DecisionReason を削除。goalIndex / aimIndex を更新。CleanupTerminalDiplomacy の後に配置。

**retention（削除しない条件）**: terminal でも以下に参照される間は削除しない。

- Aim: active な Project（`origin.aimId`）または DiplomaticPlay（`aimId`）が参照する Aim は保持（Project は origin Aim の存在を要求するため）。
- Goal: active な DiplomaticPlay（`goalId`）が参照する Goal は保持。
- **Goal（Aim 依存チェーン保持）**: 上記で生存する Aim が `goalId` で参照する Goal も保持し、`active Project → origin Aim → Goal` の依存チェーンを完結させる。これを欠くと、terminal Goal が「active Project に保持された terminal Aim」より先に削除され、Aim の `goalId` が dangling 化して年末 IntegrityCheck（`Aim X: goalId Y does not exist`）で throw する。Project 完了で Aim が解放されると、次回 cleanup で Aim → Goal の順に削除され収束する。

---

### 6.62 ChronicleProjectionSystem（毎週）

歴史閲覧 read-model（`ChronicleEntry`、§3.14）を生成する system。`scheduledSystems` の**末尾**（全 system / cleanup 系の後、`flushTerminalEntities` / IntegrityCheck の前）に配置する。この tick の `ctx.events` のうち curated allowlist `CHRONICLE_EVENT_TYPE_DEFINITIONS` に載る EventType だけを `ChronicleEntry` に projection し、新たな `SimEvent` は emit しない。各 system からの dual-write にせず projection 一本にすることで Event と履歴の divergence を防ぐ。cleanup 後に走るため同 tick の event が全量揃い、IntegrityCheck の前なので生成分も同 tick で index↔entry 整合検査される（§6.35）。

**実装ノート（perf, v0.47 アーカイブ carve-out）**: `chronicleEntries` / `chronicleIndex` は copy-on-write の対象外で、projection は state を clone せず **in-place append** する。成立条件は ① 書き込み点は `createChronicleEntryMut` 1 箇所（呼び出し元は本 system のみ）、② entry は作成後不変・削除なし（append-only。削除/改変 system を将来追加する場合は carve-out を廃止して copy-on-write に戻す）、③ simulation logic は chronicle を読まない（§1.1 相当の原則）。UI の chronicle 再描画は `toResult` が毎 tick top-level state を spread することに依存するため、`toResult` の直返し最適化は禁止（`tick/context.ts` 参照）。旧実装は entry 全量（年100で ~89k 件 = state の 87%）+ index 5 軸を毎週 spread しており、歴史総量×時間の二次コストとして全体の ~20% を占めていた。

**allowlist の方針**: importance 閾値ではなく curated allowlist で対象を決める（`BATTLE_OCCURRED` は normal だが含めたい／`PERSON_AIM_SUCCEEDED` は major だが noise になりやすい）。各 EventType に `{ category, retainRefKinds?, templateKey? }` を割り当てる。

- **category**（§3.14 の 11 種）— war: `WAR_DECLARED` / `WAR_WON` / `WAR_LOST` / `WAR_ENDED` / `PEACE_SETTLEMENT_APPLIED`。battle: `BATTLE_OCCURRED`。land: `LAND_CONTRACT_TRANSFERRED` / `CONTRACT_TAX_REVISED` / **（v0.53、§6.70）`REAL_ESTATE_SEIZURE_STARTED` / `REAL_ESTATE_SEIZURE_RESOLVED` / `REAL_ESTATE_SEIZURE_LEGALIZED` / `REAL_ESTATE_SEIZURE_CANCELLED` / `LAND_CONTRACT_DEFAULT_STARTED` / `LAND_CONTRACT_DEFAULT_RESOLVED` / `LAND_CONTRACT_DEFAULT_LEGALIZED` / `LAND_CONTRACT_DEFAULT_CANCELLED`**（低頻度 terminal イベントのみ chronicle 化。毎週の accumulatedUnpaidAmount accrual は非対象）。house: `HOUSE_FOUNDED` / `CADET_HOUSE_FOUNDED` / `HOUSE_SPLIT` / `HOUSE_EXTINCT` / `HOUSE_LEADER_CHANGED`。governance: `POLITY_OWNER_CHANGED` / `POLITICAL_RIGHT_GRANTED` / `POLITICAL_RIGHT_REVOKED` / `POLITICAL_RIGHT_TRANSFERRED`（v0.42）。revolt: `REVOLT_POLITY_FOUNDED` / `REVOLT_NEGOTIATION_STARTED` / `REVOLT_ESCALATED` / `REVOLT_SUPPRESSED` / `REVOLT_SETTLED` / `REVOLT_POLITY_ESTABLISHED` / `REVOLT_REGIME_CHANGED`。disaster: `FAMINE` / `PLAGUE`。development: `COUNTRY_LAND_DEVELOPED`。office: `OFFICE_ASSIGNED` / `OFFICE_TERM_ENDED` / `BAILIFF_APPOINTED` / `BAILIFF_VACATED`。faction: `FACTION_FOUNDED` / `PERSON_RECRUITED_TO_FACTION` / `FACTION_MEMBER_ABANDONED` / `FACTION_LEADER_CHANGED` / `FACTION_DISSOLVED`。life: `IMPORTANT_PERSON_DIED` / `PERSON_CAME_OF_AGE` / `PERSON_ENTERED_OLD_AGE` / `PERSON_ABILITY_GREW` / `PERSON_REPUTATION_GAINED` / `PERSON_REPUTATION_DAMAGED` / `PERSON_GENIUS_BORN` / `MARRIAGE_FORMED`（v0.47.4）/ `CHILD_BORN`（v0.47.4）。婚姻・出生は家の構成変化（婿入り・縁組・世継ぎ）を後から辿れるよう履歴書・家の記録の双方に永続化する（`MARRIAGE_FORMED` = groom/bride/家、`CHILD_BORN` = 子/父/母/家。いずれも `retainRefKinds` 無指定＝全 ref 保持）。
- **retainRefKinds**（projection 時に entityRefs をこの kind に絞る）— `OFFICE_ASSIGNED` / `OFFICE_TERM_ENDED` は `['person']`。役職任命は高頻度なので Person の「経歴」として byPerson だけに載せ、house / polity ref を落として国史・家史が行政ログで埋もれるのを防ぐ（役職名・Polity 名は params にあり、UI は entityRefs から link を描かないので表示は不変）。`BAILIFF_*` は person+province 無制限（人物経歴 + 地方統治史の両方に載せる）。faction 系は entityRefs が person（＋ index 非対象の faction kind）のみのため retainRefKinds 不要で自然に byPerson だけに載る（「誰と組んだか」を人物経歴に残す）。`PERSON_CAME_OF_AGE` / `PERSON_ENTERED_OLD_AGE` は retainRefKinds を指定せず、ref-kind の出し分け（一般人物 = byPerson のみ / 主要人物 = byPerson+byHouse+byPolity）は emit 時に entityRefs を変えて行う（§6.25）。
- **templateKey**: 通常は `event.messageKey` を流用。`BATTLE_OCCURRED` のみ関数 `selectBattleTemplate(event)` が messageParams の派生フラグから rich template を選ぶ（数的不利勝利 / 大勝 / 辛勝 / 通常、§8 / §11）。

**emit 整備（projection の前提となる source 側の emit）**:

- `mortalitySystem`: notable death（house / polity leader 相当）を `PERSON_DIED` から `IMPORTANT_PERSON_DIED`（major）へ type 昇格して emit する（単一イベント・重複なし・RNG 中立）。notability は office 剥奪前にしか正確に取れないため source で捕捉する。これで life カテゴリが成立する。
- `COUNTRY_LAND_DEVELOPED`: holding ref を 1 件 additive 追加し、施設開発を Holding 史（byHolding）にも載せる。

実 volume: ~41-43 件/年。office が ~62% を占めるが byPerson 限定のため中核 panel（国史 / 家史 / 地方史）には出ない。

---

### 6.63 OfficeTermSystem（48週ごと = 毎年）

毎年 1 回、任期が満了した leader 以外の Office を inactive 化する（`runOfficeTermSystem`）。`officeAssignments` を OfficeAssignmentId 昇順で走査し、各 active Office について以下を判定する:

- `office.role === 'leader'` は対象外（leader は OfficeTermSystem では失効させない。SuccessionSystem が管理する）。
- `isOfficeTermExpired(state, config, office)` が true（`officeTermYears` 経過）の Office を `expireOfficeTermAssignment` で inactive 化し、`OFFICE_TERM_ENDED`（importance: normal）を発火する。

Bailiff（HoldingOffice）にも任期があり、`provinceOfficeTermYears.bailiff` で管理する。任期満了で役職が空くと、AppointmentSystem（§6.19）の支払能力ゲートにより、収入を失った家の役職は再任命を通らず数年のラグで自然に減衰する。

イベント: `OFFICE_TERM_ENDED`（importance: `normal`）— `entityRefs` に holder Person・所属 House・（polity 役職なら）Polity を載せる。


---

### 6.64 PoliticalRight / Polity Influence（v0.42）

> **重要 (影響力個人中心化 redesign)**: 本節の影響力モデルは「影響力個人中心化」改修で
> 大きく更新された。**現行の as-built は §6.64a を正本とする**。本節 (6.64) の以下の記述は
> 改修で変わっている: ① 9 domain のうち wealth/base/prestige は係数 0 で無効 (受動 soft-power 全廃) /
> ② commonwealth の House soft-power は廃止 (僭主は構造項+成果項で個人創発) / ③ acquire の holder は
> person (遂行者個人) に / ④ 役職・person 保有任命権・代官の influence は保有者個人に帰属 /
> ⑤ 成果項 reputation domain を追加 (§6.64a-(2)。9→10 domain) / ⑥ v0.51 陰謀リファインで
> standing domain を追加 (InfluenceModifier の符号付き delta を加味。10→11 domain。§6.26 参照)。
> 変わっていない部分 (PoliticalRight entity 構造・slot 化・residual authority・RightConsistency) は本節が正本。

v0.42 で Polity の内部権力構造を「抽象的な Polity share」から「具体的な政治権利 **PoliticalRight** と、
それらから導出される **Polity Influence**（read-model）」に置き換えた。Polity share は全廃され、
House 内部の Share（HouseShare、§3.7）のみが一次データとして残る。

**PoliticalRight**（entity — §3 参照）:
- target は 3 種: `polity_office_role`（polity の non-leader role の**特定スロット**への任命権 —
  v0.42 slot 化）/ `holding_office_role`（Holding の bailiff 任命権）/ `regiment`（連隊の管理権）
- **slot 単位（v0.42 slot 化）**: polity office right は役職全体ではなくスロット 1 席
  （`slotIndex`、0-based）を支配する。maxHolders 3〜5 の役職で 1 right が全席を支配して
  権力が偏る問題と、同一役職内の家同士の対立を表現できない問題への対処。
  effectiveMax 縮小時は**列の後ろ（slotIndex 大）から失効**する（§6.65）ため、
  先頭スロットほど確保する価値が高い。失効した right は領土回復で slot が戻っても
  復活しない（hard-delete 原則。再取得が必要）。slotIndex は生成時に
  0 ≤ slot < 静的 maxHolders を検査（動的 effectiveMax の縮小は §6.65 が毎週回収）
- kind・tenure フィールドは持たない（target.kind / holder.kind から導出。保存すると drift の余地だけが生まれる）
- holder は person | house。**person 死亡 / house 絶家で失効**（即時 cascade: markPersonDead / worldStructureExtinction）
- **1 target 1 active right**（byTarget index の各 entry length ≤ 1）。hard-delete（active=false 残置なし）
- leader role は right の対象にしない（leader の地位は Succession / PolityOwnerConsistency が管理）
- **residual authority**: right が無い target の権限は entity として保存せず、「現行ロジックそのもの」が残余権限の実装
  （polity office = 通常スコアリング / bailiff = ownerHouse プール / regiment = owner Polity 管理）
- **regiment right の失効規則**: destroyed では失効しない（制度的単位・編制枠への権利と解釈。同一 RegimentId で
  reform されれば継続。destroyed 中は influence 寄与のみ 0）。disbanded（制度的解散）で即時失効
  （disbandRegimentMut 内 cascade）。owner Polity が right.polityId と一致しなくなったら RightConsistencySystem
  （§6.65）が失効させる
- 失効 cascade は mutation 層では silent（office の死亡時 revoke と同じ扱い）。POLITICAL_RIGHT_REVOKED は
  RightConsistencySystem の drift 回収時のみ発行
- **生成経路**: worldgen では生成しない（all residual で開始）。通常の生成経路は `acquire_political_right`
  Project（§6.41 / 下記）のみで、holder は owner House の household right。personal right（holder=person）は
  型・mutation・integrity 基盤のみ存在し v0.42 では通常生成されない（unit test が唯一の検証。将来拡張の余地）

**Polity Influence**（read-model — selector `getPolityInfluenceBreakdown`）:
- entity ではなく随時計算。entry 母集合 = 土地ベース House（getPolityHouseIds）∪ office holder の House ∪
  right holder ∪ anchor Faction leader の House ∪（ownerHouseId 未定義の polity の）leader Person
- 9 domain（§6.64a-(2) で reputation、v0.51 陰謀リファインで standing を追加し現行は 11 domain）: base（House entry 一律）/ ruler（ownerHouse bonus。**非 ownerHouse 出身 leader の家には
  polityInfluenceLeaderHouseBonus** — ownerHouseBonus の 1/3 程度。leader∈ownerHouse なら二重計上しない。
  commonwealth は leader Person entry に ownerHouseBonus 相当）/ office（non-leader holder。overlap bonus は
  office 寄与への乗算相当を加算）/ military（military office holder + active regiment への regiment_control right）/
  land_administration（holding right + 現職 bailiff の House）/ landed_power（**対象 Polity 内限定**の province 数 +
  military proxy）/ wealth / prestige / faction（anchor Faction leader の House のみ — member 加算は future）/
  reputation（成果項。§6.64a-(2)）/ standing（InfluenceModifier の符号付き delta 合計。陰謀 undermine で負・恩賞等で正。§6.26）
- **【§6.64a-(1) で廃止 — 以下は旧 (v0.45.5) 挙動の記録】commonwealth でも House soft-power を付与する（僭主の創発）**:
  `ownerHouseId` 未定義の polity（反乱独立政体・commonwealth）でも House entry に soft-power（base / wealth /
  prestige / landed_power）を一律加算していた。これにより、共和国に office / faction で embed した富豪家が
  influence を蓄積し dominant holder（= 僭主）になりうる、というのが旧挙動。**影響力個人中心化で wealth / base /
  prestige の factor を 0 にしたため、commonwealth でこの経路から付くのは landed_power（構造項）のみ**となり、
  「wealth で支配する富豪家」は成立しない。僭主は構造項（役職・任命権）＋成果項（評判）を握った「個人」
  （person entry）として創発する（§6.64a-(1)）。以下は旧挙動の設計意図の記録: この筋道は**意図的に塞がなかった**
  （共和国に僭主が出現するのは自然な歴史的成り行きであり、
  §6.5 PolitySurplusDistributionSystem で余剰金が僭主家へ流れるのも「僭主が共和国から搾取する」物語として許容）。
  「叛乱直後に、倒したばかりの旧支配家が**残留代官**経由で即座に支配を取り戻す」アーティファクトは soft-power
  抑止ではなく、末端契約移転時の bailiff リセット（§6.22）＋ BailiffAppointmentSystem の holding 粒度走査で
  **構造的に**解消する（旧主の代官 → placeholder 化 → 母集合から消える）。注: wealth は現状 house-global
  （資産はどこで貯めても全額が influence 化）なので、足がかり 1 つの富豪家でも支配しうる。「地元で実力を築いた
  僭主」に寄せる stake 比例化は influence balance 改修（通常国にも波及）で将来検討
- percent は **0〜100**（既存 share 系と同スケール。比率が必要な箇所は /100）
- perf: 候補者ループ内で呼ばない。polity ごとに 1 回前計算して `getActorInfluenceFromBreakdown` で引く

**acquire_political_right Aim / Project**（旧 increase_polity_share / expand_polity_share の置換）:
- Influence は read-model なので「直接増やす」対象ではない。上げたければ具体的な権利・役職・土地を取る
- **対象 polity（非 owner 開放 — v0.42 拡張）**: 当初は自家所有 polity（`polityIndex.byOwnerHouse`）
  限定だったが、「家が influence を持ちうる polity」全体に拡大した。狙いは「王権が弱った国で
  臣下・廷臣の家が任命権を取り合う」状況の発生。候補集合は selector
  `collectAcquireRightCandidatePolityIds` が influence breakdown（上記）の entry 導入 source と
  1:1 対応で列挙する: 自家所有 polity / その**宗主チェーン全段**（land contract の
  parentContractId を上に辿る — 直接宗主のみだと多段封建で取りこぼす）/ 生存 member が
  polity office・bailiff を務める polity / 生存 member が leader の active Faction の anchor
  polity / 既保有 right の polity。過剰包含は influence ゲートが落とすので無害、過少包含は
  「influence があるのに aim が出ない家」の silent miss になる（この被覆が正しさの条件）
- Aim 生成条件（ゲート — 全家一律、owner / 非 owner で差を付けない）:
  `acquirePoliticalRightRequiredInfluencePercent` ≤ 対象 Polity への**家の支配率** <
  `acquirePoliticalRightMaxInfluencePercent`。**上限ゲート（v0.42 拡張）**は「既に掌握済みの
  polity の権利を買い続ける」不自然の排除 — right の無い役職の任命は influence ベース
  （§6.19 のスコアリング）なので、掌握済みの家にとって right は実質不要。上限判定は
  **Aim 生成時のみ**（保持中に influence が上限を超えても aim は invalidate しない）。
  **家の支配率（影響力個人中心化 §6.64a-(10)）**: 「掌握済みか」の判定は家 entry の
  influence% 単独ではなく、**家 entry ＋ 家中メンバーの person entry の influence% 合算**
  （`getHouseAggregateInfluenceInPolity`）で測る。個人帰属化（§6.64a-(4)）で役職・評判が
  person entry に移ったため、家単位の支配力評価では「家の中で対立はあっても国の支配は家全体で
  見る」原則に従い再集約する（expand/preserve goal scoring・運動・steer も同一定義を共有）
- target 選定: kind 優先度 polity_office（military > administrator > treasurer > advisor、
  各 role 内は slot 0..effectiveMax-1 の若い順 — v0.42 slot 化。先頭 slot ほど縮小に強い安全資産）
  > holding（House 関与 province の Holding 優先・id 昇順 = 近接優先の決定的簡略化）
  > regiment（active のみ・House 関与 home 優先）。
  いずれも right 未設定のもの。`aimSlotKey` に politicalRightTargetKey（slot を含む）が含まれ
  同一 (target, slot) への重複 aim を防ぐ
- 成功条件は createPoliticalRight の検査（target 実在 / polityId 整合 / 既存 right なし / holder House active）に
  集約。**コストは House wealth から対象 Polity treasury への transfer**（wealth sink ではない —
  旧 expand_polity_share の sink 消滅による経済変化を緩和し、「国庫に納めて権利を授かる」物語になる）
- 既存 right holder から奪う処理は v0.42 では行わない（争奪・剥奪・派閥闘争は future）

**イベント**: `POLITICAL_RIGHT_GRANTED` / `POLITICAL_RIGHT_REVOKED` / `POLITICAL_RIGHT_TRANSFERRED`
（importance: normal、chronicle category: governance）。messageParams は nameKey / enum のみ
（rightKind / revokeReason は events ns の enum.* ラベルに解決）。TRANSFERRED は v0.42 に通常発火経路が無く
（transferPoliticalRight は将来の PeaceSettlement / regime change 用）、unit test が唯一の検証。

実測（300 年 × 4 seed）: GRANTED 118〜141 件 / REVOKED は regime change の drift 回収として有機的に発火。

### 6.64a 影響力の個人中心化（Individual-Agency Redesign）

「家」でなく「個人」が国の意志決定を行い、家は個人の権力基盤である、という構造への作り替え。
§6.64 の影響力モデルを次のように更新する（**現行 as-built の正本**）。設計の背骨は
「影響力 = **構造項**（read-model: 役職・任命権・土地・ruler bonus）＋ **成果項**（既存
`PersonReputation` を influence に合算）」の二層化で、**資産（wealth）は受動的には影響力を生まず、
運動 Project に注ぎ込んで初めて influence に転化する**。

**(1) 受動 soft-power の全廃**: `polityInfluenceWealthFactor` / `polityInfluenceBase` /
`polityInfluencePrestigeFactor` を 0 にし、wealth / base（一律加算）/ prestige の 3 domain を
直接 influence から削除。構造項は「役職・任命権・土地」＋ owner/leader ruler bonus に純化する。
これに伴い §6.64 の「commonwealth でも House soft-power を付与（僭主の創発）」は廃止 — 僭主は
**構造項（役職・任命権）＋成果項（評判）を握った「個人」**として創発する（家でなく person entry が
支配 holder になる）。prestige を間接的に効かせる機構（功績あたり評判増等）は将来課題。

**(2) reputation domain（成果項）**: `PolityInfluenceDomain` に `reputation` を追加。各 Project /
War / DiplomaticPlay / 運動の完遂で生成される `PersonReputation`（§6.66）のうち、
`relatedOrganization.kind === 'polity'` かつ対象 polity が **active** なものの現在値合計
× `polityInfluenceReputationFactor`（0.5）を、その評判の **person 本人の entry** に加算する
（家に fold しない＝個人帰属の核）。母集合に「評判だけ持つ役職なし person」も列挙する。
負評判は per-entry sum を 0 床（反影響力にしない）。inactive polity の評判は read-model で 0 寄与
（cleanup はしない＝人事/採用の polity 横断名声には効き続ける。§6.66）。引き当ては
`PersonReputationIndex.byOrganization`（key=`${kind}:${id}`・tag された評判のみ）。

**(3) dual-tag award**: 1 つの Project / War / DiplomaticPlay の完遂で、**owner organization と
target organization の両方**に評判レコードを生成する（owner==target は 1 個に dedupe）。
家活動（owner=house）でも target=対象 polity の評判が生まれ、**家には Share・対象 polity には
influence** の両方を生む。target 導出: project は kind 別（acquire/promote→polityId・
develop→holdingTerminalPolity・movement→targetPolityId・patronize/commission/personal_training→
target なし）/ war は primary actor が house なら陣営 polity を target に追加 / play は v1 は現行
（自陣 actor）のみ。**v0.47.1 — war 戦功 tag の所属 gate**: war の評判 tag は受賞者本人が所属する
organization に限定する（house tag=当該家メンバーのみ / polity tag=`isPersonAffiliatedWithPolityForReputation`
— polity leader・当該 polity の active office holder・家が `getPolityHouseIds` に入る・anchor 派閥の
active メンバー（食客＝個人 influence coldstart として意図的に許容）のいずれか）。指揮官プールは
支援国の宮廷人材・派閥食客を含む（v0.43）ため、gate しないと「友軍として従軍しただけの外国家」が
当該 polity（特に建国叛乱戦争の commonwealth）の influence を声望 domain で保有してしまう。
所属 tag が 1 つも残らない受賞者には tag 無し評判（名声のみ — influence / Share に入らない）を与える。外交 project kind（respond_to_pressure）は project-outcome 経路で評判を生成せず
Play 側（§6.66）で評価するため、ここには含めない。

**(4) 役職 influence の個人帰属**: 役職（office domain）・person 保有任命権（regiment/holding_office/
polity_office）・現職代官（land_administration）の influence は、保有者「個人」の person entry に
計上する（家に fold しない）。家保有の土地（landed_power）・owner/leader bonus（ruler）・house 保有
任命権は引き続き house entry。office-overlap house bonus は撤去（house-level 概念）。
役職任命権（polity_office_role）保有者も office domain に直接加算する（3 種任命権を揃える）。

**(5) HouseShare に成果項**: `computeHouseShareRawPower`（§6.23）に house-tag 評判の現在値合計
× `houseShareReputationFactor`（0.5）を加算（0 床＝rawPower≥0 invariant）。influence と対称に、
同じ PersonReputation を relatedOrganization で振り分ける（polity tag→influence / house tag→Share）。

**(6) 家の意志決定者**: `getHouseDecisionMaker(state, houseId)` = 支配 share 保有者
（max `HouseShare.rawPower` の生存 holder・holderPersonId 昇順 tiebreak・share 無しは
`getHouseLeader` fallback）。「当主≠決定者」を分離し、家の**執行主体**（project supervisor
leaderBonus・交渉スタンス personality・外交代表）と **aim/goal 生成**（`scoreHouseGoalKind` の
ambition→expand / caution→preserve、`personAbilityEffectsEnabled` gate・`houseGoalPersonalityScale`）を
決定者個人で駆動する。構造的用途（succession/integrity/estate/mortality/ruler/worldgen）の
`getHouseLeader` は実際の当主が必要なため据え置き。

**(7) 運動 Project（movement_campaign）**: 家が資金（`movementProjectBaseCost` 40・家 wealth から
消費＝wealth sink）でメンバーを国に推薦し、完遂で**推薦個人**に dual-tag 評判（baseScore =
budget × `movementReputationPerCost` 0.2）が付き個人 influence が上がる。owner=家・target=対象 polity。
受益者（sponsoredPersonId）は `selectMovementBeneficiary`（家の役職適格メンバーから決定的 argmax・
RNG なし）が選び、**supervisor に固定**（auto 選定 bypass — 漏れると評判が別人に付く load-bearing）。
家 aim（`start_movement_campaign`）は expand_power_base 下で、foothold polity（未掌握）に役職適格
メンバーが居れば生成。役職適格は `isPolityRoleEligibleCandidate`（生存成人・非 bailiff・性別適格・
所属家が polity foothold）。

**(8) acquire 個人化 + 死亡時継承**: `acquire_political_right` の完遂で作る right の holder を
**遂行者個人（supervisor）**にする（コストは引き続き owner House wealth から・簡素版）。person 保有
任命権は holder 死亡時に `resolveRightInheritanceOnDeath`（`markPersonDeadWithInheritance` wrapper に
集約・死亡 3 サイトで共有）で**国回収（削除）か家産化（holder=house に変換）**に分類する:
houseless→国回収 / 死亡者家==owner家→家産化 / commonwealth→死亡者家%<`rightInheritanceHouseRetainThreshold`
(20) で国回収・else 家産化 / 通常→owner家%≥`rightInheritanceOwnerSeizeThreshold`(70) で国回収・
死亡者家%<20 で国回収・else 家産化、+ `rightInheritanceFlipChance`(0.15) で反転（houseless/owner家同一は
flip skip）。flip は rightId+personId の決定論 hash（RNG state 不要）。**ここでの owner家%・死亡者家% は
家の支配率（§6.64a-(10) の集計値）** で測る。influence% は pre-death snapshot（死亡者本人の office /
reputation 寄与込み）。transfer err（家 inactive）は国回収 fallback。

**(9) faction / appointment への person influence 貫通**: faction nomination power
（`getFactionNominationPowerForPolity`）にメンバー**個人**の person influence% を算入（leader家×1.0/
他×0.5）。これにより役職個人化分＋評判を faction 経由で回収し、「評判を積んだ landless 個人が自分の
派閥の推薦力を高めて任用される」コールドスタート経路が成立する。appointment scoring も候補本人の
person influence% を加味（家 backing + 個人立場の両建て）。

**(10) 家の支配率（house aggregate influence）**: 「家がその Polity をどれだけ支配しているか」を
測る統一指標。`getHouseAggregateInfluenceInPolity` = **家 entry の influence ＋ 家中の生存メンバーの
person entry の influence の合算**（同一 polity・分母は polity 総 influence で共通なので percent を
そのまま足せる）。個人帰属化（§6.64a-(4)(2)）で役職・評判・person 保有任命権・代官の influence が
person entry へ移ったため、家 entry 単独では「メンバーが役職を総取りして実質支配している家」が低く
出てしまう。これを是正し「家の中で対立はあっても、国の支配は家全体で見る」原則を全支配力評価で共有する。
**適用箇所**: 役職取得などの動機ゲート（§13.3 acquire / 運動 / expand-preserve goal scoring / steer）・
死亡時継承の owner家%・死亡者家%（(8)）・家断絶時の領地継承先（最有力家選定）・有力家門判定
（`isInfluentialHouse`＝クラン形成条件）。**非適用**: 余剰金分配の収入投影（`getHouseProjectedAnnualIncome`）
は実配分が entry 単位（person entry 分は treasury 残置）なので集約すると過大投影になり、house entry%
単独のまま。

**balance（機能完成後のエポックで調整・現段階 config 据え置き）**: ruler bonus が単一最大 domain
（~33-38%）・reputationFactor 0.5 の再較正余地・運動発火頻度・人事スコア cap 張り付き・継承閾値
20/70 の縮退・landless coldstart の活発さ（faction person-influence weight）。

### 6.65 RightConsistencySystem（毎週）

PoliticalRight の drift を定期回収する安全網。**regimentMaintenanceSystem の直後・cleanup 系の前**に配置する
（regimentMaintenance が Regiment owner を terminal Polity に同期した後でないと、owner 変化による
regiment_control right の失効を回収できない）。

**interval は 1（weekly）必須**: 年末 integrity は absoluteWeek ≡ 47 (mod 48) の tick 末尾で走るが、
interval 4 / offset 0 の system は weekOfYear 1, 5, …, 45 にしか走らず**年末 tick に走らない**。
weekly の regimentMaintenance が weekOfYear 46〜48 に owner を付け替えると、4 週間隔では drift が
未回収のまま年末 integrity に到達して throw する。cancelOrphanedWarsSystem（§6.47）と同じ weekly パターン。
年末 invariant を守る cleanup は (a) weekly か (b) drift 源と co-locate（atomic）のどちらかでなければならない
（Faction 解散 / right 削除 cascade を PolityOwnerConsistency の deactivate 経路に co-locate しているのは (b)）。

**検査内容**（不整合なら hard-delete + POLITICAL_RIGHT_REVOKED 発行。revokeReason enum:
holder_lost / polity_dissolved / target_lost / regime_change）:
- holder が存在し有効（person: alive・normal / house: active）
- right.polityId が active Polity
- target が存在する（regiment は status !== 'disbanded'。destroyed は許容）
- target と polityId が整合する（office target.polityId / regiment owner / holding terminal polity）
- **office right の slot 失効（v0.42 slot 化）**: `slotIndex >= getEffectiveOfficeMaxHolders(...)`
  なら target_lost。effectiveMax は rank / 領土数で動的に変わり **0 にもなり得る**
  （rank cap 0 の role では slot 0 の right も失効）。「列の後ろから失効」の実装はここ
  （findRightInconsistency は config を引数に取る）

即時 cascade（一次手段）との分担: person 死亡・house 絶家・regiment disband・polity inactive は mutation 層で
即時削除（silent）。本 system は「mutation では追わない」regiment owner 付替・holding terminal 変化などを回収する。

**IntegrityCheck 追加項目（v0.42）**:
- R1: holder は存在し有効（person: alive かつ normal / house: active）
- R2: polityId は active Polity
- R3: target は存在する（regiment は disbanded のみ違反、destroyed 許容。leader role target も違反）
- R4: target と polityId が整合する
- R5: byPolity / byHolder / byTarget index と politicalRights の双方向一致
- R6: 1 target 1 active right（byTarget の各 entry length ≤ 1）
- F8: active Faction の polityId は active Polity（+ factionIndex.byPolity の双方向一致）
- HouseShare: polity share は**存在自体が違反**（型レベルでも HouseShare に縮小済み — §3.7）

### 6.66 成果成長・PersonReputation（v0.44）

人物の能力成長と評判を、Task 単位ではなく「歴史的に意味のある成果単位」（Project / DiplomaticPlay / War / personal_training）へ接続する。旧 Task 訓練経験（`personTrainingExperience` / `taskTrainingExperienceGain` / decay）は全廃した。

#### 即時成長エンジン（`applyImmediateAbilityGrowthMut`）

terminal 時に経験を ability weight で分配し、**floor + fractional roll** 方式で即時に +1 を適用する。

```ts
expectedGain_ability = totalExperience * abilityWeight * experienceImmediateGrowthChancePerPoint / 100
guaranteedGain  = floor(expectedGain)      // 確定 +1 × N（RNG 不消費）
fractionalChance = expectedGain - guaranteedGain  // 1 回だけ追加 roll
```

- 各 +1 は `ability < min(aptitude, ABILITY_HARD_CAP=120)` の場合のみ適用。**naturalCeil は無視してよい**（成果成長は年齢曲線を超えて早熟化・高水準維持しうる）が、生得的な aptitude は超えない。cap 到達分の経験は他 ability へ再分配しない。
- roll 順序は `ABILITY_KEYS` 定数順・対象人物順は呼び出し元の配列順に固定（決定性）。
- 成長した ability ごとに `PERSON_ABILITY_GREW` を emit（notable=normal / 一般=minor。notable 判定は `isNotablePerson` selector — §6.25 の index ベース判定を共通化）。

**経験 weight**: source → role → `ROLE_WEIGHTS`。Project は `PROJECT_KIND_ROLE_MAP`（例: develop_holding → stewardship）、DiplomaticPlay は diplomacy（charisma .5 / insight .3 / learning .2）、War は warCommand（command .6 / insight .2 / learning .1 / valor .1）。`personal_training` のみ例外で `trainingAbilityKey` 単独 weight 1.0。

#### PersonReputation entity

```ts
type PersonReputation = {
  id: PersonReputationId          // 'rep-' prefix
  personId: PersonId
  source: { kind: 'project'; projectKind; projectId? }
        | { kind: 'diplomatic_play'; playKind; playId? }
        | { kind: 'war'; warId? }
  outcome: 'success' | 'failure'  // UI/将来 subtype 用。現在値計算は baseScore の符号に基づく
  category: 'administration' | 'military' | 'diplomacy' | 'culture' | 'stewardship' | 'intrigue' | 'general'
  baseScore: number
  createdWeek: number
  expiryWeek: number              // 作成時に事前計算
  relatedOrganization?: OrganizationRef
  relatedRefs: EntityRef[]
}
```

- 現在値は selector（`getCurrentPersonReputationScore`）で月次減衰計算: `baseScore * personReputationMonthlyRetentionRate^(経過月)`。
- `expiryWeek` は「現在値の絶対値が `personReputationCleanupThreshold` を下回る週」を作成時に対数計算して保存。`abs(baseScore) <= threshold` なら reputation を**作成しない**。
- cleanup: **PersonReputationCleanupSystem（年次）** が expiry 超過 + 死亡者残骸を削除。死亡 tick の即時 purge は DeadPersonLogPurgeSystem に piggyback。index 不整合は cleanup で黙修せず IntegrityCheck の検出対象。
- 付与時に `PERSON_REPUTATION_GAINED`（正）/ `PERSON_REPUTATION_DAMAGED`（負）を emit。
- **index（影響力個人中心化）**: `PersonReputationIndex` は `byPerson` に加え `byOrganization`
  （key = `${kind}:${id}`・`relatedOrganization` が tag された評判のみ）を持つ。influence read-model
  （polity-tag）と HouseShare 再計算（house-tag）が polity / house 単位で評判を引くのに使う
  （byPerson 全走査の perf 退行を回避）。add/remove で双方向保守・IntegrityCheck で検証。
- **二重用途（影響力個人中心化）**: 同一 PersonReputation が ① **人事/採用 scoring**
  （`getPersonReputationModifierForCategories`・`byPerson`+category のみで `relatedOrganization` を
  見ない＝**polity 横断**の名声。「他国で活躍した者を抜擢」が成立）と ② **influence/Share の足場**
  （`relatedOrganization` で polity / house に限定集計）の両義を持つ。inactive polity 由来の評判は
  ① には効き続け（cleanup しない）② の influence には 0 寄与（read-model で active filter）。
- **dual-tag / influence・Share 合算（影響力個人中心化）**: 完遂時に owner + target organization の
  両方に評判を生成し（§6.64a-(3)）、polity-tag は対象 polity の influence（§6.64a-(2)）・house-tag は
  対象家の Share（§6.64a-(5)）に合算される。運動 Project（movement_campaign）も同 hook で評価する
  （baseScore = budget × `movementReputationPerCost`・category=general・§6.64a-(7)）。

#### terminal 評価（hook 別）

**Project（ProjectOutcomeSystem、削除直前。非外交 kind のみ — 外交系 5 kind は Play 側で評価）**:

| status | 経験 | 評判 |
|---|---|---|
| completed | `projectExperienceGainCompleted` | 正（`personReputationProjectSuccessBase`） |
| failed + deadline_expired / stage_attempts_exceeded | `projectExperienceGainFailed` | 負（`personReputationProjectFailureBase`） |
| failed + その他 reason（budget_exhausted 等） | 同上 | なし（本人帰責でない失敗） |
| cancelled | completed × progressRatio × `projectExperienceGainCancelledMultiplier` | なし |

対象 = supervisor（alive guard）。category は `PROJECT_REPUTATION_CATEGORY_MAP`（develop_holding=administration / acquire_political_right・promote_policy_shift=diplomacy / patronize_artist・commission_chronicle=culture / **movement_campaign=general** / 外交 5 kind・personal_training=undefined）。**影響力個人中心化**: 完遂時の評判は dual-tag（owner + target polity）で生成し（§6.64a-(3)）、relatedOrganization 別に influence / Share へ合算される。

このゲートのために Project に `terminalReason`、DiplomaticPlay に `terminalOutcome` を追加した（§3）。**status を terminal にする全サイトで同時セット必須**（IntegrityCheck 検査。terminal entity は同 tick〜4 週内に削除されるため年末 integrity では実質検出できず、`--integrity-per-system` での mid-tick 検証 + ProjectOutcomeSystem の fail-fast throw で担保する）。

**DiplomaticPlay（CleanupTerminalDiplomacy、削除直前。対象 = 両 side delegate）**:

| terminalOutcome | initiator delegate | target delegate |
|---|---|---|
| demands_met | 成功 | 失敗 |
| status_quo | 小失敗 | 小成功 |
| escalated_to_war | 失敗 | 小成功（戦争回避には失敗のため成功より小さく） |
| revolt_succeeded | 成功 | 失敗 |
| revolt_suppressed | 失敗 | 成功 |
| failed | 失敗 | なし |
| voided | 経験のみ（failure × cancelled 係数） | 同左 |

成功/失敗 = `diplomaticPlayExperienceGainSuccess/Failure` + `personReputationDiplomacySuccessBase/FailureBase`、小成功/小失敗 = `...GainStatusQuo` + `StatusQuoBase` / `-abs(StatusQuoFailureBase)`。category は revolt 系含めすべて diplomacy（military/general subtype 化は将来課題）。settled の demands_met / status_quo 分類は accepted offer に実質要求 demand（transfer_land_contract / change_contract_tax_rate / popular_tax_relief）が含まれるかで判定（`classifySettledOutcome`。pay_wealth 単独は status_quo）。

**War（PeaceSettlementSystem 全終結サイト + cancelOrphanedWarsSystem。対象 = 両 side の captain general + commanderPersonIds、alive guard・重複は captain general 満額のみ）**:

| status | 勝者側 | 敗者側 |
|---|---|---|
| attacker_won / defender_won | victory 経験 + `personReputationWarVictoryBase` | defeat 経験 + `personReputationWarDefeatBase` |
| white_peace | 両者 `warExperienceGainWhitePeace` のみ | 同左 |
| cancelled | 両者 defeat × cancelled 係数のみ | 同左 |

現場指揮官は経験・評判とも `warCommanderAwardFactor`（0.6）を乗じる。category は military。

#### personal_training Project（improve_ability の project 化）

旧 `improve_ability` Aim → 直接 Task 生成（practice_arms / study_accounts / study_law / courtly_training）は廃止し、`personal_training` Project を生成する（4 TaskKind は削除済み）。

- owner / creator / supervisor / trainee は全て本人で一致（IntegrityCheck 検査）。budget なし。
- stage は `execute_project` (final) 単一。汎用 `advance_project` Task で進行し、Task の `relevantAbility` は `trainingAbilityKey`。
- targetProgress = `personalTrainingTargetProgress`、deadline = `personalTrainingDeadlineWeeks`。
- terminal: completed=経験大 / failed=中 / cancelled=進捗比例。**評判は一切発生させない**。
- 本人死亡（alive === false）で cancelled。処刑 cascade（`reassignProjectsOfDeadSupervisor`）にも personal_training → cancelled 分岐を持つ。

#### 評判の任用・指揮官選定反映

中核 selector `getPersonReputationModifierForCategories(state, config, personId, categories)`: byPerson の現在値を category filter で**等価合算**し `±appointmentReputationModifierCap`（20）に clamp。注入先で係数を 1 回だけ掛ける（二重適用禁止）。

| 選定経路 | 反映 | 係数 |
|---|---|---|
| Polity / House office appointment score（§6.19） | する | × `officeReputationScoreFactor`（0.25、実効 ±5）。role → category は administrator=administration+diplomacy / treasurer=stewardship+administration / military=military / advisor=culture+diplomacy+intrigue / leader=general+diplomacy+military+administration |
| War commander candidate ranking（warCommandSelectionScore） | する | × `warCommandReputationScoreFactor`（0.75、実効 ±15）。category=['military'] |
| captain general 選定 | 原則効かない | 役職優先順選定で score ソートを通らないため |
| Bailiff / Project supervisor / Play delegate 選定 | しない | — |

#### IntegrityCheck（v0.44 追加分）

- PersonReputation: id 整合 / personId 実在 / baseScore finite / createdWeek <= expiryWeek / category・source.kind 有効 / byPerson 双方向一致 + 空 entry purge
- Project: terminal status は terminalReason 必須（active は持たない）/ personal_training の本人 4 役一致 + trainingAbilityKey 有効
- DiplomaticPlay: terminal status は terminalOutcome 必須（active/escalated は持たない）

**年末 flush の取りこぼし（許容）**: ProjectOutcomeSystem（4 週）より後に terminal 化し同一年末 tick の flushTerminalEntities で削除される Project（主に CleanupTerminalDiplomacy の pressure cascade による cancel）は cancelled 経験付与が省略されうる。軽微な cancelled 経験の取りこぼしであり v0.44 では許容する。

### 6.67 天才（v0.45）

観賞用として「天才の活躍」を増やすため、人物生成時に低確率で意図的に能力上限の高い人物を登場させる。

#### 型と対応能力

| GeniusType | 表示 | 対応能力 |
|---|---|---|
| `commander` | 名将 | valor / command / charisma |
| `chancellor` | 名宰相 | numeracy / learning / insight |
| `universal` | 万能 | 全 6 能力 |

#### ロールと効果（`sim/helpers/geniusHelpers.ts`）

- **出現判定** `rollGeniusType`: 生成 1 人につき `geniusAppearanceChance`（0.01）で出現。ヒット時に型を weight（commander 0.4 / chancellor 0.4 / universal 0.2、合計正規化）で選択。chance 0 で機能ごと無効化できる
- **天賦** `applyGeniusAptitudes`: 対応能力ごとに uniform int `[geniusAptitudeMin(80), geniusAptitudeMax(120)]` をロールし `max(既存値, ロール値)` を適用。通常生成上限（`ABILITY_GENERATION_MAX`=100）を超えうるが `ABILITY_HARD_CAP`=120 は超えない。遺伝（`inheritAptitudes`）で既に高い値は潰さない（床として働く）
- **初期能力**: 通常サンプルのまま（人工的な引き上げはしない）。当初の `applyGeniusInitialAbilities`（初期値 50）は v0.45 内で撤廃した — 成長量がギャップ比例（§6.24）になったため、天賦と現在能力の大差自体が幼少期の高速成長として表現される

#### 生成フック（2 経路で全生成サイトをカバー）

| 経路 | カバー範囲 | 処理 |
|---|---|---|
| `samplePerson`（personFactory） | worldgen 初期人口 / 在野人物 / 婚姻配偶者 / commonwealth 指導者 | aptitude サンプル → roll → 天賦・初期能力の両適用 |
| `birthSystem` → `birthChild` | 出生 | birthSystem で roll + 天賦適用 → birthChild 内で初期能力適用 |

**制約**: `generateWorld` は config 引数を持たず `defaultConfig` 直参照のため、CLI `--config` での genius 設定変更は tick 中の生成にのみ効き、**worldgen 初期人口には効かない**（全 config 共通の既存制約）。

#### 既存システムとの相互作用（設計時に検証済み・追加実装なし）

- 自然成長上限は age-curve fraction（最大 0.7-0.75）× 天賦のため、天才も自然成長だけでは天賦の 7 割止まり。**天賦 80-120 を使い切るには職務経験（§6.24 の ceiling 解放）や成果成長（§6.66）が必要** — 「登用された天才だけが大成する」が創発する
- 幼少期の天才は naturalCeil（= 高い天賦 × 年齢曲線）を毎年ギャップ比例で追走し、通常の子の約 2 倍の水準で育つ
- `isNotablePerson` に `geniusType` 判定を追加（§6.25）。天才の成長ログは normal になり、死去は `IMPORTANT_PERSON_DIED` 対象になる
- **死亡率補正（v0.45.1）**: 自然死判定率に `geniusMortalityMultiplier`（0.5）を乗じる（§6.7）。夭折率は約 26% → 約 15% に下がり、「才能を開花させる前に死ぬ」がデフォルトでなくなる（夭折の物語は稀に残る）
- **在野刈り込みから除外（v0.45.1）**: `faded_from_history` の対象にしない（§6.18）。在野でも自然死はするため不死にはならない

#### イベント・UI

- `PERSON_GENIUS_BORN`（importance `major`・メインログ表示。1% なので tiny で約 0.1 件/年）。Chronicle category `'life'`
- 人物詳細パネルに「天才: ✦ 名将」行（purple）、人物一覧の名前に ✦ マーク

### 6.68 共和国整備（established commonwealth の内部政治・v0.46）

民衆叛乱などで成立する owner-house の無い政体（`active && kind === 'commonwealth' && revoltState?.kind === 'established'`、以下「共和国」）を、人物・役職・任命権・Influence で内部政治が動く対象として整備する。判定は `isEstablishedCommonwealthRepublic`（`selectors/republicSelectors.ts`）に集約し、関連 system / selector / UI で共有する。

狙いは「反乱指導者だけでなく、功臣・在野・無家・landless House 人材が共和国の政治に参加し、やがて家を興して寡頭化する歴史」を観賞対象にすること。「僭主→君主」の制度変換は scope 外（将来 §18+）。

**派閥アリーナ化（派閥拡大 Phase 7）**: 派閥が公然と競う寡頭アリーナにするため、commonwealth を派閥任命経路に開く。(1) **代官**: BailiffAppointmentSystem（§6.22）の `ownerHouseId` スキップを撤廃し、Tier 2 候補を `getRepublicPoliticalCandidatePersons` から取る。(2) **polity 役職**: AppointmentSystem（§6.19）の `buildPolityCandidateCache` は owner-house 経路でしか候補を入れないため commonwealth が空になる → established commonwealth に `getRepublicPoliticalCandidatePersons` を投入（young_adulthood / 非 placeholder / holding office 非保持で絞り、重複は Set 排除）。`ownerHouseBonus` は commonwealth で既に 0（§6.64）なので変更不要。leader 選挙（`republicLeadershipSystem`）には不介入。**anchor route は無改修** — 既存の「家の seatProvince の terminal polity」経路が commonwealth 領内 seat の家を commonwealth に anchor させるため（実測で 2→6 件成立）。house が commonwealth で奉職するが seat は別、という残ケースの明示的 residence-route は defer。(3) **Goal 駆動 Project（Phase 7 追補）**: `projectPreparationSystem`（§6.36）の起案者選定 `selectProjectCreator` / 監督者選定 `selectProjectSupervisor` が使う候補母集合 `getCandidatePersonIds` の polity 経路に `getRepublicPoliticalCandidatePersons` を union する。これが無いと established commonwealth は ownerHouse 不在で候補母集合が空になり、Goal・Aim までは立つが creator 不在で Project へ到達できなかった（領地集約・開発・税改定などの自発行動が一切起きない）。代官 (1) / polity 役職 (2) と同じ候補プールを Project パイプラインへ拡張する位置づけ。非 commonwealth には空配列で無害（kingdom は bit-identical）。実測（tiny 150年 seed1）: commonwealth 保有の aim 由来 Project 0 →（acquire_land 4 / develop_holding 1）。

#### read-only selector（`republicSelectors.ts`）

- `getRepublicPoliticalCandidatePersons`: 共和国の office seed / leader election / obtain_office target で共有する候補者列挙（現 leader / office holder / right holder とその家 member / origin leader / holding bailiff / houseless / recruitable outsider / landless House member）。基本除外（dead / placeholder / young_adulthood 未満 / 対象 polity への極端な悪意 / workload 過剰）を適用し PersonId 昇順で返す。RNG 不使用・決定的。
- `scoreRepublicOfficeCandidate` / `scoreRepublicLeaderCandidate`: 用途別 scoring。役職適性は `getRoleScore`（house 非依存・houseless 可）を主軸に、prestige / wealth / attitude / office 経験 / houseless・landless ボーナス / workload を加減算。性別ゲートは score に混ぜず選定側で適用。
- `getRepublicFootholdPolityIds`: person が foothold（本人の office / personal right、家の right / member office）を持つ共和国を返す（obtain_office 拡張用・共和国のみ）。
- `getRepublicPowerProfile`: 共和国の権力分布 read-model（topHolder / topPercent / top3Percent / effectiveHolderCount（Herfindahl 逆数・total>0 の entry のみ）/ leader influence / office・right control by holder）。保存状態を作らない。UI 表示のみ。
- origin helper `getRepublicOriginHoldingIds` / `getRepublicFoundingWeek`（`PolityOrigin` の kind 差を吸収）。

#### RepublicPoliticalInitializationSystem（建国式・4週ごと）

established commonwealth を検出し、非 leader office（administrator / treasurer / military / advisor）を功臣で seed する。established 化経路は複数サイトに分散するため、特定 mutation に hook せず idempotent な scheduled system として処理する。

- **once-guard**: Polity に追加した `republicInitializedWeek?: number` marker で初期化済みを判定する。**non-leader office 数での判定は採用しない**（AppointmentSystem も commonwealth の non-leader office を housed 候補で埋めるため、office 数判定では tick 位相次第で「初期化済み」と誤認し建国式を取りこぼす）。
- **配置（race 排除）**: tick 上 `appointmentSystem`（12週）の直前に置く。RepublicInit（4週）を直前に置けば AppointmentSystem が発火する週は必ず RepublicInit も発火する週となり、houseless 功臣 seed・personal right・`REPUBLIC_FOUNDED` を AppointmentSystem に先んじて成立させられる。後段の `organizationConsistencySystem` は commonwealth の person-direct office を houseId 不問で eligible 扱いするため、houseless 功臣は revoke されない。
- **leader**: 読むだけ（建国式では作らない・置換しない）。不在なら marker を立てず skip し次 interval で retry（bootstrap は `polityOwnerConsistencySystem` の emergency 補充 `selectOrCreateCommonwealthLeader` に委ねる）。
- **seed**: 各 role に空き最若 slot を `scoreRepublicOfficeCandidate` の最良候補で埋める。`isRoleEligibleBySex` を gated-first 適用（直接 `createOfficeAssignment` は AppointmentSystem を bypass するため自前で性別ゲートを通す）。seed 数の上限は `republicInitial{Administrator,Treasurer,Military,Advisor}Slots`（既定すべて 1）。同一人物の二重着任を避ける。
- **personal right**: `republicGrantInitialPersonalRights` が true なら、seed した各 holder に personal `polity_office_role` PoliticalRight を grant（slotIndex を office と一致させる）。leader は right 対象外。
- **marker set + emit**: 非 leader office を 1 つ以上 seed できた回にのみ `republicInitializedWeek = absoluteWeek` を set し `REPUBLIC_FOUNDED`（importance `major`）を emit。候補が leader しか居ない週は marker を立てず retry（空振り対策）。

#### 性別ゲートの非対称（意図的）

共和国の初期 leader は emergency 補充（`selectOrCreateCommonwealthLeader`）由来であり、これは `isRoleEligibleBySex` を適用しない（女性 leader が出うる）。同ヘルパーは emergency 補充と共有のため改修しない。性別ゲートは **RepublicInit の非 leader office seed と RepublicLeadership の任期 election にのみ適用**する。

#### RepublicLeadershipSystem（任期 leader 交代・48週ごと = 毎年）

共和国 leader を死亡時 emergency 補充だけでなく任期で交代可能にする。議会 entity は作らず、`OfficeAssignment.startYear` から任期切れを導出する軽量 system。

- **対象**: established commonwealth。leader 不在の polity は skip（bootstrap は emergency 補充の責務）。
- **任期判定**: `currentYear - leaderOffice.startYear >= republicLeaderTermYears`（既定 4 年）で election。
- **候補**: `getRepublicPoliticalCandidatePersons`（現職 office holder を含む。`selectOrCreateCommonwealthLeader` は使わない — 同ヘルパーは active office holder を除外するため現職功臣の昇格ができない）＋ `scoreRepublicLeaderCandidate` ＋ **現職補正**（`republicLeaderIncumbencyBonus − 在任年数 × republicLeaderFatiguePerYear`。在任が長いほど fatigue が incumbency を上回り、いずれ挑戦者に抜かれて交代する＝終身 leader 防止）。`isRoleEligibleBySex` を gated-first（leader 含む）。
- **再任（winner == 現 leader）**: leader office を据え置き `startYear` を保持する（`assignOffice(replaceExisting:true)` で再作成すると startYear がリセットされ fatigue が永久に溜まらない）。event も出さない。
- **交代（winner != 現 leader）**: ① winner が同 polity の `role !== 'leader'` の polity office を持つならそれだけ明示 revoke（兼任防止。`house:leader` 等の house office は残す。`revokeOfficesByHolder` は使わない）② `assignOffice(role:'leader', replaceExisting:true)` で旧 leader を revoke し winner を着座。`ownerHouseId` は undefined のまま。`REPUBLIC_LEADER_ELECTED`（importance `major`）を emit。
- **配置**: `appointmentSystem` の前（RepublicInit 隣接）。交代後、同年の AppointmentSystem が新 leader を踏まえて通常 office appointment を行える。

#### 競争 pull（obtain_office / acquire_political_right）

- **obtain_office**（`personAimSelectors.scorePersonAimKind`）: 役職フォールバックの polity 候補を `getHousePolityIds`（土地ベース・ownerHouse 由来）に加え、**`getRepublicFootholdPolityIds` の共和国に限定**して拡張する（normal polity の挙動は不変）。houseless person は `personAimMaintenanceSystem` が skip するため、この pull は housed person 限定（houseless 功臣は HouseFounding で家を興した後に参加）。
- **無収入 leader 肩書きの抑制解除 (v0.48)**: obtain_office の「既に役職持ちなら score −10」ゲートは、従来 active office を 1 つでも持てば（`hasAnyOffice`）抑制していた。これを `hasGainfulOffice`（§6.22 と同じ実職判定 — 給与 0 の `house:leader` / 無収入 Polity の `polity:leader` は無役扱い）に置換し、**無領地の家の家長・無収入 Polity の家長が職探し aim を持てる**ようにした。`retain_office` の判定は `hasAnyOffice` のまま据え置き（肩書きの保持と稼ぎ口探しは別軸で両立して構わない）。**実測（tiny 100年 seed1）**: 「began pursuing Obtain Office」発生数 2098→1987（−5%）。減少方向なのは、無役の家長が役職を得て探索を止める二次効果と RNG 分岐の両方を含むため絶対値は直接解釈しない（挙動が変化することの確認に留める）。
- **acquire_political_right**（`goalSelectors.pushAcquireRightCandidates`）: target が共和国（`isEstablishedCommonwealthRepublic`）のとき score に `republicAcquireRightBaseBonus` を加点し、家による共和国権利競争を促す（normal polity は不変）。Project owner は従来どおり House。

#### dominant holder の扱い（UI のみ）

`REPUBLIC_DOMINANT_HOLDER_EMERGED` は v0.46 では追加しない。dominant holder は `getRepublicPowerProfile` が算出し、CountryDetail に表示するのみ。`republicDominantHolderThreshold`（既定 60）は UI で「支配されている」状態を視覚強調する閾値（event 発火には使わない）。`getRepublicPowerProfile` は毎 tick 再計算される read-model のため、閾値往復で多重発火する event 化には保存 field が要り、v0.46 の最小 state 方針に反する。寡頭化・僭主化の milestone event 群はその状態設計とともに将来導入する。

#### Event / UI

- `REPUBLIC_FOUNDED` / `REPUBLIC_LEADER_ELECTED`（ともに Chronicle category `'governance'`）。messageKey は `republic.founded` / `republic.leader_elected`。
- CountryDetail に共和国の権力分布 section（`RepublicPowerProfileSection`）を共和国のときのみ表示。top holder / top3 / 実効権力者数 / 指導者影響力 / 役職支配 / 任命権を holder リンク付きで表示し、`republicDominantHolderThreshold` 超の top holder を「支配的」と強調する。

#### バランス保留（機能完成後に調整）

候補 / leader scoring の係数、incumbency / fatigue 値、功臣の家創設到達率は仮値で実装し、long-run 観察後にまとめて較正する（プロトタイプ方針 §4）。

---

### 6.69 領邦ライフサイクル：称号・分封・陞爵・分家・集約（v0.47）

Polity が土地を得失するだけでなく「領邦のライフサイクル」（称号化・新設・昇格・分家・一円集約）を持つ。設計詳細は `docs/drafts/spec-v047-update.md`、本節は as-built の要点。

#### 型・状態

- `Polity.territorialStatus?: 'territorial' | 'titular'`（undefined=territorial）。titular = 称号のみで LandContract 0（rank 2〜4）。`getPolityTerritorialStatus(polity)` で正規化参照。
- `PolityOrigin` に `land_grant`（分封由来 rank5 Polity。`ownerHouseId` は創設時履歴値で current owner と一致しなくてよい）。
- 新 PolityAimKind `seek_rank_promotion` / HouseGoalKind `consolidate_domain` / HouseAimKind `consolidate_owned_polities` / PersonAimKind `request_land_grant` `establish_cadet_branch` `found_republic_house`。
- 新 ProjectKind（budget なし petition）`request_rank_promotion`(Polity) `request_land_grant`(Person) `request_cadet_branch_title_transfer`(Person) `republic_house_foundation`(Person) `consolidate_internal_contracts`(House)。

#### titular 化 / 廃止（`polityOwnerConsistencySystem`）

landless 検出を rank 分岐に置換: normal rank 2〜4 → `titularizePolityInline`（territorialStatus=titular・active/ownerHouse/capital 維持・leader 以外 office revoke・right remove・faction anchor cleanup・polity-owned Project/Aim/Goal を terminal 化（v0.47.5 で Goal を追加。§6.56 で titular は目標生成対象外）・`POLITY_TITULARIZED`）、normal rank 5 → `deactivatePolityInline` + `POLITY_ABOLISHED`（house 巻き込みなし）、commonwealth → 従来 extinct。titular の ownerHouse 断絶 → abolish（fallback owner 補充は territorial のみ）。`getEffectiveOfficeMaxHolders` が titular の非 leader role を 0 にし、appointment 側 prevention と organizationConsistency 安全網の両方が成立。Regiment は明示 disband せず `regimentMaintenanceSystem` の reassign に委譲。leader（title holder）補充は successionSystem が ownerHouse leader を選ぶため新分岐不要。

#### petition Project の解決機構

新 ProjectKind は preparatory stage（`prepare_project`/`advance_project` に落とす。`PREPARATORY_TASK_KIND_MAP` に全 stage 登録必須 — 未登録は task 生成されず stall）で progress を貯め、`finalize_*` immediate stage を `projectStageSystem.resolveImmediateStage` のハンドラが解決（accept 判定 + 成功 mutation）。House/Polity を作る finalize は `runProjectStageSystem` が `ctx.nextHouseIndex/nextPolityIndex` を ws に seed し終了時に書き戻す（ID 採番が ctx ベースで resolveImmediateStage が ws のみという構造的摩擦への対処）。

- **分封**（`finalize_land_grant` / `landGrantMutations.applyLandGrantMut`）: 無家=新 House(self_made/land_grant) / 有家=cadet House、`createGrantedRank5PolityMut` で rank5 holding-name Polity、donor terminal に child contract（`taxRateToGrantor` は config `landGrantContractTaxRate`=0.5。draft §16.2 未列挙の追加キー）、founder を house:leader+polity:leader。donor は §9.3/§9.4（無家=在職先 polity・有家=自家余剰 polity）。**v0.47.x 拡張（有家 primary donor 解禁・家統制ゲート）**: 有家 donor 選定は従来 primary/sink を無条件除外していたが（→ Polity を1つしか持たない家は分封でも分家でも独立不能）、これを **家の権力分散度** で条件化した（`selectLandGrantDonorPolity` 有家分岐）。判定 `isHouseDispersedForCoreDonation` = 筆頭 share（`getTopShareholders` top-1）が `landGrantCoreDonorMaxTopSharePercent`（=60）以下なら「権力分散 → 本拠を割ってよい」とみなし **primary を donor 候補に解禁**（share データ無しは集中とみなし保護）。consolidation **sink（≠primary）は集約綱引き回避のため分散でも常に除外**し、sink==primary（実質 1-polity 家・集約対象無し）のときだけ primary 節で解禁される。候補 sort は **非 core（周縁 secondary）優先 → holding 数昇順 → PolityId 昇順** で本拠は最後の手段。安全性は既存の独立な安全網（`donorCanAffordGrant`=holding ≥3 かつ割譲後 ≥2 残存、`selectLandGrantTargetHolding` の capital province 後回し sort）が担保するため、primary 解禁でも landless 化・首邑割譲は起きない。**accept も有家のみ変更**: donor 領主単独 attitude（`computeLandGrantAcceptScore`）から、**家 share 加重意見**（`getWeightedOpinionFromHouseShareholders` + `project.progress` ≥ `landGrantHouseSupportThreshold`=5）へ変更（cadet branch §11.7 と統一・「家の土地を手放すには家の同意が要る」）。これに伴い有家経路では **petitioner reputation 項が accept から外れる**（cadet branch と同じ挙動なので一貫）。無家分封は donor=他家領で family cohesion が無関係なため **donor 選定・accept とも従来のまま**。**as-built 注記**: (1) grant 対象 holding 選定（draft §8.6）の優先順位は `capital province 外 → development 低 → HoldingId 昇順`。draft §8.6 の「primary/main holding でない」「population 少」は `Holding` 型に対応フィールドが無いため未実装（primary は Polity 単位概念・population はモデル不在）、development は per-holding でなく **province 集計値**（`getProvinceDevelopmentFromHoldings`）を使うため同一 province 内 holding は development では差別化されず HoldingId 昇順で決まる（holdings/province=2 で実害は軽微）。(2) SOFT accept 判定（draft §9.7 prose は 8 入力を列挙）は config 化された **3 weight のみ**（`landGrantApproverAttitudeWeight` / `...ReputationWeight` / `...ProjectProgressWeight`）を実装。`landGrantAcceptThreshold`=5（反復改修で 50→5 較正済）。(3) **家名の出所**: `House.nameSource`（undefined = 'pool'・既存 House は不変の additive フィールド）で家名 nameKey の出所を持つ。出所は 3 種:
  - **`{ kind: 'polity', category: 'province' | 'city' | 'polity' }`（下賜された領国名由来 = 分封 land_grant / 分家 titleTransfer）**: 「家 = その領国の名前」。下賜された Polity の名前を `House.nameKey` へ snapshot し（王朝名として固定 = 後で領国を失っても変わらない）、解決 category もその領国名の名前空間で保存する:
    - **分封 (land_grant)**: 新設 rank5 Polity は常に holding 名由来なので `holding.nameKey` を取り、category は `holding.kind`（manor→`'province'` / city→`'city'`）。例: 領地 Elmhurst を受けた者は「Elmhurst 家」を興す（自領 Polity と同名）。無家=self_made / 有家=cadet の双方に適用（分封は必ず領国名）。
    - **分家 (titleTransfer)**: 譲渡される既存 secondary Polity の名前を `getPolityNameRefForEmit` で取る。Polity が pool 名なら category=`'polity'`（例「Aquilonia 家」）、holding 名なら `'province'`/`'city'`。これにより分家も「受領した領国の名を名乗る」（York 公領を継ぐ York 家、の類）。
  - **`'person'`（共和国 House）**: founder の個人名（`petitioner.nameKey` = person プール由来キー）をそのまま `House.nameKey` に流用する（始祖名 = 家名）。established commonwealth で奉職する無家役職者の landless House 創設は discrete な領地受領を伴わないため person 名のまま。house プールに存在しないキーのため person category で解決する。
  - **`'pool'`（既定 / undefined）**: house プール（`house.yaml`）由来。`worldgen` / `houseFoundingSystem` / `worldStructureSplitHouse`（namePoolService 由来）が該当。

  表示・emit 側は nameSource を見て category を切り替える（`person`→'person' / `{ kind:'polity' }`→保存した領国名 category / それ以外→'house'）。app 層は `getHouseDisplayName`（`entityNameHelpers`）、sim emit 層は `getHouseNameRefForEmit` / `houseNameParam` / `houseNameRef`（`nameRefSelectors`）に集約。これを通さず `resolveName('house', house.nameKey)` で解決すると person/領国名 由来家名が raw key 表示になる（v0.47.x 修正前の実バグ）。**領国名 snapshot は決定論中立**: 家名割当は RNG 非消費で、house プールの uniqueness 除外集合（`houseFoundingSystem` / `worldStructureSplitHouse`・いずれも default gate off）も person/province/city/polity/house の各プールが互いに素（polity↔house に 9 キーの重複はあるが、消費する system が gate off のため不活性）なため、person キー↔領国名キーの差し替えで RNG 消費は変わらない（baseline dump-world 比較で tiny seed1/42 × 60年、land_grant + titleTransfer 家の nameKey/nameSource 以外 byte-identical を実証）。
- **Polity 譲渡分家**（`finalize_cadet_branch` / `titleTransferMutations`）: cadet House(polity_grant) 作成、`reassignPolityOwnershipMut` で既存 secondary Polity を譲渡、HouseShare 加重支持（`getWeightedOpinionFromHouseShareholders`）で accept。家名は譲渡された領国名を snapshot する（上記分封の as-built 注記 (3) 参照・`House.nameSource = { kind: 'polity', category }`）。
- **共和国 House**（`register_house` / `republicHouseMutations`）: established commonwealth の無家役職者が landless House(office) を作り office 維持。
- **陞爵**（`finalize_promotion` / `promotePolityRankMut`）: rank 変更前に `canPromotePolityRank` 再検査（`allGrantorRanksAreAboveNewRank` で LandContract rank 不変を保護）、approver(宗主 leader) 不在は auto-grant。holding 閾値は世界の土地階層に較正（`rankPromotionMinHoldingCountByRank` = {2:16, 3:8, 4:2}: rank5=1 holding 級 / rank4=1 province 級(=2 holdings) / rank3=1 state 級(≈8 holdings) / rank2=複数 state 級(≈16)。newRank になるための保有 holdings）。treasury/prestige/admin は足切り水準。**陞爵の前提となる rank gap は外交で能動的に作る設計**: `allGrantorRanksAreAboveNewRank` は昇格後も grantor rank < grantee rank を要求するため、宗主が直上（1 ランク上）の polity はそのままでは昇格不能（宗主と同 rank になる）。これは制約ではなく意図で、polity はまず PolityAim `eliminate_overlord_contract`（税率を最小化した上で上位契約を解除する外交劇 → `eliminateContractFromChain` で直上宗主の契約を chain から除去し grandparent に再接続）で**直上の宗主を排除して rank gap を作り**、その後に陞爵を試みる。すなわち陞爵は「税制改定の反復成功 → 上位契約解除 → rank gap → 陞爵」という長い外交チェーンの**終点**であり、意図的に稀なアスピレーション的アクション。
- **一円集約**（`finalize_consolidation` / `consolidationMutations.applyConsolidationMut`）: sink〜terminal 間の同家・非special contract を `eliminateContractFromChain` で反復 collapse（所有者 guard は呼出側）。landless 化した中間 polity は §6.69 titular/abolish 経路へ。**所有者 guard（draft §12.7 step3）は collapse 開始前に sink〜terminal 間を全点検し、他家所有 / specialStatus が 1 件でも挟まる holding は丸ごと skip する**（v0.47.x 修正: 旧実装は sink 直下から逐次畳んでいたため、他家挟在を見つける前に手前の同家 contract を畳んで他家 Polity の grantor を sink へ繋ぎ替えてしまい、かつ benefit 0 失敗時も部分 mutation が残留していた。sandwich `sink(同家)→A(同家)→B(他家)→terminal(同家)` を `consolidation.test.ts` で回帰検証）。

#### House 創設条件・代謝

`houseFoundingEnabled` / `houseSplitEnabled` を default false に（self-made founding と直接 splitHouse による landless cadet 量産を廃止）。House 創設は原則 Polity 獲得を伴う（分封）か共和国例外に限る。**as-built 注記（draft §14.2 との乖離）**: draft §14.2 は「HouseSplitEvaluationSystem を分家志望 Aim 発生 system へ縮小・変更する」と記すが、as-built では `houseSplitEvaluationSystem` / `houseFoundingSystem` を gate=false で**まるごと early-return 無効化**し、分家・分封の Aim（`establish_cadet_branch` / `request_land_grant`）は標準の `personAimSelectors`（通常の person aim 生成経路）が生やす。`successionSystem` からの直接 `splitHouse` 呼び出しも無い。結果（直接 split せず aim 化）は draft の目的と一致するが、Aim 生成の責務主体が evaluation system でなく personAimSelectors である点が異なる。**houseless 人物の goal/aim 形成**: `personGoalMaintenanceSystem` / `personAimMaintenanceSystem` は有家に加え active polity office を持つ無家人物にも goal/aim 形成を許可（共和国役職者の House 創設・無家被任命者の分封 petition の前提。全無家には開かない）。`personGoalSelectors` は houseless でも house-independent goal を score。

#### IntegrityCheck（追加 invariant）

titular は契約 0 / 非 leader office なし / active right なし / active regiment なし、rank5 は titular 不可、land_grant origin の参照存在（current owner 一致は非検査）、parentHouseId↔cadetHouseIds 双方向整合、陞爵後の grantor rank < grantee rank。

#### バランス保留（機能完成後に調整）

default config（150年・seed 1/42/123 実測）では **共和国 House 創設（11〜18/seed）・分封（land grant・seed1 で 3）・Polity 譲渡分家（cadet・seed1 で 4・seed42 で 2）・一円集約（稀・seed42 で 1）・titular 化（1〜3）が自然発火**する。**陞爵のみ default 0**（意図どおり — 陞爵は `eliminate_overlord_contract`（上位契約解除）で直上宗主を排除し rank gap を作った後に試みる外交チェーンの終点で、その契約解除自体が税制改定の反復成功を要する稀なアクション。実測 150 年では CONTRACT_ELIMINATED 0 / CONTRACT_TAX_REVISED 19 と税改定は起きるが解除終点に未到達。wiring は配線済で rankPromotion.test と pickPolityAim で検証）。

**実装後に判明した配線バグの修正（v0.47.x）**: 当初は「分封・分家も default 0 = 構造的稀少」と記していたが、これは誤りで、実際は **gate 通過→発火 の後段バグ**だった（150年実測で分封 16〜26 人・分家 43 人が HARD gate を通過していたのに 0 発火）。原因は (a) cadet/land grant の SOFT accept 閾値（`cadetBranchTitleTransferSupportThreshold` 50 / `landGrantAcceptThreshold` 50）が opinion スケール（-100..100・中立 default 0）に対し過大で、実測 accept スコア 0〜11 では**原理的に発火不能**だった → それぞれ 5 に較正、(b) houseless 役職者は `public_service` goal を持ちやすいが、これが `request_land_grant` の hosting goal に欠けており aim が生成されなかった → `scorePersonAimKind` の hosting goal に `public_service` を追加。さらに、land grant が初めて発火したことで **commonwealth 転換（民衆叛乱 regime change・`diplomaticPlayRevolt`）が `ownerHouseId` を undefined にしつつ `polityIndex.byOwnerHouse[旧 owner]` から除去していなかった潜在バグ**（v0.46 由来・元の trajectory では未顕在）が露呈し、§25 #16 違反で停止した → 転換時に byOwnerHouse スロットから除去する修正を追加（新規 commonwealth 作成の `worldStructureCommonwealth` は元から owner 無しのため対象外）。

**petitioner gate の house leader 除外（v0.47.x）**: `meetsLandGrantPetitionerGate`（分封）が house leader を除外していなかった非対称バグを修正。`meetsCadetBranchPetitionerGate`（分家）は「house leader は分家を興さない」で leader を明示除外していたが、land grant 側は wealth + 実績（reputation/office/bailiff）のみで leader を通していた。house leader が分封で**新 House**を興すと旧 House から `movePersonToHouse` で抜け（memberIds から除去）、旧 House の `house:leader` office は付け替えられず残るため「house leader が memberIds に居ない」整合違反（§25 #4 系）を生む。`meetsLandGrantPetitionerGate` に `person.houseId !== undefined && getHouseLeader(state, person.houseId) === person.id → false` を追加して対称化（houseless は自立路として対象外）。本 gate は aim 生成（`personAimSelectors`）・project 作成（`taskProjectCompletion`）・finalize 再検査（`projectStageSystem` の `applyLandGrantMut` 直前）の 3 点で共有されるため、aim 作成後に leader 化した in-flight petition も finalize で停止する。**known-latent**: `worldStructureSplitHouse` の splitter も同型（leader が splitter だと旧 House leader が dangling 化）だが `houseSplitEnabled=false` で無効化中のため未修正（再有効化時は同様の leader 除外が必要）。

**balance 保留**: 各機能の発火 **rate** の最終調整は機能完成後に行う（プロトタイプ方針 §4）。陞爵は設計上「税制改定の反復 → 上位契約解除（`eliminate_overlord_contract`）→ rank gap → 陞爵」の終点であり、現状 default で発火しないのは正常（契約解除自体が深い前提を要する稀なアクション）。実質発火させたい場合は契約解除に至る外交チェーンの到達頻度（税制改定の成功率・契約解除条件の緩急）を balance pass で調整する。rank 不変条件・陞爵の wiring 自体は変更不要。

### 6.70 押領・土地契約不履行・時効による既成事実化（v0.53）

**法的・契約上の権利者**と**実際に土地・収益を握っている主体**がズレる状態を導入する。House 所有不動産の収益が現地 Polity に押領される／下位 Polity が上位契約者への上納を拒否する／反乱独立後に旧権利者が請求権だけ保持する、といった事態が「放置・係争・時効・強制解決」へ進む。設計詳細は `docs/drafts/spec-v053-update.md`、本節は as-built の要点。RealEstateSeizure / LandContractDefault の 2 entity と 4 system（obligationConsistency / obligationAccrual / prescription / cleanupTerminalObligations、いずれも 4週ごと）からなる。

#### 型・entity

- `RealEstateSeizure`（id prefix `rs-`）: House-owned RealEstateAsset の owner income を現地 terminal Polity が押領する状態。`status: active | resolved | legalized | cancelled`、`holdingId` / `assetId` / `seizerPolityId` / `rightfulOwner`（Phase 1 は house のみ）/ `startedWeek` / `lastContestedWeek?` / `accumulatedUnpaidAmount` / `nextEnforceAllowedWeek?` / `activeEnforceProjectId?` / `terminalWeek?` / `reasonIds`。severity field は持たず、係争規模は `accumulatedUnpaidAmount` で代表する。
- `LandContractDefault`（id prefix `lcd-`）: LandContract chain の上納義務不履行。`origin: tax_default | revolt_independence`、`occupiedByPolityId` / `claimantPolityId` / `targetLandContractId`（両 origin で必須。tax_default=対象 terminal contract、revolt_independence=nominal occupation contract）/ `original{Grantor,Grantee}PolityId` / `originalTaxRateToGrantor` ほか seizure と同型の係争・cooldown・terminal field。
- index は **active entity のみ**を保持し、terminal 化時に全 index から除去する。Record（`realEstateSeizures` / `landContractDefaults`）には `terminalObligationRetentionWeeks`（=48）の間 retention してから cleanupTerminalObligations が削除する。`realEstateSeizureIndex`= byHolding / byAsset（一意）/ byRightfulOwnerHouse、`landContractDefaultIndex`= byHolding / byContract（一意）/ byClaimantPolity / byOccupierPolity。

#### Project 経由の発生（Goal / Aim → Project → outcome）

押領・上納拒否は system が直接 spawn せず、`Goal / Aim → Project 起案 → outcome で entity 作成 + Pressure` を経由する（「誰が・なぜ・何を狙ったか」を Project 履歴に残す）。

- 新 PolityAimKind `seize_vulnerable_real_estate_income` / `withhold_overlord_tax`。どちらも Aim target は `holding`、具体的な asset / contract は Project 作成時に selector で解決する（EntityRef を realEstateAsset / land_contract に広げない）。両者とも external_expansion ではなく内部収奪なので `pickPolityAim` の**両 goal 共通ブロック**に置く。
- 新 ProjectKind `seize_real_estate_income`（outcome で RealEstateSeizure 作成）/ `withhold_land_contract_tax`（outcome で `origin='tax_default'` の LandContractDefault 作成）/ `enforce_obligation`（権利者の強制解決、self-executed）/ `enforce_land_contract_default`（default 用 diplomatic、後述 Phase 4）。
- stage は seize / withhold / enforce（Phase1-2 簡易版）とも **`prepare_argument → execute_project` の 2 段**。`find_supervisor` は使わず supervisor は作成時に `selectProjectSupervisor` で選定する（budget 不要の self-executed political project に find_supervisor/secure_budget の budget 前提を持ち込まないため）。seize / withhold は `isDiplomaticProjectKind` に含めない。reputation は 3 kind とも undefined（`PROJECT_REPUTATION_CATEGORY_MAP[kind]=undefined`）。

#### opportunity score（候補化）

押領・上納拒否は乱発させない（threshold / cooldown を保守的に）。

- **seize_real_estate_income**: seizer と owner House の単純戦力差は使わない（`calcPolityMilitaryPower` は配下 House 戦力を合算し owner House が seizer の構成 House だと内包されるため）。代わりに owner House の独立抵抗力 `ownerHouseResistance = calcHouseMilitaryPower(ownerHouse) + protectorPolityPower`（owner House が所有する polity の overlord 群の military power 合計。seizer 自身は除外）を見る。`targetWeakness = max(0, seizeResistanceReference − ownerHouseResistance)`（絶対 resistance の減少関数。seizer ownPower との差分は使わない）。`prize` 項は奪える収益の大きさ＝資本化した `estimateRealEstateSalePrice(asset)`（v0.54: monthly owner income × 12 × salePriceYears）× weight で、零細 asset の乱獲を防ぐ。これに ambition / caution / fiscalPressure / badAttitude を加える。asset 選定は scoring と Project 作成で同一 selector（holding 内で最も脆弱な House-owned asset、tie-break = asset id 昇順）を共用する。
- **withhold_overlord_tax**: withhold は Polity vs Polity なので `militaryAdvantage = ownPower − grantorPower × withholdMilitaryAdvantageFactor`（=0.6）。候補化 gate は `grantorWouldResist == true`（通常の契約改定交渉では減税が通らない）**かつ** `ownPower > grantorPower × 0.6`。これにより「交渉で通るなら improve/eliminate（既存外交）、通らず力があるなら withhold」と棲み分ける（既存 2 aim は grantorWouldResist なら候補化しないため二重発火しない）。factor が分数なのは vassal が構造的に overlord 全体 power を上回れないため（「地域的に踏み倒せる相対戦力」を表す）。

#### Pressure と enforce（権利者の対応）

- 新 PressureKind `real_estate_seizure`（source=seizer Polity、target=rightfulOwner House）/ `land_contract_default`（source=occupiedBy Polity、target=claimant Polity）。PressureSystem の kind 別 routing と target.kind 解決（House target は `getHouseDecisionMaker`）は §6.58 参照。
- **enforce strength gate は pressureSystem の生成段に置く**（§6.58）。勝ち目が無いなら enforce Project を作らない（弱い House / claimant は形式的抗議すらできず、seizure/default は無係争で持続し時効へ向かう）。生成された enforce は既存 project 成功 roll をそのまま使う（二重 gate を避ける）。
- **enforce 成功時**: Phase1-2 簡易版は対象 seizure/default を resolved にする（§6.41）。`lastContestedWeek` は Project 起案だけでは更新せず、enforce 成功 / Phase 4 で実質的な譲歩・係争が起きたときのみ更新する。Phase1-2 では active entity の lastContestedWeek を更新する経路が無いため**時効は実質 `startedWeek + 20年`**（lastContestedWeek が本格機能するのは Phase 4）。

#### LandRevenueSystem 連携（§6.4.2c）

active seizure の asset は ownerIncome を rightfulOwner に払わず holding taxable に吸収する（holdingDue は通常通り。v0.54 §6.4.2。asset.owner record は保持、legalized 時のみ undefined 化）。active default は `targetLandContractId` を byContract で引き実効 taxRate=0（両 origin、contract record は不変、上流 chain 全体が干上がる）。LandRevenueSystem は read-only で entity の作成・accrual・時効判定・Pressure/Event 生成は行わない。

#### 4 system（4週ごと、tick 順 LandRevenue → consistency → accrual → prescription → cleanup）

- **obligationConsistencySystem**: active seizure/default の参照先（House 絶家・asset 消滅・seizer/claimant/occupier 非 active・契約消滅・holding 消滅・反乱鎮圧など）を検査し dangling / 前提崩壊を `cancelled` にして `*_CANCELLED` を emit、関連 enforce Project を terminal 化する。**accrual / prescription より前**に走り、dangling entity を accrue / legalize する前に cancelled にする（特に `worldStructureExtinction` が絶家時に asset.owner を undefined に戻す経路と prescription の legalized が同一 asset を二重に触らないよう保証）。
- **obligationAccrualSystem**: active entity の `accumulatedUnpaidAmount` を概算加算する（本来 owner が得るはずの owner income / 本来の上納額）。v0.54: resource snapshot は月額なので月次 system で **× 1**（月額をそのまま）加算する（旧 weekly × ACCRUAL_INTERVAL_WEEKS=4 を撤廃）。厳密会計値ではなく UI / 将来の交渉材料 / 係争規模指標。
- **prescriptionSystem**: 20年（`realEstateSeizurePrescriptionYears` / `landContractDefaultPrescriptionYears`、`baseWeek = lastContestedWeek ?? startedWeek` から `elapsed >= 20×48`）で `legalized` にする。seizure legalized → `asset.owner = undefined`、default legalized → `spliceOutClaimantContract`（後述）。関連 Pressure / enforce Project / Aim を terminal 化し Event / Chronicle を発生させる。
- **cleanupTerminalObligations**: terminal（resolved / legalized / cancelled）化後 `terminalObligationRetentionWeeks` 経過した entity を Record から削除する。

#### spliceOutClaimantContract（既成事実化の chain 操作）

legalized 時の chain 正規化は「全 chain root 化」ではなく**直近 grantor 1 段の splice out**（`spliceOutClaimantContract`、`landContractMutations.ts`）。`keep` = 占拠者 / 不履行者の契約（`default.targetLandContractId`）、`claimant` = `keep.parentContractId`（直近 grantor）を chain から除去し、keep を claimant の祖父契約へ **claimant の旧 (live) 条件**で再親契約する（claimant が root なら keep を root 化: parentContractId 削除 / rootAuthorityId=ROOT_WORLD / tax 0）。

理由: 損をするのを直近領主（claimant）だけに揃え、鎮圧参加者（`estimateSuppressionPower` は直近領主のみ参照）と損得を一致させる（全 chain root 化だと上位契約者全員が当該 holding の取り分を恒久的に失い、損得と鎮圧動機がズレる）。rank invariant は推移律（grandparent.rank < claimant.rank < keep.rank）で、tax invariant は旧条件継承（非 root なら旧 terms >0、root なら root tax 0 化）で自動充足。創発的帰結として「20年上納を拒否し続けた者 / 反乱独立を達成した者が直近の領主を排してその地位を継ぐ（旧領主の grantor へ旧条件で臣従し直す。旧領主が主権者だった場合のみ完全独立）」という**望ましい挙動**になる。

#### 反乱独立・revolt_seizure 廃止（§6.29 / §6.30）

tax-0 子契約 + `revolt_seizure` specialStatus を廃止し、`taxRateToGrantor = revoltOccupationNominalTaxRate`（=0.5）の nominal occupation contract + `LandContractDefault.origin='revolt_independence'` に置換した（nominal tax は構造値で active default 中は LandRevenue 上で実効 0。§6.29 / §6.30 参照）。鎮圧 = nominal contract eliminate + default cancelled、確立 / 時効 = spliceOutClaimantContract + default legalized。`eliminate_overlord_contract` の対象から active revolt_independence default に紐づく契約を除外する guard を入れる。

#### Phase 4: enforce の DiplomaticPlay / War 接続

`enforce_obligation` を外交化すると同 kind が seizure / default 両方を担い `isDiplomaticProjectKind` を立てると seize enforce（self-executed）が回帰する（open_diplomatic_play に seizure 分岐が無く全 seize enforce が失敗）ため、**kind を分割**: seize 用 `enforce_obligation` は self-executed のまま据え置き、LandContractDefault 用に diplomatic kind `enforce_land_contract_default` を新設し pressureSystem の default 分岐をこちらに向けた。実装範囲は **RESTORE 経路**: `contract_tax_revision` play を再利用し「現税率維持」を demand に、`resolvesLandContractDefaultId` を issue → demand → WarGoal へ伝播し、和平受諾（applyChangeContractTaxRate）/ 戦争勝利（applyTaxGoal）の両経路で対象 default を resolved にする。RESTORE 以外（revise / terminate）の AI 判断と requiredWarScore 差別化、RealEstateSeizure の War 経路は balance / AI フェーズへ defer。

#### Config（保守的初期値・balance 保留）

`*PrescriptionYears`=20 / `*OpportunityThreshold`=40 / 各 `*ProjectCooldownWeeks`=96 / `revoltOccupationNominalTaxRate`=0.5 / `seizeResistanceReference`=150 / `withholdMilitaryAdvantageFactor`=0.6 / `violenceOpportunityTargetWeaknessWeight`=0.2 / `violenceOpportunityPrizeWeight`=0.04 / `*EnforceResistanceThreshold` 系=40 / `terminalObligationRetentionWeeks`=48。観察メモ: 初期値での seize 起案頻度は seed により 16〜115 件/150年と高め（enforce 経由 resolved / 20年 prescription 経由 legalized は全 seed で観測）。頻度の絞り込みは balance phase へ defer（プロトタイプ方針 §4）。
