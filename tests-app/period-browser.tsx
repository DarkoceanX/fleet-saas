import React from "react";
import { createRoot } from "react-dom/client";
import {
  calculatePeriod,
  summarizeIncome,
  type IncomeEntry,
  type PeriodEntry,
  type PeriodReading,
} from "@fleet/shared";
import { PeriodPanel } from "../apps/web/app/period-ui";
import { runExpenseRegressions } from "./expense-ui-regressions";

// Real React + browser DOM; only transport is synthetic. No backend or user database.
const root = createRoot(document.getElementById("root")!);
const records: PeriodEntry[] = [
  {
    id: "base",
    source: "manual",
    source_id: "base",
    vehicle_id: "synthetic",
    date: "2026-09-15",
    category: "fuel",
    amount: "50000",
    note: "Baseline",
    version: 1,
    source_version: null,
    voided: false,
    source_warning: false,
  },
];
const readings: PeriodReading[] = [
  {
    id: "start",
    date: "2026-09-01",
    km: "10000",
    work_hours: "400",
    engine_hours: "500",
    note: "start",
    version: 1,
  },
  {
    id: "end",
    date: "2026-10-01",
    km: "11000",
    work_hours: "440",
    engine_hours: "550",
    note: "end",
    version: 1,
  },
];
const writes: {
  path: string;
  body: Record<string, string | number | null>;
  key: string;
}[] = [];
const seen = new Map<string, unknown>();
const incomes: IncomeEntry[] = [];
let revision = 1,
  loseNextResponse = false;
window.confirm = () => true;
window.prompt = () => "Synthetic cancellation basis";
window.fetch = async (input, options) => {
  const path = String(input)
    .replace("/api/v1", "")
    .replace("/vehicles/synthetic/period", "");
  if (path.startsWith("/vehicles?"))
    return Response.json({
      items: [{ id: "synthetic", name: "Synthetic", plate: "TEST" }],
      has_more: false,
    });
  if (path.startsWith("/trips?"))
    return Response.json({ items: [], has_more: false });
  if (!options?.method || options.method === "GET")
    return Response.json({
      profile: { ownership: "owned", version: 1 },
      readings,
      pending_sources: [],
      recognized_elsewhere: [],
      income: {
        entries: incomes,
        recognized_elsewhere: [],
        summary: summarizeIncome(
          incomes,
          revision,
          null,
          calculatePeriod({
            ownership: "owned",
            start_date: "2026-09-01",
            end_date: "2026-09-30",
            readings,
            entries: records,
            revision,
          }).total_cost,
          false,
        ),
      },
      report: calculatePeriod({
        ownership: "owned",
        start_date: "2026-09-01",
        end_date: "2026-09-30",
        readings,
        entries: records,
        revision,
      }),
    });
  const body = JSON.parse(String(options.body)) as Record<
    string,
    string | number | null
  >;
  const key = new Headers(options.headers).get("Idempotency-Key")!;
  writes.push({ path, body, key });
  if (seen.has(key)) return Response.json(seen.get(key));
  const parts = path.split("/");
  const collection =
    parts[1] === "income" ? incomes : parts[1] === "costs" ? records : readings;
  const id = parts[2],
    row = collection.find((r) => r.id === id);
  if (parts[3] === "void")
    Object.assign(row!, { voided_at: "2026-10-24", version: row!.version + 1 });
  else if (parts[3] === "delete")
    collection.splice(
      collection.findIndex((r) => r.id === id),
      1,
    );
  else if (row) Object.assign(row, body, { version: row.version + 1 });
  else if (parts[1] === "income")
    incomes.push({
      ...body,
      id: crypto.randomUUID(),
      version: 1,
      voided_at: null,
      source_warning: false,
    } as IncomeEntry);
  else if (parts[1] === "costs")
    records.push({
      ...records[0],
      ...body,
      id: crypto.randomUUID(),
      source_id: "new",
      version: 1,
    } as PeriodEntry);
  else
    readings.push({
      ...body,
      id: crypto.randomUUID(),
      version: 1,
    } as PeriodReading);
  revision++;
  const response = { ok: true };
  seen.set(key, response);
  if (loseNextResponse) {
    loseNextResponse = false;
    throw new Error("Synthetic lost response after commit");
  }
  return Response.json(response);
};
function check(ok: unknown, message: string) {
  if (!ok) throw new Error(message);
}
const pause = () => new Promise((resolve) => setTimeout(resolve, 20));
async function waitFor(fn: () => unknown) {
  for (let i = 0; i < 100; i++) {
    if (fn()) return;
    await pause();
  }
  throw new Error("DOM condition timed out");
}
function button(label: string, within: ParentNode = document) {
  const b = Array.from(within.querySelectorAll("button")).find(
    (b) => b.textContent === label,
  );
  check(b, `Button missing: ${label}`);
  return b!;
}
async function click(label: string, within: ParentNode = document) {
  button(label, within).click();
  await pause();
}
async function input(selector: string, value: string) {
  const el = document.querySelector<HTMLInputElement>(selector);
  check(el, `Input missing: ${selector}`);
  Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!.call(el, value);
  el!.dispatchEvent(new Event("input", { bubbles: true }));
  el!.dispatchEvent(new Event("change", { bubbles: true }));
  await pause();
}
const editor = () =>
  document.querySelector<HTMLFormElement>('form[aria-label="Редактор записи"]');
