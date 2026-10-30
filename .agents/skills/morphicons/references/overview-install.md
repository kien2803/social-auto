# Overview and installation

> Source-derived. Includes project overview, rationale, installation, and peer requirements.

<p align="center">
  <a href="https://www.morphicons.com">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.svg">
      <img src="assets/logo-light.svg" alt="morphicons" width="96">
    </picture>
  </a>
</p>

<h1 align="center">morphicons</h1>

<p align="center">
  <a href="https://www.morphicons.com"><strong>morphicons.com</strong></a> — live playground
</p>

<p align="center">
  <a href="https://github.com/sponsors/guillermolg00">
    <img src="https://img.shields.io/badge/%E2%98%95%20Buy%20me%20a%20coffee-EA4AAA" alt="Buy me a coffee — sponsor morphicons on GitHub Sponsors">
  </a>
</p>

Universal morphing for stroke-based icons (Lucide, Tab
ler, Heroicons, Iconoir, or your own paths): **any icon morphs into any other** with spring physics. Rotations are never declared by hand — they emerge from the math (2D Procrustes + polar interpolation). Zero runtime dependencies.

```tsx
import { MorphIcon } from "morphicons/react";
import { Menu, X } from "lucide"; // data, not components

<button onClick={() => setOpen(o => !o)} aria-expanded={open}>
  <MorphIcon icon={open ? X : Menu} />
</button>
```

That's the whole thing. No wrappers, no `AnimatePresence`, no keys, no from/to pairs, no configuration. State lives outside; the animation is an implementation detail the component picks up when the prop changes.

## Why

The usual icon morphs either interpolate raw coordinates (shapes shrink and shear in transit) or require hand-declaring "rotation groups" per icon pair. morphicons solves the optimal similarity between shapes in closed form and interpolates it in its natural space: if a pair is congruent under rotation, it **rotates**; if not, it morphs in the aligned frame. arrow-right → arrow-down yields θ = 90° on its own, without anyone declaring it.

## Install

```bash
bun add morphicons        # or npm install / pnpm add
```

ESM only. `react` (>= 18), `vue` (>= 3.3), `svelte` (>= 5) and `react-native` (>= 0.71) + `react-native-svg` (>= 14) are optional peers — only needed for `morphicons/react`, `morphicons/vue`, `morphicons/svelte` and `morphicons/react-native`.

## Usage
