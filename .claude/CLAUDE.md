# Chronicae プロジェクト固有の注意事項

## 開発方針 (プロトタイプ段階)

Chronicae はまだプロトタイプ段階であり、観賞用シミュレーションとして「面白いか」「歴史らしい変化が発生するか」を検証することが最優先。
そのため以下の方針で開発を進める。

### 1. 積極的な機能改修を歓迎する

破壊的変更やバランス崩壊を恐れずに新機能を入れてよい。
小さな改善より「ゲーム全体として観賞対象になっているか」を高める変更を優先する。

### 2. 仕様書に無い修正も、方向性に合致していれば実装する

仕様書 (`docs/spec/`, `docs/drafts/spec-v0XX-update.md`) は実装中の判断基盤だが、
実装中に「仕様書には無いがゲーム全体の目的に沿った拡張・調整」が必要だと気付くことがある。

そのような場合は、仕様書の文面に縛られず実装してよい。
代わりに、**変更を入れた仕様書を即座に追従更新する** こと（実装→仕様書同期）。

判断基準は以下:

- `docs/spec/01-overview.md` (概要 / 検証目的) と矛盾しないか
- 既存の他システムと整合が取れているか
- プロトタイプの「観賞対象としての面白さ」を損なわないか

### 3. 仕様書追従の責務

実装でやったことは必ず仕様書に反映する。
- 新しい挙動を入れた → 該当ドラフト spec の対応セクションを更新
- パラメータの推奨値を変えた → §配下の config セクションを更新
- spec の既存条文を緩和・拡張した → その条文に「v0.15 でこう拡張」と注記

この同期を怠ると、後続の Phase で「spec が古くて誤った判断をする」事故が起きる。

### 4. バランス調整は機能完成後に行う

v0.15 段階では機能拡張が続いている。各機能追加がバランスに影響するため、
現段階でバランス調整に時間を割いても次の機能で台無しになる。

そのため:

- **必須条件**: エラーが出ずシミュレーションが継続できること (300 年 × 4 seed で integrity 違反なし)
- **任意条件 (現段階では不問)**: バランスの良さ・面白さ・収束パターン (どの Polity が勝ちやすいか、houses が分裂する頻度、年あたりイベント数など)

機能追加 PR ではバランスの善し悪しを判断基準にしない。
予定された機能（LandContract / Faction / 称号 / 多重臣従など）がひと通り入った段階で、
改めて歴史を観察してまとめてバランス調整を行う。

ユーザーが「観察してみた」報告をくれた際も、エラーや矛盾の指摘でなければ即座に config を触らないこと。「いずれ調整しましょう」と保留する。

### 参考

- 上記方針が初めて適用された例: v0.15 §13.2 拡張 (AppointmentSystem に `ownerHouseId 経由の候補者許容` を追加し、ドラフト spec も同時に追記)

---

## プロジェクト構成

```
Chronicae/
├── .claude/         # Claude Code 設定
├── docs/            # 仕様書（SPEC.md = 目次, spec/ = 各章）
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

**整合性検証なら並列実行が高速** (v0.17.3 時点で 4 seed 合計 ~125 sec、並列なら最長 seed 1 のみで ~40 sec)。

```bash
# 並列実行 (整合性検証用 — wallclock 時間を最短にしたい場合)
cd prototype
for s in 1 42 123 999; do
  node src/cli/run.mjs --years 300 --seed $s > /tmp/seed$s.log 2>&1 &
done
wait
echo "All 4 seeds finished"

