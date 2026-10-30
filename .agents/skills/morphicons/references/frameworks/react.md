# React binding

> Source-derived React API surface and behavior.

### React — three modes

```tsx
import { MorphIcon, type MorphHandle } from "morphicons/react";

// 1. Uncontrolled (90% of uses): change the prop and morphicons animates
<MorphIcon icon={open ? X : Menu} spring="snappy" />

// 2. Controlled (gestures, scroll): explicit progress, no spring
<MorphIcon from={Menu} to={X} progress={dragProgress} />

// 3. Imperative (sequences)
const ref = useRef<MorphHandle>(null);
<MorphIcon ref={ref} icon={Menu} />
ref.current?.morphTo(Check); // animates
ref.current?.set(X);         // jumps without animating
```

Drop-in replacement for lucide-react: `size`, `strokeWidth`, `absoluteStrokeWidth`, `color`, `className` and the rest of the `<svg>` props pass straight through. Correct accessibility by default: `aria-hidden` unless you pass `label` (→ `role="img"` + `<title>`). Clean SSR: the server emits the exact static SVG (zero flash, zero layout shift); the runtime is born on hydration. `prefers-reduced-motion` degrades to an instant swap.
