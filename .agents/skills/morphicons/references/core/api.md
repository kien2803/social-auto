# Pure core API

> Source-derived DOM-free core API and accepted icon inputs.

### Pure core (no DOM)

```ts
import { resampleIcon, buildPlan, interpPolar, allocOutputs, serialize } from "morphicons";

const plan = buildPlan(resampleIcon(Menu), resampleIcon(X)); // cacheable
const out = allocOutputs(plan);
interpPolar(plan, 0.5, out);                                 // t ∈ [0, 1]
const d = serialize(out, plan.items.map(it => it.closed));   // `d` attribute
```

Accepts `IconNode` (Lucide's data format, structurally typed — Lucide is neither a dependency nor a peer) or a raw `d` attribute. Tabler, Heroicons, Iconoir and custom paths work the same.
