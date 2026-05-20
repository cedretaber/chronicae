# 年代記紀 Chronicae

Chronicae is a history-watching simulation where people, houses, and countries shape autonomous worlds.

年代記紀（クロニカエ）は、個人・家・国家が自律的に動く歴史世界を眺める、歴史鑑賞シミュレーションです。

## Repository Structure

```
chronicae/
├── docs/          # Specifications and design documents
└── prototype/     # Implementation (Vite + React + TypeScript)
    └── src/
        ├── app/   # UI layer (components, stores)
        └── sim/   # Simulation engine (types, tick systems, selectors)
```

## Prerequisites

- Node.js >= 20.19.0
- npm >= 11

## Getting Started

```bash
cd prototype
npm install
```

## Running the Dev Server

```bash
cd prototype
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser. The simulation starts automatically with the default seed.

## CLI Mode

The simulation engine can be run headlessly from the command line — useful for quick iteration and automated testing by coding agents.

```bash
cd prototype

# Default: seed "chronicae-default", 10 years
npm run cli

# Custom seed and duration
npm run cli -- --seed my-seed --years 20

# Enable integrity checks after every tick (catches data consistency bugs)
npm run cli -- --seed test-seed --years 5 --integrity-check

# NDJSON output (one JSON object per tick, for programmatic processing)
npm run cli -- --json --years 3

# Debug mode: entity IDs in events (stdout) + structured debug log (stderr)
npm run cli -- --seed test-seed --years 20 --debug 2>/tmp/debug.log

# Dump full WorldState as JSON to stderr after simulation ends
npm run cli -- --seed test-seed --years 10 --dump-world 2>world.json

# Compact summary of the final world (JSON to stdout) — useful for quick checks
npm run cli -- --seed test-seed --years 300 --digest

# Override config values for balance testing (JSON object, keys merged with defaults)
npm run cli -- --seed 1 --years 300 --digest --config '{"taxRevisionTaxChangeAmount":0.15}'

# Compare two configs side-by-side
npm run cli -- --seed 1 --years 300 --digest --config '{"taxRevisionTaxChangeAmount":0.05}' > /tmp/a.json &
npm run cli -- --seed 1 --years 300 --digest --config '{"taxRevisionTaxChangeAmount":0.15}' > /tmp/b.json &
wait && diff /tmp/a.json /tmp/b.json

# Activity Report: 4-axis observation JSON (Office churn / Faction lifecycle /
# Bailiff dynamics / population). Use "-" for stdout instead of a file path.
npm run cli -- --seed test-seed --years 300 --report report.json
npm run cli -- --seed test-seed --years 300 --report report.json --report-snapshot 50

# All options
npm run cli -- --help
```

### CLI Options

| Option | Default | Description |
|---|---|---|
| `--seed <text>` | `chronicae-default` | World generation seed |
| `--years <n>` | `10` | Number of years to simulate (1 year = 48 ticks) |
| `--weeks <n>` | — | Number of weeks (ticks) to simulate. Cannot be used with `--years`. |
| `--integrity-check` | off | Run data integrity checks after every tick |
| `--json` | off | Output NDJSON instead of human-readable text |
| `--debug` | off | Debug mode (see below) |
| `--dump-world` | off | Dump full WorldState JSON to stderr after simulation ends |
| `--digest` | off | Print a compact final-state summary as JSON to stdout (active polities, bailiff counts, event counts, etc.) |
| `--config <json>` | `{}` | Override config values with a JSON object. Unknown keys produce a warning and are ignored. |
| `--report <path>` | off | Write an Activity Report JSON to `<path>` (use `-` for stdout). See below. |
| `--report-snapshot <n>` | off | When `--report` is set, capture state snapshots every `<n>` years for time-series view |

### Debug Mode (`--debug`)

Debug mode is intended for investigating simulation bugs. It changes two things:

**1. Entity IDs in event output (stdout)**

Each event line is annotated with the IDs of all involved entities:

```
PERSON_DIED: Irmela has died at age 35. [pe-42, h-3, c-0]
HOUSE_HEAD_CHANGED: Gudrun has become the new head of House Kirchberg. [pe-67, h-3, c-0]
```

Because names in normal mode are drawn randomly, the same name can appear on multiple different people across generations, making it hard to track who is who in log output. Entity IDs (e.g. `pe-42`) are unique and stable for the lifetime of the simulation, so you can track specific individuals across events.

**2. Structured debug log on stderr**

Key simulation decisions are written to **stderr** in a tagged `key=value` format:

```
[DEBUG:SUCCESSION] year=3 week=20 house=h-3 old_head=pe-42 new_head=pe-67 type=adult
[DEBUG:BIRTH] year=3 week=1 child=pe-89 sex=male father=pe-12 status=legitimate mother=pe-34
[DEBUG:MARRIAGE] year=4 week=1 husband=pe-39 wife=pe-108
[DEBUG:HOUSE_SPLIT] year=5 week=24 house=h-3 cohesion=45 threshold=60 result=skipped reason=probability
[DEBUG:HOUSE_EXTINCT] year=10 week=8 house=h-5 type=normal receiver=h-0
[DEBUG:INTEGRITY] error="house h-3 head pe-42 is dead"
[DEBUG:YEAR] year=5 persons=87 houses=6 countries=3
```

Tags can be extracted by script: `grep '\[DEBUG:SUCCESSION\]'`, `grep '\[DEBUG:YEAR\]'`, etc.

**3. Non-fatal integrity errors**

In normal mode, any integrity violation (e.g. a house head who is dead) causes an immediate crash. In debug mode, violations are printed to **stderr** as `[DEBUG:INTEGRITY] error=...` warnings and the simulation continues, so you can observe the full state at the end of the run.

### World Dump (`--dump-world`)

Writes the complete `WorldState` as pretty-printed JSON to **stderr** after the simulation finishes. Redirect stderr to a file to capture it:

```bash
# Capture world state at year 14 with debug mode
npm run cli -- --seed chronicae-default --years 14 --debug --dump-world 2>world.json 1>/dev/null

