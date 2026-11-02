import React, { act } from "react";
import { createRoot } from "react-dom/client";
import {
  calculatePeriod,
  periodPage,
  summarizeIncome,
  type PeriodEntry,
  type IncomeEntry,
} from "@fleet/shared";
import { PeriodPanel } from "../apps/web/app/period-ui";
const pause = () => new Promise((r) => setTimeout(r, 20));
// Flush React work for controlled request-order tests instead of assuming that
// a render has committed after one 20 ms timer. Keep the setting local to act.
async function flushReact(action: () => void) {
  const environment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };
  const previous = environment.IS_REACT_ACT_ENVIRONMENT;
  environment.IS_REACT_ACT_ENVIRONMENT = true;
  try {
    await act(async () => {
      action();
    });
  } finally {
    if (previous === undefined) delete environment.IS_REACT_ACT_ENVIRONMENT;
    else environment.IS_REACT_ACT_ENVIRONMENT = previous;
  }
}
function check(v: unknown, message: string): asserts v {
  if (!v) throw Error(message);
}
async function wait(fn: () => unknown) {
  for (let i = 0; i < 100; i++) {
    if (fn()) return;
    await pause();
  }
  throw Error("Pagination DOM wait timed out");
}
function button(h: ParentNode, text: string) {
  const b = [...h.querySelectorAll("button")].find(
    (e) => e.textContent?.trim() === text,
  );
  check(b, `Missing ${text}`);
  return b;
}
async function click(h: ParentNode, text: string) {
  button(h, text).click();
  await pause();
}
async function input(h: ParentNode, selector: string, value: string) {
  const e = h.querySelector<HTMLInputElement>(selector);
  check(e, selector);
  Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!.call(e, value);
  e.dispatchEvent(new Event("input", { bubbles: true }));
  await pause();
}
async function select(h: ParentNode, name: string, value: string) {
  const e = h.querySelector<HTMLSelectElement>(`[name="${name}"]`);
  check(e, name);
  e.value = value;
  check(e.value === value, "Choice missing");
  e.dispatchEvent(new Event("change", { bubbles: true }));
  await pause();
}
async function open(h: ParentNode, month = "09") {
  await wait(() => h.querySelector('[aria-label="Начало периода"]'));
  await input(h, '[aria-label="Начало периода"]', `2026-${month}-01`);
  await input(h, '[aria-label="Конец периода"]', `2026-${month}-28`);
  await click(h, "Рассчитать период");
  await wait(() => h.querySelector('[data-testid="period-total"]'));
}
function fixture() {
  const costs: PeriodEntry[] = Array.from({ length: 45 }, (_, i) => ({
    id: `cost-${String(i).padStart(3, "0")}`,
    source: "manual",
    source_id: `source-${i}`,
    vehicle_id: "synthetic",
    date: "2026-09-15",
    category: "fuel",
    amount: "1.00",
    note: `Synthetic cost ${i}`,
    version: 1,
    source_version: null,
    voided: false,
    source_warning: false,
  }));
  const incomes: IncomeEntry[] = costs.map((e, i) => ({
    id: `income-${i}`,
    vehicle_id: "synthetic",
    trip_id: null,
    recognized_on: e.date,
    amount: "2.00",
    currency: "RUB",
    source_ref: `BASIS-${i}`,
    note: "Synthetic",
    version: 1,
    voided_at: null,
    source_warning: false,
  }));
  let revision = 1,
    hold = false,
    rejectPage = false,
    lose = false;
  const held: {
    resolve: (r: Response) => void;
    reject: (e: Error) => void;
    response: Response;
  }[] = [];
  const requests: URL[] = [],
    writes: { body: Record<string, unknown>; key: string }[] = [],
    seen = new Set<string>();
  window.fetch = async (url, options) => {
    const u = new URL(String(url), "http://fixture.local");
    if (u.pathname === "/api/v1/vehicles" || u.pathname === "/api/v1/trips")
      return Response.json({ items: [], has_more: false });
    if (options?.method === "POST") {
      const body = JSON.parse(String(options.body)),
        key = new Headers(options.headers).get("Idempotency-Key")!;
      writes.push({ body, key });
      if (!seen.has(key)) {
        seen.add(key);
        revision++;
        if (lose) {
          lose = false;
          throw Error("Synthetic lost reply after commit");
        }
      }
      return Response.json({ id: "saved" });
    }
    if (u.pathname.endsWith("/entries")) {
      requests.push(u);
      const kind = u.searchParams.get("kind"),
        offset = Number(u.searchParams.get("offset"));
      const response = rejectPage
        ? Response.json(
            { error: { message: "Данные периода изменились" } },
            { status: 409 },
          )
        : Response.json(
            kind === "costs"
              ? periodPage(costs, 20, offset, revision)
              : periodPage(incomes, 20, offset, revision),
          );
      if (hold)
        return new Promise<Response>((resolve, reject) =>
          held.push({ resolve, reject, response }),
        );
      return response;
    }
    const range = {
      start_date: u.searchParams.get("start_date")!,
      end_date: u.searchParams.get("end_date")!,
    };
    const report = calculatePeriod({
      ...range,
      ownership: "owned",
      entries: costs,
      readings: [],
      revision,
    });
    const inc = range.start_date.startsWith("2026-09") ? incomes : [];
    const { items: c, ...cp } = periodPage(report.entries, 20, 0, revision),
      { items: i, ...ip } = periodPage(inc, 20, 0, revision);
    return Response.json({
      profile: { ownership: "owned", version: 1 },
      readings: [],
      pending_sources: [
        {
          id: "trip-source",
          trip_id: "trip",
          category: "fuel",
          amount: "1.00",
          incurred_on: "2026-09-15",
          note: "Synthetic receipt",
          version: 1,
        },
      ],
      recognized_elsewhere: [],
      report: { ...report, entries: c },
      income: {
        entries: i,
        recognized_elsewhere: [],
        summary: summarizeIncome(inc, revision, null, report.total_cost, false),
      },
      pages: { costs: cp, income: ip },
    });
  };
  return {
    requests,
    writes,
    held,
    hold: () => {
      hold = true;
    },
    releaseOne: (index: number, error = false) => {
      const [p] = held.splice(index, 1);
      check(p, "Missing held page request");
      if (error) p.reject(Error("Page transport failed"));
      else p.resolve(p.response);
    },
    release: (error = false) => {
      hold = false;
      for (const p of held.splice(0)) {
        if (error) p.reject(Error("Page transport failed"));
        else p.resolve(p.response);
      }
    },
    conflict: () => {
      rejectPage = true;
    },
    lose: () => {
      lose = true;
    },
  };
}
export async function runPaginationRegressions() {
  const passed: string[] = [],
    failed: { name: string; error: string }[] = [];
  async function test(
    name: string,
    fn: (
      h: HTMLElement,
      render: (vehicle: string | null) => void,
    ) => Promise<void>,
  ) {
    const h = document.createElement("div");
    document.body.append(h);
    const root = createRoot(h);
    try {
      await fn(h, (vehicle) =>
        root.render(vehicle ? <PeriodPanel vehicleId={vehicle} /> : null),
      );
      passed.push(name);
    } catch (e) {
      failed.push({ name, error: String(e) });
    } finally {
      root.unmount();
      h.remove();
    }
  }
  await test("pages: totals unchanged and exact final page", async (h, render) => {
    fixture();
    render("synthetic");
    await open(h);
    check(
      h.querySelectorAll('[data-testid="period-cost-row"]').length === 20,
      "Initial costs not paged",
    );
    check(
      h.querySelectorAll('[data-testid="income-row"]').length === 20,
      "Initial income not paged",
    );
    await click(h, "Загрузить ещё расходы");
    await click(h, "Загрузить ещё доходы");
    await click(h, "Загрузить ещё расходы");
    await click(h, "Загрузить ещё доходы");
    check(
      h.querySelectorAll('[data-testid="period-cost-row"]').length === 45,
      "Cost boundary lost",
    );
    check(
      h.querySelectorAll('[data-testid="income-row"]').length === 45,
      "Income boundary lost",
    );
    check(
      h.querySelector('[data-testid="period-total"]')?.textContent ===
        "45.00 RUB",
      "Total changed by page",
    );
    check(
      h.querySelector('[data-testid="income-result"]')?.textContent ===
        "45.00 RUB",
      "Result changed by page",
    );
    check(
      ![...h.querySelectorAll("button")].some(
        (b) => b.textContent === "Загрузить ещё расходы",
      ),
      "Tail still offers next page",
    );
  });
  await test("pages: concurrent kinds and duplicate click do not lose or duplicate rows", async (h, render) => {
    const f = fixture();
    render("synthetic");
    await open(h);
    f.hold();
    button(h, "Загрузить ещё расходы").click();
    button(h, "Загрузить ещё расходы").click();
    button(h, "Загрузить ещё доходы").click();
    await wait(() => f.held.length === 2);
    check(f.requests.length === 2, "Duplicate in-flight request");
    f.release();
    await wait(
      () =>
        h.querySelectorAll('[data-testid="period-cost-row"]').length === 40 &&
        h.querySelectorAll('[data-testid="income-row"]').length === 40,
    );
  });
  for (const error of [false, true])
    await test(`pages: stale ${error ? "error" : "success"} after period switch ignored`, async (h, render) => {
      const f = fixture();
      render("synthetic");
      await open(h);
      f.hold();
      await click(h, "Загрузить ещё расходы");
      await open(h, "10");
      f.release(error);
      await pause();
      check(
        h.querySelectorAll('[data-testid="period-cost-row"]').length === 0,
        "Old period appended",
      );
      check(!h.querySelector('[role="alert"]'), "Old page error shown");
    });
  await test("pages: vehicle switch resets state and ignores held income", async (h, render) => {
    const f = fixture();
    render("synthetic");
    await open(h);
    f.hold();
    await click(h, "Загрузить ещё доходы");
    render("second");
    await pause();
    f.release();
    await pause();
    check(
      !h.querySelector('[data-testid="income-total"]'),
      "Previous vehicle data remained",
    );
    check(
      h.querySelector<HTMLInputElement>('[aria-label="Начало периода"]')
        ?.value === "",
      "Vehicle range not reset",
    );
  });
  await test("pages: conflict retains draft and requires refresh", async (h, render) => {
    const f = fixture();
    render("synthetic");
    await open(h);
    await click(h, "Добавить ручной расход");
    await input(h, '[name="note"]', "Preserved draft");
    f.conflict();
    await click(h, "Загрузить ещё расходы");
    await wait(() => h.querySelector('[role="alert"]'));
    check(
      h.querySelector<HTMLInputElement>('[name="note"]')?.value ===
        "Preserved draft",
      "Conflict erased draft",
    );
    check(
      button(h, "Загрузить ещё расходы").disabled,
      "Conflict allows mixed revision",
    );
    await click(h, "Обновить отчёт периода");
    check(
      !button(h, "Загрузить ещё расходы").disabled,
      "Refresh did not release paging",
    );
  });
  await test("pages: selected replacement survives refresh and identical lost-reply retry", async (h, render) => {
    const f = fixture();
    render("synthetic");
    await open(h);
    await click(h, "Признать источник");
    await click(h, "Загрузить ещё записи для замены");
    await select(h, "replace_entry_id", "cost-025");
    await select(h, "category", "fuel");
    await input(h, '[name="note"]', "Replacement basis");
    await click(h, "Обновить отчёт периода");
    check(
      h.querySelector<HTMLSelectElement>('[name="replace_entry_id"]')?.value ===
        "cost-025",
      "Replacement outside first page lost",
    );
    f.lose();
    await click(h, "Сохранить запись");
    await wait(() => h.querySelector('[role="alert"]'));
    await click(h, "Сохранить запись");
    await wait(() => !h.querySelector('[aria-label="Редактор записи"]'));
    check(
      f.writes.length === 2 && f.writes[0].key === f.writes[1].key,
      "Retry identity changed",
    );
    check(
      f.writes[1].body.replace_entry_id === "cost-025" &&
        f.writes[1].body.replace_version === 1,
      "Replacement/version changed",
    );
  });
  for (const kind of ["costs", "income"] as const)
    for (const oldError of [false, true])
      await test(`pages: refresh invalidates old page without blocking new request (${kind}, stale ${oldError ? "error" : "success"})`, async (h, render) => {
        const f = fixture();
        const label =
          kind === "costs" ? "Загрузить ещё расходы" : "Загрузить ещё доходы";
        const rows =
          kind === "costs"
            ? '[data-testid="period-cost-row"]'
            : '[data-testid="income-row"]';
        render("synthetic");
        await open(h);
        f.hold();
        await flushReact(() => button(h, label).click());
        check(f.held.length === 1, "Old page request did not start");

        await flushReact(() => button(h, "Обновить отчёт периода").click());
        check(
          h.querySelectorAll(rows).length === 20,
          "Refresh did not reset rows",
        );
        check(!button(h, label).disabled, "Refresh left page button disabled");

        // The replacement request must start while the old one is still pending.
        await flushReact(() => button(h, label).click());
        check(
          f.requests.length === 2,
          "New page request blocked after refresh",
        );
        check(Number(f.held.length) === 2, "New page request was not held");
        check(
          f.requests.every(
            (u) =>
              u.searchParams.get("kind") === kind &&
              u.searchParams.get("offset") === "20" &&
              u.searchParams.get("expected_revision") === "1",
          ),
          "Refresh changed the page kind, offset or revision",
        );

        await flushReact(() => f.releaseOne(0, oldError));
        check(
          h.querySelectorAll(rows).length === 20,
          "Old page applied after refresh",
        );
        check(
          !h.querySelector('[role="alert"]'),
          "Old page error shown after refresh",
        );
        check(
          button(h, label).disabled,
          "Old completion unlocked the new request",
        );
        await flushReact(() => button(h, label).click());
        check(
          f.requests.length === 2,
          "Old completion allowed a duplicate request",
        );

        await flushReact(() => f.release());
        check(
          h.querySelectorAll(rows).length === 40,
          "New page response did not render exactly once",
        );
        check(
          !button(h, label).disabled,
          "Completed new request left paging locked",
        );
        check(
          !h.querySelector('[role="alert"]'),
          "Stale error survived the new page",
        );
      });
  await test("pages: current network failure retries the same offset", async (h, render) => {
    const f = fixture();
    render("synthetic");
    await open(h);
    f.hold();
    await click(h, "Загрузить ещё доходы");
    f.release(true);
    await wait(() => h.querySelector('[role="alert"]'));
    check(
      !button(h, "Загрузить ещё доходы").disabled,
      "Current failure left busy",
    );
    await click(h, "Загрузить ещё доходы");
    check(
      f.requests.length === 2 &&
        f.requests.every((u) => u.searchParams.get("offset") === "20"),
      "Retry skipped page",
    );
    check(
      h.querySelectorAll('[data-testid="income-row"]').length === 40,
      "Retry duplicated rows",
    );
  });
  await test("pages: mutation invalidates held page before refresh", async (h, render) => {
    const f = fixture();
    render("synthetic");
    await open(h);
    f.hold();
    await click(h, "Загрузить ещё расходы");
    await click(h, "Признать источник");
    await select(h, "replace_entry_id", "none");
    await select(h, "category", "fuel");
    await input(h, '[name="note"]', "Synthetic recognition");
    await click(h, "Сохранить запись");
    await wait(() => !h.querySelector('[aria-label="Редактор записи"]'));
    f.release();
    await pause();
    check(
      h.querySelectorAll('[data-testid="period-cost-row"]').length === 20,
      "Pre-write page survived mutation",
    );
    await click(h, "Загрузить ещё расходы");
    check(
      f.requests.at(-1)?.searchParams.get("expected_revision") === "2",
      "New page kept old revision",
    );
  });
  await test("pages: unmount ignores held response without new reads", async (h, render) => {
    const f = fixture();
    render("synthetic");
    await open(h);
    f.hold();
    await click(h, "Загрузить ещё расходы");
    render(null);
    await pause();
    f.release(true);
    await pause();
    check(
      h.textContent === "" && f.requests.length === 1,
      "Unmount caused late UI/read",
    );
  });
  return { passed, failed };
}
