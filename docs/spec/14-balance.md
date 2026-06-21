# 14. ゲームバランス観察記録

プロトタイプ段階でのバランス観察結果を記録する。機能追加でバランスが変動するため、各項目には計測条件を付記する。

なお、CLAUDE.md §4 の方針に従い、機能追加が続く現段階ではバランス調整に時間を割かない。ここに記載するのは「観察された傾向」と「将来の調整方針」であり、即座に config を変更するものではない。

---

## 14.1 富の流れ

計測条件: 300年 × 4 seed (1, 42, 123, 999)、standard preset

### 14.1.1 POP wealth

collection friction は wealth 比例（`× pop.wealth/100`）、`localExtractionWealthPenalty` は 2。

- **比例化前**: POP wealth が0に収束するデススパイラル。生産が停止し Polity treasury も崩壊
- **現状**: POP wealth は 60-70 付近で均衡。生産が安定し Polity treasury は 2000-5000 で推移

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

保留額は動的（`base 50 + perHolding 50 × holdingCount`）。大国ほど多くの運営資金を確保し、Project 費用・給与原資として機能する。

### 14.1.4 世界全体の生産力低下

ゲーム進行に伴い世界全体の生産力が低下していく傾向が観測されている。POP wealth 安定化で部分的に緩和されたが、Holding 改善の完了率が低いことと合わせ、経済が縮小再生産に陥る可能性が残る。

---

## 14.2 Project バランス

計測条件: 300年 × 4 seed、standard preset

### 14.2.1 develop_holding の結果分布

| 指標 | 値 |
|------|-------|
| 完了率 | 17-33% |
| 予算不足 | 7-16% |
| 期限切れ | 38-61% |
| 監督者不在 | 1-2% |
| 中止 | 12% |

deadline は targetProgress に比例（Level 1=48週, Level 2=96週, Level 3=144週）。一律48週だった頃と比べ Level 2/3 の期限切れが改善している。

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
- **成功率全般**: かつて89-97%と報告されていたが、deadline 比例化で自然に下がった

### 14.2.4 sell_land プロジェクトが機能していない

`sell_land` プロジェクトの買い手候補選定で `purchaseBuyerTreasuryThreshold: 1500` が高すぎるため、treasury がこの閾値を超える Polity がほぼ存在せず、候補が常に 0 になる。結果として sell_land が実質的に発動しない。

閾値を Polity treasury の実勢値（通常 2000-5000）に対して現実的な値に下げるか、閾値の算出方式自体を見直す必要がある。

---

## 14.3 外交劇バランス（offer-driven 化前の観察）

計測条件: 100年 × 4 seed

| 指標 | 値 |
|------|-----|
| 税改定 vs 領地奪取 | 税改定がほぼ全て。領地奪取は 0-22件/100年 |
| 武力衝突率 | 88-92% |
| 交渉決着率 | 8-13% |
| 攻撃側勝率 | 49-57%（ほぼ公平） |
| Polity 数変動 | 100年でほぼ不変（9→9） |

### 課題（当時）

- 領地奪取 aim の発生条件が厳しく、税改定が支配的
- 交渉決着メカニズムが弱く escalation しやすい
- 当時は税率変動が5%固定で CONTRACT_ELIMINATED に到達しにくかった（現在は delta 10%、§14.5 参照）
- 結果として Polity 数が膠着し、地図の変化に乏しい

### 14.3.1 和平解決が構造的に困難な問題（offer-driven 化前の診断）

offer-driven 化前は外交劇の和平解決率が極めて低かった（当時の計測で 8-13%）。これはバランスの問題ではなく、交渉システム自体の設計ギャップに起因していた（offer-driven 化後の改善は §14.5 参照）。

**原因: acceptanceScore が構造的に負になる**

`land_claim` の場合、`acceptanceScore` の正の項は `offeredPrice`（counterDemand 未実装のためほぼ 0）と `defenderTreasuryNeed`（通常は小さい）のみ。一方、負の項（`defenderPower × 0.12`、`provinceValue × 0.3`、`strategicLoss × 0.2`、`prestigeLoss × 0.2`）が支配的で、構造的 progress はほぼ 0 のまま推移する。

