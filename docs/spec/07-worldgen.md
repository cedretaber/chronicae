# 7. Worldgen 初期化

### 7.1 Province terrain / features の生成

worldgen 時に各 Province に `terrain`（5 種・単一）と `features`（3 種・複数可）を生成する。すべて RNG (`randomFloat`) 経由で決定し `Math.random()` は使わない。terrain / features は Province オブジェクト生成時（`generateProvinces`）に確定し、House seat 選定（§7.4）より前に決定済みであることを保証する。

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

config キーは §9（`provinceTerrainWeights` / `stateRegionDominantTerrainInheritanceChance` / `provinceFeature*`）。同一 seed に対する worldgen は決定的である。

### 7.2 PopGroup 初期生成

各 **Holding** に peasants / townsmen / nobles の 3 PopGroup を生成する。POP サイズは class capacity に基づく。

**size の初期値**（class capacity ベース）:
```ts
// 各 Holding について、class ごとに class capacity を算出。
// getHoldingClassCapacity(state, config, holdingId, popClass) を selector と共有し、
// capacity は RealEstateAsset の employmentSlots + HoldingImprovement の classCapacityPerLevel から導出する。
// RealEstateAsset 配置（§7.3d）および改善配置（§7.3c）は POP seeding より前段で確定済み。
const peasantCap  = getHoldingClassCapacity(state, config, holdingId, 'peasants')
const townsmenCap = getHoldingClassCapacity(state, config, holdingId, 'townsmen')
const nobleCap    = getHoldingClassCapacity(state, config, holdingId, 'nobles')

const fillRatio = rng.nextFloat(initialPopFillRatioMin, initialPopFillRatioMax) / 100

peasants.size  = max(minPopSizeByClass.peasants, peasantCap * fillRatio)
townsmen.size  = max(minPopSizeByClass.townsmen, townsmenCap * fillRatio)
nobles.size    = max(minPopSizeByClass.nobles, nobleCap * fillRatio)
```

全 POP は `employed: true` で生成する。worldgen では未就業（`employed: false`）POP を生成しない。

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

### 7.3 WorldPreset と階層構造の生成

**WorldPreset** によりマップサイズと Polity 数を制御する:

| preset | stateCount | prov/state | 概算 Province 数 | Polity (K/D/C) | Holdings/prov |
|---|---|---|---|---|---|
| tiny | 4 | 3-5 | 12-20 | 1/2/6 | 2 |
| small | 9 | 7-11 | 63-99 | 2/5/15 | 2-3 |
| standard | 16 | 14-18 | 224-288 | 4/10/30 | 4 |
| perfLarge | 25 | 14-18 | 350-450 | 6/16/50 | 3-5 |

各 Polity に 1 つの ownerHouse を割り当てる。placeholder Person は `houseId === undefined` として生成される。

**StateRegion の生成**: Poisson disk sampling で State center を配置。各 State に Province を楕円クラスタで配置。Province 間の neighbors は Delaunay 三角形分割 → MST + 確率的 edge 選別で生成。

### 7.3a Province グラフ生成

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
- IntegrityCheck (§6.35) で検証

**LandContract chain の生成**: Province ごとに Polity 階層に基づく contract chain を構築した後、各 Holding に独立した chain をコピーする（最初の Holding は元の chain を流用、2 番目以降は新しい contract ID でコピー）。

```
root (rootAuthorityId = ROOT_WORLD, taxRateToGrantor = 0)
  → Kingdom (taxRateToGrantor = 0.3)
  → Duchy   (taxRateToGrantor = 0.3)   ← optional
  → County  (taxRateToGrantor = 0.3)   ← terminal grantee
```

`INTERMEDIATE_TAX_RATE = 0.3` で固定。root contract の `taxRateToGrantor` は 0 固定。`byHolding` が正規 index である。worldgen は province ごとの chain を一時 local map で保持し、各 Holding の `byHolding` chain に紐付ける。

### 7.3b Holding の生成

各 Province に `holdingsPerProvinceMin..Max` の Holding を生成する。

