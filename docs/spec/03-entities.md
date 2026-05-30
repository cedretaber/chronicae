# 3. エンティティ型

### 3.1 Province（プロヴィンス）

```ts
type Province = {
  id: ProvinceId
  stateId: StateRegionId
  nameKey: string
  x: number
  y: number
  neighbors: ProvinceId[]
  terrain: ProvinceTerrain      // v0.33: habitability スカラーを置換
  features: ProvinceFeature[]   // v0.33: 複数可・順不同
  holdingIds: HoldingId[]
}

type ProvinceTerrain = 'plains' | 'forest' | 'hills' | 'mountains' | 'wetlands'
type ProvinceFeature = 'coastal' | 'major_river' | 'lake'
```

- `stateId`: 所属する StateRegion (v0.20)
- `nameKey`: ロケール中立の名前識別子。表示文字列への解決は `app/` / `i18n/` の責務（`sim/` 層規約）
- `holdingIds`: この Province に属する Holding の一覧 (v0.20)。各 Holding が development / polityControl を持つ
- `baseTax` / `manpower` / `unrest` は v0.8 で廃止。これらは POP から selector で算出する
- **v0.16**: `polityId` / `ownerHouseId` / `houseControl` を削除。土地支配は §3.8 LandContract chain で表現する。Province の terminal owner は selector (`getProvinceTerminalPolityId` / `getProvinceEffectiveOwnerHouseId`) で取得する
- **v0.20**: `development` / `polityControl` を Province から削除し Holding に移動。Province レベルの値は selector (`getProvinceDevelopmentFromHoldings` / `getProvincePolityControlFromHoldings`) で Holding の weight 加重平均から算出する
- **v0.33**: `habitability`（dead field）を削除し、自然地形 `terrain`（5 種・単一）と地理特徴 `features`（3 種・複数可）を追加した。terrain は House seat 選定（`provinceTerrainSettlementSuitability`、§7.4）と Holding Improvement の建設可否・capacity multiplier（§3.1d / §4.2）に消費される。features は Improvement の建設可否（例: 灌漑は `major_river` / `lake` が必要）と capacity multiplier に効く。worldgen 時に確定しゲーム中は不変（§7.1）

### 3.1a ProvinceTerrain / ProvinceFeature（v0.33）

| Terrain | 意味 | | Feature | 意味 |
|---|---|---|---|---|
| `plains` | 農業・都市形成に向く平坦地 | | `coastal` | 海沿い |
| `forest` | 森林地帯 | | `major_river` | 大河・重要河川を有する |
| `hills` | 丘陵地帯 | | `lake` | 湖・大きな内水面を有する |
| `mountains` | 山岳地帯 | | | |
| `wetlands` | 沼沢地・湿地 | | | |

- 海岸・大河・湖は terrain ではなく別軸の feature として扱い、`coastal mountains` / `river forest` のような複合表現を可能にする
- 将来候補（v0.33 では未導入）: terrain に `steppe` / `desert` / `tundra`。`ruggedness` / `forestDensity` / `fertility` のような追加自然パラメータは使い先が明確になるまで入れない（habitability の二の舞を避ける）

### 3.1b StateRegion（v0.20 / v0.20.1 更新）

```ts
type StateRegion = {
  id: StateRegionId
  name: string
  provinceIds: ProvinceId[]
  centerX: number
  centerY: number
}
```

- Province をまとめる上位地理単位。UI 上の地図表示、集計に使用
- 土地所有・契約・収入の単位ではない（それらは Holding が担う）
- `centerX` / `centerY`: worldgen で Poisson disk sampling により配置された State の地理的中心座標（v0.20.1 で `gridCol` / `gridRow` を廃止し導入）
- State 間隣接は保存せず、selector (`getStateNeighborIds`) で Province.neighbors から動的に算出
- State 境界ポリゴンは WorldState に保存しない。UI 側で Province の Voronoi セルから動的に算出

### 3.1c Holding（v0.20 / v0.27 更新）

```ts
type HoldingKind = 'manor' | 'city'

type Holding = {
  id: HoldingId
  provinceId: ProvinceId
  kind: HoldingKind
  polityControl: number   // 0..100
  landQuality: number     // > 0
  weight: number          // > 0
}
```

- Province 内の個別土地区画。土地契約・実効支配・開発度・収入分配・代官任命の単位
- `kind`: manor (農村荘園) / city (都市)。収入分配で city は kindMultiplier = 1.3
- `polityControl`: terminal Polity の実効支配力。ControlSystem が Holding 単位で更新
- `landQuality`: 土地の基礎品質。収入分配の share weight に影響
- `weight`: Holding の相対的な重み。収入分配・Province 集計の加重に使用
- Holding-Province 対応はゲーム中不変（v0.20 scope ではゲーム中の Holding 追加・削除はない）
- **v0.27**: `development` フィールドを削除。development は HoldingImprovement から `getHoldingDevelopment` selector で算出する（§4.1 / §3.1d 参照）

### 3.1d HoldingImprovement（v0.27 / v0.33 再編）

```ts
type HoldingImprovementId = string  // prefix: "hi-"

type HoldingImprovementKind =
  | 'storage_infrastructure'
  | 'transport_infrastructure'
  | 'field_system'              // v0.33
  | 'pastoral_infrastructure'   // v0.33
  | 'irrigation_infrastructure' // v0.33
  | 'market_infrastructure'     // v0.33
  | 'workshop_infrastructure'   // v0.33

type HoldingImprovement = {
  id: HoldingImprovementId
  holdingId: HoldingId
  kind: HoldingImprovementKind
  level: number        // >= 1
  condition: number    // 0..100（v0.27 / v0.33 では常に 100）
  createdWeek: number
}
```

- Holding に付随する施設。同一 Holding / kind の Improvement は 1 件のみ
- `level`: 施設の等級。kind × Holding kind ごとに max level が異なる（§9 config）
- `condition`: 老朽化・破壊は future。v0.27 / v0.33 では常に 100 で capacity / production のいずれにも影響しない（将来の荒廃・修復システム用に温存）
- development は各 Improvement の level × scorePerLevel の合計として `getHoldingDevelopment` selector で算出（§4.1 参照）

**v0.33 再編**: 抽象的な `agricultural_infrastructure` / `urban_infrastructure` を削除し、具体設備 5 種を追加した。kind ごとの構造メタデータ（建設可能 HoldingKind / terrain / 必須 feature / capacityRole / 対象 occupation）は `sim/config/improvementDefinitions.ts` の `IMPROVEMENT_DEFINITIONS` const に一元化し、数値バランスは `SimulationConfig` に分離する（§9）。

| Kind | 主な意味 | capacityRole | allowed kind / terrain / feature |
|---|---|---|---|
| `field_system` | 農地整備・穀物生産基盤 | capacity (agriculture) | manor / plains・hills・wetlands・forest |
| `pastoral_infrastructure` | 牧草地・放牧・畜産基盤 | capacity (agriculture) | manor / plains・hills・mountains・forest |
| `irrigation_infrastructure` | 灌漑・排水・水利 | capacity (agriculture) | manor / plains・wetlands・hills ＋ `major_river` か `lake` 必須 |
| `market_infrastructure` | 市場・取引施設 | capacity (urban_labor + 少量 elite_service) | city |
| `workshop_infrastructure` | 工房・加工設備 | capacity (urban_labor) | city |
| `storage_infrastructure` | 倉庫・穀倉・貯蔵 | production_quality | manor / city |
| `transport_infrastructure` | 道路・橋・水運 | production_quality | manor / city |

- `capacityRole === 'capacity'` の設備は occupation capacity を生む（§4.2）。`production_quality`（storage / transport）は capacity を生まず、development → production modifier 側で効く
- 後回し（v0.33 未導入）: forestry / mining / quarrying / harbor / fortification / orchard / vineyard / mill。資源・商品・交易・戦争システム導入時に再検討する

**max level（kind × HoldingKind、0 = 建設不可）**:

| ImprovementKind | manor | city |
|---|---|---|
| field_system | 3 | 0 |
| pastoral_infrastructure | 3 | 0 |
| irrigation_infrastructure | 3 | 0 |
| market_infrastructure | 0 | 3 |
| workshop_infrastructure | 0 | 3 |
| storage_infrastructure | 3 | 3 |
| transport_infrastructure | 3 | 3 |

config は `holdingImprovementMaxLevelByKind: Record<ImprovementKind, Partial<Record<HoldingKind, number>>>`（v0.33 で旧 `...ByHoldingKind` からリネーム＋ネスト反転＋Partial 化）。`undefined` / `0` はどちらも建設不可（§9 / §4.2 canBuild）。

**WorldState 追加**:

```ts
holdingImprovements: Record<HoldingImprovementId, HoldingImprovement>
holdingImprovementIndex: {
  byHolding: Record<HoldingId, HoldingImprovementId[]>
}
nextHoldingImprovementId: number
```

### 3.2 PopClass / PopOccupation / PopGroup（民衆集団、v0.24 更新）

```ts
type PopClass = 'peasants' | 'townsmen' | 'nobles'

type PopOccupation = 'agriculture' | 'urban_labor' | 'elite_service' | 'none'

type PopGroup = {
  id: PopGroupId
  holdingId: HoldingId       // v0.24: Province → Holding 所属に変更
  class: PopClass
  occupation: PopOccupation  // v0.24 追加
  size: number       // 抽象人口規模（実人数ではない）
  wealth: number     // 0..100（豊かさ指数。金額ではない）
  unrest: number     // 0..100
  attitudes: AttitudeMap  // 対 Polity などへの態度（v0.11 / v0.15）
}
```

| class | 意味 | 主な役割 | 標準 occupation |
|-------|------|----------|----------------|
| peasants | 農民・村落民 | 人口・基礎生産・兵力の中心 | agriculture |
| townsmen | 都市民・商工民 | 税収・富・都市的発展 | urban_labor |
| nobles | 在地貴族・有力者 | 兵力・家支配・貴族的不満 | elite_service |

**v0.24 で以下の変更を実施:**
- PopGroup は Province ではなく **Holding** に所属する
- `occupation` により職業状態を表現する。`none` は職業枠からあぶれた POP（失業者・土地なし・扶持なし）
- `occupation !== 'none'` の POP は `minPopSizeByClass` で下限保証。`none` POP は size が `popSizeEpsilon` 以下で削除される
- 同一 merge key (`holdingId + class + occupation`) の POP は原則 1 つに統合される
- Province 単位の POP は Holding POP から selector で集計する（§4.2 参照）
- 旧 `Province.popGroupIds` は廃止。POP の参照は `popIndex.byHolding` 経由

Province の unrest は POP unrest の人口加重平均として selector で算出する（§4 参照）。

### 3.3 Polity（政治主体）

```ts
type PolityRank = 1 | 2 | 3 | 4
type PolityKind = 'normal' | 'commonwealth'  // v0.18-pre

type Polity = {
  id: PolityId
  name: string
  rank: PolityRank
  ownerHouseId?: HouseId      // 家産的保有関係: その Polity を所有する家。Rebel Polity / commonwealth では undefined（恒常状態）
  kind?: PolityKind            // v0.18-pre: 'commonwealth' は ownerHouseId === undefined を恒常的に許容する状態。undefined は 'normal' と等価
  treasury: number             // >= 0
  adminPower: number           // 0..100（キャッシュ値。毎年 GovernanceSystem が再計算）
  legacyPrestige: number       // 0..100（歴史的権威・伝統の蓄積）
  active: boolean
  lastWarWeek?: number         // absoluteWeek (v0.19)
  capitalProvinceId: ProvinceId
}
```

- `capitalProvinceId`: 政治支配力の中心。controlSystem の BFS 起点として使う。v0.16 では landless 化後も保持する
- `ownerHouseId`: その Polity を家産的に保有する House の id。Rebel Polity / commonwealth では `undefined`（§11.2 / §17）
- `kind`: 'commonwealth' は v0.18-pre で導入。`ownerHouseId === undefined` を恒常状態として維持する Polity の標識。`createRebelPolity` で 'commonwealth' を set し、`polityOwnerConsistencySystem` / `successionSystem` / `organizationConsistencySystem` 等は commonwealth を skip / 特別扱いする。詳細は `docs/drafts/spec-v018-pre-update.md` 参照
- `rank`: 1 (帝国) / 2 (王国) / 3 (公爵領) / 4 (伯爵領) / 5 (反乱領)。LandContract chain の rank 不変条件 (§7) と戦争 case 分岐 (§13 / §16.1) で機能する
- `legitimacy`・`stability` は v0.11 で削除。セレクターで動的計算（§4.5 参照）
- `adminPower` はキャッシュ値として維持。毎年 GovernanceSystem が `getPolityAdminPower` で再計算（§4.5 / §6.23b 参照）
- **v0.12**: `rulerHouseId` と `roleAssignments` を削除。支配者・役職担当者は `OfficeAssignment` システムで管理（§3.7 参照）。`getPolityLeader` / `getPolityLeaderHouse` セレクターで取得（§4.6 参照）
- **v0.15**: 旧 `Country` を `Polity` に rename し、`houseIds` フィールドを削除（`getPolityHouseIds` selector で動的取得）。`ownerHouseId` / `rank` を新規追加
- **v0.16**: Polity と Province の関係は LandContract chain で表現する。`getPolityGrantedProvinceIds` / `getPolityTerminalProvinceIds` / `getPolityOverlordProvinceIds` を使う
- **v0.18-pre**: `kind: 'normal' | 'commonwealth'` を追加。叛乱政体 (Rebel Polity) を恒常的な commonwealth 状態として維持する基盤

#### Polity-House-Person 関係 (v0.15 / v0.16)

`House` / `Person` は Polity に所属しない。
関係は以下の selector で動的に取得する（§4.x 参照）:

- `getPolityTerminalProvinceIds(state, polityId)` — その Polity が terminal grantee である Province 一覧 (v0.16)
- `getPolityOverlordProvinceIds(state, polityId)` — その Polity が chain 上位に登場する Province 一覧 (v0.16)
- `getPolityHouseIds(state, polityId)` — その Polity を ownerHouse とする House 一覧
- `getHouseOwnedPolityIds(state, houseId)` — その House が ownerHouse である Polity 一覧（複数可、王朝交代で増える）
- `getHouseControlledProvinceIds(state, houseId)` — その House が ownerHouse である Polity が terminal の Province 一覧 (v0.16)
- `getHouseRelevantProvinceIds(state, houseId)` — その House が ownerHouse である Polity が chain 上に登場する Province 一覧 (v0.16)
- `getHousePrimaryPolityId(state, houseId)` — House の主たる Polity（seat / controlled Province 数で判定）

### 3.4 House（家）

```ts
type HouseKind = 'normal' | 'system'

type HouseCreationKind = 'cadet_branch' | 'self_made_foundation'

type HouseCreationReason =
  | 'house_split' | 'wealth' | 'office' | 'prestige'
  | 'land_grant' | 'polity_grant' | 'succession' | 'peace_settlement'

type House = {
  id: HouseId
  name: string
  active: boolean
  kind?: HouseKind           // v0.16 追加。v0.31 で AnonymousHouse 廃止後は実質未使用
  memberIds: PersonId[]      // 生存中のメンバー
  deceasedMemberIds: PersonId[]  // 死亡したメンバー（家系の歴史記録）
  founderId?: PersonId       // 家の創設者
  parentHouseId?: HouseId    // 分裂元の家
  cadetHouseIds: HouseId[]   // 分裂で生まれた傍系家のリスト
  nameSource?: 'pool' | 'province' | 'founder' | 'fallback'
  legacyPrestige: number     // 0..100（家の権威・伝統の蓄積）
  wealth: number             // >= 0
  seatProvinceId: ProvinceId
  lastSplitWeek?: number     // v0.31: 直近の分家発生時の absoluteWeek（cooldown 用）
  clanId?: ClanId              // v0.32: 所属 Clan。最大 1 つ
  creationKind?: HouseCreationKind    // v0.31: 創設種別
  creationReason?: HouseCreationReason  // v0.31: 創設理由
}
```

- `seatProvinceId`: 家本拠地の中心。House が支配していない Province を指してもよい（無領家の名目本拠地を許容）
- `prestige`・`cohesion`・`loyaltyToPolity` は v0.11 で削除。セレクターで動的計算（§4.5 参照）
- **v0.12**: `headId` を削除。家長は `OfficeAssignment`（role: 'leader'）で管理。`getHouseLeader` セレクターで取得（§4.6 参照）
- **v0.15**: `polityId` フィールドを削除。House は単一 Polity に所属しない
- **v0.16**: `provinceIds` フィールドを削除。House の関与 Province は LandContract chain から selector で取得（`getHouseControlledProvinceIds` / `getHouseRelevantProvinceIds`）。House active 判定は memberIds (血統) ベース。土地ゼロでも `active=true` のまま「無領家」として存続し、お家再興を待つ
- **v0.20.3**: `memberIds` を生存中メンバーのみに限定し、`deceasedMemberIds` を追加。`markPersonDead` で memberIds → deceasedMemberIds に移動する
- **v0.31**: AnonymousHouse (`h-anon`, `kind: 'system'`) を廃止。`kind` フィールドは型上残存するが `'system'` の House は生成しない。`lastSplitWeek` / `creationKind` / `creationReason` を追加。v0.31 実動の creationReason は `house_split` / `wealth` / `office` / `prestige` / `succession`
- **v0.32**: `clanId` を追加。House は最大 1 つの Clan に所属。多重 Clan 所属は禁止。`splitHouse` で親 House の clanId を即時継承、`houseFoundingSystem`（無家人物による創設）では付与しない

