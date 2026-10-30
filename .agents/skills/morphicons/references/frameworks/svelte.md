# Svelte binding

> Source-derived Svelte API surface and behavior.

### Svelte — same three modes

```svelte
<script lang="ts">
  import { MorphIcon, type MorphHandle } from "morphicons/svelte";
  import { Menu, X, Check } from "lucide"; // data, not components

  let open = $state(false);
  let morph = $state<MorphHandle>();
  // morph?.morphTo(Check)  → animates
  // morph?.set(X)          → jumps without animating
</script>

<!-- 1. Uncontrolled (90% of uses): change the prop and morphicons animates -->
<MorphIcon icon={open ? X : Menu} spring="snappy" />

<!-- 2. Controlled (gestures, scroll): explicit progress, no spring -->
<MorphIcon from={Menu} to={X} progress={dragProgress} />

<!-- 3. Imperative (sequences): bind:this → morphTo / set -->
<MorphIcon bind:this={morph} icon={Menu} />
```

Same surface again: presentation props, `class`/`style`/rest-attr fall-through — fully typed via `svelte/elements`, so SVG attrs, events and ARIA autocomplete and typos fail the build, like lucide-svelte — the same accessibility defaults and the same clean SSR — works with SvelteKit out of the box. Svelte 5 (runes); the component ships as `.svelte` source and your bundler compiles it via the `svelte` export condition, like every Svelte library.
