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

# All options
npm run cli -- --help
```

### CLI Options

| Option | Default | Description |
|---|---|---|
| `--seed <text>` | `chronicae-default` | World generation seed |
| `--years <n>` | `10` | Number of years to simulate |
| `--integrity-check` | off | Run data integrity checks after every tick |
| `--json` | off | Output NDJSON instead of human-readable text |
| `--debug` | off | Debug mode (see below) |
| `--dump-world` | off | Dump full WorldState JSON to stderr after simulation ends |

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
[DEBUG:SUCCESSION] year=3 month=5 house=h-3 old_head=pe-42 new_head=pe-67 type=adult
[DEBUG:BIRTH] year=3 month=1 child=pe-89 sex=male father=pe-12 status=legitimate mother=pe-34
[DEBUG:MARRIAGE] year=4 month=1 husband=pe-39 wife=pe-108
[DEBUG:HOUSE_SPLIT] year=5 month=6 house=h-3 cohesion=45 threshold=60 result=skipped reason=probability
[DEBUG:HOUSE_EXTINCT] year=10 month=2 house=h-5 type=normal receiver=h-0
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
