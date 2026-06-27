# 7. Worldgen 初期化

### 7.1 Province terrain / features の生成

worldgen 時に各 Province に `terrain`（5 種・単一）と `features`（3 種・複数可）を生成する。すべて RNG (`randomFloat`) 経由で決定し `Math.random()` は使わない。terrain / features は Province オブジェクト生成時（`generateProvinces`）に確定し、House seat 選定（§7.4）より前に決定済みであることを保証する。

**terrain**（StateRegion 単位の傾向）:

```txt
StateRegion ごとに dominantTerrain を lazy fill（初回参照時に provinceTerrainWeights から抽選）。
各 Province は randomFloat < stateRegionDominantTerrainInheritanceChance (0.70) なら dominantTerrain を継承、
それ以外は provinceTerrainWeights から再抽選する。
```

**全地形カバレッジ保証 (v0.59)**: 全 Province の terrain 抽選後、`generateProvinces` の末尾で **World 単位**で全 5 地形（plains/forest/hills/mountains/wetlands）が最低 1 つずつ出現することを保証する。未出現の地形があれば、「出現数最多の地形を持つ最小 index の Province」を 1 つ選んで terrain を上書きする（RNG 不使用・決定的。出現数 ≤1 の地形は奪わない＝別の欠落を生まないため）。Province 数が地形数未満の極小ケースでは欠落が残りうるが、全 preset で発生しない。市場は state 単位で閉じるため、鉱業/林業に恵まれない state は残りうる（将来の交易システムで解消予定）。農園は全地形で建設可能（§7.3d）なので、地形が偏った state でも食料生産は >0 になる。

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

各 **Holding** に PopStratum（lower / middle / upper）ごとの POP を生成する。POP サイズは stratum capacity に基づく。

**v0.55（v0.57.1 で置換済み）**: 旧 3 class（peasants/townsmen/nobles）を **PopStratum × PopType** へ置換。各 stratum capacity を **PopType 比率**で分割し、PopType ごとに別 PopGroup を生成する（merge key に popType が入るため別管理、§13.3）。v0.55 では初期 PopType 分布を全 holding 共通の固定比率（`WORLDGEN_POP_TYPE_DISTRIBUTION`: lower peasants 55% / laborers 15% / artisans 15% / scribes 5% / soldiers 10%、middle freeholders 30% / masters 20% / merchants 20% / bureaucrats 10% / ministeriales 20%、upper nobles 60% / patricians 40%）で与えていた。

> **v0.57.1 で置換**: 固定職能分布は廃止し、**施設駆動の PopType ハード枠に比例した seed** に変更した（§6.x.v0.57「worldgen 初期配置も PopType 駆動」）。holding ごとに `computeHoldingAllPopTypeCapacities` で PopType 別容量を求め、`size = cap × fillRatio`（`fillRatio` は holding 単位 1 回抽選の 0.70–0.95）で seed する。**cap=0 の PopType は seed しない**（施設に枠の無い職能を播かないことで初期の構造的失業を解消）。雇用枠を持つ施設が無い holding のみ、ghost holding 回避のため最低限の小作農（unemployed）を 1 つ seed。wealth/unrest は従来どおり stratum 単位で抽選し同 stratum の全 PopType に適用（RNG draw 順不変）。
>
> なお v0.56 で転職・移住が、v0.57 で PopType 単位ハード枠（soft modifier 廃止）が入ったため、**現在は局所的な PopType 不足は hard 失業を生む**（旧記述「soft modifier 方針のため hard 失業にはならない」は無効）。初期比率が施設構成と一致するため初期失業は最小化される。

**size の初期値**（class capacity ベース）:
```ts
// 各 Holding について、class ごとに class capacity を算出。
// getHoldingClassCapacity(state, config, holdingId, popClass) を selector と共有し、
// capacity は RealEstateAsset の employmentSlots + HoldingImprovement の classCapacityPerLevel から導出する。
// RealEstateAsset 配置（§7.3d）および改善配置（§7.3c）は POP seeding より前段で確定済み。
const lowerCap  = getHoldingClassCapacity(state, config, holdingId, 'lower')
const middleCap = getHoldingClassCapacity(state, config, holdingId, 'middle')
const upperCap  = getHoldingClassCapacity(state, config, holdingId, 'upper')

const fillRatio = rng.nextFloat(initialPopFillRatioMin, initialPopFillRatioMax) / 100

// v0.55（v0.57.1 で置換）: 各 stratum の size を固定 PopType 比率で分割していた。
//   現行 v0.57.1 は PopType 別容量で直接 seed する:
//     for popType of POP_TYPES:
//       cap = computeHoldingAllPopTypeCapacities(...)[popType]
//       if cap <= 0: continue           // 枠の無い職能は播かない
//       groups[popType].size = cap * fillRatio   // fillRatio<1 ⇒ size ≤ cap ⇒ employed:true 成立
lowerGroups[t].size  = max(minPopSizeByClass.lower,  lowerCap  * fillRatio * lowerRatio[t])
middleGroups[t].size = max(minPopSizeByClass.middle, middleCap * fillRatio * middleRatio[t])
upperGroups[t].size  = max(minPopSizeByClass.upper,  upperCap  * fillRatio * upperRatio[t])
```

POP は原則 `employed: true` で生成する（`size = cap × fillRatio ≤ cap` のため）。**例外（v0.57.1）**: 雇用枠を持つ施設が無い holding には、ghost holding 回避のため最低限の小作農を 1 つだけ `employed: false` で seed する。

**wealth の初期値**（PopStratum ごとに差をつける）:
```ts
lower.wealth   = randomInt(35, 60)
middle.wealth  = randomInt(45, 70)
upper.wealth   = randomInt(50, 80)
```

