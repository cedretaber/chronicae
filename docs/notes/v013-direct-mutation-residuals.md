# v0.13 Direct Mutation Residuals

Direct writes to `state.persons[x]`, `state.houses[x]`, etc. that remain in `sim/tick/` after v0.13 + post-review cleanup.

## 移行済み (Migrated)

### v0.13 本体 (Phase 4-5)

| System file | Migrated to |
|---|---|
| `houseExtinctionSystem.ts` (600+ lines) | `extinctHouse()` in `worldStructureMutations.ts` |
| `houseSplitSystem.ts` (execution phase, ~200 lines) | `splitHouse()` in `worldStructureMutations.ts` |
| `provinceRevoltSystem.ts` `resolveRevoltIndependence` (~290 lines) | `foundRevoltCountry()` in `worldStructureMutations.ts` |
| `mortalitySystem.ts` spouse clearing | `clearSpouse()` in `relationshipMutations.ts` |
| `birthSystem.ts` child creation | `birthChild()` in `personMutations.ts` |

### v0.13 post-review cleanup (Phase B-E)

| System file | Migrated to |
|---|---|
| `warSystem.ts:273` `houseIds[0]` fallback + `transferProvinceToHouse` | `find` で valid house 検索 + `transferProvinceToCountry` — stale countryId による province 誤転送バグを修正 |
| `plotSystem.ts:135` no-op house spread | 削除（`revokeOfficesByOrganization` + `createOfficeAssignment` で完結していた） |
| `disasterSystem.ts:43,184,244` provinces development | `adjustProvinceDevelopment()` in `provinceMutations.ts` |
| `lordshipTransitionSystem.ts:150,158,165` provinces/houses lordship | `transferProvinceToHouse({ newHouseControl })` — `newHouseControl` option を Phase A で追加 |
| `plotSystem.ts:158,219` house member attitudes | `adjustHouseMembersAttitude()` in `attitudeMutations.ts` |
| `successionSystem.ts:268` house member attitudes | `adjustHouseMembersAttitude()` in `attitudeMutations.ts` |

## simple-batch（v013-residual: simple-batch コメント済み）

以下は `new* = { ...state.* }` → ループ → `state: { ...state, [field]: new* }` の
immutable update パターン。mutation API 化より直接記述のほうが可読性が高い単純なループ。
コード上に `// v013-residual: simple-batch` コメントを付けており、将来の置換候補として grep 可能。

| ファイル | 行 | 内容 | 将来の mutation API 案 |
|---|---|---|---|
| `advanceTime.ts:8` | persons age +1 | 全員に1歳加算する単純ループ | `incrementAllPersonsAge(state)` |
| `attitudeDecaySystem.ts:9` | persons attitudes decay | 全員の person attitudes を retention rate 倍 | `decayAllPersonAttitudes(state, rate)` |
| `attitudeDecaySystem.ts:28` | popGroups attitudes decay | 全員の popGroup attitudes を retention rate 倍 | `decayAllPopAttitudes(state, rate)` |
| `mortalitySystem.ts:29` | persons alive = false | 死亡フラグ設定（spouse/office clearing は mutation 経由済み） | `markPersonDead(state, personId)` |
| `developmentSystem.ts:7` | provinces development decay | 全 province の development を decay/recover | `adjustProvinceDevelopment` で代替可。ループ単純なので現状維持 |
| `economySystem.ts:97` | houses wealth | delta map 集約後の house wealth バッチ更新 | `adjustHouseWealth(state, houseId, delta)` で代替可だが delta 集約パターンが有用 |
| `economySystem.ts:109` | countries treasury | taxEfficiency を乗じた treasury バッチ更新 | 上記と同様 |
| `governanceSystem.ts:14` | countries adminPower | 全 country の adminPower バッチ更新 | `setCountryAdminPower(state, countryId, power)` |
| `controlSystem.ts:63` | provinces control | BFS 距離計算と組み合わせた countryControl/houseControl 更新 | mutation 化はオーバーキル（BFS 計算が不可分） |

## Digest 差分記録

Phase B（warSystem フォールバック修正）で挙動変化あり。各 seed の主要集計値：

| seed | baseline activeCountries | Phase B activeCountries | 変化 |
|---|---|---|---|
| 1 | 7 | 5 | -28% |
| 42 | 同一 | 同一 | — |
| 123 | 軽微差分のみ | 軽微差分のみ | — |
| 999 | 2 | 7 | +250% |

**理由**: 以前の `houseIds[0]` フォールバックは stale countryId を持つ house に province を渡し、
`province.countryId` が誤った値で更新される潜在的状態破壊バグを含んでいた。
修正後は `valid house` が見つからない場合に province 獲得をスキップするため、
戦争の結果が変わり政治マップが大きく変化する。
ゲームの挙動変化として許容（integrity violation は発生していない）。