# Inspect with any JSON tool, e.g. jq
jq '.houses["h-4"]' world.json
jq '.persons["pe-78"] | {name, alive, age, houseId}' world.json
```

Because the simulation is deterministic (same seed → same result), you can re-run with a different `--years` value to inspect the state at any point in time without replaying from scratch.

### Activity Report (`--report`)

Writes a structured JSON report that aggregates the entire run along four observation axes. Use this to spot unintended behavior, validate balance changes, and track historical trends across releases.

```bash
# Single seed, no snapshots
npm run cli -- --seed test-seed --years 300 --report report.json

# Add per-50-year snapshots for time-series inspection
npm run cli -- --seed test-seed --years 300 --report report.json --report-snapshot 50

# Send to stdout for piping (e.g. with jq)
npm run cli -- --seed test-seed --years 300 --report - | jq .bailiff
```

**Report structure (top-level keys):**

| Key | What it contains |
|---|---|
| `meta` | seed, years, final year/week, plus the key config parameters used (so the report is self-describing) |
| `eventCounts` | Total count per `EventType` for the run (e.g. `OFFICE_ASSIGNED`, `FACTION_FOUNDED`) |
| `office.aggregateByRole` | Per-role office churn: `assignments` / `revokes` / `termEnds` |
| `office.polity[]` | Per-Polity office assignment distribution, holder-house breakdown, and `ownerHouseHoldRatio` (fraction of assignments going to the current ownerHouse) |
| `office.house[]` | Per-House office assignment summary |
| `faction.aggregate` | Faction totals: formed, dissolved, leader changes, recruitments, bankruptcies, avg lifespan |
| `faction.factions[]` | Per-Faction lifecycle: founding/dissolution years, recruitments, abandonments, unique recruit houses, final member count |
| `bailiff` | Final normal/placeholder counts + total appointments and source attribution (ownerHouse vs other) |
| `population` | Final living counts (normal vs placeholder), total births / deaths / marriages / faded-from-history events |
| `snapshots[]` | Optional time-series: per-snapshot Polity offices, Faction member distribution, Bailiff counts |

**Example inspection with `jq`:**

```bash
# How many normal bailiffs at the end, by source?
jq '.bailiff | {final_normal: .finalNormalCount, final_placeholder: .finalPlaceholderCount, source: .appointmentBySource}' report.json

# Faction lifespan distribution
jq '.faction.factions | map(.lifespanYears) | sort | reverse | .[0:10]' report.json

# Per-Polity ownerHouse hold ratio (high = ownerHouse-dominated, low = distributed)
jq '.office.polity | map({id: .polityId, rank, owner_ratio: .ownerHouseHoldRatio})' report.json

# Snapshot at year 150: who holds offices in each Polity
jq '.snapshots[] | select(.year == 150) | .polities[] | {polity: .name, rank, offices}' report.json
```

The report is generated purely from the event log and the final state, so its overhead is small (~150–200 KB per 300-year run). Snapshots add roughly `snapshots × active_polities × roles` of data — keep `--report-snapshot` ≥ 20 to avoid bulk on long runs.

### Config Override (`--config`)

Override any simulation config value without editing code. Useful for balance testing — run the same seed with different parameters and compare results.

```bash
# Increase tax change amount from default 5% to 15%
npm run cli -- --seed 1 --years 300 --digest --config '{"taxRevisionTaxChangeAmount":0.15}'

# Multiple overrides at once
npm run cli -- --seed 1 --years 300 --digest --config '{"taxRevisionTaxChangeAmount":0.15,"taxRevisionMinRate":0.10}'
```

The value must be a valid JSON object. Keys are shallow-merged with `defaultConfig`: specified keys override defaults, unspecified keys keep their default values. Unknown keys produce a warning on stderr and are ignored (helps catch typos).

To see all available config keys and their defaults, refer to `prototype/src/sim/config/defaultConfig.ts`.

## Development

### Check (typecheck + lint + format + test)

```bash
cd prototype
npm run check
```

This must pass with zero errors before merging any change.

### Individual Commands

```bash
npm run typecheck    # TypeScript type checking
npm run lint         # ESLint
npm run format       # Prettier (write)
npm run test         # Vitest (run once)
npm run test:watch   # Vitest (watch mode)
```

### Production Build

```bash
cd prototype
npm run build
```

Output goes to `prototype/dist/`.

### Preview Production Build

```bash
cd prototype
npm run preview
```

## Architecture Notes

- **Simulation layer** (`src/sim/`) is pure TypeScript with no browser dependencies. All state is immutable; each tick system takes a `TickContext` and returns a new one.
- **UI layer** (`src/app/`) connects to the simulation via a Zustand store (`simulationStore.ts`) and has no back-reference into the sim layer's internals.
- **Path alias**: `@sim/*` → `src/sim/*`, `@/*` → `src/*`
- **Strict TypeScript**: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `strict` are all enabled.