タスクベース progress（`negotiate_terms` / `offer_compromise`）で多少は蓄積できるが、同時に initiator 側の `pressure_counterparty` タスクが tension を加算し、構造的 tension 蓄積（毎週 0.33〜4.0）と合わせて escalation 閾値（40）に先に到達する。

**本質的な欠如要素**（小手先のバランス調整では解決不可）:

1. **対案・妥協点の探索** — 現状は「要求を受け入れるか拒絶するか」の二択。counterDemand（「代わりに金銭補償を」「別の土地なら」「税率を下げるなら」等）の応酬で双方の許容範囲が重なる点を見つける仕組みがない
2. **情報の非対称性と駆け引き** — `leverage` / `commitment` / `preparation` の骨格はあるが、交渉テーブル上で実際に条件を動かす仕組みに接続されていない
3. **敗北のコスト** — 武力衝突に負けても特別なペナルティがない。prestige 低下・同盟動揺・内部不満等がなければ、「素直に譲歩する」より「拒絶して戦争する」方が常に合理的

これらは戦争・叛乱システムとの兼ね合いもあり、外交劇全体の設計改修として別途検討する。

### 14.3.2 ステークホルダー共通の国同士の衝突

複数の Polity に Share を持つ House が存在するため、ステークホルダーが共通する国同士が外交劇で衝突することがある。delegate の同一人物重複は防止済みだが、「そもそも利害が一致する国同士が衝突を起こすべきか」という根本的な問題は未解決。外交劇の設計改修で同時に取り扱う。

### 14.3.3 land_claim が発生しない

`land_claim` を生む aim が事実上発動しない。原因は2つの aim 条件がいずれも初期状態で満たされないこと:

1. **`consolidate_province_holdings`** — 「同一 province 内に自分と他者の holding が混在」が条件。初期状態では各 province の holding は全て同一 polity が保持しており、混在しない。tax revision の結果は税率変更であって holding 移転ではないため、混在状態は自然には生じない
2. **`seize_weak_remote_holdings`** — 隣接 province の holding を狙えるが、`ownPower > targetPower × 1.25` の軍事力差が必要。初期の均衡状態では条件を満たす組み合わせが少ない

`consolidate_province_holdings` の走査バグ（隣接 province 経由ではなく自 province の直接走査に修正）は解決済みだが、条件自体は変えておらず根本問題は残存している。

land_claim を自然に発生させるには、「他者の province の holding を直接狙う」aim 条件（例: 隣接 province の holding を claim する）の追加、または holding 所有権が移動するイベント（戦争結果・相続等）による混在状態の自然発生が必要。外交劇の設計改修と合わせて検討する。

---

## 14.4 人口動態（既知の問題）

### 14.4.1 家門の崩壊

50年で standard の active houses が 54→17 に崩壊する傾向。houseExtinctionSystem で家が消滅すると所属人員も実質的に消える。

**将来の改善方針**: 家が没落しても人員を在野（unaffiliated）に移し、再起の可能性を残す。

---

## 14.5 offer-driven 化後の既知問題

### 14.5.1 offer-driven 化後のバランスは未検証

外交劇は offer-driven に構造改修済みだが、バランスの良し悪しは未検証。CLAUDE.md §4 の方針に従い、機能完成後にまとめて調整する。

以下の項目は offer-driven 化で構造的に対応したが、バランスが適切かは別途観察が必要:
- §14.3.1 の和平解決問題: offer 評価 + counterOffer + compromise で妥協点の探索が可能になった。100yr × 4 seed 計測で和平率 51-80%（offer-driven 化前の 8-13% から大幅改善）
- §14.3.3 の land_claim 不発: `debugMixedProvinceHoldingsRatio` で検証経路を確保したが、自然発生率の改善は未確認
- 税率改定 delta は 10%（以前は 5%）
- CONTRACT_ELIMINATED: 300yr × 4 seed で seed あたり 6-8 件発生。`eliminate_overlord_contract` aim から escalation → conflict 勝利の経路で到達。和平経路での elimination は offer 生成が境界値に達しにくいため稀

