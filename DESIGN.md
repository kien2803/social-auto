---
version: alpha
name: Omnicast-design-system
description: "A warm-paper broadcast station. OmniCast is a social-video publishing and scheduling product — one upload goes out to YouTube, TikTok, Instagram, and Facebook on an exact schedule. The design language is a mid-century transmission control room rendered in software: warm paper surfaces (#faf9f6), near-black warm ink (#1b1814), and a single vermilion accent (#e04e14) that means 'on air'. IBM Plex Sans carries all type; IBM Plex Mono is reserved for diegetic machine labels — channel codes (CH-01), timestamps, status words, tx logs. Cards are flat hairline panels with a paper-grain page texture. Depth is an inset top highlight, not drop shadows. Motion is exact and instrument-like: one shared cubic-bezier(0.22, 1, 0.36, 1) curve, transform/opacity only, no springs, no bounces. The accent is scarce — primary buttons, the on-air/rec dot, active dock marker — everything else is neutral."

colors:
  canvas: "#f4f1ec"
  surface: "#faf9f6"
  surface-subtle: "#eae6de"
  surface-inset: "#e2ded5"
  ink: "#1b1814"
  ink-muted: "#5d564d"
  ink-subtle: "#a39a8d"
  primary: "#e04e14"
  primary-hover: "#c93f0b"
  primary-pressed: "#a53207"
  primary-tint-50: "#fdf1ea"
  primary-tint-100: "#fad9c7"
  primary-tint-200: "#f6b89d"
  hairline: "#e7e5e0"
  hairline-strong: "#d6d3cd"
  dark-canvas: "#1c1917"
  dark-surface: "#262019"
  dark-panel: "#211d18"
  semantic-success: "#15803d"
  semantic-warn: "#b45309"
  semantic-danger: "#dc2626"
  platform-youtube: "#ff0033"
  platform-tiktok: "#000000"
  platform-instagram: "linear-gradient(45deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888)"
  platform-facebook: "#1877f2"

typography:
  display-xl:
    fontFamily: IBM Plex Sans
    fontSize: 56px
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: -1.7px
  display-lg:
    fontFamily: IBM Plex Sans
    fontSize: 40px
    fontWeight: 700
    lineHeight: 1.10
    letterSpacing: -1.2px
  page-title:
    fontFamily: IBM Plex Sans
    fontSize: 24px
    fontWeight: 700
    lineHeight: 1.20
    letterSpacing: -0.3px
  card-title:
    fontFamily: IBM Plex Sans
    fontSize: 14px
    fontWeight: 600
    lineHeight: 1.30
    letterSpacing: 0
  body:
    fontFamily: IBM Plex Sans
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.50
    letterSpacing: 0
  body-sm:
    fontFamily: IBM Plex Sans
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: 0
  meta:
    fontFamily: IBM Plex Sans
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.40
    letterSpacing: 0
  mono-label:
    fontFamily: IBM Plex Mono
    fontSize: 11px
    fontWeight: 400
    lineHeight: 1.30
    letterSpacing: 0
  mono-micro:
    fontFamily: IBM Plex Mono
    fontSize: 10px
    fontWeight: 400
    lineHeight: 1.30
    letterSpacing: 0

rounded:
  sm: 3px
  base: 5px
  md: 6px
  lg: 8px
  xl: 10px

motion:
  ease: "cubic-bezier(0.22, 1, 0.36, 1)"
  duration-fast: 150ms
  duration-base: 300ms
  duration-reveal: 550ms
---

## Overview

OmniCast's canvas is a **broadcast transmission station rendered as warm paper** — `{colors.canvas}` (#f4f1ec) reads like aged machine-room paper, with a 3% paper-grain noise texture laid over the whole app (`body::after`). Cards are flat panels (`{colors.surface}` #faf9f6) separated by 1px hairlines, grouped by whitespace and rules rather than boxes.

