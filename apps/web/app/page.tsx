"use client";
import { api, ApiError } from "./api";
import { DriversPanel, TripDetails } from "./operations-ui";
import { statusLabels } from "@fleet/shared";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  costFields,
  fieldLabels,
  type CostInput,
  type UserContext,
  type Vehicle,
  type Trip,
  type Estimate,
} from "@fleet/shared";

const demo: CostInput = {
  currency: "RUB",
  loaded_km: "500",
  empty_km: "100",
  fuel_l_per_100km: "30",
  fuel_price_per_l: "60",
  driver_hours: "12",
  driver_rate_per_hour: "400",
  maintenance_per_km: "4",
  depreciation_per_km: "3",
  tolls: "1500",
  other_direct: "500",
  overhead_rate: "0.10",
  target_margin: "0.20",
  revenue: "30000",
};
const emptyCost = Object.fromEntries(
  ["currency", ...costFields, "revenue"].map((k) => [
    k,
    k === "currency" ? "RUB" : "",
  ]),
) as CostInput;
const money = (value: string | null | undefined) =>
  value == null
    ? "—"
    : `${value.split(".")[0].replace(/\B(?=(\d{3})+(?!\d))/g, " ")},${value.split(".")[1] || "00"} ₽`;
const roleName = {
  owner: "Владелец",
  dispatcher: "Диспетчер",
  accountant: "Бухгалтер",
  viewer: "Наблюдатель",
};
const lineName: Record<string, string> = {
  fuel: "Топливо",
  driver: "Работа водителя",
  maintenance: "Обслуживание",
  depreciation: "Амортизация",
  tolls: "Платные дороги",
  other_direct: "Прочие расходы",
};
function Brand() {
  return (
    <div className="brand">
      <span className="brand-icon">F</span>
      <span>
        fleet<span className="brand-dot">.</span>
      </span>
    </div>
  );
}
function Notice({ text }: { text: string }) {
  return text ? (
    <div className="notice" role="alert">
      {text}
    </div>
  ) : null;
}
type Page<T> = { items: T[]; has_more: boolean };
export default function Home() {
  const [user, setUser] = useState<UserContext | null>(null),
    [checking, setChecking] = useState(true),
    [loginError, setLoginError] = useState(""),
    [loginBusy, setLoginBusy] = useState(false);
  const [email, setEmail] = useState("owner@sever.demo"),
    [password, setPassword] = useState("");
  useEffect(() => {
    api<UserContext>("/auth/me")
      .then(setUser)
      .catch((e) => {
        if (e.status !== 401) setLoginError(e.message);
      })
      .finally(() => setChecking(false));
  }, []);
  async function login(e: FormEvent) {
    e.preventDefault();
    setLoginBusy(true);
    setLoginError("");
    try {
      setUser(
        await api<UserContext>("/auth/login", {
          method: "POST",
          body: JSON.stringify({ email, password }),
        }),
      );
      setPassword("");
    } catch (e) {
      setLoginError((e as Error).message);
    } finally {
      setLoginBusy(false);
    }
  }
  if (checking)
    return (
      <div className="boot">
        <Brand />
        <p role="status">Открываем рабочее пространство…</p>
      </div>
    );
  if (!user)
    return (
      <main className="login-shell">
        <section className="login-story">
          <Brand />
          <div>
            <span className="eyebrow">АВТОПАРК ПОД КОНТРОЛЕМ</span>
            <h1>
              Каждый рейс.
              <br />
              Понятные цифры.
            </h1>
            <p>
              Машины, маршруты и плановая себестоимость — в одном рабочем
              пространстве.
            </p>
            <div className="route-graphic" aria-hidden="true">
              <span>01</span>
              <i />
              <span>02</span>
              <i />
              <span>03</span>
            </div>
            <div className="route-labels">
              <span>Машина</span>
              <span>Рейс</span>
              <span>Расчёт</span>
            </div>
          </div>
          <small>FLEET / ЛОКАЛЬНАЯ ВЕРСИЯ 0.1</small>
        </section>
        <section className="login-form">
          <div className="login-card">
            <span className="pill">Демонстрационное пространство</span>
            <h2>Войти в Fleet</h2>
            <p className="muted">Продолжите работу со своим автопарком.</p>
            <form onSubmit={login}>
              <label>
                Email
                <input
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              <label>
                Пароль
                <input
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              <Notice text={loginError} />
              <button className="primary full" disabled={loginBusy}>
                {loginBusy ? "Входим…" : "Войти в рабочее пространство →"}
              </button>
            </form>
            <div className="demo-hint">
              <strong>Две независимые организации</strong>
              <p>
                Север: owner@sever.demo
                <br />
                Вектор: owner@vector.demo
              </p>
              <small>Тестовый пароль указан в инструкции запуска.</small>
            </div>
          </div>
        </section>
      </main>
    );
  return (
    <Workspace
      user={user}
      onLogout={() => {
        setUser(null);
        setLoginError("");
      }}
    />
  );
}
function Workspace({
  user,
  onLogout,
}: {
  user: UserContext;
  onLogout: () => void;
}) {
  const [tab, setTab] = useState<"trips" | "vehicles" | "drivers">("trips"),
    [vehicles, setVehicles] = useState<Vehicle[]>([]),
    [trips, setTrips] = useState<Trip[]>([]);
  const [vehicleMore, setVehicleMore] = useState(false),
    [tripMore, setTripMore] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [form, setForm] = useState<"vehicle" | "trip" | null>(null),
    [selected, setSelected] = useState<Trip | null>(null);
  const [vehicleDraft, setVehicleDraft] = useState({ name: "", plate: "" }),
    [tripDraft, setTripDraft] = useState({
      vehicle_id: "",
      origin: "",
      destination: "",
      departure_date: "",
    });
  const requestKey = useRef<{ body: string; key: string } | null>(null);
  const operate = ["owner", "dispatcher"].includes(user.role),
    finance = ["owner", "accountant"].includes(user.role);
  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const [v, t] = await Promise.all([
        api<Page<Vehicle>>("/vehicles?limit=100"),
        api<Page<Trip>>("/trips?limit=20"),
      ]);
      setVehicles(v.items);
      setVehicleMore(v.has_more);
      setTrips(t.items);
      setTripMore(t.has_more);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  async function more(kind: "vehicles" | "trips") {
    setBusy(true);
    setError("");
    try {
      if (kind === "vehicles") {
        const p = await api<Page<Vehicle>>(
          `/vehicles?limit=100&offset=${vehicles.length}`,
        );
        setVehicles([...vehicles, ...p.items]);
        setVehicleMore(p.has_more);
      } else {
        const p = await api<Page<Trip>>(
          `/trips?limit=20&offset=${trips.length}`,
        );
        setTrips([...trips, ...p.items]);
        setTripMore(p.has_more);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const body = JSON.stringify(form === "vehicle" ? vehicleDraft : tripDraft);
    if (requestKey.current?.body !== body)
      requestKey.current = { body, key: crypto.randomUUID() };
    try {
      await api(form === "vehicle" ? "/vehicles" : "/trips", {
        method: "POST",
        headers: { "Idempotency-Key": requestKey.current.key },
        body,
      });
      requestKey.current = null;
      setForm(null);
      setVehicleDraft({ name: "", plate: "" });
      setTripDraft({
        vehicle_id: "",
        origin: "",
        destination: "",
        departure_date: "",
      });
      await refresh();
    } catch (e) {
      const a = e as ApiError;
      setError([a.message, ...Object.values(a.fields)].join(". "));
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    setBusy(true);
    try {
      await api("/auth/logout", { method: "POST" });
      onLogout();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) onLogout();
      else setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="workspace">
      <aside className="sidebar">
        <Brand />
        <div className="org">
          <span className="org-avatar">{user.organization[0]}</span>
          <div>
            <strong>{user.organization}</strong>
            <small>Рабочее пространство</small>
          </div>
        </div>
        <span className="nav-label">УПРАВЛЕНИЕ</span>
        <nav aria-label="Основная навигация">
          {finance && <a href="/period" className="period-link">Эксплуатация за период</a>}
          <button
            className={tab === "trips" ? "active" : ""}
            onClick={() => {
              setTab("trips");
              setSelected(null);
              setForm(null);
            }}
          >
            ↗ <span>Рейсы</span>
          </button>
          <button
            className={tab === "vehicles" ? "active" : ""}
            onClick={() => {
              setTab("vehicles");
              setSelected(null);
              setForm(null);
            }}
          >
            ▤ <span>Автопарк</span>
          </button>
          <button
            className={tab === "drivers" ? "active" : ""}
            onClick={() => {
              setTab("drivers");
              setSelected(null);
              setForm(null);
            }}
          >
            ♙ <span>Водители</span>
          </button>
        </nav>
        <div className="sidebar-bottom">
          <span className="local-dot" /> Локальная версия
          <p>
            Синтетические данные
            <br />
            Без налогов и платежей
          </p>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="breadcrumb">
            Рабочее пространство <span>/</span>{" "}
            {tab === "trips"
              ? "Рейсы"
              : tab === "drivers"
                ? "Водители"
                : "Автопарк"}
          </div>
          <div className="account">
            <span>{roleName[user.role]}</span>
            <button className="text-button" onClick={logout} disabled={busy}>
              Выйти
            </button>
          </div>
        </header>
        <main className="content">
          <div className="page-heading">
            <div>
              <span className="eyebrow">
                {selected ? "ПЛАНИРОВАНИЕ ЗАТРАТ" : "ОПЕРАЦИОННЫЙ УЧЁТ"}
              </span>
              <h1>
                {selected
                  ? finance
                    ? "Себестоимость рейса"
                    : "Карточка рейса"
                  : tab === "trips"
                    ? "Рейсы"
                    : tab === "drivers"
                      ? "Водители"
                      : "Автопарк"}
              </h1>
              <p className="muted">
                {selected
                  ? `${selected.origin} → ${selected.destination}`
                  : tab === "trips"
                    ? "От маршрута до стоимости — всё начинается здесь."
                    : tab === "drivers"
                      ? "Водители вашей организации и назначения на рейсы."
                      : "Машины вашей организации и их регистрационные номера."}
              </p>
            </div>
            {selected ? (
              <button className="secondary" onClick={() => setSelected(null)}>
                ← К рейсам
              </button>
            ) : operate && tab !== "drivers" ? (
              <button
                className="primary"
                onClick={() => {
                  setError("");
                  setForm(tab === "vehicles" ? "vehicle" : "trip");
                }}
              >
                ＋ {tab === "vehicles" ? "Добавить машину" : "Создать рейс"}
              </button>
            ) : (
              <span className="pill">
                {finance ? "Доступ к расчётам" : "Просмотр данных"}
              </span>
            )}
          </div>
          <Notice text={error} />
          {form && !selected && (
            <section className="panel form-panel">
              <div className="section-heading">
                <h2>{form === "vehicle" ? "Новая машина" : "Новый рейс"}</h2>
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() => setForm(null)}
                >
                  Закрыть
                </button>
              </div>
              <form onSubmit={create}>
                <div className="form-grid">
                  {form === "vehicle" ? (
                    <>
                      <label>
                        Название машины
                        <input
                          required
                          minLength={2}
                          maxLength={100}
                          placeholder="Например, Тягач 02"
                          value={vehicleDraft.name}
                          onChange={(e) =>
                            setVehicleDraft({
                              ...vehicleDraft,
                              name: e.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        Государственный / внутренний номер
                        <input
                          required
                          minLength={2}
                          maxLength={20}
                          placeholder="ДЕМО-003"
                          value={vehicleDraft.plate}
                          onChange={(e) =>
                            setVehicleDraft({
                              ...vehicleDraft,
                              plate: e.target.value,
                            })
                          }
                        />
                      </label>
                    </>
                  ) : (
                    <>
                      <label>
                        Машина
                        <select
                          required
                          value={tripDraft.vehicle_id}
                          onChange={(e) =>
                            setTripDraft({
                              ...tripDraft,
                              vehicle_id: e.target.value,
                            })
                          }
                        >
                          <option value="">Выберите машину</option>
                          {vehicles.map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.name} · {v.plate}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Дата отправления
                        <input
                          type="date"
                          required
                          value={tripDraft.departure_date}
                          onChange={(e) =>
                            setTripDraft({
                              ...tripDraft,
                              departure_date: e.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        Откуда
                        <input
                          required
                          minLength={2}
                          maxLength={120}
                          placeholder="Пункт отправления"
                          value={tripDraft.origin}
                          onChange={(e) =>
                            setTripDraft({
                              ...tripDraft,
                              origin: e.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        Куда
                        <input
                          required
                          minLength={2}
                          maxLength={120}
                          placeholder="Пункт назначения"
                          value={tripDraft.destination}
                          onChange={(e) =>
                            setTripDraft({
                              ...tripDraft,
                              destination: e.target.value,
                            })
                          }
                        />
                      </label>
                    </>
                  )}
                </div>
                {form === "trip" && vehicleMore && (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => more("vehicles")}
                  >
                    Загрузить ещё машины
                  </button>
                )}
                {form === "trip" && vehicles.length === 0 && (
                  <p>Сначала добавьте машину во вкладке «Автопарк».</p>
                )}
                <button
                  className="primary"
                  disabled={busy || (form === "trip" && !vehicles.length)}
                >
                  {busy ? "Сохраняем…" : "Сохранить"}
                </button>
              </form>
            </section>
          )}
          {selected ? (
            <TripDetails
              key={selected.id}
              trip={selected}
              user={user}
              onChange={(next) => {
                setSelected(next);
                setTrips((old) =>
                  old.map((t) => (t.id === next.id ? next : t)),
                );
              }}
              renderPlan={(onSaved) => (
                <CostPanel trip={selected} onSaved={onSaved} />
              )}
            />
          ) : tab === "drivers" ? (
            <DriversPanel user={user} />
          ) : (
            <>
              <div className="summary-strip">
                <div>
                  <span className="summary-icon">↗</span>
                  <div>
                    <strong>
                      {trips.length}
                      {tripMore ? "+" : ""}
                    </strong>
                    <small>Рейсов загружено</small>
                  </div>
                </div>
                <div>
                  <span className="summary-icon">▤</span>
                  <div>
                    <strong>
                      {vehicles.length}
                      {vehicleMore ? "+" : ""}
                    </strong>
                    <small>Машин в списке</small>
                  </div>
                </div>
                <div className="summary-note">
                  <span className="pill">Рейсы и расходы</span>
                  <small>Назначения · статусы · план/факт</small>
                </div>
              </div>
              <section className="panel">
                <div className="section-heading">
                  <h2>
                    {tab === "trips" ? "Журнал рейсов" : "Машины организации"}
                  </h2>
                  <button
                    className="text-button"
                    onClick={refresh}
                    disabled={loading}
                  >
                    Обновить ↻
                  </button>
                </div>
                {loading ? (
                  <div className="empty" role="status">
                    Загружаем данные…
                  </div>
                ) : tab === "trips" ? (
                  trips.length ? (
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>Маршрут</th>
                            <th>Машина</th>
                            <th>Отправление</th>
                            <th>Статус</th>
                            <th>
                              <span className="sr-only">Действия</span>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {trips.map((t) => (
                            <tr key={t.id}>
                              <td>
                                <strong>{t.origin}</strong>
                                <span className="table-sub">
                                  → {t.destination}
                                </span>
                              </td>
                              <td>
                                {t.vehicle_name}
                                <span className="table-sub mono">
                                  {t.plate}
                                </span>
                                <span className="table-sub">
                                  {t.driver_name || "Водитель не назначен"}
                                </span>
                              </td>
                              <td className="nowrap">
                                {t.departure_date
                                  .split("-")
                                  .reverse()
                                  .join(".")}
                              </td>
                              <td>
                                <span className={`status status-${t.status}`}>
                                  {statusLabels[t.status]}
                                </span>
                              </td>
                              <td>
                                {
                                  <button
                                    className="row-action"
                                    onClick={() => setSelected(t)}
                                  >
                                    {finance ? "Расчёт →" : "Открыть →"}
                                  </button>
                                }
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="empty">
                      Рейсов пока нет. Создайте первый рейс и назначьте машину.
                    </div>
                  )
                ) : vehicles.length ? (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Машина</th>
                          <th>Номер</th>
                          <th>Версия записи</th>
                        </tr>
                      </thead>
                      <tbody>
                        {vehicles.map((v) => (
                          <tr key={v.id}>
                            <td>
                              <strong>{v.name}</strong>
                            </td>
                            <td className="mono">{v.plate}</td>
                            <td>{v.version}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="empty">
                    Машин пока нет. Добавьте первую машину.
                  </div>
                )}
                {((tab === "trips" && tripMore) ||
                  (tab === "vehicles" && vehicleMore)) && (
                  <div className="table-footer">
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => more(tab as "vehicles" | "trips")}
                    >
                      Загрузить ещё
                    </button>
                  </div>
                )}
              </section>
              <div className="footnote">
                <span>○</span> Данные доступны только участникам вашей
                организации. Все даты рейсов указаны без часового пояса.
              </div>
            </>
          )}
        </main>
        <footer>
          Fleet 0.2 <span>Управление автопарком · Локальная среда</span>
        </footer>
      </div>
    </div>
  );
}
function CostPanel({ trip, onSaved }: { trip: Trip; onSaved: () => void }) {
  const editable = ["draft", "planned"].includes(trip.status);
  const [input, setInput] = useState<CostInput>({ ...emptyCost }),
    [estimates, setEstimates] = useState<Estimate[]>([]),
    [active, setActive] = useState<Estimate | null>(null),
    [error, setError] = useState(""),
    [fields, setFields] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [hasMore, setHasMore] = useState(false),
    [saved, setSaved] = useState(false);
  const retry = useRef<{ body: string; key: string } | null>(null);
  useEffect(() => {
    let alive = true;
    api<Page<Estimate>>(`/trips/${trip.id}/estimates?limit=20`)
      .then((p) => {
        if (alive) {
          setEstimates(p.items);
          setHasMore(p.has_more);
          if (p.items[0]) {
            setActive(p.items[0]);
            setInput(p.items[0].input_snapshot);
          }
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [trip.id]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setFields({});
    setSaved(false);
    const payload = { ...input };
    if (!payload.revenue) delete payload.revenue;
    const body = JSON.stringify(payload);
    if (retry.current?.body !== body)
      retry.current = { body, key: crypto.randomUUID() };
    try {
      const result = await api<Estimate>(`/trips/${trip.id}/estimates`, {
        method: "POST",
        headers: { "Idempotency-Key": retry.current.key },
        body,
      });
      setEstimates((old) => [result, ...old.filter((x) => x.id !== result.id)]);
      setActive(result);
      setSaved(true);
      onSaved();
      retry.current = null;
    } catch (e) {
      const a = e as ApiError;
      setError(a.message);
      setFields(a.fields);
      const first = Object.keys(a.fields)[0];
      document.getElementById(`cost-${first}`)?.focus();
    } finally {
      setBusy(false);
    }
  }
  async function more() {
    setBusy(true);
    try {
      const p = await api<Page<Estimate>>(
        `/trips/${trip.id}/estimates?limit=20&offset=${estimates.length}`,
      );
      setEstimates([...estimates, ...p.items]);
      setHasMore(p.has_more);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const dirty =
    active &&
    (costFields.some((key) => input[key] !== active.input_snapshot[key]) ||
      (input.revenue || "") !== (active.input_snapshot.revenue || ""));
  return (
    <>
      <div className="trip-context">
        <span className={`status status-${trip.status}`}>
          {statusLabels[trip.status]}
        </span>
        <strong>{trip.vehicle_name}</strong>
        <span className="mono">{trip.plate}</span>
        <span>{trip.departure_date.split("-").reverse().join(".")}</span>
      </div>
      <Notice text={error} />
      {!editable && (
        <p className="info-note">
          План закрыт для изменений. Вносите фактические расходы во вкладке
          «Факт и сравнение».
        </p>
      )}
      {active && active.assignment_version !== trip.assignment_version && (
        <p className="info-note">
          Этот снимок относится к прежним параметрам рейса или создан до учёта
          назначений. Для текущей машины сохраните новый план.
        </p>
      )}
      {active?.assignment_snapshot && (
        <p className="muted">
          Машина в снимке: {active.assignment_snapshot.vehicle_name} ·{" "}
          {active.assignment_snapshot.plate}. Водитель:{" "}
          {active.assignment_snapshot.driver_name || "не назначен"}.
        </p>
      )}
      {saved && (
        <div className="success" role="status">
          Расчёт сохранён в базе. Снимок входных данных и результат доступны в
          истории.
        </div>
      )}
      {loading ? (
        <div className="panel empty" role="status">
          Загружаем историю расчётов…
        </div>
      ) : (
        <div className="cost-layout">
          <section className="panel cost-form">
            <div className="section-heading">
              <div>
                <h2>Параметры расчёта</h2>
                <p className="muted">План · RUB · без налогов</p>
              </div>
              <button
                className="text-button"
                type="button"
                disabled={busy}
                onClick={() => {
                  setInput({ ...demo });
                  setFields({});
                  setSaved(false);
                }}
              >
                Взять пример
              </button>
            </div>
            <form onSubmit={submit}>
              <fieldset disabled={!editable || busy}>
                <div className="form-grid">
                  {[...costFields, "revenue" as const].map((k) => (
                    <label key={k} htmlFor={`cost-${k}`}>
                      {fieldLabels[k]}
                      <input
                        id={`cost-${k}`}
                        inputMode="decimal"
                        required={k !== "revenue"}
                        value={input[k] ?? ""}
                        placeholder={k === "revenue" ? "Не указана" : "0.00"}
                        aria-invalid={!!fields[k]}
                        aria-describedby={fields[k] ? `error-${k}` : undefined}
                        onChange={(e) => {
                          setInput({ ...input, [k]: e.target.value });
                          setSaved(false);
                        }}
                      />
                      {fields[k] && (
                        <span className="field-error" id={`error-${k}`}>
                          {fields[k]}
                        </span>
                      )}
                    </label>
                  ))}
                </div>
                <p className="input-note">
                  Десятичные значения вводите с точкой. В «Прочие» не включайте
                  расходы, уже указанные в других строках.
                </p>
                <button className="primary full" disabled={busy}>
                  {busy ? "Сохраняем…" : "Рассчитать и сохранить →"}
                </button>
              </fieldset>
            </form>
          </section>
          <div className="cost-right">
            <section className="result-card">
              <span className="eyebrow">
                {active ? "СОХРАНЁННЫЙ ПЛАН" : "ПЛАНОВАЯ СЕБЕСТОИМОСТЬ"}
              </span>
              <div className="total">
                {active ? money(active.result.total) : "—"}
              </div>
              <p>
                {active
                  ? `${active.result.distance_km} км · ${money(active.result.cost_per_km)} / км`
                  : "Заполните параметры или возьмите эталонный пример."}
              </p>
              {dirty && (
                <div className="draft-note">
                  Параметры изменены. Здесь показан предыдущий сохранённый
                  результат.
                </div>
              )}
              {active && (
                <>
                  <div className="result-lines">
                    {Object.keys(lineName).map((k) => (
                      <div key={k}>
                        <span>{lineName[k]}</span>
                        <strong>{money(active.result.lines[k])}</strong>
                      </div>
                    ))}
                    <div className="subtotal">
                      <span>Прямые расходы</span>
                      <strong>{money(active.result.direct)}</strong>
                    </div>
                    <div>
                      <span>Накладные</span>
                      <strong>{money(active.result.overhead)}</strong>
                    </div>
                  </div>
                  <div className="target-price">
                    <span>Цена с целевой маржой</span>
                    <strong>{money(active.result.target_price)}</strong>
                  </div>
                  <div className="result-lines">
                    <div>
                      <span>Плановая выручка</span>
                      <strong>{money(active.result.revenue)}</strong>
                    </div>
                    <div>
                      <span>Плановая прибыль</span>
                      <strong>{money(active.result.profit)}</strong>
                    </div>
                    <div>
                      <span>Маржа от выручки, доля</span>
                      <strong>{active.result.actual_margin ?? "—"}</strong>
                    </div>
                  </div>
                  <small>
                    Формула v{active.calculation_version} · Тариф{" "}
                    {active.tariff_version}
                    <br />
                    Сохранено{" "}
                    {new Date(active.created_at).toLocaleString("ru-RU", {
                      timeZone: "Europe/Moscow",
                    })}{" "}
                    МСК
                  </small>
                </>
              )}
            </section>
            <section className="panel history">
              <h2>История расчётов</h2>
              {estimates.length ? (
                estimates.map((e, i) => (
                  <button
                    key={e.id}
                    className={
                      active?.id === e.id
                        ? "history-item selected"
                        : "history-item"
                    }
                    onClick={() => {
                      setActive(e);
                      setInput(e.input_snapshot);
                      setSaved(false);
                      setFields({});
                    }}
                  >
                    <span>
                      {i === 0 ? "Последний расчёт" : "Снимок расчёта"}
                      <small>
                        {new Date(e.created_at).toLocaleString("ru-RU", {
                          timeZone: "Europe/Moscow",
                        })}{" "}
                        МСК
                      </small>
                    </span>
                    <strong>{money(e.total)}</strong>
                  </button>
                ))
              ) : (
                <p className="muted">Сохранённые расчёты появятся здесь.</p>
              )}
              {hasMore && (
                <button className="text-button" disabled={busy} onClick={more}>
                  Загрузить ещё
                </button>
              )}
            </section>
          </div>
        </div>
      )}
      <div className="footnote">
        ○ Нулевой пробег: стоимость километра не определяется. Нулевая выручка:
        маржа не определяется. Каждый новый расчёт сохраняется отдельным
        снимком.
      </div>
    </>
  );
}
