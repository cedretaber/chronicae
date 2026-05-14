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