The single chromatic accent is **vermilion** `{colors.primary}` (#e04e14) — the color of a transmitter needle and an on-air lamp. It appears on primary buttons, the rec/live dot, the active dock marker, focus rings, and step numbers — never as a section fill, card tint, or decorative wash. Semantic colors (success #15803d, warn #b45309, danger #dc2626) carry *status meaning only* — quota bars, publish states, failure badges.

Type is one family: **IBM Plex Sans** for everything people read, weights 400–700, and **IBM Plex Mono** for diegetic machine output — the signature move. Mono lowercase labels (`content schedule`, `tx → queue`, `CH-01`, `queued · 7d`) are how the product speaks; they are not eyebrow decoration, they are the station's instrumentation.

The product's hero visual is a **broadcast storyboard inside a monitor frame** — a 15-second GSAP master timeline that dramatizes the actual flow: drag a video in → confirm → signal lines fan out → one card morphs through four platform skins → splits into four platform cards → Omnicast sign-off. In the app, the same world shows up as CH-lineup tiles, station-control rows, EQ bars, and tx-log lists.

**Key Characteristics:**
- **Warm-analog broadcast world** — paper texture, hairlines, console rows, mono instrumentation.
- **One accent, vermilion** — means on-air/transmit; scarce by rule.
- **Diegetic mono labels** — IBM Plex Mono carries status, codes, timestamps, hints.
- **Flat panels, hairline borders** — depth is an `inset 0 1px 0` top highlight (inlay), not glow.
- **Exact motion** — one shared ease, transform/opacity only, transform-first; nothing springs.
- **Platform cards keep real app chrome** — YouTube horizontal watch card, TikTok/IG/FB vertical reels with each app's own rail/header/follow affordance.

## Colors

> Source of truth: `core/web/tailwind.config.js`, `core/web/src/index.css`.

### Brand & Accent
- **Vermilion** ({colors.primary} #e04e14): Primary button fill, rec/live dot, dock active marker, focus ring, step numbers, signal lines in the storyboard.
- **Vermilion Hover** ({colors.primary-hover} #c93f0b): Primary button hover.
- **Vermilion Pressed** ({colors.primary-pressed} #a53207): Primary button active.
- **Vermilion Tints** ({colors.primary-tint-50/100/200}): Chip/tag backgrounds (`chip`, `live` env badge), Dock active tile, selected-state tints (account chips, video pickers). Never a section background.

### Surface
- **Canvas** ({colors.canvas} #f4f1ec): App page background — warm muted paper.
- **Surface** ({colors.surface} #faf9f6): Card and topbar surface — one step lighter than canvas.
- **Surface Subtle** ({colors.surface-subtle} #eae6de): Hover states, secondary button hover, active `.seg-btn`.
- **Surface Inset** ({colors.surface-inset} #e2ded5): Sunken wells — drop zones, meter troughs.
- **Hairline / Hairline Strong**: `stone-200`/`stone-300` Tailwind steps — all borders are 1px.
- **Dark canvas** ({colors.dark-canvas} #1c1917): Dark-mode page — warm charcoal, never pure black.
- **Dark surface / panel** ({colors.dark-surface} #262019, {colors.dark-panel} #211d18): Dark cards and insets.

### Text
- **Ink** ({colors.ink} #1b1814): Headlines, primary text.
- **Ink Muted** ({colors.ink-muted} #5d564d): Secondary text, descriptions.
- **Ink Subtle** ({colors.ink-subtle} #a39a8d): Mono labels, hints, placeholders, footnotes.

### Semantic
- **Success** ({colors.semantic-success}): Published status, healthy quota bars, success toasts.
- **Warn** ({colors.semantic-warn}): Pending/approaching-limit states.
- **Danger** ({colors.semantic-danger}): Failed posts, faults stat, delete actions, exhausted quotas.
- **Platform colors**: Only inside platform icons and platform-specific card chrome (YouTube scrubber #ff0033, TikTok black reel, Instagram gradient avatar, Facebook blue #1877f2). They identify a channel — they are never UI accents.

## Typography

### Font Family
- **IBM Plex Sans** — everything: display, UI, body, buttons. One voice; hierarchy comes from weight (400/500/600/700) and tracking, not a second family.
- **IBM Plex Mono** — diegetic machine text only: mono eyebrows/labels, channel codes, timestamps, counts, hints inside control rows, code.

### Hierarchy

| Token | Size | Weight | Letter Spacing | Use |
|---|---|---|---|---|
| `{typography.display-xl}` | 56px | 700 | -1.7px | Landing hero headline |
| `{typography.display-lg}` | 40px | 700 | -1.2px | Landing section titles |
| `{typography.page-title}` | 24px | 700 | -0.3px | App page h1 |
| `{typography.card-title}` | 14px | 600 | 0 | CardHeader titles |
| `{typography.body}` | 14px | 400 | 0 | Default app text |
| `{typography.body-sm}` | 13px | 400 | 0 | Dense list text, card captions |
| `{typography.meta}` | 12px | 400 | 0 | Descriptions, helper text |
| `{typography.mono-label}` | 11px | 400 | 0 | Mono eyebrows, stat labels, table meta |
| `{typography.mono-micro}` | 10px | 400 | 0 | CH codes, hints, badge microcopy |

### Principles
- **Mono labels are lowercase** — `queued`, `content schedule`, `tx log` — they read as instrument print, not marketing eyebrows. Do not uppercase them; do not letter-space them.
- **Sentence case everywhere** — page titles, buttons, headings. No Title Case headings, no ALL-CAPS badges.
- **No trailing periods** on headlines; descriptions may use them.
- **tabular figures** for counts/stats where alignment matters.

## Layout

### Spacing System
- 4px base grid. App pages use `space-y-4` / `space-y-6` section rhythm; card internals use `p-4`/`p-5`, row items `px-4 py-3`.
- App shell: sticky `h-14` topbar + `max-w-6xl` centered content (`px-4 md:px-8`, `pb-24` clears the Dock).
- Landing: `max-w-6xl` container, generous section rhythm (~py-20+).

### Grid & Container
- Card grids: `md:grid-cols-2` for account cards; calendar is a strict 7-col grid; stat strips are hairline-divided rows (grid, not cards-in-cards).
- Landing capability grids break equal-card monotony with col-span rhythm (4+2 / 2+4 / 3+3) — vary spans deliberately, never six identical tiles.

### Whitespace Philosophy
- Group by whitespace + hairlines. A `Card` is the unit of meaning; avoid nesting cards inside cards.
- Empty states are dashed-border wells — intentional dead space, kept short.

## Elevation & Depth

- **`shadow-soft`** — resting cards: `0 1px 1px, 0 2px 8px -2px` warm-brown tint, plus `inset 0 1px 0 rgba(255,255,255,.65)` top highlight.
- **`shadow-lift`** — drawers, dropdowns, floating panels.
- **`shadow-press`** — primary buttons: `inset 0 -2px 0 rgba(0,0,0,.14)` — a physical press lip, plus `active:translate-y-px`.
- **`shadow-inlay`** — inputs, secondary buttons, `.seg` containers: `inset 0 1px 0` white edge.
- **`shadow-float`** — the bottom Dock.
- **Never**: colored glows, colored shadows, blurred glass cards, drop-shadow halos on accent elements.

## Shapes

### Border Radius Scale
- `{rounded.sm}` 3px — inputs, buttons, chips, `.seg` controls.
- `{rounded.base}`/`{rounded.md}` 5–6px — cards, panels.
- `{rounded.lg}`/`{rounded.xl}` 8–10px — dock items and the dock bar itself.
- **Never pill-round** buttons, inputs, or cards. Rounded-full is reserved for true dots (status, today marker, live dot).

## Components

### Buttons
- **`.btn-primary`** — vermilion fill + `shadow-press`; the ONE accent surface per view. `active:translate-y-px`.
- **`.btn-secondary`** — hairline border + `shadow-inlay`; default action.
- **`.btn-ghost`** — text-only, `hover:bg-surface-subtle`.
- **`.btn-danger`** — hairline red; destructive only.
- One primary per section; secondaries go ghost if more than two actions appear.

### Segmented control (`.seg` / `.seg-btn`)
- The single pattern for view toggles and status filters (Cards/Table, Grid/List, Week/Month, comment status groups).
- **Active = a quiet surface step** (`bg-surface-subtle` + inherited hairline), announced via `aria-pressed`. Never accent-filled.
- Options separated by 1px `border-l` dividers.

### Cards & Panels
- `.card` = hairline + `shadow-soft` + white inlay edge. `CardHeader` carries title + `meta` description + optional action.
- Stat tiles and channel tiles are hairline-divided grid cells, not nested cards.
- **Station controls** (dashboard): hairline-separated link rows — icon + label left, mono hint right (`tx → queue`, `CH lineup →`).

### Navigation
- **Topbar** — page title (sentence case), vermilion `● live` env chip, one primary CTA (`Create Post`), user name, sign out, theme toggle.
- **Dock** — the only nav, bottom-center floating bar: icon buttons, active = `bg-brand-50` tile + `bg-brand-600` dot beneath (tuner marker), hover = `-translate-y-0.5` on the shared ease, tooltip above. Radii: bar `xl`, items `lg`.
- **PostsNav** — underline tabs; active = `border-brand-600` hairline, not a filled pill.

### Forms
- `.input` = `shadow-inlay` well, hairline `stone-300` border, `focus:border-brand-500 + ring-1`. Labels are `meta`-sized; required marks are `*`.
- Filter selects sit inline in one row (`!w-auto`); never stack three full-width selects.
- Multi-select chips (account pickers): active = `border-brand-500 bg-brand-50 text-brand-700` — a tint, not a fill.

### Badges & Status
- `Badge` tones: neutral/success/warn/danger/pending/failed/brand — tinted backgrounds, `mono-micro` or `meta` type.
- Channel lineup: `CH-0N` mono code + platform name + `● on air` / `○ standby` status line.
- Today marker in the calendar: vermilion `rounded-full` dot — a dot, not a pill.

### Storyboard & Signature Visuals (landing)
- Monitor-framed scene: hairline border + faint graph grid + HUD strip (`tx-feed · cam-01`, `● rec`) + progress dots + scene captions (`ingest`, `relay`, `preview`, `fan-out`, `sign-off`).
- Each timeline beat is its own `inset-0` scene layer; scenes crossfade with a slight `0.97→1` scale-in.
- Platform cards use real app chrome — YouTube 16:9 watch card + red scrubber; TikTok black 9:16 reel + white action rail; Instagram 9:16 + gradient avatar + Follow; Facebook 9:16 + blue avatar + Reels badge. One video, four skins.

### Empty States
- Dashed hairline well, centered: small icon, `card-title` heading, one-line `meta` description, one button max.

## Motion

- **One shared ease**: `{motion.ease}` — `cubic-bezier(0.22, 1, 0.36, 1)`. Every reveal, hover lift, and tween.
- **Transform + opacity only** — never animate `left`/`top`/`width`/`height`/`filter`.
- **Named transitions** — `transition-colors`, `transition-[transform,…]`; never `transition-all`.
- **No springs, no bounce** — hover lifts are `-translate-y-0.5`, not scale magnifications.
- **GSAP for sequences**: `useGSAP` + scoped refs, master `timeline` with labels, `gsap.matchMedia()` for `prefers-reduced-motion` → static resting state. `CustomEase` carries the shared curve; `MotionPathPlugin` for paths (pixel-concrete points).
- **Ambient loops** (waves, EQ bars, rec blink) are CSS and subtle; UI must remain readable if they all froze.

## Do's and Don'ts

### Do
- Use `{colors.primary}` only for: primary buttons, rec/on-air dots, dock active marker, focus rings, signal lines, step numbers.
- Write helper text, hints, and status in lowercase `mono-label` — the station's voice (`tx → queue`, `resets in 542 min`).
- Keep platform brand colors inside platform iconography and platform-mock chrome only.
- Group with hairlines and whitespace; one card = one unit of meaning.
- Give every segment/toggle/filter the `.seg` treatment — surface-step active states.
- Make empty states useful: one line of cause + one action.
- Animate with transform/opacity on the shared ease; reduce-motion users get a static resting frame.

### Don't
- Don't introduce a second accent (indigo, teal, purple) or gradient text/fills.
- Don't use vermilion as a section background, card tint, or decorative wash.
- Don't glow — no `drop-shadow`, colored box-shadows, or neon edges on accent elements.
- Don't pill-round buttons, inputs, cards, or filter controls.
- Don't spring/bounce (no `cubic-bezier(.34,1.56,…)`, no `hover:scale` magnifications).
- Don't use `transition-all` or animate layout properties.
- Don't uppercase + letter-space labels (that's marketing eyebrow slop — mono lowercase is ours).
- Don't use emoji or emoji-like badges in UI; use the icon set (Tabler-style strokes, 4–6px, `h-4 w-4`/`h-5 w-5`).
- Don't stack full-width selects for filters; keep controls inline.

## Responsive Behavior

### Breakpoints
| Name | Width | Key Changes |
|---|---|---|
| Desktop | 1280–1440px | `max-w-6xl` content, 2-col card grids |
| Tablet | 768–1024px | grids collapse 2→1, topbar title stays |
| Mobile | <768px | single column, dock icons shrink `12→10`, primary CTA text hides |

### Touch Targets
- Dock items ≥40px; `.seg-btn` ≥32px hit height; inputs ≥36px.

### Collapsing Strategy
- Nav never leaves the Dock; topbar condenses to logo on mobile.
- Calendar keeps the 7-col grid (cells compress); stat strips go `grid-cols-2`.
- The storyboard monitor scales with the stage; scene layout is percentage-based.

## Iteration Guide

1. Check `tailwind.config.js` for the token before inventing a value.
2. New toggle/filter → `.seg` + `seg-btn` + `aria-pressed`; never a new active-fill style.
3. New status → a `Badge` tone or semantic color; never a new accent.
4. New motion → shared ease, transform/opacity; sequences → GSAP timeline with labels.
5. New mono copy → lowercase, `text-[11px]` or `text-[10px]`, `ink-subtle`.
6. Icons → `h-4 w-4`/`h-5 w-5` stroke icons from `components/icons.tsx` or `@tabler/icons-react`.
7. Verify in the browser (Vite dev on :5188) — screenshot, don't guess.

## Known Gaps

- Dark mode token values are Tailwind `stone`/`brand` dark variants applied inline (`dark:` classes) rather than a separate ramp — keep dark surfaces warm charcoal (`#1c1917`/`#262019`/`#211d18`), never blue-gray.
- Charts (`BarChart`) use status tones only; no categorical palette exists yet.
- The Dock has no text labels on small screens — labels live in tooltips; if a11y review requires, add a `sm:` label row rather than enlarging icons.
- Print styles and RTL layouts are unaddressed.
