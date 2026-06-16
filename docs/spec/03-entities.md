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
  terrain: ProvinceTerrain      // 自然地形（5 種・単一）
  features: ProvinceFeature[]   // 地理特徴（複数可・順不同）
  holdingIds: HoldingId[]
}

type ProvinceTerrain = 'plains' | 'forest' | 'hills' | 'mountains' | 'wetlands'
type ProvinceFeature = 'coastal' | 'major_river' | 'lake'
```

- `stateId`: 所属する StateRegion
- `nameKey`: ロケール中立の名前識別子。表示文字列への解決は `app/` / `i18n/` の責務（`sim/` 層規約）
- `holdingIds`: この Province に属する Holding の一覧。各 Holding が development / polityControl を持つ
- baseTax / manpower / unrest フィールドは持たず、これらは POP から selector で算出する
- Province は polityId / ownerHouseId / houseControl を持たない。土地支配は §3.8 LandContract chain で表現する。Province の terminal owner は selector (`getProvinceTerminalPolityId` / `getProvinceEffectiveOwnerHouseId`) で取得する
- development / polityControl は Province ではなく Holding が持つ。Province レベルの値は selector (`getProvinceDevelopmentFromHoldings` / `getProvincePolityControlFromHoldings`) で Holding の weight 加重平均から算出する
- 自然地形 `terrain`（5 種・単一）と地理特徴 `features`（3 種・複数可）を持つ。terrain は House seat 選定（`provinceTerrainSettlementSuitability`、§7.4）と Holding Improvement の建設可否・capacity multiplier（§3.1d / §4.2）に消費される。features は Improvement の建設可否（例: 灌漑は `major_river` / `lake` が必要）と capacity multiplier に効く。worldgen 時に確定しゲーム中は不変（§7.1）

### 3.1a ProvinceTerrain / ProvinceFeature

| Terrain | 意味 | | Feature | 意味 |
|---|---|---|---|---|
| `plains` | 農業・都市形成に向く平坦地 | | `coastal` | 海沿い |
| `forest` | 森林地帯 | | `major_river` | 大河・重要河川を有する |
| `hills` | 丘陵地帯 | | `lake` | 湖・大きな内水面を有する |
| `mountains` | 山岳地帯 | | | |
| `wetlands` | 沼沢地・湿地 | | | |

- 海岸・大河・湖は terrain ではなく別軸の feature として扱い、`coastal mountains` / `river forest` のような複合表現を可能にする
- 将来候補（未導入）: terrain に `steppe` / `desert` / `tundra`。`ruggedness` / `forestDensity` / `fertility` のような追加自然パラメータは使い先が明確になるまで入れない

### 3.1b StateRegion

```ts
type StateRegion = {
  id: StateRegionId
  nameKey: string
  provinceIds: ProvinceId[]
  centerX: number
  centerY: number
}
```

- Province をまとめる上位地理単位。UI 上の地図表示、集計に使用
- 土地所有・契約・収入の単位ではない（それらは Holding が担う）
- `nameKey`: ロケール中立の名前識別子。表示文字列への解決は `app/` / `i18n/` の責務（`sim/` 層規約、§3.1 と同じ）
- `centerX` / `centerY`: worldgen で Poisson disk sampling により配置された State の地理的中心座標
- State 間隣接は保存せず、selector (`getStateNeighborIds`) で Province.neighbors から動的に算出
- State 境界ポリゴンは WorldState に保存しない。UI 側で Province の Voronoi セルから動的に算出

### 3.1c Holding

```ts
type HoldingKind = 'manor' | 'city'

type Holding = {
  id: HoldingId
  provinceId: ProvinceId
  nameKey: string         // required。ロケール中立の名前識別子（manor=province / city=city category で解決）
  kind: HoldingKind
  polityControl: number   // 0..100
  landQuality: number     // > 0
  weight: number          // > 0
  lastRevoltSuppressedWeek?: number  // この Holding の叛乱を最後に鎮圧した absoluteWeek（cooldown 入力）
  lastRevoltSettledWeek?: number     // この Holding の叛乱を最後に和解・決着させた absoluteWeek（cooldown 入力）
}
```

- Province 内の個別土地区画。土地契約・実効支配・開発度・収入分配・代官任命の単位
- `nameKey`: ロケール中立の名前識別子（required）。manor は `province` category、city は `city` category で解決する（Holding 専用 category は使わない）。worldgen で命名し、同一 Province 内で一意（Province 名・他 Province の Holding 名との衝突は許容）。表示文字列への解決は `app/` / `i18n/` の責務（`sim/` 層規約）
- `kind`: manor (農村荘園) / city (都市)。収入分配で city は kindMultiplier = 1.3
- `polityControl`: terminal Polity の実効支配力。ControlSystem が Holding 単位で更新
- `landQuality`: 土地の基礎品質。収入分配の share weight に影響
- `weight`: Holding の相対的な重み。収入分配・Province 集計の加重に使用
- `lastRevoltSuppressedWeek` / `lastRevoltSettledWeek`: この Holding 上で叛乱が最後に鎮圧／和解・決着した週。provinceRevoltSystem / taxRevisionSystem が叛乱再発・税率改定の cooldown 入力として参照する
- Holding-Province 対応はゲーム中不変（ゲーム中の Holding 追加・削除はない）
- development フィールドは持たず、development は HoldingImprovement から `getHoldingDevelopment` selector で算出する（§4.1 / §3.1d 参照）

### 3.1d HoldingImprovement

```ts
type HoldingImprovementId = string  // prefix: "hi-"

type HoldingImprovementKind =
  | 'storage_infrastructure'
  | 'transport_infrastructure'
  | 'field_system'
  | 'pastoral_infrastructure'
  | 'irrigation_infrastructure'
  | 'market_infrastructure'
  | 'workshop_infrastructure'

type HoldingImprovement = {
  id: HoldingImprovementId
  holdingId: HoldingId
  kind: HoldingImprovementKind
  level: number        // >= 1
  condition: number    // 0..100（現状は常に 100）
  createdWeek: number
}
```

- Holding に付随する施設。同一 Holding / kind の Improvement は 1 件のみ
- `level`: 施設の等級。kind × Holding kind ごとに max level が異なる（§9 config）
- `condition`: 老朽化・破壊は future。現状は常に 100 で capacity / production のいずれにも影響しない（将来の荒廃・修復システム用に温存）
- development は各 Improvement の level × scorePerLevel の合計として `getHoldingDevelopment` selector で算出（§4.1 参照）

kind ごとの構造メタデータ（建設可能 HoldingKind / terrain / 必須 feature / capacityRole / 対象 occupation）は `sim/config/improvementDefinitions.ts` の `IMPROVEMENT_DEFINITIONS` const に一元化し、数値バランスは `SimulationConfig` に分離する（§9）。

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
- 後回し（未導入）: forestry / mining / quarrying / harbor / fortification / orchard / vineyard / mill。資源・商品・交易・戦争システム導入時に再検討する

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

config は `holdingImprovementMaxLevelByKind: Record<ImprovementKind, Partial<Record<HoldingKind, number>>>`。`undefined` / `0` はどちらも建設不可（§9 / §4.2 canBuild）。

**WorldState 追加**:

```ts
holdingImprovements: Record<HoldingImprovementId, HoldingImprovement>
holdingImprovementIndex: {
  byHolding: Record<HoldingId, HoldingImprovementId[]>
}
nextHoldingImprovementId: number
```

### 3.2 PopClass / PopOccupation / PopGroup（民衆集団）

```ts
type PopClass = 'peasants' | 'townsmen' | 'nobles'

type PopOccupation = 'agriculture' | 'urban_labor' | 'elite_service' | 'none'

type PopGroup = {
  id: PopGroupId
  holdingId: HoldingId       // 所属 Holding
  class: PopClass
  occupation: PopOccupation
  size: number       // 抽象人口規模（実人数ではない）
  wealth: number     // 0..100（豊かさ指数。金額ではない）
  unrest: number     // 0..100
  attitudes: AttitudeMap  // 対 Polity などへの態度
}
```

| class | 意味 | 主な役割 | 標準 occupation |
|-------|------|----------|----------------|
| peasants | 農民・村落民 | 人口・基礎生産・兵力の中心 | agriculture |
| townsmen | 都市民・商工民 | 税収・富・都市的発展 | urban_labor |
| nobles | 在地貴族・有力者 | 兵力・家支配・貴族的不満 | elite_service |

PopGroup の構造:
- PopGroup は Province ではなく **Holding** に所属する
- `occupation` により職業状態を表現する。`none` は職業枠からあぶれた POP（失業者・土地なし・扶持なし）
- `occupation !== 'none'` の POP は `minPopSizeByClass` で下限保証。`none` POP は size が `popSizeEpsilon` 以下で削除される
- 同一 merge key (`holdingId + class + occupation`) の POP は原則 1 つに統合される
- Province 単位の POP は Holding POP から selector で集計する（§4.2 参照）
- Province は popGroupIds を持たない。POP の参照は `popIndex.byHolding` 経由

Province の unrest は POP unrest の人口加重平均として selector で算出する（§4 参照）。

### 3.3 Polity（政治主体）

```ts
type PolityRank = 1 | 2 | 3 | 4 | 5
type PolityKind = 'normal' | 'commonwealth'