### 3.4b Clan（氏族）（v0.32）

```ts
type Clan = {
  id: ClanId                   // prefix: 'cl-'
  active: boolean              // memberHouseIds のうち active normal House が 1 つ以上あれば true
  rootHouseId: HouseId         // 系譜起点。この House より前の祖先には遡らない
  nameSourceHouseId: HouseId   // 表示名の由来 House（v0.32 では rootHouseId と同値）
  memberHouseIds: HouseId[]    // 所属 House 一覧（active / inactive 両方を含む。kind === 'system' は除外）
  founderPersonId?: PersonId   // rootHouse.founderId があればそれを使用
  createdWeek: number          // 成立時の absoluteWeek
}
```

- Clan は政治主体ではない。treasury / Office / Share / LandContract / Project / Goal / Aim / DiplomaticPlay を持たない
- Clan は自律行動しない。系譜整理・宗家/分家関係の表示・血縁集団の可視化が目的
- `nameSourceHouseId` を介して House.nameKey を参照し「X 氏族」と表示する。Clan 固有の nameKey は持たない
- `memberHouseIds` は direct cadet に限定せず、rootHouseId から下方向に再帰して到達する全 descendant House を含む。extinct House も残留する
- `WorldState.clans: Record<ClanId, Clan>` / `WorldState.nextClanId: number` として保持

### 3.5 Person（人物）

```ts
export type Sex = 'male' | 'female'
export type BirthStatus = 'legitimate' | 'illegitimate' | 'unknown'

export type AbilityScores = {
  valor: number      // 個人戦闘力・身体能力・士気
  command: number    // 組織を束ねる・軍指揮の規律
  numeracy: number   // 数を扱う・計算・財務管理
  learning: number   // 知識を持つ・法・制度・歴史
  charisma: number   // 人を惹きつける・容姿・声・説得・社交
  insight: number    // 人を理解する・他者の動機・派閥力学
}

export type AbilityKey = keyof AbilityScores

type Person = {
  id: PersonId
  name: string
  sex: Sex
  age: number
  alive: boolean
  houseId?: HouseId              // v0.31: optional 化。undefined = 無家人物
  kind?: 'normal' | 'placeholder'  // 'placeholder' = ProvinceOffice 用の仮想人物 (v0.16)
  fatherId?: PersonId        // 父親（既知の場合）
  motherId?: PersonId        // 母親（既知の場合）
  spouseId?: PersonId        // 配偶者（婚姻中のみ）
  childIds: PersonId[]       // 子のリスト
  birthStatus: BirthStatus   // 嫡出・非嫡出・不明
  abilities: AbilityScores   // 現在能力 0..120（通常生成は 0..100）
  aptitudes: AbilityScores   // 才能上限 0..120（通常生成は 0..100）
  traits: {
    ambition: number  // 0.0..1.0
    caution: number   // 0.0..1.0
  }
  legacyPrestige: number    // 0..100（個人の歴史的評価の蓄積）
  wealth: number            // >= 0（個人資産。v0.12 / EstateSettlementSystem v0.14 で死亡時分配）
  attitudes: AttitudeMap    // 対 Polity / House / Person への態度（v0.11 / v0.15）
}
```

- `spouseId`: 生存中の配偶者のみを指す。配偶者が死亡した場合は `undefined` に戻る
- 親子・配偶者関係は双方向整合性が保証される（IntegrityCheck §6.24 参照）
- `prestige` / `traits.loyaltyToPolity` は v0.11 で削除。Attitude から動的計算（§4.5 参照）
- **v0.15**: `polityId` フィールドを削除。Person は単一 Polity に直接所属しない。関係 Polity は `getPersonPrimaryPolityId` / `getPersonRelevantPolityIds` で取得（§4.x 参照）
- **v0.12**: `wealth` 追加。OfficeCompensationSystem による給与受け取りで増加（§6.14b 参照）
- **v0.14**: `stats: { admin, martial }` を廃止し、6 軸の `abilities` / `aptitudes` に置換。
  - `abilities`: 現在発揮できる能力（経験で aptitude まで成長し、年齢曲線で衰退）
  - `aptitudes`: 才能上限（原則不変、遺伝で親から子へ平均回帰込みで伝わる）
  - 応用ロール（governance / stewardship / diplomacy / intrigue / warCommand）は派生 selector `getRoleScore(state, personId, role)` で計算する（§4.7 参照）
  - 死亡時、`wealth > 0` なら EstateSettlementSystem（§6.7b）が家・相続人へ分配する
- **v0.16**: `kind` を追加。`'placeholder'` は ProvinceOffice (Bailiff) 用の仮想人物で、marriage / birth / death / succession などの Person-loop からはガード経由で除外される。`kind` 未設定または `'normal'` は通常人物
- **v0.31**: `houseId` を optional 化。`houseId` が undefined の normal Person は「無家人物 (houseless person)」として扱う。placeholder は常に `houseId === undefined`。旧 `UnaffiliatedOccupation` → `PersonBackgroundOccupation` に改名。旧 AnonymousHouse (`h-anon`) は廃止され、無家人物は `state.persons` に直接追加される

### 3.6 Attitude（態度）

v0.11 追加。Person と PopGroup が持つ対エンティティへの態度を表す。

```ts
type Attitude = {
  affection: number  // -100..100（感情的な好意・嫌悪）
  respect: number    // -100..100（能力・権威への評価）
}

type AttitudeKey = string  // 形式: 'polity:{id}' | 'house:{id}' | 'person:{id}' (v0.15)

type AttitudeMap = Record<AttitudeKey, Attitude>

// v0.13: Attitude を読み書きする際の唯一の対象指定型
// v0.15: kind 'country' → 'polity' に置換
type AttitudeTarget =
  | { kind: 'person'; id: PersonId }
  | { kind: 'polity'; id: PolityId }
  | { kind: 'house'; id: HouseId }
```

- `affection`: 感情的な好意（正）または嫌悪（負）
- `respect`: 能力・権威への尊敬（正）または軽蔑（負）
- エントリが存在しない場合は `{ affection: 0, respect: 0 }` として扱う
- AttitudeDecaySystem により 4 週ごとに `attitudeMonthlyRetentionRate`（0.995）倍に減衰
- **v0.13**: tick / selectors / explain / app からの Attitude 読み書きはすべて `AttitudeTarget` を経由する。`{polity|house|person}AttitudeKey` 文字列ビルダーの直接使用は `attitudeMutations` 内部と worldgen に限定（§12 参照）
- **v0.15**: AttitudeTarget の kind `'country'` を `'polity'` に置換。`polityAttitudeKey` → `polityAttitudeKey`、key の prefix も `country:` → `polity:` に

### 3.7 Office / Share システム（v0.12 / v0.15）

**OfficeRole**: 5 種の役職。Polity と House それぞれに存在する。

```ts
type OfficeRole = 'leader' | 'administrator' | 'treasurer' | 'military' | 'advisor'
```

| role | Polity 表示名 | House 表示名 | maxHolders (Polity) | maxHolders (House) |
|------|--------------|------------|---------------------|-------------------|
| leader | Ruler | House Head | 1 | 1 |
| administrator | Chancellor | Steward | 3 | 2 |
| treasurer | Treasurer | House Treasurer | 3 | 1 |
| military | General | Guard Captain | 5 | 2 |
| advisor | Court Advisor | House Advisor | 5 | 3 |

**OrganizationRef** (v0.15: kind 'country' → 'polity'):

```ts
type OrganizationKind = 'polity' | 'house'
type OrganizationRef =
  | { kind: 'polity'; id: PolityId }
  | { kind: 'house'; id: HouseId }
```

**OfficeAssignment**: 役職の任命記録。

```ts
type OfficeAssignment = {
  id: OfficeAssignmentId
  organization: OrganizationRef
  role: OfficeRole
  holderPersonId: PersonId
  active: boolean
  startYear: number
  unpaidCount: number             // 給与未払い回数（Attitude ペナルティ計算に使用）
}
```

**OrganizationShare**: 組織内の権力持分（Share）。

```ts
type OrganizationShare = {
  id: OrganizationShareId
  organization: OrganizationRef
  holder: ShareHolderRef          // { kind: 'person' | 'house', id: ... }
  rawPower: number                // >= 0
}
```

**WorldState の追加フィールド（v0.12）**:

