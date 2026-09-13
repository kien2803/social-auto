---
name: review
description: Code review workflow. Use when the user asks for a review, audit, or critique of a change, a PR, or a slice of code — for correctness, design, and risk.
---

# Review

## When to use
- User asks for review, audit, critique, "what's wrong with this", pre-merge check.
- Trigger phrases: "review", "audit", "check this code", "what would you change", "pre-merge".
- Use AFTER a change exists or a proposal is concrete.

## Workflow

### 1. Frame
- State what is being reviewed and the stated intent.
- Identify the contract: what must this code do, what is out of scope.

### 2. Correctness
- Walk the changed path. Does it actually satisfy the contract?
- Edge cases: empty, null, large, concurrent, retry, partial failure.
- Error handling: are errors caught at the right boundary, or hidden?
- Resource lifecycle: opened/closed, allocated/freed, locked/unlocked.

### 3. Design
- Does it match existing patterns in this repo? Second style introduced?
- Abstraction: any needless indirection? Any duplication that should be deduped?
- Naming: are names load-bearing or noise?
- API surface: public methods/fields/props — are they all needed?

### 4. Risk
- Security: input trust boundaries, auth checks, secret handling.
- Performance: hot path, N+1, blocking calls, unbounded loops.
- Operability: logs, metrics, debuggability, rollback story.
- Compatibility: back-compat for callers, schema migrations, feature flags.

### 5. Verdict
- Approve / Approve with nits / Request changes.
- List concrete, actionable suggestions with file/symbol anchors.
- One "must fix" first; the rest as ranked list.

## Anti-patterns
- Style nits dressed as correctness issues.
- Vague feedback ("could be cleaner").
- Reviewing code that wasn't claimed to be in scope.

## Check
- Correctness verified against contract, design matches repo, risks named with mitigations, verdict is actionable.