# 13. 今後の課題（未実装）

本章は未実装の将来課題を列挙する。各サブシステムの実装済み仕様は `docs/SPEC.md`（目次）から該当章（多くは `06-systems.md`）を参照する。

## 主要項目

### War 拡張系

War / WarScore / PeaceSettlement の配管、Captain General / Commander / Battlefield、永続 Regiment（損耗ループ・補充・再編成）は実装済み（§6.45 / §3.9a / §3.9b / §3.9c / §6.48 / §6.49 / §6.50）。以下は後続で段階導入する。

- **膠着戦の裾の圧縮**: 「ほぼ互角の戦争が長引く裾」を圧縮する機構（戦争期間上限の短縮 / 膠着時 urgency drift 等）。
- **包囲戦 (siege)**: BattlefieldKind `siege` は型のみで存在し未生成。攻城戦の解決ロジックを実装する。
- **多重臣従での参戦**: v0.43 で `WarSide.participants` の複数化（primary 1 + supporter 0..N、polity のみ）と supporter 勧誘（seek_diplomatic_support / joinScore / copy filter）は実装済み（§6.44 / §6.47 / §6.55）。現場指揮官候補の supporter 開放（越境指揮許容）と宮廷人材プール化（House メンバー・派閥食客まで候補化、両属除外 + cap 8）も実装済み（総大将は primary の military office → leader fallback のみ — §6.45）。後続: contributionScore の実書き込み（現状は前方宣言のみ・常に undefined）/ casualties / willingnessToContinue / 報酬・名声配分 / 総大将の supporter 開放。
- **foreign polity への Attitude 形成（v0.43 から切り出し）**: WAR_DECLARED / PEACE_SETTLEMENT / WHITE_PEACE での当事国有力者の対敵国 attitude 書き込み。現状 cross-polity attitude の書き込みサイトは存在せず、joinScore の politicalOpinion 項は weight 0 の休眠項（helper `getWeightedOpinionFromInfluenceBreakdown` は実装済み）。writer 導入と同時に weight を有効化する。
- **支援の撤回・不参戦の記録**: `DIPLOMATIC_SUPPORT_WITHDRAWN` / `DIPLOMATIC_SUPPORT_FAILED_TO_JOIN` / `WAR_PARTICIPANT_LEFT`（将来予約）。v0.43 では「宣言したが参戦しなかった」は宣言/参戦イベントのペア有無で読める仕様とし、撤回イベントは出さない。supporter inactive の War 除去も無音。
- **revolt suppressor side の支援**: v0.43 では rebel/commonwealth side のみ supporter 勧誘可能（鎮圧側まで支援者を増やすと叛乱がさらに勝ちにくくなるため）。後続で対称化を検討。
- **Regiment の細分化**: strength / morale を training / equipment 等へ細分化、morale を動的化（現状は reform 時のみ書き込み）。
- **Battle の内部 tick / frontline simulation**: 戦闘内部の段階的シミュレーション。
- **連隊の専用 event**: REGIMENT_MOBILIZED / DESTROYED 等（現状は BATTLE_OCCURRED の counts-only enrich + REGIMENT_REFORMED のみ）。
- **開戦 AI の連隊在庫 gate**: 0 連隊での開戦抑止。
- **厭戦感情ほか**: `HouseWarState` / warWeariness / casualties（POP casualties）/ 強制徴募。
- **兵站・補給**: supply demand / local requisition / treasury supply / terrain・feature 補給補正。
- **荒廃・復興**: ProvinceWarImpact / HoldingWarImpact / HoldingImprovement.condition 低下 / recovery project。
- **賠償金 / 懲罰的条件 / prestige**: defender 勝利時の counter-goal、pay_wealth WarGoal（賠償金）、Person prestige / House legacyPrestige 変更（現 PeaceSettlement では未対応）。
- **House actor を主体とする War**: 現状は polity 同士のみ War 化。私戦・主君への参戦要請・家単位の参戦は整理が必要。

### Chronicle 拡張系

永続 read-model `ChronicleEntry` + 対象別履歴 UI は実装済み（§3.14 / §6.62 / §4.11 / §11）。append-only でプロトタイプ段階のため、以下は将来課題。

