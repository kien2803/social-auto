# Math 7: spring

> Source-derived oscillator, presets, integration, and interruption behavior.

### 7. The spring

Damped harmonic oscillator over progress `x: 0 → 1`:

```
ẍ = k·(1 − x) − c·ẋ
```

Integrated with **semi-implicit Euler** at h = 1/240 s substeps (stable up to ω·h ≈ 2; with k = 420, ω ≈ 20.5 — ample margin). ~25 lines, no animation library needed.

| preset | k | c | ζ = c/(2√k) | character |
|--------|-----|-----|------|-----------|
| smooth | 170 | 26 | 1.00 | critically damped, no overshoot |
| snappy | 420 | 30 | 0.73 | fast, subtle overshoot |
| bouncy | 300 | 14 | 0.40 | playful |

**Interruptions**: when a `morphTo` arrives mid-flight, the plan is rebuilt from the current intermediate shape (the rendered buffers are already N points per subpath — they serve directly as source), `x` resets to 0 and **velocity is preserved** (clamped to ±14). Perceived motion is continuous; tap spam feels alive, never jumps. The spring settles and the rAF stops when `|1−x| < 0.001 ∧ |v| < 0.02`.
