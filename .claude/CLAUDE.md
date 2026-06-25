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

- **必須条件**: エラーが出ずシミュレーションが継続できること (150 年 × 4 seed で integrity 違反なし。リリース前は任意で 300 年 × 1 seed を追加)
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

### レイヤー間の依存ルール

`sim/` は純粋なシミュレーション層であり、**`i18n/` や `app/` に依存してはならない**。

- `sim/` が扱うテキストデータは nameKey（ロケール中立な識別子）で保持する。ロケール固有の表示文字列への解決は `app/` または `i18n/` 層の責務。
- SimEvent の `messageParams` にも nameKey や raw enum 値を格納し、翻訳キーへの変換は eventRenderer（`i18n/`）側で行う。
- `app/` → `sim/` の参照は `@sim/` エイリアス経由で許可。逆方向（`sim/` → `app/`、`sim/` → `i18n/`）は禁止。

### UI の時間表記規約

UI 上で「時点 (timestamp)」を表示する場合は、**必ず「N年M月第W週」形式に統一する**（暦は 1年=48週=12ヶ月×4週）。
`Year X / Week Y`・`[year/Wweek]`・年だけ、などのアドホックな表記を新たに足さない。

- 共通フォーマッタは `src/app/utils/format.ts` に集約。新規の日付表示は必ずこれを使う:
  - `formatAbsoluteWeek(absoluteWeek)` — `createdWeek` / `deadlineWeek` / `startedWeek` / `foundingWeek` など絶対週から
  - `formatYearWeek(year, weekOfYear)` — `ChronicleEntry` / `SimEvent` の year+weekOfYear ペアから
  - `formatMonthWeek(weekOfYear)` — 年でグルーピング済みの文脈（timeline の年見出し配下など）で年を省く場合
  - `formatYear(year)` — 週情報を持たない年のみの時点（グルーピング見出しなど）
- i18n キーは `detail.common.{year_month_week,month_week,year_only}`（ns=ui）。
- **「期間・年齢」は時点ではない**ので対象外（「X年前」「残りX年」「派閥の年齢」等はそのまま）。

すべての npm コマンドは `prototype/` ディレクトリ内で実行する。

`npx` は使わず、常に `npm run <script>` を使う。
単一ファイルのみに適用したい場合は `--` でパスを渡す:

```bash
npm run format -- src/sim/tick/someFile.ts
npm run lint -- src/sim/tick/someFile.ts
```

## 仕様書のナビゲーション

仕様書を読む・編集する前に、まず **`docs/SPEC.md`（目次）を開く**。ファイル名は推測しない（過去に実在しない spec ファイル名を幻覚してコミットメッセージに書いた手戻りがある）。

- **spec は章別構成**（機能別ファイルではない）。全サブシステムは `docs/spec/06-systems.md` に集約される（例: IntegrityCheck = §6.24、War ライフサイクル = §6.27a-d）。`12-war-lifecycle.md` のような直感的なファイルは**存在しない**。
- **コードコメント・エラーメッセージ・型定義の `§X` は作業ドラフト (`docs/drafts/spec-v0XX-update.md`) の番号**で、統合 spec の §番号とは一致しない。さらにドラフト本体は git 管理外で repo に無いことがある（v0.34 の `spec-v034-update.md` は実在しない）。spec 上の該当箇所は **§番号で探さず、キーワードで内容検索する**（例: `rg "WarGoal" docs/spec/06-systems.md`）。コードの `(§X)` は引用ではなく主張として扱い、裏取りする。
- **実装→spec 同期（§3 の責務）は `docs/spec/`（git 管理の正本）に対して行う**。§3 本文は「ドラフト spec を更新」とあるが、ドラフトが repo に無い場合は統合 spec の対応章（多くは `06-systems.md`）を更新するのが正しい同期先。
- コミットメッセージやレポートに spec のパス・§番号・「spec ではこうなっている」と書く前に、**引用元を実際に開いて実在と内容を確認する**。

## 動作確認の方針

動作確認は **CLI を基本** とする。ブラウザ（Chrome DevTools / Playwright 等）は UI 表示の確認が必要な場合のみ使用する。

- **ロジック・状態の確認**: CLI (`node src/cli/run.mjs`) + `--debug` フラグ
- **整合性検証**: CLI × 複数シード（後述）
- **パフォーマンス計測**: CLI × `--debug` の PERF ログ
- **UI 表示の確認**: ブラウザ（dev server `npm run dev` 起動後）

