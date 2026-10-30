# Performance decision guide

Read this file before adding or changing morphicons code.

## 1. Start at the highest suitable layer

Use a framework binding for ordinary UI. Its internal animation writes the path outside the framework render cycle, so moving to the DOM driver does not automatically make an uncontrolled transition faster.

Use controlled mode only when an external interaction owns progress. Controlled progress normally causes the parent/framework to provide new values, so frequent updates can create application-level render or commit work even though the morph driver itself is efficient.

Use the DOM driver when direct path ownership is architecturally appropriate, or when profiling shows framework updates are the bottleneck for high-frequency scrubbing. Use the pure core for custom renderers, preprocessing, or algorithm work—not as a reflexive optimization.

## 2. Classify the workload

These thresholds are heuristics, not library guarantees:

- **Light:** a few icons, short state transitions, little overlap.
- **Moderate:** repeated transitions, gesture control, or tens of simultaneously active icons.
- **Heavy:** many concurrent morphs, continuous scroll/pointer-driven progress, large rendered SVGs, or additional filters/effects.

Moderate and heavy workloads require a runtime profile on a representative low-to-mid-tier device.

## 3. Preserve the library's fast paths

- Keep icon data references stable so normalization and plan caches can hit.
- Import static icon data at module scope.
- Run `fitIcon` at module scope, not during render.
- Prefer uncontrolled `icon` changes for normal toggles.
- Do not force remounts with `key`; remounting discards continuity and cached state.
- Avoid animating offscreen or invisible icons.
- Keep the number of simultaneously active icons proportional to actual visual value.
- Preserve reduced-motion behavior.

## 4. Do not confuse CPU, rendering, paint, and GPU work

The supplied project documentation reports plan timings, allocation behavior, reference caches, and a singleton `requestAnimationFrame`. Those are CPU/runtime properties.

SVG path `d` changes may involve browser path processing, rendering, and paint. Whether work is GPU-accelerated, CPU-bound, or split varies by browser, operating system, SVG size, effects, and hardware. The source provides no GPU benchmark.

A valid performance report states:

- scenario and number of active icons;
- uncontrolled, controlled, or imperative mode;
- browser/runtime and device;
- frame rate or long-frame evidence;
- scripting, rendering, and paint observations;
- React/Vue/Svelte commit activity where applicable;
- before/after measurements.

## 5. Fix in bottleneck order

1. Remove unnecessary simultaneous animation.
2. Replace controlled progress with uncontrolled state when external scrubbing is not required.
3. Stabilize icon data and hoist fitting/conversion.
4. Batch external progress updates to one per animation frame.
5. Stop updates when the icon is offscreen or the interaction is idle.
6. Remove expensive SVG filters, large shadows, blur, or oversized rendering around the icon.
7. If framework commits dominate, test the DOM driver for that isolated high-frequency path.
8. If path paint dominates, reduce active count or visual complexity; changing framework layers will not solve paint cost.

## 6. Verification command

Run the static audit first:

```bash
node scripts/performance-audit.mjs src
```

Then profile the actual interaction. Static analysis cannot establish CPU or GPU cost.
