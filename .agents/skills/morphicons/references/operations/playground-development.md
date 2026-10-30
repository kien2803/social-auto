# Playground, development, credits, and license

> Source-derived project operations and attribution.

## Playground

```bash
bun run play   # → http://localhost:3000
```

38 real icons from Lucide (IconNode imported from the package), Feather and Tabler; per-pair readout of the detected similarity (θ, σ, residual), polar/linear modes for comparison, spring presets and a t scrubber. Feather/Tabler data is extracted from the npm packages with `bun playground/extract-vendor-icons.mjs`.

## Development

```bash
bun test          # 156 tests / ~13,700 asserts
bun run typecheck # strict ×6: core+dom without lib DOM, playground, react, react-native, vue, svelte
bun run format    # biome
bun run build     # tsdown → dist/ + scripts/build-svelte.ts (svelte entry)
bun run size      # size gates
```

Icons shown in the playground belong to their authors: [Lucide](https://lucide.dev) (ISC), [Feather](https://feathericons.com) (MIT), [Tabler](https://tabler.io/icons) (MIT).

---

MIT © [Guillermo](https://guillermolg.com) — made by [guillermolg.com](https://guillermolg.com)
