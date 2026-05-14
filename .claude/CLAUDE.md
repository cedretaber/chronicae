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

## qwen 委譲時の注意事項

### 毎回発生する問題と対策

**1. Prettier フォーマット違反（高頻度）**

qwen は実装後に自動でフォーマットを通さない。プロンプトの検証手順に必ず含める：

```
After writing all files, run:
  cd prototype && npm run format -- --write .
Then verify:
  cd prototype && npm run check
```

**2. 不要な `eslint-disable` コメント**

qwen は保守的に `eslint-disable-next-line` を追加しがち。プロンプトに制約として明示する：

```
Do NOT add any eslint-disable comments.
Runtime null checks (if (!value) return) are sufficient — no directives needed.
```

**3. 不要な型アサーション**

型が合っているのに `as string` や `as T` を書いて lint エラーになるケースがある。プロンプトに含める：

```
Branded ID casting rule:
- Only cast to string when comparing a BrandedId with a plain string[].
  Use (id as string) === target or array.includes(id as string).
- Do NOT cast when assigning BrandedId to a BrandedId variable.
- Do NOT use "as" if TypeScript already accepts the type as-is.
```

### qwen プロンプトのテンプレート構造

効果的なプロンプトの構造：

```
[Goal: 何を実装するか]

[Technical requirements]
- ファイルパス
- 型・関数名
- 具体的な動作

[Constraints]
- Do NOT add any eslint-disable comments.
- Do NOT add unnecessary type assertions (as T) if TypeScript already accepts the type.
- Do NOT add code comments unless the logic is non-obvious.
- Branded ID casting rule: only use (id as string) when comparing with a plain string[].

[Existing code context if modifying]
（変更対象ファイルの現在の内容を貼り付ける）

[Verification]
After writing all files, run:
  cd prototype && npm run format -- --write .
  cd prototype && npm run check
Confirm all checks pass before finishing.
```

### パッケージインストールは Claude が直接行う

ライブラリの追加・バージョン変更は qwen に委譲しない。
バージョン互換性の確認が必要な重要作業のため、Claude が直接 `npm install` を実行する。
