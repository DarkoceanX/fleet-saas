---
name: fleet-release
description: Review and verify Fleet SaaS changes, prepare evidence-backed pull requests and plan authorized releases and recovery.
---

# Verify and prepare a Fleet release

Read docs/ACCEPTANCE.md and the actual changed files, CI configuration and task.
Use the real application commands when present; starter checks cover only the kit.

1. Compare delivered behavior to acceptance criteria. Prioritize tenant isolation,
   role checks, decimal money, concurrency, migrations and secret exposure.
2. Run the checks affected by the change. For each failure, reproduce and identify
   whether the change introduced it; do not hide failures with skipped checks.
3. Give actionable review findings with path, reproduction and consequence.
   Distinguish observed defects from untested risks and style preferences.
4. Prepare the PR description with behavior, exact validation results and migration
   or recovery notes. Create/push the PR only when within authorized scope.
5. For a requested deployment, verify the target, permissions, migration order,
   backup/recovery evidence and smoke checks. Preserve existing authorization;
   when approval is required, present the concrete ready-to-run result first.
6. Report what actually ran, what remains unverified and a bounded handoff using
   templates/HANDOFF.md. Never equate a green starter CI with SaaS production readiness.

Example: a costing change needs numeric regression evidence and preserved history,
not just a screenshot of a successful screen.

## Verification evidence

Use [RUNBOOK](../../../docs/RUNBOOK.md) for test targets and restore procedures,
[handoff](../../../docs/CODEX_HANDOFF.md) for historical state, and the affected
[period](../../../docs/VEHICLE_PERIOD.md) / [income](../../../docs/RECOGNIZED_INCOME.md) contract.

Documentation-only edits need structure/link/consistency checks, not an automatic
application suite. Integration requires explicit isolated PERIOD_TEST_DATABASE_URL;
never use working data or setup/seed as a shortcut. Distinguish unit, HTTP/database,
mock-transport DOM, real UI/API smoke, visual/mobile, load and restore evidence.

Before working migrations require an actual isolated restore and verified financial/
source/history comparisons, not just a dump file. Record source, applied migration
checksums and running build separately; additive schema alone does not prove old-code
compatibility. Follow RUNBOOK instead of duplicating restore commands here.

Record date, environment, source commit or hashes, exact commands, pass/fail/skip
counts and gaps. Historical results describe their original run only. Without Git
compare before/after hashes and preserve a recoverable snapshot of changed
instructions; do not initialize Git implicitly.
