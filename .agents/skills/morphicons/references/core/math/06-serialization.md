# Math 6: serialization and canonical snap

> Source-derived in-flight serialization, canonical snapping, and hydration precision.

### 6. Serialization and canonical snap

In flight, each subpath is emitted as `M x y L x y …` (+ `Z` if the pair is closed↔closed; closed→open flies open, the loop opening at the cut chosen by the circular correspondence) with 2 decimals — invisible at 24px, and the frame's only allocation. On settle, the driver **snaps to the canonical `d`** of the target icon: exact fidelity at rest (real curves, not polylines), subpath count reset after duplications, and the DOM ends up identical to a static icon's. The jump is < 0.02px — imperceptible. The canonical `d` itself is emitted with 4 decimals, and that is a correctness choice, not a size one: arc→cubic conversion goes through trig whose last ulp differs across JS engines, and SSR hydration compares the server's bytes against the browser's — quantized emission keeps them identical, where full precision leaked each engine's ulp into the markup (a Next hydration mismatch on icons with non-cardinal arcs).
