# 3. エンティティ型

### 3.1 Province（プロヴィンス）

```ts
type Province = {
  id: ProvinceId
  stateId: StateRegionId
  name: string
  x: number
  y: number
  neighbors: ProvinceId[]
  habitability: number    // 0..100
  holdingIds: HoldingId[]
}
```

- `stateId`: 所属する StateRegion (v0.20)
- `habitability`: Province の基礎的な居住性・土地ポテンシャル。0 = ほぼ居住不能、100 = 非常に居住・生産に適した土地
- `holdingIds`: この Province に属する Holding の一覧 (v0.20)。各 Holding が development / polityControl を持つ
- `baseTax` / `manpower` / `unrest` は v0.8 で廃止。これらは POP から selector で算出する
- **v0.16**: `polityId` / `ownerHouseId` / `houseControl` を削除。土地支配は §3.8 LandContract chain で表現する。Province の terminal owner は selector (`getProvinceTerminalPolityId` / `getProvinceEffectiveOwnerHouseId`) で取得する
- **v0.20**: `development` / `polityControl` を Province から削除し Holding に移動。Province レベルの値は selector (`getProvinceDevelopmentFromHoldings` / `getProvincePolityControlFromHoldings`) で Holding の weight 加重平均から算出する

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

### 3.1c Holding（v0.20）

```ts
type HoldingKind = 'manor' | 'city'

type Holding = {
  id: HoldingId
  provinceId: ProvinceId
  kind: HoldingKind
  name: string
  development: number     // -100..100
  polityControl: number   // 0..100
  landQuality: number     // > 0
  weight: number          // > 0
}
```

- Province 内の個別土地区画。土地契約・実効支配・開発度・収入分配・代官任命の単位
- `kind`: manor (農村荘園) / city (都市)。収入分配で city は kindMultiplier = 1.3
- `development`: 荒廃〜発展。Province の development は全 Holding の weight 加重平均
- `polityControl`: terminal Polity の実効支配力。ControlSystem が Holding 単位で更新
- `landQuality`: 土地の基礎品質。収入分配の share weight に影響
- `weight`: Holding の相対的な重み。収入分配・Province 集計の加重に使用
- Holding-Province 対応はゲーム中不変（v0.20 scope ではゲーム中の Holding 追加・削除はない）

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
type House = {
  id: HouseId
  name: string
  active: boolean
  kind?: 'system'            // 'system' = AnonymousHouse 等の内部 House (v0.16)
  memberIds: PersonId[]      // 生存中のメンバー
  deceasedMemberIds: PersonId[]  // 死亡したメンバー（家系の歴史記録）
  founderId?: PersonId       // 家の創設者（分裂新設家のみ設定）
  parentHouseId?: HouseId    // 分裂元の家
  cadetHouseIds: HouseId[]   // 分裂で生まれた傍系家のリスト
  nameSource?: 'pool' | 'province' | 'founder' | 'fallback'
  legacyPrestige: number     // 0..100（家の権威・伝統の蓄積）
  wealth: number             // >= 0
  seatProvinceId: ProvinceId
}
```

- `seatProvinceId`: 家本拠地の中心。v0.16 では House が支配していない Province を指してもよい（亡命・名目本拠地を許容）
- `kind === 'system'` は AnonymousHouse（`h-anon` 固定 ID、placeholder Person の集約用）。UI / 整合性検査 / extinction / split から除外される（§3.8 / §20.4）
- `prestige`・`cohesion`・`loyaltyToPolity` は v0.11 で削除。セレクターで動的計算（§4.5 参照）
- **v0.12**: `headId` を削除。家長は `OfficeAssignment`（role: 'leader'）で管理。`getHouseLeader` セレクターで取得（§4.6 参照）
- **v0.15**: `polityId` フィールドを削除。House は単一 Polity に所属しない
- **v0.16**: `provinceIds` フィールドを削除。House の関与 Province は LandContract chain から selector で取得（`getHouseControlledProvinceIds` / `getHouseRelevantProvinceIds`）。House active 判定は memberIds (血統) ベース（§9.1 / spec-v016-update.md）。土地ゼロでも `active=true` のまま「亡命家」として存続し、お家再興を待つ
- **v0.20.3**: `memberIds` を生存中メンバーのみに限定し、`deceasedMemberIds` を追加。`markPersonDead` で memberIds → deceasedMemberIds に移動する。家系の歴史記録を保持しつつ、生存メンバー走査の効率を確保

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
  houseId: HouseId
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
- **v0.16**: `kind` を追加。`'placeholder'` は ProvinceOffice (Bailiff) 用の仮想人物で、AnonymousHouse に所属し marriage / birth / death / succession などの Person-loop からはガード経由で除外される（§20.3）。`kind` 未設定または `'normal'` は通常人物

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
}
```

- **v0.20**: `provinceId` → `holdingId` に変更。`startYear` を廃止し `startWeek` (absoluteWeek) に統一。term expiry は `absoluteWeek - startWeek >= termYears * WEEKS_PER_YEAR` で判定
- **v0.25**: `contractedRemittanceRate` / `expectedFeeRate` を追加。代官の徴税条件を表す。`bailiffRevenueShare` は廃止。代官報酬は `bailiffFeeRate` selector で算出する