type PolityOrigin =
  | { kind: 'worldgen' }
  | {
      kind: 'popular_revolt'
      originalPolityId: PolityId
      provinceId: ProvinceId
      holdingIds: HoldingId[]
      popClass: PopClass
      leaderPersonId: PersonId
      startedWeek: number
    }
  | {
      kind: 'regime_changed_by_popular_revolt'
      previousOwnerHouseId?: HouseId
      provinceId: ProvinceId
      holdingId: HoldingId
      popClass: PopClass
      leaderPersonId: PersonId
      week: number
    }

type PopularRevoltState =
  | { kind: 'negotiating'; diplomaticPlayId: DiplomaticPlayId }
  | { kind: 'revolting'; warId?: WarId; revoltSeizureContractIds: LandContractId[] }
  | { kind: 'established' }

// Polity の名前情報。pool 由来は自前の nameKey、holding 由来は対象 Holding の名前を借りる
// （解決 category は Holding.kind で決まる: manor=province / city=city）
type PolityNameSource =
  | { kind: 'pool'; nameKey: string }
  | { kind: 'holding'; holdingId: HoldingId }

type Polity = {
  id: PolityId
  nameSource: PolityNameSource  // nameKey は廃止し nameSource に集約
  rank: PolityRank
  ownerHouseId?: HouseId      // 家産的保有関係: その Polity を所有する家。Rebel Polity / commonwealth では undefined（恒常状態）
  kind?: PolityKind            // 'commonwealth' は ownerHouseId === undefined を恒常的に許容する状態。undefined は 'normal' と等価
  origin: PolityOrigin         // 成立由来（required）。worldgen / 民衆叛乱 / 民衆叛乱による政体交代の 3 種
  revoltState?: PopularRevoltState  // 民衆叛乱政体の進行段階（交渉中 / 蜂起中 / 確立）。通常 Polity では undefined
  republicInitializedWeek?: number  // v0.46 §6.68: established commonwealth（共和国）の建国式が一度だけ完了した絶対週。未設定 = 未初期化（once-guard marker）
  treasury: number             // >= 0
  adminPower: number           // 0..100（キャッシュ値。毎年 GovernanceSystem が再計算）
  legacyPrestige: number       // 0..100（歴史的権威・伝統の蓄積）
  active: boolean
  lastWarWeek?: number         // absoluteWeek
  capitalProvinceId: ProvinceId
}
```

- `nameSource`: Polity 名の意味論を集約する discriminated union。`pool`（自前の `polity.western.default` 由来名）/ `holding`（対象 Holding の名前を借りる。地名由来の国名）。worldgen 由来は `pool`、民衆叛乱で新設される rank 5 commonwealth は `holding`（成立元 Holding）。`regime_changed_by_popular_revolt` は既存 nameSource を維持。表示・emit は nameSource-aware helper を介す（§4 / §6）。House は v0.41 では `nameKey` のみだったが v0.47 で `House.nameSource`（`'pool' | 'person' | { kind: 'polity', category }`）を導入済み（§3.4 参照。Polity の discriminated union とは別系統）
- `capitalProvinceId`: 政治支配力の中心。controlSystem の BFS 起点として使う。landless 化後も保持する
- `ownerHouseId`: その Polity を家産的に保有する House の id。Rebel Polity / commonwealth では `undefined`
- `kind`: 'commonwealth' は `ownerHouseId === undefined` を恒常状態として維持する Polity の標識。`createNegotiatingCommonwealth` で 'commonwealth' を set し、`polityOwnerConsistencySystem` / `successionSystem` / `organizationConsistencySystem` 等は commonwealth を skip / 特別扱いする
- `origin`: Polity の成立由来。`worldgen`（初期生成）/ `popular_revolt`（民衆叛乱で新設）/ `regime_changed_by_popular_revolt`（民衆叛乱で既存政体が交代）の 3 variant
- `revoltState`: 民衆叛乱政体のみが持つ進行段階。`negotiating`（外交劇で交渉中）/ `revolting`（蜂起中。War と seize 契約を保持）/ `established`（確立済み）
- `rank`: 1 (帝国) / 2 (王国) / 3 (公爵領) / 4 (伯爵領) / 5 (反乱領)。LandContract chain の rank 不変条件と戦争 case 分岐で機能する
- `legitimacy`・`stability` フィールドは持たず、セレクターで動的計算（§4.5 参照）
- `adminPower` はキャッシュ値として維持。毎年 GovernanceSystem が `getPolityAdminPower` で再計算（§4.5 / §6.34 参照）
- `rulerHouseId` / `roleAssignments` フィールドは持たない。支配者・役職担当者は `OfficeAssignment` システムで管理（§3.7 参照）。`getPolityLeader` / `getPolityLeaderHouse` セレクターで取得（§4.6 参照）
- `houseIds` フィールドは持たない（`getPolityHouseIds` selector で動的取得）
- Polity と Province の関係は LandContract chain で表現する。`getPolityGrantedProvinceIds` / `getPolityTerminalProvinceIds` / `getPolityOverlordProvinceIds` を使う

#### Polity-House-Person 関係

`House` / `Person` は Polity に所属しない。
関係は以下の selector で動的に取得する（§4.x 参照）:

- `getPolityTerminalProvinceIds(state, polityId)` — その Polity が terminal grantee である Province 一覧
- `getPolityOverlordProvinceIds(state, polityId)` — その Polity が chain 上位に登場する Province 一覧
- `getPolityHouseIds(state, polityId)` — その Polity を ownerHouse とする House 一覧
- `getHouseOwnedPolityIds(state, houseId)` — その House が ownerHouse である Polity 一覧（複数可、王朝交代で増える）
- `getHouseControlledProvinceIds(state, houseId)` — その House が ownerHouse である Polity が terminal の Province 一覧
- `getHouseRelevantProvinceIds(state, houseId)` — その House が ownerHouse である Polity が chain 上に登場する Province 一覧
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
  nameKey: string
  active: boolean
  kind?: HouseKind           // AnonymousHouse 廃止後は実質未使用
  memberIds: PersonId[]      // 生存中のメンバー
  deceasedMemberIds: PersonId[]  // 死亡したメンバー（家系の歴史記録）
  founderId?: PersonId       // 家の創設者
  parentHouseId?: HouseId    // 分裂元の家
  cadetHouseIds: HouseId[]   // 分裂で生まれた傍系家のリスト
  nameSource?: 'pool' | 'person' | { kind: 'polity'; category: 'province' | 'city' | 'polity' }  // 家名 nameKey の出所（undefined = 'pool'）
  legacyPrestige: number     // 0..100（家の権威・伝統の蓄積）
  wealth: number             // >= 0
  seatProvinceId: ProvinceId
  lastSplitWeek?: number     // 直近の分家発生時の absoluteWeek（cooldown 用）
  lastConspiracyResolvedWeek?: number // 直近で陰謀 Project が terminal 化した absoluteWeek（conspiracyCooldownWeeks の待機判定用・v0.51）
  clanId?: ClanId              // 所属 Clan。最大 1 つ
  creationKind?: HouseCreationKind    // 創設種別
  creationReason?: HouseCreationReason  // 創設理由
}
```

- `seatProvinceId`: 家本拠地の中心。House が支配していない Province を指してもよい（無領家の名目本拠地を許容）
- `prestige`・`cohesion`・`loyaltyToPolity` フィールドは持たず、セレクターで動的計算（§4.5 参照）
- `headId` フィールドは持たない。家長は `OfficeAssignment`（role: 'leader'）で管理。`getHouseLeader` セレクターで取得（§4.6 参照）
- `polityId` フィールドは持たない。House は単一 Polity に所属しない
- `provinceIds` フィールドは持たない。House の関与 Province は LandContract chain から selector で取得（`getHouseControlledProvinceIds` / `getHouseRelevantProvinceIds`）。House active 判定は memberIds (血統) ベース。土地ゼロでも `active=true` のまま「無領家」として存続し、お家再興を待つ
- `memberIds` は生存中メンバーのみ。`deceasedMemberIds` は死亡したメンバー。`markPersonDead` で memberIds → deceasedMemberIds に移動する
- `kind` フィールドは型上残存するが `'system'` の House は生成しない（AnonymousHouse は廃止済み）。実動の creationReason は `house_split` / `wealth` / `office` / `prestige` / `succession`
- `clanId`: House は最大 1 つの Clan に所属。多重 Clan 所属は禁止。`splitHouse` で親 House の clanId を即時継承、`houseFoundingSystem`（無家人物による創設）では付与しない
- `nameSource`（v0.47）: 家名 `nameKey` の出所。`'pool'`（undefined と同義・house プール由来）/ `'person'`（founder 個人名由来＝共和国 House）/ `{ kind: 'polity', category }`（下賜された領国名由来＝分封 land_grant・分家 titleTransfer。受領 Polity の名前を snapshot。`category` は領国名の解決名前空間 = holding 由来なら `'province'`/`'city'`・pool 由来なら `'polity'`）。表示・emit は nameSource-aware helper（`getHouseDisplayName` / `houseNameRef`）で category を切り替える。詳細は §6 分封の as-built 注記 (3) を参照

