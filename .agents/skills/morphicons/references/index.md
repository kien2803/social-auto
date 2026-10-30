# Reference routing index

Start with `references/performance/decision-guide.md` for any implementation or review. Then load only the primary API file and one supporting file unless the task clearly needs more.

| Task signal | Primary file | Add when needed |
|---|---|---|
| React, Next.js, JSX/TSX, `morphicons/react` | `frameworks/react.md` | `shared-lifecycle.md`, `compatibility/icon-libraries.md` |
| Vue, Nuxt, `.vue`, `morphicons/vue` | `frameworks/vue.md` | lifecycle, compatibility |
| Svelte, SvelteKit, `.svelte`, `morphicons/svelte` | `frameworks/svelte.md` | lifecycle, compatibility |
| React Native, Metro, `react-native-svg` | `frameworks/react-native.md` | lifecycle, compatibility, CPU/GPU guide |
| `createMorph`, path element, vanilla browser | `bindings/dom.md` | lifecycle, performance runtime |
| `resampleIcon`, `buildPlan`, custom renderer | `core/api.md` | architecture or one math file |
| Bad morph, wrong rotation, filled icon, viewBox mismatch | `compatibility/icon-libraries.md` | correspondence, alignment, interpolation |
| Late icon, mixed modes, controlled re-entry | `shared-lifecycle.md` | framework file |
| CPU, GPU, FPS, jank, many icons, scroll/drag | `performance/cpu-gpu-guide.md` | runtime benchmark, selected API file |
| Bundle size | `performance/size.md` | overview/install |
| Parser, curves, SVG primitives | `core/math/01-normalization.md` | serialization |
| Rounded corners, point sampling | `core/math/02-resampling.md` | correspondence |
| Wrong pairing, closed-path start, subpath count | `core/math/03-correspondence.md` | alignment |
| Rotation/scale detection, residual | `core/math/04-alignment.md` | interpolation |
| Shrinking/shearing mid-flight | `core/math/05-polar-interpolation.md` | alignment |
| Hydration byte mismatch, canonical path | `core/math/06-serialization.md` | framework SSR notes |
| Spring tuning, interruption velocity | `core/math/07-spring.md` | runtime benchmark |
| Repository development or playground | `operations/playground-development.md` | size |

## Context limits

- Initial load: performance decision guide + one primary file.
- Normal maximum: three reference files.
- Deep algorithm work: add only the relevant math file, not the entire math directory.
- Full documentation load: only for documentation maintenance or broad architecture review.
