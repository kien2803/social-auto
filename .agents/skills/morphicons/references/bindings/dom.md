# Vanilla DOM driver

> Source-derived `morphicons/dom` API and scheduler behavior.

### Vanilla (no React)

```ts
import { createMorph } from "morphicons/dom";

const m = createMorph(pathEl, Menu); // pathEl: any object with setAttribute
m.morphTo(X, "snappy");              // preset or { stiffness, damping }
m.set(Check);                        // jump without animating (canonical d)
m.seek(X, 0.4);                      // morph frozen at t — scrubbing, gestures
m.progress = 0.4;                    // sugar: seek on the active target
m.destroy();
```

Truly interruptible: a `morphTo` mid-flight re-plans from the current intermediate shape while preserving the spring's velocity — click spam never jumps. A single global `requestAnimationFrame` drives all instances.