ブラウザは起動・操作に時間がかかるため、ロジックのデバッグには使わないこと。

### dev server (`npm run dev`) は Claude から起動しない

UI 表示の確認が必要な場合でも、**dev server の起動はユーザーが行う**。Claude が `npm run dev`（および dev server を立ち上げる同等のコマンド）を起動するのは、**ユーザーから明確に指示された場合に限る**。

- 「ブラウザで確認したい」とユーザーが述べても、それだけでは起動指示とはみなさない。確認が必要なら「`http://localhost:5173/` で確認できます」と案内し、起動はユーザーに委ねる。
- 静的検証（`npm run check` / `npm run build`）や CLI による確認は従来どおり Claude が実行してよい。
- 既に Claude が起動してしまった dev server は、不要になった時点で停止する。

### CLI での config オーバーライド

動作確認のために閾値を一時的に変更したい場合は、**`defaultConfig.ts` を編集せず** `--config` 引数で上書きする。

```bash
# 例: Clan 成立閾値を下げて動作確認
node src/cli/run.mjs --years 50 --seed 1 --config '{"clanFormationMinDirectCadetHouses":1,"clanFormationMinInfluentialHouses":1,"clanFormationMinTotalLivingMembers":5}'

# 例: 分家閾値も同時に緩和
node src/cli/run.mjs --years 50 --seed 1 --config '{"minProvincesForHouseSplit":1,"baseHouseSplitChance":0.3,"houseSplitMinLivingMembers":3,"clanFormationMinDirectCadetHouses":1}'
```

`--config` は JSON オブジェクトを受け取り、`defaultConfig` のキーをそのまま上書きする。コード変更がないため戻し忘れのリスクがない。

ブラウザでの UI 確認など CLI 以外が必要な場合のみ、やむを得ずコードを一時変更する（その場合も最小限にし、確認後に必ず元に戻す）。

### CLI の Chronicle 出力 (v0.62)

CLI 実行時、Chronicle は JSONL ファイルに自動出力される（デフォルトで cwd）。

```bash
# デフォルト: chronicle-{timestamp}-seed{N}.jsonl が cwd に出力
node src/cli/run.mjs --years 50 --seed 1

# 出力先ディレクトリを指定
node src/cli/run.mjs --years 50 --seed 1 --chronicle-dir /tmp

# 比較用にタグを付与
node src/cli/run.mjs --years 50 --seed 1 --chronicle-tag before-fix

# Chronicle 出力を抑止 (integrity gate 等で不要な場合)
node src/cli/run.mjs --years 150 --seed 1 --no-chronicle
```

標準ゲート (150年 × 4 seed) では `--no-chronicle` を推奨（不要な I/O を省くため）。

## 検証コマンド

```bash
cd prototype && npm run check
```

`check` = `typecheck + lint + format:check + test` の一括実行。実装後は必ずこれを通す。

## CLI 動作確認（実装完了後に必須）

`npm run check` が通った後、CLI で複数シード × シミュレーションを実行して整合性エラーがないことを確認する。

```bash
# 開発中の繰り返し確認 / commit 前の確認（4 seed × 150年、~2.5分）
cd prototype
for s in 1 42 123 999; do
  node src/cli/run.mjs --years 150 --seed $s > /tmp/seed$s.log 2>&1 &
done
wait
echo "All 4 seeds finished"

# リリース前の追加確認（任意。300年 × 1 seed、~8分）
cd prototype
node src/cli/run.mjs --years 300 --seed 1 > /tmp/seed1_300y.log 2>&1
echo "300y finished"
```

エラーなく完走すれば OK。`integritySystem` が検知した違反は `Error:` で即時終了する (default では year-end のみ走るが、検知即座に throw して exit code 非 0 で停止)。

### 所要時間の目安

> **前提: この節の数値はすべて default の `tiny` preset (4 states / 6 counties)**。
> `--preset small/standard/perfLarge` を付けると桁違いに遅くなる (後述「⚠️ preset と所要時間」)。

v0.47 perf 最適化後の実測値 (16 コア・4 seed 並列 wall-clock):

| 年数 | 1 seed 直列 | 4 seed 並列 | 旧 (v0.46 main) |
|---|---|---|---|
| 100年 | ~60 sec | ~70 sec (実測 68s) | ~105 sec |
| 150年 | 2m04s (実測) | ~2.5 min 見込み | — |
| 200年 | 3m34s (実測) | ~4 min 見込み | — |
| 300年 | 8m18s (実測) | ~11 min 見込み | ~18.5 min |

