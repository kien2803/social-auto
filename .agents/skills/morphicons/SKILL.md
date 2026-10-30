---
name: morphicons
description: Performance-first implementation and review guidance for morphicons across React, Vue, Svelte, React Native, the DOM driver, and the pure core. Routes agents to only the relevant references instead of loading the complete documentation.
---

# Morphicons skill

Use this skill when implementing, reviewing, debugging, or optimizing morphicons.

## Mandatory operating rule

**Do not load every reference file.** Select the smallest relevant context first.

When shell access is available, run:

```bash
node scripts/select-references.mjs \
  --query "<task description>" \
  --files "<comma-separated changed or relevant files>" \
  --imports "<comma-separated relevant imports>"
```

To print the selected documents as one bounded context pack:

```bash
node scripts/select-references.mjs \
  --query "<task description>" \
  --files "src/IconToggle.tsx" \
  --cat --max-chars 24000
```

Without shell access, use `references/index.md` and choose at most three initial files.

## Performance is a release requirement

For every code change involving morphicons:

1. Read `references/performance/decision-guide.md`.
2. Choose the highest-level API that meets the requirement without adding avoidable render work.
3. Run `node scripts/performance-audit.mjs <paths...>` when source files are available.
4. Separate documented library behavior from measured application behavior.
5. Never claim low CPU use, GPU acceleration, or a performance improvement without profiling the affected flow.

The attached project documentation contains CPU-side planning, allocation, caching, scheduler, and bundle-size data. It does **not** contain browser GPU benchmarks. Treat GPU behavior as device/browser dependent and measure it.

## API selection order

Choose the narrowest suitable layer:

1. **Framework binding** for normal component UI:
   - React: `morphicons/react`
   - Vue: `morphicons/vue`
   - Svelte: `morphicons/svelte`
   - React Native: `morphicons/react-native`
2. **DOM driver** for direct path control outside a framework component, or when profiling proves framework render/commit overhead is the bottleneck for high-frequency scrubbing.
3. **Pure core** for custom renderers, preprocessing, plan inspection, or environments that must not touch the DOM.

Do not drop to DOM or core merely because they sound faster. The framework bindings already mutate the path outside the framework render loop for their internal animation. Use lower layers only for a concrete architectural need or measured bottleneck.

## Mode selection

All framework bindings expose the same three modes:

- **Uncontrolled** `icon`: default for state-driven transitions.
- **Controlled** `from` + `to` + `progress`: gestures, scroll, or an external timeline.
- **Imperative** `morphTo` / `set`: explicit sequences.

Read `references/shared-lifecycle.md` whenever modes are mixed, icons arrive late, or controlled mode is entered/exited.

## Required checks

Before finishing:

- Confirm the import matches the target platform.
- Confirm icon geometry is stroke-based and compatible.
- Hoist converted or fitted icon data; do not recreate it per render.
- Prefer uncontrolled mode unless an external signal truly owns progress.
- Preserve accessibility and reduced-motion behavior.
- Check SSR/hydration for web frameworks.
- Check Metro package exports and native accessibility for React Native.
- Profile heavy, continuous, or many-icon scenarios.
- Report what was measured, the device/browser/runtime, and the before/after result.

## Context map

- Routing index: `references/index.md`
- Performance decision gate: `references/performance/decision-guide.md`
- Static audit: `scripts/performance-audit.mjs`
- Machine-readable routing map: `manifest.json`
- Original documentation split by topic: `references/**`
