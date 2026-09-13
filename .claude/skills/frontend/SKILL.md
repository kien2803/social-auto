---
name: frontend
description: Frontend engineering workflow. Use when the user asks to design, implement, debug, refactor, or review UI code — components, state, routing, styling, accessibility, performance.
---

# Frontend

## When to use
- User asks for UI/UX work, component design, state, routing, styling, or frontend debugging.
- Trigger phrases: "frontend", "UI", "component", "page", "screen", "form", "styling", "CSS", "responsive", "a11y".

## Workflow

### 1. Scope
- Identify the framework: React/Vue/Svelte/vanilla/etc. Match existing patterns.
- Identify the layer: component, page/route, state, styles, build config.

### 2. Research Before Editing
- Read the matching component tree and shared components before adding new ones.
- Use `lsp` for symbol-aware lookups.
- Check existing patterns: state management, data fetching, error/loading states, form handling, styling system.

### 3. Design
- Component contract first: props, state, events, slots, accessibility role.
- Loading / empty / error states are part of the component, not afterthoughts.
- Accessibility: semantic HTML, keyboard nav, focus management, ARIA only when needed.
- Responsive: mobile-first unless project says otherwise.

### 4. Implement
- Match existing style system (Tailwind/CSS modules/styled-components/etc.). NEVER introduce a parallel one.
- Avoid unnecessary state: lift state only when needed; derive when possible.
- Avoid unnecessary re-renders: memo only with measured benefit.
- Bundle impact: dynamic import heavy deps; tree-shake friendly imports.
- Form handling: validate at submit, show field-level errors, handle async submit (pending state).

### 5. Verify
- Run type checker and linter on touched files.
- Run dev server, exercise the changed path in a real browser.
- For visual changes: screenshot before/after to confirm.
- For interaction changes: verify keyboard, mouse, and screen reader if applicable.

### 6. Cleanup
- Remove dead components, unused props, dead CSS, dead routes.
- Update storybook/docs when public API of a component changes.

## Anti-patterns
- Inline styles next to a CSS-in-JS system.
- `useEffect` for derived state.
- Prop drilling past 3 levels without context/store.
- `any` types when the real type is known.
- Visual divergence from existing components.

## Check
- A11y, responsive, loading/empty/error states, type safety, matches existing style.