```ts
organizationShares: Record<OrganizationShareId, OrganizationShare>
officeAssignments: Record<OfficeAssignmentId, OfficeAssignment>
shareIndex: {
  byOrganization: Record<string, OrganizationShareId[]>  // v0.15: 'polity:{id}' / 'house:{id}'
  byHolder: Record<string, OrganizationShareId[]>
}
officeIndex: {
  byOrganization: Record<string, OfficeAssignmentId[]>
  byHolderPerson: Record<string, OfficeAssignmentId[]>
}
nextOrganizationShareId: number
nextOfficeAssignmentId: number
```

旧: `Polity.ownerHouseId` / `Polity.roleAssignments` / `House.headId` はすべて削除され、`OfficeAssignment` に統一された。
**v0.15**: `OFFICE_DEFINITIONS` のキー prefix も `country:` → `polity:` に変更。

### 3.8 LandContract / HoldingOffice（v0.16 / v0.20）

v0.16 で土地支配を Province 直接所有から **LandContract chain** に置き換えた。v0.20 で contract の対象を Province から **Holding** に変更し、各 Holding が独立した contract chain を持つ構造に移行した。

**LandContract**: ある Holding に対する 1 段の契約。chain は root → terminal の順で積み重なる。

```ts
type LandContract = {
  id: LandContractId
  provinceId: ProvinceId             // Holding.provinceId の denormalize（参照コスト軽減用）
  holdingId?: HoldingId              // v0.20: 対象 Holding
  parentContractId?: LandContractId  // parent (上位契約)
  rootAuthorityId?: RootAuthorityId  // parent と相互排他: root contract のみ rootAuthorityId
  granteePolityId: PolityId          // この契約で土地を受け取る Polity
  terms: { taxRateToGrantor: number }  // grantor への上納率。root contract は 0 固定
  termsProtectedUntilWeek?: number   // 契約保護期間の終了週。この週まで税率改定の再交渉を禁止
}
```

- `provinceId` は `holdingId → Holding.provinceId` から導出可能な冗長フィールド。Holding-Province 対応はゲーム中不変のため壊れず、多数の参照箇所で間接参照を省ける

不変条件:

1. すべての Holding は byHolding chain 上に root contract を 1 つだけ持つ
2. root contract の `taxRateToGrantor` は 0
3. chain の `granteePolityId` は active Polity
4. chain は循環しない
5. terminal contract のみ Bailiff が紐付く
6. chain 内の各段で `granteePolityId` は重複しない
7. `landContractIndex.byHolding` は chain 順 (root → terminal) を保つ
8. grantor rank < grantee rank（rank 数値が大きいほど下位）

**HoldingOfficeAssignment** (Bailiff): terminal Polity が Holding 単位で任命する代官。

```ts
type HoldingOfficeRole = 'bailiff'

type HoldingOfficeAssignment = {
  id: HoldingOfficeAssignmentId
  holdingId: HoldingId
  role: HoldingOfficeRole
  holderPersonId: PersonId            // 'placeholder' kind の Person を許容
  appointingPolityId: PolityId        // 任命主体（terminal Polity）
  active: boolean
  startWeek: number                   // absoluteWeek
  unpaidCount: number

  // v0.25 追加: 代官徴税条件
  contractedRemittanceRate: number    // 末端契約者への送金率 (default 0.40)
  expectedFeeRate: number             // 慣習的な代官取り分率 (default 0.10)

  // v0.27 追加: 代官任期保護
  termProtectedUntilWeek?: number     // この週まで通常の任期満了・交代から保護
}
```

- **v0.20**: `provinceId` → `holdingId` に変更。`startYear` を廃止し `startWeek` (absoluteWeek) に統一。term expiry は `absoluteWeek - startWeek >= termYears * WEEKS_PER_YEAR` で判定
- **v0.25**: `contractedRemittanceRate` / `expectedFeeRate` を追加。代官の徴税条件を表す。`bailiffRevenueShare` は廃止。代官報酬は `bailiffFeeRate` selector で算出する

**AnonymousHouse（v0.31 で廃止）**: 旧 `h-anon`（`kind: 'system'`）は v0.31 で完全廃止。placeholder Person は `houseId === undefined` として直接 `state.persons` に格納される。House の `memberIds` には含まれない。

**WorldState の追加フィールド（v0.16 / v0.20）**:

```ts
// v0.20: Holding / StateRegion
states: Record<StateRegionId, StateRegion>
holdings: Record<HoldingId, Holding>

// LandContract
landContracts: Record<LandContractId, LandContract>
landContractIndex: {
  byProvince: Record<ProvinceId, LandContractId[]>    // legacy: 最初の Holding の chain
  byHolding: Record<HoldingId, LandContractId[]>      // v0.20: 各 Holding 固有の chain (正規 index)
  byGranteePolity: Record<PolityId, LandContractId[]>
  byParent: Record<LandContractId, LandContractId | undefined>  // parent → child
}
holdingTerminalPolityCache: Record<HoldingId, PolityId>  // v0.20: Holding 単位の terminal cache

// HoldingOffice (v0.20: Province → Holding に移行)
holdingOfficeAssignments: Record<HoldingOfficeAssignmentId, HoldingOfficeAssignment>
holdingOfficeIndex: {
  byHolding: Record<HoldingId, HoldingOfficeAssignmentId | undefined>
  byHolderPerson: Record<PersonId, HoldingOfficeAssignmentId[]>
  byAppointingPolity: Record<PolityId, HoldingOfficeAssignmentId[]>
}

polityIndex: { byOwnerHouse: Record<HouseId, PolityId[]> }

// v0.24: POP index
popIndex: { byHolding: Record<HoldingId, PopGroupId[]> }
nextPopGroupId: number

nextLandContractId: number
nextHoldingOfficeAssignmentId: number
```

- `byProvince`: worldgen 時に最初の Holding の chain を登録する legacy index。Province 単位の参照が必要な既存コード向けに維持
- `byHolding`: 各 Holding 固有の独立した contract chain。v0.20-b2 以降の正規 index

ID prefix:

| Type | Prefix |
|---|---|
| `LandContractId` | `lc-` |
| `RootAuthorityId` | `root:` |
| `HoldingOfficeAssignmentId` | `ho-` |
| `HoldingId` | `hl-` |
| `StateRegionId` | `st-` |
| ~~`AnonymousHouse`~~ | ~~`h-anon`~~ | **v0.31 で廃止** |

#### BailiffPolicy / BailiffRevenueTaskStatus（v0.25）

```ts
// 代官方針: selector で導出。保存しない
type BailiffPolicy = 'passive' | 'loyal_remittance' | 'profit_seeking' | 'protect_residents'

// 直近 collect_holding_revenue Task の完了状態
type BailiffRevenueTaskStatus = 'completed' | 'none'
```

- `BailiffPolicy` は人物の能力・性格・現地 POP 状況から `getBailiffPolicy` selector で毎回導出する
- placeholder 代官は常に `'passive'`
- `BailiffRevenueTaskStatus` は `getRecentBailiffRevenueTaskStatus` selector で直近 4 週の ActivityLog から判定

### 3.9 外交劇システム (v0.18 / v0.26 / v0.30 更新)

#### PoliticalActorRef

外交・戦争・叛乱の主体を表す共通参照。

```ts
type PoliticalActorRef =
  | { kind: 'polity'; id: PolityId }
  | { kind: 'house'; id: HouseId }
```

v0.18 では Polity actor のみ実動。v0.22 で House actor の最小実動を導入（expand_polity_share / promote_policy_shift / patronize_artist / commission_chronicle）。

#### DiplomaticIssue（v0.30）

外交劇の不変争点 anchor。dedupe key / orphan check / cleanup / UI 表示の基準。actor 情報は `DiplomaticPlay.initiator` / `target` に一元化し、issue は対象 entity のみ保持する。

```ts
type DiplomaticIssue =
  | LandClaimIssue
  | ContractTaxRevisionIssue

type LandClaimIssue = {
  kind: 'land_claim'
  holdingId: HoldingId
  provinceId: ProvinceId
}

type TaxRevisionDirection = 'increase' | 'decrease'

type ContractTaxRevisionIssue = {
  kind: 'contract_tax_revision'
  holdingId: HoldingId
  landContractId: LandContractId
  baseTaxRateToGrantor: number
  desiredTaxRateToGrantor: number
  direction: TaxRevisionDirection
}
```

orphan check (issue-based):
- land_claim: `issue.holdingId` / `issue.provinceId` が存在しなければ cancelled
- contract_tax_revision: `issue.holdingId` / `issue.landContractId` が存在しなければ cancelled。`landContract.holdingId` が `issue.holdingId` と一致しなければ cancelled

#### DiplomaticOffer（v0.30）