async function save() {
  await click("Сохранить запись", editor()!);
  await waitFor(() => !editor());
}
function rowWith(text: string) {
  const row = Array.from(document.querySelectorAll("tr")).find((r) =>
    r.textContent?.includes(text),
  );
  check(row, `Row missing: ${text}`);
  return row!;
}
function total(value: string) {
  check(
    document.querySelector('[data-testid="period-total"]')?.textContent ===
      `${value} RUB`,
    `Expected total ${value}`,
  );
}
const passed: string[] = [];
async function run() {
  root.render(<PeriodPanel vehicleId="synthetic" />);
  await waitFor(() => document.querySelector('[aria-label="Начало периода"]'));
  await input('[aria-label="Начало периода"]', "2026-09-01");
  await input('[aria-label="Конец периода"]', "2026-09-30");
  await click("Рассчитать период");
  await waitFor(() => document.querySelector('[data-testid="period-total"]'));
  total("50000.00");
  passed.push("baseline render");
  await click("Добавить ручной расход");
  await input('[name="amount"]', "10000");
  await input('[name="note"]', "Specific cost");
  await save();
  total("60000.00");
  check(
    writes.at(-1)?.path === "/costs" && !("version" in writes.at(-1)!.body),
    "Add must not carry stale ID/version",
  );
  passed.push("cost add");
  const row = rowWith("Specific cost");
  await click("Изменить расход", row);
  await input('[name="amount"]', "20000");
  await save();
  total("70000.00");
  check(
    writes.at(-1)?.path.startsWith("/costs/") &&
      writes.at(-1)?.body.version === 1,
    "Edit must target existing version",
  );
  passed.push("cost edit");
  await click("Изменить расход", rowWith("Specific cost"));
  await click("Отмена");
  await click("Добавить ручной расход");
  check(
    document.querySelector<HTMLInputElement>('[name="amount"]')?.value === "",
    "Cancelled edit must not populate Add",
  );
  await click("Отмена");
  passed.push("cancel clears cost edit");
  await click("Удалить расход", rowWith("Specific cost"));
  await waitFor(() => !document.body.textContent?.includes("Specific cost"));
  total("50000.00");
  passed.push("cost delete");
  await click("Добавить ручной расход");
  await input('[name="amount"]', "1");
  await input('[name="note"]', "Fresh after delete");
  await save();
  check(writes.at(-1)?.path === "/costs", "Add after delete targeted stale ID");
  passed.push("cost add after delete");
  await click("Добавить показания");
  await input('[name="date"]', "2026-09-10");
  await input('[name="km"]', "10100");
  await save();
  check(
    writes.at(-1)?.body.work_hours === null,
    "Blank work hours must be unknown",
  );
  passed.push("reading add keeps unknown");
  await click("Изменить показания", rowWith("2026-09-10"));
  await input('[name="work_hours"]', "0");
  await save();
  check(writes.at(-1)?.body.work_hours === "0", "Known zero lost");
  passed.push("reading edit preserves zero");
  await click("Изменить показания", rowWith("2026-09-10"));
  await click("Отмена");
  await click("Добавить показания");
  check(
    document.querySelector<HTMLInputElement>('[name="km"]')?.value === "",
    "Reading Add retained old values",
  );
  await click("Отмена");
  passed.push("cancel clears reading edit");
  await click("Удалить показания", rowWith("2026-09-10"));
  await click("Добавить показания");
  await input('[name="date"]', "2026-09-11");
  await input('[name="km"]', "10101");
  await save();
  check(writes.at(-1)?.path === "/readings", "New reading targeted deleted ID");
  passed.push("reading delete then add");
  await click("Добавить ручной расход");
  await input('[name="amount"]', "7");
  await input('[name="note"]', "Retry cost");
  loseNextResponse = true;
  await click("Сохранить запись", editor()!);
  await waitFor(() => document.querySelector('[role="alert"]'));
  check(editor(), "Network error lost form");
  const failedKey = writes.at(-1)!.key;
  await save();
  check(
    writes.at(-1)?.key === failedKey,
    "Lost response retry changed idempotency key",
  );
  check(
    records.filter((r) => r.note === "Retry cost").length === 1,
    "Retry duplicated actual cost",
  );
  passed.push("lost response retry once");
  await click("Изменить расход", rowWith("Retry cost"));
  await click("Рассчитать период");
  check(!editor(), "Changing period retained editor");
  passed.push("period change clears editor");
  await waitFor(() => document.querySelector('[data-testid="income-total"]'));
  check(
    document.querySelector('[data-testid="income-total"]')?.textContent ===
      "неизвестно",
    "Empty income must be unknown",
  );
  passed.push("income starts unknown");
  await click("Добавить фактический доход");
  check(
    document.querySelector<HTMLInputElement>('[name="income_date"]')?.value ===
      "",
    "Recognition date must not be guessed",
  );
  await input('[name="income_date"]', "2026-09-20");
  await input('[name="income_amount"]', "80000");
  await input('[name="income_ref"]', "BROWSER-INCOME");
  await input('[name="income_note"]', "Synthetic income");
  await click("Сохранить доход");
  await waitFor(
    () => !document.querySelector('[aria-label="Редактор дохода"]'),
  );
  check(
    writes.at(-1)?.path === "/income" && !("version" in writes.at(-1)!.body),
    "New income retained edit identity",
  );
  check(
    document.querySelector('[data-testid="income-total"]')?.textContent ===
      "80000.00 RUB",
    "Income sum not rendered",
  );
  total("50008.00");
  passed.push("income add leaves gross cost unchanged");
  await click("Изменить доход", rowWith("BROWSER-INCOME"));
  await input('[name="income_amount"]', "90000");
  await input('[name="income_reason"]', "Correct synthetic amount");
  await click("Сохранить доход");
  await waitFor(
    () => !document.querySelector('[aria-label="Редактор дохода"]'),
  );
  check(writes.at(-1)?.body.version === 1, "Income edit lost version");
  check(
    document.querySelector('[data-testid="income-result"]')?.textContent ===
      "39992.00 RUB",
    "Income result incorrect",
  );
  passed.push("income edit recalculates separate result");
  await click("Изменить доход", rowWith("BROWSER-INCOME"));
  await click("Отмена дохода");
  await click("Добавить фактический доход");
  check(
    document.querySelector<HTMLInputElement>('[name="income_amount"]')
      ?.value === "",
    "Income Add retained cancelled edit",
  );
  await click("Отмена дохода");
  passed.push("income cancel clears identity");
  await click("Аннулировать доход", rowWith("BROWSER-INCOME"));
  await waitFor(
    () =>
      document.querySelector('[data-testid="income-total"]')?.textContent ===
      "неизвестно",
  );
  check(incomes[0].voided_at, "Income void lost source history");
  passed.push("income void retains history and unknown status");
  await click("Добавить фактический доход");
  await input('[name="income_date"]', "2026-09-21");
  await input('[name="income_amount"]', "0");
  await input('[name="income_ref"]', "ZERO-RETRY");
  await input('[name="income_note"]', "Known zero income");
  loseNextResponse = true;
  await click("Сохранить доход");
  await waitFor(() => document.querySelector('[role="alert"]'));
  const incomeKey = writes.at(-1)!.key;
  check(
    document.querySelector<HTMLInputElement>('[name="income_amount"]')
      ?.value === "0",
    "Lost response must preserve known zero",
  );
  await click("Сохранить доход");
  await waitFor(
    () => !document.querySelector('[aria-label="Редактор дохода"]'),
  );
  check(
    writes.at(-1)?.path === "/income" && writes.at(-1)?.key === incomeKey,
    "Income add after void or retry used wrong identity",
  );
  check(
    incomes.filter((e) => e.source_ref === "ZERO-RETRY").length === 1,
    "Income retry duplicated source",
  );
  passed.push("income add after void and lost response retry once");
  root.unmount();
  const regressions = await runExpenseRegressions();
  passed.push(...regressions.passed);
  const output = document.getElementById("result")!;
  output.dataset.status = regressions.failed.length ? "failed" : "passed";
  output.textContent = JSON.stringify({
    passed: passed.length,
    cases: passed,
    failed: regressions.failed,
  });
}
void run().catch((e) => {
  const out = document.getElementById("result")!;
  out.dataset.status = "failed";
  out.textContent = JSON.stringify({ passed, error: String(e), writes });
});
