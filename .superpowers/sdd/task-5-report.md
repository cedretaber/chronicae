# Task 5 Report — Per-Employer Wage Carve

**Status: DONE**

## Commit

- `75dfed6` feat(v063): Task 5 — per-employer wage carve

## Changes Made

### `src/sim/tick/resourceEconomySystem.ts`

**Site 1 — Asset production wage (around L600-615):**
- Added `workplaceRefKey` to the import from `workplaceRef`
- Pre-computed `assetKey = workplaceRefKey({ kind: 'asset', id: ar.assetId })` before the inner loop
- Replaced `!isEmployed(pop)` check with `workplaceRefKey(pop.employerId) !== assetKey`
- Result: each asset's wage now mints only to the POP bound to that specific asset

**Site 2 — Facility supplement (around L638-692):**
- Replaced `facCapByPopType: Map<PopType, number>` (aggregate across all improvements) with `impSlots: { impKey, popType, cap }[]` (per-improvement slot tracking)
- For each improvement, compute `impKey = workplaceRefKey({ kind: 'improvement', id: impId })` and push per-slot entries
- Inner mint loop now matches on `impKey` instead of `isEmployed` — each improvement's bound POP receives its proportional share
- Budget math (supplementByStratum = prodWageByStratum × facCap/prodCap) is preserved unchanged; only the mint routing changed

**Site 3 — Upper dividend:** No change. Upper dividends go to all employed upper POPs in the holding regardless of employer (by design).

### `src/sim/tick/merchantCompanyAccountingSystem.ts`

**Site 4 — Merchant wage:**
- Added `MerchantCompanyEstablishmentId` to the ids import
- Replaced `isEmployed` import with `workplaceRefKey`
- Added `estId: MerchantCompanyEstablishmentId` parameter to `mintToEmployed`
- Implemented per-establishment lookup: `estKey = workplaceRefKey({ kind: 'merchant', id: estId })`
- Updated both call sites (wage and upper dividend) to pass `est.id`

## Test Results

```
Test Files  169 passed | 1 skipped (170)
     Tests  1596 passed | 22 skipped | 1 todo (1619)
```

All non-skipped tests pass. The skipped tests (22) are pre-existing Phase 3-4 deferred tests that were already skipped before this task.

`npm run check` passes (typecheck + lint + format + test).

## carve==mint Invariant

Maintained: if no POP is bound to an employer+popType pair (vacancy), no match is found and `minted` stays 0. `wageShare = minted` is set only to what was actually minted. The owner is never carved when there's no recipient.