---

## 14.6 家制度バランス: 有力家系の不在

### 14.6.1 問題と診断

観察上の問題は「家が多すぎる」ことではなく **「有力な家（大きな多世代家系）が生まれないこと」**。実測（100/300yr × 4 seed, default config）で構造を特定した:

- normal 人口は ~225 で安定均衡（`targetLivingPersons:180`、`baseBirthChancePerMalePerYear:0.06`）。`computeBirthMultiplier` は target 未満でのみブースト、target 超は 1.0 で抑制なし。`mortalitySystem` に密度依存死亡なし → 人口は上限でなく**自然均衡**（出生を上げれば総人口は増える＝ゼロサムでない）。
- その固定的な人口を、増え続ける家が分割。**家の生成は 99% が自力設立（`houseFoundingSystem`）**で分家（`houseSplitEvaluationSystem`）はほぼ寄与なし（100年で cadet 0-3 件）。在野人物（`houselessPersonGenerationSystem`、houseless 目標 = holdings × `houselessPersonsPerHolding`）が設立の燃料。
- 子は父の家に加入・妻は夫の家へ移籍するので家が育つ仕組みはあるが、**繁殖の差別化が無い**ため全家が平均（~2人）に収束。**size-7+ の家は year15 以降ほぼ 0、氏族(clan)は 300年通して 0**（氏族成立は root家＋複数 cadet＋有力家が前提で永遠に未達）。100年で ~300設立/~200絶滅 の高チャーン、定常 ~100家×平均2.1人。

### 14.6.2 初期調整（栄枯盛衰型・config のみ）

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

## 14.7 Persistent Regiment（forced-harness 観察）

計測条件: tick() 直接ハーネス（`measureWarB` パターン）、**強制戦争 config**（escalation 閾値↓ + settlement 閾値↑）で 60年 × 4 seed。素の CLI は戦争希少で損耗ループをほぼ踏まないため、強制戦争で観察した。

- **損耗ループは健全**: mobilize → organization/strength 損耗 → organization 回復 → demobilize → destroy → Battle cleanup の全行程が稼働。danglingMobilized=0、regiment 総数安定（maxEver==initial）、disbanded=0（§6.49 RegimentMaintenanceSystem の reassign が土地移転を吸収）。300年 × 4 seed standard は integrity 違反 0。
- **destroy 率は戦争密度に比例する（調整保留）**: 強制 config で 60年に 58-123 戦争を詰め込むと active regiment の最大 ~半数が destroyed になった。素の 300年 standard では戦争希少のため decay は小さい。
- **active regiment プールは自己修復する**: destroy 永続・生成は worldgen のみ・§6.49 RegimentMaintenanceSystem の reassign は数を保つだけ、という構造だった頃は「戦争が頻繁になるほど軍事力が床なしで減衰する」問題があった。**補充・再編成（§6.50 RegimentReinforcementSystem）でプールは自己修復する**: active は strength を月次 silent 補充し、destroyed は reform 遅延後に再編成される。よって「床なし減衰」は成立しない。
  - ただし **transient は残る**: reform には ≥`destroyedRegimentReformDelayWeeks`（既定 24週）の平時が要り、開戦 AI は連隊在庫を見ないため、「全滅直後の Polity が攻撃側で開戦」は steady-state では解消するが瞬間的には起こりうる（開戦 AI gate は future。§13）。
- **補充・再編成の実証（forced harness 60年 × 4seed, A/B 比較）**: 補充 OFF（対照）は旧 decay を再現（maxDestroyed 8-14・active 30→16 等）。**フル ON は maxDestroyed 0-1・active ほぼ初期維持・avgActiveStrength ~98-100**（strength 補充が destroy 到達前に回復させる＝一次機構）。フル ON で reform イベントが 0 件なのは destroy 自体が稀になるためで、バグでも設計限界でもない: 別途 strength 補充だけ OFF にして destroy を蓄積させると reform は 29-148 件発火し（active が再建で回復）、destroyed Regiment は home holding を保持（terminal==owner）したままのことが多く reform は到達可能と確認した（territory 喪失で恒久ブロックされる設計限界ではない）。reform は二次の安全網。
- 損耗 / 回復 / 補充 / reform の config（damage レンジ・recovery 率・destroy 閾値・補充速度・reform 遅延等）は仮値。avgActiveStrength ~100（戦争がほぼ非攻城的になった）等の balance は CLAUDE.md §4 に従い戦争系機能がひと通り入った段階でまとめて調整する。

