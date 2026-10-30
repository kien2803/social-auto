# morphicons agent skill

A portable, performance-first skill package containing the full supplied morphicons documentation, split into small topic files so an agent can load only what it needs.

## What changed from the React-only package

This package now covers every documented layer:

- React
- Vue
- Svelte
- React Native
- vanilla DOM driver
- pure core APIs
- icon compatibility
- architecture and math
- runtime performance and bundle size
- playground, development, credits, and license

The root `SKILL.md` remains small. It routes the agent to selected references and makes performance review mandatory.

## Token-saving workflow

```bash
node scripts/select-references.mjs \
  --query "Add a drag-controlled menu morph in React" \
  --files "src/MenuButton.tsx"
```

Add `--cat` to emit a ready-to-use context pack. Add `--json` for machine-readable output.

The selector uses task text, file extensions, imports, and performance signals. It defaults to a small file count and never loads the whole documentation unless `--all` is explicitly passed.

## Performance workflow

```bash
node scripts/performance-audit.mjs src
```

The audit is intentionally heuristic. It flags likely problems such as forced remount keys, controlled mode mixed with springs, many morphs in one file, repeated fitting, or high-frequency controlled progress. It cannot measure CPU, GPU, paint, or frame time; use a profiler for those.

## Package structure

- `SKILL.md` — minimal agent instructions
- `manifest.json` — machine-readable topic map and signals
- `references/index.md` — human routing table
- `references/frameworks/` — one file per framework binding
- `references/bindings/` — DOM driver
- `references/core/` — pure API, architecture, and granular math
- `references/compatibility/` — icon geometry rules
- `references/performance/` — decisions, profiling, source benchmarks, and size
- `references/operations/` — playground, development, credits, and license
- `scripts/select-references.mjs` — context selector/context packer
- `scripts/performance-audit.mjs` — static performance review helper
- `hooks/preflight.example.sh` — generic hook example

## Installation

Copy the entire `morphicons-skill` directory into the shared skills location recognized by the agent platform. Keep all relative paths intact.