外交劇において一方が提示する具体的な解決案。WorldState に top-level Record として保存し、DiplomaticPlay 内には ID のみ保持する。

```ts
type DiplomaticOfferId = Branded<string, 'DiplomaticOfferId'>  // prefix: "do-"

type DiplomaticOfferStatus =
  | 'pending'
  | 'accepted'
  | 'rejected'
  | 'withdrawn'

type DiplomaticOffer = {
  id: DiplomaticOfferId
  playId: DiplomaticPlayId
  proposedBy: PoliticalActorRef
  demands: DiplomaticDemand[]
  status: DiplomaticOfferStatus
  createdWeek: number
  reasonIds: DecisionReasonId[]
}
```

`invalid` は `DiplomaticOfferStatus` に含めない。検証結果は `OfferValidationResult` で表す。

#### DiplomaticPlay

外交劇本体。**v0.26**: Project 完了時に生成される（旧 Intent → Play 変換は廃止）。**v0.30**: offer-driven negotiation に移行（§6.27 参照）。

```ts
type DiplomaticPlayKind =
  | 'land_claim'
  | 'contract_tax_revision'
  | 'revolt_negotiation'

type ActiveDiplomaticPlayStatus = 'active' | 'escalated'
type TerminalDiplomaticPlayStatus = 'settled' | 'failed' | 'resolved_by_conflict' | 'cancelled'
```

**v0.30**: offer-driven ハイブリッドモデル — 毎 tick structural tension 微増 + offer 提出時の離散評価。settlement は accepted offer によってのみ成立する。progress は settlement 判定に使わず UI 表示値として維持。

v0.22 では DiplomaticPlay に Goal/Aim 接続フィールドを追加:

```ts
goalId?: GoalId
aimId?: AimId
originProjectId?: ProjectId  // v0.26: Project 由来の Play を追跡
```

**v0.26**: `originIntentId` を廃止し `originProjectId` を追加。
**v0.29**: DiplomaticPlay の生成を ProjectOutcomeSystem から ProjectStageSystem の `open_diplomatic_play` immediate stage に移管。Project の preparatory stage で preparation / leverage / commitment を蓄積し、DiplomaticPlay 作成時に転写する。DiplomaticPlay は Task を生成せず、Task 生成責務は ProjectTaskGenerationSystem に移管。
**v0.30**: `issue` / offer 管理フィールド追加。`counterDemand` 完全削除。`primaryDemand` は `revolt_negotiation` 専用として維持。

```ts
type DiplomaticPlay = {
  ...existing fields...
  issue?: DiplomaticIssue          // v0.30: land_claim / contract_tax_revision では必須。revolt_negotiation では省略
  primaryDemand?: DiplomaticDemand // revolt_negotiation 専用 (v0.30: 非 revolt では integrity violation)
  currentOfferId?: DiplomaticOfferId
  lastEvaluatedOfferId?: DiplomaticOfferId
  lastRejectedOfferId?: DiplomaticOfferId
  offerHistoryIds: DiplomaticOfferId[]
}
```

#### DiplomaticDemand

```ts
type DiplomaticDemand =
  | { kind: 'transfer_land_contract'; holdingId: HoldingId; toPolityId; beneficiaryActor? }
  | { kind: 'change_contract_tax_rate'; holdingId: HoldingId; landContractId; newTaxRateToGrantor }
  | { kind: 'pay_wealth'; from; to; amount }
  | { kind: 'revolt_concession'; provinceId; popClass: PopClass; concessionLevel }  // v0.24: popGroupId → popClass
  | { kind: 'status_quo' }
```

v0.30 で正式使用する組み合わせ: land_claim → transfer_land_contract + pay_wealth + status_quo、contract_tax_revision → change_contract_tax_rate + pay_wealth + status_quo。同一 offer 内で transfer_land_contract と change_contract_tax_rate を混在させない。

#### WorldState 追加 (v0.18 / v0.26 / v0.30 更新)

```ts
type WorldState = {
  ...
  diplomaticPlays: Record<DiplomaticPlayId, DiplomaticPlay>
  nextDiplomaticPlayId: number
  diplomaticOffers: Record<DiplomaticOfferId, DiplomaticOffer>  // v0.30
  nextDiplomaticOfferId: number  // v0.30
}
```

**v0.26**: `actorIntents` / `nextActorIntentId` を削除。ActorIntent 型を全廃し、Project システムに置換。

terminal status の DiplomaticPlay は tick 末の `cleanupTerminalDiplomacy` phase で state から完全削除される。関連 DiplomaticOffer も cascade delete される（v0.30）。履歴は Event ログに残す。

`resolved_by_conflict`（v0.34）: escalated な land_claim / contract_tax_revision play が WarCreationSystem で War 化されると、元 play はこの terminal status になり cleanup される（§6.27a）。

### 3.9a War（戦争）（v0.34）

`escalated` な DiplomaticPlay の即時勝敗解決を、複数 tick かけて `warScore` で進行する War entity に置換する。詳細仕様は `docs/drafts/spec-v034-update.md` 参照。型は `src/sim/types/war.ts`。

```ts
type WarId = Branded<string, 'WarId'>  // prefix: "w-"

type WarStatus = 'active' | 'attacker_won' | 'defender_won' | 'white_peace' | 'cancelled'
type WarSideKey = 'attacker' | 'defender'

type WarParticipant = {
  actor: PoliticalActorRef
  joinedWeek: number
  primary: boolean
}

type WarSide = {
  key: WarSideKey
  participants: WarParticipant[]   // v0.34 では各 side 1 件・primary=true 固定

  // v0.35 War Maneuver: いずれも soft reference（不在/死亡を許容し IntegrityCheck では検査しない）。
  //   WarManeuverSystem が毎週 lazy に選出/再構築する。詳細は §6.27b。
  captainGeneralPersonId?: PersonId  // この side の総大将。不在時 undefined（house actor war では管理しない）
  commanderPersonIds: PersonId[]     // 現場指揮官候補。先頭が当該週の戦闘指揮官
  avoidanceCount: number             // この side が戦闘回避を選んだ累積回数（単調増加・reset しない）
}

type War = {
  id: WarId
  originDiplomaticPlayId?: DiplomaticPlayId  // weak ref（元 play は cleanup 済みでも可。§14 / IntegrityCheck）
  status: WarStatus
  attacker: WarSide
  defender: WarSide
  warGoals: WarGoal[]              // v0.34 は原則 1 件
  warScore: number                // -100..100。正=attacker 優勢、負=defender 優勢
  targetWarScore: number          // 決着絶対値。warScore >= targetWarScore で attacker 勝利、<= -targetWarScore で defender 勝利
  startedWeek: number
  endedWeek?: number              // terminal 時のみ defined
}
```

WarGoal は War 作成時に実行に必要な値をすべてコピーして固定化する（元 DiplomaticPlay / Offer が cleanup 済みでも PeaceSettlement で実行できるようにするため）。

```ts
type WarGoal = TransferLandContractWarGoal | ChangeContractTaxRateWarGoal

type TransferLandContractWarGoal = {
  kind: 'transfer_land_contract'
  holdingId: HoldingId
  fromPolityId: PolityId          // PoliticalActorRef ではなく明示的 PolityId
  toPolityId: PolityId
  requiredWarScore: number
}

type ChangeContractTaxRateWarGoal = {
  kind: 'change_contract_tax_rate'
  holdingId: HoldingId
  landContractId: LandContractId
  baseTaxRateToGrantor: number    // v0.34: 開戦時に凍結する「戦争前の税率」(0..1)。歴史記述の before。
  newTaxRateToGrantor: number     // 目標税率 (after)
  requiredWarScore: number
}
```

`baseTaxRateToGrantor` は WarCreationSystem が **開戦時点の live 契約税率**（`createWarGoalFromDiplomaticPlay` で `landContracts[...].terms.taxRateToGrantor`、無ければ `issue.baseTaxRateToGrantor`）を凍結する。和平で `newTaxRateToGrantor` が適用されると現税率はこの baseline から target へ動くため、`baseTaxRateToGrantor` は live 契約税率と**意図的に乖離し得る**（WarGoal が live state に依存せず「元→新」を語れるようにするため）。integrity は 0..1 の range のみ検査し、live rate との一致は検査しない（§14.5）。

**WorldState 追加（v0.34）**:

```ts
type WorldState = {
  ...
  wars: Record<WarId, War>
  warIndex: {
    byParticipant: Record<string, WarId[]>   // key = `${ref.kind}:${ref.id}`（例 "polity:p-1"）
    byOriginDiplomaticPlay: Record<DiplomaticPlayId, WarId | undefined>
  }
  nextWarId: number
}
```

