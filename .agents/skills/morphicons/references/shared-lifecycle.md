# Shared lifecycle contract

> Source-derived lifecycle contract for all four framework bindings.

### Lifecycle contract (all four bindings)

The four components share one contract, pinned by mirrored client-mount tests:

- **Lazy driver.** Mounting without any icon is fine — SSR emits `<path d="">` and the driver is born with the FIRST icon that shows up, whether a late `icon` prop (data that loads async), a late `from`/`to` pair, or an imperative `set`/`morphTo`. The first icon paints without animating; `morphTo` before the driver exists behaves as `set` (there is nothing to fly from).
- **Controlled wins.** While `from` AND `to` are both present, the pair owns the path: `icon` changes are ignored, no spring fires. Drop the pair and the current `icon` takes over (animated). Mixing the modes is not an error — the precedence is just explicit.
- **Clean re-entry.** Any exit from controlled mode (an imperative call or an icon takeover) invalidates the frozen pair, so returning to the same `from`/`to` re-bases on `from` and renders exactly like a clean mount at that `progress`.