後年ほど 1 年あたりのコストが伸びる超線形性は残存 (150→200年 +90s / 200→300年 +284s)。

**v0.47 perf 最適化** (state spread の構造改善・全 bit-identical) で 100年 × 4 seed が
105s → 68s (-35%) になった。主な内容: houseSurplus・landRevenue・factionPatronage・goalOutcome・houseShareUpdate の
mutable-draft 化 / republic 候補列挙の家単位 memo 化 /
personActivityLogs の person key 2 層バケット化。残る後年成長項は
死者・評判の蓄積 (watermark 増分化・死者 compaction は将来候補。
docs/drafts/perf-optimization-design.md 参照)。

**v0.62 Chronicle 外部化**: Chronicle を WorldState から完全に分離し外部ストレージへ移行。
state の 65% (30年 small で 24.56 MB) を占めていた chronicleEntries/chronicleIndex を除去。
ブラウザの OOM (preset=small 30年) を解消。CLI は JSONL ファイル出力
(`--chronicle-dir`/`--chronicle-tag`/`--no-chronicle`)、Browser は IndexedDB にバッチ書き出し。

### 用途別の推奨設定

| 用途 | 推奨 | 所要時間 |
|---|---|---|
| 開発中の繰り返し確認 | **150年 × 4 seed 並列** | ~2.5 min |
| commit 前の確認 | **150年 × 4 seed 並列** | ~2.5 min |
| リリース前 | 150年 × 4 seed 並列 + 任意で 300年 × 1 seed | ~2.5 min (+ ~8 min) |
| 時間計測・perf 比較 | 直列 (CPU 競合でブレるため) | — |

**標準ゲートは 150年 × 4 seed (v0.47)**。v0.47 perf 最適化で 150年が ~2.5 分に収まるようになった
ため、開発中・commit 前の標準を 100年から 150年に引き上げた (長期蓄積バグの検出窓を 1.5 倍に拡大)。
150年で integrity が green なら commit してよい。**CI はさらに広い 200年 × 4 seed** (ci.yml の
YEARS=200。timeout-minutes 20 に収まらなければ 150 に戻す)。300年はリリース前や長期蓄積バグの
疑いがあるときの任意確認 (~8 min/seed)。

20年では検出できない長期蓄積バグが100年で顕在化した実績がある（DiplomaticPlay delegate 死亡バグ等）。開発中でも最低 150 年は確認すること。

### ⚠️ preset と所要時間 (不意の長時間実行を防ぐ)

**`--preset` を `tiny` (default) 以外にすると、世界規模に対してコストが超線形に膨らむ。**
何も考えず `--preset standard --years 150` のような確認を走らせると数十分かかり、開発サイクルを壊す。

2026-06-13 実測 (直列・seed1・wall-clock 秒):

| preset | 規模 (states/counties) | 5yr | 10yr | 20yr | 50yr | 100yr | 150yr |
|---|---|---|---|---|---|---|---|
| **tiny** (default) | 4 / 6 | 1.0 | 1.6 | 3.9 | (~20) | ~60s | ~124s |
| **small** | 9 / 15 | 3.4 | 7.2 | 17.1 | **59s** | **~2.6 min**(外挿) | **~4.6 min**(外挿) |
| **standard** | 16 / 30 | 19.9 | 40.5 | **91s** | **~5 min**(外挿) | **~13 min**(外挿) | **~20–25 min**(外挿) |
| perfLarge | 25 / 50 | — | — | — | — | — | perf 計測専用 |

年数倍率に対する時間倍率は preset を問わず加速する超線形 (small: 20→50年で 3.5x、standard: 5→20年で 4.6x)。
外挿値は加速分を含みきれないため**下振れ (実際はもっと遅い)** とみなすこと。

**運用ポリシー:**

| preset | 許可される用途 | 年数上限の目安 (単一 seed が数分以内) |
|---|---|---|
| **tiny** | 標準ゲート (150×4)・全 routine 確認 | 〜300年 |
| **small** | 規模依存バグのスポット確認のみ | **〜50年** (100年×4seed は禁止) |
| **standard** | 規模上限の単発確認のみ・**年数短縮必須** | **〜20–25年** (100年以上は禁止) |
| **perfLarge** | perf 計測専用 | 〜10年 |