### 3.4b Clan（氏族）

```ts
type Clan = {
  id: ClanId                   // prefix: 'cl-'
  active: boolean              // memberHouseIds のうち active normal House が 1 つ以上あれば true
  rootHouseId: HouseId         // 系譜起点。この House より前の祖先には遡らない
  nameSourceHouseId: HouseId   // 表示名の由来 House（rootHouseId と同値）
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

type PersonBackgroundOccupation =
  | 'adventurer' | 'merchant' | 'scholar' | 'mercenary' | 'scribe'
  | 'priest' | 'physician' | 'jurist' | 'wanderer'

type DeathCircumstance = 'natural' | 'faded_from_history'

type Person = {
  id: PersonId
  nameKey: string
  sex: Sex
  age: number
  lifeStage: LifeStage           // 人生段階（required）。年次で一方向に進む
  alive: boolean
  houseId?: HouseId              // undefined = 無家人物
  kind?: 'normal' | 'placeholder'  // 'placeholder' = ProvinceOffice 用の仮想人物
  fatherId?: PersonId        // 父親（既知の場合）
  motherId?: PersonId        // 母親（既知の場合）
  spouseId?: PersonId        // 配偶者（婚姻中のみ）
  formerSpouseIds?: PersonId[]  // 死別した過去の配偶者（双方向・重複なし）
  childIds: PersonId[]       // 子のリスト
  birthStatus: BirthStatus   // 嫡出・非嫡出・不明
  abilities: AbilityScores   // 現在能力 0..120（通常生成は 0..100）
  aptitudes: AbilityScores   // 才能上限 0..120（通常生成は 0..100）
  traits: {
    ambition: number  // 0.0..1.0
    caution: number   // 0.0..1.0
  }
  legacyPrestige: number    // 0..100（個人の歴史的評価の蓄積）
  wealth: number            // >= 0（個人資産。死亡時に EstateSettlementSystem が分配）
  attitudes: AttitudeMap    // 対 Polity / House / Person への態度
  occupation?: PersonBackgroundOccupation  // 無家人物の背景職業（9 種）
  deathCircumstance?: DeathCircumstance     // 死因種別（natural / faded_from_history）
  lastHouseTransferYear?: number            // 最後に家を移籍した年
  idleSinceWeek?: number                     // 派閥拡大 WI-2: 無役待機開始週（着任で undefined）
  geniusType?: GeniusType                   // v0.45 天才の型（undefined = 通常人物）
}
```

- `lifeStage`（required）: `'childhood' | 'adolescence' | 'young_adulthood' | 'mature_adulthood' | 'old_age'` の union。生成時は `deriveLifeStageFromAge(age, config)` で `config.lifeStageTransitionAges[*].standardAge` から初期値を導出（純関数）。出生児は `'childhood'`、placeholder は `'mature_adulthood'` 固定。ゲーム中の遷移は LifeStageProgressionSystem が年次・一方向で行う（逆行しない）。`LIFE_STAGE_ORDER` と `isLifeStageAtLeast(stage, threshold)` で順序比較する（成人相当判定 = `young_adulthood` 以降）。詳細は §6 / §10 参照
- `occupation`: 無家人物の背景職業。`PersonBackgroundOccupation`（adventurer / merchant / scholar / mercenary / scribe / priest / physician / jurist / wanderer の 9 種）
- `deathCircumstance`: 死亡種別。`'natural'`（通常死）/ `'faded_from_history'`（歴史から消える形での退場）
- `geniusType`（v0.45）: `'commander'`（名将）/ `'chancellor'`（名宰相）/ `'universal'`（万能）。人物生成時の低確率ロールで決まり、対応能力の天賦と初期値が引き上がる（§6.67 参照）。原則不変
- `spouseId`: 生存中の配偶者のみを指す。配偶者が死亡した場合は `undefined` に戻る（`markPersonDead`→`clearSpouse`）。これにより残された側は再婚できる
- `formerSpouseIds`: 死別した過去の配偶者を双方向に記録する（`markPersonDead` が `clearSpouse` 後に `recordFormerSpouse` で双方へ追加）。`spouseId` が消えても「元配偶者だった」関係を保持し、家系図（§11）で子のいない夫婦も再構成・隣接表示できる。再婚で複数記録されうる。婚姻の成立/解消そのものは `spouseId` が担い、これは履歴フィールド
- 親子・配偶者関係は双方向整合性が保証される（IntegrityCheck §6.35 参照）
- `prestige` / `traits.loyaltyToPolity` フィールドは持たず、Attitude から動的計算（§4.5 参照）
- `polityId` フィールドは持たない。Person は単一 Polity に直接所属しない。関係 Polity は `getPersonPrimaryPolityId` / `getPersonRelevantPolityIds` で取得（§4.x 参照）
- `wealth`: OfficeCompensationSystem による給与受け取りで増加（§6.20 参照）
- `stats: { admin, martial }` フィールドは持たず、6 軸の `abilities` / `aptitudes` を使う。
  - `abilities`: 現在発揮できる能力（経験で aptitude まで成長し、年齢曲線で衰退）
  - `aptitudes`: 才能上限（原則不変、遺伝で親から子へ平均回帰込みで伝わる）
  - 応用ロール（governance / stewardship / diplomacy / intrigue / warCommand）は派生 selector `getRoleScore(state, personId, role)` で計算する（§4.7 参照）
  - 死亡時、`wealth > 0` なら EstateSettlementSystem（§6.8）が家・相続人へ分配する
- `kind`: `'placeholder'` は ProvinceOffice (Bailiff) 用の仮想人物で、marriage / birth / death / succession などの Person-loop からはガード経由で除外される。`kind` 未設定または `'normal'` は通常人物
- `houseId` は optional。`houseId` が undefined の normal Person は「無家人物 (houseless person)」として扱う。placeholder は常に `houseId === undefined`。無家人物は `state.persons` に直接追加される

### 3.6 Attitude（態度）

Person と PopGroup が持つ対エンティティへの態度を表す。

```ts
type Attitude = {
  affection: number  // -100..100（感情的な好意・嫌悪）
  respect: number    // -100..100（能力・権威への評価）
}

type AttitudeKey = string  // 形式: 'polity:{id}' | 'house:{id}' | 'person:{id}'

type AttitudeMap = Record<AttitudeKey, Attitude>

// Attitude を読み書きする際の唯一の対象指定型
type AttitudeTarget =
  | { kind: 'person'; id: PersonId }
  | { kind: 'polity'; id: PolityId }
  | { kind: 'house'; id: HouseId }
```

- `affection`: 感情的な好意（正）または嫌悪（負）
- `respect`: 能力・権威への尊敬（正）または軽蔑（負）
- エントリが存在しない場合は `{ affection: 0, respect: 0 }` として扱う
- AttitudeDecaySystem により 4 週ごとに `attitudeMonthlyRetentionRate`（0.995）倍に減衰
- tick / selectors / explain / app からの Attitude 読み書きはすべて `AttitudeTarget` を経由する。`{polity|house|person}AttitudeKey` 文字列ビルダーの直接使用は `attitudeMutations` 内部と worldgen に限定（§12 参照）
- AttitudeKey の prefix は `polity:` / `house:` / `person:`

### 3.7 Office / Share システム

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

**OrganizationRef**:

```ts
type OrganizationKind = 'polity' | 'house'
type OrganizationRef =
  | { kind: 'polity'; id: PolityId }
  | { kind: 'house'; id: HouseId }
```

組織 (polity / house) への共通参照。office / share の所属先であると同時に、外交・戦争・叛乱の主体としても用いる（§3.9 参照）。

**OfficeAssignment**: 役職の任命記録。

```ts
type OfficeAssignment = {
  id: OfficeAssignmentId
  organization: OrganizationRef
  role: OfficeRole
  holderPersonId: PersonId
  slotIndex: number               // v0.42 slot 化: 同 (org, role) 内の着座スロット (0-based)
  active: boolean
  startYear: number
  unpaidCount: number             // 給与未払い回数（Attitude ペナルティ計算に使用）
}
```

`slotIndex` は active な同 (organization, role) 間で一意（integrity invariant。整数 ≥ 0。
effectiveMax 上限は**課さない** — 縮小直後の over-max 着座は organizationConsistencySystem
Step 3 が回収するまでの合法 transient）。`createOfficeAssignment` は明示指定がなければ
最小未使用番号を自動採番する。

**HouseShare**: House 内の権力持分（v0.42c: 旧 OrganizationShare を縮小・改名。Polity share は全廃 —
Polity の権力分布は Polity Influence read-model（§6.64）で導出され、entity としては保存しない。
holder は Person のみ。型を絞ったことで polity share を作る事故が型エラーになる）。

```ts
type HouseShare = {
  id: HouseShareId
  houseId: HouseId
  holderPersonId: PersonId
  rawPower: number                // >= 0
}
```

**WorldState の追加フィールド**:

```ts
houseShares: Record<HouseShareId, HouseShare>
officeAssignments: Record<OfficeAssignmentId, OfficeAssignment>
houseShareIndex: {
  byHouse: Record<HouseId, HouseShareId[]>
  byHolderPerson: Record<PersonId, HouseShareId[]>
}
officeIndex: {
  byOrganization: Record<string, OfficeAssignmentId[]>
  byHolderPerson: Record<string, OfficeAssignmentId[]>
}
nextHouseShareId: number
nextOfficeAssignmentId: number
```

**PoliticalRight**（v0.42）: Polity 内の具体的な政治権利（任命権・連隊管理権）。詳細な lifecycle は §6.64。

```ts
type PoliticalRightHolderRef =
  | { kind: 'person'; id: PersonId }   // personal right: holder 死亡で失効
  | { kind: 'house'; id: HouseId }     // household right: holder 絶家で失効

type PoliticalRightTargetRef =
  | { kind: 'polity_office_role'; polityId: PolityId; role: OfficeRole; slotIndex: number }
    // leader は対象外。v0.42 slot 化: right は役職全体でなく特定スロット 1 席を支配する。
    // slotIndex は 0 <= slot < 静的 maxHolders (生成時検査 + integrity R3)
  | { kind: 'holding_office_role'; holdingId: HoldingId; role: 'bailiff' }
  | { kind: 'regiment'; regimentId: RegimentId }

type PoliticalRight = {
  id: PoliticalRightId             // prefix 'prg-'
  polityId: PolityId
  target: PoliticalRightTargetRef
  holder: PoliticalRightHolderRef
  grantedWeek: number
}
// kind ('polity_office_appointment' | 'holding_office_appointment' | 'regiment_control') と
// 失効ルールはフィールドで持たず target.kind / holder.kind から導出する (drift 防止)。

politicalRights: Record<PoliticalRightId, PoliticalRight>
politicalRightIndex: {
  byPolity: Record<PolityId, PoliticalRightId[]>
  byHolder: Record<string, PoliticalRightId[]>   // 'person:{id}' / 'house:{id}'
  byTarget: Record<string, PoliticalRightId[]>   // length <= 1 (1 target 1 active right)
}
nextPoliticalRightId: number
```

**InfluenceModifier**（v0.51 陰謀リファイン）: 影響力（read-model）への符号付き・期限付き修正項。
Influence は entity でなく selector の戻り値（§6.64）なので、「下げる/上げる」には計算に入る項を足すしかない。
影響力毀損陰謀（§6.26）が負の delta を生成し、`influenceSelectors` が新ドメイン `standing` として加味する。
正の delta（恩賞・祭礼）にも使える汎用機構。期限切れ・target 消滅・polity inactive は
`influenceModifierConsistencySystem`（weekly）が回収。旧 Plot 専用エンティティの置換。

```ts
type InfluenceModifierTargetRef =
  | { kind: 'house'; id: HouseId }
  | { kind: 'person'; id: PersonId }
type InfluenceModifier = {
  id: InfluenceModifierId             // prefix 'im-'
  polityId: PolityId                  // どの Polity の influence breakdown に効くか
  target: InfluenceModifierTargetRef  // 誰の influence を動かすか
  delta: number                       // 符号付き（負=毀損 / 正=付与）
  causeKind: 'conspiracy_undermine' | 'favor'
  sourcePersonId?: PersonId           // 陰謀の supervisor（年代記表示用）
  grantedWeek: number
  expiryWeek?: number                 // undefined = 恒久
}
influenceModifiers: Record<InfluenceModifierId, InfluenceModifier>
influenceModifierIndex: {
  byPolity: Record<string, InfluenceModifierId[]>
  byTarget: Record<string, InfluenceModifierId[]>
}
nextInfluenceModifierId: number
```

**PersonReputation**（v0.44）: 成果（Project / DiplomaticPlay / War）由来の人物評判。型詳細と lifecycle は §6.66。

```ts
personReputations: Record<PersonReputationId, PersonReputation>   // 'rep-' prefix
personReputationIndex: { byPerson: Record<PersonId, PersonReputationId[]> }
nextPersonReputationId: number
```

baseScore を保存し現在値は selector で月次減衰計算。expiryWeek を作成時に事前計算し、cleanup は週比較 + 死亡 purge のみ。hard-delete。

target key は `polity_office_role:{polityId}:{role}:{slotIndex}` / `holding_office_role:{holdingId}:bailiff` /
`regiment:{regimentId}`。hard-delete（active=false 残置なし。履歴は SimEvent / Chronicle）。

`Polity.ownerHouseId` の役職的側面 / `Polity.roleAssignments` / `House.headId` は持たず、支配者・役職担当者は `OfficeAssignment` に統一されている。`OFFICE_DEFINITIONS` のキー prefix は `polity:` / `house:`。

### 3.8 LandContract / HoldingOffice

土地支配は Province 直接所有ではなく **LandContract chain** で表現する。contract の対象は Holding であり、各 Holding が独立した contract chain を持つ。

**LandContract**: ある Holding に対する 1 段の契約。chain は root → terminal の順で積み重なる。

```ts
type LandContractSpecialStatus = {
  kind: 'revolt_seizure'
  revoltPolityId: PolityId
  originalTerminalPolityId: PolityId
  startedWeek: number
}

type LandContractGrantor =
  | { kind: 'root'; rootAuthorityId: RootAuthorityId }
  | { kind: 'polity'; polityId: PolityId }

type LandContract = {
  id: LandContractId
  provinceId: ProvinceId             // Holding.provinceId の denormalize（参照コスト軽減用）
  holdingId?: HoldingId              // 対象 Holding
  parentContractId?: LandContractId  // parent (上位契約)
  rootAuthorityId?: RootAuthorityId  // parent と相互排他: root contract のみ rootAuthorityId
  granteePolityId: PolityId          // この契約で土地を受け取る Polity
  terms: { taxRateToGrantor: number }  // grantor への上納率。root contract は 0 固定
  termsProtectedUntilWeek?: number   // 契約保護期間の終了週。この週まで税率改定の再交渉を禁止
  specialStatus?: LandContractSpecialStatus  // 民衆叛乱による接収など、特殊な契約状態
  lastTaxChangedWeek?: number        // 最後に税率を変更した absoluteWeek
  previousTaxRate?: number           // 直前の税率（変更前の値）
  taxIncreaseCooldownUntilWeek?: number  // この週まで税率引き上げを禁止
}
```

- `provinceId` は `holdingId → Holding.provinceId` から導出可能な冗長フィールド。Holding-Province 対応はゲーム中不変のため壊れず、多数の参照箇所で間接参照を省ける
- `specialStatus`: `revolt_seizure`（民衆叛乱で接収された契約。叛乱 Polity / 元 terminal Polity / 開始週を保持）
- `LandContractGrantor`: 契約の grantor を表す union。`root`（rootAuthorityId 由来）/ `polity`（上位 Polity 由来）

不変条件:

1. すべての Holding は byHolding chain 上に root contract を 1 つだけ持つ
2. root contract の `taxRateToGrantor` は 0
3. chain の `granteePolityId` は active Polity
4. chain は循環しない
5. terminal contract のみ Bailiff が紐付く
6. chain 内の各段で `granteePolityId` は重複しない
7. `landContractIndex.byHolding` は chain 順 (root → terminal) を保つ
8. grantor rank < grantee rank（rank 数値が大きいほど下位）
9. Holding 単位で作られた契約 (root / child / intermediate いずれも) は `holdingId` を
   record にも保持する。`byHolding` index に入れるだけで record の `holdingId` を欠落させると、
   `removeContract` の cleanup・war/peace の `contract.holdingId === goal.holdingId` 照合・
   UI の holding 名解決がすり抜ける

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

  // 代官徴税条件
  contractedRemittanceRate: number    // 末端契約者への送金率 (default 0.40)
  expectedFeeRate: number             // 慣習的な代官取り分率 (default 0.10)

  // 代官任期保護
  termProtectedUntilWeek?: number     // この週まで通常の任期満了・交代から保護
}
```

- `holdingId`: 任命対象の Holding。term expiry は `absoluteWeek - startWeek >= termYears * WEEKS_PER_YEAR` で判定
- `contractedRemittanceRate` / `expectedFeeRate`: 代官の徴税条件を表す。代官報酬は `bailiffFeeRate` selector で算出する

**WorldState の追加フィールド**:

```ts
// Holding / StateRegion
states: Record<StateRegionId, StateRegion>
holdings: Record<HoldingId, Holding>

// LandContract
landContracts: Record<LandContractId, LandContract>
landContractIndex: {
  byHolding: Record<HoldingId, LandContractId[]>      // 各 Holding 固有の chain (正規 index)
  byGranteePolity: Record<PolityId, LandContractId[]>
  byParent: Record<LandContractId, LandContractId | undefined>  // parent → child
}
holdingTerminalPolityCache: Record<HoldingId, PolityId>  // Holding 単位の terminal cache

