# Chronicae プロジェクト固有の注意事項

## 開発方針 (プロトタイプ段階)

Chronicae はまだプロトタイプ段階であり、観賞用シミュレーションとして「面白いか」「歴史らしい変化が発生するか」を検証することが最優先。
そのため以下の方針で開発を進める。

### 1. 積極的な機能改修を歓迎する

破壊的変更やバランス崩壊を恐れずに新機能を入れてよい。
小さな改善より「ゲーム全体として観賞対象になっているか」を高める変更を優先する。

### 2. 仕様書に無い修正も、方向性に合致していれば実装する

仕様書 (`docs/SPEC.md`, `docs/drafts/spec-v0XX-update.md`) は実装中の判断基盤だが、
実装中に「仕様書には無いがゲーム全体の目的に沿った拡張・調整」が必要だと気付くことがある。

そのような場合は、仕様書の文面に縛られず実装してよい。
代わりに、**変更を入れた仕様書を即座に追従更新する** こと（実装→仕様書同期）。

判断基準は以下:

- `docs/SPEC.md §1` (概要 / 検証目的) と矛盾しないか
- 既存の他システムと整合が取れているか
- プロトタイプの「観賞対象としての面白さ」を損なわないか

### 3. 仕様書追従の責務

実装でやったことは必ず仕様書に反映する。
- 新しい挙動を入れた → 該当ドラフト spec の対応セクションを更新
- パラメータの推奨値を変えた → §配下の config セクションを更新
- spec の既存条文を緩和・拡張した → その条文に「v0.15 でこう拡張」と注記

この同期を怠ると、後続の Phase で「spec が古くて誤った判断をする」事故が起きる。

### 参考

- 上記方針が初めて適用された例: v0.15 §13.2 拡張 (AppointmentSystem に `ownerHouseId 経由の候補者許容` を追加し、ドラフト spec も同時に追記)

---

## プロジェクト構成

```
Chronicae/
├── .claude/         # Claude Code 設定
├── docs/            # 仕様書（SPEC.md など）
└── prototype/       # 実装本体（Vite + React + TypeScript）
    └── src/
        ├── app/     # UI 層（components, stores）
        └── sim/     # シミュレーション層（types, tick, selectors など）
```

すべての npm コマンドは `prototype/` ディレクトリ内で実行する。

`npx` は使わず、常に `npm run <script>` を使う。

## 検証コマンド

```bash
cd prototype && npm run check
```

`check` = `typecheck + lint + format:check + test` の一括実行。実装後は必ずこれを通す。

## CLI 動作確認（実装完了後に必須）

`npm run check` が通った後、必ず CLI で複数シード × 300年のシミュレーションを実行して整合性エラーがないことを確認する。

```bash
cd prototype
npm run cli -- --years 300 --seed 1
npm run cli -- --years 300 --seed 42
npm run cli -- --years 300 --seed 123
npm run cli -- --years 300 --seed 999
```

エラーなく完走すれば OK。`integritySystem` が検知した違反は `Error:` で即時終了する。

### なぜ CLI 確認が必要か

- 静的型チェックやユニットテストでは、長期シミュレーション中に蓄積する状態整合性バグを検出できない
- Province 数の異常増加、memberIds 重複など、数十〜数百ターン後に初めて顕在化するバグがある
- 異なるシードで確認することで、RNG 分岐の多様なパスをカバーできる

### デバッグモードの活用

整合性エラーが発生した場合、`--debug` フラグで原因システムを特定する：

```bash
cd prototype && npm run cli -- --years 50 --seed 1 --debug 2>&1 | grep INTEGRITY_VIOLATION | head -5
```

最初に `after=XXX` が出たシステムが原因。詳細は「状態整合性バグのデバッグ手法」を参照。

## TypeScript 厳格設定

`prototype/tsconfig.app.json` で以下が有効：

- **`noUncheckedIndexedAccess`**: `Record<BrandedId, T>[key]` は `T | undefined` を返す。必ずガード (`if (!value) return`) を入れる。
- **`exactOptionalPropertyTypes`**: optional prop への `undefined` 明示代入は型エラー。
- **`noUnusedLocals` / `noUnusedParameters`**: 未使用変数・引数はエラー。
- **`strict`**: null チェック等すべて有効。

## Branded ID の扱い

`PersonId`, `HouseId`, `CountryId`, `EventId` 等は branded string 型。

```typescript
// NG: string[] に BrandedId を渡すと型エラー
watchlist.includes(personId)

// OK: as string でキャスト
watchlist.includes(personId as string)

// NG: PersonId 同士の比較なら as string 不要なのに書くと lint エラー
const id = person.id as string  // @typescript-eslint/no-unnecessary-type-assertion

// OK: 同型同士はキャストしない
const id = person.id
```

`EventId` → `string` への代入は直接できる（unnecessary assertion 扱い）。
`BrandedId` を `string[]` と比較するときだけ `(id as string)` を使う。

## パスエイリアス

```typescript
@sim/*  →  prototype/src/sim/*
@/*     →  prototype/src/*
```

`app/` 配下から `sim/` を参照する際は `@sim/` を使う。

## 状態整合性バグのデバッグ手法

整合性違反（「`headId` が `memberIds` にない」など）が報告された場合、**コードを読んで仮説を立てる前に**、まず診断ログを仕込んで原因システムを実測で特定する。

### 手順

**Step 1: `tick.ts` の `run` ラッパーに per-system チェックを追加する**

```typescript
const run = (label: string, fn: (c: TickContext) => TickContext): void => {
  if (debug) {
    const t0 = performance.now()
    ctx = fn(ctx)
    log.perf(label, performance.now() - t0)
    // ← ここに診断チェックを追加
    for (const [hid, house] of Object.entries(ctx.state.houses)) {
      if (!house || !house.active) continue
      if (!house.memberIds.some((m) => (m as string) === (house.headId as string))) {
        log.log('INTEGRITY_VIOLATION', {
          after: label,
          year: ctx.state.currentYear,
          month: ctx.state.currentMonth,
          house: hid,
          headId: house.headId,
          memberIds: house.memberIds.join(','),
        })
      }
    }
  } else {
    ctx = fn(ctx)
  }
}
```

**Step 2: CLI で debug モードを実行してログを確認する**

```bash
cd prototype && node src/cli/run.mjs --years 20 --seed 1 --debug 2>&1 | grep INTEGRITY_VIOLATION | head -5
```

最初に `after=XXX` が出たシステムが原因。そのファイルだけ読めばよい。

**Step 3: 診断コードを必ず削除してから `npm run check` を通す**

診断チェックは一時的なものなので、バグ修正後は `tick.ts` を元に戻す。

### なぜこの順序か

- 状態空間が広いため、コード読解で原因システムを絞り込むのは非効率
- CLI + debug モードが既にあるので、診断ログのコストは 5 分以下
- 原因システムさえ特定できれば、そのファイルだけ読めば十分

## tick システムの追加規約

`prototype/src/sim/tick/tick.ts` に新しいサブシステムを追加する際は、直接呼び出しではなく `run` ヘルパーを使うこと。

```typescript
// NG: PERF ログが出ない
ctx = runNewSystem(ctx)

// OK: debug モードで自動的に計測・ログ出力される
run('newSystem', runNewSystem)
```

`run` ヘルパーは debug モード時のみ `performance.now()` で前後を計測し `[PERF:newSystem] ms=X.XXX` を stderr に出力する。非 debug モードではオーバーヘッドなし。