- `kind`: 基本は `manor`。`minHoldingsForCity` (3) 以上の Holding を持つ Province のみ city 配置の抽選対象となり、確率 `cityProvinceChance` (20%) で最後の Holding が `city` になる。1 Province あたり city は最大 1 つ
  - **city 保証 (v0.48)**: 上記の抽選とは別に、ワールド全体で最低 `minGuaranteedCities` (2) 個の city を保証する。worldgen は holding 生成前にランダムな Province を 2 つ選び (部分 Fisher-Yates、配置が末尾に偏らないようにする)、それらは強制的に city を 1 つ持つ。**この保証は `minHoldingsForCity` 閾値を上書きする** ため、tiny preset (holdingsPerProvince=2、通常は city が 0 個) でも常に city が 2 つ生成される。強制対象の Province は `holdingCount >= 2` なら最後の Holding のみ city 化し manor が 1 つ以上残る (全 preset で `holdingsPerProvinceMin >= 2`)
- `name`: Province 名 + 連番サフィックス (e.g. "Aldoria-1", "Aldoria-2")
- `weight`: manor = 1.0 (固定、乱数加算なし)、city = 2.0 + randomFloat * 1.0 (= 2.0〜3.0)
- `landQuality`: 0.6〜1.4 の乱数（terrain とは独立。terrain 傾向は Improvement の terrain multiplier 側で表現し landQuality には混ぜない、§3.1d / §4.2）

初期の土地整備度は `development` フィールドではなく初期 HoldingImprovement の配置で表現する（§7.3c 参照）。

### 7.3c 初期 HoldingImprovement の配置

完全未整備世界を避けるため、Holding kind に応じて Lv.1 Improvement を一定確率で配置する。

```text
manor:
  manor_house                 0.30
  irrigation_infrastructure   0.30  ← feature ゲートで実質低下
  storage_infrastructure      0.15
  transport_infrastructure    0.15

city:
  town_hall                   0.30
  market_infrastructure       0.40
  workshop_infrastructure      0.25
  storage_infrastructure      0.25
  transport_infrastructure    0.25
```

**RNG 消費順（決定性）**: 各 holding × 候補 kind について、draw 前に `canBuildHoldingImprovementPure(holding.kind, terrain, features, 0, kind, config)` を判定する。**建設不可なら `randomFloat` を消費せず continue**、通過した kind のみ 1 回 draw して確率判定する。これにより同一 seed の決定性を保証する。確率値は `generateWorld.ts` 内インライン（バランス調整で変更可）。

### 7.3d 初期 RealEstateAsset の配置

各 Holding に RealEstateAsset（field / pasture / workshop）を一定確率で配置する。RealEstateAsset は雇用枠（employmentSlots）を提供し、POP の class capacity の主な供給源となる。

**生成手順**:

1. Holding ごとに全 `RealEstateKind`（field / pasture / workshop）を列挙し、`canBuildRealEstateAssetPure(holding.kind, terrain, features, kind)` で建設可能な kind を絞り込む
2. 建設可能な kind ごとに `randomFloat` を 1 回消費し、確率 0.6 で配置する。`realEstateSlotCapacityBase`（manor: 3, city: 4）に達したら打ち切り
3. **補完**: 上記で 1 つも配置されなかった Holding には、建設可能な先頭 kind を 1 つ追加する（最低 1 asset 保証）

```text
全 buildable kinds:  確率 0.6 で配置（slotCapacityBase まで）
補完:                0 asset の Holding に primary kind を 1 つ追加
```

**初期属性**:
- `owner`: `undefined`（無主。House/Person が acquire_real_estate Project で取得可能）
- `level`: 1
- `createdWeek`: 1

**RNG 消費順（決定性）**: 建設不可な kind は `randomFloat` を消費しない。buildable kinds の列挙順は `REAL_ESTATE_DEFINITIONS` のキー順（field → pasture → workshop）で固定。

### 7.4 seatProvinceId / capitalProvinceId の決定

各 House の本拠地 `seatProvinceId` は、その House が初期保有する Province のうち `provinceTerrainSettlementSuitability`（terrain 由来の居住適性重み、§9）が最も高い Province を選ぶ。同点は ProvinceId 昇順で決定する。seat 選定時点では Holding 未生成のため Holding ベースの指標（landQuality 平均 / weight 合計）は使わない。各 Polity の首都 (`capitalProvinceId`) は ownerHouse の `seatProvinceId`。

### 7.5 polityControl の初期値

`polityControl` を ControlSystem と同じ距離上限計算で初期化する。各 Holding の `polityControl` を設定する。

```
holding.polityControl = maxControl(capitalProvinceId からの BFS 距離)
```

