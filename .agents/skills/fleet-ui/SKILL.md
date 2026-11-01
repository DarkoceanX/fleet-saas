---
name: fleet-ui
description: Build Fleet SaaS trip and vehicle-period screens with accessible forms, explicit financial states and reliable retries.
---

# Build a Fleet screen

Read the relevant task, API contract and existing UI components. Reuse the
product's design system. For a new screen, favor readable tables, clear labels
and one obvious primary action over decorative dashboards.

1. Specify loading, empty, success, validation, permission and network-error states.
2. Label km, liters, hours, money and currency. Preserve decimal strings until the
   server/domain parser; do not use browser float math as the authoritative total.
3. Make selection, keyboard navigation, focus and field-error associations usable.
   Preserve entered data after errors and prevent unintended duplicate submissions.
4. Hide unavailable actions for clarity, while keeping server authorization as the
   actual control. Do not expose financial values for an undefined role policy.
5. Show estimate versus actual, tariff/formula version and line-item breakdown.
   Missing values should appear as missing, not silently as zero.
6. Verify the primary flow at desktop and narrow widths, plus error recovery.
   Use existing UI/E2E tooling; record what was manually checked if automation is absent.

Example: trip-cost form explains a zero-distance per-km result as unavailable.
Deliver the working change and verification evidence, with screenshots when useful.

## Financial forms and interruption

For finance use [period](../../../docs/VEHICLE_PERIOD.md) and
[income](../../../docs/RECOGNIZED_INCOME.md); testing boundaries are in
[RUNBOOK](../../../docs/RUNBOOK.md). Product references guide requirements and visual
direction, not copying or authorization to change financial rules.

Verify Add/Edit/Cancel/Delete(or Void)/Add: a new draft has no stale ID/version.
A lost reply keeps payload/key for an identical retry; do not automatically create
a new operation when the outcome is unknown. A deliberate new draft/payload must not
reuse the old request identity. Handle version conflicts without silent overwrite.
Reset scoped editors on vehicle/period changes and ignore stale fetch responses,
including after unmount. Do not assume form.reset clears application edit state.

Label km, actual work hours and engine hours separately. Separate gross cost from
income/result; show unknown, partial, confirmed zero, invalidated reviews and source
warnings. Never infer recognition dates from payment/departure dates.

Record browser and viewport sizes; verify date/amount input, row actions, long labels,
focus, visible errors and horizontal table access. Mock-transport DOM checks do not
establish real API integration or visual/mobile acceptance.