## 14.8 成果成長・PersonReputation（v0.44 投入時の観察）

計測条件: 300年 × 4 seed (1, 42, 123, 999)、standard preset。調整はせず観察値の記録のみ。

**イベント量（300 年あたり）**:

| seed | PERSON_ABILITY_GREW | REPUTATION_GAINED | REPUTATION_DAMAGED |
|---|---|---|---|
| 1 | 12,948 | 10,241 | 4,100 |
| 42 | 12,446 | 8,986 | 3,855 |
| 123 | 12,974 | 9,128 | 2,828 |
| 999 | 12,372 | 9,009 | 3,046 |

年あたり成長 ≈ 43 件 / 正評判 ≈ 31 件 / 負評判 ≈ 11 件。seed 間のばらつきは小さい。

**reputation 滞留（100 年 seed 1 の dump-world）**:

- entity 数 597（生存 211 人中 85 人が保持）。expiryWeek 事前計算 + 年次 cleanup で無限蓄積はしない（減衰率 0.985/月 × threshold 0.25 → baseScore 12 で約 21 年滞留）
- 同一人物への最大集中 29 件（top5: 29/29/28/24/22）。「成功した人物がさらに任用される」循環は観察される — snowball が過剰かは将来の総合バランス調整で判断
- **category 偏り（既知・保留）**: 300 年 seed 1 の発生量（GAINED+DAMAGED）は culture 7,794 / military 4,685 / diplomacy 1,677 / administration 185。文化系 Project（patronize_artist / commission_chronicle）の完了頻度が支配的で、develop_holding 由来の administration 評判は機能しているが 1 桁少ない。Project 成功率・生成頻度の問題（§14 既知問題群）と連動するため、v0.44 では config を触らず保留。なお dump-world のスナップショット集計（上記滞留 597 の内訳）は約 21 年の retention 窓の断面であり発生率ではない点に注意
- **未使用 category**: stewardship / intrigue / general は v0.44 時点で発生 source が存在しない（Project map は administration/diplomacy/culture のみ、Play=diplomacy、War=military）。OfficeRole→category 表（§6.66）が参照するための予約枠

**personal_training**: 100 年 × seed 1 で completed 3,142 / failed 13 / cancelled 61。鍛錬は高頻度・高成功率で、能力成長の主要経路の一つになっている（成功率の高さは Project 全般の既知問題 — §6.41 / 過去観察と同根）。

## 派閥拡大・入れ子・commonwealth アリーナ（北極星=集権⇄分権の振動・WI-0/1/2/3 + Phase 2-a/b + Phase 7）

「人材の流れを、優秀な個人に集中→崩壊→分散の振動にする」北極星を達成するための集積 engine・流動・崩壊・入れ子・アリーナを実装した。詳細は §6.19/§6.22/§6.68 と `docs/drafts/faction-expansion-nesting-design.md`。**機能完成優先のため、以下の偏りは config を触らず保留**（プロジェクト方針 §4）。

**end-to-end 観察（tiny 150年 seed1）**: 集積 engine corr(size,才能)=+0.355（才能ある patron ほど大派閥）/ cap 蘇生（43 派閥・hardCap まで）/ 入れ子 nested 21/43・深さ d0:22 d1:19 d2:2 / 支配 house シェア 13–32% で turnover 5・reversals 13（振動・runaway snowball 無し）/ commonwealth 代官 13/13 着座・anchor 派閥 14/43。150年×4seed + 300年×1seed integrity 0。