- **外部化 / cap / purge / 圧縮**: 現状は無制限保持（300年×4seed で ~12-13k entries、memory / perf 問題なし）。alpha 以降で disk / DB / append-only log への外部化を検討する。
- **視点相対（viewer-relative）レンダリング**: 戦争の勝敗等を「記録を表示している側」から見た記述にする（同じ戦争でも House A panel では「勝利」、House B panel では「敗北」）。entry は中立のまま、render 層で viewer entity を渡して描き分ける（sim/ に視点を持ち込まない）。
- **ログの重複整理**: 同一の出来事に複数 EventType が emit され両方 allowlist にあると複数 entry が出る（cadet 分家の `CADET_HOUSE_FOUNDED` + `HOUSE_SPLIT`、代官任期更新時の同週・同一人物・同一 holding の `BAILIFF_VACATED` + `BAILIFF_APPOINTED` 等）。同一 source 群の畳み込み / 「留任（任期更新）」エントリ化を検討する。
- **rich narrative の拡張**: 指揮官 narrative・`ChronicleContext` の populate、統治評価 context、婚姻等の life イベント拡充。

### Faction 拡張系

- **派閥リクルート改善**: 現状 `recruitCap = 1`（季節ごと = 年4人/派閥）が制約的で、十分な規模に成長する前に解散するケースが多い。代官候補の確保にも影響。リクルート上限・頻度・対象条件の見直しが必要。
- **代官候補プールの拡大**: rank ベース役職制限と house maxHolders=1 制限により polity/house 役職の消費は改善したが、代官候補は「他の役職を一切持たない free adult」に限定されるため、少人数の ownerHouse では依然として候補が枯渇する。代官候補条件の緩和（house 役職持ちでも可）、または在野人物の直接雇用経路（派閥を経由しない）の検討が必要。
- **同派閥婚姻ボーナス / leader 意思決定の派閥圧力 / 軍事 contribution の Share-based 集計**: 派閥は現状「人事と恩顧」のみ。
- **commonwealth 派閥の取り扱い拡張**: `ownerHouseId === undefined` Polity (Rebel Polity / commonwealth) で `getFactionNominationPower` から ownerHouse bonus を 0 にする処理は実装済みだが、commonwealth 特有の派閥動態 (rebel leader 直接派閥 leader 化など) は未深化。
- **deathYear/deathMonth の Person field 化**: 現状は Person 型に deathYear/deathMonth を持たず、表示時に state.currentYear から算出する。deathYear を field として追加するかは要検討。
- **Bailiff 任期年数のチューニング**: normal bailiff が ownerHouse member に交代される機会を絞る要因の一つ。factional 化と兼任厳格化により normal bailiff 比率は改善 (4 seed 平均で ~10/40)、任期延長 or 補充タイミング再設計は引き続き要観察。
- **POLITY_LANDLESS event 表示の整備**。
- **支出メカニズムの拡充**: 現状 Person.wealth は収入経路 (Office salary / Polity 余剰分配 / 派閥献金 / Bailiff salary) が複数あるのに対して支出経路が乏しく、複数 office を兼任する人物の wealth が 10 万単位で累積する。将来追加候補: 不動産維持費・人件費・交際費・浪費。バランス調整は支出経路が入った後に行う方針。

### 外交劇の残課題

- **DiplomaticRelation**: Polity 間の長期外交関係。
- **第三者参加外交 / 同盟 / 保証 / 参戦 / 仲裁**: DiplomaticPlay への第三者介入。
- **install_owner / dynasty change 要求**: 王朝交代要求 DiplomaticDemand。
- **AppointmentPolicy 抽象による commonwealth ad-hoc 分岐の整理**。
- **Rebel Polity の rank 昇格** (rank=5 → rank=4): 現状は現行 rank 決定を維持。
- **DiplomaticPlay の settlement/escalation 閾値の非対称化調整**: escalation 経路が支配的。
- **CONTRACT_ELIMINATED の発生頻度調整**。
- **異 rank 間 land_claim の CEDED 経路の調整**: 補償なし妥協の成立条件チューニング。
- **請求権 (claim rights) システム**: inactive Polity を材料とした動機付き land_claim。
- **税率変動量の動的調整**: 軍事力差に応じて変動幅を可変にする。
- **commonwealth succession / commonwealth faction / commonwealth → dynastic polity 遷移**。
- **House Rebellion の外交劇化**: Faction / GoalSystem と接続して再設計。

