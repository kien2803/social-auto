# Math 5: polar interpolation

> Source-derived polar interpolation and global block transport.

### 5. Polar interpolation

Raw coordinate lerp **collapses rotations**: points take the chord, the shape shrinks and shears in transit. The fix: decompose the motion into similarity + residual and interpolate each part in its natural space.

Let `aᶜᵢ = aᵢ − c_A` and `b̃ᵢ = R(−θ*)·(bᵢ − c_B)/σ*` (B brought into A's frame). Then:

```
P(t) = c(t) + σ*ᵗ · R(t·θ*) · [(1−t)·aᶜᵢ + t·b̃ᵢ]

  c(t)  = lerp(c_A, c_B, t)        linear translation (block transport under the global hybrid — below)
  t·θ*  = linear angle             (θ* is already in (−π, π], short path)
  σ*ᵗ   = exp(t·ln σ*)             log-linear scale (geodesic in ℝ⁺)
```

Exact at both endpoints (max error ~3.6e-15 in tests). Properties:

- If B is A rotated (residual 0), the bracket is constant and the motion is **pure rotation**.
- If there is no rotation, it's a clean coordinate morph.
- Mixed cases do both simultaneously and continuously.
- With spring overshoot (t > 1) the formula **extrapolates** naturally: rotation and scale overshoot slightly and come back — free juice.

**Block transport (global hybrid).** When the whole icon is congruent (§4), lerping each subpath centroid reintroduces the chord disease one level up: every part spins with the shared θ*, but an off-center part travels the chord — inside the arc — and drifts toward the center mid-flight. An arrow's head sagged ~1 px toward its shaft at t = 0.5 (`r·(1 − cos(θ/2))` with r = 3.5, θ = 90°) while both parts rotated perfectly. Under the hybrid, each centroid rides the shared similarity around the global centroid `g_A` instead:

```
c_k(t) = c_{A,k} + t·d_k + (σ*ᵗ·R(t·θ*) − I)·(c_{A,k} − g_A)
```

`d_k` is fixed once so that `c_k(1) = c_{B,k}` exactly (it absorbs the tiny global residual). Every point of every subpath then moves under ONE similarity per frame: congruent icons are rigid through the whole flight, not only at the endpoints. With θ* = 0, or centroids sitting on `g_A`, or no hybrid at all, the formula degrades continuously to the plain lerp — no thresholds, no special cases.
