# Icon library compatibility

> Source-derived compatibility rules, fitting guidance, and known compatible packs.

## Icon library compatibility

morphicons has no per-library adapters — any icon set that meets these requirements works out of the box:

1. **Stroke-drawn icons.** The geometry must be the stroked centerline (`fill="none"`, color via `stroke`). The whole pipeline — resampling, correspondence, in-flight polylines — assumes strokes; filled or outlined-fill glyphs (Material Symbols, Bootstrap Icons, Remix Icon, Phosphor, Heroicons *solid*) parse fine but won't read correctly in transit.
2. **Geometry available as data.** Either a raw `d` attribute per icon, or a `[tag, attrs][]` node list (Lucide's IconNode shape) using only `path`, `line`, `circle`, `ellipse`, `rect`, `polyline`, `polygon`. No `<g>` wrappers and no `transform` attributes — coordinates must be literal. Any other tag throws a clear error.
3. **A shared coordinate space per pair.** Both endpoints of a morph must live on the same grid. Lucide, Tabler, Heroicons and Iconoir all draw on 24×24 — that's why cross-library morphs just work. For a pack on another canvas (Heroicons *solid* on 20, Carbon on 32, Teenyicons on 15), re-grid it once with `fitIcon`:

   ```ts
   import { fitIcon } from "morphicons";

   const search = fitIcon(carbonSearch, 32);   // 32×32 → the 24 grid
   const bell   = fitIcon(teenySmallBell, 15); // also "0 0 15 15" or [0, 0, 15, 15]
   ```

   It returns a plain `d`, so it goes anywhere an icon is accepted. Call it at module scope, not per render. Skipping it doesn't throw — Procrustes is similarity-invariant, so the grid mismatch never reads as false rotation; it lands in σ as an unwanted zoom, and the target draws outside the canvas. The React, Vue and Svelte bindings default to `viewBox="0 0 24 24"`, overridable via props.
4. **Uniform stroke.** Cosmetic rather than structural: a consistent stroke width and round caps/joins make in-flight shapes look native. These live on the `<svg>`, not in morphicons.

Beyond the libraries in the playground, sets known to qualify on the 24×24 grid — no fitting needed: **Heroicons** (outline style), **Iconoir** (1.5px stroke), **Akar Icons**, **Untitled UI** and **Hugeicons** (stroke style). Off-grid packs work through `fitIcon`: **Teenyicons** (15×15), **Carbon** (32×32), **Heroicons solid** (20×20).

This also covers the [shadcn registry](https://www.shadcn.io/icons), which re-publishes 200+ icon libraries as React components with an inline `<path d>` — pass that `d` straight in, adding `fitIcon` when the pack's `viewBox` isn't 24.
