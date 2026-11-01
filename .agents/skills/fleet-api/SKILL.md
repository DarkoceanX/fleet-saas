---
name: fleet-api
description: Implement or change Fleet SaaS HTTP endpoints, authorization, validation, idempotency and API tests.
---

# Build a Fleet API slice

Read [API](../../../docs/API.md), relevant API/shared code and, for finance,
[period](../../../docs/VEHICLE_PERIOD.md) / [income](../../../docs/RECOGNIZED_INCOME.md).
Respect the real framework and contracts; the starter architecture is a proposal.

1. Define request/response schemas, status codes, pagination and error shape.
   Money crosses JSON as decimal strings with currency, not floats.
2. Resolve tenant from verified membership. Validate both the route entity and
   related IDs against it. Apply the role check to every operation, including exports.
3. Put business behavior in the domain/application layer and keep controllers thin.
   Use transactions for assignments, expenses, income, reviews and their audit records
   as specified by the operation. Keep source, recognition date and vehicle explicit.
4. For retryable mutations preserve the documented tenant/user/operation key scope, store request
   identity and result, and reject key reuse with different payload. Concurrency
   protection must be enforced by a unique constraint, not a read-then-insert alone.
5. Test success, unauthenticated/forbidden access, tenant A requesting tenant B,
   invalid related IDs, duplicate retries and relevant concurrent writes.
6. Update the contract and report the executed tests and any integration gap.

Example task: POST trip expense must produce exactly one expense on request retry.
Do not implement payment collection merely because the endpoint records an expense.

## Financial failure paths

Distinguish transport retries from business-source uniqueness. Check version on
corrections/void and expected_revision on reviews; preserve conflict responses and
completeness invalidation rather than automatically overwriting stale data.

Record affected method x role x tenant x linked-ID coverage, including reads and
exclusion of finances from general trip responses. Test commit followed by lost reply:
identical retry returns one effect, changed payload with the same key conflicts.
Verify financial sums and audit effects, not only HTTP codes. Use
[RUNBOOK](../../../docs/RUNBOOK.md) for explicit isolated test-database setup.
