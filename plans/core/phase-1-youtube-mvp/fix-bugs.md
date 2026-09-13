# Phase 1 — Fix-bugs Log

## Status: no BUG-P1 entries logged

Phase 1 (YouTube MVP) shipped 2026-08-29 with `simulator --all = 5/5` pass and the original 6 test cases documented in `tests.md` covered by `core/api/src/routes/accounts.test.ts` + `core/api/src/routes/schedule.test.ts`. No bugs were filed against the YouTube upload path during the phase's development window.

The defect that did emerge — `accounts.ts:rows mapping off-by-N when the `external_id` migration (0004) added the second column` — was caught and fixed in Phase 3 (BUG-P3-005) when the worker started its own read path against the schema. That entry lives in [`../phase-3-polish/fix-bugs.md`](../phase-3-polish/fix-bugs.md) rather than here because:

- the bug surfaces only in the worker's `rowToAccount`, not in the API-side uploads that Phase 1 owned
- the fix touched Phase 3 cleanup scope (regression coverage for both api + worker mappers)

## BUG-XXX format

```
## BUG-XXX: <title>
- Discovered: <khi nào, test nào fail>
- Symptom: <mô tả>
- Root cause: <phân tích>
- Fix: <file:symbol thay đổi>
- Verification: <test pass, evidence>
- Status: open | fixed | wontfix
```
