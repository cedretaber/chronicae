# 14. ゲームバランス観察記録

プロトタイプ段階でのバランス観察結果を記録する。機能追加でバランスが変動するため、各項目にはバージョンと計測条件を付記する。

なお、CLAUDE.md §4 の方針に従い、機能追加が続く現段階ではバランス調整に時間を割かない。ここに記載するのは「観察された傾向」と「将来の調整方針」であり、即座に config を変更するものではない。

---

## 14.1 富の流れ（v0.28 時点）

計測条件: 300年 × 4 seed (1, 42, 123, 999)、standard preset

### 14.1.1 POP wealth

v0.28 で collection friction を wealth 比例化（`× pop.wealth/100`）し、`localExtractionWealthPenalty` を 4→2 に調整。

- **改善前**: POP wealth が0に収束するデススパイラル。生産が停止し Polity treasury も崩壊
- **改善後**: POP wealth は 60-70 付近で均衡。生産が安定し Polity treasury は 2000-5000 で推移

均衡点の理論値: `gain × 100 / (frictionRate × penalty)`。平均的 bailiff (ability 50, profit_seeking) で約52、優秀な bailiff で約80。

### 14.1.2 House / Person wealth の蓄積

House / Person の wealth は際限なく蓄積する傾向がある。根本原因は**支出メカニズムの不足**。

収入経路:
- Polity 余剰分配（Share 比率に応じて）
- Office 給与
- Bailiff 手数料
- 派閥パトロネージ
- 相続（死亡時の遺産）

支出経路（現状）:
- Project 予算（Polity のみ）
- 派閥資金提供

**将来の支出メカニズム候補**（優先度順）:
1. 生活維持費（身分・家格に応じた固定支出）
2. 持参金・婚資
3. 軍事費用
4. パトロネージ拡張
5. 土地購入
6. 災害救済

### 14.1.3 Polity treasury の保留

v0.28 で保留額を固定値(100)から動的(`base 50 + perHolding 50 × holdingCount`)に変更。大国ほど多くの運営資金を確保し、Project 費用・給与原資として機能する。

### 14.1.4 世界全体の生産力低下

ゲーム進行に伴い世界全体の生産力が低下していく傾向が観測されている。v0.28 の POP wealth 安定化で部分的に緩和されたが、Holding 改善の完了率が低いことと合わせ、経済が縮小再生産に陥る可能性が残る。

---

## 14.2 Project バランス（v0.28 時点）

計測条件: 300年 × 4 seed、standard preset

### 14.2.1 develop_holding の結果分布

| 指標 | v0.28 |
|------|-------|
| 完了率 | 17-33% |
| 予算不足 | 7-16% |
| 期限切れ | 38-61% |
| 監督者不在 | 1-2% |
| 中止 | 12% |

v0.28 で deadline を targetProgress に比例化（Level 1=48週, Level 2=96週, Level 3=144週）。旧来の一律48週と比べ Level 2/3 の期限切れが改善。

### 14.2.2 期限切れの構造的原因

Level 1 (target=100) でも期限切れ率が高い主因は **supervisor の actionCapacity 競合**。supervisor は bailiff として collect_holding_revenue や他の aim 系タスクも並行するため、advance_project が実行できない週が多い。

理論値:
- advance_project: actionCost=1.0, effortRequired=3, weeklyEffort=1.5 (ability 50) → 2週/タスク
- 期待進捗/タスク (ability 50): 0.6×25 + 0.2×10 + 0.2×0 = 17
- Level 1 完了に必要: ~6タスク × 3週/サイクル = 18週（理想）
- 実測では actionCapacity 競合で 30-40週

### 14.2.3 将来の改善方針

- **予算不足**: 予算補充ステージの導入（資金ショート時に「追加予算要求」交渉ステージへ遷移）
- **期限切れ**: supervisor の workload 管理・priority 調整、または advance_project の actionCost 軽減
- **成功率全般**: v0.26 時点で89-97%と報告されていたが、v0.28 の deadline 比例化で自然に下がった

### 14.2.4 sell_land プロジェクトが機能していない（v0.29 時点で確認）

`sell_land` プロジェクトの買い手候補選定で `purchaseBuyerTreasuryThreshold: 1500` が高すぎるため、treasury がこの閾値を超える Polity がほぼ存在せず、候補が常に 0 になる。結果として sell_land が実質的に発動しない。

閾値を Polity treasury の実勢値（通常 2000-5000）に対して現実的な値に下げるか、閾値の算出方式自体を見直す必要がある。

---