### Action 経済 + 実体・称号システム

「実体を持たない家/国の役職」をどう扱うかが課題（例: landless な家の家長は他派閥に入って bailiff として身を立てるべきだが、現状の「兼任全面禁止」ルールで除外される）。

これを ad-hoc な例外ルール (例: substantive org の役職のみ兼任禁止対象) として対処するのではなく、**より principled な数値モデル「個人の Action 経済」に統合する方針**。

設計の骨子:

- **Person.actionCapacity (月)**: 個人ごとの「月あたり行動力」上限。能力 (governance / insight など) と相関させる予定。
- **Office に actionCost を持たせる**: 各役職は月々その役職の動力コストを消費する。`getOfficeCompatibilityPenalty` と `concurrentOfficePenalty` を統合・置換する。
- **役職の actionCost は所属組織の "実体" に比例**:
  - 土地と財産が多い家・国の役職は actionCost が高い (管理対象多 = 仕事多)
  - 名目だけの没落家・滅びかけの polity の役職は actionCost が極小 (実権なし)
  - 「Holy Roman Emperor」型の称号も自然に表現できる
- **兼任ルールは「合計 actionCost ≤ actionCapacity」に置換**: 「全面禁止」「同 role 兼任ペナルティ」などの ad-hoc ルールを統合。
- **称号システムへの発展**: 実体のない役職 (actionCost ~ 0) はそのまま「称号」として扱える。`TITLE_INHERITED` / `TITLE_RECLAIMED_BY_HOUSE` / `DYNASTY_CHANGED` 等と統合可能。

実装規模感: state 拡張 (Person.actionCapacity)・全 OfficeDefinition の actionCost 設計・appointmentSystem / bailiffAppointmentSystem / officeCompensationSystem の改修・config の整理 — 1 マイナーバージョン丸ごと使う規模。設計ドラフトを先に書いて寝かせる方が安全。

関連する既存メモ:
- 「兼任全面禁止」: action 経済導入時に soft constraint に置換される予定。
- `getOfficeCompatibilityPenalty`: 同上。
- 独立トピックの称号システム: action 経済と統合設計予定。

### Affection 駆動の行動

現状 Attitude (Affection / Respect) は記録されているが、各種意思決定にはまだほとんど反映されていない。「強い負の Affection を持つ House の役職を兼任する」状況が観察できるが、これを反映するには以下のリンクが必要:

- 婚姻: 互いに Affection 正の組同士で形成しやすい (現状ランダム + 同 Polity ボーナスのみ)。
- 派閥リクルート: leader と target の相互 Affection でコスト・成功率が変動 (一部実装済)。
- Plot: 標的への Affection 強負で発動率上昇。
- Office 辞退・離反: 大きな負の Affection を持つ組織からの任命を低確率で拒否。
- 戦争意思決定: 隣接 Polity への Affection で戦争閾値が変動。

### 家の土地回復経路

**現状の実装には「土地を失った家が land を取り戻す経路」が事実上存在しない**。既存の Province 取得経路 (House Split / Extinction 継承 / POLITY_OWNER_CHANGED / War / Marriage) はいずれも「既に土地を持っている家」「最高 prestige 家」「新規生成家」を優先するため、完全 landless な家には届かない。`findFallbackOwnerHouse` だけが理論的可能性だが legacyPrestige 順で他に必ず負ける。

将来追加すべき経路 (シナリオ別、必要な infrastructure は既に存在):