**保留中のバランス項目**:
- **WI-3 崩壊2（overreach defection）は default OFF**: succession と組むと超加法的 entrenchment（固定分母で 17.9%→34.4%）を生み北極星に逆行する（rich-get-richer: 強 patron が役職を配れて defection を免れる）。flag は残し、accumulation が無限化する nesting の効きを観察した上で再設計・再評価する。
- **WI-3 anti-snowball の本領は未検証**: tiny は hardCap + 自然死による継承で既に dominance が bounded のため、崩壊機構の効果が薄い。nesting で大規模化した世界での効きは未測定。
- **WI-0 引力勾配の weight sweep**: 測定上 WI-1（cap meritSeats）が集積の主役で WI-0 の限界寄与は小さい（M2 gap +4.5→+4.9）。供給逼迫・churn 後に効きが増す前提で weight は未較正。
- **入れ子の割引率・深さ・分岐**（factionNestingNpDiscount/MaxDepth/MaxBranches）と commonwealth アリーナの活性度は通常 config で観察しつつ最終調整する。
- **commonwealth 高官が別君主国から分封を受ける越境（creative 違和感・保留）**: tiny seed1 で観察。無家の有能人材が反乱領（established commonwealth）の建国式（RepublicPoliticalInitializationSystem）で宰相に着座 → その後 personal aim（立身出世）で別君主国から分封を受け、自領の rank5 領主にもなる。所属（共和国の高官）と主権（自領の領主）が二重化し正当化に困るが、機構としては各システムが正しく噛み合った結果でありバグではない（建国式の候補母集合 getRepublicPoliticalCandidatePersons が houseless/outsider を意図的に広く拾う + 分封は他 polity の既存役職を剥奪しない + 主権領主の他国役職就任を排他にするルールが無い）。将来抑えるなら候補レバー = (a) 自分が leader を務める polity を持つ人物を他 polity の office 候補から除外 (b) polity leader 本人を同 polity の非 leader office 候補から除外（自領 self-chancellor 防止）。現段階では note-and-defer。

---

## 14.9 資源経済（v0.54 market-clearing rewrite 後の観察）

> **更新履歴**: 本節は当初 v0.54 の**旧市場清算モデル**（`sold = min(supply, demand)` / 超過廃棄 / 資源別 min/max/elasticity）下で記録されたが、**Victoria 3 型 market-clearing rewrite**（§6.3c.1: sell orders 全量 revenue 化・imbalance 価格・shortage penalty）の導入後に**再観察して全面更新した**（旧観察は supersede 済み）。

計測条件: tiny preset 150年 × 3 seed (1, 42, 123)、整合性違反 0・完走。300年 × 1 seed (1) も完走確認。digest の `Economy:` 行（`computeEconomyStats`）から price/clamp/fulfillment/shortage/severity/marketValueDelta、`Unrest:` 行から不満度を集計。**CLAUDE.md §4 に従い config は変更せず観察値の記録のみ**（「縮退回避のみ」の方針を堅持）。

### 14.9.1 観察された市場の傾向（rewrite 後）

3 seed × 150年の最終時点（p=lastPrice/basePrice、clamp=floor/ceiling 張り付き市場比率 [新レンジ base×0.25〜1.75 基準]、ful=fulfillmentRatio、sh=shortage 市場比率、Δval=marketValueDelta）:

| seed | food | raw_materials | processed_goods | popWealth | unrest avg | Δval |
|---|---|---|---|---|---|---|
| 1 | p0.25 clamp100% ful1.00 | p1.00 clamp100% sh50% | p1.64 clamp50% **ful0.30 sh50%** | 60.8 | 44.0 | −17.5k |
| 42 | p0.33 clamp75% ful1.00 | p0.45 clamp75% sh0% | p1.02 clamp75% **ful0.50 sh50%** | 62.8 | 37.9 | +14.0k |
| 123 | p0.25 clamp100% ful1.00 | p0.63 clamp100% sh25% | p1.53 clamp75% **ful0.25 sh75%** | 67.1 | 60.8 | +0.8k |

rewrite で価格メカニズムは変わった（超過廃棄ゼロ・全量売却・shortage penalty 明示化）が、**根底のトポロジー由来の傾向は旧モデルと同型で残存**する。要因は2系統:

