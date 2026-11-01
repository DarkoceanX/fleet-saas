---
name: fleet-plan
description: Turn Fleet SaaS feature requests into scoped implementation tasks with tenant boundaries and verifiable acceptance criteria.
---

# Plan a Fleet feature

Read [current decisions](../../../docs/ASSUMPTIONS.md) and the relevant implementation.
Use [handoff](../../../docs/CODEX_HANDOFF.md) to distinguish source, running build and
database state; historical checks are not fresh verification. Architecture is a proposal.
For financial work read [period costs](../../../docs/VEHICLE_PERIOD.md) and
[recognized income](../../../docs/RECOGNIZED_INCOME.md).

1. Identify the actor, tenant, user-visible result and current behavior. Distinguish
   missing business decisions from routine implementation choices.
2. Choose one vertical slice across data, API and screen where applicable. State
   exclusions and dependencies; do not generate an unbounded roadmap for a small task.
3. Specify success, denial, invalid input and retry/concurrency cases. For money,
   state currency, units, rounding and whether figures are planned or actual.
4. Use templates/TASK.md to record scope, existing verification commands and
   acceptance examples. Mark proposed commands as future work until implemented.
5. For a new architectural choice, record the decision, an alternative and the
   tradeoff in the task. If the user asked for implementation too, proceed into it.

Example: “add planned trip costs” should include tariff snapshot persistence,
cross-tenant denial and the example totals from docs/COST_CALCULATION.md.
Output a task that another developer can complete without the chat history.

## Financial acceptance and handoff

Identify trip versus vehicle-period scope, primary source, recognition date, attributed
vehicle, completeness and correction policy. Describe how both views share one monetary
effect. Separate cost, income and financial result; km, work hours and engine hours are
independent. Include unknown/partial/confirmed-zero cases for affected financial reports.

Preserve implemented permissions. Record unresolved shared-cost allocation and new
financial access as business decisions, not implementation defaults. Product references
do not establish business rules. Without Git record source path and snapshot hashes
instead of inventing a branch or commit.
