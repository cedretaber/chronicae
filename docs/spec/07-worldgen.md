# 7. Worldgen 初期化

### 7.1 Province terrain / features の生成（v0.33）

worldgen 時に各 Province に `terrain`（5 種・単一）と `features`（3 種・複数可）を生成する（旧 `habitability` 乱数生成は v0.33 で削除）。すべて RNG (`randomFloat`) 経由で決定し `Math.random()` は使わない。terrain / features は Province オブジェクト生成時（`generateProvinces`）に確定し、House seat 選定（§7.4）より前に決定済みであることを保証する。

**terrain**（StateRegion 単位の傾向）:

```txt
StateRegion ごとに dominantTerrain を lazy fill（初回参照時に provinceTerrainWeights から抽選）。
各 Province は randomFloat < stateRegionDominantTerrainInheritanceChance (0.70) なら dominantTerrain を継承、
それ以外は provinceTerrainWeights から再抽選する。
```

**features**（terrain 抽選後に coastal → major_river → lake の順で判定、消費順固定）:

```txt
coastal:
  地図外周マージン（provinceCoastalEdgeMarginRatio = 0.12）内の Province のみ
  randomFloat を消費し、確率 provinceFeatureCoastalChance (0.50) で付与。
  内陸 Province では draw を消費しない。
major_river:
  clamp01(provinceFeatureMajorRiverBaseChance 0.15 + terrainDelta) で常に 1 回 draw。
  terrainDelta: plains +0.10 / wetlands +0.10 / mountains -0.10。
lake:
  clamp01(provinceFeatureLakeBaseChance 0.06 + terrainDelta) で常に 1 回 draw。
  terrainDelta: wetlands +0.05 / plains +0.05。
```

config キーは §9（`provinceTerrainWeights` / `stateRegionDominantTerrainInheritanceChance` / `provinceFeature*`）。v0.33 で worldgen の draw 順が変わるため、同一 seed でも v0.32 以前とは異なる世界が生成される（プロトタイプとして許容）。同一バージョン・同一 seed の決定性は維持する。

### 7.2 PopGroup 初期生成（v0.24 更新）

各 **Holding** に peasants / townsmen / nobles の 3 PopGroup を生成する。POP サイズは occupation capacity に基づく。

**size の初期値**（occupation capacity ベース、v0.33 更新）:
```ts
// 各 Holding について、class ごとに occupation capacity を算出。
// v0.33: state 非依存の pure helper computeHoldingOccupationCapacity を selector と共有し、
// capacity = (base + improvementDerivedCapacity) * weight * landQuality で算出する
// （旧 devMod = 1.0 固定計算は廃止）。改善配置（§7.3c）は POP seeding より前段で確定済み。
const agriCap  = computeHoldingOccupationCapacity(holding.kind, weight, landQuality, terrain, features, improvements, config, 'agriculture')
const urbanCap = computeHoldingOccupationCapacity(holding.kind, weight, landQuality, terrain, features, improvements, config, 'urban_labor')
const eliteCap = computeHoldingOccupationCapacity(holding.kind, weight, landQuality, terrain, features, improvements, config, 'elite_service')

const fillRatio = rng.nextFloat(initialPopFillRatioMin, initialPopFillRatioMax) / 100

peasants.size  = max(minPopSizeByClass.peasants, agriCap * fillRatio)
townsmen.size  = max(minPopSizeByClass.townsmen, urbanCap * fillRatio)
nobles.size    = max(minPopSizeByClass.nobles, eliteCap * fillRatio)
```

全 POP は `occupation` に対応する標準職業（peasants→agriculture, townsmen→urban_labor, nobles→elite_service）で生成する。worldgen では `none` POP を生成しない。

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

**popIndex の初期化**: 各 POP 生成時に `popIndex.byHolding` を更新する。

### 7.3 WorldPreset と階層構造の生成（v0.16 / v0.20 / v0.20.1 更新）

**WorldPreset** によりマップサイズと Polity 数を制御する:

