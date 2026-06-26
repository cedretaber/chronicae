# SDD Progress Ledger\n\nBranch: feat/v063-pop-employer-binding\nBase: 9b9754b (main)\nPlan: /home/cedretaber/.claude/plans/generic-yawning-lake.md\n
Task 1: complete (commits 9b9754b..3e4a4d5, review clean)
Task 2: complete (commits 3e4a4d5..933fe6f, review clean)
  Note: resolveWorkplaceRef deferred to Task 9 (circular dependency avoidance)
  Minor: popGroupChangeKey test non-null coverage deferred to Task 3+
  Minor: 2 popMigrationSystem tests skipped (Phase 3-4 re-enable)
Task 3: complete (commits 933fe6f..e64bce9, review clean)
Task 4: complete (commits e64bce9..92474e4, review approved + perf fix)
  Fixed: redundant inner sort hoisted per-employer (92474e4)
  Minor: hardcoded createPopGroupId(100) in vanished-employer test (deferred)
Task 5: complete (commit 75dfed6, npm run check green)
  Site 1: asset wage → workplaceRefKey({kind:'asset', id:ar.assetId}) match
  Site 2: facility supplement → per-improvement impSlots loop, impKey match
  Site 4: merchantCompanyAccountingSystem mintToEmployed → per-estId match
Task 5: complete (commits 92474e4..a99e84b, review approved after findBoundPop fix)
Task 6: complete (no additional commits — Task 2 置換で完了済み、構造変更なし)
Task 7: complete (no additional commits — Task 2 置換で完了済み、構造変更なし)
  Note: 22 skipped tests remain (Phase 3-4 テスト re-enable は Task 8+ で実施)
Task 8: complete (commits a99e84b..5fc985a, review clean)
  Re-enabled: ~15 Phase 3-4 skipped tests
  Minor: computeAssetPopTypeCapacityTerm per-slot fragility (no current bug, noted for future)
