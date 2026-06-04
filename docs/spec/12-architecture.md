# 12. アーキテクチャ原則

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
| `worldStructureMutations.ts` | `splitHouse` / `extinctHouse` — 家分裂・断絶の高レベル一括処理 |
| `worldStructureCommonwealth.ts` | `createNegotiatingCommonwealth` / `establishCommonwealth` / `dissolveNegotiatingCommonwealth` / `suppressRevolt` / `selectOrCreateCommonwealthLeader` — 反乱独立（民衆叛乱 commonwealth）の高レベル一括処理 |
| `personMutations.ts` | `markPersonDead`（§6.7）/ `movePersonToHouse` / `birthChild` / `addPersonWealth` / `clearPersonWealth` |
| `relationshipMutations.ts` | `setSpouse` / `clearSpouse` / `addChildToParents` |
| `houseMutations.ts` | `createHouse` / `deactivateHouse` / `addHouseWealth` |
| `polityMutations.ts` | `createPolity` / `deactivatePolity` / `annexPolity` / `createPolityFromHouse` / `createPolityFromProvinces` |
| `provinceMutations.ts` | `adjustProvinceDevelopment` / `adjustHoldingDevelopment` |
| `popMutations.ts` | `adjustProvincePopWealth` / `adjustProvincePopUnrest` / `adjustProvincePopSize`（class 別バリアント含む）|
| `officeMutations.ts` | `createOfficeAssignment` / `revokeOfficeAssignment` / `revokeOfficesByHolder` / `revokeOfficesByOrganization` / `assignOffice` |
| `shareMutations.ts` | v0.42c: HouseShare 専用。`createHouseShare` / `updateShareRawPower` / `removeHouseShare` / `transferShareRawPower` / `upsertHouseShare` / `removeSharesByHouse` / `removePersonSharesInHouse` |
| `politicalRightMutations.ts` | v0.42: `createPoliticalRight`（1-target-1-right 検査）/ `removePoliticalRight` / `removeRightsByHolder` / `removeRightsByPolity` / `removeRightsByTarget`(+Mut) / `transferPoliticalRight` |
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

`IntegrityCheck`（§6.35）は WorldState を走査し、双方向整合性・範囲・参照整合性・時間 3 値整合性を検証する（通常・debug モードとも年末 week 48 のみ実行。整合性は year-end 契約であり per-tick では成立しないため。§5.5 参照）。mutation API が状態書き換えを独占することで、契約違反が混入する可能性のある箇所が mutation 関数の内部に限定され、違反の発生源を絞り込みやすい構造になっている。

`debug` モード時は IntegrityCheck の違反が非致死的になり、`[DEBUG:INTEGRITY] error=...` として stderr に出力される（§2.2）。長期シミュレーションでの再現性確認に利用する。

### 12.5 派生 selector による応用ロールの計算

人物の応用ロールスコア（governance / stewardship / diplomacy / intrigue / warCommand）は `prototype/src/sim/selectors/abilitySelectors.ts` の `getRoleScore(state, personId, role)` に集約する。tick / mutations / UI 各層は基礎能力（`person.abilities.{valor|command|...}`）を直接合成せず、必ず派生 selector を経由する。

これにより：

- 新ロール追加時に変更箇所が 1 ファイル（abilitySelectors.ts + ROLE_WEIGHTS 定数）に閉じる
- ロール定義変更（重み調整）が全システムに自動反映される
- 基礎能力モデル変更（限界突破イベント等）でも応用ロール側のシステムは影響を受けない

UI 層では基礎能力直接参照（`person.abilities.valor` を直接表示）も許容するが、バックエンドロジック（appointmentSystem / publicSpendingSystem / militarySelectors 等）は必ず `getRoleScore` 経由とする（§4.7 / §4.8 参照）。

---

