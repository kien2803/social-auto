# Bundle size

> Source-derived measured gzip sizes and CI gates.

## Size

CI budget (size-limit, gzip) as an anti-regression tripwire — gates carry ~10% headroom over what's measured; if a real capability needs more, the number is renegotiated, but growing unnoticed is not accepted:

| entry | measured | gate |
|---|---|---|
| `morphicons` (core) | 6.60 KB | 7 KB |
| `morphicons/dom` (core + driver) | 7.04 KB | 7.5 KB |
| `morphicons/react` (all, react external) | 7.89 KB | 8.5 KB |
| `morphicons/react-native` (all, react/rn/rnsvg external) | 8.25 KB | 9 KB |
| `morphicons/vue` (all, vue external) | 7.93 KB | 8.5 KB |
| `morphicons/svelte` TS half (all, svelte external) | 7.54 KB | 8 KB |
| `MorphIcon.svelte` (ships as source, consumer-compiled) | 1.25 KB | 1.4 KB |
