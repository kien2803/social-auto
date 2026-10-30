# Architecture

> Source-derived layer architecture and plan pipeline.

## Architecture

```
┌─────────────────────────────────────────────┐
│  bindings   react · vue · svelte · rn      │  thin: ref + createMorph
├─────────────────────────────────────────────┤
│  drivers    dom (setAttribute + rAF)        │  singleton scheduler
├─────────────────────────────────────────────┤
│  core       parse → normalize → resample    │  pure functions,
│             → match → align → plan          │  NO DOM, produce
│             → interpolate → serialize       │  `d` strings and numbers
│             + spring                        │
└─────────────────────────────────────────────┘
```

The hard rule: **the core never touches the DOM**. Pure functions consume icon data and produce `d` strings. Direct consequence: the React Native binding over `react-native-svg` is just another adapter, not a rewrite — it reuses the dom driver verbatim through a `setNativeProps` shim. One package with subpath exports (`.` core, `./dom`, `./react`, `./react-native`, `./vue`, `./svelte`), ESM only, `sideEffects: false`.

The plan is the central artifact:

```
icon A ─┐
        ├→ normalize → resample → match → align → PLAN ─→ interpolate(t) → serialize → d
icon B ─┘                                           ↑
                                        cacheable, serializable
```

`plan()` accepts any list of sampled subpaths — not just canonical icons — which is what makes interruptions free: the currently rendered buffers are a valid morph source.