// HoldingOffice
holdingOfficeAssignments: Record<HoldingOfficeAssignmentId, HoldingOfficeAssignment>
holdingOfficeIndex: {
  byHolding: Record<HoldingId, HoldingOfficeAssignmentId | undefined>
  byHolderPerson: Record<PersonId, HoldingOfficeAssignmentId[]>
  byAppointingPolity: Record<PolityId, HoldingOfficeAssignmentId[]>
}

polityIndex: { byOwnerHouse: Record<HouseId, PolityId[]> }

// POP index
popIndex: { byHolding: Record<HoldingId, PopGroupId[]> }
nextPopGroupId: number

nextLandContractId: number
nextHoldingOfficeAssignmentId: number
```

- `byHolding`: 各 Holding 固有の独立した contract chain（正規 index）。Province 粒度の参照が必要な箇所 (UI 表示・land purchase 隣接推論) は dominant holding (weight 最大の terminal polity が支配する holding) を province 代表として byHolding から導出する (`getProvinceDominantHoldingId` / `getProvinceLandContractChain` / `getProvinceDominantTerminalContract`)

ID prefix:

| Type | Prefix |
|---|---|
| `LandContractId` | `lc-` |
| `RootAuthorityId` | `root:` |
| `HoldingOfficeAssignmentId` | `ho-` |
| `HoldingId` | `hl-` |
| `StateRegionId` | `sr-` |

#### BailiffPolicy / BailiffRevenueTaskStatus

```ts
// 代官方針: selector で導出。保存しない
type BailiffPolicy = 'passive' | 'loyal_remittance' | 'profit_seeking' | 'protect_residents'

// 直近 collect_holding_revenue Task の完了状態
type BailiffRevenueTaskStatus = 'completed' | 'none'
```

- `BailiffPolicy` は人物の能力・性格・現地 POP 状況から `getBailiffPolicy` selector で毎回導出する
- placeholder 代官は常に `'passive'`
- `BailiffRevenueTaskStatus` は `getRecentBailiffRevenueTaskStatus` selector で直近 4 週の ActivityLog から判定

### 3.9 外交劇システム

#### 外交・戦争 actor 参照 (OrganizationRef)

外交・戦争・叛乱の主体を表す共通参照。office / share の組織参照と同じ `OrganizationRef`（§3.7）を用いる。

```ts
// = OrganizationRef
type OrganizationRef =
  | { kind: 'polity'; id: PolityId }
  | { kind: 'house'; id: HouseId }
```

Polity actor と House actor の双方が実動する（House actor は acquire_political_right / promote_policy_shift / patronize_artist / commission_chronicle）。

#### DiplomaticIssue

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

#### DiplomaticOffer

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
  proposedBy: OrganizationRef
  demands: DiplomaticDemand[]
  status: DiplomaticOfferStatus
  createdWeek: number
  reasonIds: DecisionReasonId[]
}
```

`invalid` は `DiplomaticOfferStatus` に含めない。検証結果は `OfferValidationResult` で表す。

#### DiplomaticPlay

外交劇本体。Project 完了時に生成され、offer-driven negotiation で進行する（§6.42 参照）。

```ts
type DiplomaticPlayKind =
  | 'land_claim'
  | 'contract_tax_revision'
  | 'revolt_negotiation'

type ActiveDiplomaticPlayStatus = 'active' | 'escalated'
type TerminalDiplomaticPlayStatus = 'settled' | 'failed' | 'resolved_by_conflict' | 'cancelled'

// v0.44: terminal 化サイトで status と同時にセット必須（§6.66）。
// resolved_by_conflict の多義（対外戦争化 / 内部叛乱の蜂起成功・鎮圧）を分離する
type DiplomaticPlayTerminalOutcome =
  | 'demands_met' | 'status_quo' | 'escalated_to_war'
  | 'revolt_succeeded' | 'revolt_suppressed' | 'failed' | 'voided'
```

offer-driven ハイブリッドモデル — 毎 tick structural tension 微増 + offer 提出時の離散評価。settlement は accepted offer によってのみ成立する。progress は settlement 判定に使わず UI 表示値として維持。

DiplomaticPlay は Goal/Aim 接続フィールドを持つ:

```ts
goalId?: GoalId
aimId?: AimId
originProjectId?: ProjectId  // Project 由来の Play を追跡
```

DiplomaticPlay の生成は ProjectStageSystem の `open_diplomatic_play` immediate stage で行う。Project の preparatory stage で preparation / leverage / commitment を蓄積し、DiplomaticPlay 作成時に転写する。DiplomaticPlay は Task を生成せず、Task 生成責務は ProjectTaskGenerationSystem が担う。`issue` / offer 管理フィールドを持ち、`primaryDemand` は `revolt_negotiation` 専用として維持する。

```ts
type DiplomaticPlay = {
  ...existing fields...
  terminalOutcome?: DiplomaticPlayTerminalOutcome  // v0.44: terminal status と同時にセット
  issue?: DiplomaticIssue          // land_claim / contract_tax_revision では必須。revolt_negotiation では省略
  primaryDemand?: DiplomaticDemand // revolt_negotiation 専用（非 revolt では integrity violation）
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
  | { kind: 'popular_tax_relief'; holdingId; targetContractId; currentTaxRate; demandedTaxRate; claimantPopClass }
  | { kind: 'status_quo' }
```

正式使用する組み合わせ: land_claim → transfer_land_contract + pay_wealth + status_quo、contract_tax_revision → change_contract_tax_rate + pay_wealth + status_quo。同一 offer 内で transfer_land_contract と change_contract_tax_rate を混在させない。

#### WorldState 追加

```ts
type WorldState = {
  ...
  diplomaticPlays: Record<DiplomaticPlayId, DiplomaticPlay>
  nextDiplomaticPlayId: number
  diplomaticOffers: Record<DiplomaticOfferId, DiplomaticOffer>
  nextDiplomaticOfferId: number
}
```

ActorIntent 型は存在せず、案件遂行は Project システムが担う。

terminal status の DiplomaticPlay は tick 末の `cleanupTerminalDiplomacy` phase で state から完全削除される。関連 DiplomaticOffer も cascade delete される。履歴は Event ログに残す。

`resolved_by_conflict`: escalated な land_claim / contract_tax_revision play が WarCreationSystem で War 化されると、元 play はこの terminal status になり cleanup される（§6.44）。

### 3.9a War（戦争）

`escalated` な DiplomaticPlay の即時勝敗解決を、複数 tick かけて `warScore` で進行する War entity に置換する。型は `src/sim/types/war.ts`。

```ts
type WarId = Branded<string, 'WarId'>  // prefix: "w-"

type WarStatus = 'active' | 'attacker_won' | 'defender_won' | 'white_peace' | 'cancelled'
type WarSideKey = 'attacker' | 'defender'

type WarParticipant = {
  actor: OrganizationRef
  joinedWeek: number
  primary: boolean
  contributionScore?: number  // v0.43: 前方宣言のみ。書き込みサイトなし・常に undefined（将来の貢献・報酬用）
}

type WarSide = {
  key: WarSideKey
  participants: WarParticipant[]   // v0.43: primary 1 件 + supporter 0..N 件（全 actor polity のみ）

  // War Maneuver: いずれも soft reference（不在/死亡を許容し IntegrityCheck では検査しない）。
  //   WarManeuverSystem が毎週 lazy に選出/再構築する。詳細は §6.45。
  captainGeneralPersonId?: PersonId  // この side の総大将。不在時 undefined（house actor war では管理しない）
  commanderPersonIds: PersonId[]     // 現場指揮官候補。先頭が当該週の戦闘指揮官。v0.43: side の全 polity participant（supporter 含む）の宮廷人材プール（military office holder + House メンバー + 派閥食客）から warCommand 上位 maxWarCommanderCandidatesPerSide 名
  avoidanceCount: number             // この side が戦闘回避を選んだ累積回数（単調増加・reset しない）
}

type War = {
  id: WarId
  originDiplomaticPlayId?: DiplomaticPlayId  // weak ref（元 play は cleanup 済みでも可。§14 / IntegrityCheck）
  status: WarStatus
  attacker: WarSide
  defender: WarSide
  warGoals: WarGoal[]              // 原則 1 件
  warScore: number                // -100..100。正=attacker 優勢、負=defender 優勢
  targetWarScore: number          // 決着絶対値。warScore >= targetWarScore で attacker 勝利、<= -targetWarScore で defender 勝利
  startedWeek: number
  endedWeek?: number              // terminal 時のみ defined
}
```

WarGoal は War 作成時に実行に必要な値をすべてコピーして固定化する（元 DiplomaticPlay / Offer が cleanup 済みでも PeaceSettlement で実行できるようにするため）。

