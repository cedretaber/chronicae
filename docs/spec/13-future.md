# 13. 今後の課題（未実装）

### v0.14 で実装済み（参考）

- 6 基礎能力 (valor / command / numeracy / learning / charisma / insight) と aptitude / ability 分離
- 才能遺伝（平均回帰込み）
- 年齢曲線 (lifelongGrowth / youthPeak / midLifePeak) 別の自然到達水準
- 経験成長と年齢衰退（PersonGrowthSystem）
- 派生 selector による応用ロール（governance / stewardship / diplomacy / intrigue / warCommand）
- 死亡時 wealth 分配（EstateSettlementSystem）と ESTATE_SETTLED / ESTATE_DISPUTED イベント
- UI 6 能力表示・5 派生スコア・年齢曲線アイコン

### v0.15 で実装済み（参考）

- **Country → Polity 直交化**: `Country` 型を `Polity` 型に rename。`House.countryId` / `Person.countryId` を削除。`Country.houseIds` を削除し `getPolityHouseIds` selector で動的取得。
- **Polity.ownerHouseId / rank**: Polity 自身が家産的に所有家を持つ。`rank: PolityRank` は v0.15 では effect 持たない placeholder（将来の称号システム土台）
- **Polity 関係 selector 群** (`polityRelations.ts`): `getPolityProvinceIds` / `getPolityHouseIds` / `getPolityPersonIds` / `getHousePolityIds` / `getHousePrimaryPolityId` / `getPersonPrimaryPolityId` / `getHouseSeatProvinceInPolity` 等
- **House の多 Polity 所領**: 1 House が複数 Polity に Province を持てる（戦争・反乱で発生）。各 system は selector 経由で関係を動的に取得
- **PolityOwnerConsistencySystem / OrganizationConsistencySystem** (v0.15 §6.22b/§6.22c): 所領変動後の owner / capital / Share / Office の整合性を毎月補正
- **§13.4 Polity 役職スコア式**: `polityShareAppointmentFactor` / `ownerHouseAppointmentBonus` / `sameHousePolityOfficePenalty` を導入。同 House による Polity Office 独占を抑制
- **§17.3 War 征服時の新 ownerHouse 選定**: attacker `polity.ownerHouseId` 優先
- **§22.3 affectedPolityIds スナップショット**: `extinctHouse(ctx, { houseId, affectedPolityIds })` で所領喪失前の関係 Polity 集合を保存し、メンバー移住先選定に使う
- **POLITY_OWNER_CHANGED / POLITY_EXTINCT イベント追加**、`RULER_CHANGED` → `POLITY_LEADER_CHANGED` 等の rename

### v0.16 で実装済み（参考）

詳細仕様は `docs/drafts/spec-v016-update.md` を参照（Stage A/B/C すべて完了、2026-05-19 時点）。

- **LandContract chain による土地支配の階層化**: `Province.ownerHouseId` / `Province.polityId` / `Province.houseControl` / `House.provinceIds` を全廃。土地支配は `LandContract` (provinceId, parentContractId | rootAuthorityId, granteePolityId, terms.taxRateToGrantor) の chain で表現。Province の effective owner / overlord は selector で動的取得。
- **Polity rank の階層化**: 1 (帝国) / 2 (王国) / 3 (公爵領) / 4 (伯爵領) / 5 (反乱領)。自動昇降格はしない。grantor rank は派生値 (chain の親 grantee の rank)。worldgen で rank 2 × 3 + rank 3 × 4 + rank 4 × 8 の 3 階層 15 Polity を生成。
- **AnonymousHouse + placeholder Person**: 単一の system House (`h-anon`、`kind: 'system'`) に `kind: 'placeholder'` の Person が所属。Province の Bailiff が空席のときの仮充当に使う。Person-loop / House-loop systems は placeholder / system house を skip する。
- **新 tick system 4 つ**:
  - `LandRevenueSystem`: 各 Province の terminal Polity treasury に積み、chain を terminal→root の逆順走査で `taxRateToGrantor` 上納。root の taxRate は 0 固定。過徴税ペナルティ継続。
  - `PolitySurplusDistributionSystem`: 余剰 `max(0, treasury - reserveTarget) * distributionRate` を Share holder (Person / House) の wealth に分配。`reserveTarget` が暗黙の給与予備として機能する。
  - `BailiffAppointmentSystem`: terminal Polity ごとに Bailiff の placeholder ↔ 通常人物を 6 ヶ月間隔で交代任命。
  - `LandContractPurchaseSystem` (毎年 1 月): 隣接かつ同 rank・同 grantor の dynastic Polity 間で Province を金銭購入。commonwealth は除外。
- **WarSystem の LandContract 化 (§13 / §16.1)**: `transferProvinceByWarGoal` mutation で case A / B-1 / B-2 / C を rank 比較で分岐。case C は v0.16 では no-op (税率調整は Faction 段階で配線)。
- **createRebelPolity (mutation)**: provinceRevoltSystem の独立成功時に Rebel Polity + Rebel House + rebel leader を atomic 生成。`ownerHouseId === undefined` の commonwealth として生成し、OrganizationShare を rebel leader (Person) に 100% 付与 (§17)。
- **House extinction inheritance (§22.3)**: extinct House が ownerHouse である Polity すべてを receiver House の所有に移す (王朝交代)。`Polity.ownerHouseId` と `polityIndex.byOwnerHouse` と `polity:leader` Office を同期更新、`POLITY_OWNER_CHANGED` 発火。LandContracts は変更しない (Polity と Province の関係は不変)。
- **House active 判定の変更 (§9.1)**: 旧 `provinceIds.length === 0` ベース判定を廃止し、memberIds (血統) ベースに統一。土地を完全に失った House も active=true のまま「亡命家」として存続。
- **institutionalPower 下限 (§22.1)**: `calcPolityMilitaryPower` に rank 別下限 (`institutionalPowerFloorByRank`) を被せ、Rebel Polity / 小 Polity の即死を防止。
- **旧 system の廃止**: `economySystem` / `rebellionSystem` / `lordshipTransitionSystem` を tick から除去。`createRevoltHouse` / `createRevoltLeader` mutation を削除し `createRebelPolity` に統合。
- **§25 IntegrityCheck 33 項目**: chain 不変条件 / index 同期 / AnonymousHouse / placeholder / ProvinceOffice / Polity-House 整合性等を 25 項目 error throw + 5 項目型レベル保証 + 1 項目コードレビューで担保。
- **検証**: CLI 300 年 × 4 seed (1, 42, 123, 999) で integrity 違反 0 完走。335 件 test pass。

### v0.17 で実装済み（参考）

詳細仕様は `docs/drafts/spec-v017-update.md` を参照（Stage A/B/C すべて完了、2026-05-19 時点）。

- **派閥システム (Faction) の導入**: leader / member の純ネットワーク。treasury / land / Office / Share は持たない (人事と恩顧のネットワークに限定)。`Faction` (id, name, leaderPersonId, active, foundingYear, foundingMonth) と `FactionMembership` (factionId, personId, active, joinedYear, joinedMonth) を atomic mutation (`createFaction` / `addFactionMembership` / `deactivateFaction` / `transitionFactionLeader` / `removeFactionMembership`) で操作。`factionIndex.byLeader` / `byMember` で同期。
- **新規 system 6 個**:
  - `OfficeTermSystem` (毎年 1 月): 任期年数 (`officeTermYears.{polity,house}.{role}`) 経過 で非 leader Office を inactive 化、OFFICE_TERM_ENDED 発火。
  - `UnaffiliatedPersonSystem` (毎年 1 月): AnonymousHouse の normal Person 数を `targetUnaffiliatedPersons` に向けて調整 (生成 / pruning)。`occupation` (9 種: adventurer / merchant / scholar / mercenary / scribe / priest / physician / jurist / wanderer) を抽選付与。pruning は `markPersonDead` + `deathCircumstance: 'faded_from_history'`。
  - `HouseSurplusDistributionSystem` (毎月): House の余剰 wealth を Person Share 比で配当 (`houseSurplusDistributionMonthlyRate`)。
  - `FactionLifecycleSystem` (毎年 1 月、毎月 leader 死亡時継承): 結成 / 解散 / leader 死亡時継承。`getFactionOpportunityScore` / `getFactionViabilityScore` で判定。最大 3 結成 / 年。
  - `FactionRecruitmentSystem` (毎年 1 月): 在野 (AnonymousHouse 在籍 normal) / 没落貴族 (isLandlessHouseMember) を leader が引き抜く。`leader.wealth` から cost、`signingBonus` を candidate に。最大 3 リクルート / 派閥 / 年。
  - `FactionPatronageSystem` (毎年 1 月): 派閥内の献金 (office 持ち → leader) と小遣い (leader → no-office member)。Attitude 更新は `updateAttitudeIfExists` で **既存 key のみ**。
- **AnonymousHouse の拡張**: `kind: 'system'` のまま、normal Person も滞在可。houseExtinctionSystem が receiverHouse 不在時に living member を AnonymousHouse へ散らし、`Person.lastHouseTransferYear` を設定、HOUSE_MEMBERS_DISPERSED 発火。
- **Person 拡張 field (すべて optional)**: `occupation` (`UnaffiliatedOccupation`)、`deathCircumstance` (`'natural' | 'faded_from_history'`)、`lastHouseTransferYear` (pruning 保護期間判定用)。`availabilityStatus` enum は導入せず、`isUnaffiliatedPerson` / `isLandlessHouseMember` 等の selector で状態を導出。
- **Office 任期判定 (selector-based)**: `OfficeAssignment` に endYear/endMonth は追加せず、`isOfficeTermExpired(state, config, assignment)` で `currentYear - startYear >= termYears` 判定。`provinceOfficeTermYears.bailiff: 3` で Bailiff にも任期 (BailiffAppointmentSystem の前段で expire → placeholder)。
- **AppointmentSystem 全面改修 (§14 切替方式 + fallback)**: `hasRelevantFactionForAppointment` で factional / traditional 切替。
  - factional: `getFactionNominationPower` (org × 派閥) ≥ threshold な faction の member から `getFactionalCandidateScore` = NP × recommendation × scale + ability + prestige - compatibilityPenalty で選出。`minAppointmentScore` 未満なら fallback。
  - traditional (v0.16 ベース): "system House 所属者除外" を撤廃 (placeholder のみ)、`concurrentOfficePenalty` を `getOfficeCompatibilityPenalty` (lookup table) に置換、`sameHousePolityOfficePenalty` を effective 版 `(1 - housePolitySharePct/100)` 倍に置換、ownerHouseBonus は commonwealth で 0。
