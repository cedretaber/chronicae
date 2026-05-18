# Chronicae プロトタイプ仕様書

最終更新: 2026-05-18（v0.15 時点）

---

## 1. 概要

Chronicae は、個人・家・国家が自律的に動く歴史世界を観察する歴史鑑賞シミュレーションである。

プレイヤーは特定の国家・人物・家を操作しない。世界を観察する「傍観者」または「神」に近い立場であり、必要に応じて Config による間接的な調整を行う。

### 1.1 プロトタイプの検証目的

- 自律的に動く小さな歴史世界を構築できるか
- 個人・家・国家の相互作用によって、歴史らしい変化が発生するか
- プレイヤーが直接操作しなくても、観戦対象として面白いか
- seed 付き乱数による決定的リプレイが成立するか
- UI とシミュレーションコアを分離できるか

---

## 2. 技術構成

- **フロントエンド**: React + TypeScript + Vite + Tailwind CSS
- **状態管理**: Zustand
- **シミュレーションコア**: 純粋な TypeScript モジュール（React 非依存）
- **ディレクトリ構造**:
  ```
  prototype/src/
  ├── app/        # UI 層（components, stores）
  ├── cli/        # CLI モード（headless 実行）
  └── sim/        # シミュレーション層（types, tick, selectors, worldgen, rng）
  ```
- **パスエイリアス**: `@sim/*` → `prototype/src/sim/*`、`@/*` → `prototype/src/*`

### 2.1 コア関数

```ts
function tick(input: TickInput): TickResult
```

- `Math.random()` 不使用。すべての乱数は seed 付き RNG 経由
- tick は純粋関数。副作用なし
- `TickContext` はイミュータブルに更新される

### 2.2 CLI モード

ブラウザなしでシミュレーションを headless 実行できる。

```bash
cd prototype
npm run cli -- --seed <seed> --years <n> [--integrity-check] [--json]
```

コーディングエージェントがバグ検出・動作確認に利用することを想定している。

`--debug` フラグを追加すると `config.debug = true` で動作し、以下が変化する：

- **イベント出力（stdout）にエンティティ ID を付記**：`PERSON_DIED: Irmela has died at age 35. [pe-42, h-3, c-0]`
- **構造化デバッグログを stderr に出力**：`[DEBUG:TAG] key=value ...` 形式（SUCCESSION / BIRTH / MARRIAGE / HOUSE_SPLIT / HOUSE_EXTINCT / INTEGRITY / YEAR）。タグ単位で `grep` による機械的抽出が可能
- **IntegrityCheck 違反が非致死的**：例外の代わりに `[DEBUG:INTEGRITY] error=...` として stderr に出力し、シミュレーションを継続する

---

## 3. エンティティ型

### 3.1 Province（プロヴィンス）

```ts
type Province = {
  id: ProvinceId
  name: string
  x: number
  y: number
  neighbors: ProvinceId[]
  ownerHouseId: HouseId
  polityId: PolityId
  habitability: number    // 0..100
  development: number     // -100..100
  polityControl: number   // 0..100
  houseControl: number    // 0..100
  popGroupIds: PopGroupId[]
}
```

- `habitability`: Province の基礎的な居住性・土地ポテンシャル。0 = ほぼ居住不能、100 = 非常に居住・生産に適した土地
- `development`: 土地の荒廃・発展。-100 = 完全荒廃、0 = 通常、+100 = 高度発展
- `polityControl`: Polity による実効支配力
- `houseControl`: 領主 House による実効支配力
- 名目所有（`polityId` / `ownerHouseId`）は支配力が 0 になっても変わらない
- `baseTax` / `manpower` / `unrest` は v0.8 で廃止。これらは POP から selector で算出する
- **v0.15**: `polityId` / `polityControl` を `polityId` / `polityControl` に置換

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

