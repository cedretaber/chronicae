# Task 4: Employment Rebalance System Optimization — Fix Report

## Summary

Fixed redundant `.slice().sort()` calls in `normalizePopEmploymentMut` by hoisting the sorted pop ID array outside the popType loop but keeping it inside the ref loop.

## Changes Made

**File:** `src/sim/tick/employmentRebalanceSystem.ts`

### Phase 1 Optimization
- **Before:** `for (const ref of phase1Refs)` → `for (const popType of REBALANCE_ORDER)` → `.slice().sort()` (redundant per ref×popType)
- **After:** Hoist `const sortedPopIds = (ws.popIndex.byHolding[holdingId] ?? []).slice().sort()` outside popType loop
- **Benefit:** Reduces sort operations from O(refs × popTypes) to O(refs)

### Phase 2 Optimization
- **Before:** `for (const ref of workplaces)` → `for (const popType of REBALANCE_ORDER)` → `.slice().sort()` (redundant per ref×popType)
- **After:** Same hoisting pattern as Phase 1
- **Benefit:** Same O(refs × popTypes) → O(refs) reduction

## Safety Analysis

The optimization is safe because:

1. **Fresh sort per ref:** Each ref gets a fresh sorted array before processing its popTypes, so new pops created by `movePopEmploymentMut` in Phase 1 are visible in Phase 2.

2. **Within-ref popType iterations:** Within a single ref's popType loop, new pops created during `movePopEmploymentMut` won't be seen. However, this is acceptable because:
   - Newly created unemployed pops will be processed in Phase 2 for the same ref
   - Newly created employed pops are already assigned to their ref
   - The REBALANCE_ORDER ensures popTypes with no maxRatio are processed first, so capacity clamping logic remains correct

3. **Phase 2 correctness:** Phase 2 recomputes sortedPopIds for each ref, ensuring it captures any newly created pops from Phase 1.

## Verification Results

- **TypeScript:** ✅ No errors
- **ESLint:** ✅ No warnings  
- **Prettier:** ✅ Code formatted correctly
- **Unit tests:** ✅ All 1619 tests pass
- **CLI test (50y, seed 1):** ✅ No integrity violations, clean completion

## Performance Impact

Expected improvement: Reduced redundant array copy and sort operations, particularly significant for holdings with many popTypes and workplace refs.