1. **food の床張り付き（可変だが無害・継続）**: food は全 seed で下限（base×0.25）に床留め・ful=1.00・shortage 0%。POP food 需要に対し field 産出が過剰で価格が常に下限に張る。rewrite 後は「安値で全量売れる」ため**生産者の廃棄損は消えた**（旧モデルの「数量頭打ち＋価格下落」二重苦が解消）。**飢餓は皆無（ful=1.00 を 150/300年維持）**、POP wealth 健全（60-67）、treasury 健全。安価で潤沢な主食は農本経済として不自然でなく機能的害は無い。唯一の可変レバー（food の `baseOutputPerLabor` / 需要係数）は調整利得がなく、v0.55 交易が food 需給を再構成するため**見送り**。

2. **raw 床 + processed_goods 慢性不足（構造的・調整不能・継続）**: workshop を持たない StateRegion は raw の域内買い手が無く（raw を消費するのは workshop のみ）raw が床に張る。同時に goods を域外調達できず（市場間交易は未実装）processed が ful=0.25-0.50・shortage 50-75% の慢性不足、価格は天井寄り。**per-region 市場・交易ゼロのトポロジーに内在する縮退であり係数調整では解消しない**。v0.55 のインターリージョン交易が根本解。rewrite はこの不足を **shortage / shortageSeverity（maxSev=1.0）として可視化**しただけで、悪化も改善もさせていない。

3. **marketValueDelta（非保存・新指標）**: −17.5k〜+14.0k と seed により符号が変わる。shortage 過多 seed（s1: goods 不足で buy>sell の高価格購入が producerRevenue を上回る）は負（価値の破棄）、供給過多 seed（s42: 床価格で sell>buy）は正（価値の生成）。これは**市場抽象化による意図的な非保存**（§6.3c.1）であり、LandRevenue 分配の保存則（§21.4）とは別レイヤ。Δval が極端化する縮退（例: 毎月 −100k 級の慢性破棄）は観察されず、規模は健全。

### 14.9.2 unrest 均衡は rewrite 後も安定（負チャネル弱化の影響は軽微）

rewrite で POP 負カップリングは「`1−fulfillmentRatio` 比例」から「`shortageSeverity` 比例」へ変更され、**fulfillment が threshold（0.5）以上の帯では penalty が 0 になる＝負チャネルが構造的に弱まった**。§19.2 の「food net coupling ≈ −1.0/月（load-bearing）」均衡がドリフトしないか要注視だったが、再観察の結果 unrest avg は **seed1: 43.8→44.0 / seed42: 37.8→37.9 / seed123: 61.2→60.8** と**実質不変**（旧モデル比 ±0.4 以内）。food は全 seed で ful=1.00（shortage 0%）のため負チャネルの弱化は food では発火せず、正チャネル（充足ゲイン）が従来どおり均衡を支えている。**均衡の drift は起きていない**。

seed123 の高 unrest（60.8、high>50 が 11/17）は旧 §14.9 同様**戦争多発 seed の既存政治力学**（revolt 多数）であり経済起因ではない（main baseline 64.2 > rewrite 60.8 でむしろ低い）。一般 unrest バランスは §14.3 / §14.4 の既存課題として将来の総合調整へ。

### 14.9.3 結論: 3項目とも見送り継続（v0.55 交易へ引き継ぎ）

- food 過剰床: rewrite で廃棄損は解消・無害 → 見送り。
- raw/goods 縮退: 交易ゼロのトポロジーに内在（rewrite は shortage として可視化しただけ）→ v0.55 市場間交易で根本解。
- unrest: 負チャネル弱化後も均衡は安定（drift なし）。seed123 の高 unrest は既存の戦争起因 → 一般バランス調整へ。

財政経路は owned 比率が上がっても健全（150年で owned 30-55%、due/ownerInc とも正常）。holdingDue 機構（§17.4）が私的所有の拡大下でも財政を維持しており、netRevenue が負になり得る rewrite 後も positiveNet 床留め（§6.3c.1）で保存則は不変。v0.55 交易の作業はこれら観察を入力として引き継ぐ。
