"use client";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  categoryLabels,
  expenseCategories,
  statusLabels,
  transitions,
  type Comparison,
  type Driver,
  type Expense,
  type ExpenseCategory,
  type StatusEvent,
  type Trip,
  type TripStatus,
  type UserContext,
  type Vehicle,
} from "@fleet/shared";
import { api, ApiError, type Page } from "./api";
import { TripIncomePanel } from "./income-ui";
const money = (v: string | null) =>
  v === null
    ? "—"
    : `${v.replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, " ")} ₽`;
const message = (e: unknown) =>
  e instanceof ApiError
    ? [e.message, ...Object.values(e.fields)].join(". ")
    : e instanceof Error
      ? e.message
      : "Не удалось выполнить запрос";
function ErrorNotice({ text }: { text: string }) {
  return text ? (
    <div role="alert" className="notice">
      {text}
    </div>
  ) : null;
}
const when = (value: string) =>
  new Date(value).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" });
function useRetry() {
  const value = useRef<{ body: string; key: string } | null>(null);
  return {
    key(body: string) {
      if (value.current?.body !== body)
        value.current = { body, key: crypto.randomUUID() };
      return value.current.key;
    },
    clear() {
      value.current = null;
    },
  };
}
export function DriversPanel({ user }: { user: UserContext }) {
  const [items, setItems] = useState<Driver[]>([]),
    [more, setMore] = useState(false),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [editing, setEditing] = useState<Driver | null>(null),
    [show, setShow] = useState(false);
  const [draft, setDraft] = useState({
    name: "",
    staff_code: "",
    active: true,
  });
  const retry = useRetry();
  const canEdit = ["owner", "dispatcher"].includes(user.role);
  async function load(append = false) {
    setError("");
    setLoading(true);
    try {
      const p = await api<Page<Driver>>(
        `/drivers?limit=20&offset=${append ? items.length : 0}`,
      );
      setItems((old) => (append ? [...old, ...p.items] : p.items));
      setMore(p.has_more);
    } catch (e) {
      setError(message(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const body = JSON.stringify(
      editing
        ? { ...draft, version: editing.version }
        : { name: draft.name, staff_code: draft.staff_code },
    );
    try {
      await api(editing ? `/drivers/${editing.id}` : "/drivers", {
        method: editing ? "PATCH" : "POST",
        headers: { "Idempotency-Key": retry.key(body) },
        body,
      });
      retry.clear();
      setShow(false);
      setEditing(null);
      await load();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <ErrorNotice text={error} />
      <section className="panel">
        <div className="section-heading">
          <h2>Водители организации</h2>
          {canEdit && (
            <button
              className="primary"
              onClick={() => {
                setEditing(null);
                setDraft({ name: "", staff_code: "", active: true });
                setShow(true);
              }}
            >
              ＋ Добавить водителя
            </button>
          )}
        </div>
        {show && (
          <form className="operation-form" onSubmit={save}>
            <h2>{editing ? "Изменить водителя" : "Новый водитель"}</h2>
            <fieldset disabled={busy}>
              <div className="form-grid">
                <label>
                  Имя / обозначение водителя
                  <input
                    autoFocus
                    required
                    minLength={2}
                    maxLength={100}
                    value={draft.name}
                    onChange={(e) =>
                      setDraft({ ...draft, name: e.target.value })
                    }
                  />
                </label>
                <label>
                  Табельный код
                  <input
                    required
                    minLength={2}
                    maxLength={30}
                    value={draft.staff_code}
                    onChange={(e) =>
                      setDraft({ ...draft, staff_code: e.target.value })
                    }
                  />
                </label>
                {editing && (
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={draft.active}
                      onChange={(e) =>
                        setDraft({ ...draft, active: e.target.checked })
                      }
                    />
                    Активен для новых назначений
                  </label>
                )}
              </div>
              <div className="button-row">
                <button className="primary">
                  {busy ? "Сохраняем…" : "Сохранить водителя"}
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setShow(false)}
                >
                  Отмена
                </button>
              </div>
            </fieldset>
          </form>
        )}
        {loading && !items.length ? (
          <p className="empty" role="status">
            Загружаем водителей…
          </p>
        ) : items.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Водитель</th>
                  <th>Табельный код</th>
                  <th>Доступность</th>
                  <th>Действия</th>
                </tr>
              </thead>
              <tbody>
                {items.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <strong>{d.name}</strong>
                    </td>
                    <td className="mono">{d.staff_code}</td>
                    <td>{d.active ? "Активен" : "Неактивен"}</td>
                    <td>
                      {canEdit && (
                        <button
                          className="row-action"
                          onClick={() => {
                            setEditing(d);
                            setDraft({
                              name: d.name,
                              staff_code: d.staff_code,
                              active: d.active,
                            });
                            setShow(true);
                          }}
                        >
                          Изменить
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty">
            Добавьте первого водителя для назначения на рейс.
          </p>
        )}
        <div className="table-footer">
          <button
            className="text-button"
            disabled={loading || busy}
            onClick={() => load()}
          >
            Обновить
          </button>
          {more && (
            <button
              className="secondary"
              disabled={loading || busy}
              onClick={() => load(true)}
            >
              Загрузить ещё
            </button>
          )}
        </div>
      </section>
    </>
  );
}
export function TripDetails({
  trip,
  user,
  onChange,
  renderPlan,
}: {
  trip: Trip;
  user: UserContext;
  onChange: (trip: Trip) => void;
  renderPlan: (onSaved: () => void) => ReactNode;
}) {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]),
    [drivers, setDrivers] = useState<Driver[]>([]),
    [vMore, setVMore] = useState(false),
    [dMore, setDMore] = useState(false),
    [resourcesLoaded, setResourcesLoaded] = useState(false);
  const [vehicleId, setVehicleId] = useState(trip.vehicle_id),
    [driverId, setDriverId] = useState(trip.driver_id || ""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [info, setInfo] = useState(""),
    [reason, setReason] = useState(""),
    [nextStatus, setNextStatus] = useState<TripStatus | null>(null),
    [tab, setTab] = useState<"plan" | "actual">("plan"),
    [revision, setRevision] = useState(0),
    [events, setEvents] = useState<StatusEvent[]>([]),
    [hMore, setHMore] = useState(false);
  const retry = useRetry();
  const operate = ["owner", "dispatcher"].includes(user.role),
    finance = ["owner", "accountant"].includes(user.role),
    editable = ["draft", "planned"].includes(trip.status);
  async function history(append = false) {
    try {
      const p = await api<Page<StatusEvent>>(
        `/trips/${trip.id}/status-history?limit=20&offset=${append ? events.length : 0}`,
      );
      setEvents((old) => (append ? [...old, ...p.items] : p.items));
      setHMore(p.has_more);
    } catch (e) {
      setError(message(e));
    }
  }
  async function resources(kind: "vehicles" | "drivers", append = false) {
    try {
      if (kind === "vehicles") {
        const p = await api<Page<Vehicle>>(
          `/vehicles?limit=100&offset=${append ? vehicles.length : 0}`,
        );
        setVehicles((old) => (append ? [...old, ...p.items] : p.items));
        setVMore(p.has_more);
      } else {
        const p = await api<Page<Driver>>(
          `/drivers?limit=100&offset=${append ? drivers.length : 0}`,
        );
        setDrivers((old) => (append ? [...old, ...p.items] : p.items));
        setDMore(p.has_more);
      }
    } catch (e) {
      setError(message(e));
    }
  }
  useEffect(() => {
    void history();
    if (operate)
      void Promise.all([resources("vehicles"), resources("drivers")]).then(() =>
        setResourcesLoaded(true),
      );
  }, [trip.id]);
  async function reload() {
    setBusy(true);
    setError("");
    try {
      const t = await api<Trip>(`/trips/${trip.id}`);
      onChange(t);
      setVehicleId(t.vehicle_id);
      setDriverId(t.driver_id || "");
      setRevision((r) => r + 1);
      await history();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function assign(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setInfo("");
    try {
      const t = await api<Trip>(`/trips/${trip.id}/assignment`, {
        method: "PATCH",
        body: JSON.stringify({
          vehicle_id: vehicleId,
          driver_id: driverId || null,
          version: trip.version,
        }),
      });
      onChange(t);
      setRevision((r) => r + 1);
      setInfo(
        "Назначение сохранено. Ставки не менялись; сохраните новый план для текущей машины и водителя.",
      );
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function changeStatus(e: FormEvent) {
    e.preventDefault();
    if (!nextStatus) return;
    setBusy(true);
    setError("");
    setInfo("");
    const body = JSON.stringify({
      status: nextStatus,
      version: trip.version,
      ...(reason ? { reason } : {}),
    });
    try {
      const t = await api<Trip>(`/trips/${trip.id}/status`, {
        method: "POST",
        headers: { "Idempotency-Key": retry.key(body) },
        body,
      });
      retry.clear();
      onChange(t);
      setNextStatus(null);
      setReason("");
      setRevision((r) => r + 1);
      setInfo(`Статус: ${statusLabels[t.status]}`);
      await history();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <section className="panel trip-operations">
        <div className="section-heading">
          <div>
            <h2>Машина, водитель и статус</h2>
            <p className="muted">
              {trip.vehicle_name} · {trip.driver_name || "Водитель не назначен"}
            </p>
          </div>
          <span className={`status status-${trip.status}`}>
            {statusLabels[trip.status]}
          </span>
        </div>
        <div className="operation-form">
          <ErrorNotice text={error} />
          {info && (
            <p className="success" role="status">
              {info}
            </p>
          )}
          {operate && editable ? (
            <form onSubmit={assign}>
              <fieldset disabled={busy || !resourcesLoaded}>
                <div className="form-grid">
                  <div>
                    <label htmlFor="assignment-vehicle">Автомобиль рейса</label>
                    <select
                      id="assignment-vehicle"
                      value={vehicleId}
                      onChange={(e) => setVehicleId(e.target.value)}
                    >
                      {!vehicles.some((v) => v.id === trip.vehicle_id) && (
                        <option value={trip.vehicle_id}>
                          {trip.vehicle_name} · {trip.plate}
                        </option>
                      )}
                      {vehicles.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name} · {v.plate}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="assignment-driver">Водитель рейса</label>
                    <select
                      id="assignment-driver"
                      aria-label="Водитель рейса"
                      value={driverId}
                      onChange={(e) => setDriverId(e.target.value)}
                    >
                      <option value="">Не назначен</option>
                      {trip.driver_id &&
                        !drivers.some((d) => d.id === trip.driver_id) && (
                          <option value={trip.driver_id}>
                            {trip.driver_name}
                          </option>
                        )}
                      {drivers.map((d) => (
                        <option key={d.id} value={d.id} disabled={!d.active}>
                          {d.name} · {d.staff_code}
                          {!d.active ? " (неактивен)" : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="button-row">
                  {vMore && (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => resources("vehicles", true)}
                    >
                      Ещё машины
                    </button>
                  )}
                  {dMore && (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => resources("drivers", true)}
                    >
                      Ещё водители
                    </button>
                  )}
                  <button
                    className="primary"
                    disabled={
                      vehicleId === trip.vehicle_id &&
                      driverId === (trip.driver_id || "")
                    }
                  >
                    Сохранить назначение
                  </button>
                </div>
              </fieldset>
            </form>
          ) : (
            <p className="muted">
              {operate
                ? "После выезда или отмены назначение закрыто для изменений."
                : "Назначение меняет владелец или диспетчер."}
            </p>
          )}
          <div className="button-row">
            {operate &&
              transitions[trip.status].map((status) => (
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  key={status}
                  onClick={() => {
                    setNextStatus(status);
                    setReason("");
                  }}
                >
                  {status === "planned"
                    ? "Запланировать"
                    : status === "in_progress"
                      ? "Начать рейс"
                      : status === "completed"
                        ? "Завершить рейс"
                        : "Отменить рейс"}
                </button>
              ))}
            <button className="text-button" disabled={busy} onClick={reload}>
              Обновить карточку
            </button>
          </div>
          {nextStatus && (
            <form className="status-confirm" onSubmit={changeStatus}>
              <h3>Перевести в «{statusLabels[nextStatus]}»</h3>
              <p className="muted">
                {nextStatus === "in_progress"
                  ? "На выезде фиксируется последний план текущего назначения. Если его нет, сравнение покажет «нет плана»."
                  : nextStatus === "planned"
                    ? "Машина и водитель будут заняты до завершения или отмены этого рейса."
                    : nextStatus === "completed"
                      ? "Назначение будет закрыто. Поздние расходы можно внести с основанием."
                      : "Отмена необратима. Ранее внесённые расходы сохранятся."}
              </p>
              <label>
                Причина / комментарий
                {nextStatus === "cancelled" ? " (обязательно)" : ""}
                <input
                  required={nextStatus === "cancelled"}
                  minLength={3}
                  maxLength={500}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <div className="button-row">
                <button className="primary" disabled={busy}>
                  Подтвердить статус
                </button>
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() => setNextStatus(null)}
                >
                  Назад
                </button>
              </div>
            </form>
          )}
          <details className="status-history">
            <summary>
              История статусов ({events.length}
              {hMore ? "+" : ""})
            </summary>
            {events.map((e) => (
              <p key={e.id}>
                {statusLabels[e.from_status]} → {statusLabels[e.to_status]} ·{" "}
                {when(e.created_at)} МСК{e.reason ? ` · ${e.reason}` : ""}
              </p>
            ))}
            {!events.length && <p>Статус ещё не менялся.</p>}
            {hMore && (
              <button className="text-button" onClick={() => history(true)}>
                Ещё переходы
              </button>
            )}
          </details>
        </div>
      </section>
      {finance && (
        <>
          <div
            className="detail-tabs"
            role="tablist"
            aria-label="Финансы рейса"
          >
            <button
              role="tab"
              aria-selected={tab === "plan"}
              onClick={() => setTab("plan")}
            >
              Плановая себестоимость
            </button>
            <button
              role="tab"
              aria-selected={tab === "actual"}
              onClick={() => setTab("actual")}
            >
              Факт и сравнение
            </button>
          </div>
          <div hidden={tab !== "plan"}>
            {renderPlan(() => setRevision((r) => r + 1))}
          </div>
          <div hidden={tab !== "actual"}>
            <ExpensesPanel
              key={trip.id}
              trip={trip}
              revision={revision}
              onChanged={() => setRevision((r) => r + 1)}
            />
            <TripIncomePanel
              key={`${trip.id}:${revision}:${trip.version}`}
              trip={trip}
            />
          </div>
        </>
      )}
    </>
  );
}
function ExpensesPanel({
  trip,
  revision,
  onChanged,
}: {
  trip: Trip;
  revision: number;
  onChanged: () => void;
}) {
  const [items, setItems] = useState<Expense[]>([]),
    [comparison, setComparison] = useState<Comparison | null>(null),
    [more, setMore] = useState(false),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [show, setShow] = useState(false),
    [voiding, setVoiding] = useState<Expense | null>(null),
    [reason, setReason] = useState("");
  const [draft, setDraft] = useState({
    category: "fuel" as ExpenseCategory,
    amount: "",
    incurred_on: trip.departure_date,
    note: "",
  });
  const retry = useRetry(),
    voidRetry = useRetry();
  const alive = useRef(true),
    request = useRef(0),
    mutating = useRef(false),
    paging = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      request.current++;
    };
  }, []);
  const current = (id: number) => alive.current && id === request.current;
  async function refresh() {
    if (!alive.current || mutating.current) return;
    const id = ++request.current;
    setLoading(true);
    setError("");
    try {
      const [p, c] = await Promise.all([
        api<Page<Expense>>(`/trips/${trip.id}/expenses?limit=20`),
        api<Comparison>(`/trips/${trip.id}/comparison`),
      ]);
      if (!current(id)) return;
      setItems(p.items);
      setMore(p.has_more);
      setComparison(c);
    } catch (e) {
      if (current(id)) setError(message(e));
    } finally {
      if (current(id)) setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, [trip.id, revision]);
  function beginMutation() {
    if (!alive.current || mutating.current || paging.current) return false;
    mutating.current = true;
    // A read begun before this write cannot describe its outcome, even if it
    // arrives while the POST is still in flight or after a lost reply.
    request.current++;
    setLoading(false);
    setBusy(true);
    setError("");
    return true;
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!beginMutation()) return;
    const body = JSON.stringify({ ...draft, currency: "RUB" });
    try {
      await api(`/trips/${trip.id}/expenses`, {
        method: "POST",
        headers: { "Idempotency-Key": retry.key(body) },
        body,
      });
      if (!alive.current) return;
      retry.clear();
      setDraft({ ...draft, amount: "", note: "" });
      setShow(false);
      mutating.current = false;
      await refresh();
      if (alive.current) onChanged();
    } catch (e) {
      if (alive.current) setError(message(e));
    } finally {
      mutating.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function voidEntry(e: FormEvent) {
    e.preventDefault();
    if (!voiding || !beginMutation()) return;
    const body = JSON.stringify({ version: voiding.version, reason });
    try {
      await api(`/expenses/${voiding.id}/void`, {
        method: "POST",
        headers: { "Idempotency-Key": voidRetry.key(`${voiding.id}:${body}`) },
        body,
      });
      if (!alive.current) return;
      voidRetry.clear();
      setVoiding(null);
      setReason("");
      mutating.current = false;
      await refresh();
      if (alive.current) onChanged();
    } catch (e) {
      if (alive.current) setError(message(e));
    } finally {
      mutating.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function loadMore() {
    if (!alive.current || loading || mutating.current || paging.current) return;
    paging.current = true;
    const id = request.current;
    setBusy(true);
    try {
      const p = await api<Page<Expense>>(
        `/trips/${trip.id}/expenses?limit=20&offset=${items.length}`,
      );
      if (!current(id)) return;
      setItems((old) => [...old, ...p.items]);
      setMore(p.has_more);
    } catch (e) {
      if (current(id)) setError(message(e));
    } finally {
      paging.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <>
      <ErrorNotice text={error} />
      <section className="panel comparison">
        <div className="section-heading">
          <h2>План / факт · RUB</h2>
          <button
            className="text-button"
            disabled={busy || loading}
            onClick={refresh}
          >
            Обновить сравнение
          </button>
        </div>
        {loading ? (
          <p className="empty" role="status">
            Считаем план/факт…
          </p>
        ) : (
          comparison && (
            <>
              <div className="comparison-totals">
                <div>
                  <small>
                    План{comparison.plan_mode === "frozen" ? " на выезде" : ""}
                  </small>
                  <strong>{money(comparison.plan_total)}</strong>
                </div>
                <div>
                  <small>Внесённый факт</small>
                  <strong>{money(comparison.actual_total)}</strong>
                </div>
                <div>
                  <small>Отклонение: факт − план</small>
                  <strong
                    className={
                      comparison.variance?.startsWith("-")
                        ? "under-budget"
                        : "over-budget"
                    }
                  >
                    {comparison.variance !== null &&
                    !comparison.variance.startsWith("-")
                      ? "+"
                      : ""}
                    {money(comparison.variance)}
                  </strong>
                  <small>
                    {comparison.variance_percent === null
                      ? "Процент не определяется"
                      : `${comparison.variance_percent}% от плана`}
                  </small>
                </div>
              </div>
              <p className="info-note">
                {comparison.plan_id
                  ? `План ${comparison.plan_mode === "frozen" ? "зафиксирован на выезде" : "последний для текущего назначения"} · ${when(comparison.plan_created_at!)} МСК.`
                  : "Подходящего плана нет. Исторические снимки доступны во вкладке плана."}{" "}
                {comparison.has_actual
                  ? "Факт включает только внесённые неаннулированные расходы; полнота затрат не подтверждена."
                  : "Фактические расходы ещё не внесены; экономия не рассчитывается."}
              </p>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Категория</th>
                      <th>План, ₽</th>
                      <th>Факт, ₽</th>
                      <th>Отклонение, ₽</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparison.rows.map((r) => (
                      <tr key={r.category}>
                        <td>{categoryLabels[r.category]}</td>
                        <td>{money(r.plan)}</td>
                        <td>{money(r.actual)}</td>
                        <td>{money(r.variance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )
        )}
      </section>
      <section className="panel expenses">
        <div className="section-heading">
          <h2>Фактические расходы</h2>
          <button
            className="primary"
            disabled={busy}
            onClick={() => setShow(true)}
          >
            ＋ Добавить расход
          </button>
        </div>
        {show && (
          <form className="operation-form" onSubmit={save}>
            <fieldset disabled={busy}>
              <div className="form-grid">
                <label htmlFor="expense-category">
                  Категория
                  <select
                    id="expense-category"
                    value={draft.category}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        category: e.target.value as ExpenseCategory,
                      })
                    }
                  >
                    {expenseCategories.map((c) => (
                      <option key={c} value={c}>
                        {categoryLabels[c]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Сумма, ₽
                  <input
                    autoFocus
                    inputMode="decimal"
                    required
                    placeholder="0.00"
                    value={draft.amount}
                    onChange={(e) =>
                      setDraft({ ...draft, amount: e.target.value })
                    }
                  />
                </label>
                <label>
                  Дата расхода
                  <input
                    type="date"
                    required
                    value={draft.incurred_on}
                    onChange={(e) =>
                      setDraft({ ...draft, incurred_on: e.target.value })
                    }
                  />
                </label>
                <label>
                  Основание расхода
                  <input
                    required
                    minLength={3}
                    maxLength={500}
                    placeholder="Например, топливо по чеку ДЕМО-01"
                    value={draft.note}
                    onChange={(e) =>
                      setDraft({ ...draft, note: e.target.value })
                    }
                  />
                </label>
              </div>
              <p className="input-note">
                Только фактически понесённые затраты. Суммы вводятся с точкой,
                до двух знаков. Не дублируйте один расход в нескольких
                категориях.
              </p>
              <div className="button-row">
                <button className="primary">
                  {busy ? "Сохраняем…" : "Сохранить расход"}
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setShow(false)}
                >
                  Закрыть форму
                </button>
              </div>
            </fieldset>
          </form>
        )}
        {voiding && (
          <form className="operation-form status-confirm" onSubmit={voidEntry}>
            <h3>
              Аннулировать {money(voiding.amount)} ·{" "}
              {categoryLabels[voiding.category]}
            </h3>
            <p>
              Исходная запись останется в истории, сумма исключится из факта.
            </p>
            <label>
              Причина аннулирования
              <input
                autoFocus
                required
                minLength={3}
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <div className="button-row">
              <button className="primary" disabled={busy}>
                Подтвердить аннулирование
              </button>
              <button
                className="secondary"
                type="button"
                disabled={busy}
                onClick={() => setVoiding(null)}
              >
                Назад
              </button>
            </div>
          </form>
        )}
        {items.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Дата / категория</th>
                  <th>Сумма</th>
                  <th>Основание</th>
                  <th>Действия</th>
                </tr>
              </thead>
              <tbody>
                {items.map((e) => (
                  <tr key={e.id} className={e.voided_at ? "voided" : ""}>
                    <td>
                      {e.incurred_on.split("-").reverse().join(".")}
                      <span className="table-sub">
                        {categoryLabels[e.category]}
                      </span>
                    </td>
                    <td className="nowrap">{money(e.amount)}</td>
                    <td>
                      {e.note}
                      {e.voided_at && (
                        <span className="table-sub">
                          Аннулирован: {e.void_reason} · {when(e.voided_at)} МСК
                        </span>
                      )}
                    </td>
                    <td>
                      {!e.voided_at && (
                        <button
                          className="row-action"
                          disabled={busy}
                          onClick={() => {
                            setVoiding(e);
                            setReason("");
                          }}
                        >
                          Аннулировать
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty">Расходов пока нет.</p>
        )}
        {more && (
          <div className="table-footer">
            <button
              className="secondary"
              disabled={busy || loading}
              onClick={loadMore}
            >
              Ещё расходы
            </button>
          </div>
        )}
      </section>
    </>
  );
}
