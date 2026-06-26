# Task 9 Report: Employer Lifecycle Unbind + Reconciliation System

## Status: Complete

Commit: `808b9cd`

## What Was Built

### 1. `unbindPopsFromEmployerMut` (popMutations.ts)

Added helper that sweeps all POPs in a given holding and force-unemploys any bound to the specified `WorkplaceRef`. Uses `movePopEmploymentMut` so the size transfer goes through the proper merge-or-create path (population and money are preserved). Copies `popIds` array before iterating since the array is mutated mid-loop.

### 2. facilityMaintenanceSystem.ts hook

- Extended the mutable draft to include `popGroups` and `popIndex.byHolding` (critical: without this, the unbind would have mutated shared state from the previous tick — cross-tick contamination).
- Added `unbindPopsFromEmployerMut(ws, holdingId, { kind: 'improvement', id: imp.id })` call in `degradeHoldingImprovementMut`, in the `newLevel < 1` branch, immediately before `delete ws.holdingImprovements[imp.id]`.
- Import for `unbindPopsFromEmployerMut` added.

### 3. `popEmployerReconciliationSystem.ts` (new file)

Safety-net sweep system that:

- Does a pre-scan for any dangling employerId to avoid unnecessary draft cloning when nothing is wrong.
- Creates a mutable draft of `popGroups` + `popIndex.byHolding` + `nextPopGroupId`.
- Iterates sorted `popGroupIds` (determinism via `§13-M_det`), checks `resolveWorkplaceRef` for each bound POP, and calls `movePopEmploymentMut` for any dangling ref.
- Returns `ctx` unchanged (same reference) if nothing was dangling.

`resolveWorkplaceRef` is a local function in the system file (avoids circular dependency with WorldState that would occur if placed in `workplaceRef.ts`).

Merchant establishment hook was deliberately skipped: the normal path is `status→closed` → `employmentRebalanceSystem` force-unemploys capacity-zero slots → `cleanupMerchantSystem` deletes the entity after retention. The reconciliation system covers any remaining edge cases.

### 4. tick.ts registration

`popEmployerReconciliationSystem` registered in `scheduledSystems` immediately after `facilityMaintenanceSystem` with `intervalWeeks: 4, phaseOffsetWeeks: 0`. Integrity does not currently check employerId liveness, so interval 4 is sufficient; if integrity is extended to check this, the interval can be changed to 1.

## Tests

- **popMutations.test.ts** (3 new cases): unbind clears all bound POPs, leaves other-employer POPs untouched, no-ops on empty holding.
- **popEmployerReconciliationSystem.test.ts** (5 cases): dangling improvement/asset/merchant refs are cleared; valid employer is left untouched; all-null POPs return `ctx` unchanged (reference equality).

## Verification

- `npm run check`: 171 test files, 1621 tests — all pass, zero lint/format errors.
- CLI integrity gate: 150yr × 4 seed (1, 42, 123, 999) — all completed with no `Error:` or `INTEGRITY_VIOLATION` output.
