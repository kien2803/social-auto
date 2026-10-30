# Runtime performance: documented measurements

> Source-derived benchmark and scheduler claims. Do not generalize these numbers to an application without profiling.

## Performance

- `plan(A, B)` complete (resample + match + Procrustes × orientations): **sub-millisecond** with N = 64 — measured 0.01 ms (open paths) to 0.06 ms (closed, with circular search); 0.42 ms for a pathological 12-loops case.
- **Zero numeric allocation per frame**: interpolators write into the plan's preallocated `Float64Array`s. Only the `d` string is allocated.
- **Caches by reference**: `normalize(icon)` in a WeakMap keyed by the IconNode (Lucide imports are stable references → no string keys, GC-friendly). `plan(A, B)` in a nested WeakMap; plans from interruptions are never cached.
- **One global rAF** (singleton scheduler): active instances are iterated, settled ones unregister. A hundred icons morphing at once = one loop.
