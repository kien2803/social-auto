---
name: security
description: Security review workflow. Use when the user asks to threat-model, audit, or harden code — for input handling, auth, secrets, supply chain, infra, or data protection.
---

# Security

## When to use
- User asks for a security review, threat model, hardening, or asks "is this safe".
- Trigger phrases: "security", "threat model", "vulnerability", "auth", "secrets", "PII", "injection", "XSS", "SSRF", "CVE", "hardening".
- Use when the change touches auth, input, secrets, network egress, or sensitive data.

## Workflow

### 1. Frame
- Identify the trust boundary: who/what is trusted, where does untrusted enter?
- Identify the data classes: secrets, PII, financial, credentials, tokens.

### 2. Threat Model
- Top threats for this surface (STRIDE-lite or just a short list):
  - Spoofing / auth bypass
  - Tampering / input injection (SQLi, XSS, command, path)
  - Repudiation / log gaps
  - Information disclosure (verbose errors, leaked secrets)
  - Denial of service (unbounded input, expensive ops)
  - Elevation of privilege (missing auth checks)
- For each threat: where in code does it apply, what's the mitigation.

### 3. Audit
- Input handling: validated, length-bounded, escaped at the boundary.
- Auth: enforced at the boundary, checked on every privileged call.
- Secrets: not in code, not in logs, not in URLs, rotated.
- Dependencies: known-vuln check (npm audit / pip-audit / govulncheck).
- Network egress: SSRF risk on user-controlled URLs; DNS pinning for fetches.
- Crypto: standard libraries, never homegrown; right primitive for the job.
- Sessions: secure cookie flags, CSRF on state-changing routes.
- CORS / CSP / headers: explicit policy, not defaults.

### 4. Verify
- Reproduce the issue if it's a known vuln. Confirm the fix removes the path.
- Add a regression test (input that previously triggered the bug).
- For infra: confirm secret rotation, IAM scoping, network policy.

### 5. Report
- Findings ranked: Critical / High / Medium / Low / Info.
- Each finding: where, why it matters, concrete fix, validation step.
- One-line summary verdict at the top.

## Anti-patterns
- "Just add HTTPS" as a complete answer.
- Rolling your own crypto.
- Logging tokens / secrets / passwords even when "debug only".
- Trusting client input for auth decisions.

## Check
- Trust boundary drawn, threats ranked, fixes concrete, regressions tested.