# 個別検証 (デバグ目的で順次走らせたい場合)
npm run cli -- --years 300 --seed 1
npm run cli -- --years 300 --seed 42
npm run cli -- --years 300 --seed 123
npm run cli -- --years 300 --seed 999
```

エラーなく完走すれば OK。`integritySystem` が検知した違反は `Error:` で即時終了する (v0.17.3 から default では year-end のみ走るが、検知即座に throw して exit code 非 0 で停止)。

**並列 vs 直列の使い分け:**

| 用途 | 推奨 |
|---|---|
| 整合性検証 / 観察 report 生成 | 並列 (`&` + `wait`) |
| 時間計測・perf 比較 | 直列 (CPU 競合でブレるため) |

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

## パフォーマンス分析手法 (per-system perf log)

シミュレーションが遅い・seed 間で実行時間に大きな差がある場合は、`--debug` の `[PERF:<system>] ms=X.XXX` ログを集計してホットスポットを特定する。

### 手順

**Step 1: 2 seed 分の perf log を取る**

比較対象として「遅い seed」と「速い seed」の両方を計測する。1 seed だけでは絶対値しか分からない。

```bash
cd prototype
node src/cli/run.mjs --years 300 --seed 1   --debug 2>/tmp/perf1.log   > /dev/null
node src/cli/run.mjs --years 300 --seed 999 --debug 2>/tmp/perf999.log > /dev/null
```

**Step 2: per-system に合計時間を集計する**

```bash
node -e "
const fs = require('fs');
function aggregate(path) {
  const totals = new Map();
  for (const line of fs.readFileSync(path, 'utf8').split('\n')) {
    const m = /^\[PERF:(\S+)\] ms=([\d.]+)/.exec(line);
    if (!m) continue;
    totals.set(m[1], (totals.get(m[1]) ?? 0) + parseFloat(m[2]));
  }
  return totals;
}
const a = aggregate('/tmp/perf1.log');
const b = aggregate('/tmp/perf999.log');
const sys = new Set([...a.keys(), ...b.keys()]);
const rows = [...sys].map(s => ({ s, a: a.get(s) ?? 0, b: b.get(s) ?? 0 }));
rows.sort((x, y) => y.a - x.a);
for (const r of rows) {
  if (r.a < 1000 && r.b < 1000) continue;
  console.log(r.s.padEnd(34), r.a.toFixed(0).padStart(10), r.b.toFixed(0).padStart(10), (r.a / Math.max(1, r.b)).toFixed(2).padStart(7));
}
"
```

**Step 3: 結果の読み方**

| 観察 | 解釈 |
|---|---|
| 特定 system の ratio が突出して悪い (例: 3x+) | その system が seed 1 の state 構造 (Faction 数や Polity owner churn など) に対して non-linear | 
| ほぼ全 system が同じ ratio (例: 全部 2x) | アルゴリズムバグではなく state 累積差。Object.keys 系の走査が状態サイズに連動 |
| 絶対値が大きい system | 最適化候補。ratio が小さくても share が大きければ価値あり |

### 既知のベースライン (v0.17.3 時点)

300 年 × 1 seed の wallclock 直列:
- seed 1: ~40 sec (最長)
- seed 999: ~26 sec (最短)
- 4 seed 合計: ~125 sec (v0.17.2 比 -85% 短縮)

短縮の中身 (v0.17.3 で実装):
- **A**: integrityCheck を年末のみ実行 (default 非 debug 時)。-38%。
- **B**: inactive OfficeAssignment を完全削除。state.officeAssignments の累積を解消。A の上でさらに -76%。
- **C**: inactive FactionMembership を完全削除。Office 比で量が少なく計測上は誤差レベル。

### v0.18 以降の最適化候補

短縮済みのため優先度は下がったが、機能完成後に検討する候補:
- 死亡 Person の compaction (lineage 参照を保ちつつ archive map に逃がす)
- `maxRawEvents` を default で絞る (現状 10000)
- `state.persons` を `living / dead` 二分割

これらは機能完成後にまとめて対応する方針 (上記「バランス調整は機能完成後」と同じ理由)。

## tick システムの追加規約

`prototype/src/sim/tick/tick.ts` に新しいサブシステムを追加する際は、直接呼び出しではなく `run` ヘルパーを使うこと。

```typescript
// NG: PERF ログが出ない
ctx = runNewSystem(ctx)

// OK: debug モードで自動的に計測・ログ出力される
run('newSystem', runNewSystem)
```

`run` ヘルパーは debug モード時のみ `performance.now()` で前後を計測し `[PERF:newSystem] ms=X.XXX` を stderr に出力する。非 debug モードではオーバーヘッドなし。
