# Math 3: correspondence

> Source-derived orientation, circular offset, and subpath matching.

### 3. Correspondence

Three subproblems:

- **Orientation.** Both traversal directions of B are tried and scored (see the tie-break below). A hamburger line folding to the correct diagonal depends on this.
- **Start point (closed paths).** A closed contour has a circular degree of freedom: which index is "first". The N circular offsets × 2 directions are tried and the best post-alignment score wins. O(N²) brute force with N = 64 is ~4K operations per pair — negligible.
- **Subpath matching.** With p subpaths in A and q in B, pairing cost is `dist(centroids) + 0.35·|ΔL|` (arc lengths). Equal counts use the minimum-cost permutation (exhaustive with pruning up to 8 subpaths, greedy above); unequal counts use a **surjective** assignment from the large side to the small one, so no subpath ever appears or disappears out of nowhere. Leftovers are **not collapsed to a point**: the nearest subpath is **duplicated** in place and the copies separate in flight — it reads as cell division, far more natural than growing from nothing. At rest, overlapping duplicates with the same solid stroke are invisible, and the canonical snap on settle resets the count.
