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
  popGroupIds: PopGroupId[]
}
```

- `stateId`: 所属する StateRegion (v0.20)
- `habitability`: Province の基礎的な居住性・土地ポテンシャル。0 = ほぼ居住不能、100 = 非常に居住・生産に適した土地
- `holdingIds`: この Province に属する Holding の一覧 (v0.20)。各 Holding が development / polityControl を持つ
- `baseTax` / `manpower` / `unrest` は v0.8 で廃止。これらは POP から selector で算出する
- **v0.16**: `polityId` / `ownerHouseId` / `houseControl` を削除。土地支配は §3.8 LandContract chain で表現する。Province の terminal owner は selector (`getProvinceTerminalPolityId` / `getProvinceEffectiveOwnerHouseId`) で取得する
- **v0.20**: `development` / `polityControl` を Province から削除し Holding に移動。Province レベルの値は selector (`getProvinceDevelopmentFromHoldings` / `getProvincePolityControlFromHoldings`) で Holding の weight 加重平均から算出する

### 3.1b StateRegion（v0.20）

```ts
type StateRegion = {
  id: StateRegionId
  name: string
  provinceIds: ProvinceId[]
  gridCol: number
  gridRow: number
}
```

- Province をまとめる上位地理単位。UI 上の State map 表示、集計に使用
- 土地所有・契約・収入の単位ではない（それらは Holding が担う）
- State 間隣接は保存せず、selector (`getStateNeighborIds`) で Province.neighbors から動的に算出

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

### 3.2 PopClass / PopGroup（民衆集団）

```ts
type PopClass = 'peasants' | 'townsmen' | 'nobles'

type PopGroup = {
  id: PopGroupId
  provinceId: ProvinceId
  class: PopClass
  size: number       // 抽象人口規模（実人数ではない）
  wealth: number     // 0..100（豊かさ指数。金額ではない）
  unrest: number     // 0..100
  attitudes: AttitudeMap  // 対 Polity などへの態度（v0.11 / v0.15）
}
```

| class | 意味 | 主な役割 |
|-------|------|----------|
| peasants | 農民・村落民 | 人口・基礎生産・兵力の中心 |
| townsmen | 都市民・商工民 | 税収・富・都市的発展 |
| nobles | 在地貴族・有力者 | 兵力・家支配・貴族的不満 |

各 Province は必ず peasants / townsmen / nobles の 3 PopGroup を持つ。PopGroup は消滅しない（`minPopSizeByClass` で下限保証）。

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
  memberIds: PersonId[]      // 生存・死亡を問わず登録されたすべてのメンバー
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
}
```

- **v0.20**: `provinceId` → `holdingId` に変更。`startYear` を廃止し `startWeek` (absoluteWeek) に統一。term expiry は `absoluteWeek - startWeek >= termYears * WEEKS_PER_YEAR` で判定

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

### 3.9 外交劇システム (v0.18)

#### PoliticalActorRef

外交・戦争・叛乱の主体を表す共通参照。

```ts
type PoliticalActorRef =
  | { kind: 'polity'; id: PolityId }
  | { kind: 'house'; id: HouseId }
```

v0.18 では Polity actor のみ実動。House actor は型のみ。

#### ActorIntent

短期的な行動意図。毎年 IntentGenerationSystem が生成する。`createdWeek` / `expiresWeek` を absoluteWeek で保持 (v0.19)。

```ts
type ActorIntentKind =
  | 'acquire_land'
  | 'sell_land'
  | 'improve_contract_terms'
  | 'demand_tax_increase'
  | 'suppress_unrest'
  | 'revolt'
```

terminal status ('converted' / 'expired' / 'cancelled') に達した Intent は同 tick 末に削除。

#### DiplomaticPlay

外交劇本体。Intent から変換されて生成される。

```ts
type DiplomaticPlayKind =
  | 'land_claim'
  | 'contract_tax_revision'
  | 'revolt_negotiation'

type ActiveDiplomaticPlayStatus = 'active' | 'escalated'
type TerminalDiplomaticPlayStatus = 'settled' | 'failed' | 'resolved_by_conflict' | 'cancelled'
```

progress (妥協方向) / tension (緊張方向) の 2 軸で進行し、閾値到達で settlement / escalation に分岐する。`startedWeek` / `deadlineWeek` を absoluteWeek で保持 (v0.19)。terminal status に達した Play は同 tick 末に削除。

#### DiplomaticDemand

```ts
type DiplomaticDemand =
  | { kind: 'transfer_land_contract'; holdingId: HoldingId; toPolityId; beneficiaryActor? }
  | { kind: 'change_contract_tax_rate'; holdingId: HoldingId; landContractId; newTaxRateToGrantor }
  | { kind: 'pay_wealth'; from; to; amount }
  | { kind: 'revolt_concession'; provinceId; popGroupId; concessionLevel }
  | { kind: 'status_quo' }
```

#### WorldState 追加 (v0.18)

```ts
type WorldState = {
  ...
  actorIntents: Record<ActorIntentId, ActorIntent>
  diplomaticPlays: Record<DiplomaticPlayId, DiplomaticPlay>
  nextActorIntentId: number
  nextDiplomaticPlayId: number
}
```

terminal status の ActorIntent / DiplomaticPlay は tick 末の `cleanupTerminalDiplomacy` phase で state から完全削除される。履歴は Event ログに残す。

---