## 14.3 外交劇バランス（v0.26 時点）

計測条件: 100年 × 4 seed

| 指標 | 値 |
|------|-----|
| 税改定 vs 領地奪取 | 税改定がほぼ全て。領地奪取は 0-22件/100年 |
| 武力衝突率 | 88-92% |
| 交渉決着率 | 8-13% |
| 攻撃側勝率 | 49-57%（ほぼ公平） |
| Polity 数変動 | 100年でほぼ不変（9→9） |

### 課題

- 領地奪取 aim の発生条件が厳しく、税改定が支配的
- 交渉決着メカニズムが弱く escalation しやすい
- 税率変動が5%固定で CONTRACT_ELIMINATED に到達しにくい
- 結果として Polity 数が膠着し、地図の変化に乏しい

### 14.3.1 和平解決が構造的に困難な問題（v0.29 時点で確認）

外交劇の和平解決率が極めて低い（v0.26 計測で 8-13%）。これはバランスの問題ではなく、交渉システム自体の設計ギャップに起因する。

**原因: acceptanceScore が構造的に負になる**

`land_claim` の場合、`acceptanceScore` の正の項は `offeredPrice`（counterDemand 未実装のためほぼ 0）と `defenderTreasuryNeed`（通常は小さい）のみ。一方、負の項（`defenderPower × 0.12`、`provinceValue × 0.3`、`strategicLoss × 0.2`、`prestigeLoss × 0.2`）が支配的で、構造的 progress はほぼ 0 のまま推移する。

タスクベース progress（`negotiate_terms` / `offer_compromise`）で多少は蓄積できるが、同時に initiator 側の `pressure_counterparty` タスクが tension を加算し、構造的 tension 蓄積（毎週 0.33〜4.0）と合わせて escalation 閾値（40）に先に到達する。

**本質的な欠如要素**（小手先のバランス調整では解決不可）:

1. **対案・妥協点の探索** — 現状は「要求を受け入れるか拒絶するか」の二択。counterDemand（「代わりに金銭補償を」「別の土地なら」「税率を下げるなら」等）の応酬で双方の許容範囲が重なる点を見つける仕組みがない
2. **情報の非対称性と駆け引き** — `leverage` / `commitment` / `preparation` の骨格はあるが、交渉テーブル上で実際に条件を動かす仕組みに接続されていない
3. **敗北のコスト** — 武力衝突に負けても特別なペナルティがない。prestige 低下・同盟動揺・内部不満等がなければ、「素直に譲歩する」より「拒絶して戦争する」方が常に合理的

これらは戦争・叛乱システムとの兼ね合いもあり、外交劇全体の設計改修として別途検討する。

### 14.3.2 ステークホルダー共通の国同士の衝突（v0.29 時点で確認）

複数の Polity に Share を持つ House が存在するため、ステークホルダーが共通する国同士が外交劇で衝突することがある。v0.29 で delegate の同一人物重複は防止したが、「そもそも利害が一致する国同士が衝突を起こすべきか」という根本的な問題は未解決。外交劇の設計改修で同時に取り扱う。

### 14.3.3 land_claim が発生しない（v0.29 時点で確認）

`land_claim` を生む aim が事実上発動しない。原因は2つの aim 条件がいずれも初期状態で満たされないこと:

1. **`consolidate_province_holdings`** — 「同一 province 内に自分と他者の holding が混在」が条件。初期状態では各 province の holding は全て同一 polity が保持しており、混在しない。tax revision の結果は税率変更であって holding 移転ではないため、混在状態は自然には生じない
2. **`seize_weak_remote_holdings`** — 隣接 province の holding を狙えるが、`ownPower > targetPower × 1.25` の軍事力差が必要。初期の均衡状態では条件を満たす組み合わせが少ない

v0.29 で `consolidate_province_holdings` の走査バグ（隣接 province 経由ではなく自 province の直接走査に修正）は解決したが、条件自体は変えておらず根本問題は残存。

land_claim を自然に発生させるには、「他者の province の holding を直接狙う」aim 条件（例: 隣接 province の holding を claim する）の追加、または holding 所有権が移動するイベント（戦争結果・相続等）による混在状態の自然発生が必要。外交劇の設計改修と合わせて検討する。

---

## 14.4 人口動態（既知の問題）

### 14.4.1 家門の崩壊

50年で standard の active houses が 54→17 に崩壊する傾向。houseExtinctionSystem で家が消滅すると所属人員も実質的に消える。

**将来の改善方針**: 家が没落しても人員を在野（unaffiliated）に移し、再起の可能性を残す。

