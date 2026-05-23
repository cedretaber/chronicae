# 7. Worldgen 初期化

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

### 7.3 WorldPreset と階層構造の生成（v0.16 / v0.20 / v0.20.1 更新）

**WorldPreset** によりマップサイズと Polity 数を制御する:

| preset | stateCount | prov/state | 概算 Province 数 | Polity (K/D/C) | Holdings/prov |
|---|---|---|---|---|---|
| tiny | 4 | 3-5 | 12-20 | 1/2/6 | 2 |
| small | 9 | 7-11 | 63-99 | 2/5/15 | 2-3 |
| standard | 16 | 14-18 | 224-288 | 4/10/30 | 4 |
| perfLarge | 25 | 14-18 | 350-450 | 6/16/50 | 3-5 |

各 Polity に 1 つの ownerHouse を割り当てる。加えて **AnonymousHouse (`h-anon`, kind: 'system')** を 1 つ生成し placeholder Person の集約用とする。

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

### 7.3b Holding の生成（v0.20）

各 Province に `holdingsPerProvinceMin..Max` の Holding を生成する。

- `kind`: 基本は `manor`。`cityProvinceChance` (20%) で最初の city を配置。`secondCityChance` (5%) で 2 つ目の city を許容
- `name`: Province 名 + 連番サフィックス (e.g. "Aldoria-1", "Aldoria-2")
- `weight`: 1.0 (基本) + manor 0.0〜0.3 / city 0.5〜1.0 の乱数加算
- `landQuality`: 0.8〜1.2 の乱数
- `development`: Province の habitability から初期値 (-10〜+10) を設定

### 7.4 seatProvinceId / capitalProvinceId の決定

各 House の本拠地は、その House が ownerHouse である Polity の terminal Province のうち配分された Province の先頭。各 Polity の首都 (`capitalProvinceId`) は ownerHouse の `seatProvinceId`。

### 7.5 polityControl の初期値（v0.16 / v0.20）

`polityControl` を ControlSystem と同じ距離上限計算で初期化する。**v0.20** では各 Holding の `polityControl` を設定する。

```
holding.polityControl = maxControl(capitalProvinceId からの BFS 距離)
```

接続不能な Province の Holding: `polityControl = 30`。

### 7.7 HoldingOffice (Bailiff) の初期化（v0.16 / v0.20）

全 **Holding** に `bailiff` HoldingOfficeAssignment を生成し、holder は **placeholder Person** (AnonymousHouse 所属) とする。BailiffAppointmentSystem (§6.14e) が実行されると順次通常人物に置き換わる。

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

