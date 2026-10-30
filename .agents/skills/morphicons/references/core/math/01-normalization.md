# Math 1: normalization

> Source-derived path parsing and primitive-to-cubic conversion.

## How the math works

### 1. Normalization — everything to cubic Béziers

Every SVG primitive is reduced to cubic segments:

- **Line** → cubic with collinear controls: `C₁ = P₀ + ⅓(P₃−P₀)`, `C₂ = P₀ + ⅔(P₃−P₀)`.
- **Quadratic** → exact degree elevation: `C₁ = Q₀ + ⅔(Q₁−Q₀)`, `C₂ = Q₂ + ⅔(Q₁−Q₂)`.
- **Circle** → 4 cubics with offset `k = r·(4/3)·tan(π/8) ≈ 0.5523·r`.
- **Arc `A`** → center parametrization (SVG spec, appendix F.6), sliced into arcs ≤ 90°, each slice to a cubic with `α = (4/3)·tan(Δθ/4)`.
- **rect/polyline/polygon** → lines (rounded rects: lines + quarter ellipses).

The `d` parser handles absolute/relative commands, H/V/S/T shorthands, packed arc flags and scientific notation. Result: icon = list of subpaths; subpath = chain of cubics + closed/open flag.