terminal War は即削除せず一定期間（`terminalWarRetentionWeeks`）保持し、`cleanupWarSystem` が retention 超過後に削除する（履歴は Event ログに残る。§6.28b）。`politicalActorKey(ref): string` helper（`` `${ref.kind}:${ref.id}` `` を返す）を warIndex / IntegrityCheck で共用する。

**v0.35 War Maneuver の型（`src/sim/types/war.ts`）**:

```ts
// 想定戦場の地形種別。Province.terrain を基本に features で特殊化する（§6.27b / generateCandidateBattlefield）。
type BattlefieldKind =
  | 'open_field' | 'forest_battle' | 'hill_battle' | 'mountain_pass'
  | 'wetland_battle' | 'river_crossing' | 'coastal_battle'
  | 'siege'   // 型のみ用意し v0.35 では生成しない（要塞・包囲が未実装のため将来用に予約）

type BattleResult = 'attacker_victory' | 'defender_victory' | 'inconclusive'

// BATTLE_OCCURRED event に記録。戦闘がどう発生したか。
type BattleInitiationKind = 'mutual_engagement' | 'attacker_avoidance_failed' | 'defender_avoidance_failed'
```

`BattlefieldKind` は state には永続化せず、WarManeuverSystem が毎週その場で生成して battle 解決と event に使う一過性の値（terrain/features は Province 側に永続）。これら maneuver 用の値は War entity に蓄積しない（warScore と avoidanceCount のみが state に残る）。

### 3.9b Regiment（連隊）（v0.36）

これまで `getActorMilitaryPower` で抽象的に算出していた軍事力を、平時から state 上に存在する**永続 Regiment entity**（軍事動員単位）として表現する。worldgen で **1 Holding = 1 Regiment** を生成し（§7）、WarManeuverSystem の battle power 入力に用いる（§6.27b）。型は `src/sim/types/regiment.ts`、power 計算は `src/sim/selectors/regimentSelectors.ts`。

```ts
type RegimentId = Branded<string, 'RegimentId'>  // prefix: "rg-"

type RegimentStatus = 'active' | 'disbanded' | 'destroyed'
//   disbanded: owner/home 失効で解散。destroyed: 戦闘損耗で壊滅。
//   どちらの非 active record も records / regimentIndex.byOwner には残す
//   （case(c) の「record 在り → 0 power, fallback しない」判定に必要）。byWar からは外す。

type RegimentSourceKind = 'levy' | 'urban_militia' | 'noble_retinue' | 'mercenary'  // mercenary は型予約のみ
type RegimentTroopKind = 'infantry' | 'cavalry'

type Regiment = {
  id: RegimentId
  owner: PoliticalActorRef            // 編制権を持つ主体。worldgen では homeHolding の terminal Polity
  mobilizedByPolityId?: PolityId      // 現在この Regiment を戦争動員している Polity
  status: RegimentStatus
  sourceKind: RegimentSourceKind
  troopKind: RegimentTroopKind
  homeHoldingId?: HoldingId           // 由来 Holding / Province（v0.36 では原則すべて持つ）
  homeProvinceId?: ProvinceId
  currentWarId?: WarId                // 動員先の soft reference（IntegrityCheck で hard invariant にしない）
  currentSide?: WarSideKey
  strength: number                    // 兵員・装備・馬匹・従者の充足率 0..100。v0.36 通常戦闘では大きく削らない
  organization: number                // 部隊統制 0..100。battle 後に主に削れる値
  morale: number                      // 士気 0..100。v0.36 は write-once placeholder（recovery が補正で読むのみ）
  maxStrength: number                 // 原則 100
  basePower: number                   // 全快時の基礎戦闘力。worldgen 時点で凍結（§7）
  createdWeek: number
  lastMobilizedWeek?: number
}
```

**有効戦力**（`getRegimentEffectivePower`）= `basePower × (strength/100) × (0.5 + 0.5 × organization/100)`。非 active は 0。

**WorldState 追加（v0.36）**:

```ts
type WorldState = {
  ...
  regiments: Record<RegimentId, Regiment>
  regimentIndex: {
    byOwner: Record<string, RegimentId[]>          // key = politicalActorKey（"polity:p-1"）
    byWar: Record<WarId, RegimentId[]>             // 動員中のみ。demobilize / destroy で外す
    byHomeProvince: Record<ProvinceId, RegimentId[]>
    byHomeHolding: Record<HoldingId, RegimentId[]>
  }
  nextRegimentId: number
}
```

戦争 side の power は `getRegimentPowerForWarSide(state, config, war, side)` が算出する（§6.27b の battle 入力）:
(a) 動員中 active Regiment があればその有効戦力の合計、
(b) 無く且つ primary participant が Regiment を 1 つも所有しない（byOwner 空。house actor 等）なら旧 `getActorMilitaryPower` に fallback、
(c) byOwner 非空だが動員可能な active が無いなら 0（fallback しない）。

### 3.9c Battle（戦闘）（v0.36）

WarManeuverSystem が 1 戦闘を解決するたびに記録する**短期 entity**。battle 内部 tick / frontline simulation はまだ行わず（v0.37 以降）、War detail / recent history 表示用に位置づける。`cleanupWarSystem` の terminal War 削除に piggyback して cleanup する（履歴は Event ログに残る。永続 record ではない。§6.28b）。型は `src/sim/types/battle.ts`。

```ts
type BattleId = Branded<string, 'BattleId'>  // prefix: "bt-"

type BattleRegimentResult = {                // 1 Battle における 1 Regiment の損耗記録
  regimentId: RegimentId
  side: WarSideKey
  strengthBefore: number; strengthAfter: number; strengthDamage: number
  organizationBefore: number; organizationAfter: number; organizationDamage: number
  moraleBefore?: number; moraleAfter?: number; moraleDamage?: number  // v0.36 では設定しない
}

type Battle = {
  id: BattleId
  warId: WarId
  week: number
  provinceId: ProvinceId
  holdingId?: HoldingId
  battlefieldKind: BattlefieldKind
  initiationKind: BattleInitiationKind
  result: BattleResult
  attackerRegimentIds: RegimentId[]          // 当該戦闘に動員されていた active Regiment
  defenderRegimentIds: RegimentId[]
  regimentResults: BattleRegimentResult[]
  attackerBasePower: number                  // = getRegimentPowerForWarSide（commander 補正前）
  defenderBasePower: number
  attackerEffectivePower: number             // commander / 総大将補正後（resolveBattle）
  defenderEffectivePower: number
  warScoreDelta: number
  warScoreAfter: number
  // outcomeQuality? / frontage? / tickUnit? / *RoutedRegimentIds? / *CommanderAssignments? 等は
  //   v0.37 以降用の器（v0.36 では未設定）。
}
```

**WorldState 追加（v0.36）**:

```ts
type WorldState = {
  ...
  battles: Record<BattleId, Battle>
  battleIndex: { byWar: Record<WarId, BattleId[]> }
  nextBattleId: number
}
```

### 3.10 目標システム (v0.22 / v0.23 拡張)

Polity / House / Person が長期目標 Goal → 中期計画 Aim → 短期意図 Intent / Task の階層で一貫した行動を取る。詳細仕様は `docs/drafts/spec-v022-update.md` / `docs/drafts/spec-v023-update.md` 参照。

#### Goal

```ts
type GoalStatus = 'active' | 'succeeded' | 'failed' | 'abandoned'
type PolityGoalKind = 'external_expansion' | 'internal_development'
type HouseGoalKind = 'expand_power_base' | 'preserve_power_base' | 'cultivate_prestige'
// v0.23 追加
type PersonGoalKind = 'house_loyalty' | 'public_service' | 'personal_advancement' | 'wealth_building' | 'self_cultivation'
type GoalKind = PolityGoalKind | HouseGoalKind | PersonGoalKind

type Goal = {
  id: GoalId
  owner: DecisionSubjectRef  // { kind: 'polity' | 'house' | 'person'; id }
  kind: GoalKind
  priority: number
  progress: number        // 0..targetProgress（Person Goal では baseFulfillment として 0..100 にクランプ）
  targetProgress: number  // 原則 100
  createdWeek: number
  minimumUntilWeek: number
  lastReviewWeek: number
  nextReviewWeek: number
  status: GoalStatus
  reasonIds: DecisionReasonId[]
}
```

各 Polity / House / Person は active Goal を原則 1 つだけ持つ。Aim の成功で progress +25、失敗で -10、abandon で -5。progress が targetProgress に達すると succeeded（ただし Person Goal は succeeded にならず、fulfillment として 0..100 で維持）。

#### Aim

