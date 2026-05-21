# 2. 技術構成

- **フロントエンド**: React + TypeScript + Vite + Tailwind CSS
- **地図描画**: SVG Voronoi ベース（d3-delaunay）。v0.20.2 で ReactFlow (`@xyflow/react`) を撤去
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
npm run cli -- --seed <seed> --years <n> [--weeks <n>] [--integrity-check] [--json]
```

コーディングエージェントがバグ検出・動作確認に利用することを想定している。

`--debug` フラグを追加すると `config.debug = true` で動作し、以下が変化する：

- **イベント出力（stdout）にエンティティ ID を付記**：`PERSON_DIED: Irmela has died at age 35. [pe-42, h-3, c-0]`
- **構造化デバッグログを stderr に出力**：`[DEBUG:TAG] key=value ...` 形式（SUCCESSION / BIRTH / MARRIAGE / HOUSE_SPLIT / HOUSE_EXTINCT / INTEGRITY / YEAR）。タグ単位で `grep` による機械的抽出が可能
- **IntegrityCheck 違反が非致死的**：例外の代わりに `[DEBUG:INTEGRITY] error=...` として stderr に出力し、シミュレーションを継続する

---

