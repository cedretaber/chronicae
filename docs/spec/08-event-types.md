# 8. イベント型一覧

| EventType | importance | 説明 |
|-----------|------------|------|
| OFFICE_ASSIGNED | normal | 役職任命（v0.12。旧 ROLE_ASSIGNED） |
| OFFICE_REVOKED | normal | 役職解任（v0.12。旧 ROLE_REVOKED） |
| OFFICE_SALARY_UNPAID | minor | 給与未払い（v0.12） |
| OFFICE_SALARY_PARTIALLY_PAID | minor | 給与部分払い（v0.12） |
| POLITY_LEADER_CHANGED | critical | Polity leader の交代（v0.12。旧 RULER_CHANGED、v0.15 で rename） |
| POLITY_OWNER_CHANGED | major | Polity の ownerHouseId 交代（v0.15 新規） |
| POLITY_EXTINCT | major | Polity が自己消滅（ownerHouse 不在 / Province 数 0）（v0.15 新規） |
| HOUSE_LEADER_CHANGED | normal | 家長交代（v0.12。旧 HOUSE_HEAD_CHANGED） |
| SHARE_SHIFTED | minor | Share 分布の有意な変化（v0.12） |
| PERSON_DIED | normal | 人物死亡 |
| IMPORTANT_PERSON_DIED | major | 重要人物死亡 |
| HOUSE_EXTINCT | major | 家の断絶（後継者不在）（v0.15: 旧 RULER_HOUSE_EXTINCT も統合） |
| MARRIAGE_FORMED | normal | 婚姻成立 |
| CHILD_BORN | minor | 子誕生 |
| HOUSE_SPLIT | major | 家の分裂（傍系家の独立） |
| CADET_HOUSE_FOUNDED | major | 分家の創設（v0.31） |
| HOUSE_FOUNDED | major | 無家人物による新 House の創設（v0.31） |
| CLAN_FOUNDED | major | 氏族の成立（v0.32）。entityRefs: clan, rootHouse, founder（任意） |
| SUCCESSION_CRISIS | major | 継承危機 |
| PLOT_STARTED | normal | 陰謀開始 |
| PLOT_SUCCEEDED | major | 陰謀成功 |
| PLOT_FAILED | normal | 陰謀失敗 |
| PLOT_CANCELLED | minor | 陰謀中断 |
| POLITY_SPLIT | critical | Polity 分裂（v0.15: 旧 COUNTRY_SPLIT を rename） |
| POLITY_LANDLESS | major | Polity が landless 化（terminal Province 0、v0.16 新規 / 現状未発火 §11） |
| OMEN | normal | 兆し |
| FAMINE | major | 飢饉 |
| PLAGUE | major | 疫病 |
| BOUNTIFUL_HARVEST | normal | 豊作 |
| DISASTER_RELIEF_FUNDED | normal | 災害救済成功 |
| DISASTER_RELIEF_FAILED | normal | 災害救済失敗 |
| WAR_DECLARED | major | 宣戦布告 |
| WAR_WON | major | 戦争勝利 |
| WAR_LOST | major | 戦争敗北 |
| PROVINCE_CONQUERED | major | Province 征服 (v0.16 では WarSystem が依然発火、LAND_CONTRACT_* への置換は Faction 段階) |
| POLITY_ANNEXED | critical | 国家消滅（併合） |
| COUNTRY_LAND_DEVELOPED | normal | 国家による土地開発（v0.22: develop_holding Intent による Holding 開発も含む） |
| POP_LAND_DEVELOPED | minor | POP 自主開発（§6.18） |
| PROVINCE_REVOLT_STARTED | normal | Province / POP 反乱が発生 |
| PROVINCE_REVOLT_SUCCEEDED | major | Province 反乱が concession で成功 |
| PROVINCE_REVOLT_FAILED | normal | Province 反乱が失敗・鎮圧 |
| REVOLT_POLITY_FOUNDED | critical | Province 反乱の独立により新 Polity が成立 |
| LAND_CONTRACT_GRANTED | major | LandContract 新規付与（v0.16、現状未発火、Faction 段階で配線） |
| LAND_CONTRACT_TRANSFERRED | major | terminal grantee の差し替え（v0.16、§13 case A、現状未発火） |
| LAND_CONTRACT_INSERTED | major | 中間契約の挿入（v0.16、§13 case B-1、現状未発火） |
| LAND_CONTRACT_REPLACED | major | 下位契約の差し替え（v0.16、§13 case B-2、現状未発火） |
| LAND_CONTRACT_TAX_CHANGED | normal | 上納率の変更（v0.16、§16.1 case C、現状未発火） |
| LAND_CONTRACT_REVOKED | major | 契約解消（v0.16、現状未発火） |
| LAND_CONTRACT_PURCHASED | major | 金銭による契約譲渡が成立（v0.16 / v0.18 で補償あり土地購入に拡張） |
| LAND_CONTRACT_CEDED | major | 補償なし土地譲渡（v0.18） |
| LAND_CONTRACT_CONQUERED | major | 武力による土地奪取（v0.18） |
| PROJECT_STARTED | minor | Project 開始（v0.26） |
| PROJECT_COMPLETED | normal | Project 完了（v0.26） |
| PROJECT_FAILED | minor | Project 失敗（v0.26） |
| PROJECT_CANCELLED | minor | Project 中止（v0.26） |
| DIPLOMATIC_PLAY_STARTED | normal | 外交劇開始（v0.18） |
| DIPLOMATIC_PLAY_SETTLED | major | 外交劇妥協成立（v0.18） |
| DIPLOMATIC_PLAY_FAILED | normal | 外交劇失敗（v0.18） |
| DIPLOMATIC_PLAY_ESCALATED | major | 外交劇決裂・戦争化（v0.18） |
| DIPLOMATIC_PLAY_RESOLVED_BY_CONFLICT | major | 外交劇が武力衝突で解決（v0.18） |
| CONTRACT_TAX_REVISED | normal | 税率改定成功（v0.18） |
| CONTRACT_ELIMINATED | major | 契約破棄（v0.18） |
| REVOLT_NEGOTIATION_STARTED | normal | 叛乱交渉開始（v0.18） |
| REVOLT_SETTLED | major | 叛乱妥協（v0.18） |
| REVOLT_SUPPRESSED | major | 叛乱鎮圧（v0.18） |
| REVOLT_POLITY_ESTABLISHED | critical | 叛乱独立成功（v0.18） |
| BAILIFF_APPOINTED | normal | placeholder → 通常人物への Bailiff 交代（v0.16） |
| BAILIFF_VACATED | normal | Bailiff が不在化（v0.16） |
| BAILIFF_PLACEHOLDER_INSTALLED | minor | terminal Polity 変更時の Bailiff placeholder 設置（v0.16） |
| GOAL_CREATED | minor | Goal 生成（v0.22） |
| GOAL_SUCCEEDED | normal | Goal 達成（v0.22） |
| GOAL_FAILED | normal | Goal 失敗（v0.22、予約。現状未発火） |
| GOAL_ABANDONED | minor | Goal 放棄（v0.22） |
| GOAL_REVIEWED | minor | Goal レビュー（v0.22） |
| AIM_CREATED | minor | Aim 生成（v0.22） |
| AIM_SUCCEEDED | normal | Aim 達成（v0.22） |
| AIM_FAILED | minor | Aim 失敗（v0.22） |
| AIM_ABANDONED | minor | Aim 放棄（v0.22） |
| HOUSE_POLITY_SHARE_EXPANDED | normal | House の Polity Share 拡大（v0.22） |
| HOUSE_POLICY_INFLUENCE | minor | House の政策誘導（v0.22） |
| HOUSE_PATRONIZED_ARTIST | normal | 芸術家後援（v0.22） |
| HOUSE_COMMISSIONED_CHRONICLE | normal | 年代記編纂（v0.22） |
| PERSON_GOAL_CREATED | minor | Person Goal 生成（v0.23） |
| PERSON_AIM_CREATED | minor | Person Aim 生成（v0.23） |
| PERSON_AIM_SUCCEEDED | normal | Person Aim 達成（v0.23） |
| PERSON_AIM_FAILED | minor | Person Aim 失敗（v0.23） |
| TASK_COMPLETED | minor | Task 完了（v0.23） |
| TASK_FAILED | minor | Task 失敗（v0.23） |
| TASK_CANCELLED | minor | Task キャンセル（v0.23） |
| PRESSURE_CREATED | minor | 外交的圧力の発生（v0.29） |
| PRESSURE_RESOLVED | minor | 外交的圧力の解決（v0.29） |
| PRESSURE_CANCELLED | minor | 外交的圧力の撤回（v0.29） |