```ts
type WarGoal =
  | TransferLandContractWarGoal
  | ChangeContractTaxRateWarGoal
  | PopularRevoltIndependenceWarGoal

type TransferLandContractWarGoal = {
  kind: 'transfer_land_contract'
  holdingId: HoldingId
  fromPolityId: PolityId          // OrganizationRef ではなく明示的 PolityId
  toPolityId: PolityId
  requiredWarScore: number
}

type ChangeContractTaxRateWarGoal = {
  kind: 'change_contract_tax_rate'
  holdingId: HoldingId
  landContractId: LandContractId
  baseTaxRateToGrantor: number    // 開戦時に凍結する「戦争前の税率」(0..1)。歴史記述の before。
  newTaxRateToGrantor: number     // 目標税率 (after)
  requiredWarScore: number
}

// 民衆叛乱による独立を目的とする WarGoal
type PopularRevoltIndependenceWarGoal = {
  kind: 'popular_revolt_independence'
  commonwealthPolityId: PolityId
  originalHolderPolityId: PolityId
  holdingIds: HoldingId[]
  revoltSeizureContractIds: LandContractId[]
  leaderPersonId: PersonId
  requiredWarScore: number
}
```

`baseTaxRateToGrantor` は WarCreationSystem が **開戦時点の live 契約税率**（`createWarGoalFromDiplomaticPlay` で `landContracts[...].terms.taxRateToGrantor`、無ければ `issue.baseTaxRateToGrantor`）を凍結する。和平で `newTaxRateToGrantor` が適用されると現税率はこの baseline から target へ動くため、`baseTaxRateToGrantor` は live 契約税率と**意図的に乖離し得る**（WarGoal が live state に依存せず「元→新」を語れるようにするため）。integrity は 0..1 の range のみ検査し、live rate との一致は検査しない（§14.5）。

**WorldState 追加**:

```ts
type WorldState = {
  ...
  wars: Record<WarId, War>
  warIndex: {
    byParticipant: Record<string, WarId[]>   // key = `${ref.kind}:${ref.id}`（例 "polity:p-1"）
    byOriginDiplomaticPlay: Record<DiplomaticPlayId, WarId>  // 値は WarId 代入か delete のみ（| undefined を持たない）
  }
  nextWarId: number
}
```

terminal War は即削除せず一定期間（`terminalWarRetentionWeeks`）保持し、`cleanupWarSystem` が retention 超過後に削除する（履歴は Event ログに残る。§6.51）。`politicalActorKey(ref): string` helper（`` `${ref.kind}:${ref.id}` `` を返す）を warIndex / IntegrityCheck で共用する。

**War Maneuver の型（`src/sim/types/war.ts`）**:

```ts
// 想定戦場の地形種別。Province.terrain を基本に features で特殊化する（§6.45 / generateCandidateBattlefield）。
type BattlefieldKind =
  | 'open_field' | 'forest_battle' | 'hill_battle' | 'mountain_pass'
  | 'wetland_battle' | 'river_crossing' | 'coastal_battle'
  | 'siege'   // 型のみ用意し生成しない（要塞・包囲が未実装のため将来用に予約）

type BattleResult = 'attacker_victory' | 'defender_victory' | 'inconclusive'

// BATTLE_OCCURRED event に記録。戦闘がどう発生したか。
type BattleInitiationKind = 'mutual_engagement' | 'attacker_avoidance_failed' | 'defender_avoidance_failed'
```

`BattlefieldKind` は state には永続化せず、WarManeuverSystem が毎週その場で生成して battle 解決と event に使う一過性の値（terrain/features は Province 側に永続）。これら maneuver 用の値は War entity に蓄積しない（warScore と avoidanceCount のみが state に残る）。

### 3.9b Regiment（連隊）

軍事力は、平時から state 上に存在する**永続 Regiment entity**（軍事動員単位）として表現する。worldgen で **1 Holding = 1 Regiment** を生成し（§7）、WarManeuverSystem の battle power 入力に用いる（§6.45）。型は `src/sim/types/regiment.ts`、power 計算は `src/sim/selectors/regimentSelectors.ts`。

```ts
type RegimentId = Branded<string, 'RegimentId'>  // prefix: "rg-"

type RegimentStatus = 'active' | 'disbanded' | 'destroyed'
//   disbanded: owner/home 失効で制度的に解散。再編成対象外（恒久）。
//   destroyed: 戦闘損耗で壊滅。本拠地・owner 健在なら RegimentReinforcementSystem が
//     reform 遅延を経て active に再編成する（補充・再編成。§6.50）。
//   どちらの非 active record も records / regimentIndex.byOwner には残す
//   （case(c) の「record 在り → 0 power, fallback しない」判定に必要）。byWar からは外す。

type RegimentSourceKind = 'levy' | 'urban_militia' | 'noble_retinue' | 'local_levy' | 'mercenary'  // mercenary は型予約のみ
type RegimentTroopKind = 'infantry' | 'cavalry'

type Regiment = {
  id: RegimentId
  owner: OrganizationRef            // 編制権を持つ主体。worldgen では homeHolding の terminal Polity
  mobilizedByPolityId?: PolityId      // 現在この Regiment を戦争動員している Polity
  status: RegimentStatus
  sourceKind: RegimentSourceKind
  troopKind: RegimentTroopKind
  homeHoldingId?: HoldingId           // 由来 Holding / Province（原則すべて持つ）
  homeProvinceId?: ProvinceId
  currentWarId?: WarId                // 動員先の soft reference（IntegrityCheck で hard invariant にしない）
  currentSide?: WarSideKey
  strength: number                    // 兵員・装備・馬匹・従者の充足率 0..100。battle で大きくは削れない（§6.45）
  organization: number                // 部隊統制 0..maxOrganization。battle 内で主に削れる値（主損耗）
  morale: number                      // 士気 0..maxMorale。battle 内に削れ・recovery で baseline へ戻る・rout 判定に効く
  maxStrength: number                 // 原則 100
  basePower: number                   // 全快時の基礎戦闘力。worldgen 時点で凍結（§7）
  baselineOrganization: number        // 平時に向かう統制（既定 50）。recovery の収束先
  maxOrganization: number             // 統制上限（既定 100、hardCap 120 以下）
  baselineMorale: number              // 平時に向かう士気（既定 30）。rout 判定の基準
  maxMorale: number                   // 士気上限（既定 100）
  createdWeek: number
  lastMobilizedWeek?: number
  destroyedWeek?: number              // destroyed 化した週。reform 遅延判定（status==='destroyed' のみ）
  lastReinforcedWeek?: number         // 最後に strength 補充 / reform を受けた週
  disbandAfterWar?: boolean           // 戦後に解散する一時連隊フラグ
}
```

**有効戦力**（`getRegimentEffectivePower`）= `basePower × (strength/100) × (0.5 + 0.5 × organization/100)`。非 active は 0。baseline 50 では全連隊一律 0.75× になるが、engagement / battle は比ベースなので相対関係は保たれる。**battle 中の effectivePower は戦闘前に 1 回 frozen** し、内部 tick で org が削れても再計算しない（pairPowerFactor 暴走回避。§6.45）。

**baseline / max の意味**: `organization` / `morale` は battle で baseline 以下へ削れ、平時に RegimentRecoverySystem（§6.48）が baseline へ戻す。worldgen は initial = baseline（org 50 / morale 30）で生成し、100/80 起点の長期過渡を避ける。baseline/max は config 定数由来で worldgen 時に rng draw を増やさない。

**WorldState 追加**:

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

戦争 side の power は `getRegimentPowerForWarSide(state, config, war, side)` が算出する（§6.45 の battle 入力）:
(a) 動員中 active Regiment があればその有効戦力の合計（participant 不問 — byWar 索引ベースなので supporter の連隊も自然に含まれる）、
(b) 動員ゼロのときのみ **participant ごとに** fallback して合算する（v0.43）: Regiment record を 1 つも所有しない participant（byOwner 空）は `getActorMilitaryPower`、byOwner 非空だが動員可能な active が無い participant は 0（fallback しない）。participant が primary 1 件のみの War では v0.36 の挙動と同値。

### 3.9c Battle（戦闘）

WarManeuverSystem が 1 戦闘を解決するたびに記録する**短期 entity**。内部 tick / frontline simulation を `simulateBattle`（§6.45）で実行し、その summary を Battle に保存する。War detail / recent history 表示用。`cleanupWarSystem` の terminal War 削除に piggyback して cleanup する（履歴は Event ログに残る。永続 record ではない。§6.51）。型は `src/sim/types/battle.ts`。

```ts
type BattleId = Branded<string, 'BattleId'>  // prefix: "bt-"
type BattleTickUnit = 'day' | 'phase'
type BattleOutcomeQuality = 'orderly_withdrawal' | 'rout' | 'encirclement'  // encirclement は将来予約
type BattleCommanderAssignment = { commanderPersonId: PersonId; regimentId: RegimentId }  // Battle 単位の一時割当 snapshot

type BattleRegimentResult = {                // 1 Battle における 1 Regiment の損耗記録
  regimentId: RegimentId
  side: WarSideKey
  strengthBefore: number; strengthAfter: number; strengthDamage: number
  organizationBefore: number; organizationAfter: number; organizationDamage: number
  moraleBefore?: number; moraleAfter?: number; moraleDamage?: number
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
  attackerBasePower: number                  // = Σ raw basePower（動員 active 連隊）
  defenderBasePower: number
  attackerEffectivePower: number             // 戦闘前 side effectivePower（getRegimentPowerForWarSide。post-battle 比は使わない）
  defenderEffectivePower: number
  warScoreDelta: number                      // rawDelta（after−before でなく。warScore saturation で符号が崩れないように）
  warScoreAfter: number                      // clamp 後の warScore
  // battle summary（§6.45 の simulateBattle 出力。ID 配列が正、counts は ID 配列から導出）:
  outcomeQuality?: BattleOutcomeQuality
  frontage?: number
  tickUnit?: BattleTickUnit
  maxTicks?: number
  ticksElapsed?: number
  attackerInitialFrontlineIds?: RegimentId[]
  defenderInitialFrontlineIds?: RegimentId[]
  attackerRoutedRegimentIds?: RegimentId[]
  defenderRoutedRegimentIds?: RegimentId[]
  breakthroughSide?: WarSideKey              // cosmetic flag（§6.45）
  pursuitOccurred?: boolean                  // core では false 固定（将来予約）
  attackerCommanderAssignments?: BattleCommanderAssignment[]
  defenderCommanderAssignments?: BattleCommanderAssignment[]
}
```