**AnonymousHouse**: placeholder Person を集約する固定 ID House (`h-anon`、`kind: 'system'`)。worldgen で 1 つ生成され、Bailiff の placeholder Person が所属する。succession / split / extinction / marriage / birth / mortality からは除外される。

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
| `AnonymousHouse` (固定 ID) | `h-anon` |

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

### 3.9 外交劇システム (v0.18 / v0.26 更新)

#### PoliticalActorRef

外交・戦争・叛乱の主体を表す共通参照。

```ts
type PoliticalActorRef =
  | { kind: 'polity'; id: PolityId }
  | { kind: 'house'; id: HouseId }
```

v0.18 では Polity actor のみ実動。v0.22 で House actor の最小実動を導入（expand_polity_share / promote_policy_shift / patronize_artist / commission_chronicle）。

#### DiplomaticPlay

外交劇本体。**v0.26**: Project 完了時に生成される（旧 Intent → Play 変換は廃止）。

```ts
type DiplomaticPlayKind =
  | 'land_claim'
  | 'contract_tax_revision'
  | 'revolt_negotiation'

type ActiveDiplomaticPlayStatus = 'active' | 'escalated'
type TerminalDiplomaticPlayStatus = 'settled' | 'failed' | 'resolved_by_conflict' | 'cancelled'
```

progress (妥協方向) / tension (緊張方向) の 2 軸で進行し、閾値到達で settlement / escalation に分岐する。`startedWeek` / `deadlineWeek` を absoluteWeek で保持 (v0.19)。terminal status に達した Play は同 tick 末に削除。

v0.22 では DiplomaticPlay に Goal/Aim 接続フィールドを追加:

```ts
goalId?: GoalId
aimId?: AimId
originProjectId?: ProjectId  // v0.26: Project 由来の Play を追跡
```

**v0.26**: `originIntentId` を廃止し `originProjectId` を追加。ProjectOutcomeSystem が外交系 Project 完了時に DiplomaticPlay を生成し、origin の Aim に `activeDiplomaticPlayId` を設定する。AimOutcomeSystem が Play の terminal status から Aim progress を更新する。

#### DiplomaticDemand

```ts
type DiplomaticDemand =
  | { kind: 'transfer_land_contract'; holdingId: HoldingId; toPolityId; beneficiaryActor? }
  | { kind: 'change_contract_tax_rate'; holdingId: HoldingId; landContractId; newTaxRateToGrantor }
  | { kind: 'pay_wealth'; from; to; amount }
  | { kind: 'revolt_concession'; provinceId; popClass: PopClass; concessionLevel }  // v0.24: popGroupId → popClass
  | { kind: 'status_quo' }
```

#### WorldState 追加 (v0.18 / v0.26 更新)

```ts
type WorldState = {
  ...
  diplomaticPlays: Record<DiplomaticPlayId, DiplomaticPlay>
  nextDiplomaticPlayId: number
}
```

**v0.26**: `actorIntents` / `nextActorIntentId` を削除。ActorIntent 型を全廃し、Project システムに置換。

terminal status の DiplomaticPlay は tick 末の `cleanupTerminalDiplomacy` phase で state から完全削除される。履歴は Event ログに残す。

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
type PolityAimKind = 'consolidate_province_holdings' | 'seize_weak_remote_holdings' | 'develop_owned_holding' | 'improve_owned_contract_terms'
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
  | 'secure_development_budget' | 'supervise_holding_development'
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

#### PersonActivityLog

Task 完了・失敗・キャンセル時に作成される軽量な行動記録。

```ts
type PersonActivityKind = 'task_completed' | 'task_failed' | 'task_cancelled' | 'task_expired'  // v0.25: task_expired 追加

type PersonActivityLog = {
  id: PersonActivityLogId
  personId: PersonId
  week: number
  kind: PersonActivityKind
  outcome: TaskOutcomeKind
  taskKind: TaskKind
  sourceRef?: TaskTargetRef
  relatedRefs: EntityRef[]
  summaryKey: string
  params?: Record<string, string | number>
  importance: number
}
```

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
| `ProjectId` | `pj-` |

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
  createdWeek: number
  deadlineWeek?: number
  reasonIds: DecisionReasonId[]
}
```

7 つの派生型 union で構成:
- `DevelopHoldingProject`: holdingId / budget / spentBudget
- `ExpandPolityShareProject`: polityId / houseId / budget / spentBudget
- `PromotePolicyShiftProject`: polityId / houseId / policyKey
- `PatronizeArtistProject`: houseId / budget / spentBudget / artistPersonId
- `CommissionChronicleProject`: houseId / budget / spentBudget / subjectRef
- `LandClaimProject` (acquire_land / sell_land): holdingId / provinceId / counterpartyPolityId / preparation / leverage / commitment
- `ContractRevisionProject` (improve_contract_terms / demand_tax_increase): holdingId / landContractId / counterpartyPolityId / desiredTaxRateToGrantor / preparation / leverage / commitment

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

---