**unrest の初期値**（低〜中程度）:
```ts
lower.unrest   = randomInt(10, 30)
middle.unrest  = randomInt(10, 25)
upper.unrest   = randomInt(5, 25)
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
  - **city 保証 (v0.48 → v0.59 で state 単位に格上げ)**: 上記の抽選とは別に、**各 state に最低 1 つの city を保証する**（全 preset）。worldgen は holding 生成前に、provinces 出力順で各 state に最初に現れる Province を 1 つずつ強制 city province にする（決定的・RNG 不使用）。**この保証は `minHoldingsForCity` 閾値を上書きする** ため、tiny preset (holdingsPerProvince=2) でも各 state に city が生成される。強制対象の Province は最後の Holding のみ city 化する。（旧 v0.48: world 全体で `minGuaranteedCities` (2) を Fisher-Yates でランダム選択していたが、state 単位保証に置換）
  - **manor≥2 保証 (v0.59)**: 全 Province は manor を最低 2 つ持つ（全 preset）。city がある Province は `2 manor + 1 city = 3 holding`。`holdingCount` を `max(holdingCount, 2 + (hasCity ? 1 : 0))` で底上げするだけで kind 割当（最後の holding のみ city）は不変。holding 数が少ない tiny/small で実質的に効く（standard 以上は元々充足）
- `name`: Province 名 + 連番サフィックス (e.g. "Aldoria-1", "Aldoria-2")
- `weight`: manor = 1.0 (固定、乱数加算なし)、city = 2.0 + randomFloat * 1.0 (= 2.0〜3.0)
- （v0.59: `landQuality` は廃止。holding 単位の変動は Province の「広闊な地形」trait による不動産スロット数で表現する。§7.1 traits / §3.1）

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

各 Holding に RealEstateAsset（v0.55: `farm / mountain / woodland / workshop`）を一定確率で配置する。RealEstateAsset は雇用枠（employmentSlots、PopStratum weight）を提供し、POP の stratum capacity の主な供給源となる。初期 `recipeSlots` は RealEstateKind ごとの `DefaultRecipeSlotProfile`（§3.2c / §9）を 20 slot に largest-remainder 配分したもの。

**生成手順**:

1. Holding ごとに全 `RealEstateKind`（v0.55: farm / mountain / woodland / workshop）を列挙し、`canBuildRealEstateAssetPure(holding.kind, terrain, features, kind)` で建設可能な kind を絞り込む（v0.55: 一次産業 farm/mountain/woodland は manor のみ、workshop は city のみ。terrain gate あり）
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

**RNG 消費順（決定性）**: 建設不可な kind は `randomFloat` を消費しない。buildable kinds の列挙順は `REAL_ESTATE_DEFINITIONS` のキー順（v0.55: farm → mountain → woodland → workshop）で固定。

### 7.4 seatProvinceId / capitalProvinceId の決定

各 House の本拠地 `seatProvinceId` は、その House が初期保有する Province のうち `provinceTerrainSettlementSuitability`（terrain 由来の居住適性重み、§9）が最も高い Province を選ぶ。同点は ProvinceId 昇順で決定する。seat 選定時点では Holding 未生成のため Holding ベースの指標（weight 合計など）は使わない。各 Polity の首都 (`capitalProvinceId`) は ownerHouse の `seatProvinceId`。

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

**注 (v0.59 で解消)**: 旧来 worldgen は `defaultConfig` 直参照で `--config` が初期世界生成に効かなかったが、v0.59 自己レビューで `generateWorld` / `generateProvinces` 全体に threaded config を通し、`--config` の上書きが初期世界（性比・地形・地物・初期人口・容量等）にも反映されるようになった（既定は `defaultConfig` なので未指定時は不変）。女性多めプレイ（§9 レシピ）は worldgen 初期から反映される。

### 7.7a 初期 Office の生成

- **house:leader**: 各 House の成人男性からスコア（legacyPrestige + governance/warCommand 加重）最高の者。成人男性が居なければ成人女性、それも居なければ最年長メンバー
- **polity:leader**: polity 内で最多 Province を支配する House の house:leader をそのまま任命
- **polity の administrator / treasurer / military**: polity 関係 House の成人から能力順（admin 系 = governance 加重、military = warCommand 加重）に各 1 名。polity:leader は除外
  - v0.45.3: 性別役職適格ゲート（§6.19）を適用 — sorted 先頭の適格者を採用し、適格者ゼロなら `allowFemaleRolesWhenNoMaleCandidate`（既定 false）が true の場合のみ先頭に fallback（runtime 任命と同形）。v0.59 で worldgen 全体に config を threading したため `--config` で変更可能（旧「defaultConfig 直参照で不可」の制約は解消）

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

### 7.9 初期連隊・兵舎の生成（v0.64）

`generateInitialRegiments` で 1 Holding = 1 歩兵連隊を生成する。`createRegimentWithBarracksMut` で Regiment と RegimentBarracks を同時生成し、`requiredByPopType` を `computeBarracksRequiredByPopType(config, troopKind)` で確定。歩兵: soldiers 8 + ministeriales 2。

各 popType について `addToOrCreatePopGroupMut` で兵舎勤務 POP を明示生成（`employerId: { kind: 'barracks', id: barracks.id }`、`class: getPopStratum(popType)`）。

騎兵は `cavalryEntitlementSystem`（§6.72）が動的に生成する。worldgen では歩兵のみ。

叛乱（`diplomaticPlayRevolt`）の local_levy は `requiredByPopType: {}` の transient barracks で生成（POP 不要・給与 no-op・戦闘死亡 no-op）。

---