| preset | stateCount | prov/state | 概算 Province 数 | Polity (K/D/C) | Holdings/prov |
|---|---|---|---|---|---|
| tiny | 4 | 3-5 | 12-20 | 1/2/6 | 2 |
| small | 9 | 7-11 | 63-99 | 2/5/15 | 2-3 |
| standard | 16 | 14-18 | 224-288 | 4/10/30 | 4 |
| perfLarge | 25 | 14-18 | 350-450 | 6/16/50 | 3-5 |

各 Polity に 1 つの ownerHouse を割り当てる。**v0.31**: AnonymousHouse は廃止。placeholder Person は `houseId === undefined` として生成される。

**StateRegion の生成（v0.20.1）**: 矩形グリッドを廃止し、Poisson disk sampling で State center を配置。各 State に Province を楕円クラスタで配置。Province 間の neighbors は Delaunay 三角形分割 → MST + 確率的 edge 選別で生成。

### 7.3a Province グラフ生成（v0.20.1 新規）

**MapGenerationConfig** で空間パラメータを制御:

| パラメータ | デフォルト値 | 説明 |
|---|---|---|
| worldMapWidth / Height | 1000 / 700 | マップ座標範囲 |
| minStateCenterDistance | 160 | State center 間の最小距離 |
| minProvinceDistance | 45 | Province 間の最小距離 |
| stateRadiusMin / Max | 80 / 150 | 楕円クラスタの半径範囲 |
| stateAspectRatioMin / Max | 0.65 / 1.6 | 楕円のアスペクト比 |
| intraStateExtraEdgeChance | 0.25 | State 内追加 edge の確率 |
| interStateExtraEdgeChance | 0.12 | State 間追加 edge の確率 |
| maxProvinceDegree | 5 | Province の最大接続数 |
| maxInterStateEdgesPerStatePair | 2 | State pair あたりの最大接続数 |

**生成手順** (13 ステップ):

1. State center を Poisson disk sampling で配置
2. State ごとの Province 数を割り当て
3. State ごとの楕円パラメータ（radiusX, radiusY, rotation）を生成
4. Province point を State center 周辺に楕円分布で配置（空間ハッシュグリッドで最小距離チェック）
5. 幾何的 State 割り当て検証（最寄り State center に再割り当て）
6. 全 Province で Delaunay 三角形分割
7. Edge を intra_state / inter_state に分類
8. State 内 MST で連結骨格を保証
9. 追加 intra-state edge を確率的に採用
10. inter-state edge を確率的に追加（各 State pair で最短 1 本は優先）
11. UnionFind で全体連結性を保証
12. Province.neighbors を確定（双方向）
13. Province 命名

**不変条件**:
- 全 Province graph は連結
- 各 Province の degree ≥ 1
- Province.neighbors は双方向
- IntegrityCheck (§25 S4) で検証

**LandContract chain の生成**: Province ごとに Polity 階層に基づく contract chain を構築した後、各 Holding に独立した chain をコピーする（最初の Holding は元の chain を流用、2 番目以降は新しい contract ID でコピー）。

```
root (rootAuthorityId = ROOT_WORLD, taxRateToGrantor = 0)
  → Kingdom (taxRateToGrantor = 0.3)
  → Duchy   (taxRateToGrantor = 0.3)   ← optional
  → County  (taxRateToGrantor = 0.3)   ← terminal grantee
```

`INTERMEDIATE_TAX_RATE = 0.3` で固定。root contract の `taxRateToGrantor` は 0 固定。`byHolding` が正規 index。`byProvince` は最初の Holding の chain を legacy 互換として保持。

### 7.3b Holding の生成（v0.20 / v0.27 更新）

各 Province に `holdingsPerProvinceMin..Max` の Holding を生成する。

- `kind`: 基本は `manor`。`cityProvinceChance` (20%) で最初の city を配置。`secondCityChance` (5%) で 2 つ目の city を許容
- `name`: Province 名 + 連番サフィックス (e.g. "Aldoria-1", "Aldoria-2")
- `weight`: 1.0 (基本) + manor 0.0〜0.3 / city 0.5〜1.0 の乱数加算
- `landQuality`: 0.6〜1.4 の乱数（v0.33: terrain とは独立。terrain 傾向は Improvement の terrain multiplier 側で表現し landQuality には混ぜない、§3.1d / §4.2）
- ~~`development`~~: **v0.27 で削除**。代わりに初期 HoldingImprovement を配置（§7.3c 参照）