---

## 14.5 v0.30 の既知問題

### 14.5.1 offer-driven 化後のバランスは未検証

v0.30 で外交劇を offer-driven に構造改修したが、バランスの良し悪しは未検証。CLAUDE.md §4 の方針に従い、機能完成後にまとめて調整する。

以下の項目は v0.30 で構造的に対応したが、バランスが適切かは別途観察が必要:
- §14.3.1 の和平解決問題: offer 評価 + counterOffer + compromise で妥協点の探索が可能になった。100yr × 4 seed 計測で和平率 51-80%（v0.26 の 8-13% から大幅改善）
- §14.3.3 の land_claim 不発: `debugMixedProvinceHoldingsRatio` で検証経路を確保したが、自然発生率の改善は未確認
- 税率改定 delta が 5% → 10% に拡大
- CONTRACT_ELIMINATED: 300yr × 4 seed で seed あたり 6-8 件発生。`eliminate_overlord_contract` aim から escalation → conflict 勝利の経路で到達。和平経路での elimination は offer 生成が境界値に達しにくいため稀

---

## 14.6 家制度バランス: 有力家系の不在（v0.33+ で初期調整）

### 14.6.1 問題と診断

観察上の問題は「家が多すぎる」ことではなく **「有力な家（大きな多世代家系）が生まれないこと」**。実測（100/300yr × 4 seed, default config）で構造を特定した:

- normal 人口は ~225 で安定均衡（`targetLivingPersons:180`、`baseBirthChancePerMalePerYear:0.06`）。`computeBirthMultiplier` は target 未満でのみブースト、target 超は 1.0 で抑制なし。`mortalitySystem` に密度依存死亡なし → 人口は上限でなく**自然均衡**（出生を上げれば総人口は増える＝ゼロサムでない）。
- その固定的な人口を、増え続ける家が分割。**家の生成は 99% が自力設立（`houseFoundingSystem`）**で分家（`houseSplitEvaluationSystem`）はほぼ寄与なし（100年で cadet 0-3 件）。在野人物（`houselessPersonGenerationSystem`、houseless 目標 = holdings × `houselessPersonsPerHolding`）が設立の燃料。
- 子は父の家に加入・妻は夫の家へ移籍するので家が育つ仕組みはあるが、**繁殖の差別化が無い**ため全家が平均（~2人）に収束。**size-7+ の家は year15 以降ほぼ 0、氏族(clan)は 300年通して 0**（氏族成立は root家＋複数 cadet＋有力家が前提で永遠に未達）。100年で ~300設立/~200絶滅 の高チャーン、定常 ~100家×平均2.1人。

### 14.6.2 v0.33+ の初期調整（栄枯盛衰型・config のみ）

`--config` 実験（100/300yr × 4 seed, snapshot 計測）で確認した事実:

- **出生がゼロサムでない**ことを識別（`baseBirthChancePerMalePerYear` 0.12 で normal 人口 257→516）。出生こそが家サイズの主レバー。
- **設立絞り単独では大家は育たない**（人口が下がるだけ）。**出生↑と設立絞りはセット**で初めて、人口を穏当に保ったまま少数の大家へ集約する。
- ただし flat config で現れる大家は **持続せず栄枯盛衰**（houseId 追跡で year150 の上位12家は year300 で 2家のみ生存・0家が上位維持、初期名門は全滅、上位は全て self_made 成り上がり）。中立な birth-death 過程で大家に自己強化 force が無いため。

採用値（F1）— 「有力家が栄枯盛衰しながら現れる」を狙う最小の一手:

| config | 旧 | 新 |
|---|---|---|
| `baseBirthChancePerMalePerYear` | 0.06 | **0.09** |
| `houseFoundingMonthlyChance` | 0.04 | **0.02** |
| `houseFoundingMaxPerMonth` | 2 | **1** |

効果（300yr × 4 seed）: size-7+ 家が baseline 0 → 2-3 家、maxH 5.8 → ~9、人口は現状規模 ~250 を維持、0 violation、fadedFromHistory 0（在野の無駄 prune なし）。

### 14.6.3 持続 dynasty / 氏族は将来の別システム（権威）で

数百年続く名門 → 分家 → 氏族 を恒常化するには自己強化 signal＋release valve の両方が要る。将来「権威(authority)」システムで対応予定: 一定期間存続した家に権威を付与 → 高権威家は跡継ぎが生まれやすい → かつ大きく/古くなった家を**分裂させやすく**する（cadet-split を valve に）。今回はスコープ外。

