---
name: fleet-data
description: Design Fleet SaaS schemas and migrations, tenant isolation, backfills and database recovery checks.
---

# Change Fleet data safely

Read docs/ARCHITECTURE.md, current migrations and the actual database role setup.
Identify current data shape and supported old/new application versions.

1. Add tenant-consistent unique keys and composite foreign keys for tenant-owned
   relationships. Ensure list, export, worker and file metadata queries are scoped.
2. Prefer additive schema changes. Separate a large backfill from request handling;
   use bounded batches, checkpoints and safe retries. Estimate locks and index work.
3. If RLS is used, test with the production-like application role, not an owner or
   superuser. Verify tenant context reset under connection pooling and denial when
   context is absent. Application authorization is still required.
4. Document expand/backfill/switch/contract ordering and the failure recovery path.
   A down migration that deletes new data is not a complete recovery strategy.
5. Test a fresh database and an upgrade from the previous schema with synthetic
   data, including cross-tenant assignment and concurrent uniqueness conflicts.
6. Prepare changes and tests locally; apply remote/destructive changes only within
   the user's actual authorization. Report schema and application compatibility.

Example: adding driver_id to trips must not allow a driver from another tenant.

## Source integrity and recovery

For financial changes read [period sources](../../../docs/VEHICLE_PERIOD.md) and
[income sources](../../../docs/RECOGNIZED_INCOME.md).
[RUNBOOK](../../../docs/RUNBOOK.md) owns test isolation and recovery procedures.

Preserve source lineage: linked trip expenses reference live amounts/dates; income has
one record for trip and period views. Preserve unique expense links and normalized
income source_ref uniqueness, including after void. Manual replacement and corrections
retain documented audit/history rather than adding a second active amount.
Do not silently move financial history when a trip is reassigned; preserve the
different correction/transfer capabilities of expense links and income.

Verify version/revision conflicts, review invalidation and lock ordering during
concurrent source edits, void and reassignment. Preserve current conservative
tenant-wide invalidation unless a separately verified change replaces it; reviews
themselves must not invalidate each other. Current isolation uses application filters
and composite FK; do not claim RLS exists.

Before working migrations follow RUNBOOK's restore drill into a separate database
and retain comparison evidence. A successful pg_dump is not a restore test.