**禁止ライン (絶対に routine では走らせない):**

- `--preset standard` で **100年以上** (50年でも単一 ~5 min)
- `--preset small` で **150年 × 4 seed** (並列でも ~5–8 min 見込み)
- `standard` / `perfLarge` を**標準ゲートや commit 前確認に使うこと** (tiny 一択)

**原則: 標準ゲート・整合性確認は常に default の `tiny` で行う。** large preset を使うのは「規模に依存して初めて出るバグ」を疑う単発調査に限り、その場合も**年数を必ず短縮**する (standard なら ≤25年、small なら ≤50年)。large preset × 長年数の組み合わせを反射的に投げないこと。

### なぜ CLI 確認が必要か

- 静的型チェックやユニットテストでは、長期シミュレーション中に蓄積する状態整合性バグを検出できない
- Province 数の異常増加、memberIds 重複など、数十〜数百ターン後に初めて顕在化するバグがある
- 異なるシードで確認することで、RNG 分岐の多様なパスをカバーできる

### デバッグモードの活用

整合性エラーが発生した場合、`--debug` フラグで原因システムを特定する：

```bash
cd prototype && npm run cli -- --years 50 --seed 1 --debug 2>&1 | rg INTEGRITY_VIOLATION | head -5
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

整合性違反（「`headId` が `memberIds` にない」など）が報告された場合、**コードを読んで仮説を立てる前に**、まず `--integrity-per-system` フラグで原因システムを実測で特定する。

### 手順

**Step 1: `--integrity-per-system` フラグで CLI を実行する**

```bash
cd prototype && node src/cli/run.mjs --years 20 --seed 1 --integrity-per-system 2>&1 | rg INTEGRITY_AFTER | head -5
```

このフラグは各 system 実行後に `runIntegritySystem` を try-catch で走らせ、違反があれば `[DEBUG:INTEGRITY_AFTER] system=XXX year=Y week=Z error=...` を stderr に出力する。

最初に出たシステムが原因。そのファイルだけ読めばよい。

**注意**: 非常に遅い（全 system × integrity check のコスト）。20 年程度の短い年数で使うこと。300 年では使わない。

**Step 2: 中間状態の violation と本物の violation を区別する**

一部の violation は正常な中間状態（例: mortalitySystem 後に dead person の wealth が残る → estateSettlementSystem が処理する）。
同じ violation が最終 system まで残っていれば本物のバグ。rg 出力の `system=` を見て、どの system で初出し、どの system で解消されるかを追跡する。

**Step 3: 違反が指すエンティティの「状態」を、修正方針を立てる前に実測する**

整合性メッセージは「何が壊れているか」は示すが「そのエンティティがどの状態か」は示さない。修正方針を分ける情報（例: War なら `status` が active か terminal か）を、エラーメッセージ生成箇所に一時的に足して再現実行し、**仮説で実装に進む前に実測で確定させる**。

実例（v0.34 War）: 「War が消えた landContract を参照」違反は、`status` を足して実測したら active ではなく `defender_won`（terminal）だった。terminal／履歴レコードが retention 中に別システムの参照削除で dangling 化するケースがあり、**エンティティの状態次第で正しい修正が逆になる**（active war を救済する vs terminal war の dangling を許容する）。状態を見ずに仮説で実装したため、最初に書いた修正を巻き戻す手戻りが発生した。

### なぜこの手法か

- 状態空間が広いため、コード読解で原因システムを絞り込むのは非効率
- `--integrity-per-system` はコード変更不要で即座に利用可能
- 原因システムさえ特定できれば、そのファイルだけ読めば十分

## パフォーマンス分析手法 (per-system perf log)

シミュレーションが遅い・seed 間で実行時間に大きな差がある場合は、`--debug` の `[PERF:<system>] ms=X.XXX` ログを集計してホットスポットを特定する。

### 手順

**Step 1: 2 seed 分の perf log を取る**

比較対象として「遅い seed」と「速い seed」の両方を計測する。1 seed だけでは絶対値しか分からない。

```bash
cd prototype
node src/cli/run.mjs --years 10 --seed 1   --debug 2>/tmp/perf1.log   > /dev/null
node src/cli/run.mjs --years 10 --seed 999 --debug 2>/tmp/perf999.log > /dev/null
```

NOTE: v0.23 以降は 10 年で十分なデータが取れる。300 年 perf 計測は非常に時間がかかるため避ける。

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

### 既知のベースライン

**v0.17.3 時点 (TaskSystem 導入前):**

300 年 × 1 seed の wallclock 直列:
- seed 1: ~40 sec (最長)
- seed 999: ~26 sec (最短)

**v0.23 時点 (TaskSystem 導入後、最適化前):**

10 年 × 1 seed の per-system 実測:
- taskSystem: 6.9 sec (全体の 79%)
- personAimMaintenanceSystem: 0.9 sec
- 他全システム合計: 0.9 sec
- 50 年 × 1 seed: ~2 min 39 sec

**v0.23.1 時点 (mutable draft + Schwartzian 最適化後):**

10 年 × 1 seed の per-system 実測:
- personAimMaintenanceSystem: 0.8 sec (全体の 39%)
- taskSystem: 0.45 sec (全体の 22%) — 93% 削減
- 他全システム合計: 0.8 sec
- 50 年 × 1 seed: ~27 sec (5.9x 高速化)

**v0.23.2 時点 (taskIndex 空エントリ purge + 死亡者ログ purge 後):**

10 年 × 1 seed の per-system 実測:
- integrityCheck: 303 ms (debug only)
- taskSystem: 264 ms — さらに 42% 削減
- personAimMaintenanceSystem: 129 ms — 84% 削減
- 50 年 × 1 seed: ~5 sec (v0.23.1 比 5.4x 高速化)
- 300 年 × 4 seed 並列: ~68 sec

**v0.23.3 時点 (personAimMaintenanceSystem mutable draft 後):**

10 年 × 1 seed の per-system 実測:
- integrityCheck: 283 ms (debug only)
- taskSystem: 247 ms
- personAimMaintenanceSystem: 50 ms — 59% 削減
- 全体: 951 ms (v0.23.2 比 8% 削減)

最適化の中身 (v0.23.1):
- **taskSystem mutable draft**: 1 tick あたり数十回の WorldState spread を初回/最終の1回に集約。-93%。
- **Schwartzian transform**: batchProcessTasks の priority sort で computeEffectivePriority の呼び出しを O(n log n) → O(n) に削減。
- **officeIndex 活用**: personAimSelectors の officeAssignment 全走査を byHolderPerson インデックス参照に置換。-9%。

最適化の中身 (v0.23.2):
- **taskIndex 空エントリ purge**: removeTaskMut で filter 後に空配列となった byAssignee/byOwner/byTarget エントリを delete。state spread コスト削減。
- **死亡者 personActivityLog purge**: deadPersonLogPurgeSystem を新設。死亡時にログを収集してから削除。state 全体の 60-70% を占めていた死亡者ログを解消。

最適化の中身 (v0.23.3):
- **personAimMaintenanceSystem mutable draft**: taskSystem と同パターンを適用。createInitialTaskForAim のインライン mutable 版、emitEvent ローカル accumulator、RNG ローカル追跡を導入。-59%。

過去の最適化 (v0.17.3):
- integrityCheck を年末のみ実行 (default 非 debug 時)。-38%。
- inactive OfficeAssignment を完全削除。state.officeAssignments の累積を解消。-76%。
- inactive FactionMembership を完全削除。誤差レベル。

### パフォーマンス最適化の方針

v0.23.1 / v0.23.3 で taskSystem・personAimMaintenanceSystem に mutable draft パターンを導入済み。今後同様のボトルネックが発生した場合は同パターンの適用を検討する。

残る最適化候補（機能完成後に検討）:
- 死亡 Person の compaction (lineage 参照を保ちつつ archive map に逃がす)
- `state.persons` を `living / dead` 二分割

## tick システムの追加規約

`prototype/src/sim/tick/tick.ts` に新しいサブシステムを追加する際は、直接呼び出しではなく `run` ヘルパーを使うこと。

```typescript
// NG: PERF ログが出ない
ctx = runNewSystem(ctx)

// OK: debug モードで自動的に計測・ログ出力される
run('newSystem', runNewSystem)
```

`run` ヘルパーは debug モード時のみ `performance.now()` で前後を計測し `[PERF:newSystem] ms=X.XXX` を stderr に出力する。非 debug モードではオーバーヘッドなし。

---

## ローカル設定の取り込み

以下は git 管理外の手元固有設定 (LSP セットアップ、環境依存の注意書きなど)。
この環境では `CLAUDE.local.md` が自動ロードされないため、明示インポートで文脈に取り込む。

@CLAUDE.local.md
