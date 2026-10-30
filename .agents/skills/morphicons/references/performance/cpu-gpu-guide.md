# CPU and GPU profiling guide

This guide adds performance-engineering practice around the source documentation. The profiling procedure and remediation advice are general guidance; they are not benchmark claims from the morphicons project.

## What the supplied docs establish

Read `runtime-source.md` for exact source claims. In summary, the project documents:

- sub-millisecond plan construction in its reported cases;
- preallocated numeric buffers with only the path string allocated per frame;
- reference-based normalization and plan caches;
- one global animation-frame scheduler for active instances;
- framework/native path mutation outside the component render for internal animation.

These facts reduce likely JavaScript overhead, but they do not guarantee an application's frame rate.

## Where CPU work can still come from

- Creating plans for many new icon pairs at once.
- Interrupting many animations repeatedly, which rebuilds plans from intermediate geometry.
- Controlled progress that causes frequent framework renders or commits.
- Recreating icon arrays, path strings, or fitted icons so reference caches cannot hit.
- Application code around the icon: event handlers, layout, state propagation, lists, and effects.
- Browser SVG path processing and paint preparation.

## Where rendering or GPU pressure can come from

- Large on-screen SVG dimensions.
- Many simultaneously changing paths.
- CSS/SVG filters, blur, masks, shadows, blending, or opacity layers around the icon.
- Transforming or compositing large ancestor layers.
- High device-pixel ratios and constrained mobile GPUs.

Do not assume path morphing is a cheap compositor-only animation. Changing `d` is geometry animation, not merely a CSS transform.

## Measurement protocol

1. Create a static baseline using the same icon count and layout.
2. Record the real transition with production settings.
3. Test representative counts such as 1, 10, and the expected maximum.
4. Test a low-to-mid-tier device or CPU-throttled profile.
5. Inspect main-thread scripting, framework commits, style/layout, rendering, and paint.
6. Inspect the GPU/rendering track when the browser exposes it, but treat it as evidence only for that browser/device.
7. Repeat with reduced motion and with expensive visual effects disabled.
8. Compare medians across multiple runs rather than one trace.

## Diagnosis matrix

| Evidence | Likely issue | First response |
|---|---|---|
| Framework commits every pointer/scroll event | Controlled-mode update path | Batch to rAF; narrow state scope; consider DOM driver only if commits remain dominant |
| Scripting spikes when new pairs start | Planning or recreated inputs | Stabilize icon references; precompute fitting; avoid starting many unique pairs simultaneously |
| Paint/rendering dominates with low scripting | SVG/path or visual effects | Reduce active count, display size, filters, blur, and layer area |
| Jank only during rapid retargeting | Too many interruptions/application events | Coalesce intent; avoid redundant state updates; keep latest target |
| Memory/GC spikes | Recreated data or surrounding app allocations | Hoist icon data; avoid per-frame arrays/objects in app code |
| Good desktop profile, bad mobile profile | Device/rendering limits | Test lower concurrency, reduced motion, or instant swaps for nonessential animation |

## Framework-specific notes

### React

Uncontrolled `icon` transitions are the default. For controlled progress, keep rapidly changing state as local as possible. Do not put scroll/pointer progress in a broad context that rerenders an application subtree.

### Vue

Keep controlled progress scoped to the smallest component. Avoid deep reactive objects for a scalar animation progress value.

### Svelte

Keep the progress dependency local. Avoid unrelated reactive work in the same update path.

### React Native

Profile both JavaScript and UI/render threads. The binding writes through `setNativeProps`, but surrounding state updates and native SVG rendering can still dominate.

### DOM driver

Use `seek` or `progress` for direct scrubbing. Batch event input to animation frames and call `destroy()` during teardown.

## Reporting template

```text
Scenario:
Platform/device:
API and mode:
Active icon count:
Profile evidence:
Main bottleneck:
Change made:
Before:
After:
Remaining risk:
```