- **土地を買い戻す (Land purchase)**: House-direct の土地購入経路を新設。Province/Holding 移転 mutation + `Person.wealth` の組み合わせで実現可能。派閥員が稼いだ wealth で旧領を買い戻す物語の基盤。
- **譲られる (Patron grant)**: Polity owner や派閥 leader が member house に Province を恩恵として割譲する仕組み。新規 system (例: `PatronageGrantSystem`) と Province/Holding 移転 mutation の組合せ。
- **叛乱指導者となって land を獲得する**: 現状の民衆叛乱経路は landless commonwealth を生成するが、これを「既存 House の member を叛乱指導者として推戴し、その House に Province を移転」する経路に拡張する。
- **結婚の持参金 (Dowry)**: `marriageSystem` に Province 持参金経路を追加。Province/Holding 移転 mutation を利用。高 prestige 家と低 prestige 家の婚姻時に Province が移転する。

これらは Affection 駆動行動・action 経済とも連動するので、「家の興亡」というテーマで束ねて実装するのが自然。

### 経歴 / Entity-Event 関連付け

人物 / 家 / 国 / Province 単位で「何が起きたか」を時系列で振り返れる UI を実現するための data model 改修。inactive OfficeAssignment / FactionMembership は完全削除されているため、state を遡って経歴を再構築することは不可能であり、別経路で履歴を保持する必要がある。

**アイディアレベルの設計案**:

- **Entity 側に ID 参照リストを持たせる**: `Polity / House / Person / Province` に `relatedEventIds: EventId[]` (もしくは類似フィールド) を追加。イベント生成時に event の `actorIds / houseIds / polityIds / provinceIds` を巡回して該当 entity の list に push する単一 dispatcher を用意する。
- **eventHistory の保管場所を `session` から `state` に移植**: ID から event を引ける前提なので、state と event log の整合性が前提条件になる。CLI export や snapshot との一貫性もこれで担保される。
- **保管 cap の戦略 (案レベル)**:
  - (A) cap 撤廃、`state.eventHistory: Record<EventId, SimEvent>` で全保持。memory 影響大。
  - (B) importance ベース cap: `critical` / `major` は無期限、`normal` / `minor` のみ cap。歴史書が重大事件しか記録しない史実的整合とも合う。**有力**。
  - (C) cap 突破時に "圧縮イベント" にまとめる (例: 「pe-XXX は year 50-60 に Bailiff を 3 回務めた」のような要約)。実装コスト高。
- **UI**: DetailPanel に "Career" / "History" タブを追加し、`relatedEventIds` から取得した event を時系列降順で表示。importance や EventType でフィルタ可能。

**他システムとの関連 (実装時に再確認すべき項目)**:

- `maxRawEvents` config と event ring buffer の挙動を見直す。
- 経歴は event ID 経由でアクセスするので state table 圧縮の方針とは衝突しない。
- イベント生成側の単一 dispatcher 化が前提なので、現状の event emit 箇所を棚卸しして集約済みかを確認する必要がある。
- 死者の Person を完全削除する将来最適化と整合させる: 死亡者の `relatedEventIds` が無くなるなら、event 側に actor の `personName` snapshot を持たせて孤児イベントでも UI 表示できるようにする等の検討が必要。

### 多重臣従・上位者の取り分

- **多重臣従**: 1 つの House が複数 Polity の owner / vassal を兼ねる構造の明示化（現状は「複数 Polity の ownerHouse になり得る」のみ実装、明示臣従関係は無し）。
- **上位者の取り分維持と Attitude penalty**: 押領・強制的な税率変更時に上位者から実行者へ negative Attitude を付与。
- **BailiffAppointment の commonwealth 対応**: 現状 ownerHouse なしは skip。Polity Share holder 系の候補者選定を導入。

### 独立トピック

