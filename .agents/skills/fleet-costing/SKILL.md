---
name: fleet-costing
description: Implement or audit Fleet trip estimates, vehicle-period costs, recognized income and financial results with exact decimals and source traceability.
---

# Implement Fleet costing

Read docs/COST_CALCULATION.md and examples/trip-cost.json before changing formulas.
The Python script is a reference implementation, not a deployed finance service.

1. Identify planned versus actual inputs, units, currency and missing-field rules.
   Ask for an unresolved company rule if guessing would change the authoritative total.
2. Use Decimal or an equivalent exact decimal type. Follow documented line rounding
   and version the formula when behavior changes. Separate margin from markup.
3. Include empty mileage, applicable idle time, fuel, service, depreciation, tolls
   and overhead without double counting. Taxes and FX require explicit new rules.
4. Preserve tariff/input snapshots and historical estimates. Corrections must be
   traceable; never recompute completed trips silently after tariff edits.
5. Run the example and test boundary cases: zero distance, zero revenue, missing
   input, negative values, margin near 1, rounding ties, unexpected currency,
   and invalid/non-finite numbers. Test the target implementation against the example.
6. Report the numerical before/after result and business impact. Update the formula
   documentation, examples and relevant tests together.

Example check: cost 23980 and 20% margin imply price 29975, not 28776.

## Vehicle-period costs and income

Read [period costs](../../../docs/VEHICLE_PERIOD.md),
[income](../../../docs/RECOGNIZED_INCOME.md) and the relevant shared code/tests.
The Python example covers trip estimates, not the full period model. Legacy
revenue/actual_margin in a saved estimate is not recognized actual income.

Cover all applicable contract groups, including lubricants, tires, payroll and
repair/maintenance. Respect owned/rented applicability; do not add asset purchase
or loan principal over depreciation. Shared costs remain explicitly entered recognized
shares with a basis until allocation rules are agreed; do not invent automatic splitting.

Divide gross costs independently by km and actual work hours, never engine hours.
Income affects only the separate financial result. Idle periods retain expenses;
zero or missing activity yields unavailable rates. Preserve distinct rounding scales
for trip estimates and period rates.

For affected period behavior use golden cases for exact boundary readings,
unknown/known zero/partial data, invalidated reviews, source recognition/replacement/
void and reassignment. Entries alone do not prove completeness; expense and income
reviews remain separate.

Example: expenses 50000 RUB, 1000 km and 40 work hours give 50/km and 1250/hour at
any income. Income 100000 gives result 50000; unknown income gives no result;
confirmed zero gives -50000. Final completeness requires both current reviews.