```ts
type AimStatus = 'active' | 'succeeded' | 'failed' | 'abandoned'
type AimOrigin = 'goal_driven' | 'pressure_response'
type PolityAimKind = 'consolidate_province_holdings' | 'seize_weak_remote_holdings' | 'develop_owned_holding' | 'improve_owned_contract_terms' | 'eliminate_overlord_contract' | 'eliminate_vassal_contract'
type HouseAimKind = 'increase_polity_share' | 'steer_polity_external_expansion' | 'steer_polity_internal_development' | 'patronize_artist' | 'commission_chronicle'
// v0.23 追加
type PersonAimKind = 'support_organization_aim' | 'increase_house_influence' | 'obtain_office' | 'retain_office' | 'accumulate_wealth' | 'improve_ability'
type AimKind = PolityAimKind | HouseAimKind | PersonAimKind

type Aim = {
  id: AimId
  owner: DecisionSubjectRef
  goalId?: GoalId
  pressureId?: PressureId
  origin: AimOrigin
  kind: AimKind
  target?: EntityRef
  priority: number
  progress: number
  targetProgress: number    // v0.26: 標準値を 1 → 100 に変更
  createdWeek: number
  deadlineWeek: number
  lastProjectPreparedWeek?: number   // v0.26: 旧 lastIntentGeneratedWeek を置換
  nextProjectAllowedWeek?: number    // v0.26: 旧 nextIntentAllowedWeek を置換
  activeDiplomaticPlayId?: DiplomaticPlayId
  // v0.23 追加
  activeTaskId?: TaskId
  waitingFor?: TaskTargetRef
  waitingReasonKey?: string
  blockedReasonKey?: string
  nextReviewWeek?: number
  successfulProjectCount: number     // v0.26: 旧 successfulIntentCount を置換
  failedProjectCount: number         // v0.26: 旧 failedIntentCount を置換
  status: AimStatus
  reasonIds: DecisionReasonId[]
}
```

Aim は中期計画。期限と成功条件を持つ。Person Aim は Task で直接進行し、Polity / House Aim は Project / DiplomaticPlay 経由で進行する。activeTaskId / activeDiplomaticPlayId は同時に最大 1 つのみセット。

**v0.26**: `activeIntentId` / `lastIntentGeneratedWeek` / `nextIntentAllowedWeek` / `successfulIntentCount` / `failedIntentCount` を削除し、Project 系フィールドに置換。`targetProgress` を 1 → 100 に変更（複数 Project 完了で Aim succeeded）。`activeProjectId` は追加しない（`projectIndex.byAim` で検索可能なため）。

#### DecisionReason

Goal / Aim の生成理由を UI で説明するための記録。

```ts
type DecisionReason = {
  id: DecisionReasonId
  owner: DecisionSubjectRef
  summaryKey: string       // i18n 翻訳キー
  params?: Record<string, string | number>
  weight: number
  createdWeek: number
}
```

#### WorldState 追加 (v0.22)

```ts
type WorldState = {
  ...
  goals: Record<GoalId, Goal>
  aims: Record<AimId, Aim>
  decisionReasons: Record<DecisionReasonId, DecisionReason>
  goalIndex: { byOwner: Record<string, GoalId[]> }
  aimIndex: { byOwner: Record<string, AimId[]>; byGoal: Record<GoalId, AimId[]> }
  nextGoalId: number
  nextAimId: number
  nextDecisionReasonId: number
}
```

terminal Goal / Aim は tick 末の `cleanupTerminalDecisions` phase で state から完全削除される。

### 3.11 Task / ActivityLog システム (v0.23 / v0.26 更新 / v0.26.1 outcome 判定)

#### Task

Task は特定の人物が週単位で処理する具体的な仕事。ephemeral であり、active Task のみ state に保持する。

```ts
type TaskStatus = 'active' | 'succeeded' | 'failed' | 'cancelled'
type TaskOutcomeKind = 'success' | 'failure' | 'partial'

type TaskKind =
  | 'support_organization_plan' | 'promote_house_influence' | 'perform_office_duties'
  | 'seek_office_support' | 'display_competence' | 'defend_office_position'
  | 'manage_accounts' | 'seek_profitable_assignment'
  | 'study_law' | 'study_accounts' | 'practice_arms' | 'courtly_training'
  | 'prepare_project' | 'advance_project'            // v0.26: prepare_intent を廃止し追加
  | 'secure_internal_support'
  | 'arrange_patronage' | 'commission_chronicle_work'
  | 'prepare_argument' | 'gather_claim_evidence' | 'negotiate_terms'
  | 'pressure_counterparty' | 'offer_compromise' | 'undermine_counterparty_position'
  | 'collect_holding_revenue'  // v0.25: 代官月次徴税業務

type TaskTargetRef =
  | { kind: 'aim'; id: AimId }
  | { kind: 'project'; id: ProjectId }                // v0.26: intent を廃止し追加
  | { kind: 'diplomatic_play'; id: DiplomaticPlayId }
  | { kind: 'holding_office_assignment'; id: HoldingOfficeAssignmentId }  // v0.25

type Task = {
  id: TaskId
  owner: DecisionSubjectRef
  assigneePersonId: PersonId
  kind: TaskKind
  targetRef: TaskTargetRef
  priority: number
  actionCost: number
  effortRequired: number
  effortDone: number
  createdWeek: number
  deadlineWeek?: number
  status: TaskStatus
  reasonIds: DecisionReasonId[]
  difficulty: number          // v0.26.1: 0〜100。outcome 判定の難易度
  relevantAbility: AbilityKey // v0.26.1: outcome 判定に使う能力
}
```

完了・失敗・キャンセルされた Task は ActivityLog 作成後に state.tasks から削除。ID は再利用しない。

#### PersonActivityLog（v0.27 discriminated union 化）

Task / Project の完了・失敗時に作成される軽量な行動記録。v0.27 で TaskActivityLog と ProjectActivityLog の discriminated union に変更。

```ts
type PersonActivityKind =
  | 'task_completed' | 'task_failed' | 'task_cancelled' | 'task_expired'
  | 'project_completed' | 'project_failed'  // v0.27 追加

type TaskActivityLog = {
  id: PersonActivityLogId
  personId: PersonId
  week: number
  kind: 'task_completed' | 'task_failed' | 'task_cancelled' | 'task_expired'
  outcome: TaskOutcomeKind
  taskKind: TaskKind
  sourceRef?: TaskTargetRef
  relatedRefs: EntityRef[]
  summaryKey: string
  params?: Record<string, string | number>
  importance: number
}

type ProjectActivityLog = {
  id: PersonActivityLogId
  personId: PersonId
  week: number
  kind: 'project_completed' | 'project_failed'
  projectKind: ProjectKind
  sourceRef: { kind: 'project'; id: ProjectId }
  relatedRefs: EntityRef[]
  summaryKey: string
  params?: Record<string, string | number>
  importance: number
}

type PersonActivityLog = TaskActivityLog | ProjectActivityLog
```

判別は `'outcome' in log` で行う（TaskActivityLog のみ `outcome` フィールドを持つ）。

person ごとに最新 `maxActivityLogsPerPerson` 件（デフォルト 30）まで保持。超過時は importance が最も低い古い log から削除。

#### DiplomaticPlay 拡張 (v0.23)

DiplomaticPlay に delegate と交渉パラメータを追加。

```ts
type DiplomaticPlay = {
  ...existing fields...
  // v0.23 追加
  initiatorDelegatePersonId?: PersonId
  targetDelegatePersonId?: PersonId
  initiatorPreparation: number   // 0..100
  initiatorLeverage: number      // 0..100
  initiatorCommitment: number    // 0..100
  targetPreparation: number
  targetLeverage: number
  targetCommitment: number
  initiatorActiveTaskIds: TaskId[]
  targetActiveTaskIds: TaskId[]
}
```

#### WorldState 追加 (v0.23)

```ts
type WorldState = {
  ...
  // Task
  tasks: Record<TaskId, Task>
  taskIndex: {
    byAssignee: Record<PersonId, TaskId[]>
    byOwner: Record<string, TaskId[]>
    byTarget: Record<string, TaskId[]>
  }
  waitingAimIds: WaitingAimIndex
  nextTaskId: number

  // ActivityLog
  personActivityLogs: Record<PersonActivityLogId, PersonActivityLog>
  personActivityLogIndex: {
    byPerson: Record<PersonId, PersonActivityLogId[]>
  }
  nextPersonActivityLogId: number

  // 能力訓練経験
  personTrainingExperience: Record<PersonId, Partial<Record<AbilityKey, number>>>
}
```

ID prefix:

| Type | Prefix |
|---|---|
| `GoalId` | `go-` |
| `AimId` | `am-` |
| `DecisionReasonId` | `dr-` |
| `TaskId` | `t-` |
| `PersonActivityLogId` | `pal-` |
| `ProjectId` | `pr-` |
| `PressureId` | `ps-` |
| `DiplomaticOfferId` | `do-` |