- **限界突破イベント**: aptitude を 101..120 帯に押し上げる伝説的偉業・特訓イベント（現状はデータ表現のみ）。
- **ESTATE_CONTESTED の長期 Project 化・claim 派生**: 現状 ESTATE_DISPUTED は記録のみ。長期化させた相続争いを Project 化し、後年に claim 相続へ繋げる。
- **遺言（指定相続人）機構**: 現状は嫡出子→配偶者→兄弟→家長の固定順。
- **称号システム**（家産称号 / 個人称号 / 公的称号、TITLE_INHERITED / TITLE_RECLAIMED_BY_HOUSE / DYNASTY_CHANGED / TITLE_UNION_FORMED / DISSOLVED）。
- **Polity 拡張**: ownershipMode / titlePropertyRegime / successionLaw / 同君連合。
- **LandContract の高度な機能**: 契約改竄 / claim / 分岐 chain / 共同保有等。
- **代官 / ProvinceOfficeAssignment の拡充**（代官蓄財、bailiff 経済の独立）。
- **Clan の拡張**: 基盤は実装済み。将来拡張: Clan treasury / Office / 派閥連動 / 請求権 / 僭称 / 派生 Clan (parentClanId) / CLAN_EXTINCT event / Clan chronicle。
- **socialFriction**（魅力 − 洞察 ペナルティ）— Attitude system 全体見直し。
- **ROLE_WEIGHTS の config 化**（シナリオごとに重み変更したいニーズが顕在化したとき）。
- **spymaster / disasterSystem 関連の役職** とその経験成長対応。
- **大分裂（House 独立）**: 全土統一後、国力が一定規模を超えると支配家から傍系家が独立し複数 Polity が成立する「中国史的分裂」メカニズム。現状は Province Revolt から新勢力が生まれるが、House 単位での大規模独立はまだ弱い。
- **Polity 規模ペナルティ**: Province 数・House 数が増えるほど Legitimacy（getPolityLegitimacy）が低下しやすくなり、大 Polity が自重で崩れる仕組み。
- **家の分裂の作り込み**: Attitude 経由の cohesion 変動をより細かく制御、分裂閾値の調整、一強状態でも分裂が自然発生する仕組み。
- **POP_HARDSHIP / POP_PROSPERITY / POP_UNREST_RISING / POP_DECLINED イベントの発火ロジック**: 閾値超過時のみ発火する条件付きイベント（EventType 宣言のみ実装済み）。
- **首都・本拠地移転**: 征服・滅亡・特別イベントによる移転。
- **POP の移住**: population pressure・wealth・unrest・戦争荒廃に応じた Province 間移動。
- **文化・宗教**: PopGroup への cultureId / religionId 追加、同化・改宗・弾圧・寛容政策。
- **食料生産**: carrying capacity / population pressure を foodProduction / foodDemand に拡張。
- **施設システム**: 城塞・道路・港・市場。
- **詳細外交**: 同盟・条約・婚姻。現在 LandContract.termsProtectedUntilWeek で実装している契約保護期間は、条約システム導入時に汎用的な「二国間条約」エンティティに置き換える想定。
- **継承権・請求権**: 血縁関係に基づく他家への継承権主張。

### LifeStage 拡張

- **引退 / 隠居システム**: old_age の強制退任・`PERSON_RETIRED_FROM_OFFICE`・摂政・後見人・終身官 / 名誉職。現状 old_age は登用ペナルティのみで強制退任しない。
- **遷移確率への個性反映**: ambition / caution / 親の地位 / 早期登用経験 / 学校・従士・師弟 / 戦争経験 / 健康状態を LifeStage 遷移確率に反映（現状は minAge〜maxAge 範囲の乱数のみ）。
- **notable 判定の拡張**: 大国の王子（社会的関係性で子供でも重要人物）等。現状は leader / office holder の安価判定のみ。war commander / captain general を notable に含める安価な索引の導入も含む。
- **Attitude 継承の拡張**: polity target の継承（現状は person/house のみ）・**故人 / 消滅家への感情の継承**（「噂でだけ知る今はいない人物」への感情。現状は現存エンティティのみ継承）・影響元種別の追加・influencer / target 上限の調整。観察で attitude 総数の per-person 平均は ~10 で bounded だが、将来 influence 率・cap はバランス調整対象。
- **追加 life event**: `PERSON_BECAME_ADOLESCENT` / `PERSON_ENTERED_MATURE_ADULTHOOD` 等（現状は成人・老年入りのみ）。
- **Chronicle cap / purge / minor event filtering**: 一般人物 life event の蓄積に対する上限・purge（現状は未実装）。
