# Vue binding

> Source-derived Vue API surface and behavior.

### Vue — same three modes

```vue
<script setup lang="ts">
import { ref } from "vue";
import { MorphIcon, type MorphHandle } from "morphicons/vue";
import { Menu, X, Check } from "lucide"; // data, not components

const open = ref(false);
const morph = ref<MorphHandle | null>(null);
// morph.value?.morphTo(Check)  → animates
// morph.value?.set(X)          → jumps without animating
</script>

<template>
  <!-- 1. Uncontrolled (90% of uses): change the prop and morphicons animates -->
  <MorphIcon :icon="open ? X : Menu" spring="snappy" />

  <!-- 2. Controlled (gestures, scroll): explicit progress, no spring -->
  <MorphIcon :from="Menu" :to="X" :progress="dragProgress" />

  <!-- 3. Imperative (sequences): template ref → morphTo / set -->
  <MorphIcon ref="morph" :icon="Menu" />
</template>
```

Same surface as the React binding: presentation props (`size`, `strokeWidth`, `absoluteStrokeWidth`, `color`; `class`, `style` and the rest of the `<svg>` attrs fall through), the same accessibility defaults (`aria-hidden` unless you pass `label`) and the same clean SSR — works with Nuxt out of the box: the server emits the exact static SVG and the runtime is born on hydration. The binding is a plain render function; no SFC compiler or JSX involved.