### 14.6.4 役職保持の条件付け（別タスク）

`appointmentSystem.tryAppointHouseOffice` は active 全家にサイズ/資産/領地ゲート無しで非 leader Office を埋める（active 家の ~90-95% が Office 保有、~55-70% が「living≤2 かつ役職保有」）。「2人の家に財務官」の不自然さは realism 修正として別タスクで対応予定（有力家出現の目標とは直交）。

---

## 14.7 v0.36 Persistent Regiment（forced-harness 観察）

計測条件: tick() 直接ハーネス（`measureWarB` パターン）、**強制戦争 config**（escalation 閾値↓ + settlement 閾値↑）で 60年 × 4 seed。素の CLI は戦争希少（v0.35 由来）で損耗ループをほぼ踏まないため、強制戦争で観察した。

- **損耗ループは健全**: mobilize → organization/strength 損耗 → organization 回復 → demobilize → destroy → Battle cleanup の全行程が稼働。danglingMobilized=0、regiment 総数安定（maxEver==initial）、disbanded=0（§14.6 reassign が土地移転を吸収）。300年 × 4 seed standard は integrity 違反 0。
- **destroy 率は戦争密度に比例する（調整保留）**: 強制 config で 60年に 58-123 戦争を詰め込むと active regiment の最大 ~半数が destroyed になった。素の 300年 standard では戦争希少のため decay は小さい。
- **~~active regiment プールは構造的に非増加~~（v0.36 補充・再編成で解消済）**: かつて destroy 永続・生成は worldgen のみ・§14.6 reassign は数を保つだけ、で「戦争が頻繁になるほど軍事力が床なしで減衰する」構造があった。**v0.36 補充・再編成（§6.27g RegimentReinforcementSystem）でプールは自己修復するようになった**: active は strength を月次 silent 補充し、destroyed は reform 遅延後に再編成される。よって「床なし減衰」はもはや成立しない。
  - ただし **transient は残る**: reform には ≥`destroyedRegimentReformDelayWeeks`（既定 24週）の平時が要り、開戦 AI は連隊在庫を見ないため、「全滅直後の Polity が攻撃側で開戦」は steady-state では解消するが瞬間的には起こりうる（開戦 AI gate は future。§13）。
- **補充・再編成の実証（forced harness 60年 × 4seed, A/B 比較）**: 補充 OFF（対照）は旧 decay を再現（maxDestroyed 8-14・active 30→16 等）。**フル ON は maxDestroyed 0-1・active ほぼ初期維持・avgActiveStrength ~98-100**（strength 補充が destroy 到達前に回復させる＝一次機構）。フル ON で reform イベントが 0 件なのは destroy 自体が稀になるためで、バグでも設計限界でもない: 別途 strength 補充だけ OFF にして destroy を蓄積させると reform は 29-148 件発火し（active が再建で回復）、destroyed Regiment は home holding を保持（terminal==owner）したままのことが多く reform は到達可能と確認した（territory 喪失で恒久ブロックされる設計限界ではない）。reform は二次の安全網。
- 損耗 / 回復 / 補充 / reform の config（damage レンジ・recovery 率・destroy 閾値・補充速度・reform 遅延等）は仮値。avgActiveStrength ~100（戦争がほぼ非攻城的になった）等の balance は CLAUDE.md §4 に従い戦争系機能がひと通り入った段階でまとめて調整する。

---

## 改訂履歴

| バージョン | 変更内容 |
|-----------|---------|
| v0.28 | 初版作成。POP wealth 安定化、Polity 保留額動的化、Project deadline 比例化の観察結果を記録 |
| v0.29 | §14.2.4 sell_land 機能不全、§14.3.1 和平解決構造的問題、§14.3.2 ステークホルダー共通衝突、§14.3.3 land_claim 不発を追記 |
| v0.30 | §14.5 offer-driven 化後のバランス未検証の既知問題を追記 |
| v0.33+ | §14.6 家制度バランス（有力家系の不在）の診断と初期調整（出生↑＋設立絞り）を追記。observation 基盤に houses/clans snapshot を追加 |
| v0.36 | §14.7 Persistent Regiment forced-harness 観察を追記（損耗ループ健全・destroy 率は戦争密度比例・active プール非増加で v0.37 reinforcement まで decay は仕様）|
| v0.36 補充・再編成 | §14.7 を更新。RegimentReinforcementSystem（§6.27g）でプールが自己修復するため「床なし減衰」は解消。残る transient（全滅直後の開戦）と開戦 AI gate は future |