**WorldState 追加**:

```ts
type WorldState = {
  ...
  battles: Record<BattleId, Battle>
  battleIndex: { byWar: Record<WarId, BattleId[]> }
  nextBattleId: number
}
```

### 3.10 目標システム

Polity / House / Person が長期目標 Goal → 中期計画 Aim → 短期意図 Task の階層で一貫した行動を取る。

#### Goal

```ts
type GoalStatus = 'active' | 'succeeded' | 'failed' | 'abandoned'
type PolityGoalKind = 'external_expansion' | 'internal_development'
type HouseGoalKind = 'expand_power_base' | 'preserve_power_base' | 'cultivate_prestige'
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
type PolityAimKind = 'consolidate_province_holdings' | 'seize_weak_remote_holdings' | 'develop_owned_holding' | 'improve_owned_contract_terms' | 'eliminate_overlord_contract' | 'eliminate_vassal_contract' | 'demand_tax_increase_from_vassal'
type HouseAimKind = 'acquire_political_right' | 'steer_polity_external_expansion' | 'steer_polity_internal_development' | 'patronize_artist' | 'commission_chronicle'
// v0.42: increase_polity_share は廃止 (influence は read-model)。acquire_political_right の
// aim.target は EntityRef の political_right_target variant ({ kind, target: PoliticalRightTargetRef })
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
  targetProgress: number    // 標準値 100
  createdWeek: number
  deadlineWeek: number
  lastProjectPreparedWeek?: number
  nextProjectAllowedWeek?: number
  activeDiplomaticPlayId?: DiplomaticPlayId
  activeTaskId?: TaskId
  waitingFor?: TaskTargetRef
  waitingReasonKey?: string
  blockedReasonKey?: string
  nextReviewWeek?: number
  successfulProjectCount: number
  failedProjectCount: number
  goalProgressApplied?: boolean      // terminal aim の goal progress 二重加算防止フラグ
  status: AimStatus
  reasonIds: DecisionReasonId[]
}
```

Aim は中期計画。期限と成功条件を持つ。Person Aim は Task で直接進行し、Polity / House Aim は Project / DiplomaticPlay 経由で進行する。activeTaskId / activeDiplomaticPlayId は同時に最大 1 つのみセット。Project 系フィールド（`lastProjectPreparedWeek` / `nextProjectAllowedWeek` / `successfulProjectCount` / `failedProjectCount`）で Project 駆動を管理し、`targetProgress` 到達（複数 Project 完了）で Aim succeeded となる。`activeProjectId` は持たない（`projectIndex.byAim` で検索可能なため）。

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

#### WorldState 追加

```ts
type WorldState = {
  ...
  goals: Record<GoalId, Goal>
  aims: Record<AimId, Aim>
  decisionReasons: Record<DecisionReasonId, DecisionReason>
  goalIndex: { byOwner: Record<string, GoalId[]> }
  aimIndex: { byOwner: Record<string, AimId[]>; byGoal: Record<string, AimId[]> }
  nextGoalId: number
  nextAimId: number
  nextDecisionReasonId: number
}
```

index の key 型は一律 `Record<string, ...>` を採用する（entityRef.id が string のため。ChronicleIndex の注記と同じ理由、§3.14）。

terminal Goal / Aim は tick 末の `cleanupTerminalDecisions` phase で state から完全削除される。

### 3.11 Task / ActivityLog システム

#### Task

Task は特定の人物が週単位で処理する具体的な仕事。ephemeral であり、active Task のみ state に保持する。

```ts
type TaskStatus = 'active' | 'succeeded' | 'failed' | 'cancelled'
type TaskOutcomeKind = 'success' | 'failure' | 'partial'

type TaskKind =
  | 'support_organization_plan' | 'promote_house_influence' | 'perform_office_duties'
  | 'seek_office_support' | 'display_competence' | 'defend_office_position'
  | 'manage_accounts' | 'seek_profitable_assignment'
  | 'prepare_project' | 'advance_project'
  | 'secure_internal_support'
  | 'arrange_patronage' | 'commission_chronicle_work'
  | 'prepare_argument' | 'gather_claim_evidence' | 'negotiate_terms'
  | 'pressure_counterparty' | 'offer_compromise' | 'undermine_counterparty_position'
  | 'collect_holding_revenue'  // 代官月次徴税業務

type TaskTargetRef =
  | { kind: 'aim'; id: AimId }
  | { kind: 'project'; id: ProjectId }
  | { kind: 'diplomatic_play'; id: DiplomaticPlayId }
  | { kind: 'holding_office_assignment'; id: HoldingOfficeAssignmentId }

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
  difficulty: number          // 0〜100。outcome 判定の難易度
  relevantAbility: AbilityKey // outcome 判定に使う能力
}
```

完了・失敗・キャンセルされた Task は ActivityLog 作成後に state.tasks から削除。ID は再利用しない。

#### PersonActivityLog

Task / Project の完了・失敗時に作成される軽量な行動記録。TaskActivityLog と ProjectActivityLog の discriminated union。

```ts
type PersonActivityKind =
  | 'task_completed' | 'task_failed' | 'task_cancelled' | 'task_expired'
  | 'project_completed' | 'project_failed'

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

#### DiplomaticPlay 拡張

DiplomaticPlay は delegate と交渉パラメータを持つ。

```ts
type DiplomaticPlay = {
  ...existing fields...
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
  // v0.43: 各 side を支持する Polity supporter（required 配列・新規作成時は空）
  initiatorSupporters: DiplomaticPlaySupporter[]
  targetSupporters: DiplomaticPlaySupporter[]
}

// v0.43
type DiplomaticPlaySupporter = {
  actor: OrganizationRef      // actor.kind === 'polity' のみ
  joinedWeek: number
  commitment: number          // 0..100（joinScore 由来）
  contributionScore?: number  // 前方宣言のみ・常に undefined
}
type DiplomaticPlaySideKey = 'initiator' | 'target'
```

supporter 配列の更新は必ず `addDiplomaticPlaySupporterMut(ws, config, playId, side, supporter)` を通す（検査: play 存在 / status==='active' / polity actor / active polity / primary 非重複 / 両 side 非重複 / `maxDiplomaticSupportersPerSide` 上限。戻り値は enum string）。War participant の supporter 除去は `removeWarParticipantMut(ws, warId, actor)`（byParticipant index も更新。primary は reject）。

#### WorldState 追加

```ts
type WorldState = {
  ...
  // Task
  tasks: Record<TaskId, Task>
  taskIndex: {
    byAssignee: Record<string, TaskId[]>
    byOwner: Record<string, TaskId[]>
    byTarget: Record<string, TaskId[]>
  }
  waitingAimIds: WaitingAimIndex
  nextTaskId: number

  // ActivityLog
  personActivityLogs: Record<PersonActivityLogId, PersonActivityLog>
  personActivityLogIndex: {
    byPerson: Record<string, PersonActivityLogId[]>
  }
  nextPersonActivityLogId: number
}
```

ID prefix:

| Type | Prefix |
|---|---|
| `GoalId` | `go-` |
| `AimId` | `am-` |
| `DecisionReasonId` | `dr-` |
| `TaskId` | `tk-` |
| `PersonActivityLogId` | `al-` |
| `ProjectId` | `pr-` |
| `PressureId` | `ps-` |
| `DiplomaticOfferId` | `do-` |

### 3.12 Project システム

#### Project

Project は「誰かが作成し、誰かが遂行する具体的案件」。Aim を具体化した行動単位であり、Task によって進行する。completed / failed / cancelled の terminal Project は ProjectOutcomeSystem で効果解決後に state から削除される。

```ts
type ProjectStatus = 'active' | 'completed' | 'failed' | 'cancelled'

type ProjectOrigin =
  | { kind: 'aim'; aimId: AimId }
  | { kind: 'system'; reasonKey: string }

type ProjectKind =
  | 'develop_holding'
  | 'acquire_political_right'
  | 'promote_policy_shift'
  | 'patronize_artist'
  | 'commission_chronicle'
  | 'acquire_land'
  | 'sell_land'
  | 'improve_contract_terms'
  | 'demand_tax_increase'
  | 'respond_to_pressure'
  | 'personal_training'   // v0.44: improve_ability Aim の project 化（§6.66）

