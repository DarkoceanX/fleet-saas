# Fleet SaaS — project instructions

## Scope and working agreement

This repository now contains a local Next.js/NestJS/PostgreSQL application plus the original configuration kit; it is not deployed.
Read README.md and docs/ASSUMPTIONS.md first. Use the user's language in replies.
Then consult docs/CODEX_HANDOFF.md and the affected current contract. Historical slice
and verification documents describe their dated state, not current runtime readiness.
Treat the architecture as a proposed baseline; preserve an existing application's
stack and conventions when adopting this kit. Do not report absent services as built.
Work on the authorized task until its acceptance criteria are met. Resolve routine
reversible implementation choices yourself; ask only when missing domain decisions
would materially change money, access, data retention, or an external commitment.
Do not infer permission to message people, publish, merge, spend, or deploy from a skill.
Honor authorization already given for the concrete action; do not ask twice.

## Start and finish

Inspect the current branch, working changes, relevant instructions and actual scripts.
If Git is absent, record the source path and before/after hashes; do not initialize Git
implicitly. Preserve a recoverable copy of the instructions being edited.
Preserve unrelated user changes. Choose a small vertical slice with an explicit outcome.
Read only the relevant documentation and skill. For each change, report behavior,
checks actually run, limitations and the next required action, if any.
Do not invent passing checks or run nonexistent application commands.

Application commands added in the first slice (Node.js 24, PostgreSQL 17):

```text
npm run typecheck
npm run lint
npm test
npm run test:integration
npm run build
npm run db:migrate
npm run db:seed
```

See docs/RUNBOOK.md for local start/stop and test database isolation. API contract:
docs/API.md. Role matrix and scope: docs/FIRST_SLICE.md and docs/SECOND_SLICE.md. Application CI is in
.github/workflows/app-checks.yml; starter CI remains separate.

Vehicle period costs: docs/VEHICLE_PERIOD.md. Integration tests require an explicit
PERIOD_TEST_DATABASE_URL for a separate local database named fleet_period_test;
they never fall back to .env. npm run test:period:browser uses an existing Chrome
binary selected by CHROME_BIN and a temporary profile with synthetic transport.
Recognized actual income and separate period financial result are implemented;
see docs/RECOGNIZED_INCOME.md. Never import historical estimate revenue as actual
without explicit recognition. Cost per unit uses gross costs, not costs net of income.

Starter commands (Python 3.11+, standard library only):

```text
python scripts/check_starter.py
python -m unittest discover -s tests -v
python scripts/calculate_trip.py examples/trip-cost.json
```

Run the affected checks after code changes. For documentation-only edits, check skill
metadata, links and consistency; do not run the application suite solely for prose.
Keep real commands consistent with package.json and CI. Record verification date,
environment, source snapshot, counts and skips. Separate mock DOM, real UI/API,
visual/mobile and restore evidence; old passing checks do not verify new sources.
Follow docs/RUNBOOK.md for isolated checks and actual backup/restore drills before
working migrations. The command list above does not authorize seed/setup or migration
against working data. Source, applied schema and running build are distinct states.

## Fleet invariants

- Obtain tenant context from authenticated membership, never only from request input.
  Check it for list, detail, update, export, background job and object-storage access.
- Enforce tenant-consistent relationships in the database, not only in UI filters.
- Current roles: owner/dispatcher write operational fleet/trip data; all four roles
  read permitted operational data; only owner/accountant read and write finances.
  Membership management is not implemented. Preserve the current endpoint matrix;
  future business roles and changes to financial access require an explicit decision.
- Store money with currency and decimal precision; never binary float for authoritative
  totals. Separate estimate, recognized expense, recognized income and financial result;
  invoices/payments/tax accounting are not implemented. Follow docs/COST_CALCULATION.md,
  docs/VEHICLE_PERIOD.md and docs/RECOGNIZED_INCOME.md.
- Trip and vehicle-period views share primary sources: one source has one monetary
  effect. Record source ID, recognition date, vehicle, completeness and correction
  policy; never silently transfer history after reassignment or infer actuals from plans.
- Cost per km/work hour uses gross expenses; income affects the separate result only.
  Km, actual work hours and engine hours are independent. Unknown, partial and confirmed
  zero differ; entries alone do not prove completeness. Keep review invalidation.
- Include all applicable expense groups without duplication. Do not invent shared-cost
  allocation or automatic splitting; preserve explicit recognized shares and their basis.
- Preserve tariff snapshots and calculation version. Tariff edits must not silently
  rewrite completed-trip history. Record corrections with an audit reason.
- Use UTC instants with explicit display timezones; keep date-only fields date-only.
- Validate units, nonnegative inputs, pagination and allowed status transitions.
- Use synthetic fixtures. Redact credentials, driver personal data and precise location
  data from logs, examples, screenshots and external agent task descriptions.
- Make imported provider events idempotent per tenant and provider event ID.
- Use additive migrations first; document backfill, locking, verification and recovery.

## Code Review Rules

Flag demonstrated cross-tenant reads/writes, unguarded role changes, duplicate money
effects, incorrect decimal/margin math, destructive migrations, and exposed secrets.
Give a concrete reproduction and consequence for each finding. Do not label style
preferences as defects. Review both intended behavior and failure/retry paths.

## Relevant skills and references

Use fleet-plan for scope; fleet-api for endpoints; fleet-ui for screens; fleet-data
for migrations and tenant isolation; fleet-costing for financial-domain calculations;
fleet-release for verification and release preparation. These are workflows, not
six automatically spawned agents. docs/HYBRID_CODEX.md defines handoff evidence.