- **ShareUpdateSystem overlap bonus (§16.2)**: House holder の Polity Share rawPower に `(1 + overlapScore × polityShareOfficeOverlapBonusMax)` を乗算 (overlap は §9 の house-polity Office overlap)。Person holder (commonwealth) には適用しない。
- **新規 EventType (11 種)**: `FACTION_FOUNDED` / `FACTION_DISSOLVED` / `FACTION_LEADER_CHANGED` / `PERSON_RECRUITED_TO_FACTION` / `OFFICE_TERM_ENDED` / `PERSON_FADED_FROM_HISTORY` / `PERSON_BORN_IN_OBSCURITY` / `HOUSE_MEMBERS_DISPERSED` / `FACTION_FUNDS_SHORTAGE` / `FACTION_MEMBER_ABANDONED` / `FACTION_LEADER_BANKRUPT`。
- **IntegrityCheck §21 追加 (28 項目→39 項目)**: Faction (F1/F2/F4-F7)、Office (O3/O4)、deathCircumstance (D2/D3)、AnonymousHouse 拡張 (A1)、Index (I1-I4)。旧 §25 #29 inverse / #31 は §21.4 A2 に従い緩和 (AnonymousHouse は normal Person を許容)。
- **「最後の通常 House 絶滅防止」guard**: `handleNormalHouseExtinction` 内で、世界に他に active 通常 House が残らないなら絶滅させない (pre-existing terminal state 防止)。
- **検証**: CLI 300 年 × 4 seed (1, 42, 123, 999) で integrity 違反 0 完走。49 テストファイル / 483 件 test pass。

### v0.17.1 で実装済み（参考）

v0.17 完成後、CLI 観察で「Bailiff が全 Province で placeholder のまま (0 normal / 40 placeholder)」になることが判明し、原因解析の上で代官の機能を以下のように補強した。仕様書本体は §15 を参照。

- **Bailiff の給与経路 (§15.4)**: terminal Polity の retained 税収のうち `bailiffRevenueShare: 0.1` (10%) を normal bailiff の `person.wealth` に直接加算。placeholder bailiff は salary 対象外で従来通り 100% が treasury に流れる。実装は `landRevenueSystem` の terminal contract 段で `addPersonWealth` を直接適用する。
- **BailiffAppointment の factional 切替 (§15.3)**: `BailiffAppointmentSystem` の placeholder 補充ステップを「factional 優先 + ownerHouse fallback」に書き換え。factional 候補は Polity に対する `getFactionNominationPower` が `factionNominationPowerThreshold` 以上の active faction の member 全員から構築 (Polity 内外問わず)。score は `getFactionalCandidateScore * factionBailiffNominationWeight (0.4)`、`minAppointmentScore` 未満なら ownerHouse fallback。`'bailiff'` は `OfficeRole` に含まれないため role alias として `'advisor'` を渡す (`getFactionNominationPower` は role を void。`factionBailiffNominationWeight` で別重み)。
- **代官と国家中枢役職の兼任全面禁止 (§15.3)**:
  - `BailiffAppointmentSystem` 側: 派閥候補 / ownerHouse 候補ともに `officeIndex.byHolderPerson` (Polity/House Office) と `provinceOfficeIndex.byHolderPerson` (別 Province の Bailiff) のいずれかに active 割当があれば候補から除外。
  - `AppointmentSystem` 側: `collectPolityCandidatesTraditional` / `collectHouseCandidatesTraditional` / `collectFactionalCandidates` の三経路すべてで active な ProvinceOffice 保有者を除外。これにより「国家中枢役職と代官の兼任」を双方向に排除する。
  - 派閥所属の有無に関わらず兼任は許可しない。代官は「現地常駐の独立役職」「在野・没落貴族が稼ぐ場所」として位置付ける。
- **FactionPatronage の Bailiff 包含 (§11)**: `hasActiveNonLeaderOffice` の判定に ProvinceOffice (Bailiff) を含めて、Bailiff 持ち派閥員も leader への donation 経路に乗せる (= stipend 対象外)。これにより Bailiff salary → 派閥献金の経路が成立する。
- **v0.17.1 で削減した v0.18 送り項目**: 「§15.3 bailiff factional 推薦」「Bailiff salary 経路 (§15.4 将来項目)」を実装済みに移動。
- **検証**: CLI 300 年 × 4 seed (1, 42, 123, 999) で integrity 違反 0 完走。50 テストファイル / 492 件 test pass。normal Bailiff の最終比率は seed により 5〜15/40 と改善。

### v0.17.2 で実装済み（参考）

v0.17.1 完成後、観察用 Activity Report (4 軸 JSON 出力) を導入して挙動を確認したところ、以下 2 件の意図と異なる動きが判明したため修正した。

- **rank の方向修正**: `polityOfficeMaxByRank` を spec §7.2 の例に合わせ、rank 1 (帝国) が最多枠 / rank 5 (反乱領) が最少枠となる正しい方向に反転。
- **factional bailiff 即解任バグ修正**: `bailiffAppointmentSystem` の step 1 にあった「ownerHouse 外の holder を vacate」ロジックは v0.16 時代のものであり、v0.17.1 で factional 経路から ownerHouse 外の派閥員を意図的に任命するようになったことで衝突していた (6 ヶ月ごとに任命直後に解任、seed 1 で 6228 回の churn)。step 1 を「死亡 / 欠落 holder のみ vacate」に置き換え、生存中の holder は任期 (step 0) で循環させる方針に統一。
- **placeholder Person の singleton 化**: 全 Province の空席 bailiff は単一の placeholder Person (`PLACEHOLDER_PERSON_ID = 'pe-anon-placeholder'`) を共有する。旧版は `installPlaceholderBailiff` が呼び出しごとに新規 placeholder を生成し AnonymousHouse に残置していたため、seed 1 で 6266 体の placeholder Person が累積していた。singleton 化で state が安定する。あわせて `provinceOfficeIndex.byHolderPerson` には placeholder holder を登録しない B2 policy を採用し、index ノイズも排除。
- **観察機能 (Activity Report)**: `--report <path>` と `--report-snapshot <years>` フラグで run 終了時に 4 軸 (Office 流動性 / Faction ライフサイクル / Bailiff 動態 / 人口) の JSON 集計を出力できる。詳細は README §"Activity Report" を参照。今後も挙動確認・バランス調整で再利用する。
- **検証**: CLI 300 年 × 4 seed (1, 42, 123, 999) で integrity 違反 0 完走、test 495 件 pass。

### v0.17.3 で実装済み（参考）

CLI 実行時間の最適化。これ以降の機能追加・バランス調整サイクルの開発速度向上が目的。

- **A. integrityCheck を年末 (month=12) のみ実行**: 旧版は default の非 debug モードでも毎 tick 走らせていた。違反検知は year-end でも原因 year は特定できるので CLI 検証用途として十分。`--integrity-check` flag は per-tick check を明示的に要求するときに使う。debug mode は per-system PERF log の都合で per-tick 継続。
- **B. inactive OfficeAssignment を完全削除**: 旧版は `revokeOfficeAssignment` / `expireOfficeTermAssignment` が `active: false` をセットして残置していた。state.officeAssignments / officeIndex から完全削除する形に変更。selectors はすべて `if (!o || !o.active) continue` のガードを通るため意味的に等価。
- **C. inactive FactionMembership を完全削除**: B と同様の処理を `removeFactionMembership` / `deactivateFaction` / `transitionFactionLeader` に適用。Faction entity 自体は historical reference のため active=false で残置。
- **検証**: CLI 300 年 × 4 seed の wallclock 計測:
  - seed 1:   286.5s → 39.4s (-86%)
  - seed 42:  187.4s → 23.4s (-88%)
  - seed 123: 218.0s → 35.2s (-84%)
  - seed 999: 140.8s → 26.2s (-81%)
  - 4 seed 合計: 832.7s → 124.2s (-**85%**)
- 内訳: A だけで -38%、B でさらに大幅短縮 (state table の累積解消)、C は誤差レベル (structural cleanup の意義が主)。
- integrity 違反は 0 のまま完走。test 495 件 pass。

### v0.17.4 で実装済み (派閥肥大化抑止 + Faction 独立 UI)

v0.17.3 完成後の CLI 100 年観察 (seed 1) で派閥に重大な構造問題が判明したため、v0.17.4 で追加の調整を入れる。

**観察された問題**:

```
Rainer's Circle (f-0, year 4 創設、year 100 で 96 歳)
  - leader Gregor (h-3 Brightmere, landless, 個人 wealth 65,999)
  - 派閥メンバー 95 人 (世界最大、他派閥は 3-4 人)
  - 内訳: 53% h-anon (drifter), 20% House Corvin (没落貴族), 27% その他
  - leader の Polity Nomination Power はほぼ 0 (Office 任命に貢献できず)
  - 結果: 95 人の人材が「派閥に滞留して bailiff / 他家 advisor にも就けない」
       opportunity cost が世界中の Polity 人事 ROI を悪化させている
```

**根本原因**:

派閥に**流入経路 (FactionRecruitmentSystem) はあるが、有効な流出経路がない**。viability score が低くなれば一括解散はするが、長寿派閥は wealth/donation の自己強化ループ (member 95 × donation → leader wealth 65,999 → factionLeaderReserveWealth threshold を超え続ける) で半永久に存続する。

**v0.17.4 で導入する仕組み — Idle メンバーの自然離脱 (FactionDefectionSystem)**

派閥に所属しているのに **利益を得られない時間が長期化した member** が確率的に派閥を抜ける機構。

#### 13.9 FactionDefectionSystem (v0.17.4 新規)

##### 13.9.1 「利益」の定義

派閥メンバーが派閥から得る利益は **active な Office (Polity / House / Bailiff) の在任** のみ。

| 検出方法 | 性質 |
|---|---|
| `state.officeIndex.byHolderPerson[personId]` / `state.provinceOfficeIndex.byHolderPerson[personId]` に active 有り | live 判定 |

##### 13.9.1.1 stipend を利益に含めない理由 (2026-05-19 設計判断)

当初は「stipend 受領」も利益に含める案だったが、CLI 観察 (seed 1 / 300y) で以下の問題が判明:

- リッチな leader (例: Rainer's Circle の Gregor、wealth 65,999) は `factionLeaderReserveWealth = 30` を余裕で超え、毎年 stipend を全 member に配布
- Office を持たない drifter member も毎年 stipend を受領 → 「利益あり」 → idle reset → defection が永遠に起きない
- ユーザの問題提起 (Gregor 型 leader の 95 人派閥) を**まさにそのパターンで無効化する**矛盾

これを回避するため、利益判定は **Office 在任のみ** に限定。stipend は member へのギフトに留まり、引き留め力 (membership retention) を持たない。

この判断により `FactionMembership.lastBenefitYear` field は不要となり、idle 計算は `joinedYear` を起点とする live 計算のみで完結。実装が大幅にシンプルになる。

将来「stipend = 弱い利益」として再導入する場合は、出費メカニズム (`v0.18+` 「支出メカニズムの拡充」項目) の整備後に検討する。出費が入って leader が wealth を貯めにくくなれば、stipend を払えるかどうかが leader の実力指標として機能するため。

##### 13.9.2 system 処理 (yearly, January)

```ts
runFactionDefectionSystem(ctx):
  if currentMonth !== 1: return ctx

  for each active FactionMembership:
    if member is faction leader: continue          // leader は対象外

    // (a) Office 保有チェック
    if hasActiveOffice(state, personId) or hasActiveBailiff(state, personId): continue

    // (b) idle 計算 — joinedYear からの経過年
    idle = currentYear - membership.joinedYear

    if idle < factionDefectionGraceYears: continue   // grace 期間

    // 確率判定
    prob = (idle - factionDefectionGraceYears) * factionDefectionProbPerYear
    prob = min(prob, 1)
    if rng < prob:
      mutation: removeFactionMembership(membershipId)
      // attitude penalty (option, factionStipendShortage と同等)
      updateAttitudeIfExists(member.id, personAttitudeKey(leader.id), {
        affection: -factionDefectionAttitudeAffectionPenalty,
        respect:   -factionDefectionAttitudeRespectPenalty,
      })
      emit FACTION_MEMBER_ABANDONED  // 既存 event type を流用
        actorIds: [personId, leaderId]
        houseIds: [member の house]
        importance: 'minor'
        summary: "{member.name} abandoned {faction.name}."  // 既存 explain text 流用
```

##### 13.9.4 確率曲線

```
factionDefectionGraceYears: 8       // 加入後 8 年は判定なし (新規 member 保護)
factionDefectionProbPerYear: 0.07   // grace 切れ後、idle 1 年ごとに +7%

idle = 8  → prob 0%
idle = 13 → prob 35%
idle = 18 → prob 70%
idle = 22 → prob 98% (ほぼ確定)
```

Rainer's Circle case: 50+ 年前から idle の drifter は 4-5 年で全員消える計算。

##### 13.9.5 tick 実行順

```
factionPatronageSystem        // stipend / donation 配布
  ↓
factionDefectionSystem (NEW)  // year 1 月のみ
  ↓
factionLifecycleSystem        // viability / 解散 / 新規結成
  ↓
factionRecruitmentSystem      // 補充
```

順序の意味: defection で member が減ると次の lifecycle で viability score が下がり、弱い派閥は自然解散する。さらに recruitment は同 tick の最後なので、補充は次年以降。

##### 13.9.6 既存 event の流用

`FACTION_MEMBER_ABANDONED` は draft spec §11.5 で「member が attitude 悪化により脱退」用に予約され、`explainFaction.ts` に summary 文も既存 (`"{member} abandoned {faction}."`)。v0.17.4 では `idle による defection` 経路もこの event に集約する (発火元が attitude / idle のいずれであっても、観察者にとっては「member が抜けた」事実が重要)。

##### 13.9.7 config 追加

```ts
// v0.17.4
factionDefectionGraceYears: 8
factionDefectionProbPerYear: 0.07
factionDefectionAttitudeAffectionPenalty: 2
factionDefectionAttitudeRespectPenalty: 1
```

##### 13.9.8 期待される動態

- Gregor のような **無力 leader の派閥は数十年で縮小** (95 → 5-10 人レベルへ)
- 縮小した派閥は viability score の閾値を割って自然解散、wealth は leader 個人に残置
- 解放された h-anon / 没落貴族メンバーは isUnaffiliated / isLandlessHouseMember に戻り、Bailiff / 他派閥 recruit 対象として再流通する
- **Polity Bailiff 任命の人材プールが増える** → factional bailiff appointment の質改善が期待値

#### 13.10.1 v0.17.4 で並行修正 (死亡 member の membership cleanup)

v0.17.4 観察中に判明した既存 bug を修正:

**問題**: faction に所属する member が死亡 (`mortalitySystem` で `alive=false` 化) しても、その `FactionMembership` を削除する経路がどこにも存在せず、`active=true` のまま残置していた。結果として CLI 観察で死亡者が派閥に在籍したまま見える (例: seed 1 year 30 の Rainer's Circle に Aveline pe-137 (age 61, alive=false) が残っていた)。

**修正**: `factionLifecycleSystem.processExistingFactions` の毎月走るループに、`removeDeadMemberships(ctx, factionId)` helper を追加。当該 faction の全 membership を走査し、`person.alive === false` の member の membership を `removeFactionMembership` で完全削除する。leader 死亡は別経路 (`handleLeaderVacancy`) なので除外。`v0.17.3 C` で `removeFactionMembership` が完全削除 + `byMember` 同期するため、integrity は保たれる。

**副次効果**: 死人 cleanup により membership table が clean に保たれ、defection / recruitment の動態が大幅に活性化:

| seed | abandoned (修正前 → 修正後) |
|---|---|
| 1 | 2 → 32 |
| 42 | 0 → 20 |
| 123 | 0 → 2 |
| 999 | 0 → 22 |

#### 13.11 v0.17.4 で未発火 event の発火実装

draft spec §11.5 / §13.6 で予約済みの以下 event は v0.17 時点で `types/event.ts` に declared、`explain/explainFaction.ts` に summary 文も完備だが **未発火** だった (Stage B B2 で意図的に後送)。v0.17.4 で発火条件を確定する。年代記に派閥興亡の物語性を加えるため、idle defection と同タイミングで実装する。

##### FACTION_FUNDS_SHORTAGE

警告段階の event。leader が完全破産には至らないが、当該年に **stipend を払いきれなかった no-office member が 1 人以上いた** ことを示す。

発火条件 (`factionPatronageSystem` 内で集計):

- 当該年の小遣い loop で `leader.wealth < factionLeaderReserveWealth + stipend` により stipend を支払えなかった member が >= 1
- かつ `leader.wealth >= factionDisbandWealthFloor` (= 10) — 完全破産は別 event (FACTION_LEADER_BANKRUPT) なので除外

書式:

```
FACTION_FUNDS_SHORTAGE
  importance: 'normal'
  actorIds: [leaderId]
  houseIds: [leader.houseId]
  summary: "{leader.name}'s {faction.name} faces a financial crisis."
```

実装位置: `factionPatronageSystem` の小遣い loop の末尾で `unpaidCount` を集計、loop 後に条件判定して発火。1 派閥 1 年 1 回 (patronage は 1 月のみ実行のため重複なし)。

##### FACTION_LEADER_BANKRUPT

致命段階の event。leader.wealth が解散閾値を割った瞬間に発火。同 tick で FACTION_DISSOLVED が続き、解散理由を物語る前駆 event として機能する。

発火条件 (`factionLifecycleSystem` 内):

- 解散判定で `leader.wealth < factionDisbandWealthFloor` が true で deactivateFaction を実行する分岐
- 他の解散理由 (insufficient members / low viability / leader vacancy 死亡) では発火しない (= bankrupt 固有の event)

書式:

```
FACTION_LEADER_BANKRUPT
  importance: 'normal'
  actorIds: [leaderId]
  houseIds: [leader.houseId]
  summary: "{leader.name}'s fortunes are exhausted, putting {faction.name} in jeopardy."
```

実装位置: `factionLifecycleSystem.runFactionLifecycleSystem` の解散判定 (line 67) 直後、`reasonsToDissolve` に 'leader bankrupt' が含まれる場合に `dissolveFaction` を呼ぶ前で発火。順序は **FACTION_LEADER_BANKRUPT → FACTION_DISSOLVED** の 2 連 emit。

##### config 追加 (なし)

両 event とも既存 config (`factionDisbandWealthFloor` / `factionLeaderReserveWealth` / `factionStipendBase`) のみで判定可能、新規 config 不要。

#### 13.10 v0.17.4 で実装済み (UI 改修)

- **Faction 独立 UI**:
  - `Sidebar.tsx` に `Factions` タブを追加 (4 番目)。Active Faction を「メンバー数 desc / 結成年 asc」で表示。各 row に leader name / 結成年月 / member count
  - `DetailPanel.tsx` に `FactionDetail` コンポーネントを新規追加。表示内容: faction name (+ Dissolved バッジ) / ID / 結成年月 (+ 経過年数) / Leader (PersonLink) / Leader House (HouseLink) / メンバー数 / Viability score / Leader Opportunity score / Roster (leader 以外を prestige 降順で list)
  - `simulationStore.ts` の `SelectedType` に `'faction'` を追加
  - `PersonDetail` の Faction 表示をリンク化 (Person → Faction 遷移)
  - `buildEntitySnapshot` に `'faction'` ケースを追加 (Copy JSON 経路)

### v0.18-pre で実装済み（参考）

詳細仕様は `docs/drafts/spec-v018-pre-update.md` を参照（2026-05-20 完成）。

v0.18 外交システム改修の前段として、叛乱政体 (Rebel Polity) の物理サポートを整える小規模リファクタリング。`createRebelPolity` が `ownerHouseId === undefined` の commonwealth として生成していた Rebel Polity を、`polityOwnerConsistencySystem` が毎 tick 「埋めるべき空席」と解釈して第三国家に乗っ取らせていた不具合を解消。

- **`Polity.kind: 'normal' | 'commonwealth'`** を追加。`'commonwealth'` は `ownerHouseId === undefined` を恒常的に許容する Polity の標識。`undefined` は `'normal'` と等価 (backward compatibility)。
- **`createRebelPolity` を AnonymousHouse 方式に書き換え**:
  - Rebel House は生成しない (`makeHouseId` / `pickUniqueName` / `House` オブジェクト構築を削除)
  - rebel Person は `houseId: ANONYMOUS_HOUSE_ID` で `addPersonToAnonymousHouse` 経由で AnonymousHouse.memberIds に登録
  - 新 Polity は `kind: 'commonwealth'` を明示
  - polity:leader Office のみ rebel Person に付与 (house:leader は作らない)
  - 戻り値から `houseId` を削除 (`{ polityId, personId }` のみ)
  - `REVOLT_POLITY_FOUNDED` event の `houseIds: []`
- **`polityOwnerConsistencySystem` の Step 2/3 に commonwealth skip**: `polity.kind === 'commonwealth'` を補充ロジック直前で `continue`。これにより commonwealth Polity が「ownerHouseId が常に undefined」の状態で永続できる。
- **`successionSystem` の polity ruler phase に commonwealth skip**: commonwealth Polity は rebel founder 死亡後も新 leader を補充しない。
- **`organizationConsistencySystem` の commonwealth 例外**: Step 1 (Share 削除) / Step 2 (Office revoke) の両方で「commonwealth の AnonymousHouse 所属 holder (rebel founder)」を eligible 扱い。rebel founder 死亡時は既存の `markPersonDead → revokeOfficesByHolder` 経路 + `!person.alive` 分岐で正しくクリーンアップされる。
- **`integritySystem` Stage B warn #26 に同例外**: rebel founder の OfficeAssignment に対する誤警告を抑制。
- **将来「家の設立」イベント (v0.18+) との接続**: rebel founder + 一族が財産・子供数・政治地位を満たした時点で新規 House を立てて AnonymousHouse から脱出する想定。これにより commonwealth → dynasty への自然な遷移経路を残している。

**検証**: `npm run check` 全 pass (52 ファイル / 510 件)。CLI 300 年 × 4 seed (1, 42, 123, 999) で integrity 違反 0 完走。各 seed で 34-41 件の Rebel Polity が生成され、`POLITY_OWNER_CHANGED` に Rebel Polity 名が一切登場しないことを確認 (乗っ取りバグ解消)。Year 12 観察で rebel founder 生存中の commonwealth Polity が active polity:leader Office と Person-direct Share 100% を正しく保持することを確認。

**残課題 (v0.18 以降)**:

- **指導者不在 commonwealth の自然併合 / 新指導者探索**: rebel founder 死亡後の leaderless commonwealth が「Province を持ったまま leader 空席で存続」するのは不自然。近隣 dynastic Polity への自然併合経路、または AnonymousHouse 内の他 Person からの後継選出を v0.18 叛乱システム改修と合わせて検討。
- **政体変化イベント** (commonwealth ↔ dynasty 双方向遷移): 「家の設立」 (commonwealth → dynasty) と「王朝打倒」 (dynasty → commonwealth) を event として実装。
- **`AppointmentPolicy` 抽象化**: `polity.kind === 'commonwealth' && houseId === ANONYMOUS_HOUSE_ID` という ad-hoc な分岐を、`Polity.officePolicy: { default, byRole }` による任命方針モデルに一般化する。「dynastic でも open がありうる (専制君主の恣意任命)」「commonwealth でも closed がありうる (ヴェネツィア型貴族共和制)」を表現できるようにする。
- **Stage B warn の整合**: v0.18-pre で commonwealth 永続化により dynastic Polity 側の Share/Office Stage B warn 数が増加 (seed 999 で 62 → 1566)。`polityOwnerConsistencySystem` の eligibleHouseIds 計算と integrity warn #24/#25 の条件を整合させる。

### v0.18 で実装済み（参考）

詳細仕様は `docs/drafts/spec-v018-update.md` を参照（Stage A〜G すべて完了、2026-05-20 時点）。

- **外交劇基盤**: PoliticalActorRef / ActorIntent / DiplomaticPlay / DiplomaticDemand 型、GC (CleanupTerminalDiplomacy)、IntegrityCheck 拡張
- **叛乱の外交劇化**: ProvinceRevoltSystem → revolt_negotiation DiplomaticPlay。妥協 / 鎮圧 / 独立の 3 分岐。disbandRebelPolity mutation による Rebel Polity 解散処理（v0.20-b2 で per-Holding 化: 各 Holding の terminal のうち rebel grantee のもののみを `restoreToPolityId` に復元）
- **土地請求 (land_claim)**: 旧 land_purchase / land_transfer_demand を統合。rank ベース契約選択 (3-a/3-b/3-c)、解決時操作 (5-a/5-b/5-c)。outcome event 3 色分け: LAND_CONTRACT_PURCHASED / LAND_CONTRACT_CEDED / LAND_CONTRACT_CONQUERED
- **税率改定 (contract_tax_revision)**: 上位/下位契約者間の税率 ±5% 交渉。下限 5% / 上限 80% 超で契約破棄 (eliminateContractFromChain mutation による chain 再接続)
- **Province 単位 dedup**: 全 Play kind 横断で 1 Province に同時進行 1 Play のみ
- **旧 WarSystem 廃止**: 宣戦 AI → Intent + DiplomaticPlay に移行。WAR_DECLARED = 0 確認済み。`warSystem.ts` 物理削除
- **旧 LandContractPurchaseSystem 廃止**: land_claim に統合。`landContractPurchaseSystem.ts` 物理削除
- **IntentGenerationSystem**: 毎年 1 月に Polity actor の短期 Intent を生成 (acquire_land / sell_land / improve_contract_terms / demand_tax_increase)
- **IntentToDiplomaticPlaySystem**: active Intent を DiplomaticPlay に変換
- **DiplomaticPlaySystem**: active Play の progress / tension を毎月更新し settlement / escalation に分岐
- **ConflictResolutionSystem**: escalated Play の武力衝突解決 (revolt 専用 + 汎用)
- **UI**: Sidebar Plays タブ、DetailPanel topShareholders、亡命家分類改善
- **新規 EventType 16 種**: ACTOR_INTENT_CREATED / ACTOR_INTENT_CONVERTED / DIPLOMATIC_PLAY_STARTED / DIPLOMATIC_PLAY_SETTLED / DIPLOMATIC_PLAY_FAILED / DIPLOMATIC_PLAY_ESCALATED / DIPLOMATIC_PLAY_RESOLVED_BY_CONFLICT / LAND_CONTRACT_CEDED / LAND_CONTRACT_CONQUERED / CONTRACT_TAX_REVISED / CONTRACT_ELIMINATED / REVOLT_NEGOTIATION_STARTED / REVOLT_SETTLED / REVOLT_SUPPRESSED / REVOLT_POLITY_ESTABLISHED / LAND_CONTRACT_PURCHASED (既存拡張)
- **検証**: CLI 4 seed × 300 年 IntegrityCheck violation 0 件。592 tests pass

### v0.19 で実装済み（参考）

詳細仕様は `docs/drafts/spec-v019-update.md` を参照（2026-05-20 完成）。

- **時間基盤の週次化**: 内部時間を 1 tick = 1 ヶ月 から 1 tick = 1 週 に変更。1 年 = 48 週 = 12 擬似月 × 4 週。`absoluteWeek` を一次情報源とし、`currentYear` / `currentWeekOfYear` は同期キャッシュ。`currentMonth` フィールドは廃止。
- **ScheduledSystem 導入**: tick scheduler に `shouldRun(system, absoluteWeek)` を集約し、各 system 内の `if (currentMonth !== 1) return ctx` ガードを全 18 system から削除。旧毎月 system → `intervalWeeks=4`、旧毎年 system → `intervalWeeks=48`。`phaseOffsetWeeks` は全 system で 0（将来の負荷分散基盤として保持）。
- **月ベースフィールドの absoluteWeek 統一**: `DiplomaticPlay.startedYear/startedMonth/deadlineYear/deadlineMonth` → `startedWeek/deadlineWeek`、`ActorIntent.createdYear/createdMonth/expiresYear/expiresMonth` → `createdWeek/expiresWeek`、`Plot.startedYear/startedMonth/durationMonths/elapsedMonths` → `startedWeek/durationWeeks` (elapsedMonths 廃止、absoluteWeek 比較で代替)、`Faction.foundingYear/foundingMonth` → `foundingWeek`、`FactionMembership.joinedYear/joinedMonth` → `joinedWeek`、`Polity.lastWarMonth` → `lastWarWeek`、`ProvinceOfficeAssignment.startMonth` → `startWeek`。`year * 12 + month` の absoluteMonth 算術を全廃。
- **Months 系 config の移行**: `warCooldownMonths: 24` → `warCooldownWeeks: 96`、`revoltNegotiationDurationMonths: 12` → `revoltNegotiationDurationWeeks: 48`、`landClaimNegotiationDurationMonths: 18` → `landClaimNegotiationDurationWeeks: 72`、`taxRevisionNegotiationDurationMonths: 12` → `taxRevisionNegotiationDurationWeeks: 48`。`bailiffAppointmentInterval` は `intervalWeeks=24` で代替。
- **FactionLifecycleSystem 分割**: 旧 FactionLifecycleSystem を `FactionMaintenanceSystem` (4週ごと: leader 死亡時継承・死亡 member cleanup) と `FactionLifecycleSystem` (年次: 解散判定・新規結成) に分割。
- **Event の週次化**: `SimEvent.month` → `weekOfYear`。Event ID を `e-{absoluteWeek}-{index}` に変更。
- **IntegrityCheck 3 モード制**: debug=毎tick+try-catch、--integrity-check=毎tick+throw、通常=week48+throw。時間不変条件（3値整合性）を追加。
- **CLI 拡張**: `--weeks` 引数追加、`--years` は `years * 48` tick に変換。年サマリは `weekOfYear === 48` で出力。
- **UI 改修**: 日付表示を `Year X / Month M / Week W` (擬似月 1-12、月内週 1-4) に変更。先送りボタンを週送り・月送り・年送りの 3 段階に。
- **時間 utility**: `timeUtils.ts` に `WEEKS_PER_YEAR` / `weekToYearWeek` / `getSeason` / `getPseudoMonthFromWeek` / `getWeekOfPseudoMonth` を集約。
- **性能改善**: ScheduledSystem 導入により、大半の system が `shouldRun` で skip されるため、tick 数は 4 倍 (3,600→14,400 ticks/300年) だが総実行時間は約 50% 短縮。
- **検証**: CLI 4 seed × 300 年 (14,400 ticks each) IntegrityCheck violation 0 件。63 テストファイル / 581 tests pass。

### v0.20 で実装済み（参考）

詳細仕様は `docs/drafts/spec-v020-update.md` を参照。

- **State / Province / Holding 三層構造の導入**:
  - `StateRegion`: Province をまとめる上位地理単位。UI の二段階マップ（State map → Province map）表示に使用。隣接は selector で動的算出
  - `Holding`: Province 内の個別土地区画。`kind: 'manor' | 'city'`。development / polityControl / landQuality / weight を保持。Province の development / polityControl は selector で Holding の weight 加重平均から算出
  - Province から `development` / `polityControl` を削除し、`stateId: StateRegionId` / `holdingIds: HoldingId[]` を追加
- **WorldPreset によるマップ規模制御**: tiny / small / standard / perfLarge の 4 preset。grid サイズ / State 数 / Province 数 / Polity 数 (Kingdom/Duchy/County) / Holdings per Province を preset で指定
- **per-Holding LandContract chain**: worldgen で各 Holding に独立した contract chain を生成。`byHolding` が正規 index、`byProvince` は legacy。`holdingTerminalPolityCache` で terminal polity を Holding 単位でキャッシュ
- **DiplomaticDemand の holdingId 化**: `transfer_land_contract` / `change_contract_tax_rate` の対象を `provinceId` から `holdingId` に変更。`revolt_concession` は Province 単位のまま。Play 生成時に `selectTargetHoldingInProvince` で対象 Holding を選定
- **applyLandContractTransferGoal の rank 走査**: chain を走査して rank に基づく正しい位置を選ぶロジックに変更。同 rank grantee 差し替え / 上位 rank 挿入 / 下位 rank child 追加を rank 順で判定
- **HoldingOfficeAssignment**: ProvinceOfficeAssignment を HoldingOfficeAssignment に置換。`startYear` を廃止し `startWeek` (absoluteWeek) に統一
- **ControlSystem BFS**: 全 Province 通過可能に変更（飛び地への距離ベース減衰が正しく機能）。polityControl は Holding 単位で更新
- **LandRevenueSystem per-Holding 分配**: `holdingShareWeight = weight * landQuality * kindMultiplier(kind)` (city = 1.3, manor = 1.0) で Province 生産を分配。各 Holding の byHolding chain を走査して上納
- **createRebelPolity / disbandRebelPolity**: Province の代表 terminal ではなく各 Holding の terminal を操作するよう修正
- **Integrity Check 拡充**: H4 (Holding フィールド範囲)、H5 (HoldingOffice 整合性)、H6 (byAppointingPolity index)。§25 #15 / H3 を byHolding ベースに修正
- **UI Holding card**: ProvinceDetail に Holdings セクション追加。name / kind badge / dev / control / quality / weight / per-Holding chain / Bailiff を表示。Land Tenure Chain を Province レベルから Holding card 内に移動
- **CLI `--perf` フラグ**: entity count / elapsed time / per-system timing を出力。`--json` と併用可
- **検証**: CLI 4 seed × 50 年 (tiny/small) IntegrityCheck violation 0 件。standard preset 1024 Holding worldgen + 10 年 headless simulation 完走。63 テストファイル / 583 tests pass

### v0.20.1 で実装済み（参考）

- **Worldgen の全面刷新**: 矩形グリッド型 Province/State 配置を廃止し、自然な地理生成へ移行
  - `StateRegion.gridCol/gridRow` → `centerX/centerY`。State center を Poisson disk sampling で配置
  - `WorldPreset` からグリッド設定 (gridCols/gridRows/stateCols/stateRows/provBlockCols/provBlockRows) を除去し、stateCount/provinceCountPerStateMin/Max に置換
  - `MapGenerationConfig` を全面刷新。linkRemoval/jitter を廃止、幾何パラメータ (worldMapWidth/Height, minStateCenterDistance, minProvinceDistance, stateRadius, aspectRatio, edge chances) に置換
  - `generateProvinces` を全面書き換え: Poisson disk → 楕円クラスタ → Delaunay → MST → 確率的 edge → 全体連結保証の 13 ステップ
  - Province graph の接続数は均質化しない（袋小路・回廊・交通要衝を許容）
- **ユーティリティモジュール新規追加**: UnionFind (path compression + union by rank)、MST (Kruskal)、Poisson disk sampling (Bridson)
- **SVG Voronoi StateMap**: ReactFlow ベースの StateMap を SVG Voronoi マップに置換。Province x/y を種点として Voronoi セルを生成し、State の dominant polity 色で塗り分け。State 境界を太線、内部境界を薄線で描画
- **UI 画像アセット**: マップ背景、Province バナー画像、Holding カード画像を追加
- **IntegrityCheck §25 S4**: Province.neighbors の双方向性、自己参照禁止、孤立禁止、存在しない neighbor 検出を追加
- **色パレット拡充**: POLITY_COLORS 5→25 色、HOUSE_COLORS 8→25 色
- **d3-delaunay 導入**: Voronoi/Delaunay 計算ライブラリ
- **`distributePolities` の距離計算修正**: manhattanDistance/100 → euclideanDistance（新座標系対応）
- **検証**: CLI 4 seed × 300 年 IntegrityCheck violation 0 件。66 テストファイル / 600 tests pass

### v0.20.2 で実装済み（参考）

- **Unified Map UI**: StateMap と ProvinceMap の二段構造を廃止し、単一の UnifiedMap SVG コンポーネントに統合。zoom level (Far/Medium/Near) に応じて State/Province の表示強度を自動切替
  - Far: State 単位の色・ラベル（名前+人口+unrest）、State クリック → ズームイン
  - Medium: Province 単位の色・ラベル・アイコン（小）・neighbor edge、Province クリック → DetailPanel
  - Near: Province アイコン（都市/農村 + 城/荘園バッジ）フルサイズ、ホバーツールチップ
- **Ocean ポイントによる不規則外枠**: Province 群の凸包外側にダミー Voronoi 点を散布し、矩形クリッピングの直線的外枠を不規則な輪郭に改善
- **セル色表現の改善**: 不透明塗りつぶしを廃止し、薄い半透明 fill + 枠線に polity 色のスタイルに変更（羊皮紙背景が透ける地図らしい雰囲気）
- **usePanZoom 拡張**: animateTo() によるスムーズなズーム遷移、zoomBy/resetZoom メソッド
- **ズームコントロール**: +/-/reset ボタン（左下配置）
- **highlight tier ユーティリティ**: computeProvinceTiers / computeStateTiers を共有モジュールに抽出
- **Store 簡素化**: mapLevel / focusedStateId / focusState / exitToStateMap を削除
- **ReactFlow 完全撤去**: `@xyflow/react` をアンインストール。StateMap / StateMapSvg / ProvinceMap / ProvinceNode を削除
- **未使用アセット削除**: province-map-background 2 枚、getProvinceMapBackground() 関数
- **検証**: npm run check 全 pass。66 テストファイル / 600 tests pass

### v0.20.3 で実装済み（参考）

- **unrest バランス調整**: unrest 自然減衰 (`unrestNaturalDecayRate: 0.005`) を追加。全土が常に高 unrest になる問題を解消
- **災害システム Province 単位化**: polity 単位 → Province 単位に変更。各 Province の人口圧力に応じて飢饉・疫病の発生率が増加（pressure 1.0 で飢饉確率 100%）
- **人口ダメージ割合ベース化**: 飢饉 peasants -10%、疫病 全POP -5%。人口圧力のフィードバックループが成立
- **救済システムの一旦オミット**: Province に複数 Holding があり支配者が異なるため、polity 単位の救済は不自然。将来 Holding 単位 POP 分割後に代官の一次対応 + 国の救済判断として再導入
- **叛乱 unrest 係数の引き上げ**: `provinceRevoltUnrestFactor` 0.8 → 1.2。polityControl が高い状態でも unrest が高ければ叛乱が発生する
- **unaffiliated person プールの holdings 比例化**: `unaffiliatedPersonsPerHolding: 0.5` で holdings 数に連動。月次実行化。男性比率 75%
- **AnonymousHouse 所属者の出産禁止**: 家を持たない在野人物の無制限出産を抑止。将来の新家系創設で解決
- **House.deceasedMemberIds 追加**: 死亡時に memberIds → deceasedMemberIds に移動。生存メンバー走査の効率化 + 家系の歴史記録保持
- **死亡者の memberIds 蓄積バグ修正**: `getUnaffiliatedPersons` に alive チェック追加、`markPersonDead` で memberIds から除外
- **UI**: 国詳細パネルの土地契約一覧を Province→Holding 二重構造に変更。ダークテーマに合わせたスクロールバースタイル追加
- **CLI**: 年末サマリーに unrest 統計出力を追加（avg / class 別 / high count）
- **リファクタ**: `ANONYMOUS_HOUSE_ID` を `house.ts` に、`PLACEHOLDER_PERSON_ID` を `person.ts` に移動

### v0.21 で実装済み（UI i18n 強化 + rank ベース役職制限）

- **UI i18n 強化**:
  - イベントログ: 数値丸め、`nameParam()` による polity/province/role 名のロケール解決
  - conflict/revolt 系イベントに個別 `messageKey` を追加（英語 summary 文字列 → `conflict.land_seized` 等 6 種の i18n 対応テンプレートに分割）
  - `role.yaml` (en/ja) 新設、`NameCategory` に `'role'` 追加。polity/house 役職名をロケール解決
  - イベント種別ラベル (`event_type.*`) 92 種翻訳、派閥詳細パネル、人物職業名 (9 種)、Sidebar FactionRow/PlayRow 等の翻訳追加
  - 日付表示を `weekToYearMonthWeek()` で年/月/月内週形式に統一
- **rank ベース役職制限**:
  - `polityOfficeMaxByRank` の値を改定: rank 5 (反乱領) は leader のみ、rank 4 (伯領) は +administrator、rank 3 (公領) は +treasurer+military、rank 2 (王国) は全役職、rank 1 (帝国) はフル枠
  - `getEffectiveOfficeMaxHolders` で `rankCap <= 0` → return 0 に変更（従来は `Math.max(1, ...)` で最低 1 だった）
  - `appointmentSystem` が `def.maxHolders` の代わりに `getEffectiveOfficeMaxHolders` を使用するよう統一
  - `organizationConsistencySystem` に Step 3（rank 超過分の自動解任）を追加
  - House 役職は leader 以外 maxHolders = 1 に制限（`getEffectiveOfficeMaxHolders` 内で house 非 leader → return 1）
- **派閥メンバーの役職解任免除**:
  - `organizationConsistencySystem` の Step 1/Step 2 で `getActiveFactionMembership` チェックを追加。派閥に所属する人物は、家門の領地条件を満たさなくても polity 役職を維持できる。派閥解散 or 本人離脱で次回チェック時に通常の領地条件に戻り自然に解任
- **Polity 詳細パネル改善**: 全 holder 表示に変更（従来は `holderIds[0]` の1人目のみ）、advisor 役職を表示に追加
- **EventLinks で AnonymousHouse のリンクを非表示に**

### v0.22 で実装済み（国・家の目標システム）

詳細仕様は `docs/drafts/spec-v022-update.md` 参照。

- **Goal → Aim → Intent 階層的目標システム**: Polity / House が長期目標 (Goal) → 中期計画 (Aim) → 短期意図 (Intent) の階層で一貫した行動を取る
- **Polity Goal 2 種**: external_expansion / internal_development。スコアリングで自動選択
- **House Goal 3 種**: expand_power_base / preserve_power_base / cultivate_prestige
- **Polity Aim 4 種**: consolidate_province_holdings / seize_weak_remote_holdings / develop_owned_holding / improve_owned_contract_terms
- **House Aim 5 種**: increase_polity_share / steer_polity_external_expansion / steer_polity_internal_development / patronize_artist / commission_chronicle
- **新設システム 7 個**:
  - GoalMaintenanceSystem (4w, 内部 48w ゲート): Goal 生成・レビュー・abandon
  - AimMaintenanceSystem (4w, 内部 48w ゲート): Aim 生成・deadline/target チェック
  - AimToIntentGenerationSystem (4w): Aim → Intent 生成
  - IntentActionSystem (4w): Action 系 Intent の即時処理 (develop_holding / expand_polity_share / promote_policy_shift / patronize_artist / commission_chronicle)
  - AimOutcomeSystem (4w): DiplomaticPlay 結果 → Aim progress 反映
  - GoalOutcomeSystem (4w): Aim 結果 → Goal progress 反映
  - CleanupTerminalDecisions (4w): terminal Goal/Aim/orphan DecisionReason の GC
- **IntentGenerationSystem を sell_land 専用に縮小**: acquire_land / improve_contract_terms / demand_tax_increase は Goal/Aim 系が生成
- **houseDevelopmentSystem 廃止**: 土地開発は Polity develop_holding に一本化。House は Polity Share・政策誘導で関与
- **House actor の最小実動**: expand_polity_share / promote_policy_shift / patronize_artist / commission_chronicle
- **House の Polity Goal 誘導**: steer_polity_* Aim が GoalMaintenanceSystem の Goal review 時に policyInfluenceBonus を加算
- **DecisionReason**: Goal / Aim の生成理由を i18n 翻訳キーで記録し、UI で表示
- **WorldGen 初期 Goal/Aim 生成**: 全 active Polity / House に初期 Goal + Aim を生成
- **DiplomaticPlay に goalId/aimId 継承**: IntentToDiplomaticPlaySystem が Intent → Play 変換時に継承
- **IntegrityCheck 拡張**: Goal/Aim/ActorIntent/DiplomaticPlay の整合性チェック追加
- **UI**: Polity / House の DetailPanel に Goal/Aim/progress/reasons を表示
- **i18n**: goals / aims / decision_reasons / events 翻訳を en/ja で追加。Aim の日本語訳は「目論見」（将来の Project 「計画」との衝突回避）
- **CLI JSON 出力**: buildDecisionSummary で Goal/Aim/Intent/DecisionReason データを年末出力に追加
- **EventType 13 種追加**: GOAL_CREATED / GOAL_SUCCEEDED / GOAL_FAILED / GOAL_ABANDONED / GOAL_REVIEWED / AIM_CREATED / AIM_SUCCEEDED / AIM_FAILED / AIM_ABANDONED / HOUSE_POLITY_SHARE_EXPANDED / HOUSE_POLICY_INFLUENCE / HOUSE_PATRONIZED_ARTIST / HOUSE_COMMISSIONED_CHRONICLE
- **EventType 1 種削除**: HOUSE_LAND_DEVELOPED (houseDevelopmentSystem 廃止)
- **検証**: CLI 4 seed × 300 年 IntegrityCheck violation 0 件

### v0.23 で実装済み（Person Goal / Aim / Task-driven Decision System）

詳細仕様は `docs/drafts/spec-v023-update.md` 参照。

- **Person Goal**: 人生目標 5 種（house_loyalty / public_service / personal_advancement / wealth_building / self_cultivation）。fulfillment 管理。原則固定で succeeded にならない
- **Person Aim**: 中期方針 6 種（support_organization_aim / increase_house_influence / obtain_office / retain_office / accumulate_wealth / improve_ability）。Task で直接進行
- **Task entity**: 23 種の TaskKind。assignee が週単位で処理。ephemeral（完了時に state から削除）
- **TaskSystem**: 毎週実行。effectivePriority 計算（5 項）、actionCapacity 管理、effort 処理、完了判定、ActivityLog 作成、次 Task 生成
- **PersonGoalMaintenanceSystem**: 48 週ごと。Person Goal 生成・fulfillment 管理
- **PersonAimMaintenanceSystem**: 4 週ごと。Person Aim 生成・deadline/waiting 管理
- **PersonActivityLog**: Task 完了・失敗・キャンセル時の軽量行動記録。person ごとに最大 30 件保持
- **DiplomaticPlay Task-driven 化**: delegate 選定、交渉パラメータ（preparation / leverage / commitment）、structuralProgress 弱化（×0.33）、delegate 能力による効果量倍率
- **AppointmentSystem 接続**: getAppointmentTaskModifier。obtain_office / retain_office Aim / ActivityLog から任官補正
- **personTrainingExperience**: improve_ability Task → experience 蓄積 → personGrowthSystem で bonus → 50% 減衰
- **effectivePriority**: ownerDutyBonus, goalAlignmentBonus, urgencyBonus, taskKindPriorityBonus, overloadPenalty
- **UI**: Person DetailPanel に Goal / fulfillment / Aim / Task / ActivityLog 表示。DiplomaticPlay に delegate / 交渉パラメータ / active Task 表示
- **IntegrityCheck 拡張**: Task / Person Goal / Aim / DiplomaticPlay delegate の整合性チェック
- **既存システム Person 対応**: goalMaintenanceSystem / aimToIntentGenerationSystem で Person skip、goalOutcomeSystem で Person Goal 非 succeeded 化、generateWorld.ts で初期 Person Goal / Aim 生成
- **EventType 7 種追加**: PERSON_GOAL_CREATED / PERSON_AIM_CREATED / PERSON_AIM_SUCCEEDED / PERSON_AIM_FAILED / TASK_COMPLETED / TASK_FAILED / TASK_CANCELLED
- **i18n**: goals / aims / tasks / fulfillment / blocked / waiting / activity 翻訳を en/ja で追加
- **検証**: CLI 4 seed × 20 年 IntegrityCheck violation 0 件。66 テストファイル / 566 tests pass

### v0.24 で実装済み（Holding POP 所属化と職業・無職 POP システム）

詳細仕様は `docs/drafts/spec-v024-update.md` 参照。

- **PopGroup の Holding 所属化**: `PopGroup.provinceId` → `PopGroup.holdingId` に変更。`Province.popGroupIds` を廃止。Province POP は Holding POP から selector で集計
- **PopOccupation 型追加**: `agriculture` / `urban_labor` / `elite_service` / `none`。各 class に標準 occupation を対応させ、職業枠からあぶれた POP を `none` として表現
- **occupation capacity**: Holding の kind / weight / landQuality / development から selector で導出。生産・兵力に occupation multiplier を追加
- **popIndex (WorldState)**: `popIndex.byHolding: Record<HoldingId, PopGroupId[]>` で Holding → POP の効率的参照
- **Province carrying capacity の再定義**: 旧 `habitability × populationCapacityPerHabitability` を廃止し、Province 内全 Holding の全職業キャパシティ合計に変更
- **成長式の変更**: `1 - pressure` (線形) → `1 - pressure²` (二次) に変更。fill ratio ~0.70-0.75 で均衡
- **baseMonthlyGrowthByClass 増量**: peasants 0.001→0.008、townsmen 0.0008→0.002、nobles 0.0004→0.001。災害損失を上回る成長率を確保
- **PopSystem の overflow**: 人口増加で occupation capacity を超える分は同 Holding / 同 class の `none` POP に移す
- **EmploymentRebalanceSystem 新設**: PopSystem 直後・LandRevenueSystem 直前。capacity 超過の強制失業化、none POP の再就業を処理
- **POP mutation 追加**: `addToOrCreatePopGroupMut` / `splitPopGroupMut` / `movePopSizeToOccupationMut` / `removePopGroupMut` / `mergeCompatiblePopsMut`
- **mergeCompatiblePops 年末安全弁**: 同一 merge key (holdingId + class + occupation) の POP を年末に統合
- **normalizePopSizes 更新**: `none` POP は size が `popSizeEpsilon` 以下で削除
- **Worldgen の POP 生成**: occupation capacity ベースの初期生成。`initialPopFillRatioMin/Max` (70/95) で充填率を制御
- **DiplomaticDemand.revolt_concession**: `popGroupId` → `popClass` に変更（merge で消滅しうるため）
- **周辺システム適応**: disasterSystem / conflictResolutionSystem / provinceRevoltSystem / popDevelopmentSystem / statusSelectors / polityRelations を Holding POP 参照に変更
- **IntegrityCheck 更新**: PopGroup.holdingId 存在チェック、merge key 一意性、popIndex 整合性を追加
- **UI**: Holding 詳細に POP / occupation / capacity 表示
- **Config 追加**: occupationCapacityBaseByHoldingKind / occupationProductivityMultiplier / occupationManpowerMultiplier / unemployedWealthDecayByClass / unemployedUnrestGainByClass / unemployedGrowthModifierByClass / popSizeEpsilon / initialPopFillRatioMin/Max
- **Config 削除**: `populationCapacityPerHabitability`
- **検証**: CLI 4 seed × 300 年 IntegrityCheck violation 0 件

### v0.25 で実装済み（代官システム改修: Bailiff, Local Extraction, Revenue Task）

詳細仕様は `docs/drafts/spec-v025-update.md` 参照。

- **代官徴税モデル刷新**: `bailiffRevenueShare` を廃止し、`contractedRemittanceRate` / `expectedFeeRate` / `BailiffPolicy` / `collectionEfficiency` による多段階徴税モデルに置換
- **BailiffRevenueTaskSystem 新設**: 代官の月次 `collect_holding_revenue` Task を生成・期限切れ処理
- **BailiffPolicy selector**: `passive` / `loyal_remittance` / `profit_seeking` / `protect_residents` の 4 方針を能力・性格・現地 POP 状況から導出
- **LandRevenueSystem 改修**: per-Holding の代官現地徴収を挟む。`totalBurdenRate` ベースの POP 影響処理
- **OfficeCompensationSystem**: bailiff 給与支払い廃止。代官収入は LandRevenueSystem の bailiffFee に一本化
- **IntegrityCheck 拡張**: HoldingOfficeAssignment / collect_holding_revenue Task / selector range チェック追加
- **検証**: CLI 4 seed × 300 年 IntegrityCheck violation 0 件

### v0.26 で実装済み（Project システム導入 / Intent 廃止）

詳細仕様は `docs/drafts/spec-v026-update.md` 参照（Phase A/B/C すべて完了）。

- **Project エンティティ追加**: ProjectId / ProjectStatus / ProjectOrigin / ProjectKind / BaseProject + 7 variant 型。`projects` / `projectIndex` (6 index) / `nextProjectId` を WorldState に追加
- **ActorIntent 全廃**: ActorIntent / ActorIntentId / ActorIntentKind / IntentRationale 型を削除。WorldState から `actorIntents` / `nextActorIntentId` を削除。DiplomaticPlay の `originIntentId` → `originProjectId` に置換
- **Aim 型変更**: `activeIntentId` / `lastIntentGeneratedWeek` / `nextIntentAllowedWeek` / `successfulIntentCount` / `failedIntentCount` を削除。`lastProjectPreparedWeek` / `nextProjectAllowedWeek` / `successfulProjectCount` / `failedProjectCount` を追加。`targetProgress` を 1 → 100 に変更
- **TaskKind 変更**: `prepare_intent` 廃止、`prepare_project` / `advance_project` 追加。`TaskTargetRef { kind: 'intent' }` 廃止、`{ kind: 'project' }` 追加
- **新設 system 5 個**: ProjectPreparationSystem / SellLandProjectGenerationSystem / ProjectTaskGenerationSystem / ProjectMaintenanceSystem / ProjectOutcomeSystem
- **廃止 system 4 個**: IntentGenerationSystem / AimToIntentGenerationSystem / IntentToDiplomaticPlaySystem / IntentActionSystem
- **Project creator / supervisor 選定**: `selectProjectCreator` / `selectProjectSupervisor` selector。能力・Share・workload ベースのスコアリング
- **外交系 Project**: acquire_land / sell_land / improve_contract_terms / demand_tax_increase は Project 完了時に DiplomaticPlay を生成。preparation / leverage / commitment を advance_project Task で蓄積
- **非外交系 Project 効果**: develop_holding (Holding.development +5) / expand_polity_share (rawPower +10) / promote_policy_shift / patronize_artist (legacyPrestige +3) / commission_chronicle (legacyPrestige +5)
- **EventType 変更**: PROJECT_STARTED / PROJECT_COMPLETED / PROJECT_FAILED / PROJECT_CANCELLED 追加。ACTOR_INTENT_CREATED / ACTOR_INTENT_CONVERTED 削除
- **UI**: DetailPanel に active Project 表示（Polity / House / Person）
- **IntegrityCheck**: Project 基本・index 整合・Intent 廃止確認チェック追加
- **Config 追加**: projectDefaultTargetProgress / projectAdvanceProgress* / diplomaticProject*Gain* / aimProgressGain* / projectBudget* / projectDeadlineWeeks* / prepareProjectPartialTargetProgressPenalty / projectPreparationCooldownWeeks 等
- **検証**: CLI 4 seed × 300 年 IntegrityCheck violation 0 件。65 テストファイル / 598 tests pass

### v0.26.1 で実装済み（Task 成否判定システム）

詳細仕様は `docs/drafts/spec-v0261-update.md` 参照。

- **Task 型に `difficulty` / `relevantAbility` フィールド追加**: 0〜100 の難易度と outcome 判定に使う AbilityKey
- **`determineTaskOutcome` 関数**: `effectiveScore = abilityScore + roll*100` vs `threshold = difficulty*2`。`taskOutcomeSuccessMargin` (20) で success/partial/failure を判定
- **TASK_KIND_OUTCOME_DEFAULTS**: 全 26 TaskKind に difficulty / relevantAbility のデフォルト値を定義
- **PROJECT_KIND_ABILITY_MAP**: 9 ProjectKind → AbilityKey マッピング（prepare_project / advance_project の relevantAbility をオーバーライド）
- **prepare_project outcome 分岐**: failure → Project 不生成、partial → targetProgress にペナルティ加算
- **advance_project outcome 分岐**: success +25 / partial +10 / failure +0。外交系 preparation/leverage/commitment も同様
- **Aim 系 Task outcome 分岐**: failure/partial → progress 加算なし、aim は active 維持
- **IntegrityCheck**: difficulty 範囲 [0,100]、relevantAbility 有効性チェック追加
- **Config 追加**: `taskOutcomeSuccessMargin: 20`
- **バランス結果**: Project 成功率が 89-97% (v0.26) → 約 55% (v0.26.1) に低下。能力の高い人物を supervisor に選ぶ動機が機能
- **検証**: CLI 4 seed × 300 年 IntegrityCheck violation 0 件。65 テストファイル / 598 tests pass

### v0.30 で実装済み（Offer-driven Diplomatic Negotiation）

詳細仕様は `docs/drafts/spec-v030-update.md` / `docs/drafts/spec-v030-review.md` 参照。

- **DiplomaticIssue 型追加**: 外交劇の不変争点 anchor。`LandClaimIssue` (holdingId, provinceId) / `ContractTaxRevisionIssue` (holdingId, landContractId, baseTaxRateToGrantor, desiredTaxRateToGrantor, direction)。dedupe key / orphan check / cleanup / UI 表示の基準
- **DiplomaticOffer 型追加**: `DiplomaticOfferId` (branded, prefix `do-`)。`DiplomaticOffer` (id, playId, proposedBy, demands, status, createdWeek, reasonIds)。`DiplomaticOfferStatus`: pending / accepted / rejected / withdrawn
- **WorldState 拡張**: `diplomaticOffers: Record<DiplomaticOfferId, DiplomaticOffer>` / `nextDiplomaticOfferId: number`
- **DiplomaticPlay 型変更**: `issue?: DiplomaticIssue` 追加（land_claim / contract_tax_revision では必須）、`currentOfferId? / lastEvaluatedOfferId? / lastRejectedOfferId? / offerHistoryIds` 追加、`counterDemand` 完全削除、`primaryDemand` は revolt_negotiation 専用として維持
- **Offer validation**: `validateOffer` / `canApplyDemand` / `OfferValidationResult` / `OfferInvalidReason`。issue-demand 矛盾検査（§5.4 相当）
- **Offer evaluation**: `evaluateOffer` / `OfferEvaluation`。PlayKind 別に demands からパラメータを抽出し score 計算。accepted (score ≥ 0) → settled、rejected → tension 上昇
- **applySettledOffer / applyDemand**: accepted offer の demands を demand 種別ごとに適用。`allDemands` 引数で `transfer_land_contract` の reason 導出（pay_wealth あり → purchase / なし → cession）
- **DiplomaticPlaySystem offer-driven 化**: 毎 tick structural tension 微増 + offer 評価（currentOfferId !== lastEvaluatedOfferId 時のみ）のハイブリッドモデル。progress は settlement 判定に使わず UI 表示値として維持。progress 駆動源: validOfferProgressDelta / counterOfferProgressDelta / offerCompromiseProgressDelta / negotiateTermsProgressDelta。deadline 到達時: 未評価 offer → 強制 evaluate、なし/rejected → escalated。旧 progress > tension → settle 分岐を廃止
- **cancelOrphanedPlays 強化**: issue-based orphan check（holdingId / provinceId / landContractId 存在確認 + landContract chain 所属確認）
- **初期 offer 生成**: `createDiplomaticPlayFromProjectMut` で play 作成と同時に initiator の初期 offer を生成。land_claim: transfer_land_contract + pay_wealth (purchasePrice)。contract_tax_revision: change_contract_tax_rate + pay_wealth (compensation)
- **税率改定の desiredTaxRateToGrantor**: `taxRevisionTaxChangeAmount` (固定 ±5%) を廃止し、`taxRevisionInitialDemandDelta` (0.10) + clamp で算出
- **税率改定の補償金**: `computeTaxRevisionCompensation` — taxBase × |newRate - baseRate| × compensationYears
- **propose_initial_offer stage**: respond_to_pressure Project の immediate stage として追加。stance に応じた counter-offer 生成（concede: 要求コピー / negotiate: 中間案 / resist: status_quo）
- **offer_compromise 拡張**: Task 完了時に新 DiplomaticOffer を作成。lastRejectedOfferId を基に ±30% 妥協調整。progress は offerCompromiseProgressDelta に一本化
- **mixed holdings debug**: `debugMixedProvinceHoldingsRatio` config (default 0) で worldgen 後に一定割合の Province の Holding を近隣同 rank Polity に移転。land_claim の検証経路を確保
- **cleanupTerminalDiplomacy**: offer cascade delete（offer 先 → play 後の順序）
- **IntegrityCheck 追加**: terminal play の offer 残留検査、issue-demand 整合性検査
- **Config 変更**: `taxRevisionTaxChangeAmount` 廃止。新規: taxRevisionInitialDemandDelta / taxRevisionReservationDelta / taxRevisionMaxDemandDelta / taxRevisionCompensationYears / invalidOfferTensionDelta / rejectedOfferTensionDelta / validOfferProgressDelta / counterOfferProgressDelta / offerCompromiseProgressDelta / negotiateTermsProgressDelta / debugMixedProvinceHoldingsRatio
- **検証**: CLI 4 seed × 300 年 IntegrityCheck violation 0 件

### v0.20 以降に送られる主要項目

#### Faction 拡張系

- **派閥リクルート改善**: 現状 `recruitCap = 1`（季節ごと = 年4人/派閥）が制約的で、十分な規模に成長する前に解散するケースが多い。代官候補の確保にも影響。リクルート上限・頻度・対象条件の見直しが必要。
- **代官候補プールの拡大**: rank ベース役職制限と house maxHolders=1 制限により polity/house 役職の消費は改善したが、代官候補は「他の役職を一切持たない free adult」に限定されるため、少人数の ownerHouse では依然として候補が枯渇する。代官候補条件の緩和（house 役職持ちでも可）、または在野人物の直接雇用経路（派閥を経由しない）の検討が必要。
- **同派閥婚姻ボーナス / leader 意思決定の派閥圧力 / 軍事 contribution の Share-based 集計**: v0.17 では未実装。派閥が「人事と恩顧」のみ。
- ~~**Faction 独立 UI**~~: v0.17.4 で実装済み (sidebar Factions タブ + DetailPanel FactionDetail)。
- ~~**bailiff の factional 推薦 (§15.3)**~~: v0.17.1 で実装済み (派閥員候補プール拡大 + 兼任全面禁止 + Bailiff salary 経路)。
- **commonwealth 派閥の取り扱い拡張**: `ownerHouseId === undefined` Polity (Rebel Polity / commonwealth) で `getFactionNominationPower` から ownerHouse bonus を 0 にする処理は実装済 だが、commonwealth 特有の派閥動態 (rebel leader 直接派閥 leader 化など) は未深化。
- **§21.3 D1 (alive=false → deathYear/deathMonth set)**: v0.17 では Person 型に deathYear/deathMonth を追加せず、integrity check は D1 を除外。表示時に state.currentYear から算出する設計のままで継続するか、deathYear を Person field として追加するかは要検討。
- **Bailiff 任期年数のチューニング**: v0.17 デフォルト 3 年は normal bailiff が ownerHouse member に交代される機会を絞る要因の一つだった。v0.17.1 で factional 化と兼任厳格化により normal bailiff 比率は改善 (4 seed 平均で ~10/40)、任期延長 or 補充タイミング再設計は引き続き要観察。
- ~~**`targetUnaffiliatedPersons` バランス調整**~~: v0.20.3 で holdings 比例化 (`unaffiliatedPersonsPerHolding: 0.5`) により解決。月次実行化、男性比率 75% 設定済み。
- **POLITY_LANDLESS event 表示の整備**
- **支出メカニズムの拡充**: 現状 Person.wealth は収入経路 (Office salary / Polity 余剰分配 / 派閥献金 / Bailiff salary) が複数あるのに対して支出経路が乏しく、複数 office を兼任する人物の wealth が 10 万単位で累積する (v0.17.3 観察例: Ostmark の Ruler + Greymark の Court Advisor + House Drakenhof 家長 + House Corvin の役職 3 つ + Lionel's Circle faction leader を兼ねる Lionel が 50 年で wealth 198,378)。将来追加候補: 不動産維持費・人件費・交際費・浪費。バランス調整は支出経路が入った後に行う方針。

#### v0.18 外交劇の残課題 (v0.19+ で検討)

- ~~**長期 GoalSystem**~~: v0.22 で Goal/Aim/Intent 階層を実装済み
- ~~**Person ActionSystem**~~: v0.23 で Task-driven Decision System として実装済み
- **DiplomaticRelation**: Polity 間の長期外交関係
- **第三者参加外交 / 同盟 / 保証 / 参戦 / 仲裁**: DiplomaticPlay への第三者介入
- **本格 War entity / WarScore / PeaceSettlement**: 詳細戦争システム
- ~~**House actor を主体とする外交劇の有効化**~~: v0.22 で House actor の最小実動を導入済み（expand_polity_share / promote_policy_shift / patronize_artist / commission_chronicle）。DiplomaticPlay 主体としての House actor は将来課題
- **install_owner / dynasty change 要求**: 王朝交代要求 DiplomaticDemand
- **AppointmentPolicy 抽象による commonwealth ad-hoc 分岐の整理**
- ~~**intentCooldownWeeks の本格運用**~~: v0.26 で Intent 全廃に伴い削除。Project 系に置換 (`projectPreparationCooldownWeeks`)
- **Rebel Polity の rank 昇格** (rank=5 → rank=4): v0.18 では現行 rank 決定を維持
- **DiplomaticPlay の settlement/escalation 閾値の非対称化調整**: escalation 経路が支配的 (Stage E 確認済)
- **CONTRACT_ELIMINATED の発生頻度調整**: 現状 4 seed × 300 年で 0 件
- **異 rank 間 land_claim の CEDED 経路の調整**: 補償なし妥協の成立条件チューニング
- **請求権 (claim rights) システム**: inactive Polity を材料とした動機付き land_claim
- **税率変動量の動的調整**: 軍事力差に応じて 5% → 10-15% 等
- **commonwealth succession / commonwealth faction / commonwealth → dynastic polity 遷移**
- **House Rebellion の外交劇化**: Faction / GoalSystem と接続して再設計

#### Action 経済 + 実体・称号システム (将来、v0.18+ 想定)

v0.17.3 観察から「実体を持たない家/国の役職」をどう扱うかが課題として浮上した (例: landless な家の家長は他派閥に入って bailiff として身を立てるべきだが、現状 v0.17.1 の「兼任全面禁止」ルールで除外される)。

これを ad-hoc な例外ルール (例: substantive org の役職のみ兼任禁止対象) として対処するのではなく、**より principled な数値モデル「個人の Action 経済」に統合する方針**。

設計の骨子:

- **Person.actionCapacity (月)**: 個人ごとの「月あたり行動力」上限。能力 (governance / insight など) と相関させる予定。
- **Office に actionCost を持たせる**: 各役職は月々その役職の動力コストを消費する。`getOfficeCompatibilityPenalty` (v0.17 §14.5) と `concurrentOfficePenalty` (v0.12) を統合・置換する。
- **役職の actionCost は所属組織の "実体" に比例**:
  - 土地と財産が多い家・国の役職は actionCost が高い (管理対象多 = 仕事多)
  - 名目だけの没落家・滅びかけの polity の役職は actionCost が極小 (実権なし)
  - 「Holy Roman Emperor」型の称号も自然に表現できる
- **兼任ルールは「合計 actionCost ≤ actionCapacity」に置換**: 「全面禁止」「同 role 兼任ペナルティ」などの ad-hoc ルールを統合
- **称号システムへの発展**: 実体のない役職 (actionCost ~ 0) はそのまま「称号」として扱える。`TITLE_INHERITED` / `TITLE_RECLAIMED_BY_HOUSE` / `DYNASTY_CHANGED` 等 (§v0.17+ 独立トピックで既出) と統合可能。

実装規模感: state 拡張 (Person.actionCapacity)・全 OfficeDefinition の actionCost 設計・appointmentSystem / bailiffAppointmentSystem / officeCompensationSystem の改修・config の整理 — 1 マイナーバージョン丸ごと使う規模。設計ドラフト (`docs/drafts/spec-v018-action-economy.md`) を先に書いて寝かせる方が安全。

関連する既存メモ:
- v0.17.1 の「兼任全面禁止」(§15.3): action 経済導入時に soft constraint に置換される予定
- v0.17 §14.5 `getOfficeCompatibilityPenalty`: 同上
- §v0.17+ 独立トピックの称号システム: action 経済と統合設計予定

#### Affection 駆動の行動 (将来)

現状 Attitude (Affection / Respect) は記録されているが、各種意思決定にはまだほとんど反映されていない。Lionel のような「強い負の Affection を持つ House の役職を兼任する」状況が観察できるが、これを反映するには以下のリンクが必要:

- 婚姻: 互いに Affection 正の組同士で形成しやすい (現状ランダム + 同 Polity ボーナスのみ)
- 派閥リクルート: leader と target の相互 Affection でコスト・成功率が変動 (一部実装済)
- Plot: 標的への Affection 強負で発動率上昇
- Office 辞退・離反: 大きな負の Affection を持つ組織からの任命を低確率で拒否
- 戦争意思決定: 隣接 Polity への Affection で戦争閾値が変動

#### 家の土地回復経路 (将来)

v0.17.3 観察 (House Corvin — 9 人の血統メンバー + Lionel 派閥所属、しかし完全 landless で wealth=0) で、**現状の実装には「土地を失った家が land を取り戻す経路」が事実上存在しない** ことが確認された。

調査結果: 既存の Province 取得経路 (House Split / Extinction 継承 / POLITY_OWNER_CHANGED / War / LandContractPurchase / createRebelPolity / Marriage) はいずれも「既に土地を持っている家」「最高 prestige 家」「新規生成家」を優先するため、完全 landless な家には届かない。`findFallbackOwnerHouse` だけが理論的可能性だが legacyPrestige 順で他に必ず負ける。

将来追加すべき経路 (シナリオ別、必要な infrastructure は既に存在):

- **土地を買い戻す (Land purchase)**: `LandContractPurchaseSystem` を Polity-to-Polity から House-direct purchase にも開放。`transferProvinceToHouse` + `Person.wealth` の組み合わせで実現可能。Werner のような派閥員が稼いだ wealth で旧領を買い戻す物語の基盤。
- **譲られる (Patron grant)**: Polity owner や派閥 leader が member house に Province を恩恵として割譲する仕組み。新規 system (例: `PatronageGrantSystem`) と既存 `transferProvinceToHouse` の組合せ。Lionel が Ostmark の Province を Werner に与える、といった物語。
- **叛乱指導者となって land を獲得する**: 現状の `createRebelPolity` は「新規 House を生成」するが、これを「既存 House の member を rebel leader として推戴し、その House にProvince を移転」する経路に拡張する。Werner が「Corvin 家再興のために叛乱を主導」する物語。
- **結婚の持参金 (Dowry)**: `marriageSystem` に Province 持参金経路を追加。`transferProvinceToHouse` 既存。高 prestige 家と低 prestige 家の婚姻時に Province が移転する。Werner の子 (pe-264 等) が強家と婚姻して land を持ち込む物語。

これらは Affection 駆動行動・action 経済とも連動するので、v0.18+ で「家の興亡」というテーマで束ねて実装するのが自然 (個別 PR ではなく v0.18 全体テーマとして括る案)。

#### 経歴 / Entity-Event 関連付け (将来)

人物 / 家 / 国 / Province 単位で「何が起きたか」を時系列で振り返れる UI を実現するための data model 改修。v0.17.3 で inactive OfficeAssignment / FactionMembership を完全削除した結果、state を遡って経歴を再構築することは不可能になっており、別経路で履歴を保持する必要がある。

**アイディアレベルの設計案** (詳細は v0.18+ で他システムと突き合わせて確定する):

- **Entity 側に ID 参照リストを持たせる**: `Polity / House / Person / Province` に `relatedEventIds: EventId[]` (もしくは類似フィールド) を追加。イベント生成時に event の `actorIds / houseIds / polityIds / provinceIds` を巡回して該当 entity の list に push する単一 dispatcher を用意する。各 system 側の event 生成箇所が既に統一されていれば 1 箇所の改修で済むはず。
- **eventHistory の保管場所を `session` から `state` に移植**: ID から event を引ける前提なので、state と event log の整合性が前提条件になる。CLI export や snapshot との一貫性もこれで担保される。
- **保管 cap の戦略 (案レベル)**:
  - (A) cap 撤廃、`state.eventHistory: Record<EventId, SimEvent>` で全保持。memory 影響大。
  - (B) importance ベース cap: `critical` / `major` は無期限、`normal` / `minor` のみ cap。歴史書が重大事件しか記録しない史実的整合とも合う。**有力**。
  - (C) cap 突破時に "圧縮イベント" にまとめる (例: 「pe-XXX は year 50-60 に Bailiff を 3 回務めた」のような要約)。実装コスト高。
- **UI**: DetailPanel に "Career" / "History" タブを追加し、`relatedEventIds` から取得した event を時系列降順で表示。importance や EventType でフィルタ可能。

**他システムとの関連 (実装時に再確認すべき項目)**:

- `maxRawEvents` config と event ring buffer (現状 `simulationStore.ts:99-103` で cap) の挙動を見直す。
- v0.17.3 で削除した inactive OfficeAssignment / FactionMembership と異なり、経歴は event ID 経由でアクセスするので state table 圧縮の方針とは衝突しない。
- イベント生成側の単一 dispatcher 化が前提なので、現状の event emit 箇所を棚卸しして集約済みかを確認する必要がある。
- 死者の Person を完全削除する将来最適化 (CLAUDE.md "v0.18 以降の最適化候補" の項目) と整合させる: 死亡者の `relatedEventIds` が無くなるなら、event 側に actor の `personName` snapshot を持たせて孤児イベントでも UI 表示できるようにする等の検討が必要。

#### v0.16 から繰り越された未実装 (一部 v0.17 で部分対応)

- **多重臣従**: 1 つの House が複数 Polity の owner / vassal を兼ねる構造の明示化 (v0.16 では「複数 Polity の ownerHouse になり得る」のみ実装、明示臣従関係は無し)
- **war goal system**: ~~case C (下位 rank 勝者) の税率調整 default を起動。§13 / §16.1~~ → v0.18 で contract_tax_revision DiplomaticPlay として実装済み
- ~~**commonwealth 補充 / Rebel Polity の家産化阻止 (§11.2)**~~: v0.18-pre で commonwealth skip を実装し解消済み
- **上位者の取り分維持と Attitude penalty (§14)**: 押領・強制的な税率変更時に上位者から実行者へ negative Attitude を付与
- **BailiffAppointment の commonwealth 対応 (§19.1)**: 現状 ownerHouse なしは skip。Polity Share holder 系の候補者選定を導入

#### v0.17 以降の独立トピック

- **限界突破イベント**: aptitude を 101..120 帯に押し上げる伝説的偉業・特訓イベント（v0.14 はデータ表現のみ）
- **ESTATE_CONTESTED の長期 Project 化・claim 派生**: v0.14 では ESTATE_DISPUTED は記録のみ。長期化させた相続争いを Project 化し、後年に claim 相続へ繋げる
- **遺言（指定相続人）機構**: 現状は嫡出子→配偶者→兄弟→家長の固定順
- **称号システム**（家産称号 / 個人称号 / 公的称号、TITLE_INHERITED / TITLE_RECLAIMED_BY_HOUSE / DYNASTY_CHANGED / TITLE_UNION_FORMED / DISSOLVED）
- **Polity 拡張**: ownershipMode / titlePropertyRegime / successionLaw / 同君連合
- **LandContract の高度な機能**: 契約改竄 / claim / 分岐 chain / 共同保有等 (§27 参照)
- **代官 / ProvinceOfficeAssignment の拡充**（Person.houseId optional 化、代官蓄財、bailiff 経済の独立）
- **氏族 Clan**、巨大 House の Clan 化
- **socialFriction**（魅力 − 洞察 ペナルティ）— Attitude system 全体見直し
- **ROLE_WEIGHTS の config 化**（シナリオごとに重み変更したいニーズが顕在化したとき）
- **spymaster / disasterSystem 関連の役職** とその経験成長対応
- **大分裂（House 独立）**: 全土統一後、国力が一定規模を超えると支配家から傍系家が独立し複数 Polity が成立する「中国史的分裂」メカニズム。現状は Province Revolt から新勢力が生まれるが、House 単位での大規模独立はまだ弱い
- **Polity 規模ペナルティ**: Province 数・House 数が増えるほど Legitimacy（getPolityLegitimacy）が低下しやすくなり、大 Polity が自重で崩れる仕組み
- **家の分裂の作り込み**: Attitude 経由の cohesion 変動をより細かく制御、分裂閾値の調整、一強状態でも分裂が自然発生する仕組み
- **POP_HARDSHIP / POP_PROSPERITY / POP_UNREST_RISING / POP_DECLINED イベントの発火ロジック**: 閾値超過時のみ発火する条件付きイベント（EventType 宣言のみ実装済み）
- **首都・本拠地移転**: 征服・滅亡・特別イベントによる移転
- **POP の移住**: population pressure・wealth・unrest・戦争荒廃に応じた Province 間移動
- **文化・宗教**: PopGroup への cultureId / religionId 追加、同化・改宗・弾圧・寛容政策
- **食料生産**: carrying capacity / population pressure を foodProduction / foodDemand に拡張
- **詳細な戦争**: War エンティティ、戦場、包囲戦
- **施設システム**: 城塞・道路・港・市場
- **詳細外交**: 同盟・条約・婚姻。現在 LandContract.termsProtectedUntilWeek で実装している契約保護期間は、条約システム導入時に汎用的な「二国間条約」エンティティに置き換える想定
- **継承権・請求権**: 血縁関係に基づく他家への継承権主張