type Polity = {
  id: PolityId
  name: string
  rank: PolityRank
  ownerHouseId?: HouseId      // 家産的保有関係: その Polity を所有する家（optional だが v0.15 worldgen では常に設定される）
  treasury: number             // >= 0
  adminPower: number           // 0..100（キャッシュ値。毎1月に GovernanceSystem が再計算）
  legacyPrestige: number       // 0..100（歴史的権威・伝統の蓄積）
  active: boolean
  lastWarMonth?: number
  capitalProvinceId: ProvinceId
}
```

- `capitalProvinceId`: 政治支配力の中心。その Polity に属する Province でなければならない
- `ownerHouseId`: その Polity を家産的に保有する House の id。Polity 内に Province を 1 つ以上所有する active House でなければならない（§6.x PolityOwnerConsistencySystem 参照）
- `rank` は v0.15 では game effect を持たない placeholder。将来の称号システムの土台
- `legitimacy`・`stability` は v0.11 で削除。セレクターで動的計算（§4.5 参照）
- `adminPower` はキャッシュ値として維持。毎1月に GovernanceSystem が `getPolityAdminPower` で再計算（§4.5 / §6.23b 参照）
- **v0.12**: `rulerHouseId` と `roleAssignments` を削除。支配者・役職担当者は `OfficeAssignment` システムで管理（§3.7 参照）。`getPolityLeader` / `getPolityLeaderHouse` セレクターで取得（§4.6 参照）
- **v0.15**: 旧 `Country` を `Polity` に rename し、`houseIds` フィールドを削除（`getPolityHouseIds` selector で動的取得）。`ownerHouseId` / `rank` を新規追加

#### Polity-House-Person 関係 (v0.15)

`House` / `Person` は Polity に所属しない。
関係は以下の selector で動的に取得する（§4.x 参照）:

- `getPolityProvinceIds(state, polityId)` — その Polity 内の Province 一覧
- `getPolityHouseIds(state, polityId)` — その Polity 内に Province を所有する active House 一覧
- `getHousePolityIds(state, houseId)` — その House が Province を持つ active Polity 一覧（複数可）
- `getHousePrimaryPolityId(state, houseId)` — House の主たる Polity（seat / Province 数で判定）

### 3.4 House（家）

```ts
type House = {
  id: HouseId
  name: string
  active: boolean
  provinceIds: ProvinceId[]
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

- `seatProvinceId`: 家支配力の中心。その House が所有する Province でなければならない
- House は常に本拠地を保持する（本拠地移転・喪失は今後の課題）
- `prestige`・`cohesion`・`loyaltyToPolity` は v0.11 で削除。セレクターで動的計算（§4.5 参照）
- **v0.12**: `headId` を削除。家長は `OfficeAssignment`（role: 'leader'）で管理。`getHouseLeader` セレクターで取得（§4.6 参照）
- **v0.15**: `polityId` フィールドを削除。House は単一 Polity に所属しない（複数 Polity に所領を持ち得る）。関係は `getHousePolityIds` selector で取得（§4.x 参照）

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
- AttitudeDecaySystem により毎月 `attitudeMonthlyRetentionRate`（0.995）倍に減衰
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

---

## 4. セレクター

### 4.1 Development セレクター

```ts
// development multiplier: clamp(1 + development / 100, 0, 2)
// development -100 → 0倍、0 → 1倍、+100 → 2倍
function getProvinceDevelopmentMultiplier(province: Province): number
```

`getEffectiveProvinceTax` / `getEffectiveProvinceManpower` は v0.8 で廃止。代わりに POP Economy セレクターを使用する。

### 4.2 POP セレクター

```ts
// Province の全 PopGroup を返す
function getProvincePops(state: WorldState, provinceId: ProvinceId): PopGroup[]

// POP size の合計（総人口）
function getProvincePopulation(state: WorldState, provinceId: ProvinceId): number

// POP wealth の人口加重平均
function getProvinceAveragePopWealth(state: WorldState, provinceId: ProvinceId): number

// POP unrest の人口加重平均
function getProvinceUnrest(state: WorldState, provinceId: ProvinceId): number

// carrying capacity: max(minProvinceCarryingCapacity, habitability * populationCapacityPerHabitability * devMod)
// devMod = clamp(1 + development / 200, 0.5, 1.5)
function getProvinceCarryingCapacity(state: WorldState, config: SimulationConfig, provinceId: ProvinceId): number

// population pressure: clamp(population / carryingCapacity, 0, 2)
function getProvincePopulationPressure(state: WorldState, config: SimulationConfig, provinceId: ProvinceId): number

// class 別の unrest を返す（該当 class の PopGroup の unrest 値。見つからない場合は 0）
function getPopUnrestByClass(state: WorldState, provinceId: ProvinceId, popClass: PopClass): number

// class 別の wealth を返す（該当 class の PopGroup の wealth 値。見つからない場合は 0）
function getPopWealthByClass(state: WorldState, provinceId: ProvinceId, popClass: PopClass): number
```

### 4.3 POP Economy セレクター

```ts
// POP 1件の生産量
// pop.size * productivityByClass[pop.class] * (pop.wealth / 100) * (province.polityControl / 100)
function getPopProduction(state: WorldState, config: SimulationConfig, popId: PopGroupId): number

// Province の総生産量（全 POP の生産量合計）
function getProvinceProduction(state: WorldState, config: SimulationConfig, provinceId: ProvinceId): number

// Province の税基盤: getProvinceProduction * (houseControl / 100)
function getProvinceTaxBase(state: WorldState, config: SimulationConfig, provinceId: ProvinceId): number

// Polity 用の Province 兵力基盤: sum(pop.size * manpowerFactorByClass[pop.class] * (polityControl / 100))
function getProvincePolityManpowerBase(state: WorldState, config: SimulationConfig, provinceId: ProvinceId): number

// House 用の Province 兵力基盤: sum(pop.size * manpowerFactorByClass[pop.class] * (houseControl / 100))
function getProvinceHouseManpowerBase(state: WorldState, config: SimulationConfig, provinceId: ProvinceId): number

// 後方互換 wrapper: getProvincePolityManpowerBase を呼ぶ
function getProvinceManpowerBase(state: WorldState, config: SimulationConfig, provinceId: ProvinceId): number
```

### 4.4 Military セレクター

```ts
// House 軍事力: (levyPower + mercenaryPower) * commanderModifier
//   levyPower       = sum(house.provinceIds.map(pid => getProvinceHouseManpowerBase(pid))) * houseManpowerPowerFactor
//   mercenaryPower  = min(log1p(max(0, wealth - reserve)) * factor, levyPower * maxMercenaryPowerRatio)
//   commanderModifier = clamp(1 + normalizedStat(bestMartial) * effect, min, max)
function calcHouseMilitaryPower(state: WorldState, config: SimulationConfig, houseId: HouseId): number

// Polity 軍事力: adminPower * factor + sum(houseContributions)
//   owner 家門は 100% 寄与。非 owner 家門は getHouseLoyaltyToPolity に応じた寄与
function calcPolityMilitaryPower(state: WorldState, config: SimulationConfig, polityId: PolityId): number
```

### 4.5 Status セレクター（v0.11 / v0.15）

v0.11 で legitimacy / stability / prestige / cohesion / loyaltyToPolity が格納フィールドから動的計算セレクターに移行した。v0.15 で Country → Polity rename。

```ts
// Polity 正統性: 0.35*personScore + 0.45*popScore + 0.2*legacyPrestige
//   personScore: Polity 関係 Person の対 Polity attitude (affection*0.35 + respect*0.65) 平均
//   popScore:    Polity 内 PopGroup の対 Polity attitude (affection*0.40 + respect*0.60) 人口加重平均
function getPolityLegitimacy(state: WorldState, polityId: PolityId): number

// Polity 安定度: Province の安定度を首都からの距離で重み付け平均
//   provinceStability = 0.70*(100-unrest) + 0.30*polityControl
//   weight = 1 / (1 + distance)  ※到達不能は distance=5 扱い
function getPolityStability(state: WorldState, config: SimulationConfig, polityId: PolityId): number

// House 結束度: 家臣メンバーの家長への attitude 平均
//   score = affection*0.45 + respect*0.55（attitudeValueToScore で 0..100 正規化）
//   メンバーが 0 の場合は fallback 50
function getHouseCohesion(state: WorldState, houseId: HouseId): number

// House 忠誠度: 家メンバーの対 Polity attitude 平均
//   score = affection*0.55 + respect*0.45
function getHouseLoyaltyToPolity(state: WorldState, houseId: HouseId): number

// Prestige = 0.70 * legacyPrestige + 0.30 * averageRespectScore
//   respectScore: 世界全体の Person/PopGroup からの attitude.respect 平均（attitudeValueToScore 正規化）
function getPolityPrestige(state: WorldState, polityId: PolityId): number
function getHousePrestige(state: WorldState, houseId: HouseId): number
function getPersonPrestige(state: WorldState, personId: PersonId): number

// Polity 行政力: 毎1月 GovernanceSystem がキャッシュ
//   0.30*adminEffectiveStat*10 + 0.20*treasurerEffectiveStat*10 + 0.20*stability + 0.20*rulerPrestige + 0.10*treasuryScore
//   各 stat は getEffectiveOfficeStat（役職担当者の能力・人数・協調ペナルティを考慮）
function getPolityAdminPower(state: WorldState, config: SimulationConfig, polityId: PolityId): number
```

**attitudeValueToScore の変換**:
- affection / respect の値 (-100..100) → score (0..100)
- 0 → 50、正 → 50+、負 → 50- の線形変換

### 4.6 Office / Share セレクター（v0.12 / v0.15）

```ts
// 指定組織・役職のアクティブ担当者 ID 一覧
function getActiveOfficeHolders(state: WorldState, org: OrganizationRef, role: OfficeRole): PersonId[]

// Polity の指導者（polity:leader Office holder）
function getPolityLeader(state: WorldState, polityId: PolityId): PersonId | undefined

// Polity の指導者の所属家
function getPolityLeaderHouse(state: WorldState, polityId: PolityId): HouseId | undefined

// 家の家長（house:leader のホルダー）
function getHouseLeader(state: WorldState, houseId: HouseId): PersonId | undefined

// 指定組織で rawPower が最も多い House（Dominant House）
function getDominantPolityHouse(state: WorldState, polityId: PolityId): HouseId | undefined

// 指定組織の上位株主一覧（holder・rawPower・percent）
function getTopShareholders(state: WorldState, org: OrganizationRef, limit?: number): Array<{ holder: ShareHolderRef; rawPower: number; percent: number }>

// House が Polity に持つ Share 割合（%）
function getHousePolitySharePercent(state: WorldState, polityId: PolityId, houseId: HouseId): number

// Person が House に持つ Share 割合（%）
function getPersonHouseSharePercent(state: WorldState, houseId: HouseId, personId: PersonId): number

// 行政キャパシティ: basePolityInstitutionalCapacity + ruler*factor + administrator*factor + treasurer*factor
function getAdministrativeCapacity(state: WorldState, config: SimulationConfig, polityId: PolityId): number

// 行政負荷: Province数 * adminLoadPerProvince + officeCount * adminLoadPerPolityOffice
function getAdministrativeLoad(state: WorldState, config: SimulationConfig, polityId: PolityId): number

// 行政効率: clamp(capacity / load, minAdministrativeEfficiency, maxAdministrativeEfficiency)
function getAdministrativeEfficiency(state: WorldState, config: SimulationConfig, polityId: PolityId): number
```

### 4.6b Polity 関係 selector（v0.15）

House / Person が Polity に所属しない設計（§3.3 参照）のため、関係取得は `prototype/src/sim/selectors/polityRelations.ts` の selector に集約する。

```ts
// Province → Polity / House
function getProvincePolity(state: WorldState, provinceId: ProvinceId): Polity | undefined
function getProvinceOwnerHouse(state: WorldState, provinceId: ProvinceId): House | undefined

// Polity 内 Province / House / Person
function getPolityProvinceIds(state: WorldState, polityId: PolityId): ProvinceId[]
function getPolityHouseIds(state: WorldState, polityId: PolityId): HouseId[]
// ↑ Polity 内に Province を 1 つ以上所有する active House の集合
function getPolityPersonIds(state: WorldState, polityId: PolityId): PersonId[]
// ↑ Polity 関係 House の alive member。複数 Polity 跨ぎ House の人物は重複可

// House → Polity
function getHouseProvinceIdsByPolity(state: WorldState, houseId: HouseId, polityId: PolityId): ProvinceId[]
function getHousePolityIds(state: WorldState, houseId: HouseId): PolityId[]
// ↑ House が Province を所有している active Polity 一覧
function getHousePrimaryPolityId(state: WorldState, houseId: HouseId): PolityId | undefined
// ↑ 表示・候補選定用の便宜的 primary Polity
//   1) house.seatProvinceId の polity を最優先
//   2) Province 数が最大の Polity
//   3) 同数なら development 合計が最大
//   4) それも同じなら PolityId 昇順

// Person → Polity
function getPersonRelevantPolityIds(state: WorldState, personId: PersonId): PolityId[]
function getPersonPrimaryPolityId(state: WorldState, personId: PersonId): PolityId | undefined

// House の Polity 内拠点（capital 移転や Polity 内中心地を求めるとき）
function getHouseSeatProvinceInPolity(
  state: WorldState,
  houseId: HouseId,
  polityId: PolityId,
): ProvinceId | undefined
//   1) house.seatProvinceId が対象 Polity 内なら、それを返す
//   2) そうでなければ Polity 内の所有 Province から development 最大を選ぶ
```

### 4.7 Ability / 派生 selector（v0.14）

`prototype/src/sim/selectors/abilitySelectors.ts` に集約。

```ts
export type AppliedRoleKey =
  | 'governance'
  | 'stewardship'
  | 'diplomacy'
  | 'intrigue'
  | 'warCommand'

// 応用ロールの基礎能力からの重み付き和を返す（0..120 を保証、ABILITY_HARD_CAP でクランプ）
function getRoleScore(state: WorldState, personId: PersonId, role: AppliedRoleKey): number

// 能力 k における年齢 age での「自然到達水準」を返す（0..1 の係数）
// 各能力の AGE_CURVE （lifelongGrowth / youthPeak / midLifePeak）に基づく
function naturalFraction(k: AbilityKey, age: number, config: SimulationConfig): number

// aptitude（才能上限）を独立ガウス分布でサンプル。値域 [0, ABILITY_GENERATION_MAX=100]
function sampleAptitudes(rng: RngState, config: SimulationConfig): RngResult<AbilityScores>

// 両親平均と populationMean(=50) を heritability で混合して子の aptitude を生成
function inheritAptitudes(father: Person, mother: Person, rng: RngState, config: SimulationConfig): RngResult<AbilityScores>

// 年齢曲線に基づき aptitude * naturalFraction(age) を中央値として ability をサンプル
// 不変条件: ability ≤ aptitude
function sampleAbilitiesFromAptitudes(aptitudes: AbilityScores, age: number, rng: RngState, config: SimulationConfig): RngResult<AbilityScores>

// 能力 k について、当該 person が「関連経験」を持つか判定（PersonGrowthSystem の effectiveCeiling 切替に使用）
function hadRelevantExperience(state: WorldState, personId: PersonId, k: AbilityKey): boolean
```

**ROLE_WEIGHTS（応用ロールの定義）**:

```ts
governanceScore   = numeracy*0.30 + learning*0.30 + charisma*0.20 + insight*0.20
stewardshipScore  = numeracy*0.60 + learning*0.20 + insight*0.20
diplomacyScore    = charisma*0.50 + insight*0.30 + learning*0.20
intrigueScore     = insight*0.70 + charisma*0.20 + learning*0.10
warCommandScore   = command*0.60 + insight*0.20 + learning*0.10 + valor*0.10
```

* 既存システム（successionSelectors / personAbilityEffects / militarySelectors / officeSelectors / publicSpendingSystem / plotSystem 等）は `getRoleScore(state, p.id, role) / 10` で正規化して旧 admin/martial（0..10）相当のスケールに揃える
* 通常範囲は 0..10、限界突破帯（v0.15 以降の機構）では最大 12

---

## 5. Tick システム順序

毎月 1 回 tick が実行される。以下の順序でシステムが動く：

| 順序 | システム | 頻度 |
|------|----------|------|
| 1 | advanceTime | 毎月 |
| 2 | DevelopmentSystem | 毎月 |
| 3 | ControlSystem | 毎月 |
| 4 | LordshipTransitionSystem | 毎月 |
| 5 | **PopSystem** | 毎月 |
| 6 | EconomySystem | 毎月 |
| 7 | DisasterSystem | 毎年1月 |
| 8 | MortalitySystem | 毎月 |
| 8b | **EstateSettlementSystem** (v0.14) | 毎月 |
| 9 | SuccessionSystem | 毎月 |
| 10 | MarriageSystem | 毎年1月 |
| 11 | BirthSystem | 毎年1月 |
| 12 | **ShareUpdateSystem** | 毎年1月 |
| 13 | AppointmentSystem | 毎年1月 |
| 14 | **OfficeCompensationSystem** | 毎年1月 |
| 14b | **PersonGrowthSystem** (v0.14) | 毎年1月（誕生月以外 no-op） |
| 15 | AmbitionSystem | 毎月 |
| 16 | PublicSpendingSystem | 毎年1月 |
| 17 | HouseDevelopmentSystem | 毎年1月 |
| 18 | **PopDevelopmentSystem** | 毎月 |
| 19 | PlotSystem | 毎月 |
| 20 | WarSystem | 毎月 |
| 21 | **ProvinceRevoltSystem** | 毎月 |
| 22 | RebellionSystem | 毎月 |
| 22b | **PolityOwnerConsistencySystem** (v0.15) | 毎月 |
| 22c | **OrganizationConsistencySystem** (v0.15) | 毎月 |
| 23 | **AttitudeDecaySystem** | 毎月 |
| 24 | GovernanceSystem | 毎年1月 |
| 25 | normalizePopSizes | 毎月 |
| 26 | IntegrityCheck | 毎月 |

v0.15 で挿入された Consistency 系 2 つは、War / Rebellion / ProvinceRevolt 等の所領変動 system の **直後** に走り、所領異動の結果生じた Polity の owner / capital / Share / Office の整合性を即座に補正する。

詳細は §6.22b / §6.22c 参照。

順序の理由：PopSystem を EconomySystem より前に置くことで、当月の POP 状態変化（人口成長・pressure・wealth/unrest）を反映して生産量を計算する。ShareUpdateSystem を BirthSystem の後・AppointmentSystem の前に置くことで、最新の人口・家構成を反映した Share 計算結果に基づいて役職候補評価が行われる。OfficeCompensationSystem を AppointmentSystem の直後に置くことで、当年に任命された役職への給与支払いが即座に処理される。PopDevelopmentSystem を Polity/House 開発システムより後に置くことで、当月の収入分配後に POP に残った余剰富による地元の自主開発を表現する。ProvinceRevoltSystem を RebellionSystem の前に置くことで、Province / POP 起点の社会不安が House 反乱に波及する経路を表現する（ただし同一 tick での直接連鎖はしない）。AttitudeDecaySystem を反乱・revolt の後に置くことで、各システムが当月に書き込んだ態度変化が減衰前に反映される。GovernanceSystem（adminPower キャッシュ計算）は1月のみ実行され、次の1年間の各システムで使われる。

---

## 6. 各システムの仕様

### 6.1 DevelopmentSystem（毎月）

全 Province に対して自然減衰・回復を適用：

```
development > 0 → development = max(0, development - developmentPositiveMonthlyDecay)
development < 0 → development = min(0, development + developmentNegativeMonthlyRecovery)
結果を clamp(-100, 100)
```

### 6.2 ControlSystem（毎月）

Polity ごとに首都から BFS、House ごとに本拠地から BFS を行い、各 Province の支配力を更新する。

**支配力上限（二段階 clamp）**:

```ts
// 距離ベースの上限
baseMaxControl = clamp(100 - distance * controlMaxDistancePenalty, controlMaxMinimum, 100)
// 能力補正後の上限（能力最低床を別途設定）
maxControl = clamp(baseMaxControl + maxControlBonus, controlAbilityMinimumFloor, 100)
// 首都 / 本拠地は常に上限 100
```

`maxControlBonus` は Polity administrator（polityControl）・家長 house:leader（houseControl）の admin stat から算出される（§10 参照）。

**到達可能な Province**:

```ts
if (control < maxControl) control = Math.min(control + effectiveGrowth, maxControl)
if (control > maxControl) control = Math.max(control - controlDecayPerMonth, maxControl)
```

`effectiveGrowth = controlGrowthPerMonth * growthModifier`（Polity administrator・家長 house:leader の admin stat による）。

**到達不能な Province**（飛び地など）:

```ts
control = Math.max(0, control - disconnectedControlDecayPerMonth)
```

BFS 通行条件:
- polityControl: 首都から同一 Polity の Province のみ通行可
- houseControl: 本拠地から同一 Polity の Province（他 House 領も通行可）。更新対象はその House の Province のみ

### 6.3 LordshipTransitionSystem（毎月）

隣接する強力な領主による Province 吸収を処理する。スナップショットパターンで実装（連鎖防止）。

**target の条件**:
- `target.houseControl < lordshipAbsorptionTargetThreshold`
- `target.id !== ownerHouse.seatProvinceId`

**neighbor 候補の条件**:
- `neighbor.polityId === target.polityId`
- `neighbor.ownerHouseId !== target.ownerHouseId`
- `neighbor.houseControl >= lordshipAbsorptionSourceMinimum`
- `neighbor.houseControl >= target.houseControl * lordshipAbsorptionRatio`

最高 houseControl の neighbor を採用（同値はランダム）。確率 `lordshipAbsorptionMonthlyChance` で発動。

**効果**:
```
target.ownerHouseId = neighbor.ownerHouseId
target.houseControl = clamp(neighbor.houseControl - penalty, newControlMin, newControlMax)
```

イベント: `LORDSHIP_TRANSFERRED`（importance: `minor`）
```
summary: "${新House.name} absorbed ${province.name} from ${旧House.name}."
```

### 6.4 PopSystem（毎月）

POP の月次自然変化を処理する。Province の carrying capacity に基づいた人口圧制御、wealth/unrest の自然変化を担当する。

**6.4.1 人口成長**

```ts
const pressure = getProvincePopulationPressure(state, config, province.id)
const growthFactor = clamp(1 - pressure, -0.5, 1.0)
const baseGrowth = config.baseMonthlyGrowthByClass[pop.class]
const wealthFactor = clamp(0.5 + pop.wealth / 100, 0.5, 1.5)
const unrestFactor = clamp(1 - pop.unrest / 150, 0.3, 1)
const delta = pop.size * baseGrowth * growthFactor * wealthFactor * unrestFactor
```

**6.4.2 population pressure の影響**

pressure が閾値を超えると土地不足・過密に相当する影響が発生する：

```ts
if (pressure > config.populationPressureThreshold) {
  const excess = pressure - config.populationPressureThreshold
  pop.wealth -= excess * config.populationPressureWealthPenalty
  pop.unrest += excess * config.populationPressureUnrestGain
}
```

**6.4.3 poverty / prosperity 効果**

```ts
// 貧困: wealth が低い POP は不満が上がりやすい
if (pop.wealth < config.povertyWealthThreshold) {
  pop.unrest += (config.povertyWealthThreshold - pop.wealth) * config.povertyUnrestGain
}
// 繁栄: wealth が高い POP は不満が下がりやすい
if (pop.wealth > config.prosperityWealthThreshold) {
  pop.unrest -= (pop.wealth - config.prosperityWealthThreshold) * config.prosperityUnrestReduction
}
```

**6.4.4 clamp**

```ts
pop.size = Math.max(config.minPopSizeByClass[pop.class], pop.size + delta)
pop.wealth = clamp(pop.wealth, 0, 100)
pop.unrest = clamp(pop.unrest, 0, 100)
```

**normalizePopSizes**（IntegrityCheck 直前）: 全 POP について `size < minPopSizeByClass[class]` の場合、最低値に切り上げる。疫病・戦争などでサイズが最低値を下回った場合のフェイルセーフ。

### 6.5 EconomySystem（毎月）

Province ごとに POP の生産量を算出し、支配力に基づいて国・家・POP に富を分配する。

**6.5.1 生産量算出**

```ts
const production = getProvinceProduction(state, config, province.id)
// = sum(pop.size * productivityByClass[pop.class] * (pop.wealth/100) * (polityControl/100))
```

**6.5.2 回収式**

支配力不足によるロスの思想は維持する。ロス分は POP に残る富となる。

```ts
const cc = province.polityControl / 100
const hc = province.houseControl / 100
const totalControl = cc + hc

if (totalControl > 0) {
  polityIncome = production * (cc / totalControl) * cc
  houseIncome   = production * (hc / totalControl) * hc
}

const extracted = polityIncome + houseIncome
const retained  = Math.max(0, production - extracted)
```

支配力の例（Province 生産量 100 の場合）:
| polityControl | houseControl | 国収入（taxEfficiency=1） | 家収入 | POP 残留 |
|---|---|---|---|---|
| 100 | 100 | 50 | 50 | 0 |
| 100 | 50 | 66.7 | 16.7 | 16.6 |
| 50 | 50 | 25 | 25 | 50 |
| 100 | 0 | 100 | 0 | 0 |

**6.5.3 Polity treasurer の taxEfficiency**

国庫収入には Polity treasurer の能力補正が乗算される（§10 参照）。POP から余分に徴収するのではなく、徴収・輸送・汚職抑制の効率を表す。

```ts
polity.treasury += polityIncome * taxEfficiency
house.wealth     += houseIncome
```

**6.5.4 retained wealth の POP 反映**

回収されなかった富は `retainedRatio * retainedWealthGainByClass[class]` として POP wealth に反映される：

```ts
const retainedRatio = production > 0 ? retained / production : 0
// POP class ごとに adjustProvincePopWealthByClass で適用
```

**6.5.5 過剰徴収ペナルティ**

高支配地域での高徴収は正常だが、POP が貧しく不満を抱えている場合にのみペナルティが発生する：

```ts
if (
  extractionRatio > config.overExtractionThreshold &&
  (averageWealth < config.overExtractionWealthSafeThreshold ||
   provinceUnrest > config.overExtractionUnrestSafeThreshold)
) {
  const over = extractionRatio - config.overExtractionThreshold
  adjustProvincePopWealth(state, province.id, -over * config.overExtractionWealthPenalty)
  adjustProvincePopUnrest(state, province.id, over * config.overExtractionUnrestGain)
}
```

### 6.6 DisasterSystem（毎年1月）

国家ごとに独立して判定。同一国に複数の災害が同時発生し得る。

| 災害 | 確率 | 効果 |
|------|------|------|
| Famine（飢饉） | `famineBaseChancePerYear` (8%) | Province dev 低下、treasury 消費（救済）、peasants wealth/size 低下 |
| Plague（疫病） | `plagueBaseChancePerYear` (3%) | Province dev 低下、全 POP wealth/size 低下 |
| BountifulHarvest（豊作） | `bountifulHarvestBaseChancePerYear` (5%) | Province dev 上昇、peasants/townsmen wealth 上昇・unrest 低下 |

**Famine の詳細**:
- 救済判定: `polity.treasury >= polityProvinceCount * disasterReliefCostPerProvince`
- 救済あり: dev -= (famineDevastation - famineReliefDevelopmentRecovery)、polity.legacyPrestige +1、POP 効果を `famineReliefDamageMultiplier`（0.3）倍に軽減
- 救済なし: dev -= famineDevastation、POP 効果フル適用
- POP 効果: `adjustProvincePopWealthByClass(state, pid, 'peasants', -famineWealthPenalty * multiplier)` / `adjustProvincePopSizeByClass(state, pid, 'peasants', -famineSizeDamage * multiplier)`

**Plague の詳細**:
- `adjustProvincePopWealth(state, pid, -plagueWealthPenalty)`（全 POP）
- `adjustProvincePopSize(state, pid, -plagueSizeDamage)`（全 POP）

**BountifulHarvest の詳細**:
- treasury への直接加算なし。翌月以降の EconomySystem で POP production 上昇により国庫が増加する
- `adjustProvincePopWealthByClass(state, pid, 'peasants', +bountifulHarvestPeasantWealthGain)`
- `adjustProvincePopUnrestByClass(state, pid, 'peasants', -bountifulHarvestPeasantUnrestReduction)`
- `adjustProvincePopWealthByClass(state, pid, 'townsmen', +bountifulHarvestTownsmanWealthGain)`
- `adjustProvincePopUnrestByClass(state, pid, 'townsmen', -bountifulHarvestTownsmanUnrestReduction)`

### 6.7 MortalitySystem（毎月）

人物の自然死亡を処理。死亡が確定した Person について `markPersonDead` mutation を呼び、以下を一括で処理する（v0.13）：

1. `person.alive = false`
2. `clearSpouse` で配偶者側の `spouseId` も解除
3. `revokeOfficesByHolder` で当人が保有する全 OfficeAssignment を inactive 化

家長（house:leader）が死亡した場合の後継選出は SuccessionSystem（§6.10）が担当する。

**v0.14**: 死亡者の `wealth` 分配は直後の EstateSettlementSystem（§6.7b）が処理する。MortalitySystem は死者を `TickContext.deathsThisTick` に追記し、`wasHouseLeader` / `wasPolityLeader` の役職情報を `TickContext.deathRolesThisTick` に保存して estate 処理に引き継ぐ（mortalitySystem 内で role を取得しないと markPersonDead が office を revoke するため後段では復元できない）。

### 6.7b EstateSettlementSystem（毎月、v0.14）

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
* 家に所属していない人物（v0.14 では稀）は houseRecoveryRate = 0 で全額相続人へ

**相続人決定（`findHeirs`）**: 最初にマッチした集合で確定:
1. 嫡出子のうち alive な者 全員
2. 配偶者（alive）
3. 嫡出兄弟姉妹（同 fatherId / alive / 同 house）
4. 家長（自分自身が家長だった場合は除外）
5. なし → wealth は全額家に回収（家もなければ消滅）

相続人は age 降順 + id 昇順 でソート（決定論性保持）。端数は最年長相続人 `heirs[0]` に寄せる。

**Mutation API**: `addPersonWealth`, `clearPersonWealth`, `addHouseWealth`（§12.2 参照）。

**イベント**:
* `ESTATE_SETTLED` は対象人物ごとに必ず発火
* 加えて、嫡出子 2 人以上または兄弟相続で 2 人以上の場合は `ESTATE_DISPUTED` を ESTATE_SETTLED と並んで追加発火（v0.14 では記録のみ、後続処理なし）
* importance: 故人が polity leader だった場合 `major`、家長または `wealth ≥ house.wealth * estateSettledNormalWealthRatio` の場合 `normal`、それ以外 `minor`

`deathsThisTick` と `deathRolesThisTick` は次 tick の `advanceTime` で空にリセットされる。

### 6.8 MarriageSystem（毎年1月）

`marriageEnabled` が true のとき動作。未婚の男性候補を一覧し、それぞれに対して婚姻判定を行う。

- **候補条件（男性）**: 生存・未婚・対象年齢（`marriageMaleMinAge`〜`marriageMaleMaxAge`）・所属家が active
- **候補条件（女性）**: 生存・未婚・対象年齢（`marriageFemaleMinAge`〜`marriageFemaleMaxAge`）・所属家が active
- **禁止組み合わせ**: 同一家・近親関係（`isForbiddenMarriagePair` によるチェック）
- **同 Polity 婚ボーナス**（v0.15）: `getPersonPrimaryPolityId` で primary Polity を取得し、男女で一致なら `samePrimaryPolityMarriageBonus`（+0.08）を加算
- **異 Polity 婚ペナルティ**（v0.15 で廃止）: 「単一 Polity 所属を強要しない」設計のためペナルティは加えない

婚姻成立時の処理：
- 女性が男性の家に `movePersonToHouse` で移動
- `spouseId` を双方向に設定（`setSpouse`）
- `house.memberIds` に女性を追加

イベント: `MARRIAGE_FORMED`（importance: `normal`）

### 6.9 BirthSystem（毎年1月）

`birthEnabled` が true のとき動作。対象年齢（`fatherMinChildAge`〜`fatherMaxChildAge`）の生存男性を走査し、出生判定を行う。

**出生確率補正**:
```
livingCount <= criticalLivingPersons → birthMultiplier = criticalPopulationBirthMultiplier (3.0)
livingCount < targetLivingPersons   → birthMultiplier = lowPopulationBirthMultiplier (1.5)
それ以外                              → birthMultiplier = 1.0
birthChance = baseBirthChancePerMalePerYear * birthMultiplier
```

**母親の決定**:
- 配偶者が対象年齢（`motherMinChildAge`〜`motherMaxChildAge`）の場合、`spouseMotherChance`（0.9）で嫡出子
- それ以外は非嫡出子（`illegitimate`）として処理

**性別の決定**:
- 成人男性が全人口の 40% 未満の場合: `maleBirthChanceWhenAdultMaleShortage`（0.65）
- それ以外: `maleBirthChance`（0.52）

誕生した子：
- `houseId` は父親と同じ
- `fatherId` / `motherId` を設定（嫡出の場合）
- 父・母の `childIds` に追加
- `house.memberIds` に追加

イベント: `CHILD_BORN`（importance: `minor`）

### 6.10 SuccessionSystem（毎月）

家長（house:leader の OfficeAssignment ホルダー）が死亡または存在しない場合、生存メンバーから新家長を選出。

**後継者選出（成人候補あり）**:
- `getAdultSuccessionCandidates` で成人（age >= `adultAge`）かつ生存の家メンバーを列挙
- スコアが最高の候補を後継者に選ぶ
- スコア 2 位との差が `successionCrisisScoreGap` を超える場合、`SUCCESSION_CRISIS` イベントを発火
- 継承後に `maybeSplitHouseAfterSuccession` を呼び出す（§6.11 参照）

**後継者選出（未成年のみ）**:
- 最年長の未成年を仮の家長に任命
- 未成年当主ペナルティ（§6.12 参照）が以後毎月適用される

**後継者なし**: `extinctHouseAfterFailedSuccession`（§6.13 参照）を呼び出す。

家長交代は `house:leader` の OfficeAssignment を新設し、旧ホルダーの assignment を inactive にすることで記録する。`HOUSE_LEADER_CHANGED` イベントを発火（v0.12）。

### 6.11 HouseSplitSystem（SuccessionSystem から呼び出し）

継承が発生した際に、分裂条件を満たせば家の分裂を実行する。実体の状態書き換えは `splitHouse` mutation（`worldStructureMutations.ts`）に集約されている（v0.13）。

**分裂条件（AND）**:
1. `houseSplitEnabled: true`
2. `house.provinceIds.length >= minProvincesForHouseSplit`（デフォルト 3）
3. `splitCandidates.length >= 1`（後継者以外の成人候補が存在する）
4. `getHouseCohesion(house) < houseSplitCohesionThreshold`（デフォルト 60）

**分裂確率**:
```
currentCohesion = getHouseCohesion(house)   // Attitude から動的計算（§4.5 参照）
splitChance = baseHouseSplitChance
            + splitter.ambition        * houseSplitAmbitionFactor
            + splitter.legacyPrestige  * houseSplitPrestigeFactor
            + (getRoleScore(state, splitter.id, 'warCommand') / 10) * houseSplitMartialFactor   // v0.14: 旧 splitter.martial
            - currentCohesion          * houseSplitCohesionFactor
```

分裂実行時の処理：
- 新 House を生成（`id: h-{parentId}-{year}`）
- 分裂者・その配偶者・子を新 House の `memberIds` に設定
- Province の一部（`houseSplitControlMin`〜`houseSplitControlMax` の割合）を新 House に移管
- 元 House の `cadetHouseIds` に追加、新 House の `parentHouseId` を設定
- 国の `houseIds` に新 House を追加

イベント: `HOUSE_SPLIT`（importance: `major`）+ `SUCCESSION_CRISIS`（importance: `major`）

**cohesion（結束度）について**:
- v0.11 より `house.cohesion` フィールドは廃止。`getHouseCohesion` セレクターで動的計算（§4.5 参照）
- 結束度は家メンバーの家長への attitude から計算されるため、態度変化イベントにより自然に変動する

### 6.12 未成年当主ペナルティ（SuccessionSystem 内）

当主が未成年（age < `adultAge`）の間、毎月適用。v0.11 以降は格納フィールドの直接変更ではなく、Attitude の調整を通じて cohesion・loyaltyToPolity に間接影響を与える（実装上は `minorHeadCohesionPenaltyPerMonth` / `minorHeadLoyaltyPenaltyPerMonth` の config 値が引き続き参照される）。

### 6.13 HouseExtinctionSystem（SuccessionSystem から呼び出し）

後継者が存在しない家（生存メンバーが 0 または全員未成年かつ成人後継者なし）に対して断絶処理を行う。実体の状態書き換えは `extinctHouse` mutation（`worldStructureMutations.ts`）に集約されている（v0.13 / v0.15）。

**v0.15 §22.3 affectedPolityIds スナップショット**:

```ts
type HouseExtinctionInput = {
  houseId: HouseId
  affectedPolityIds: PolityId[]  // 喪失前の getHousePolityIds スナップショット
}
```

呼び出し側で所領喪失前の Polity 集合を取得しておき、メンバー移住先選定のスコープとして使う。

**移住先 House の選定（v0.15 §22.3）**:

1. `affectedPolityIds` 内で最大 Province 数を持つ active House
2. `affectedPolityIds` 内で最大 Polity Share を持つ active House
3. 旧 `seatProvinceId` に隣接する Province の ownerHouse
4. 世界全体で最大 Province 数を持つ active House
5. 見つからない場合、メンバーは inactive のまま House 解散（後段 IntegrityCheck の Person/House 整合チェック対象になる）

選定後の処理:
- `moveLivingMembersToHouse` で生存メンバーを継承先に移動
- 断絶家の Province を継承先に `transferProvinceToHouse` で移管
- 断絶家を `active: false`、`memberIds: []` に設定

**Polity の inactive 化は HouseExtinctionSystem で行わない**（v0.15）:
v0.14 では `handleRulerHouseExtinction` が ruler house extinct で Country を消滅させていたが、v0.15 ではこれを削除。Polity の active 制御は §6.22b PolityOwnerConsistencySystem に一本化する。
これにより HouseExtinction → 所領消失 → 当月内に PolityOwnerConsistency が owner 補充または `POLITY_EXTINCT` 発火、という分離した責務になる。

イベント: `HOUSE_EXTINCT`（importance: `major`）

### 6.14 AppointmentSystem（毎年1月）

Polity と House それぞれの役職（leader 以外の 4 種）に対して、空席を最適候補で補充する。

**対象役職**:
- Polity: administrator / treasurer / military / advisor
- House: administrator / treasurer / military / advisor
- leader は AppointmentSystem が直接補充しない（SuccessionSystem が担当）

**候補スコア（Polity 役職）**:
```ts
// v0.15 §13.4 で更新されたスコア式
score = relevantStat(role) * 1.0          // military → warCommand、他 → governance（v0.14 派生 selector）
      + (prestige / 100) * 8              // getPersonPrestige (v0.15: 10→8)
      + leaderRespect * 4                 // polity leader の attitude.respect（0..1 正規化）(v0.15: 5→4)
      + polityAffection * 3               // 候補者の対 Polity attitude.affection
      + houseSharePct * polityShareAppointmentFactor  // v0.15: 候補者の家の Polity Share 割合（既定 0.25）
      + personSharePct * houseShareAppointmentFactor  // v0.15: 候補者個人の House Share 割合（既定 0.08）
      + ownerHouseBonus                   // v0.15: 候補者の家が polity.ownerHouseId なら ownerHouseAppointmentBonus（既定 4）
      - concurrentOfficePenalty * currentOfficeCount  // 兼任ペナルティ（個人単位）
      - sameHousePolityOfficePenalty * sameHousePolityOfficeCount  // v0.15: 同 House の Polity Office 数（既定 2）
```

**v0.15 §13.2 候補者条件**: alive 成人 / active House 所属 / 同 role を未保有 / 以下のいずれか:
1. その House が対象 Polity 内に Province を所有する
2. その House が対象 Polity の `ownerHouseId` である（owner が一時的に Province を失っていても候補に残す）

**候補スコア（House 役職）**:
```ts
score = relevantStat(role) * 1.0
      + (prestige / 100) * 10
      + leaderRespect * 5                // 家長の attitude.respect
      + houseAffection * 3              // 候補者の対 House attitude.affection
      + personSharePct * 0.1            // 候補者の House Share 割合
      - concurrentOfficePenalty * currentOfficeCount
```

**任命判定**:
- 最高スコア候補が `minAppointmentScore` 未満の場合は任命しない（空席を維持）
- 最高スコア候補が `maxHolders` に達していない空席を補充する（既存担当者は交代させない）
- 死亡者の役職は自動的に revoke される

**イベント**: `OFFICE_ASSIGNED`（importance: `normal`）

### 6.14b OfficeCompensationSystem（毎年1月）

アクティブな OfficeAssignment に対して、`baseSalary`（§3.7 参照）に基づく給与を支払う。

- 支払元: Polity 役職 → `polity.treasury`、House 役職 → `house.wealth`
- 支払先: `person.wealth += paid`
- 資金不足時は部分支払いまたは未払い
- 未払い・部分支払い時: `office.unpaidCount` を増加し、Person の Attitude（対 Polity / 対 House の affection・respect）にペナルティを付与
  - ペナルティは `officeDignityUnpaidPenaltyReduction` × dignity 値で軽減
- `unpaidCount` が 0 の完全支払い時にはリセット

**イベント**: `OFFICE_SALARY_UNPAID`（importance: `minor`）/ `OFFICE_SALARY_PARTIALLY_PAID`（importance: `minor`）

### 6.14c ShareUpdateSystem（毎年1月）

Polity・House それぞれの Share 分布を毎年更新する。

**Polity Share 更新（House ホルダーの Share を計算）**:
```ts
// v0.15 §12.3: 計算は対象 Polity 内の local power に限定する。
// 別 Polity の所領で当該 Polity の Share が膨らむことを防ぐ。
newRawPower = polityShareBase
            + ownedProvinceCountInPolity * polityShareProvinceFactor     // v0.15: 対象 Polity 内に限定
            + localMilitaryProxy * polityShareMilitaryFactor             // v0.15: 対象 Polity 内 Province から算出
            + house.wealth * polityShareWealthFactor
            + house.legacyPrestige * politySharePrestigeFactor
            + polityOfficeCount * polityShareOfficeFactor
            + (isOwnerHouse ? polityShareOwnerHouseBonus : 0)             // v0.15: polity.ownerHouseId と一致なら
```

既存 Share との統合: `rawPower = oldPower * shareYearlyRetentionRate + newRawPower * (1 - shareYearlyRetentionRate)`

**v0.15 §12.2 削除責務**: ShareUpdateSystem は不適格 Share の削除を **行わない**。削除責任は §6.22c OrganizationConsistencySystem に一本化されている。

**House Share 更新（Person ホルダーの Share を計算）**:
```ts
newRawPower = houseShareBase
            + (isLeader ? houseShareLeaderBonus : 0)
            + houseOfficeCount * houseShareOfficeBonus
            + person.legacyPrestige * houseSharePrestigeFactor
            + person.wealth * houseShareWealthFactor
            + (governance + warCommand) * houseShareStatFactor
            // v0.14: 旧 (admin + martial) は getRoleScore(governance + warCommand) / 10 に置換
```

**イベント**: `SHARE_SHIFTED`（importance: `minor`）— Share 分布に有意な変化があった場合

### 6.14d PersonGrowthSystem（毎年1月、v0.14）

`OfficeCompensationSystem` の直後・`AmbitionSystem` の前に実行。誕生月（`currentMonth === 1`）以外は no-op で early return。

毎年 1 月に全 alive Person の 6 基礎能力それぞれについて、**成長判定** と **衰退判定** を行う。

**成長判定**:
```ts
const naturalCeil    = aptitude[k] * naturalFraction(k, age, config)
const effectiveCeil  = hadRelevantExperience(state, personId, k) ? aptitude[k] : naturalCeil
if (ability[k] < effectiveCeil) {
  const gainChance = abilityGrowthChanceBase * (1 - ability[k] / effectiveCeil)
  if (rng < gainChance / 100) ability[k] = min(ability[k] + 1, ABILITY_HARD_CAP)
}
```

* **経験あり** → `effectiveCeil = aptitude[k]`（能力は aptitude を目指して伸びる）
* **経験なし** → `effectiveCeil = naturalCeil`（年齢曲線の自然到達水準で頭打ち）

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
| 戦争 active 期間中（12 ヶ月以内に lastWarMonth）の在国 | valor, command |
| PlotSystem の active リーダー | insight |

### 6.15 AmbitionSystem（毎月）

人物・家ごとに野心スコアを計算し、将来の陰謀・反乱の素地を作る。

### 6.16 PublicSpendingSystem（毎年1月）

`publicSpendingYearlyChance`（35%）で発動。monumentScore vs landDevelopmentScore を比較し実行：

スコア計算に Polity administrator の ability 補正が加算される（§10 参照）:
```
monumentScore      += chancellorAmbitionMonumentScoreBonus + chancellorCautionMonumentScoreBonus
landDevelopmentScore += chancellorCautionLandDevelopmentScoreBonus + chancellorAmbitionLandDevelopmentScoreBonus
```

**記念碑建設（MONUMENT_BUILT）**:
- 条件: monumentScore > landDevelopmentScore かつ treasury >= monumentBaseCost
- 対象 Province: 首都から接続済み、polityControl < 100 の中から最高スコアで選択
- 効果: treasury -= monumentBaseCost、**polityControl += monumentPolityControlGain**、legitimacy += monumentLegitimacyGain、rulerHouse.prestige += 2

**Polity土地開発（COUNTRY_LAND_DEVELOPED）**:
- 条件: treasury >= effectiveCost（Polity treasurer の admin による割引あり）
- 効果: development += gain（clamp）、**houseControl += landDevelopmentHouseControlGain**、treasury -= effectiveCost

### 6.17 HouseDevelopmentSystem（毎年1月）

`houseDevelopmentEnabled` が true のとき動作。全 active House に対して：

- 条件: `house.wealth >= houseLandDevelopmentBaseCost + houseWealthReserve`
- 発動確率:
  ```
  chance = clamp(houseDevelopmentYearlyChance + wealthBonus + abilityChanceBonus, 0, 1)
  wealthBonus      = clamp((wealth - cost - reserve) / 300, 0, 0.25)
  abilityChanceBonus = 家長 admin / caution による補正（§10 参照）
  ```
- 効果:
  ```
  effectiveGain = houseLandDevelopmentGain * (1 - max(0, development) / 100)
  development += effectiveGain（clamp）
  houseControl += landDevelopmentHouseControlGain（clamp）
  house.wealth -= houseLandDevelopmentBaseCost
  ```
- イベント: `HOUSE_LAND_DEVELOPED`

### 6.18 PopDevelopmentSystem（毎月）

`popDevelopmentEnabled` が true のとき動作。地元共同体・都市民・在地有力者による小規模な土地改善を表す。

POP 自主開発は Polity / House 開発より明確に弱く、局所的・低効率に留める：

| 開発主体 | development gain | 財源 |
|----------|-----------------|------|
| POP | +0.25（微少） | Province に残った POP wealth |
| House | +6 | House wealth |
| Polity | +8 以上 | Polity treasury |

**発動条件**:
```ts
if (averageWealth < config.popDevelopmentWealthThreshold) continue
if (unrest > config.popDevelopmentUnrestMax) continue
if (province.development >= config.popDevelopmentMaxDevelopment) continue
```

**発動確率**:
```ts
chance = clamp(
  popDevelopmentMonthlyChance
    + (averageWealth - popDevelopmentWealthThreshold) * popDevelopmentWealthChanceFactor
    - unrest * popDevelopmentUnrestPenaltyFactor,
  0,
  popDevelopmentMaxMonthlyChance,
)
```

**効果**:
```ts
province.development += popDevelopmentGain  // clamp(-100, 100)
adjustProvincePopWealth(state, province.id, -popDevelopmentCost)
```

polityControl / houseControl には影響しない。

イベント: `POP_LAND_DEVELOPED`（importance: `minor`）
```
summary: "The people of ${province.name} improved their lands."
```

### 6.19 PlotSystem（毎月）

野心スコアが `plotThreshold` を超えた人物が陰謀を実行。成功率 `basePlotSuccess`。

### 6.20 WarSystem（毎月）

`warEnabled` が true のとき動作。国家が他国に宣戦布告し、Province を奪取する。

- 宣戦条件: `effectiveMinWinChanceToDeclare`（Polity military の ambition/caution で変動、§10 参照）以上の勝率見込み、warCooldown 明け
- 軍事力: `baseMilitaryPower * warPowerModifier`（Polity military の martial stat による、§10 参照）
- **本拠地保護**: `seatProvinceId` の Province は征服対象から除外する
- 征服後、defender の非 seat Province がすべてなくなった場合（seat のみ残存）に `annexPolity` を呼び出す
- **v0.13**: 征服 Province の引き渡し先は「勝者 Polity に属し active な House」を線形検索で決定する。以前の `houseIds[0]` フォールバックは stale な `polityId` を持つ House に Province を渡してしまう潜在的状態破壊バグを含んでいたため修正された。valid House が存在しない場合は Province 獲得をスキップする

**荒廃・POP 効果**:
- 攻撃側勝利時（征服 Province）: development -= warConqueredProvinceDevastation、全 POP wealth 低下・unrest 上昇・peasants/townsmen size 軽度減少
- 攻撃側勝利時（境界 Province）: development -= warBorderProvinceDevastation、全 POP wealth 低下・unrest 上昇
- 攻撃側敗北時（攻撃側境界 Province）: development -= failedWarBorderDevastation、全 POP wealth 低下・unrest 上昇

**annexPolity mutation**:

```
1. defeatedPolity の全 Province.polityId を winnerPolity に変更
2. defeatedPolity の全 House.polityId / Person.polityId を winnerPolity に変更
3. defeatedPolity.rulerHouse は seatProvinceId 以外の Province を失う
4. 非 rulerHouse の ownerHouseId は維持
5. rulerHouse から取り上げた Province は winnerPolity.rulerHouse に割り当て
6. 全 Province の polityControl = annexedPolityControl（35）
7. 非 rulerHouse 領の houseControl は維持
8. winnerPolity.rulerHouse に新規割当された Province の houseControl = newRulerHouseControl（35）
9. defeatedPolity.active = false
```

### 6.21 RebellionSystem（毎月）

反乱傾向が `rebellionThreshold` を超えた House が反乱を起こす（HouseRebellionSystem）。Province / POP 起点の反乱は §6.22 ProvinceRevoltSystem が担当する。

**反乱傾向の計算**:

`calcAmbitionScores` による基本傾向に加え、POP 状態から以下を加算する。

```ts
rebellionTendency += avgNoblesUnrest * houseRebellionNobleUnrestFactor
rebellionTendency += avgProvinceUnrest * houseRebellionProvinceUnrestFactor
rebellionTendency += (100 - avgPolityControl) * houseRebellionLowControlFactor
```

**戦力計算**:

- 反乱側: `calcHouseMilitaryPower(state, config, rebelHouseId)`
- 鎮圧側: 支配家（`getPolityLeaderHouse` で特定）は 100% 寄与、非支配家門は `getHouseLoyaltyToPolity`（§4.5）に応じた寄与 + `adminPower * factor` + `treasury / divisor`

**荒廃効果**:
- 反乱開始時: rebelProvinces に development -= rebellionStartedDevastation
- 反乱成功時: rebelProvinces に development -= rebellionSucceededDevastation
- 反乱失敗時: rebelProvinces に development -= rebellionFailedDevastation

**成功時の処理**（`rebellionSuccessMode` で分岐）:
- `independence`: 反乱家が独立国を形成（国名: `{house.name}領`）
- `ruler_change`: 反乱家が支配家に就く

### 6.22 ProvinceRevoltSystem（毎月）

Province / POP を起点とする社会的反乱を処理する。

毎月、全 active Province に対して POP class ごとの反乱傾向を評価し、最も傾向が高い class 1 つを候補とする。スナップショットパターンで実装（連鎖防止）。

**反乱傾向**:

```ts
revoltTendency =
  pop.unrest * provinceRevoltUnrestFactor
  + (100 - houseControl) * provinceRevoltLowHouseControlFactor
  + (100 - polityControl) * provinceRevoltLowPolityControlFactor
  - polity.stability * provinceRevoltStabilitySuppressionFactor
  + [class 別補正]
```

class 別補正:

| class | 補正内容 |
|-------|----------|
| peasants | 貧困 wealth ペナルティ + 人口圧力 |
| townsmen | 低 wealth 時のみ搾取ペナルティ + 生産量補正 |
| nobles | 低忠誠度補正 + 低正統性補正 |

**発生判定**: `revoltTendency >= provinceRevoltThreshold` のとき、`clamp(tendency / chanceDivisor, 0, maxChance)` の確率で発生。

**戦力比較**:
- 反乱側: `pop.size * popRevoltPowerFactorByClass[class] * (0.5 + unrest/100)`
- 鎮圧側: Province の house/polity manpower + log1p(treasury) + log1p(houseWealth)

**成功 outcome**:

| outcome | 条件 | 効果 |
|---------|------|------|
| `concession` | 小幅成功 | 支配力低下・house wealth 低下、不満低下 |
| `lordship_change` | 中〜大成功 | 新 Person・新 House を生成し Province の領主を交代 |
| `independence` | nobles 反乱かつ両支配力が極低値かつ大差勝利 | 新 Person・新 House・新 Polity を生成し Province が独立 |

`independence` 実行時の状態書き換え（新 Polity・新 House の生成、Province の `polityId` 付け替え、旧国側の生存メンバー移動、Share/Office の初期化等）は `foundRevoltPolity` mutation（`worldStructureMutations.ts`）に集約されている（v0.13）。

**反乱失敗**: 反乱 POP の unrest 低下・Province 荒廃・反乱 POP wealth 低下、鎮圧側 polity.legacyPrestige +1。他 class の unrest が collateral として小幅上昇。

**イベント**:

| 状況 | イベント |
|------|---------|
| 発生 | `PROVINCE_REVOLT_STARTED` |
| concession 成功 | `PROVINCE_REVOLT_SUCCEEDED` |
| lordship_change 成功 | `LORDSHIP_USURPED` |
| independence 成功 | `REVOLT_POLITY_FOUNDED` |
| 失敗 | `PROVINCE_REVOLT_FAILED` |

**旧 ownerHouse の処置（lordship_change / independence）**: 領地がゼロになった House は即 inactive 化し、生存メンバーを rulerHouse に移動。`HOUSE_EXTINCT` イベントを発火。

### 6.22b PolityOwnerConsistencySystem（毎月、v0.15）

War / Rebellion / ProvinceRevolt 等の所領変動 system の直後に走り、`Polity.ownerHouseId` の整合性を補正する。

active Polity を id 昇順に走査し、以下のステップを順に行う（疑似コード, §11.3）:

```
for each polity in active polities:
  provinceIds = getPolityProvinceIds(state, polity.id)

  // Step 1: provinceIds = 0 なら Polity 自体を消滅させる
  if provinceIds.length === 0:
    deactivate polity
    revokeOfficesByOrganization({ kind: 'polity', id: polity.id })
    removeSharesByOrganization({ kind: 'polity', id: polity.id })
    emit POLITY_EXTINCT
    continue

  eligibleHouseIds = getPolityHouseIds(state, polity.id)

  // Step 2: ownerHouseId 未設定なら新規補充
  if polity.ownerHouseId === undefined:
    newOwner = chooseOwner(eligibleHouseIds)
    polity.ownerHouseId = newOwner
    polity.capitalProvinceId = getHouseSeatProvinceInPolity(newOwner, polity.id)
    replace polity:leader Office (revoke + assign new owner-house leader)
    emit POLITY_OWNER_CHANGED

  // Step 3: ownerHouse が inactive または Polity 内に Province なしなら交代
  if ownerHouse is invalid:
    newOwner = chooseOwner(eligibleHouseIds)
    polity.ownerHouseId = newOwner
    polity.capitalProvinceId = getHouseSeatProvinceInPolity(newOwner, polity.id)
    replace polity:leader Office
    emit POLITY_OWNER_CHANGED
```

**chooseOwner（§10.2 選定順）**:

1. 対象 Polity 内の所有 Province 数が最大
2. 同数なら local military proxy（Polity 内 Province の development 合計を proxy として使用）が最大
3. 同値なら `house.legacyPrestige` が最大
4. 同値なら HouseId 昇順

**事後条件**:
- 全 active Polity について、`ownerHouseId` が存在し、ownerHouse は active かつ Polity 内に Province を持つ
- 全 Polity の `capitalProvinceId` はその Polity 内の Province を指す
- owner 交代と同月内に `polity:leader` Office が補充されている（IntegrityCheck §25.2 #10 を当月内成立させる）

イベント: `POLITY_OWNER_CHANGED`（importance: `major`）/ `POLITY_EXTINCT`（importance: `major`）

### 6.22c OrganizationConsistencySystem（毎月、v0.15）

PolityOwnerConsistencySystem の直後に走り、Polity Share / Office の保持資格を監査する。

```
for each polity in active polities:
  eligibleHouseIds = getPolityHouseIds(state, polity.id)

  // Step 1: 不適格 Share 削除
  for each share where organization is { kind: 'polity', id: polity.id }:
    if share.holder.kind === 'house' and share.holder.id not in eligibleHouseIds:
      removeOrganizationShare(share.id)

  // Step 2: 不適格 Polity Office revoke
  for each active office where organization is { kind: 'polity', id: polity.id }:
    person = state.persons[office.holderPersonId]
    if not person.alive: continue  // 別系統の不整合（IntegrityCheck で検知）
    house = state.houses[person.houseId]
    if house is not in eligibleHouseIds:
      revokeOfficeAssignment(office.id)
      emit OFFICE_REVOKED
```

これにより:
- Share 削除責任は OrganizationConsistencySystem に**一本化**される（ShareUpdateSystem は削除を行わない）
- Polity Office holder は常に「対象 Polity 内に Province を持つ active House の人物」に限定される

### 6.23 AttitudeDecaySystem（毎月）

全 Person および全 PopGroup の `attitudes` を毎月 `attitudeMonthlyRetentionRate`（0.995）倍に減衰させる。`affection` / `respect` どちらも同率で 0 に近づく。エントリを持たない（未設定の）態度への影響なし。

### 6.23b GovernanceSystem（毎年1月）

`getPolityAdminPower`（§4.5）で `adminPower` を再計算し、`polity.adminPower` にキャッシュとして書き込む。

```ts
adminPower = 0.30*getEffectiveOfficeStat('administrator','admin')*10
           + 0.20*getEffectiveOfficeStat('treasurer','admin')*10
           + 0.20*getPolityStability
           + 0.20*getHousePrestige(getPolityLeaderHouse)
           + 0.10*clamp(log1p(treasury)*10, 0, 100)
```

`getEffectiveOfficeStat` は役職担当者の能力・複数担当者の協調ペナルティを考慮した実効能力値を返す（v0.12）。旧 StabilitySystem は v0.11 で廃止。Stability は `getPolityStability` セレクターで毎回計算する。

### 6.24 IntegrityCheck（毎月、v0.15 で §25.2 へ整理）

以下を検証し、違反があれば例外を投げる（`debug` モード時は警告のみ）。**(WARN)** マークの項目は Stage B（v0.15 移行期）では `console.warn` のみで throw しない設計。Polity 直交化に伴う transient 状態を許容するためで、PolityOwnerConsistencySystem (§6.22b) が当月内に整合性を回復する。

**v0.15 で削除された旧チェック**:

```
Province.countryId と ownerHouse.countryId の一致      ← Country/House.countryId 削除のため
生存 Person.countryId と House.countryId の一致         ← 同上
Country.houseIds と House.countryId の整合性            ← Country.houseIds 削除のため
```

**v0.15 検証項目**:

1. Province.polityId が有効な Polity を指す
2. Province.ownerHouseId が有効な House を指す
3. active Province の polity が active
4. active Province の ownerHouse が active
5. Polity.capitalProvinceId がその Polity に属する Province を指す **(WARN)**
6. House.seatProvinceId がその House の provinceIds に含まれる **(WARN)**
7. House.provinceIds と Province.ownerHouseId が双方向整合
8. ownerHouseId を持つ active Polity では、ownerHouseId が active House を指す **(WARN)**
9. ownerHouseId を持つ active Polity では、ownerHouse がその Polity 内に Province を1つ以上所有する **(WARN)**
10. active Polity は active `polity:leader` Office を持つ **(WARN)**
11. active House は active `house:leader` Office を持つ **(WARN)**
12. OrganizationRef.kind は `'polity' | 'house'` のみ
13. AttitudeTarget / attitude key に `country:` が残っていない
14. active Polity の Share holder House は対象 Polity 内に Province を持つ **(WARN)**
15. active Polity の Office holder は、対象 Polity に関係する House の人物である **(WARN)**

加えて、v0.14 以前から継続するチェック:

16. 死亡人物が役職を持たない
17. 活動中の家の家長が生存している
18. Province.development が -100..100 の範囲内
19. Province.polityControl が 0..100 の範囲内
20. Province.houseControl が 0..100 の範囲内
21. Person.sex が `'male'` または `'female'` のいずれか
22. 生存 Person の spouseId が双方向かつ有効（相互参照の一致）
23. 生存 Person の spouseId が死亡者を指さない
24. 親子関係の双方向整合性（fatherId/motherId と childIds の相互参照）
25. House の cadet 関係の双方向整合性（parentHouseId と cadetHouseIds の相互参照）
26. PopGroup.provinceId が有効な Province を指している
27. Province.popGroupIds の全 ID が有効な PopGroup を指している
28. Province.popGroupIds と PopGroup.provinceId の双方向整合性
29. 各 Province が peasants / townsmen / nobles を 1 つずつ持つ
30. PopGroup.size >= minPopSizeByClass[class]
31. PopGroup.wealth が 0..100 の範囲内
32. PopGroup.unrest が 0..100 の範囲内
33. House.memberIds に重複がない（v0.11）
34. House.provinceIds に重複がない（v0.11）
35. Polity.legacyPrestige が 0..100 の範囲内（v0.11）
36. House.legacyPrestige が 0..100 の範囲内（v0.11）
37. ability ≤ aptitude かつ両者が `[0, ABILITY_HARD_CAP=120]` の範囲内（v0.14、6 軸すべて）
38. 死亡者の wealth が 0（EstateSettlementSystem 処理後の整合性、v0.14）

---

## 7. Worldgen 初期化

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

### 7.3 seatProvinceId の決定

各 House の本拠地は、その House が所有する Province のうち `development` が最も高いもの。同値は Province ID 昇順。

### 7.4 capitalProvinceId の決定

各 Polity の首都は、初期 owner House の `seatProvinceId`。

**v0.15 追加**: 初期 Polity 生成時に以下を設定する。

- `rank: 2` （placeholder、v0.15 では game effect なし）
- `ownerHouseId`: その Polity に割り当てられた初期 leader House の id
- `capitalProvinceId`: ownerHouse の `seatProvinceId` （= ownerHouse が所有する Province のうち development 等で選ばれた中心地）
- `houseIds` フィールドは削除（`getPolityHouseIds` で動的取得）

各 House は 1 つの Polity 内にしか Province を持たない状態で生成される（多 Polity 所領は War / Rebellion 経由でのみ発生）。

### 7.5 polityControl / houseControl の初期値

ControlSystem と同じ距離上限計算で初期化する。

```
polityControl = maxControl(capitalProvinceId からの BFS 距離)
houseControl   = maxControl(seatProvinceId からの BFS 距離)
```

接続不能な Province: `polityControl = 30`、`houseControl = 30`

### 7.6 エンティティ名称の生成

Polity / House / Province / Person の `name` は、`sim/worldgen/namePool.ts` に定義された名前プールから seed 付き RNG で選択する。

- Polity・House・Province: `pickUniqueName` による重複回避。プール不足時は `Country-N` / `House-N` / `Province-N` にフォールバック
- Person（worldgen 初期生成・BirthSystem による出生ともに）: `pickNameBySex` による重複あり選択（中世欧州風に同名人物が複数存在し得る）
- `debug` モード時もエンティティ名は通常と同じ名前プールから生成される（連番 ID 方式は廃止）。デバッグ追跡はエンティティ固有 ID（`pe-42`, `h-3` 等）で行う

---

## 8. イベント型一覧

| EventType | importance | 説明 |
|-----------|------------|------|
| OFFICE_ASSIGNED | normal | 役職任命（v0.12。旧 ROLE_ASSIGNED） |
| OFFICE_REVOKED | normal | 役職解任（v0.12。旧 ROLE_REVOKED） |
| OFFICE_SALARY_UNPAID | minor | 給与未払い（v0.12） |
| OFFICE_SALARY_PARTIALLY_PAID | minor | 給与部分払い（v0.12） |
| POLITY_LEADER_CHANGED | critical | Polity leader の交代（v0.12。旧 RULER_CHANGED、v0.15 で rename） |
| POLITY_OWNER_CHANGED | major | Polity の ownerHouseId 交代（v0.15 新規） |
| POLITY_EXTINCT | major | Polity が自己消滅（ownerHouse 不在 / Province 数 0）（v0.15 新規） |
| HOUSE_LEADER_CHANGED | normal | 家長交代（v0.12。旧 HOUSE_HEAD_CHANGED） |
| SHARE_SHIFTED | minor | Share 分布の有意な変化（v0.12） |
| PERSON_DIED | normal | 人物死亡 |
| IMPORTANT_PERSON_DIED | major | 重要人物死亡 |
| HOUSE_EXTINCT | major | 家の断絶（後継者不在）（v0.15: 旧 RULER_HOUSE_EXTINCT も統合） |
| MARRIAGE_FORMED | normal | 婚姻成立 |
| CHILD_BORN | minor | 子誕生 |
| HOUSE_SPLIT | major | 家の分裂（傍系家の独立） |
| SUCCESSION_CRISIS | major | 継承危機 |
| PLOT_STARTED | normal | 陰謀開始 |
| PLOT_SUCCEEDED | major | 陰謀成功 |
| PLOT_FAILED | normal | 陰謀失敗 |
| PLOT_CANCELLED | minor | 陰謀中断 |
| REBELLION_STARTED | critical | 反乱勃発 |
| REBELLION_SUCCEEDED | critical | 反乱成功 |
| REBELLION_FAILED | major | 反乱失敗 |
| POLITY_SPLIT | critical | Polity 分裂（v0.15: 旧 COUNTRY_SPLIT を rename） |
| OMEN | normal | 兆し |
| FAMINE | major | 飢饉 |
| PLAGUE | major | 疫病 |
| BOUNTIFUL_HARVEST | normal | 豊作 |
| DISASTER_RELIEF_FUNDED | normal | 災害救済成功 |
| DISASTER_RELIEF_FAILED | normal | 災害救済失敗 |
| WAR_DECLARED | major | 宣戦布告 |
| WAR_WON | major | 戦争勝利 |
| WAR_LOST | major | 戦争敗北 |
| PROVINCE_CONQUERED | major | Province 征服 |
| POLITY_ANNEXED | critical | 国家消滅（併合） |
| MONUMENT_BUILT | major | 記念碑建設 |
| COUNTRY_LAND_DEVELOPED | normal | 国家による土地開発 |
| HOUSE_LAND_DEVELOPED | normal | 家による土地開発 |
| LORDSHIP_TRANSFERRED | minor | 隣接吸収による領主交代 |
| POP_LAND_DEVELOPED | minor | POP 自主開発（§6.18） |
| PROVINCE_REVOLT_STARTED | normal | Province / POP 反乱が発生 |
| PROVINCE_REVOLT_SUCCEEDED | major | Province 反乱が concession で成功 |
| PROVINCE_REVOLT_FAILED | normal | Province 反乱が失敗・鎮圧 |
| LORDSHIP_USURPED | major | 反乱により Province の ownerHouse が交代 |
| REVOLT_POLITY_FOUNDED | critical | Province 反乱の独立により新 Polity が成立 |
| POP_HARDSHIP | minor | POP の困窮（将来実装） |
| POP_PROSPERITY | minor | POP の繁栄（将来実装） |
| POP_UNREST_RISING | normal | Province unrest 上昇警告（将来実装） |
| POP_DECLINED | normal | Province 人口大幅低下（将来実装） |
| ESTATE_SETTLED | minor / normal / major | 死亡時の wealth 分配（v0.14。家長 or wealth≥house*20% で normal、polity leader で major） |
| ESTATE_DISPUTED | minor | 複数相続人候補による争い（v0.14、記録のみ、ESTATE_SETTLED と並んで発火） |

POP_HARDSHIP / POP_PROSPERITY / POP_UNREST_RISING / POP_DECLINED は EventType 宣言のみ。実際の発火ロジックは v1.0 以降に実装する。

---

## 9. SimulationConfig デフォルト値

| 項目 | デフォルト | 説明 |
|------|-----------|------|
| debug | false | デバッグモード（イベント行への ID 付記・構造化デバッグログ・非致死的 IntegrityCheck） |
| basePlotSuccess | 0.35 | 陰謀基本成功率 |
| rebellionThreshold | 90 | 反乱発動閾値 |
| plotThreshold | 65 | 陰謀発動閾値 |
| rebellionSuccessMode | 'independence' | 反乱成功時の処理 |
| **AppointmentSystem（v0.12）** | | |
| concurrentOfficePenalty | 8 | 兼任 1 役職ごとのスコアペナルティ |
| minAppointmentScore | 2 | この閾値未満なら任命しない（空席維持） |
| **Polity Appointment（v0.15 §13.4）** | | |
| polityShareAppointmentFactor | 0.25 | Polity Share 割合のスコア寄与係数 |
| houseShareAppointmentFactor | 0.08 | House Share 割合のスコア寄与係数 |
| ownerHouseAppointmentBonus | 4 | 候補者の家が polity.ownerHouseId と一致する場合の加算 |
| sameHousePolityOfficePenalty | 2 | 同 House の Polity Office 保有数 1 つにつき減算（Polity Office 独占抑制） |
| samePrimaryPolityMarriageBonus | 0.08 | 同 primary Polity 間婚姻ボーナス（v0.15、旧 0.1 から微減） |
| maxRawEvents | 10000 | 全イベント保持上限 |
| maxChronicleEvents | 1000 | Chronicle イベント保持上限 |
| **Marriage & Birth** | | |
| marriageEnabled | true | 婚姻システム有効 |
| marriageMaleMinAge | 16 | 婚姻可能最低年齢（男性） |
| marriageMaleMaxAge | 60 | 婚姻可能最高年齢（男性） |
| marriageFemaleMinAge | 15 | 婚姻可能最低年齢（女性） |
| marriageFemaleMaxAge | 45 | 婚姻可能最高年齢（女性） |
| marriageYearlyChance | 0.08 | 年間婚姻確率（基本） |
| samePrimaryPolityMarriageBonus | 0.10 | 同国婚姻の確率ボーナス |
| differentPolityMarriagePenalty | -0.05 | 異国婚姻の確率ペナルティ |
| birthEnabled | true | 出生システム有効 |
| fatherMinChildAge | 15 | 父親になれる最低年齢 |
| fatherMaxChildAge | 60 | 父親になれる最高年齢 |
| motherMinChildAge | 15 | 母親になれる最低年齢 |
| motherMaxChildAge | 45 | 母親になれる最高年齢 |
| baseBirthChancePerMalePerYear | 0.06 | 男性 1 人あたりの年間出生確率（基本） |
| spouseMotherChance | 0.90 | 配偶者が母親になる確率 |
| maleBirthChance | 0.52 | 男子出生確率（通常） |
| maleBirthChanceWhenAdultMaleShortage | 0.65 | 男子出生確率（成人男性不足時） |
| targetLivingPersons | 180 | 出生倍率 1.0 となる生存人数の目標 |
| criticalLivingPersons | 90 | 危機的人口（出生倍率 3.0 が発動する閾値） |
| lowPopulationBirthMultiplier | 1.5 | 人口不足時の出生倍率 |
| criticalPopulationBirthMultiplier | 3.0 | 危機的人口時の出生倍率 |
| adultAge | 15 | 成人年齢（継承・婚姻・出生の判定基準） |
| **Succession & House Split** | | |
| successionCrisisScoreGap | 10 | 後継者スコア差がこの値を超えると継承危機が発生 |
| minorHeadCohesionPenaltyPerMonth | 0.5 | 未成年当主の月次 cohesion 影響係数（Attitude 経由） |
| minorHeadLoyaltyPenaltyPerMonth | 0.3 | 未成年当主の月次 loyaltyToPolity 影響係数（Attitude 経由） |
| houseSplitEnabled | true | 家の分裂有効 |
| minProvincesForHouseSplit | 3 | 分裂に必要な最小 Province 数 |
| houseSplitCohesionThreshold | 60 | 分裂条件の cohesion 上限（getHouseCohesion が未満でないと不発） |
| baseHouseSplitChance | 0.10 | 分裂基本確率 |
| houseSplitAmbitionFactor | 0.25 | 分裂確率への野心補正係数 |
| houseSplitPrestigeFactor | 0.002 | 分裂確率への legacyPrestige 補正係数 |
| houseSplitMartialFactor | 0.02 | 分裂確率への martial 補正係数 |
| houseSplitCohesionFactor | 0.003 | 分裂確率への cohesion 減少係数 |
| houseSplitControlMin | 30 | 分裂 Province 割合の下限（%） |
| houseSplitControlMax | 80 | 分裂 Province 割合の上限（%） |
| houseSplitWealthShare | 0.25 | 分裂時に新 House が受け取る wealth 割合 |
| houseSplitUnrestGain | 5 | 分裂 Province への POP unrest 増加量（PopMutation 経由） |
| extinctionUnrestGain | 8 | 家断絶後の継承 Province への POP unrest 増加量 |
| **War** | | |
| warEnabled | true | 戦争有効 |
| warCostPerProvince | 20 | Province あたり戦費 |
| maxProvincesPerWar | 3 | 1 戦争あたり最大征服数 |
| maxWarsPerTick | 1 | 1 tick あたり最大宣戦数 |
| warCooldownMonths | 24 | 戦争クールダウン（月） |
| minAttackerWinChanceToDeclare | 0.45 | 宣戦布告に必要な最低勝率 |
| warWealthDamage | 8 | 戦争時の全 POP wealth 低下量 |
| warUnrestDamage | 10 | 戦争時の全 POP unrest 上昇量 |
| warPeasantSizeDamage | 0.5 | 戦争時の peasants size 減少量 |
| warTownsmanSizeDamage | 0.3 | 戦争時の townsmen size 減少量 |
| **Disaster** | | |
| disasterEnabled | true | 災害有効 |
| famineBaseChancePerYear | 0.08 | 飢饉発生率/年 |
| plagueBaseChancePerYear | 0.03 | 疫病発生率/年 |
| bountifulHarvestBaseChancePerYear | 0.05 | 豊作発生率/年 |
| disasterReliefCostPerProvince | 20 | 救済費用/Province |
| famineWealthPenalty | 15 | 飢饉による peasants wealth 低下量 |
| famineSizeDamage | 2 | 飢饉による peasants size 減少量 |
| famineReliefDamageMultiplier | 0.3 | 救済成功時の POP 効果軽減係数 |
| plagueWealthPenalty | 10 | 疫病による全 POP wealth 低下量 |
| plagueSizeDamage | 3 | 疫病による全 POP size 減少量 |
| bountifulHarvestPeasantWealthGain | 10 | 豊作による peasants wealth 上昇量 |
| bountifulHarvestPeasantUnrestReduction | 5 | 豊作による peasants unrest 低下量 |
| bountifulHarvestTownsmanWealthGain | 2 | 豊作による townsmen wealth 上昇量 |
| bountifulHarvestTownsmanUnrestReduction | 1 | 豊作による townsmen unrest 低下量 |
| **Public Spending** | | |
| publicSpendingEnabled | true | 公共支出有効 |
| monumentBaseCost | 120 | 記念碑建設コスト |
| publicSpendingYearlyChance | 0.35 | 公共支出年間発動確率 |
| **Development** | | |
| developmentPositiveMonthlyDecay | 0.1 | 正 development の月次減衰 |
| developmentNegativeMonthlyRecovery | 0.25 | 負 development の月次回復 |
| warConqueredProvinceDevastation | 8 | 征服 Province への荒廃 |
| warBorderProvinceDevastation | 3 | 境界 Province への荒廃（戦争勝利時） |
| failedWarBorderDevastation | 3 | 境界 Province への荒廃（戦争敗北時） |
| rebellionStartedDevastation | 2 | 反乱開始時の荒廃 |
| rebellionSucceededDevastation | 3 | 反乱成功時の荒廃 |
| rebellionFailedDevastation | 5 | 反乱失敗時の荒廃 |
| famineDevastation | 5 | 飢饉による荒廃 |
| famineReliefDevelopmentRecovery | 2 | 飢饉救済による荒廃軽減 |
| plagueDevastation | 8 | 疫病による荒廃 |
| bountifulHarvestDevelopmentGain | 3 | 豊作による development 上昇 |
| polityLandDevelopmentBaseCost | 70 | Polity土地開発コスト |
| polityLandDevelopmentGain | 8 | Polity土地開発による development 上昇 |
| houseDevelopmentEnabled | true | 家の土地開発有効 |
| houseDevelopmentYearlyChance | 0.25 | 家の土地開発年間基本確率 |
| houseLandDevelopmentBaseCost | 40 | 家の土地開発コスト |
| houseLandDevelopmentGain | 6 | 家の土地開発による development 上昇（基本値） |
| houseWealthReserve | 50 | 家が開発前に確保する wealth 予備 |
| **Control System** | | |
| controlMaxDistancePenalty | 10 | 距離 1 あたりの支配力上限ペナルティ |
| controlMaxMinimum | 40 | 支配力上限の最低値 |
| controlGrowthPerMonth | 2 | 支配力月次増加量 |
| controlDecayPerMonth | 1 | 支配力月次減少量（上限超過時） |
| disconnectedControlDecayPerMonth | 5 | 接続不能 Province の月次減衰量 |
| **Monument** | | |
| monumentPolityControlGain | 10 | 記念碑による polityControl 上昇量 |
| monumentLegacyPrestigeGain | 3 | 記念碑による rulerHouse.legacyPrestige 上昇量（v0.11） |
| **Land Development** | | |
| landDevelopmentHouseControlGain | 5 | 土地開発による houseControl 上昇量 |
| landDevelopmentUnrestReduction | 1 | 土地開発によるスコア評価に用いる unrest 低下量 |
| **Person Ability Effects（v0.6）** | | |
| personAbilityEffectsEnabled | true | 人物能力効果の有効/無効 |
| chancellorAdminControlGrowthEffect | 0.25 | 宰相 admin による支配力成長補正係数 |
| chancellorAdminControlMaxBonusPerAdmin | 1 | 宰相 admin 1 点あたりの支配力上限ボーナス |
| houseHeadAdminControlGrowthEffect | 0.25 | 家長 admin による家支配力成長補正係数 |
| houseHeadAdminControlMaxBonusPerAdmin | 1 | 家長 admin 1 点あたりの家支配力上限ボーナス |
| controlAbilityMinimumFloor | 35 | 能力補正後の支配力上限最低値 |
| treasurerAdminTaxEfficiencyEffect | 0.15 | 財務官 admin による税収効率補正係数 |
| treasurerCautionTaxEfficiencyEffect | 0.10 | 財務官 caution による税収効率補正係数 |
| treasurerTaxEfficiencyMin | 0.8 | 税収効率の最小値 |
| treasurerTaxEfficiencyMax | 1.2 | 税収効率の最大値 |
| treasurerAdminDevelopmentCostEffect | 0.10 | 財務官 admin による開発コスト削減係数 |
| generalMartialWarPowerEffect | 0.15 | 将軍 martial による戦闘力補正係数 |
| generalAmbitionDeclareThresholdEffect | 0.10 | 将軍 ambition による宣戦閾値変動係数 |
| generalCautionDeclareThresholdEffect | 0.10 | 将軍 caution による宣戦閾値変動係数 |
| minWarDeclareThreshold | 0.30 | 宣戦閾値の下限 |
| maxWarDeclareThreshold | 0.75 | 宣戦閾値の上限 |
| chancellorAmbitionMonumentScoreEffect | 20 | 宰相 ambition による monumentScore 補正係数 |
| chancellorCautionMonumentScoreEffect | 10 | 宰相 caution による monumentScore 補正係数（低 caution が正に働く） |
| chancellorAmbitionLandDevelopmentScoreEffect | 10 | 宰相 ambition による landDevelopmentScore 補正係数（低 ambition が正に働く） |
| chancellorCautionLandDevelopmentScoreEffect | 20 | 宰相 caution による landDevelopmentScore 補正係数 |
| houseHeadAdminDevelopmentChanceEffect | 0.10 | 家長 admin による開発確率補正係数 |
| houseHeadCautionDevelopmentChanceEffect | 0.10 | 家長 caution による開発確率補正係数 |
| **Lordship Transition** | | |
| lordshipAbsorptionTargetThreshold | 50 | 吸収対象となる houseControl の上限 |
| lordshipAbsorptionSourceMinimum | 60 | 吸収源となるための最低 houseControl |
| lordshipAbsorptionRatio | 2 | 吸収源 houseControl が対象の何倍必要か |
| lordshipAbsorptionMonthlyChance | 0.05 | 月次吸収発動確率 |
| lordshipAbsorptionNewControlMin | 50 | 吸収後 houseControl の下限 |
| lordshipAbsorptionNewControlMax | 70 | 吸収後 houseControl の上限 |
| lordshipAbsorptionNewControlPenalty | 10 | 吸収後 houseControl のペナルティ |
| **Annexation** | | |
| annexedPolityControl | 35 | 併合後の Province polityControl |
| newRulerHouseControl | 35 | 征服国 rulerHouse に割当られた Province の houseControl |
| **Military（v0.9）** | | |
| houseManpowerPowerFactor | 1.0 | House manpower を軍事力へ変換する係数 |
| houseMilitaryWealthReserve | 100 | 軍事力換算から除外する House wealth 予備 |
| houseWealthMilitaryFactor | 8.0 | log1p(availableWealth) の軍事力換算係数 |
| maxMercenaryPowerRatio | 0.5 | 傭兵力の上限（levyPower の 50%） |
| houseCommanderMartialEffect | 0.25 | martial による軍事力倍率補正係数 |
| minCommanderModifier | 0.75 | 指揮官補正の下限 |
| maxCommanderModifier | 1.25 | 指揮官補正の上限 |
| polityAdminMilitaryFactor | 0.3 | Polity adminPower の軍事力寄与係数 |
| minHouseMilitaryContribution | 0.25 | 非支配家門の最低軍事寄与率 |
| **HouseRebellion（v0.9）** | | |
| houseRebellionNobleUnrestFactor | 0.15 | nobles unrest の反乱傾向加算係数 |
| houseRebellionProvinceUnrestFactor | 0.05 | Province 全体 unrest の反乱傾向加算係数 |
| houseRebellionLowControlFactor | 0.10 | 低 polityControl による反乱傾向加算係数 |
| rebellionTreasuryPowerDivisor | 50 | 国庫を鎮圧戦力へ換算する除数 |
| **ProvinceRevolt（v0.9）** | | |
| provinceRevoltThreshold | 90 | Province 反乱発動の傾向閾値 |
| provinceRevoltChanceDivisor | 300 | 傾向値を月次確率へ変換する除数 |
| provinceRevoltMaxChance | 0.35 | 月次発生確率の上限 |
| provinceRevoltUnrestFactor | 0.8 | unrest の傾向加算係数 |
| provinceRevoltLowHouseControlFactor | 0.2 | 低 houseControl の傾向加算係数 |
| provinceRevoltLowPolityControlFactor | 0.2 | 低 polityControl の傾向加算係数 |
| provinceRevoltStabilitySuppressionFactor | 0.2 | stability による傾向抑制係数 |
| peasantRevoltPovertyFactor | 0.5 | peasants 貧困補正係数 |
| peasantRevoltPressureFactor | 10 | peasants 人口圧補正係数 |
| townsmenRevoltProductionFactor | 0.02 | townsmen 生産量補正係数 |
| townsmenRevoltExtractionFactor | 5 | townsmen 搾取補正値 |
| nobleRevoltHouseDisloyaltyFactor | 0.2 | nobles 低忠誠度補正係数 |
| nobleRevoltLowLegitimacyFactor | 0.2 | nobles 低正統性補正係数 |
| popRevoltPowerFactorByClass | {peasants:0.02, townsmen:0.015, nobles:0.08} | class 別反乱戦力係数 |
| provinceRevoltHouseSuppressionFactor | 1.0 | House manpower の鎮圧力換算係数 |
| provinceRevoltPolitySuppressionFactor | 0.8 | Polity manpower の鎮圧力換算係数 |
| provinceRevoltTreasurySuppressionFactor | 2.0 | log1p(treasury) の鎮圧力換算係数 |
| provinceRevoltHouseWealthSuppressionFactor | 2.0 | log1p(houseWealth) の鎮圧力換算係数 |
| provinceRevoltConcessionPolityControlLoss | 10 | 譲歩時の polityControl 低下量 |
| provinceRevoltConcessionHouseControlLoss | 15 | 譲歩時の houseControl 低下量 |
| provinceRevoltConcessionUnrestReduction | 20 | 譲歩時の反乱 POP unrest 低下量 |
| provinceRevoltConcessionLegitimacyLoss | 3 | 譲歩時の legitimacy 低下量 |
| provinceRevoltConcessionHouseWealthLoss | 20 | 譲歩時の House wealth 低下量 |
| provinceRevoltLordshipChangeSuccessMargin | 0.15 | lordship_change に必要な最低 successMargin |
| provinceRevoltLordshipChangePolityControlLoss | 10 | 領主交代後の polityControl 低下量 |
| provinceRevoltNewHouseControl | 50 | 新領主の初期 houseControl |
| provinceRevoltIndependencePolityControlMax | 10 | 独立条件: polityControl の上限 |
| provinceRevoltIndependenceHouseControlMax | 10 | 独立条件: houseControl の上限 |
| provinceRevoltIndependenceSuccessMargin | 0.20 | 独立に必要な最低 successMargin |
| provinceRevoltNewPolityControl | 40 | 独立後の新国家 polityControl |
| provinceRevoltFailedUnrestReduction | 10 | 反乱失敗時の反乱 POP unrest 低下量 |
| provinceRevoltFailedDevastation | 4 | 反乱失敗時の Province 荒廃量 |
| provinceRevoltFailedWealthPenalty | 8 | 反乱失敗時の反乱 POP wealth 低下量 |
| provinceRevoltSuppressionCollateralUnrestGain | 2 | 鎮圧時の他 class への collateral unrest |
| revoltHouseInitialLegacyPrestige | 10 | 反乱新設 House の初期 legacyPrestige（v0.11） |
| revoltHouseInitialWealth | 30 | 反乱新設 House の初期 wealth |
| revoltPolityInitialTreasury | 50 | 独立新設 Polity の初期 treasury |
| revoltPolityInitialLegacyPrestige | 20 | 独立新設 Polity の初期 legacyPrestige（v0.11） |
| **行政キャパシティ（v0.12）** | | |
| basePolityInstitutionalCapacity | 20 | 国家の基礎的行政キャパシティ |
| rulerAdminCapacityFactor | 4 | Ruler の admin stat によるキャパシティ寄与係数 |
| administratorCapacityFactor | 3 | Administrator の admin stat によるキャパシティ寄与係数 |
| treasurerCapacityFactor | 2 | Treasurer の admin stat によるキャパシティ寄与係数 |
| adminLoadPerProvince | 2 | Province 1 つあたりの行政負荷 |
| adminLoadPerPolityOffice | 1 | 役職 1 つあたりの行政負荷 |
| minAdministrativeEfficiency | 0.3 | 行政効率の下限 |
| maxAdministrativeEfficiency | 1.5 | 行政効率の上限 |
| duplicateOfficeCoordinationPenalty | 0.5 | 同役職複数担当者の協調ペナルティ係数 |
| officeHouseDiversityPenalty | 0.3 | 役職担当者が同一家に集中した場合のペナルティ係数 |
| **OfficeCompensation（v0.12）** | | |
| officeUnpaidAffectionPenalty | -3 | 未払い時の affection ペナルティ |
| officeUnpaidRespectPenalty | -2 | 未払い時の respect ペナルティ |
| officeDignityUnpaidPenaltyReduction | 0.5 | 役職の尊厳によるペナルティ軽減係数 |
| **ShareUpdate（v0.12）** | | |
| shareYearlyRetentionRate | 0.85 | 既存 Share の年次保持率（EMA 計算用） |
| polityShareBase | 10 | Polity Share 基礎値 |
| polityShareProvinceFactor | 5 | Province 数の Share 寄与係数 |
| polityShareMilitaryFactor | 0.1 | 軍事力代理値の Share 寄与係数 |
| polityShareWealthFactor | 0.05 | House wealth の Share 寄与係数 |
| politySharePrestigeFactor | 0.2 | House legacyPrestige の Share 寄与係数 |
| polityShareOfficeFactor | 3 | Polity 役職保有数の Share 寄与係数 |
| polityShareOwnerHouseBonus | 30 | 支配家への Share ボーナス |
| houseShareBase | 5 | House Share 基礎値 |
| houseShareLeaderBonus | 20 | 家長への Share ボーナス |
| houseShareOfficeBonus | 10 | House 役職保有数の Share 寄与係数 |
| houseSharePrestigeFactor | 0.3 | Person legacyPrestige の Share 寄与係数 |
| houseShareWealthFactor | 0.05 | Person wealth の Share 寄与係数 |
| houseShareStatFactor | 1 | Person (admin + martial) の Share 寄与係数 |
| rulerHouseRebellionSuppression | 30 | 支配家への反乱抑圧ボーナス（Share 計算外） |
| **POP システム（v0.8）** | | |
| popSystemEnabled | true | POP システム有効 |
| minPopSizeByClass | {peasants:5, townsmen:1, nobles:1} | POP size の下限（class 別） |
| populationCapacityPerHabitability | 10 | habitability 1 あたりの人口キャパシティ |
| minProvinceCarryingCapacity | 50 | Province の最小 carrying capacity |
| productivityByClass | {peasants:1.0, townsmen:1.5, nobles:0.6} | POP 生産性係数（class 別） |
| manpowerFactorByClass | {peasants:0.03, townsmen:0.01, nobles:0.06} | 兵力換算係数（class 別） |
| baseMonthlyGrowthByClass | {peasants:0.0010, townsmen:0.0008, nobles:0.0004} | 月次基本成長率（class 別） |
| populationPressureThreshold | 0.90 | pressure がこれを超えると wealth/unrest に影響 |
| populationPressureWealthPenalty | 0.2 | pressure 超過時の wealth 低下係数 |
| populationPressureUnrestGain | 0.3 | pressure 超過時の unrest 上昇係数 |
| povertyWealthThreshold | 25 | 貧困閾値（これ未満で unrest 上昇） |
| povertyUnrestGain | 0.02 | 貧困による unrest 上昇係数 |
| prosperityWealthThreshold | 70 | 繁栄閾値（これ超過で unrest 低下） |
| prosperityUnrestReduction | 0.01 | 繁栄による unrest 低下係数 |
| retainedWealthGainByClass | {peasants:0.30, townsmen:0.45, nobles:0.25} | 残留富 1 に対する wealth 増加量（class 別） |
| overExtractionThreshold | 0.95 | 過剰徴収判定の回収率閾値 |
| overExtractionWealthSafeThreshold | 55 | この wealth 以上ならペナルティ回避 |
| overExtractionUnrestSafeThreshold | 45 | この unrest 以下ならペナルティ回避 |
| overExtractionWealthPenalty | 1.0 | 過剰徴収による wealth 低下係数 |
| overExtractionUnrestGain | 1.5 | 過剰徴収による unrest 上昇係数 |
| **POP 自主開発（v0.8）** | | |
| popDevelopmentEnabled | true | POP 自主開発有効 |
| popDevelopmentMonthlyChance | 0.02 | 月次発動基本確率 |
| popDevelopmentMaxMonthlyChance | 0.08 | 月次発動確率の上限 |
| popDevelopmentWealthThreshold | 65 | 発動に必要な最低 avgWealth |
| popDevelopmentUnrestMax | 35 | 発動を阻害する unrest 上限 |
| popDevelopmentWealthChanceFactor | 0.001 | wealth による確率上昇係数 |
| popDevelopmentUnrestPenaltyFactor | 0.0005 | unrest による確率低下係数 |
| popDevelopmentCost | 3 | 発動時の全 POP wealth 低下量 |
| popDevelopmentGain | 0.25 | 発動時の development 上昇量 |
| popDevelopmentMaxDevelopment | 40 | POP 自主開発の development 上限 |
| **Attitude システム（v0.11）** | | |
| attitudeMonthlyRetentionRate | 0.995 | 態度の月次保持率（1-rate が減衰率） |
| initialPolityLegacyPrestigeMin | 20 | Polity 初期 legacyPrestige の下限 |
| initialPolityLegacyPrestigeMax | 60 | Polity 初期 legacyPrestige の上限 |
| initialHouseLegacyPrestigeMin | 20 | House 初期 legacyPrestige の下限 |
| initialHouseLegacyPrestigeMax | 80 | House 初期 legacyPrestige の上限 |
| initialPersonLegacyPrestigeMin | 0 | Person 初期 legacyPrestige の下限 |
| initialPersonLegacyPrestigeMax | 20 | Person 初期 legacyPrestige の上限 |
| ownerHouseExtinctionPrestigeLoss | 10 | owner house 断絶時の旧 Polity legacyPrestige 低下量 |
| rulerExtinctionAnnexPrestigeWeight | 0.3 | 支配家断絶・併合時の legacyPrestige 継承重み |
| abilityAptitudeMean | 50 | v0.14: aptitude ガウス生成の平均 |
| abilityAptitudeStddev | 15 | v0.14: aptitude ガウス生成の標準偏差 |
| abilityHeritability | 0.5 | v0.14: 両親平均 vs populationMean のブレンド比率 |
| abilityAptitudeNoiseStddev | 8 | v0.14: 遺伝時のガウスノイズ標準偏差 |
| abilityInitialNoiseStddev | 3 | v0.14: ability 初期値サンプル時のガウスノイズ標準偏差 |
| ageCurveLifelongMaxFraction | 0.70 | v0.14: 終生成長曲線の最大到達比率 |
| ageCurveLifelongAgeConstant | 30 | v0.14: 終生成長曲線の時定数 |
| ageCurveYouthMaxFraction | 0.75 | v0.14: 若年期ピーク曲線の最大到達比率 |
| ageCurveYouthPeakAge | 30 | v0.14: 若年期ピーク曲線のピーク年齢 |
| ageCurveYouthDeclineConstant | 40 | v0.14: 若年期ピーク曲線のピーク後減衰時定数 |
| ageCurveMidLifeMaxFraction | 0.70 | v0.14: 壮年期ピーク曲線の最大到達比率 |
| ageCurveMidLifePeakAge | 45 | v0.14: 壮年期ピーク曲線のピーク年齢 |
| ageCurveMidLifeDeclineConstant | 60 | v0.14: 壮年期ピーク曲線のピーク後減衰時定数 |
| abilityGrowthChanceBase | 1.0 | v0.14: 成長判定の基礎確率（%、effectiveCeil との比率で減衰） |
| abilityDeclineChanceBase | 0.10 | v0.14: 衰退判定の基礎確率（%） |
| abilityActiveDeclineMultiplier | 0.30 | v0.14: 経験あり人物の衰退速度倍率（鈍化） |
| estateBaseRecoveryRate | 0.5 | v0.14: 家回収率の基礎値（Share=0 のとき） |
| estateShareEffectStrength | 0.6 | v0.14: 家中 Share による家回収率引き下げ強度 |
| estateRecoveryRateMin | 0.2 | v0.14: 家回収率の下限 |
| estateRecoveryRateMax | 0.9 | v0.14: 家回収率の上限 |
| estateSettledNormalWealthRatio | 0.2 | v0.14: ESTATE_SETTLED の importance を normal に昇格させる wealth/house.wealth 閾値 |

---

## 10. 人物能力効果（v0.6 / v0.14 で派生 selector ベースに刷新）

`personAbilityEffectsEnabled` が false の場合、全関数は中立値（倍率 1.0、ボーナス 0）を返す。

**v0.14 での変更**: `stats.admin` / `stats.martial`（0..10）は廃止。各効果計算は `getRoleScore(state, p.id, role) / 10` を `0..10` スケールに正規化して、旧 admin/martial 相当に揃えて入力する。

| 旧 stats 参照 | v0.14 派生 selector 経由 |
|---|---|
| `stats.admin` (chancellor effect) | `getRoleScore(state, p.id, 'governance') / 10` |
| `stats.admin` (treasurer effect) | `getRoleScore(state, p.id, 'stewardship') / 10` |
| `stats.martial` (general effect) | `getRoleScore(state, p.id, 'warCommand') / 10` |

### 10.1 正規化関数

```ts
normalizedStat(value: number): number   // (value - 5) / 5  → -1.0 (=0) .. 0 (=5) .. +1.0 (=10)
                                        // v0.14: 入力は getRoleScore(state, id, role) / 10
normalizedTrait(value: number): number  // value - 0.5      → -0.5 (trait=0.0) .. 0 (trait=0.5) .. +0.5 (trait=1.0)
```

### 10.2 Trait の解釈（価値中立な軸）

| Trait | 低値（0.0側） | 高値（1.0側） |
|---|---|---|
| ambition | 忠実・現状維持 | 野心的・栄光志向 |
| caution | 大胆・即断 | 慎重・堅実 |

どちらの極も状況によって有利・不利が生じる。

### 10.3 ControlSystem への効果

**Polity administrator（Chancellor）→ polityControl**:
```ts
growthModifier = 1 + normalizedStat(admin) * chancellorAdminControlGrowthEffect
maxControlBonus = normalizedStat(admin) * chancellorAdminControlMaxBonusPerAdmin * 10
```

v0.12 では `getEffectiveOfficeStat(state, config, polityRef, 'administrator', 'admin')` で複数担当者を集約した実効値が使われる。

**家長（house:leader）→ houseControl**:
```ts
growthModifier = 1 + normalizedStat(admin) * houseHeadAdminControlGrowthEffect
maxControlBonus = normalizedStat(admin) * houseHeadAdminControlMaxBonusPerAdmin * 10
```

支配力上限は二段階 clamp:
```ts
baseMaxControl = clamp(100 - distance * controlMaxDistancePenalty, controlMaxMinimum, 100)
maxControl     = clamp(baseMaxControl + maxControlBonus, controlAbilityMinimumFloor, 100)
// 首都 / 本拠地は 100 固定
```

### 10.4 EconomySystem への効果

**Polity treasurer → 国庫税収効率**:
```ts
taxEfficiency = clamp(
  1 + normalizedStat(admin) * treasurerAdminTaxEfficiencyEffect
    + normalizedTrait(caution) * treasurerCautionTaxEfficiencyEffect,
  treasurerTaxEfficiencyMin,
  treasurerTaxEfficiencyMax,
)
// 国庫収入 *= taxEfficiency。家収入・POP wealth への影響なし
```

**Polity treasurer → Polity土地開発コスト**:
```ts
costModifier = 1 - normalizedStat(admin) * treasurerAdminDevelopmentCostEffect
effectiveCost = max(1, round(polityLandDevelopmentBaseCost * costModifier))
```

### 10.5 WarSystem への効果

**Polity military（General）→ 戦闘力**:
```ts
warPowerModifier = 1 + normalizedStat(martial) * generalMartialWarPowerEffect
// 攻撃側・防衛側それぞれ独立して適用
```

**Polity military → 宣戦閾値**:
```ts
// ambition 高（野心的）→ 閾値を下げる（積極的に開戦）
// caution 高（慎重）→ 閾値を上げる（消極的）
effectiveThreshold = clamp(
  minAttackerWinChanceToDeclare
    - normalizedTrait(ambition) * generalAmbitionDeclareThresholdEffect
    + normalizedTrait(caution)  * generalCautionDeclareThresholdEffect,
  minWarDeclareThreshold,
  maxWarDeclareThreshold,
)
```

### 10.6 PublicSpendingSystem への効果

**Polity administrator（Chancellor）→ スコア補正**:
```ts
// ambition 高 → monumentScore 上昇（栄光志向）
// caution 低（大胆）→ monumentScore 上昇（果断な建設）
monumentScoreBonus = normalizedTrait(ambition) * chancellorAmbitionMonumentScoreEffect
                   - normalizedTrait(caution)  * chancellorCautionMonumentScoreEffect

// caution 高 → landDevelopmentScore 上昇（堅実な内政）
// ambition 低 → landDevelopmentScore 上昇（現状維持志向）
landDevelopmentScoreBonus = normalizedTrait(caution)  * chancellorCautionLandDevelopmentScoreEffect
                           - normalizedTrait(ambition) * chancellorAmbitionLandDevelopmentScoreEffect
```

### 10.7 HouseDevelopmentSystem への効果

**家長（house head）→ 開発発動確率**:
```ts
abilityChanceBonus = normalizedStat(admin)    * houseHeadAdminDevelopmentChanceEffect
                   + normalizedTrait(caution) * houseHeadCautionDevelopmentChanceEffect
chance = clamp(houseDevelopmentYearlyChance + wealthBonus + abilityChanceBonus, 0, 1)
```

---

## 11. UI 構成

- **MapPanel**: Province を SVG で描画。クリックで Province 選択
- **Sidebar**: 人物一覧。重要度スコア順。ウォッチリスト対応
- **DetailPanel**: 選択エンティティ（Province / Polity / House / Person / PopGroup）の詳細表示
  - ProvinceDetail:
    - **Population** セクション: habitability / Carrying Capacity / Total Population / Pop. Pressure（90% 超で赤表示）/ Avg Wealth / Unrest（60 超で赤表示）/ Production / Polity Manpower / House Manpower
    - **POP Groups** セクション: class 別に size / wealth / unrest（60 超で赤表示）を一覧表示。各 POP カードはクリッカブルで PopGroupDetail へ遷移（v0.11）
    - **Revolt Risk** セクション: class 別反乱傾向値（Peasants / Townsmen / Nobles）
  - PolityDetail（v0.12 / v0.15 更新）:
    - 基本情報: Ruler（人物リンク）/ Royal House（getPolityLeaderHouse）/ Dominant House（getDominantPolityHouse）/ 首都 / Legitimacy / Treasury / Military Power
    - **Administration** セクション: Capacity / Load / Efficiency（getAdministrative* セレクター）
    - **Roles** セクション: leader / administrator / treasurer / military / advisor の担当者リンク（空席は「—」）
    - **Top Shareholders** セクション: Polity Share 上位 5 House と割合
    - **Houses with land here** リスト（v0.15）: その Polity に Province を 1 つ以上持つ active House を、Polity 内 Province 数とともに表示。primary がここでない House には「non-primary」マーカーを付ける
  - HouseDetail（v0.12 更新）:
    - 基本情報: Leader（getHouseLeader）/ 本拠地 / Province 数 / Wealth / Prestige / Military
    - **Offices** セクション: administrator / treasurer / military / advisor の担当者リンク（空席は「—」）
    - **Top Shareholders** セクション: House Share 上位 5 Person と割合
  - PersonDetail（v0.12 / v0.15 更新）:
    - 基本情報: Age / House / Sex / Birth Status / Wealth（v0.15: Country フィールド廃止、Relevant Polities へ）
    - **Offices** セクション: Polity と House でグループ分け、役職重要度順（leader → administrator → treasurer → military → advisor）
    - Stats / Traits / Family リンク / **Attitudes セクション**（v0.11）
  - **PopGroupDetail**（v0.11）: size / wealth / unrest（60 超で赤表示）/ 所属 Province リンク / **Attitudes セクション**
- **EventLog**: Chronicle（major/critical）と全イベントの 2 ビュー
- **ConfigPanel**: シミュレーションパラメータをリアルタイム調整

---

## 12. アーキテクチャ原則（v0.13 / v0.14 派生 selector 追記）

シミュレーション層は以下の原則に従う。コード上の集約点を仕様レベルでも明示しておくことで、将来の機能追加でも同じ規律を維持する。

### 12.1 WorldState はイミュータブル

- `tick()` は純粋関数。`TickInput` を受け取り `TickResult` を返す
- すべての状態書き換えはオブジェクト spread（`{ ...state, ... }`）で新オブジェクトを生成する
- in-place 代入（`state.persons[id].alive = false` 等）は禁止

### 12.2 状態書き換えは `sim/mutations/*` に集約

`tick/` 配下のシステムは、状態書き換えを `sim/mutations/*` の関数経由でのみ行う。生フィールド（`Person.alive`, `House.memberIds`, `Province.polityId`, etc.）の直接書き換えは原則として禁止。

主要 mutation の役割：

| ファイル | 主な責務 |
|---|---|
| `worldStructureMutations.ts` | `splitHouse` / `extinctHouse` / `foundRevoltPolity` — 家分裂・断絶・反乱独立の高レベル一括処理 |
| `personMutations.ts` | `markPersonDead`（§6.7）/ `movePersonToHouse` / `birthChild` / `addPersonWealth` / `clearPersonWealth` (v0.14) |
| `relationshipMutations.ts` | `setSpouse` / `clearSpouse` / `addChildToParents` |
| `houseMutations.ts` | `createHouse` / `deactivateHouse` / `addHouseWealth` (v0.14) |
| `polityMutations.ts` (v0.15) | `createPolity` / `deactivatePolity` / `annexPolity` / `createPolityFromHouse` / `createPolityFromProvinces` / `moveHouseToPolity` |
| `provinceMutations.ts` | `transferProvinceToHouse` / `transferProvinceToPolity` / `adjustProvinceDevelopment` |
| `popMutations.ts` | `adjustProvincePopWealth` / `adjustProvincePopUnrest` / `adjustProvincePopSize`（class 別バリアント含む）|
| `officeMutations.ts` | `createOfficeAssignment` / `revokeOfficeAssignment` / `revokeOfficesByHolder` / `revokeOfficesByOrganization` / `assignOffice` |
| `shareMutations.ts` | `createOrganizationShare` / `updateShareRawPower` / `removeOrganizationShare` / `transferShareRawPower` / `upsertOrganizationShare` / `deleteAllSharesForHolder` |
| `attitudeMutations.ts` | `adjustPersonAttitude` / `adjustPopAttitude` / `adjustHouseMembersAttitude`（§12.3 参照）|
| `plotMutations.ts` | `addPlot` / `removePlot` / `resolvePlot` |

mutation 関数はおおむね `StateResult = SimResult<WorldState>` または `CtxResult<T>` を返す。失敗時は `err({code, message})` を返し、tick 側で握りつぶさない。エラーコードは `mutations/errors.ts` で集中管理する。

例外：以下の「単純バッチ更新」は mutation 化のコストが見合わないため、直接 spread でも許容する（コード上 `// v013-residual: simple-batch` コメントで識別可能）：

- 全 Person の `age += 1`（advanceTime）
- 全 Person / PopGroup の attitudes 減衰（AttitudeDecaySystem）
- Province development の月次自然減衰・回復（DevelopmentSystem）
- House wealth / Polity treasury / Polity adminPower の月次バッチ更新（EconomySystem / GovernanceSystem）
- ControlSystem の BFS と組み合わせた polityControl/houseControl 更新

### 12.3 Attitude は `AttitudeTarget` で読み書きする

`Person.attitudes` / `PopGroup.attitudes` は `AttitudeMap = Record<AttitudeKey, Attitude>` で実装されているが、tick / selectors / explain / app から扱う際は常に `AttitudeTarget`（§3.6）を経由する：

- 書き込み: `adjustPersonAttitude(state, personId, target, delta)` / `adjustPopAttitude(state, popId, target, delta)` / `adjustHouseMembersAttitude(state, houseId, target, delta)`
- 読み出し: `getAttitudeOrDefault(state, source, target): Attitude` / `getExplicitAttitude(attitudes, target): Attitude | undefined`

`polityAttitudeKey(id)` / `houseAttitudeKey(id)` / `personAttitudeKey(id)` 文字列ビルダーは `attitudeHelpers.ts` の内部実装と `worldgen/` でのみ使用してよい。tick / selectors / explain / app からの直接呼び出しは禁止。

低レベルの `adjustAttitude(map, key, delta)` ヘルパーは `mutations/attitudeMutations.ts` 内部と `worldgen/` でのみ使用する。tick からの直接 import は禁止。

### 12.4 IntegrityCheck と mutation API の組み合わせによる契約検知

`IntegrityCheck`（§6.24）は毎月末に WorldState を走査し、双方向整合性・範囲・参照整合性を検証する。mutation API が状態書き換えを独占することで、契約違反が混入する可能性のある箇所が mutation 関数の内部に限定され、違反の発生源を絞り込みやすい構造になっている。

`debug` モード時は IntegrityCheck の違反が非致死的になり、`[DEBUG:INTEGRITY] error=...` として stderr に出力される（§2.2）。長期シミュレーションでの再現性確認に利用する。

### 12.5 派生 selector による応用ロールの計算（v0.14）

人物の応用ロールスコア（governance / stewardship / diplomacy / intrigue / warCommand）は `prototype/src/sim/selectors/abilitySelectors.ts` の `getRoleScore(state, personId, role)` に集約する。tick / mutations / UI 各層は基礎能力（`person.abilities.{valor|command|...}`）を直接合成せず、必ず派生 selector を経由する。

これにより：

- 新ロール追加時に変更箇所が 1 ファイル（abilitySelectors.ts + ROLE_WEIGHTS 定数）に閉じる
- ロール定義変更（重み調整）が全システムに自動反映される
- 基礎能力モデル変更（v0.15 以降の限界突破イベント等）でも応用ロール側のシステムは影響を受けない

UI 層では基礎能力直接参照（`person.abilities.valor` を直接表示）も許容するが、バックエンドロジック（appointmentSystem / publicSpendingSystem / militarySelectors 等）は必ず `getRoleScore` 経由とする（§4.7 / §4.8 参照）。

---

## 13. 今後の課題（未実装）

### v0.14 で実装済み（参考）

- 6 基礎能力 (valor / command / numeracy / learning / charisma / insight) と aptitude / ability 分離
- 才能遺伝（平均回帰込み）
- 年齢曲線 (lifelongGrowth / youthPeak / midLifePeak) 別の自然到達水準
- 経験成長と年齢衰退（PersonGrowthSystem）
- 派生 selector による応用ロール（governance / stewardship / diplomacy / intrigue / warCommand）
- 死亡時 wealth 分配（EstateSettlementSystem）と ESTATE_SETTLED / ESTATE_DISPUTED イベント
- UI 6 能力表示・5 派生スコア・年齢曲線アイコン

### v0.15 で実装済み（参考）

- **Country → Polity 直交化**: `Country` 型を `Polity` 型に rename。`House.countryId` / `Person.countryId` を削除。`Country.houseIds` を削除し `getPolityHouseIds` selector で動的取得。
- **Polity.ownerHouseId / rank**: Polity 自身が家産的に所有家を持つ。`rank: PolityRank` は v0.15 では effect 持たない placeholder（将来の称号システム土台）
- **Polity 関係 selector 群** (`polityRelations.ts`): `getPolityProvinceIds` / `getPolityHouseIds` / `getPolityPersonIds` / `getHousePolityIds` / `getHousePrimaryPolityId` / `getPersonPrimaryPolityId` / `getHouseSeatProvinceInPolity` 等
- **House の多 Polity 所領**: 1 House が複数 Polity に Province を持てる（戦争・反乱で発生）。各 system は selector 経由で関係を動的に取得
- **PolityOwnerConsistencySystem / OrganizationConsistencySystem** (v0.15 §6.22b/§6.22c): 所領変動後の owner / capital / Share / Office の整合性を毎月補正
- **§13.4 Polity 役職スコア式**: `polityShareAppointmentFactor` / `ownerHouseAppointmentBonus` / `sameHousePolityOfficePenalty` を導入。同 House による Polity Office 独占を抑制
- **§17.3 War 征服時の新 ownerHouse 選定**: attacker `polity.ownerHouseId` 優先
- **§22.3 affectedPolityIds スナップショット**: `extinctHouse(ctx, { houseId, affectedPolityIds })` で所領喪失前の関係 Polity 集合を保存し、メンバー移住先選定に使う
- **POLITY_OWNER_CHANGED / POLITY_EXTINCT イベント追加**、`RULER_CHANGED` → `POLITY_LEADER_CHANGED` 等の rename

### v0.16 以降に送られる主要項目

- **限界突破イベント**: aptitude を 101..120 帯に押し上げる伝説的偉業・特訓イベント（v0.14 はデータ表現のみ）
- **ESTATE_CONTESTED の長期 Project 化・claim 派生**: v0.14 では ESTATE_DISPUTED は記録のみ。長期化させた相続争いを Project 化し、後年に claim 相続へ繋げる
- **遺言（指定相続人）機構**: 現状は嫡出子→配偶者→兄弟→家長の固定順
- **称号システム**（家産称号 / 個人称号 / 公的称号、TITLE_INHERITED / TITLE_RECLAIMED_BY_HOUSE / DYNASTY_CHANGED / TITLE_UNION_FORMED / DISSOLVED）
- **Polity 拡張**: ownershipMode / titlePropertyRegime / successionLaw / 同君連合（rank は v0.15 で型のみ導入済み、game effect は v0.16+）
- **LandContract**（明示的な臣従・封土契約）: 現状は House 関係をすべて `province.ownerHouseId` 経由で読み取る簡易モデル。将来は House 間の明示的契約に切り替える
- **多重臣従**: 1 つの House が複数 Polity の owner / vassal を兼ねる構造（v0.15 では「複数 Polity に所領を持つ」のみで明示臣従はない）
- **Faction（派閥）**: 家を超えた政治集団。同派閥婚姻ボーナス等を実装する場合の前提
- **代官 / ProvinceOfficeAssignment**（Person.houseId optional 化、代官蓄財）
- **氏族 Clan**、巨大 House の Clan 化
- **socialFriction**（魅力 − 洞察 ペナルティ）— Attitude system 全体見直し
- **ROLE_WEIGHTS の config 化**（シナリオごとに重み変更したいニーズが顕在化したとき）
- **spymaster / disasterSystem 関連の役職** とその経験成長対応
- **大分裂（House 独立）**: 全土統一後、国力が一定規模を超えると支配家から傍系家が独立し複数 Polity が成立する「中国史的分裂」メカニズム。現状は Province Revolt から新勢力が生まれるが、House 単位での大規模独立はまだ弱い
- **Polity 規模ペナルティ**: Province 数・House 数が増えるほど Legitimacy（getPolityLegitimacy）が低下しやすくなり、大 Polity が自重で崩れる仕組み
- **家の分裂の作り込み**: Attitude 経由の cohesion 変動をより細かく制御、分裂閾値の調整、一強状態でも分裂が自然発生する仕組み
- **POP_HARDSHIP / POP_PROSPERITY / POP_UNREST_RISING / POP_DECLINED イベントの発火ロジック**: 閾値超過時のみ発火する条件付きイベント（EventType 宣言のみ実装済み）
- **首都・本拠地移転**: 征服・滅亡・特別イベントによる移転
- **記念碑エンティティ化**: 建設場所、継続効果、破壊、monumentLevel
- **POP の移住**: population pressure・wealth・unrest・戦争荒廃に応じた Province 間移動
- **文化・宗教**: PopGroup への cultureId / religionId 追加、同化・改宗・弾圧・寛容政策
- **食料生産**: carrying capacity / population pressure を foodProduction / foodDemand に拡張
- **詳細な戦争**: War エンティティ、戦場、包囲戦
- **施設システム**: 城塞・道路・港・市場
- **詳細外交**: 同盟・条約・婚姻
- **継承権・請求権**: 血縁関係に基づく他家への継承権主張