**v0.26 で削除された EventType**:

- `ACTOR_INTENT_CREATED` — ActorIntent 全廃に伴い削除
- `ACTOR_INTENT_CONVERTED` — ActorIntent 全廃に伴い削除

**v0.22 で削除された EventType**:

- `HOUSE_LAND_DEVELOPED` — houseDevelopmentSystem 廃止により発火源消失。土地開発は Polity develop_holding に一本化

**v0.16 で削除された EventType**:

- `REBELLION_STARTED` / `REBELLION_SUCCEEDED` / `REBELLION_FAILED` — RebellionSystem 廃止により発火源消失
- `LORDSHIP_TRANSFERRED` / `LORDSHIP_USURPED` — LordshipTransitionSystem 廃止 / 反乱で ownerHouse が直接交代する経路の消失により発火源消失
- `MONUMENT_BUILT` — v0.16 後の整理で記念碑建設機能を廃止（観賞価値の薄さと polityControl 補強として独立した存在意義の乏しさを理由に publicSpendingSystem を土地開発専用に簡素化）
| POP_HARDSHIP | minor | POP の困窮（将来実装） |
| POP_PROSPERITY | minor | POP の繁栄（将来実装） |
| POP_UNREST_RISING | normal | Province unrest 上昇警告（将来実装） |
| POP_DECLINED | normal | Province 人口大幅低下（将来実装） |
| ESTATE_SETTLED | minor / normal / major | 死亡時の wealth 分配（v0.14。家長 or wealth≥house*20% で normal、polity leader で major） |
| ESTATE_DISPUTED | minor | 複数相続人候補による争い（v0.14、記録のみ、ESTATE_SETTLED と並んで発火） |

POP_HARDSHIP / POP_PROSPERITY / POP_UNREST_RISING / POP_DECLINED は EventType 宣言のみ。実際の発火ロジックは v1.0 以降に実装する。

---

