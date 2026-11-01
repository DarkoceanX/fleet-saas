"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  meterNames,
  periodCategories,
  type Meter,
  type Ownership,
  type PeriodEntry,
  type PeriodReading,
  type PeriodReport,
  type ReviewState,
} from "@fleet/shared";
import { api } from "./api";
import { IncomePanel } from "./income-ui";
import type { IncomeWorkspace } from "@fleet/shared";
type Source = {
  id: string;
  category: string;
  amount: string;
  incurred_on: string;
  note: string;
  version: number;
  trip_id: string;
};
export type PeriodWorkspace = {
  income: IncomeWorkspace;
  profile: { ownership: Ownership; version: number } | null;
  readings: PeriodReading[];
  pending_sources: Source[];
  recognized_elsewhere: {
    id: string;
    recognized_vehicle_id: string;
    amount: string;
  }[];
  report: PeriodReport;
};
type Editor = {
  kind: "reading" | "cost" | "source";
  id: string | null;
  version: number;
  key: string;
  fields: Record<string, string>;
  source?: Source;
};
const labels: Record<ReviewState["status"], string> = {
  unreviewed: "Не проверено",
  reviewed: "Затраты проверены",
  zero: "Затрат не было",
  not_applicable: "Не применимо",
};
const money = (v: string | null) => (v === null ? "не рассчитано" : `${v} RUB`);
export function PeriodPanel({ vehicleId }: { vehicleId: string }) {
  const [start, setStart] = useState(""),
    [end, setEnd] = useState("");
  const [range, setRange] = useState<{
    start_date: string;
    end_date: string;
  } | null>(null);
  const [data, setData] = useState<PeriodWorkspace | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null),
    [states, setStates] = useState<ReviewState[]>([]);
  const [ownership, setOwnership] = useState<Ownership>("owned");
  const request = useRef(0),
    retry = useRef<{ body: string; key: string } | null>(null);
  const base = `/vehicles/${vehicleId}/period`;
  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );
  async function load(selected = range) {
    if (!selected) return;
    const token = ++request.current;
    const result = await api<PeriodWorkspace>(
      `${base}?${new URLSearchParams(selected)}`,
    );
    if (token !== request.current) return;
    setData(result);
    setOwnership(result.profile?.ownership ?? "owned");
    setStates(
      result.report.breakdown.map((b) => ({
        category: b.category,
        status: b.status as ReviewState["status"],
        reason: b.reason,
      })),
    );
  }
  async function mutate(path: string, payload: unknown, explicitKey?: string) {
    const body = JSON.stringify(payload),
      fingerprint = `${path}:${body}`;
    if (!retry.current || retry.current.body !== fingerprint)
      retry.current = { body: fingerprint, key: crypto.randomUUID() };
    await api(`${base}${path}`, {
      method: "POST",
      body,
      headers: { "Idempotency-Key": explicitKey ?? retry.current.key },
    });
    retry.current = null;
  }
  async function perform(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function add(kind: "reading" | "cost") {
    retry.current = null;
    setError("");
    setEditor({
      kind,
      id: null,
      version: 0,
      key: crypto.randomUUID(),
      fields:
        kind === "reading"
          ? {
              date: range?.start_date ?? "",
              km: "",
              work_hours: "",
              engine_hours: "",
              note: "",
            }
          : {
              date: range?.start_date ?? "",
              category: "fuel",
              amount: "",
              note: "",
            },
    });
  }
  function editReading(r: PeriodReading) {
    setError("");
    setEditor({
      kind: "reading",
      id: r.id,
      version: r.version,
      key: crypto.randomUUID(),
      fields: {
        date: r.date,
        km: r.km ?? "",
        work_hours: r.work_hours ?? "",
        engine_hours: r.engine_hours ?? "",
        note: r.note,
      },
    });
  }
  function editCost(e: PeriodEntry) {
    setError("");
    setEditor({
      kind: "cost",
      id: e.id,
      version: e.version,
      key: crypto.randomUUID(),
      fields: {
        date: e.date,
        category: e.category,
        amount: e.amount,
        note: e.note,
      },
    });
  }
  function recognize(s: Source, entry?: PeriodEntry) {
    setError("");
    setEditor({
      kind: "source",
      id: entry?.id ?? null,
      version: entry?.version ?? 0,
      source: s,
      key: crypto.randomUUID(),
      fields: {
        category: entry?.category ?? "",
        note: entry?.note ?? "",
        replace_entry_id: entry?.id ?? "",
      },
    });
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!editor) return;
    await perform(async () => {
      const f = editor.fields;
      if (editor.kind === "source") {
        if (!f.replace_entry_id)
          throw new Error(
            "Выберите ручную запись для замены или подтвердите, что расход ещё не внесён вручную",
          );
        const replaceId =
          f.replace_entry_id === "none" ? null : f.replace_entry_id;
        const replace = data?.report.entries.find((r) => r.id === replaceId);
        if (replaceId && !replace)
          throw new Error("Запись для замены недоступна. Обновите период");
        await mutate(
          "/recognize",
          {
            expense_id: editor.source!.id,
            expense_version: editor.source!.version,
            category: f.category,
            note: f.note,
            replace_entry_id: replaceId,
            replace_version: replace?.version ?? null,
          },
          editor.key,
        );
      } else if (editor.kind === "reading") {
        await mutate(
          `/readings${editor.id ? `/${editor.id}` : ""}`,
          {
            date: f.date,
            note: f.note,
            km: f.km || null,
            work_hours: f.work_hours || null,
            engine_hours: f.engine_hours || null,
            ...(editor.id ? { version: editor.version } : {}),
          },
          editor.key,
        );
      } else {
        await mutate(
          `/costs${editor.id ? `/${editor.id}` : ""}`,
          {
            ...f,
            currency: "RUB",
            ...(editor.id ? { version: editor.version } : {}),
          },
          editor.key,
        );
      }
      setEditor(null);
      await load();
    });
  }
  function field(key: string, value: string) {
    if (editor)
      setEditor({
        ...editor,
        fields: { ...editor.fields, [key]: value },
        key: crypto.randomUUID(),
      });
  }
  const categories = data?.report.breakdown ?? [];
  return (
    <section aria-label="Эксплуатация техники" className="panel">
      <h2>Техника → Период → Себестоимость и результат</h2>
      <p className="info-note">
        Признанные затраты, не платежи. Распределяйте страховку, амортизацию и
        общие расходы вручную. Это управленческий расчёт и пользовательская
        проверка, не гарантия полной себестоимости и не налоговый учёт.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const selected = { start_date: start, end_date: end };
          setRange(selected);
          setEditor(null);
          setData(null);
          void perform(() => load(selected));
        }}
      >
        <fieldset disabled={busy}>
          <div className="form-grid">
            <label>
              С начала дня
              <input
                aria-label="Начало периода"
                type="date"
                required
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </label>
            <label>
              По день включительно
              <input
                aria-label="Конец периода"
                type="date"
                required
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </label>
          </div>
          <button className="primary">Рассчитать период</button>
        </fieldset>
      </form>
      {error && (
        <p role="alert" className="notice">
          {error}
        </p>
      )}
      {data && (
        <>
          <IncomePanel
            key={`${vehicleId}:${range?.start_date}:${range?.end_date}`}
            data={data.income}
            vehicleId={vehicleId}
            range={range ?? undefined}
            onChange={() => load()}
          />
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void perform(async () => {
                await mutate("/ownership", {
                  ownership,
                  version: data.profile?.version ?? 0,
                });
                await load();
              });
            }}
          >
            <fieldset disabled={busy}>
              <label>
                Владение
                <select
                  aria-label="Владение"
                  value={ownership}
                  onChange={(e) => setOwnership(e.target.value as Ownership)}
                >
                  <option value="owned">Собственная</option>
                  <option value="rented">Арендованная</option>
                </select>
              </label>
              <button className="secondary">
                {data.profile ? "Сохранить владение" : "Подтвердить владение"}
              </button>
            </fieldset>
          </form>
          <div className="summary-strip">
            <div>
              <small>Признано за период</small>
              <strong data-testid="period-total">
                {money(data.report.total_cost)}
              </strong>
            </div>
            {(["km", "work_hours"] as Meter[]).map((m) => (
              <div key={m}>
                <small>{m === "km" ? "RUB / км" : "RUB / рабочий час"}</small>
                <strong>
                  {data.report.metrics[m].unit_cost_below_precision
                    ? "< 0.0001"
                    : (data.report.metrics[m].unit_cost ?? "не рассчитано")}
                </strong>
                <small>
                  {data.report.metrics[m].status === "missing_boundary"
                    ? "нет граничных показаний"
                    : data.report.metrics[m].status === "no_activity"
                      ? "нулевая выработка"
                      : meterNames[m]}
                </small>
              </div>
            ))}
          </div>
          <p>
            Одна сумма разделена отдельно на км и рабочие часы. Эти ставки
            нельзя складывать. Моточасы:{" "}
            {data.report.metrics.engine_hours.value ?? "неизвестно"} (только
            справочно).
          </p>
          <p>
            <strong>
              {data.report.costs_reviewed
                ? "Категории проверены пользователем"
                : "Предварительный расчёт"}
            </strong>
          </p>
          {data.report.warnings.map((w) => (
            <p className="info-note" key={w}>
              {w}
            </p>
          ))}
          {data.recognized_elsewhere.map((s) => (
            <p key={s.id}>
              Источник {s.id}: {s.amount} RUB учтён за машиной{" "}
              {s.recognized_vehicle_id}.
            </p>
          ))}
          <h3>Накопительные показания на начало дня</h3>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => add("reading")}
          >
            Добавить показания
          </button>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>км</th>
                  <th>Работа, ч</th>
                  <th>Двигатель, ч</th>
                  <th>Действия</th>
                </tr>
              </thead>
              <tbody>
                {data.readings.map((r) => (
                  <tr key={r.id}>
                    <td>{r.date}</td>
                    <td>{r.km ?? "—"}</td>
                    <td>{r.work_hours ?? "—"}</td>
                    <td>{r.engine_hours ?? "—"}</td>
                    <td>
                      <button disabled={busy} onClick={() => editReading(r)}>
                        Изменить показания
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => {
                          if (window.confirm("Удалить показания?"))
                            void perform(async () => {
                              await mutate(`/readings/${r.id}/delete`, {
                                version: r.version,
                              });
                              setEditor(null);
                              await load();
                            });
                        }}
                      >
                        Удалить показания
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3>Затраты и источники</h3>
          <p>
            Расход рейса признавайте через источник ниже. Если его сумма уже
            введена вручную, выберите заменяемую запись — её сумма будет
            заменена ссылкой. Похожие независимые записи автоматически не
            считаются дублями.
          </p>
          <button
            className="secondary"
            disabled={busy || !data.profile}
            onClick={() => add("cost")}
          >
            Добавить ручной расход
          </button>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Статья / основание</th>
                  <th>RUB</th>
                  <th>Источник</th>
                  <th>Действия</th>
                </tr>
              </thead>
              <tbody>
                {data.report.entries.map((r) => (
                  <tr key={r.id}>
                    <td>{r.date}</td>
                    <td>
                      {periodCategories[r.category]}
                      <br />
                      {r.note}
                    </td>
                    <td>{r.amount}</td>
                    <td>
                      {r.source === "trip" ? "Расход рейса" : "Ручной"}
                      <br />
                      <small>{r.source_id}</small>
                    </td>
                    <td>
                      {r.source === "manual" ? (
                        <>
                          <button disabled={busy} onClick={() => editCost(r)}>
                            Изменить расход
                          </button>
                          <button
                            disabled={busy}
                            onClick={() => {
                              if (
                                window.confirm(
                                  "Удалить ручной расход из расчёта? История останется в аудите.",
                                )
                              )
                                void perform(async () => {
                                  await mutate(`/costs/${r.id}/delete`, {
                                    version: r.version,
                                  });
                                  setEditor(null);
                                  await load();
                                });
                            }}
                          >
                            Удалить расход
                          </button>
                        </>
                      ) : (
                        <>
                          <small>
                            Сумма и дата из исходного рейса; аннулирование
                            выполняется там.
                          </small>
                          {r.source_warning && (
                            <button
                              disabled={busy}
                              onClick={() =>
                                recognize(
                                  {
                                    id: r.source_id,
                                    category: "проверьте источник",
                                    amount: r.amount,
                                    incurred_on: r.date,
                                    note: r.note,
                                    version: r.source_version!,
                                    trip_id: "",
                                  },
                                  r,
                                )
                              }
                            >
                              Перепроверить связь
                            </button>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.pending_sources.length > 0 && (
            <>
              <h3>Непризнанные расходы рейсов этой машины</h3>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Дата / источник</th>
                      <th>Категория рейса</th>
                      <th>RUB</th>
                      <th>Действие</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.pending_sources.map((s) => (
                      <tr key={s.id}>
                        <td>
                          {s.incurred_on}
                          <br />
                          <small>{s.id}</small>
                          <br />
                          {s.note}
                        </td>
                        <td>{s.category}</td>
                        <td>{s.amount}</td>
                        <td>
                          <button
                            disabled={busy || !data.profile}
                            onClick={() => recognize(s)}
                          >
                            Признать источник
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {editor && (
            <form
              aria-label="Редактор записи"
              className="operation-form"
              onSubmit={submit}
            >
              <h3>
                {editor.kind === "source"
                  ? "Связать источник с этой машиной"
                  : editor.id
                    ? "Изменение записи"
                    : "Новая запись"}
              </h3>
              <fieldset disabled={busy}>
                <div className="form-grid">
                  {editor.kind !== "source" && (
                    <label>
                      Дата
                      <input
                        name="date"
                        type="date"
                        required
                        value={editor.fields.date}
                        onChange={(e) => field("date", e.target.value)}
                      />
                    </label>
                  )}
                  {editor.kind === "reading" ? (
                    (Object.keys(meterNames) as Meter[]).map((m) => (
                      <label key={m}>
                        {meterNames[m]}
                        <input
                          name={m}
                          inputMode="decimal"
                          placeholder="Неизвестно — оставить пустым"
                          value={editor.fields[m]}
                          onChange={(e) => field(m, e.target.value)}
                        />
                      </label>
                    ))
                  ) : (
                    <>
                      <label>
                        Категория
                        <select
                          name="category"
                          required
                          value={editor.fields.category}
                          onChange={(e) => field("category", e.target.value)}
                        >
                          <option value="">Выберите явно</option>
                          {categories.map((c) => (
                            <option key={c.category} value={c.category}>
                              {c.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      {editor.kind === "cost" && (
                        <label>
                          Признанная сумма, RUB
                          <input
                            name="amount"
                            inputMode="decimal"
                            required
                            value={editor.fields.amount}
                            onChange={(e) => field("amount", e.target.value)}
                          />
                        </label>
                      )}
                    </>
                  )}
                  <label>
                    Основание / примечание
                    <input
                      name="note"
                      required={editor.kind !== "reading"}
                      minLength={editor.kind === "reading" ? undefined : 3}
                      value={editor.fields.note}
                      onChange={(e) => field("note", e.target.value)}
                    />
                  </label>
                  {editor.kind === "source" && (
                    <>
                      <p>
                        Источник {editor.source!.id}: {editor.source!.amount}{" "}
                        RUB от {editor.source!.incurred_on}. Сумма и дата не
                        копируются. После смены машины рейса привязка остаётся
                        здесь до явной перепроверки.
                      </p>
                      <label>
                        Заменить уже внесённую ручную запись
                        <select
                          name="replace_entry_id"
                          required
                          disabled={!!editor.id}
                          value={editor.fields.replace_entry_id}
                          onChange={(e) =>
                            field("replace_entry_id", e.target.value)
                          }
                        >
                          <option value="" disabled>
                            Выберите: заменить запись или подтвердить отсутствие
                          </option>
                          <option value="none">
                            Нет — сумма ещё не внесена вручную
                          </option>
                          {data.report.entries
                            .filter(
                              (r) =>
                                r.source === "manual" || r.id === editor.id,
                            )
                            .map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.date} · {r.amount} · {r.note}
                              </option>
                            ))}
                        </select>
                      </label>
                    </>
                  )}
                </div>
                <button className="primary">Сохранить запись</button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    setEditor(null);
                    retry.current = null;
                    setError("");
                  }}
                >
                  Отмена
                </button>
              </fieldset>
            </form>
          )}
          <h3>Проверка применимых групп за весь период</h3>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void perform(async () => {
                await mutate("/review", {
                  ...range,
                  expected_revision: data.report.revision,
                  states,
                });
                await load();
              });
            }}
          >
            <fieldset disabled={busy || !data.profile}>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Группа</th>
                      <th>RUB</th>
                      <th>Проверка</th>
                      <th>Причина неприменимости</th>
                    </tr>
                  </thead>
                  <tbody>
                    {states.map((s, i) => (
                      <tr key={s.category}>
                        <td>{periodCategories[s.category]}</td>
                        <td>{data.report.breakdown[i].amount}</td>
                        <td>
                          <select
                            aria-label={`Проверка: ${periodCategories[s.category]}`}
                            value={s.status}
                            onChange={(e) =>
                              setStates(
                                states.map((r, n) =>
                                  n === i
                                    ? {
                                        ...r,
                                        status: e.target
                                          .value as ReviewState["status"],
                                      }
                                    : r,
                                ),
                              )
                            }
                          >
                            {Object.entries(labels).map(([v, l]) => (
                              <option key={v} value={v}>
                                {l}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input
                            aria-label={`Причина: ${periodCategories[s.category]}`}
                            disabled={s.status !== "not_applicable"}
                            required={s.status === "not_applicable"}
                            minLength={3}
                            value={s.reason}
                            onChange={(e) =>
                              setStates(
                                states.map((r, n) =>
                                  n === i
                                    ? { ...r, reason: e.target.value }
                                    : r,
                                ),
                              )
                            }
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button className="primary">Сохранить проверку периода</button>
            </fieldset>
          </form>
        </>
      )}
    </section>
  );
}
