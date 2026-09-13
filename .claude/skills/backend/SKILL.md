---
name: backend
description: Backend engineering workflow. Use when the user asks to design, implement, debug, refactor, or review server-side code — APIs, databases, services, queues, auth, infra.
---

# Backend

## When to use
- User asks for API/server/service work, DB schema, auth, infra, or backend debugging.
- Trigger phrases: "backend", "API", "endpoint", "database", "schema", "migration", "service", "queue", "worker", "auth", "deploy".

## Workflow

### 1. Scope
- Identify the layer: HTTP API, RPC, worker, DB, infra, or integration.
- Identify the runtime: Node/Go/Python/Java/etc. Use existing repo patterns.

### 2. Research Before Editing
- Read the matching layer's existing files before writing new code.
- Use `lsp` for symbol-aware lookups when a language server is available.
- Check existing conventions: error shape, validation, logging, config loading, DI.
- NEVER introduce a second style. Match what's already there.

### 3. Design
- API contract first: routes, methods, request/response shapes, error codes.
- State transitions: explicit, idempotent where possible.
- Auth boundary: who can call what, enforced at the boundary, not deep in code.
- Failure modes: timeout, retry, dead-letter, partial success.

### 4. Implement
- Fix source; NEVER suppress a symptom (no try/catch swallowing).
- Migrations are forward-only in dev; reversible migration template in prod.
- Validation at the boundary (zod/joi/pydantic), not deep in business logic.
- Config via env, validated at boot. Never read env deep in call stacks.
- Structured logs with request IDs. NEVER log secrets/PII.

### 5. Verify
- Run the targeted test or smoke test for the changed path.
- Run the project's linter and type checker on touched files.
- For API changes: hit the endpoint (curl/script) and inspect the response.

### 6. Cleanup
- Remove obsolete endpoints, deprecated config, dead migration paths.
- Update API docs / OpenAPI / README when contracts change.

## Anti-patterns
- Second error format next to existing one.
- N+1 queries, missing indexes on hot paths.
- Secrets in code or logs.
- Catch-all `try/catch` that hides bugs.
- "Just add a feature flag" without an expiry/owner.

## Check
- Schema correct, indexes for query shape, auth at boundary, errors are real errors, tests cover the changed contract.