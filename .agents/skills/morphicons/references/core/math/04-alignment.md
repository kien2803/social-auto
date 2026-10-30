# Math 4: alignment

> Source-derived 2D Procrustes alignment and minimal-rotation tie-break.

### 4. Alignment — 2D Procrustes

Before interpolating, the **optimal similarity** (rotation θ, scale σ, translation) mapping A onto B is computed by minimizing `Σ|σ·R(θ)·(aᵢ−c_A) − (bᵢ−c_B)|²`. In 2D it has a closed form, no SVD:

```
S_xx = Σ aₓbₓ    S_xy = Σ aₓbᵧ    (centered clouds)
S_yx = Σ aᵧbₓ    S_yy = Σ aᵧbᵧ

θ* = atan2(S_xy − S_yx,  S_xx + S_yy)
σ* = [cos θ*·(S_xx+S_yy) + sin θ*·(S_xy−S_yx)] / Σ‖aᵢ‖²
```

The normalized RMS **residual** after alignment (`res = √(Σ|σRa−b|² / Σ‖b‖²)`) is the shape metric: ≈ 0 means A and B are the same shape rotated/scaled. This turns rotation groups into an **emergent property**: arrow-right → arrow-down gives residual ~0 with θ = 90° and the system chooses pure rotation on its own.

Procrustes runs **per subpath** (each piece rotates around its own centroid, which translates independently) — this gives local, organic motion: a hamburger *folds* instead of spinning as a block. A **global hybrid** pass then runs Procrustes over the concatenated clouds: if the global residual is ≈ 0 (< 5e-3) the whole icon is congruent and every subpath shares the same (θ, σ), so e.g. both subpaths of an arrow spin the same way.

#### Minimal-rotation tie-break

For shapes symmetric under inversion (a straight line), both traversal orientations give residual 0 — indistinguishable to Procrustes — but produce different rotations. Naive tie-breaking can pick θ = 135° when the inverted orientation gives θ = −45° with the same end result. Each orientation is scored with:

```
score = res + λ·|θ|/π      (λ = 0.05)
```

Deformation is minimized first and, at comparable residuals, the shortest rotation wins. λ is small enough that a notably worse shape never wins just by rotating less. This is the kind of detail the math doesn't see but the eye does.
