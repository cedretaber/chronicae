# Chronicae プロジェクト固有の注意事項

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
