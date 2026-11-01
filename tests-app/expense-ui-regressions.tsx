import React, { type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  calculatePeriod,
  compareCosts,
  summarizeIncome,
  type Expense,
  type PeriodEntry,
  type Trip,
} from "@fleet/shared";
import { PeriodPanel } from "../apps/web/app/period-ui";
import { TripDetails } from "../apps/web/app/operations-ui";

// Real React/Chrome DOM, deliberately synthetic transport. Never calls a server.
const pause = () => new Promise((resolve) => setTimeout(resolve, 20));
function check(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}
async function waitFor(fn: () => unknown) {
  for (let i = 0; i < 100; i++) {
    if (fn()) return;
    await pause();
  }
  throw new Error("Expense regression DOM condition timed out");
}
function button(host: ParentNode, text: string) {
  const el = [...host.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === text,
  );
  check(el, `Missing button: ${text}`);
  return el;
}
async function click(host: ParentNode, text: string) {
  button(host, text).click();
  await pause();
}
async function input(host: ParentNode, selector: string, value: string) {
  const el = host.querySelector<HTMLInputElement>(selector);
  check(el, `Missing input: ${selector}`);
  Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  await pause();
}
async function select(host: ParentNode, name: string, value: string) {
  const el = host.querySelector<HTMLSelectElement>(`[name="${name}"]`);
  check(el, `Missing select: ${name}`);
  el.value = value;
  check(el.value === value, `Missing choice: ${name}=${value}`);
  el.dispatchEvent(new Event("change", { bubbles: true }));
  await pause();
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const income = () => ({
  entries: [],
  recognized_elsewhere: [],
  summary: summarizeIncome([], 1, null, "0.00", false),
});
const source = {
  id: "source-one",
  trip_id: "trip-one",
  category: "fuel",
  amount: "100.00",
  incurred_on: "2026-09-15",
  note: "Synthetic receipt",
  version: 1,
};
type Write = { path: string; key: string; body: Record<string, unknown> };

function periodFixture(linked = false) {
  const rows: PeriodEntry[] = [
    {
      id: "manual-one",
      source: linked ? "trip" : "manual",
      source_id: linked ? source.id : "manual-one",
      vehicle_id: "synthetic",
      date: source.incurred_on,
      category: "fuel",
      amount: source.amount,
      note: source.note,
      version: 1,
      source_version: linked ? 1 : null,
      voided: false,
      source_warning: linked,
    },
  ];
  const writes: Write[] = [],
    seen = new Set<string>();
  let loseReply = false;
  window.fetch = async (url, options) => {
    const path = String(url).replace("/api/v1", "");
    if (path.startsWith("/vehicles?") || path.startsWith("/trips?"))
      return Response.json({ items: [], has_more: false });
    if (options?.method === "POST") {
      check(path.endsWith("/recognize"), `Unexpected mutation ${path}`);
      const key = new Headers(options.headers).get("Idempotency-Key")!;
      const body = JSON.parse(String(options.body));
      writes.push({ path, key, body });
      if (!seen.has(key)) {
        seen.add(key);
        const old = rows.find((r) => r.id === body.replace_entry_id);
        const next: PeriodEntry = {
          ...rows[0],
          id: old?.id ?? "new-link",
          source: "trip",
          source_id: source.id,
          source_version: source.version,
          source_warning: false,
          version: (old?.version ?? 0) + 1,
        };
        if (old) Object.assign(old, next);
        else rows.push(next);
        if (loseReply) {
          loseReply = false;
          throw new Error("Synthetic committed recognition lost reply");
        }
      }
      return Response.json({ id: "link" });
    }
    check(path.includes("/period?"), `Unexpected read ${path}`);
    return Response.json({
      profile: { ownership: "owned", version: 1 },
      readings: [],
      pending_sources: rows.some((r) => r.source === "trip") ? [] : [source],
      recognized_elsewhere: [],
      income: income(),
      report: calculatePeriod({
        ownership: "owned",
        start_date: "2026-09-01",
        end_date: "2026-09-30",
        readings: [],
        entries: rows,
        revision: 1,
      }),
    });
  };
  return {
    rows,
    writes,
    loseNextReply: () => {
      loseReply = true;
    },
  };
}
const editor = (host: ParentNode) =>
  host.querySelector<HTMLFormElement>('form[aria-label="Редактор записи"]');
async function openSource(host: HTMLElement, linked = false) {
  await waitFor(() => host.querySelector('[aria-label="Начало периода"]'));
  await input(host, '[aria-label="Начало периода"]', "2026-09-01");
  await input(host, '[aria-label="Конец периода"]', "2026-09-30");
  await click(host, "Рассчитать период");
  await waitFor(() => host.querySelector('[data-testid="period-total"]'));
  await click(host, linked ? "Перепроверить связь" : "Признать источник");
  if (!linked) {
    await select(host, "category", "fuel");
    await input(host, '[name="note"]', "Synthetic receipt");
  }
}
function trip(id = "trip-one"): Trip {
  return {
    id,
    vehicle_id: "synthetic",
    vehicle_name: "Synthetic",
    plate: "TEST",
    origin: "A",
    destination: "B",
    departure_date: "2026-09-15",
    status: "draft",
    driver_id: null,
    driver_name: null,
    assignment_version: 1,
    started_at: null,
    completed_at: null,
    version: 1,
    created_at: "2026-09-01T00:00:00Z",
  };
}
function tripView(id = "trip-one") {
  return (
    <TripDetails
      key={id}
      trip={trip(id)}
      user={{
        user_id: "test",
        tenant_id: "test",
        name: "Test",
        organization: "Test",
        role: "accountant",
      }}
      onChange={() => {}}
      renderPlan={(changed) => (
        <button onClick={changed}>Synthetic revision</button>
      )}
    />
  );
}
function tripFixture() {
  const rows: Expense[] = [],
    writes: Write[] = [],
    seen = new Set<string>();
  const held: {
    pending: ReturnType<typeof deferred<Response>>;
    response: Response;
  }[] = [];
  let hasMore = false;
  let hold = false,
    failNext = false,
    loseReply = false;
  let post: ReturnType<typeof deferred<Response>> | null = null;
  let expenseReads = 0;
  window.fetch = async (url, options) => {
    const path = String(url).replace("/api/v1", "");
    if (options?.method === "POST") {
      const key = new Headers(options.headers).get("Idempotency-Key")!;
      const body = JSON.parse(String(options.body));
      writes.push({ path, key, body });
      if (!seen.has(key)) {
        seen.add(key);
        if (path.endsWith("/void"))
          Object.assign(rows[0], {
            version: 2,
            voided_at: "2026-09-16T00:00:00Z",
            void_reason: body.reason,
          });
        else
          rows.push({
            id: "expense-one",
            trip_id: "trip-one",
            ...body,
            version: 1,
            voided_at: null,
            void_reason: null,
            created_at: "2026-09-15T00:00:00Z",
          } as Expense);
        if (loseReply) {
          loseReply = false;
          throw new Error("Synthetic committed expense lost reply");
        }
      }
      return post ? post.promise : Response.json({ id: "expense-one" });
    }
    if (path.endsWith("/income")) return Response.json(income());
    if (
      path.includes("/status-history") ||
      path.startsWith("/vehicles?") ||
      path.startsWith("/trips?")
    )
      return Response.json({ items: [], has_more: false });
    check(
      path.includes("/expenses?") || path.endsWith("/comparison"),
      `Unexpected read ${path}`,
    );
    expenseReads++;
    const active = rows.filter((r) => !r.voided_at);
    // Capture at request time: a delayed response contains the OLD snapshot.
    const response = path.includes("/expenses?")
      ? Response.json({
          items: /offset=[1-9]/.test(path)
            ? [{ ...rows[0], id: "page-expense", note: "Synthetic older page" }]
            : rows,
          has_more: hasMore && !/offset=[1-9]/.test(path),
        })
      : Response.json({
          ...compareCosts(
            null,
            active.length ? { fuel: active[0].amount } : {},
            active.length,
          ),
          plan_id: null,
          plan_mode: "latest",
          assignment_version: null,
          plan_created_at: null,
        });
    if (hold) {
      const pending = deferred<Response>();
      held.push({ pending, response });
      return pending.promise;
    }
    if (failNext) {
      failNext = false;
      throw new Error("Synthetic GET failure");
    }
    return response;
  };
  return {
    rows,
    writes,
    held,
    reads: () => expenseReads,
    withMore: () => {
      hasMore = true;
    },
    holdReads: () => {
      hold = true;
    },
    allowReads: () => {
      hold = false;
    },
    release: (fail = false) => {
      for (const h of held.splice(0)) {
        if (fail) h.pending.reject(new Error("Synthetic stale GET failure"));
        else h.pending.resolve(h.response);
      }
    },
    failRead: () => {
      failNext = true;
    },
    loseNextReply: () => {
      loseReply = true;
    },
    holdPost: () => {
      post = deferred<Response>();
    },
    releasePost: () => {
      post!.resolve(Response.json({ id: "expense-one" }));
      post = null;
    },
  };
}
async function addExpense(host: HTMLElement) {
  await waitFor(() => host.querySelector(".expenses"));
  await click(host, "Факт и сравнение");
  await click(host, "＋ Добавить расход");
  await input(host, '.expenses input[inputmode="decimal"]', "100.00");
  await input(
    host,
    '.expenses input[placeholder^="Например"]',
    "Synthetic new receipt",
  );
  await click(host, "Сохранить расход");
}
function actual(host: ParentNode) {
  return host.querySelectorAll(".comparison-totals strong")[1]?.textContent;
}

export async function runExpenseRegressions() {
  const passed: string[] = [],
    failed: { name: string; error: string }[] = [];
  const previousFetch = window.fetch;
  async function test(
    name: string,
    run: (
      host: HTMLElement,
      render: (node: ReactNode) => void,
      unmount: () => void,
    ) => Promise<void>,
  ) {
    const host = document.createElement("div");
    document.body.append(host);
    let root: Root | null = createRoot(host);
    const unmount = () => {
      root?.unmount();
      root = null;
    };
    try {
      await run(host, (node) => root!.render(node), unmount);
      passed.push(name);
    } catch (e) {
      failed.push({ name, error: String(e) });
    } finally {
      unmount();
      host.remove();
      window.fetch = previousFetch;
    }
  }
  await test("F1: no implicit no-duplicate decision / native submit", async (host, render) => {
    const f = periodFixture();
    render(<PeriodPanel vehicleId="synthetic" />);
    await openSource(host);
    await click(host, "Сохранить запись");
    check(
      f.writes.length === 0,
      `Implicit decision sent POST; synthetic total=${f.rows.reduce((s, r) => s + Number(r.amount), 0)}`,
    );
    check(editor(host), "Unchosen decision closed editor");
  });
  await test("F1: handler rejects unchosen decision before transport", async (host, render) => {
    const f = periodFixture();
    render(<PeriodPanel vehicleId="synthetic" />);
    await openSource(host);
    editor(host)!.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
    await pause();
    check(f.writes.length === 0, "Submit handler allowed unchosen decision");
    check(
      host.querySelector('[role="alert"]'),
      "Missing actionable validation error",
    );
  });
  await test("F1: explicit replacement keeps one effect and original version", async (host, render) => {
    const f = periodFixture();
    render(<PeriodPanel vehicleId="synthetic" />);
    await openSource(host);
    await select(host, "replace_entry_id", "manual-one");
    await click(host, "Сохранить запись");
    await waitFor(() => !editor(host));
    check(
      f.rows.length === 1 && f.rows[0].source === "trip",
      "Replacement duplicated expense",
    );
    check(
      f.writes[0].body.replace_entry_id === "manual-one" &&
        f.writes[0].body.replace_version === 1,
      "Replacement identity/version changed",
    );
  });
  await test("F1: explicit new choice survives lost reply / identical retry", async (host, render) => {
    const f = periodFixture();
    render(<PeriodPanel vehicleId="synthetic" />);
    await openSource(host);
    await select(host, "replace_entry_id", "none");
    f.loseNextReply();
    await click(host, "Сохранить запись");
    await waitFor(() => host.querySelector('[role="alert"]'));
    check(editor(host), "Lost reply discarded editor");
    await click(host, "Сохранить запись");
    await waitFor(() => !editor(host));
    check(
      f.writes.length === 2 && f.writes[0].key === f.writes[1].key,
      "Retry lost request identity",
    );
    check(
      f.writes[0].body.replace_entry_id === null &&
        f.writes[0].body.replace_version === null &&
        f.rows.length === 2,
      "Explicit new payload/effect changed",
    );
  });
  await test("F1: cancel/reopen resets decision and draft", async (host, render) => {
    const f = periodFixture();
    render(<PeriodPanel vehicleId="synthetic" />);
    await openSource(host);
    await select(host, "replace_entry_id", "manual-one");
    await click(host, "Отмена");
    await click(host, "Признать источник");
    await select(host, "category", "fuel");
    await input(host, '[name="note"]', "Reopened receipt");
    await click(host, "Сохранить запись");
    check(
      f.writes.length === 0 && editor(host),
      "Reopening kept a prior decision",
    );
  });
  await test("F1: recheck existing link preserves fixed replacement", async (host, render) => {
    const f = periodFixture(true);
    render(<PeriodPanel vehicleId="synthetic" />);
    await openSource(host, true);
    check(
      host.querySelector<HTMLSelectElement>('[name="replace_entry_id"]')!
        .disabled,
      "Existing link became transferable",
    );
    await click(host, "Сохранить запись");
    await waitFor(() => !editor(host));
    check(
      f.writes[0].body.replace_entry_id === "manual-one" && f.rows.length === 1,
      "Recheck changed linked identity",
    );
  });
  await test("F1: period reload clears prior source decision", async (host, render) => {
    const f = periodFixture();
    render(<PeriodPanel vehicleId="synthetic" />);
    await openSource(host);
    await select(host, "replace_entry_id", "none");
    await click(host, "Рассчитать период");
    check(!editor(host), "Period reload retained source editor");
    await click(host, "Признать источник");
    await select(host, "category", "fuel");
    await input(host, '[name="note"]', "New period decision");
    await click(host, "Сохранить запись");
    check(
      f.writes.length === 0 && editor(host),
      "Period reload reused source decision",
    );
  });
  for (const failure of [false, true])
    await test(`F2: stale GET ${failure ? "error" : "success"} after save cannot overwrite current UI`, async (host, render) => {
      const f = tripFixture();
      f.holdReads();
      render(tripView());
      await waitFor(() => f.held.length === 2);
      f.allowReads();
      await addExpense(host);
      await waitFor(() => actual(host) === "100,00 ₽");
      f.release(failure);
      await pause();
      await pause();
      check(
        actual(host) === "100,00 ₽" &&
          host
            .querySelector(".expenses")!
            .textContent!.includes("Synthetic new receipt"),
        "Stale GET overwrote committed expense/total",
      );
      check(
        !host.querySelector('[role="alert"]'),
        "Stale GET overwrote current error state",
      );
    });
  await test("F2: in-flight read invalidated when mutation starts", async (host, render) => {
    const f = tripFixture();
    f.holdReads();
    render(tripView());
    await waitFor(() => f.held.length === 2);
    f.allowReads();
    f.holdPost();
    await addExpense(host);
    f.release(true);
    await pause();
    check(
      !host.querySelector('[role="alert"]'),
      "Old read error appeared during mutation",
    );
    f.releasePost();
    await waitFor(() => actual(host) === "100,00 ₽");
  });
  await test("F2: current read failure clears loading and can recover", async (host, render) => {
    const f = tripFixture();
    f.failRead();
    render(tripView());
    await waitFor(() => host.querySelector('[role="alert"]'));
    check(
      !button(host, "Обновить сравнение").disabled,
      "Current failure stuck loading",
    );
    await click(host, "Обновить сравнение");
    await waitFor(() => !host.querySelector('[role="alert"]'));
    check(!button(host, "Обновить сравнение").disabled, "Recovery left busy");
  });
  await test("F2: trip create lost reply keeps form/key and one effect", async (host, render) => {
    const f = tripFixture();
    render(tripView());
    f.loseNextReply();
    await addExpense(host);
    await waitFor(() => host.querySelector('[role="alert"]'));
    check(
      host.querySelector<HTMLInputElement>(
        '.expenses input[inputmode="decimal"]',
      )?.value === "100.00",
      "Lost reply discarded draft",
    );
    await click(host, "Сохранить расход");
    await waitFor(() => actual(host) === "100,00 ₽");
    check(
      f.rows.length === 1 &&
        f.writes.length === 2 &&
        f.writes[0].key === f.writes[1].key,
      "Create retry duplicated effect",
    );
  });
  await test("F2: void lost reply keeps version/key and one effect", async (host, render) => {
    const f = tripFixture();
    render(tripView());
    await addExpense(host);
    await waitFor(() => actual(host) === "100,00 ₽");
    await click(host, "Аннулировать");
    await input(
      host,
      ".expenses .status-confirm input",
      "Synthetic void reason",
    );
    f.loseNextReply();
    await click(host, "Подтвердить аннулирование");
    await waitFor(() => host.querySelector('[role="alert"]'));
    await click(host, "Подтвердить аннулирование");
    await waitFor(() => actual(host) === "—");
    check(
      f.writes[1].key === f.writes[2].key && f.rows[0].version === 2,
      "Void retry changed identity or repeated effect",
    );
  });
  await test("F2: trip switch ignores old response", async (host, render) => {
    const f = tripFixture();
    f.holdReads();
    render(tripView());
    await waitFor(() => f.held.length === 2);
    f.allowReads();
    render(tripView("trip-two"));
    await waitFor(() => actual(host) === "—");
    f.release(true);
    await pause();
    check(
      !host.querySelector('[role="alert"]'),
      "Old trip response escaped scope",
    );
  });
  await test("F2: unmounted mutation starts no follow-up fetch", async (host, render, unmount) => {
    const f = tripFixture();
    render(tripView());
    f.holdPost();
    await addExpense(host);
    const count = f.reads();
    unmount();
    f.releasePost();
    await pause();
    await pause();
    check(f.reads() === count, "Unmounted mutation started refresh");
  });
  await test("F2: older completion cannot clear a newer loading state", async (host, render) => {
    const f = tripFixture();
    f.holdReads();
    render(tripView());
    await waitFor(() => f.held.length === 2);
    const older = f.held.splice(0);
    await click(host, "Synthetic revision");
    await waitFor(() => f.held.length === 2);
    older.forEach((h) => h.pending.resolve(h.response));
    await pause();
    check(
      button(host, "Обновить сравнение").disabled,
      "Old finally cleared current loading state",
    );
    f.allowReads();
    f.release();
    await waitFor(() => !button(host, "Обновить сравнение").disabled);
  });
  await test("F2: stale page cannot append after a newer refresh", async (host, render) => {
    const f = tripFixture();
    f.withMore();
    render(tripView());
    await addExpense(host);
    await waitFor(
      () =>
        actual(host) === "100,00 ₽" && !button(host, "Ещё расходы").disabled,
    );
    f.holdReads();
    await click(host, "Ещё расходы");
    await waitFor(() => f.held.length === 1);
    f.allowReads();
    await click(host, "Synthetic revision");
    await waitFor(() => actual(host) === "100,00 ₽");
    f.release();
    await pause();
    check(
      !host.textContent?.includes("Synthetic older page"),
      "Stale pagination appended to refreshed list",
    );
    check(
      !button(host, "Ещё расходы").disabled,
      "Superseded pagination left busy state",
    );
  });
  await test("F2: pagination accepts current page once", async (host, render) => {
    const f = tripFixture();
    f.withMore();
    render(tripView());
    await addExpense(host);
    await waitFor(
      () =>
        actual(host) === "100,00 ₽" && !button(host, "Ещё расходы").disabled,
    );
    f.holdReads();
    const more = button(host, "Ещё расходы");
    more.click();
    more.click();
    await pause();
    check(f.held.length === 1, "Duplicate in-flight page requested");
    f.allowReads();
    f.release();
    await waitFor(() => host.textContent?.includes("Synthetic older page"));
    check(
      host.querySelectorAll(".expenses tbody tr").length === 2,
      "Current page lost or duplicated",
    );
  });
  await test("F2: stale pre-void snapshot cannot restore active expense", async (host, render) => {
    const f = tripFixture();
    render(tripView());
    await addExpense(host);
    await waitFor(() => actual(host) === "100,00 ₽");
    f.holdReads();
    await click(host, "Обновить сравнение");
    await waitFor(() => f.held.length === 2);
    f.allowReads();
    await click(host, "Аннулировать");
    await input(host, ".expenses .status-confirm input", "Synthetic void");
    await click(host, "Подтвердить аннулирование");
    await waitFor(() => actual(host) === "—");
    f.release();
    await pause();
    check(
      actual(host) === "—" && host.querySelector(".expenses tr.voided"),
      "Old read revived voided expense in UI",
    );
  });
  return { passed, failed };
}
