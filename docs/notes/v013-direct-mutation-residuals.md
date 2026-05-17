# v0.13 Direct Mutation Residuals

Direct writes to `state.persons[x]`, `state.houses[x]`, etc. that remain in `sim/tick/` after v0.13.

## 移行済み (Migrated in v0.13)

These large mutation blocks were extracted into `sim/mutations/worldStructureMutations.ts`:

| System file | Migrated to |
|---|---|
| `houseExtinctionSystem.ts` (600+ lines) | `extinctHouse()` orchestration |
| `houseSplitSystem.ts` (execution phase, ~200 lines) | `splitHouse()` orchestration |
| `provinceRevoltSystem.ts` `resolveRevoltIndependence` (~290 lines) | `foundRevoltCountry()` orchestration |

Phase 4 also migrated atomic operations:

| System file | Migrated to |
|---|---|
| `mortalitySystem.ts` spouse clearing | `clearSpouse()` in `relationshipMutations.ts` |
| `birthSystem.ts` child creation | `birthChild()` in `personMutations.ts` |

## 意図的に残す (Intentionally Kept)

### `warSystem.ts:348` — `transferProvinceToHouse` instead of `transferProvinceToCountry`

```
// v013-residual: transferProvinceToHouse used instead of transferProvinceToCountry;
// the latter adds country-ownership validation that fails in edge cases where
// attackerCountry.houseIds[0] fallback has stale countryId, causing >10% digest divergence
```

**理由**: `transferProvinceToCountry` は `toHouse.countryId !== toCountryId` の追加バリデーションを行う。
`getCountryRulerHouse` が null を返した場合のフォールバック `attackerCountry.houseIds[0]` が
stale な `countryId` を持つ edge case でバリデーションが失敗し、province 獲得がスキップされる。
この影響で4シード×300年で `activeCountries` や `REBELLION_STARTED` が ±10% を超えて変化する。
根本修正（`attackerCountry.houseIds[0]` フォールバックの廃止か state 整合性の保証）は別 issue とする。

### バッチ処理パターン（immutable update として意図的）

以下は `new* = { ...state.* }` → 代入 → `state: { ...state, [field]: new* }` の
immutable update パターン。mutation API 化するより直接記述のほうが可読性が高く、
単純なフィールド更新なので mutation API が不要。

| ファイル | 行 | 内容 |
|---|---|---|
| `advanceTime.ts:11` | persons age +1 | 全員に1歳加算する単純ループ |
| `attitudeDecaySystem.ts:23` | persons attitudes decay | 全員の attitude を decay する単純ループ |
| `mortalitySystem.ts:29` | persons alive = false | 死亡フラグ設定（spouse clearing は clearSpouse に移行済み） |
| `developmentSystem.ts:22` | provinces development | 開発値更新 |
| `economySystem.ts:101` | houses wealth | 家の収入計算 |
| `economySystem.ts:115` | countries treasury | 国の財政計算 |
| `governanceSystem.ts:27` | countries adminPower | ガバナンス更新 |
| `controlSystem.ts:67` | provinces (control tick) | province control 減衰 |

## 持ち越し (Deferred)

以下は複雑なロジックを含むため v0.13 での mutation API 化を見送り、別 issue とする。

| ファイル | 行 | 内容 | 持ち越し理由 |
|---|---|---|---|
| `disasterSystem.ts:43,184,244` | provinces disaster effects | 複数の catastrophe ロジック | ロジックが複雑でリスクが高い |
| `lordshipTransitionSystem.ts:150,158,165` | provinces/houses lordship | 封建制の主従変更 | 多数の整合性条件がある |
| `plotSystem.ts:135,158,219` | houses/persons plot effects | plot 解決ロジック | plot 系は Phase 3 で API 追加したが呼び出し側は未移行 |
| `successionSystem.ts:268` | persons attitudes after succession | 継承後 attitude 更新 | successionSystem 全体の Result 化とセット |
