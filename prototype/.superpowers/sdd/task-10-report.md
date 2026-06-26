# Task 10 Report: Integrity Checks, UI Updates, Final Gate

## Status: Complete

Commits: `fc94d21` (10a integrity) + `ed8ff6c` (10b UI/CLI)

## What Was Built

### Task 10a — Integrity Checks (`integrityCoreChecks.ts` + `tick.ts`)

**New local helper `resolveEmployerHoldingId`**
Added at module level in `integrityCoreChecks.ts` — given a `WorkplaceRef`, looks up the entity in `state.realEstateAssets` / `state.holdingImprovements` / `state.merchantCompanyEstablishments` and returns its `holdingId`, or `null` if the entity does not exist.

**Check 3 (shape) extended**
Refactored the existing shape check into an `empShapeValid` boolean and added `typeof id === 'string'` to the shape test. This catches malformed refs that pass the structural `'id' in empId` guard but have a non-string id.

**Check 3b — entity existence (NEW)**
If `empId !== null && empShapeValid`, call `resolveEmployerHoldingId`. If it returns `null`, the referenced entity does not exist in state → `INTEGRITY_VIOLATION`.

**Check 3b — holding consistency (NEW)**
If the entity exists but `entity.holdingId !== pop.holdingId`, the POP is bound to an employer in a different holding → `INTEGRITY_VIOLATION`.

**Reconciliation interval 4 → 1** (`tick.ts`)
Task 9 flagged this: "if integrity is extended to check this, the interval can be changed to 1." The year-end integrity check runs at week 48; the old interval=4 safety net could last fire at week 45, leaving a 3-week gap. Setting interval=1 ensures no dangling ref survives to year-end.

### Task 10b — UI Updates

**i18n** (`src/i18n/locales/{ja,en}/ui.yaml`)
Added three keys under `detail.province`:
- `pop_employer_asset`: 不動産 / Real Estate
- `pop_employer_improvement`: 施設 / Improvement
- `pop_employer_merchant`: 商会店舗 / Merchant Shop

**PopGroupDetail.tsx**
The employment badge now shows the employer kind name (`pop_employer_<kind>`) instead of the generic 就業/Employed label. Unemployed POPs still show pop_unemployed.

**HoldingDetail.tsx**
Same employer kind label per POP row in the POP list section. Removed the now-unused `isEmployed` import (would have caused `noUnusedLocals` error).

**RealEstateDetail.tsx**
Replaced the proportional-approximation approach (`holdingEmp × assetCap / holdingCap`) with exact binding via `getWorkplaceEmployedPopSizeByType(state, holdingId, { kind: 'asset', id: asset.id }, popType)`. Fill rate is now per-asset (`employed / assetCap`) rather than the holding-wide rate. Same change applied to `facilityFill`. Removed the unused `getHoldingPopTypeCapacity` import.

**analyzePop.ts**
Added `byEmployerKind: Map<'asset'|'improvement'|'merchant', number>` to `collectPopStats`. The `printFinalBreakdown` function now prints an `=== Employed by Employer Kind ===` section with count and % of employed for each kind.

**WindowManager.tsx**
No pop employment code existed; no changes made.

## Verification

- `npm run check`: 171 test files, 1621 tests — all pass, zero lint/format errors.
- CLI integrity gate: 150yr × 4 seeds (1, 42, 123, 999) — all completed with no `Error:` or `INTEGRITY_VIOLATION` output.
