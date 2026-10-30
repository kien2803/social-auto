# Math 2: resampling

> Source-derived arc-length sampling and anchored-corner behavior.

### 2. Resampling — arc length with anchored corners

Instead of fighting Bézier structures of different cardinality, every subpath is sampled at **N points equidistant by arc length** (N = 64). Every subpath becomes a `Float64Array(2N)` and the structural problem disappears: correspondence is index to index.

The arc length of a cubic has no closed form; `|B′(t)|` is integrated with 8-point Gauss-Legendre quadrature per segment.

The refinement that drives quality: **corner detection** (tangent discontinuity above an angular threshold) with corners anchored as exact sample points. Remaining points are apportioned by arc length between corners — integer apportionment by largest remainder, minimum 1 interval per run, summing exactly to N−1. Effects:

- At rest the shape is **exact** (a check's vertex is a sample, not an approximation).
- In transit, source corners flatten smoothly and target corners sharpen — the desired behavior. Without anchoring, a morphing check visibly rounds its corners.

Closed paths anchor **only corners**, not the arbitrary `M` start point — sampling is intrinsic to the shape, so two congruent loops with different start points produce the same sample set (modulo index rotation, resolved by the circular correspondence below).
