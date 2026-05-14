# Chronicae v0.3 仕様書レビュー

## 全体評価

設計方針が明確で、実装に直結できるレベルの仕様書。特に以下の点が優れている。

- 「国家最適化 AI ではなく、人物・役職者の利害に基づく」という核心が全体を通じて一貫している
- 即時解決型戦争（War エンティティなし）という正しいスコープ判断
- tick 順序が論理的（災害 → 公共支出 → 戦争 → 反乱の順）
- 成功条件が 3 段階で明確

---

## Section 21「コーディングエージェントへの相談ポイント」への回答

### 1. War エンティティなし・即時解決型でよいか

問題なし。`warSystem.ts` を境界として明確に分離すれば、将来 War エンティティへの移行も容易。

### 2. `Country.active` 追加は安全か

安全。既存コードで `Object.values(state.countries)` を使っている箇所に `.filter(c => c.active)` を追加するだけで対応できる。
ただし以下の箇所は実装時に確認が必要：

- `integritySystem.ts` の国家チェック
- `ambitionSystem.ts` のターゲット国選定
- `rebellionSystem.ts` の国家リスト

### 3. `militarySelectors.ts` への切り出し

推奨。`rebellionSystem.ts` に現在ある軍事力計算と重複が生じるため、selector に切り出して両方から参照する形が自然。

### 4. 新システムの配置（disasterSystem / publicSpendingSystem vs economySystem 統合）

**独立ファイル推奨。**

`economySystem.ts` に統合すると単一ファイルが肥大化し可読性が落ちる。それぞれを独立した `systems/` ファイルとして tick から呼ぶのが適切。

### 5. tick 順序の実装上の問題

一点懸念あり。

仕様書では「災害救済は発生 tick で即時判定」と推奨しているが、tick 順序上は「3. 災害処理」と「9. 公共支出処理」が離れている。

推奨する分担：

- `disasterSystem` が災害の発生と救済判断を一括して担当する
- `publicSpendingSystem` は記念碑・施しだけを担当する

こうすることで、disaster relief は `disasterSystem` 内で完結し、公共支出の tick 位置と無関係に即時処理できる。

### 6. 維持費を後回し

正しい判断。戦争・災害・公共支出の効果を実装して観測してから追加するのが安全。

### 7. 公共支出スコアの簡易式

問題なし。Section 7.3、8.4、9.3 の式は実装に十分な具体度がある。

### 8. inactive country の UI 表示

仕様書の「通常 selector / UI では非表示でよい」が最も自然。

- Sidebar の Countries タブ: `active === true` の国家のみ表示
- イベントログ: 消滅国家の名前は履歴として残す
- DetailPanel: inactive country を開こうとした場合は「滅亡済み」などの表示で対応

---

## 未確定論点（要確認）

### 論点 A: 国家消滅時の House 吸収

防衛側国家が消滅した場合、残存 House をどう扱うか。

**選択肢：**

1. **全 House を勝利国に移籍**（推奨）
   - シンプル。v0.3 の技術検証フェーズに適した実装量。
   - `moveHouseToCountry` を全 House に適用するだけ。

2. **一部を亡命・断絶扱い**
   - よりリアルだが、House の「状態」管理が増える。
   - v0.4 以降での検討でよい可能性が高い。

### 論点 B: `warCooldownMonths` の管理方法

国家ごとのクールダウン追跡をどこに持つか。

**選択肢：**

1. **`Country` 型に `lastWarMonth: number` を追加**（推奨）
   - 国家ごとに独立したクールダウン。
   - 型変更が発生するが、`worldgen` と serialization は容易に対応できる。

2. **`WorldState` にグローバル Map として持つ**
   - `Country` 型を変えずに済む。
   - ただし `WorldState` が複雑になり、参照が散らかりやすい。
