# API choice examples

## Normal component toggle

Use the framework binding in uncontrolled mode. Do not use the DOM driver for a basic button toggle.

## Gesture-controlled single icon

Use the framework binding with `from`, `to`, and `progress`. Keep progress local and batch raw pointer/scroll events to one update per animation frame.

## Dozens of scroll-scrubbed icons

Profile first. If framework commits dominate, isolate the interaction and test direct DOM-driver ownership. If paint dominates, changing APIs will not solve the problem; reduce active count or rendering cost.

## Server-side or custom renderer math

Use the pure core. Load only `core/api.md`, `core/architecture.md`, and the relevant math topic.

## Bad-looking transition

Check `compatibility/icon-libraries.md` before changing springs or framework code. Filled icons, transforms, unsupported tags, and mismatched grids are geometry problems.
