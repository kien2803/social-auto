---
name: planning
description: Project planning workflow. Use when the user asks for a roadmap, breakdown, phased plan, milestones, dependencies, or sequencing of work before execution.
---

# Planning

## When to use
- User asks for a plan, roadmap, breakdown, milestones, "how should we sequence this", estimates.
- Trigger phrases: "plan", "roadmap", "milestones", "phases", "break down", "sequence", "estimate".
- Use AFTER brainstorm / scope is clear, BEFORE implementation.

## Workflow

### 1. Goal
- Restate the outcome the plan must produce. One sentence. Measurable.

### 2. Decompose
- Break work into phases, then into tasks.
- Each task: name, deliverable, owner (or "agent"), depends-on.
- Prefer parallel slices where independent; serialize only on hard deps.

### 3. Sequence
- Lay out phases in dependency order.
- For each phase: in-scope / out-of-scope / risks / acceptance.
- Identify shared contracts/schemas that must be agreed up-front.

### 4. Estimate
- Sizing: S / M / L / XL, or rough day-counts — explicit, not vague.
- Call out unknowns explicitly. List what would change the estimate.

### 5. Verify
- Each phase ends with a concrete acceptance check (test, smoke test, observable artifact).
- Plan must include verification, not just deliverables.

### 6. Risks
- Top 3 risks with mitigations.
- "Stop conditions" — when to halt and re-plan.

## Anti-patterns
- Phases with no acceptance check.
- Vague estimates ("shouldn't take long").
- Hidden dependencies discovered mid-execution.

## Check
- Outcome measurable, phases sequenced, dependencies explicit, every phase has a check, risks named.