// v0.44: terminal 化サイトで status と同時にセット必須（§6.66）
type ProjectTerminalReason =
  | 'completed' | 'deadline_expired' | 'stage_attempts_exceeded' | 'budget_exhausted'
  | 'duplicate_play' | 'opponent_too_strong' | 'no_supervisor'
  | 'owner_inactive' | 'aim_terminal' | 'play_terminal'

type BaseProject = {
  id: ProjectId
  owner: DecisionSubjectRef
  origin: ProjectOrigin
  kind: ProjectKind
  creatorPersonId: PersonId
  supervisorPersonId: PersonId
  parentProjectId?: ProjectId
  status: ProjectStatus
  terminalReason?: ProjectTerminalReason  // v0.44: terminal status と同時にセット
  progress: number
  targetProgress: number      // default 100
  currentStageKey: ProjectStageKey   // 全 Project に必須
  stageAttemptCount?: number         // preparatory stage のリトライ管理
  createdWeek: number
  deadlineWeek?: number
  reasonIds: DecisionReasonId[]
}
```

9 つの派生型 union で構成:
- `DevelopHoldingProject`: holdingId / improvementKind / targetImprovementLevel / budget (ProjectBudget)
- `AcquirePoliticalRightProject`: polityId / target (PoliticalRightTargetRef) / budget / spentBudget（v0.42 — 旧 ExpandPolityShareProject は廃止）
- `PromotePolicyShiftProject`: polityId / houseId / policyKey
- `PatronizeArtistProject`: houseId / budget / spentBudget / artistPersonId
- `CommissionChronicleProject`: houseId / budget / spentBudget / subjectRef
- `LandClaimProject` (acquire_land / sell_land): holdingId / provinceId / counterpartyPolityId / diplomaticPlayId / preparation / leverage / commitment
- `ContractRevisionProject` (improve_contract_terms / demand_tax_increase): holdingId / landContractId / counterpartyPolityId / desiredTaxRateToGrantor / diplomaticPlayId / preparation / leverage / commitment
- `RespondToPressureProject`: pressureId / diplomaticPlayId / stance
- `PersonalTrainingProject`（v0.44）: owner は `{ kind: 'person' }` 固定 / traineePersonId / trainingAbilityKey。owner / creator / supervisor / trainee は全一致（IntegrityCheck 検査）。budget なし
- （上記に加え movement_campaign / v0.47 petition 系 5 種が存在する）
- **陰謀 Project（v0.51 陰謀リファイン §6.26、すべて House owned・budget なし・単一 final stage）**:
  - `UndermineInfluenceProject`: polityId / target (InfluenceModifierTargetRef)。完了で負の InfluenceModifier 生成
  - `RevokePoliticalRightProject`: polityId / target (PoliticalRightTargetRef)。完了で対象 right を国に返却（difficulty は holder 種別依存）
  - `ReplaceHouseLeaderProject`: targetHouseId（自家の分家）。完了で分家当主を交代（旧 replace_house_leader plot 移植）

#### ProjectStage 一般化

全 Project に `currentStageKey` を持つ。`ProjectStageKey` は string 型とし、各 ProjectKind ごとに有効な stage sequence を定義する。

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
| acquire_political_right | execute_project (final) |
| promote_policy_shift | execute_project (final) |
| patronize_artist | arrange_patronage (final) |
| commission_chronicle | write_chronicle (final) |
| acquire_land | prepare_claim (prep) → open_diplomatic_play (imm) → negotiate (final) |
| sell_land | prepare_offer (prep) → open_diplomatic_play (imm) → negotiate (final) |
| improve_contract_terms | prepare_argument (prep) → open_diplomatic_play (imm) → negotiate (final) |
| demand_tax_increase | prepare_argument (prep) → open_diplomatic_play (imm) → negotiate (final) |
| personal_training | execute_project (final) |
| respond_to_pressure | choose_stance (imm) → propose_initial_offer (imm) → prepare_response (prep) → negotiate (final) |

- `immediate`: ProjectStageSystem が即時解決。Task を生成しない
- `preparatory`: Task を生成。success → 次 stage 遷移、partial → 同 stage 継続、failure → stageAttemptCount increment → 上限超過で Project failed
- `final`: Task を生成。Project.progress を蓄積し、targetProgress 到達で completed

#### DevelopHoldingProject（Budget）

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
- deadline は execute_project stage のみに適用（§6.40 参照）

#### RespondToPressureProject

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

#### WorldState 追加

```ts
type WorldState = {
  ...
  projects: Record<ProjectId, Project>
  projectIndex: {
    byOwner: Record<string, ProjectId[]>
    byAim: Record<string, ProjectId[]>
    byParentProject: Record<string, ProjectId[]>
    byCreatorPerson: Record<string, ProjectId[]>
    bySupervisorPerson: Record<string, ProjectId[]>
    byRelatedEntity: Record<string, ProjectId[]>
  }
  nextProjectId: number
}
```

### 3.13 Pressure システム

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

#### WorldState 追加（Pressure）

```ts
type WorldState = {
  ...
  pressures: Record<PressureId, Pressure>
  pressureIndex: PressureIndex
  nextPressureId: number
}
```

#### WorldState 追加（livingPersonIds）

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

#### WorldState 追加（worldgenLivingPersonsBaseline、v0.45.1）

```ts
type WorldState = {
  ...
  worldgenLivingPersonsBaseline?: number  // worldgen 完了時の生存人口 (placeholder 除く)
}
```

- 出生倍率の人口閾値（critical / target / high 帯、§6.10）の基準値。閾値をマップ規模（preset）に比例させるために worldgen で一度だけ記録する不変値
- optional: 未設定（古い fixture 等）では出生倍率制御が無効（常に 1.0）

---

### 3.14 Chronicle System

生成された歴史を対象 entity 別に永続的に遡るための read-model。各 tick で発生した `SimEvent` を tick 終端で curated projection し、append-only の `ChronicleEntry` として materialize する（ChronicleProjectionSystem、§6.62）。

**設計原則（厳守）**: `ChronicleEntry` は「歴史を読むための記録」であり「歴史を動かす状態」ではない。simulation logic の入力・判断には一切使わない（参照は selector / UI 表示専用、§4.11）。死亡人物・断絶家・終了 War 等への soft reference を持ってよく、参照先が現在の `WorldState` に存在しなくても integrity 違反にしない（§6.35）。削除・cap・圧縮・外部化は行わない（append-only）。`PersonActivityLog`（死亡時 purge、simulation で使用可）とは責務が異なる。

```ts
type ChronicleEntryId = Branded<string, 'ChronicleEntryId'>  // prefix 'ch-'

type ChronicleCategory =
  | 'war' | 'battle' | 'land' | 'house' | 'office' | 'faction'
  | 'revolt' | 'life' | 'development' | 'governance' | 'disaster'

type ChronicleEntry = {
  id: ChronicleEntryId
  year: number
  weekOfYear: number
  category: ChronicleCategory
  importance: EventImportance
  sourceEventId: EventId       // 由来 SimEvent。全 entry が projection 由来のため required
  sourceEventType: EventType
  templateKey: string          // 初期は SimEvent.messageKey を流用。rich narrative 用の専用 key も可
  params: EventMessageParams   // ロケール中立（表示文字列を焼き込まない）
  entityRefs: EventEntityRef[] // SimEvent.entityRefs をコピー（soft reference）
  context?: ChronicleContext   // 未 populate（将来の rich context 用 scaffold）
}

type ChronicleContext = BattleChronicleContext  // 現状 union member は 1
type BattleChronicleContext = {
  kind: 'battle'
  outnumberedVictory?: boolean
  decisiveVictory?: boolean
  commanderContributionSide?: 'attacker' | 'defender'
  decisiveCommanderId?: PersonId
  warScoreDelta?: number
}

type ChronicleIndex = {  // キーは plain string（entityRef.id が string のため。warIndex 慣習に揃える）
  byPerson: Record<string, ChronicleEntryId[]>
  byHouse: Record<string, ChronicleEntryId[]>
  byPolity: Record<string, ChronicleEntryId[]>
  byProvince: Record<string, ChronicleEntryId[]>
  byHolding: Record<string, ChronicleEntryId[]>
}
```

**WorldState 追加**:

```ts
type WorldState = {
  ...
  chronicleEntries: Record<ChronicleEntryId, ChronicleEntry>
  chronicleIndex: ChronicleIndex
  nextChronicleEntryId: number
}
```

- index 対象は person / house / polity / province / holding の 5 kind のみ。`faction` / `clan` / `goal` 等の ref は entry には保持されるが index には振らない。`war` / `battle` 用 index は非導入（関連 Polity / Province の chronicle 経由で戦争・戦闘も対象別履歴に乗る。War 史は `params.warId` 全走査の表示専用 selector で補う、§4.11）。
- `ChronicleContext` 型は定義のみで、どの entry にも populate しない。battle narrative の出し分けは `BATTLE_OCCURRED` の messageParams への additive enrich（`outnumberedVictory` / `decisiveVictory`）で行う（§6.62 / §8）。指揮官系 scalar は見送り。