### 3.12 Project システム (v0.26)

#### Project

Project は「誰かが作成し、誰かが遂行する具体的案件」。Aim を具体化した行動単位であり、Task によって進行する。completed / failed / cancelled の terminal Project は ProjectOutcomeSystem で効果解決後に state から削除される。

```ts
type ProjectStatus = 'active' | 'completed' | 'failed' | 'cancelled'

type ProjectOrigin =
  | { kind: 'aim'; aimId: AimId }
  | { kind: 'system'; reasonKey: string }

type ProjectKind =
  | 'develop_holding'
  | 'expand_polity_share'
  | 'promote_policy_shift'
  | 'patronize_artist'
  | 'commission_chronicle'
  | 'acquire_land'
  | 'sell_land'
  | 'improve_contract_terms'
  | 'demand_tax_increase'
  | 'respond_to_pressure'      // v0.29

type BaseProject = {
  id: ProjectId
  owner: DecisionSubjectRef
  origin: ProjectOrigin
  kind: ProjectKind
  creatorPersonId: PersonId
  supervisorPersonId: PersonId
  parentProjectId?: ProjectId
  status: ProjectStatus
  progress: number
  targetProgress: number      // default 100
  currentStageKey: ProjectStageKey   // v0.29: 全 Project に必須
  stageAttemptCount?: number         // v0.29: preparatory stage のリトライ管理
  createdWeek: number
  deadlineWeek?: number
  reasonIds: DecisionReasonId[]
}
```

8 つの派生型 union で構成:
- `DevelopHoldingProject`: holdingId / improvementKind / targetImprovementLevel / budget (ProjectBudget) — v0.27 で Budget 導入
- `ExpandPolityShareProject`: polityId / houseId / budget / spentBudget
- `PromotePolicyShiftProject`: polityId / houseId / policyKey
- `PatronizeArtistProject`: houseId / budget / spentBudget / artistPersonId
- `CommissionChronicleProject`: houseId / budget / spentBudget / subjectRef
- `LandClaimProject` (acquire_land / sell_land): holdingId / provinceId / counterpartyPolityId / diplomaticPlayId / preparation / leverage / commitment — v0.29 で diplomaticPlayId 追加
- `ContractRevisionProject` (improve_contract_terms / demand_tax_increase): holdingId / landContractId / counterpartyPolityId / desiredTaxRateToGrantor / diplomaticPlayId / preparation / leverage / commitment — v0.29 で diplomaticPlayId 追加
- `RespondToPressureProject` (v0.29): pressureId / diplomaticPlayId / stance

#### ProjectStage 一般化（v0.29）

v0.29 で全 Project に `currentStageKey` を一般化。`ProjectStageKey` は string 型とし、各 ProjectKind ごとに有効な stage sequence を定義する。

```ts
type ProjectStageKey = string

type ProjectStageType = 'immediate' | 'preparatory' | 'final'

type ProjectStageEntry = {
  key: ProjectStageKey
  type: ProjectStageType
}
```

**stage sequence**:

| ProjectKind | stages |
|---|---|
| develop_holding | find_supervisor (imm) → secure_budget (imm) → execute_project (final) |
| expand_polity_share | execute_project (final) |
| promote_policy_shift | execute_project (final) |
| patronize_artist | arrange_patronage (final) |
| commission_chronicle | write_chronicle (final) |
| acquire_land | prepare_claim (prep) → open_diplomatic_play (imm) → negotiate (final) |
| sell_land | prepare_offer (prep) → open_diplomatic_play (imm) → negotiate (final) |
| improve_contract_terms | prepare_argument (prep) → open_diplomatic_play (imm) → negotiate (final) |
| demand_tax_increase | prepare_argument (prep) → open_diplomatic_play (imm) → negotiate (final) |
| respond_to_pressure | choose_stance (imm) → propose_initial_offer (imm, v0.30) → prepare_response (prep) → negotiate (final) |

- `immediate`: ProjectStageSystem が即時解決。Task を生成しない
- `preparatory`: Task を生成。success → 次 stage 遷移、partial → 同 stage 継続、failure → stageAttemptCount increment → 上限超過で Project failed
- `final`: Task を生成。Project.progress を蓄積し、targetProgress 到達で completed

#### DevelopHoldingProject（v0.27 Budget 導入）

```ts
type ProjectBudgetSource = { kind: 'owner' }

type ProjectBudget = {
  required: number
  allocated: number
  remaining: number
  spent: number
  source: ProjectBudgetSource
}

type DevelopHoldingProject = BaseProject & {
  kind: 'develop_holding'
  holdingId: HoldingId
  improvementKind: HoldingImprovementKind
  targetImprovementLevel: number
  budget: ProjectBudget
}
```

- stage sequence: find_supervisor (imm) → secure_budget (imm) → execute_project (final)
- `budget`: 事前確保方式。secure_budget stage で owner から確保し、advance_project Task で消費
- find_supervisor / secure_budget は即時解決（Task を発行しない）。execute_project でのみ advance_project Task を生成
- 同一 Holding に active develop_holding Project は 1 つまで
- deadline は execute_project stage のみに適用（§6.25d 参照）

#### RespondToPressureProject（v0.29）

```ts
type PressureResponseStance = 'resist' | 'negotiate' | 'concede'

type RespondToPressureProject = BaseProject & {
  kind: 'respond_to_pressure'
  pressureId: PressureId
  diplomaticPlayId?: DiplomaticPlayId
  stance?: PressureResponseStance
}
```

- PressureSystem が active Pressure に対して自動生成する（Aim / prepare_project を経由しない）
- `stance`: choose_stance immediate stage で軍事力比較により決定（concede / negotiate / resist）
- negotiate stage では stance に応じた Task 種別優先度調整を行う

#### WorldState 追加 (v0.26)

```ts
type WorldState = {
  ...
  projects: Record<ProjectId, Project>
  projectIndex: {
    byOwner: Record<string, ProjectId[]>
    byAim: Record<AimId, ProjectId[]>
    byParentProject: Record<ProjectId, ProjectId[]>
    byCreatorPerson: Record<PersonId, ProjectId[]>
    bySupervisorPerson: Record<PersonId, ProjectId[]>
    byRelatedEntity: Record<string, ProjectId[]>
  }
  nextProjectId: number
}
```

### 3.13 Pressure システム (v0.29)

外交劇を仕掛けられた側が自然に対応行動を取るための外圧エンティティ。

#### Pressure

```ts
type PressureKind = 'diplomatic_land_claim' | 'diplomatic_contract_revision'
type PressureStatus = 'active' | 'responded' | 'resolved' | 'cancelled'

type Pressure = {
  id: PressureId
  kind: PressureKind
  source: DecisionSubjectRef
  target: DecisionSubjectRef
  relatedDiplomaticPlayId?: DiplomaticPlayId
  relatedProjectId?: ProjectId
  responseProjectId?: ProjectId
  priority: number
  createdWeek: number
  deadlineWeek?: number
  status: PressureStatus
  reasonIds: DecisionReasonId[]
}

type PressureIndex = {
  byTarget: Record<string, PressureId[]>
  bySource: Record<string, PressureId[]>
  byDiplomaticPlay: Record<DiplomaticPlayId, PressureId[]>
  byProject: Record<ProjectId, PressureId[]>
}
```

- 外交系 Project の `open_diplomatic_play` stage で DiplomaticPlay 作成と同時に生成
- `source`: DiplomaticPlay.initiator と同一
- `target`: DiplomaticPlay.target と同一
- `responseProjectId`: PressureSystem が生成した respond_to_pressure Project の ID
- Pressure status 遷移: active → responded (response Project completed) → resolved/cancelled (DiplomaticPlay terminal)
- DiplomaticPlay 削除時に Pressure も同時削除（cleanupTerminalDiplomacy）。履歴は Event に残す

#### WorldState 追加 (v0.29)

```ts
type WorldState = {
  ...
  pressures: Record<PressureId, Pressure>
  pressureIndex: PressureIndex
  nextPressureId: number
}
```

#### WorldState 追加 (v0.31.1)

```ts
type WorldState = {
  ...
  livingPersonIds: PersonId[]  // alive person のソート済みインデックス
}
```

- `livingPersonIds` は `state.persons` の alive person の ID をアルファベット順でソートした配列
- person 走査を行う全 tick system・selector がこの配列を使用し、dead person の走査を回避する
- `markPersonDead` で除去、`birthChild` / `addHouselessPerson` / `houseFoundingSystem` の person 生成時に追加される
- `integritySystem` は dead person も検査対象のため `Object.keys(state.persons)` を引き続き使用する
- `integritySystem` に `livingPersonIds` ↔ `state.persons` の整合性チェックを追加済み

---