接続不能な Province の Holding: `polityControl = 30`。

### 7.7 HoldingOffice (Bailiff) の初期化

全 **Holding** に `bailiff` HoldingOfficeAssignment を生成し、holder は **placeholder Person** (`houseId === undefined`) とする。BailiffAppointmentSystem (§6.22) が実行されると順次通常人物に置き換わる。

### 7.6a 初期人物の性比（v0.45.4）

worldgen で生成する初期人物（House メンバーの sibling / child / relative、初期在野人物）の性別は config を参照する:
- House メンバー: `maleBirthChance`（既定 0.75 = 男:女 3:1。旧 0.52 ハードコード）
- 初期在野人物: `houselessMaleRatio`（既定 0.75。runtime の在野補充と整合。旧 0.5 ハードコード）
- 父・母・配偶者の固定性別、house:leader 選定の男子優先は不変

**注**: worldgen は `defaultConfig` を直参照するため `--config` では変更されない（既知の制約）。女性多めプレイ（§9 レシピ）では worldgen 初期は男性多めのまま、runtime 出生で性比が drift する。

### 7.7a 初期 Office の生成

- **house:leader**: 各 House の成人男性からスコア（legacyPrestige + governance/warCommand 加重）最高の者。成人男性が居なければ成人女性、それも居なければ最年長メンバー
- **polity:leader**: polity 内で最多 Province を支配する House の house:leader をそのまま任命
- **polity の administrator / treasurer / military**: polity 関係 House の成人から能力順（admin 系 = governance 加重、military = warCommand 加重）に各 1 名。polity:leader は除外
  - v0.45.3: 性別役職適格ゲート（§6.19）を適用 — sorted 先頭の適格者を採用し、適格者ゼロなら `allowFemaleRolesWhenNoMaleCandidate`（既定 false）が true の場合のみ先頭に fallback（runtime 任命と同形）。worldgen は defaultConfig 直参照のため `--config` では変更不可（既知の制約）

### 7.8a Person Goal / Aim 初期生成

全 adult normal Person に初期 Person Goal を生成する。Goal 生成後、各 Person に初期 Person Aim と initial Task も生成する。

```ts
for each alive adult normal person:
  1. PersonGoalKind をスコアリングで選択
  2. Goal を生成（progress = 0、targetProgress = 100）
  3. PersonAimKind をスコアリングで選択（support_organization_aim も通常候補。Person の House に支援可能な active organization aim がある場合のみ選択され得る。無い場合は候補から自動的に外れる）
  4. Aim を生成（activeTaskId 付き）
  5. initial Task を生成
```

### 7.8 エンティティ名称の生成

Polity / House / Province / Holding / Person の `nameKey` は、name pool（`NamePoolService` / fallback は `sim/worldgen/nameGenerators.ts` の legacy pool）から seed 付き RNG で選択する。

- Polity・House・Province: `pickUniqueNameKey`（NamePoolService）による重複回避。pool 不足時はハードコード fallback。Polity は `nameSource: { kind: 'pool', nameKey }` で保持する
- **Holding（v0.41）**: 各 Holding に required `nameKey` を付与する。manor は `province.western.common`、city は `city.western.common` pool から `pickUniqueNameKey` で選び、**同一 Province 内で一意**にする（per-province used set で消費。Province 自身の nameKey は seed しない＝Province 名と Holding 名の衝突は許容、他 Province の Holding 名との重複も許容）。Holding 専用 category は使わない。required のため Holding literal 構築時に確定させる（post-hoc mutation でなく）。NamePoolService 無しの fallback 経路（一部 test）は `provinceNamePool` を用いる
- **民衆叛乱で新設される rank 5 commonwealth（v0.41）**: pool 名を引かず、成立元 Holding 由来名 `nameSource: { kind: 'holding', holdingId }` を持つ（地名由来の国名）。`regime_changed_by_popular_revolt` は既存 nameSource を維持する
- Person（worldgen 初期生成・BirthSystem による出生ともに）: `pickNameBySex` / NamePoolService による重複あり選択（中世欧州風に同名人物が複数存在し得る）
- `debug` モード時もエンティティ名は通常と同じ名前プールから生成される（連番 ID 方式は廃止）。デバッグ追跡はエンティティ固有 ID（`pe-42`, `h-3` 等）で行う

---