### 7.3c 初期 HoldingImprovement の配置（v0.27 / v0.33 更新）

完全未整備世界を避けるため、Holding kind に応じて Lv.1 Improvement を一定確率で配置する。v0.33 で候補 kind を新 ImprovementKind に置き換えた。

```text
manor:
  field_system               0.40
  pastoral_infrastructure     0.20
  irrigation_infrastructure   0.30  ← feature ゲートで実質低下
  storage_infrastructure      0.15
  transport_infrastructure    0.15

city:
  market_infrastructure       0.40
  workshop_infrastructure      0.25
  storage_infrastructure      0.25
  transport_infrastructure    0.25
```

**RNG 消費順（決定性）**: 各 holding × 候補 kind について、draw 前に `canBuildHoldingImprovementPure(holding.kind, terrain, features, 0, kind, config)` を判定する。**建設不可なら `randomFloat` を消費せず continue**、通過した kind のみ 1 回 draw して確率判定する。これにより同一バージョン・同一 seed の決定性を保証する。確率値は `generateWorld.ts` 内インライン（バランス調整で変更可）。

v0.33 では worldgen の土地初期化ロジックが変更されるため、同一 seed に対する v0.32 以前との世界互換性は保証しない。v0.33 内では同一 seed に対して決定的な worldgen を維持する。

### 7.4 seatProvinceId / capitalProvinceId の決定（v0.33 更新）

各 House の本拠地 `seatProvinceId` は、その House が初期保有する Province のうち `provinceTerrainSettlementSuitability`（terrain 由来の居住適性重み、§9）が最も高い Province を選ぶ。同点は ProvinceId 昇順で決定する（v0.33: 旧 `habitability` 最大 Province ベースを置換）。seat 選定時点では Holding 未生成のため Holding ベースの指標（landQuality 平均 / weight 合計）は使わない。各 Polity の首都 (`capitalProvinceId`) は ownerHouse の `seatProvinceId`。

### 7.5 polityControl の初期値（v0.16 / v0.20）

`polityControl` を ControlSystem と同じ距離上限計算で初期化する。**v0.20** では各 Holding の `polityControl` を設定する。

```
holding.polityControl = maxControl(capitalProvinceId からの BFS 距離)
```

接続不能な Province の Holding: `polityControl = 30`。

### 7.7 HoldingOffice (Bailiff) の初期化（v0.16 / v0.20）

全 **Holding** に `bailiff` HoldingOfficeAssignment を生成し、holder は **placeholder Person** (`houseId === undefined`) とする。BailiffAppointmentSystem (§6.14e) が実行されると順次通常人物に置き換わる。

### 7.8a Person Goal / Aim 初期生成（v0.23）

全 adult normal Person に初期 Person Goal を生成する。Goal 生成後、各 Person に初期 Person Aim と initial Task も生成する。

```ts
for each alive adult normal person:
  1. PersonGoalKind をスコアリングで選択
  2. Goal を生成（progress = baseFulfillment 初期値）
  3. PersonAimKind をスコアリングで選択（support_organization_aim は除外）
  4. Aim を生成（activeTaskId 付き）
  5. initial Task を生成
```

### 7.8 エンティティ名称の生成

Polity / House / Province / Person の `name` は、`sim/worldgen/namePool.ts` に定義された名前プールから seed 付き RNG で選択する。

- Polity・House・Province: `pickUniqueName` による重複回避。プール不足時は `Country-N` / `House-N` / `Province-N` にフォールバック
- Person（worldgen 初期生成・BirthSystem による出生ともに）: `pickNameBySex` による重複あり選択（中世欧州風に同名人物が複数存在し得る）
- `debug` モード時もエンティティ名は通常と同じ名前プールから生成される（連番 ID 方式は廃止）。デバッグ追跡はエンティティ固有 ID（`pe-42`, `h-3` 等）で行う

---

