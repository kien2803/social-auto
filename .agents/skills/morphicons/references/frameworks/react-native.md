# React Native binding

> Source-derived React Native API surface, runtime behavior, accessibility, and Metro requirements.

### React Native — same three modes

```tsx
import { MorphIcon, type MorphHandle } from "morphicons/react-native";
import { Menu, X, Check } from "lucide"; // data, not components

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

The DOM-free core beyond the browser: the dom driver is reused verbatim as the engine (React Native has a global `requestAnimationFrame`, and `PathEl` is structural), so the whole platform difference is a shim that forwards the per-frame `d` write to `Path.setNativeProps` of react-native-svg — outside the React render, exactly like the web mutation. Same surface as the React binding (`size`, `strokeWidth`, `absoluteStrokeWidth`, `color`, plus the native `Svg` props: `testID`, touch handlers…), same accessibility defaults (`aria-hidden` unless you pass `label` → `role="img"` + `aria-label`). Reduced motion comes from `AccessibilityInfo` (best-effort: the query is async; a `reduceMotionChanged` subscription keeps it exact from then on). Requires Metro with package `exports` resolution — default since React Native 0.79; on older versions enable `unstable_enablePackageExports`.
