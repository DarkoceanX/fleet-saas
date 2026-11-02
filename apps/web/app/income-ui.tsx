"use client";
import { useEffect, useRef, useState } from "react";
import type {
  IncomeEntry,
  IncomeWorkspace,
  Trip,
  Vehicle,
} from "@fleet/shared";
import { api, type Page } from "./api";
const money = (v: string | null) => (v === null ? "неизвестно" : `${v} RUB`);
type Draft = {
  id: string | null;
  version: number;
  key: string;
  vehicle_id: string;
  trip_id: string;
  recognized_on: string;
  amount: string;
  source_ref: string;
  note: string;
  reason: string;
};
export function IncomePanel({
  data,
  vehicleId,
  tripId,
  range,
  onChange,
  onMutationStart,
  pagination,
}: {
  data: IncomeWorkspace;
  vehicleId: string;
  tripId?: string;
  range?: { start_date: string; end_date: string };
  onChange: () => Promise<void>;
  onMutationStart?: () => void;
  pagination?: {
    total: number;
    more: boolean;
    busy: boolean;
    load: () => Promise<void>;
  };
}) {
  const [draft, setDraft] = useState<Draft | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [vehicles, setVehicles] = useState<Vehicle[]>([]),
    [trips, setTrips] = useState<Trip[]>([]),
    [moreV, setMoreV] = useState(false),
    [moreT, setMoreT] = useState(false);
  const [review, setReview] = useState("confirmed"),
    [basis, setBasis] = useState("");
  const retry = useRef<{ body: string; key: string } | null>(null);
  useEffect(() => {
    let alive = true;
    Promise.all([
      api<Page<Vehicle>>("/vehicles?limit=100"),
      api<Page<Trip>>("/trips?limit=100"),
    ])
      .then(([v, t]) => {
        if (alive) {
          setVehicles(v.items);
          setMoreV(v.has_more);
          setTrips(t.items);
          setMoreT(t.has_more);
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, []);
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
  async function send(path: string, body: unknown, key?: string) {
    onMutationStart?.();
    const encoded = JSON.stringify(body),
      fingerprint = path + encoded;
    if (retry.current?.body !== fingerprint)
      retry.current = { body: fingerprint, key: crypto.randomUUID() };
    await api(path, {
      method: "POST",
      body: encoded,
      headers: { "Idempotency-Key": key ?? retry.current!.key },
    });
    retry.current = null;
  }
  function open(row?: IncomeEntry) {
    setError("");
    retry.current = null;
    setDraft({
      id: row?.id ?? null,
      version: row?.version ?? 0,
      key: crypto.randomUUID(),
      vehicle_id: row?.vehicle_id ?? vehicleId,
      trip_id: row?.trip_id ?? tripId ?? "",
      recognized_on: row?.recognized_on ?? "",
      amount: row?.amount ?? "",
      source_ref: row?.source_ref ?? "",
      note: row?.note ?? "",
      reason: "",
    });
  }
  function field(k: keyof Draft, v: string) {
    if (draft) setDraft({ ...draft, [k]: v, key: crypto.randomUUID() });
  }
  const s = data.summary;
  return (
    <section aria-label="Фактические доходы" className="panel">
      <h3>Фактические доходы и результат</h3>
      <p>
        Плановая цена не является доходом. Дата признания и машина указываются
        явно. Один номер основания — одна запись для рейса и машины; уже
        внесённый доход привяжите к рейсу через изменение, не создавайте второй.
      </p>
      {error && <p role="alert">{error}</p>}
      <div className="summary-strip">
        <div>
          <small>
            Признанный доход:{" "}
            {s.status === "unknown"
              ? "неизвестно"
              : s.income_reviewed
                ? "полнота подтверждена"
                : "внесённая часть"}
          </small>
          <strong data-testid="income-total">{money(s.actual_revenue)}</strong>
        </div>
        <div>
          <small>Доход − внесённые расходы</small>
          <strong data-testid="income-result">
            {money(s.financial_result)}
          </strong>
        </div>
      </div>
      <p>
        {s.financial_result_reviewed
          ? "Полнота доходов и расходов периода подтверждена пользователем."
          : "Результат предварительный: он не подтверждает полноту всех доходов и расходов."}{" "}
        Себестоимость рассчитывается из расходов до вычета доходов.
      </p>
      {s.source_warning && (
        <p role="alert">
          Изменилась машина рейса. Измените запись с основанием, явно подтвердив
          нужную машину; сумма не переносится автоматически.
        </p>
      )}
      {data.recognized_elsewhere.map((e) => (
        <p key={e.id}>
          Доход {e.source_ref}: {e.amount} RUB признан за другой машиной{" "}
          {e.vehicle_id}; здесь не включён.
        </p>
      ))}
      <button type="button" disabled={busy} onClick={() => open()}>
        Добавить фактический доход
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => void perform(onChange)}
      >
        Обновить доходы
      </button>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Дата / основание</th>
              <th>RUB</th>
              <th>Источник</th>
              <th>Действия</th>
            </tr>
          </thead>
          <tbody>
            {data.entries.map((e) => (
              <tr key={e.id} data-testid="income-row">
                <td>
                  {e.recognized_on}
                  <br />
                  {e.source_ref}
                  <br />
                  {e.note}
                </td>
                <td>
                  {e.amount}
                  {e.voided_at && " (аннулирован)"}
                </td>
                <td>
                  {e.trip_id ? `Рейс ${e.trip_id}` : "Вне рейса"}
                  <br />
                  <small>Источник: {e.id}</small>
                  <br />
                  <small>Машина: {e.vehicle_id}</small>
                </td>
                <td>
                  {!e.voided_at && (
                    <>
                      <button disabled={busy} onClick={() => open(e)}>
                        Изменить доход
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => {
                          const reason = window.prompt(
                            "Причина аннулирования дохода (не менее 3 символов)",
                          );
                          if (reason !== null)
                            void perform(async () => {
                              await send(`/income/${e.id}/void`, {
                                version: e.version,
                                reason,
                              });
                              setDraft(null);
                              await onChange();
                            });
                        }}
                      >
                        Аннулировать доход
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pagination && (
        <p>
          Показано доходов: {data.entries.length} из {pagination.total}. Итоги и
          полнота — за весь период.
        </p>
      )}
      {pagination?.more && (
        <button
          type="button"
          disabled={busy || pagination.busy}
          onClick={() => void pagination.load()}
        >
          Загрузить ещё доходы
        </button>
      )}
      {draft && (
        <form
          aria-label="Редактор дохода"
          onSubmit={(e) => {
            e.preventDefault();
            void perform(async () => {
              const { id, version, key, reason, ...body } = draft;
              await send(
                `/income${id ? `/${id}` : ""}`,
                {
                  ...body,
                  trip_id: body.trip_id || null,
                  currency: "RUB",
                  ...(id ? { version, reason } : {}),
                },
                key,
              );
              setDraft(null);
              await onChange();
            });
          }}
        >
          <fieldset disabled={busy}>
            <h4>
              {draft.id
                ? "Изменить признанный доход"
                : "Новый признанный доход"}
            </h4>
            <label>
              Машина признания
              <select
                name="income_vehicle"
                required
                value={draft.vehicle_id}
                onChange={(e) => field("vehicle_id", e.target.value)}
              >
                {!vehicles.some((v) => v.id === draft.vehicle_id) && (
                  <option value={draft.vehicle_id}>{draft.vehicle_id}</option>
                )}
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} · {v.plate}
                  </option>
                ))}
              </select>
            </label>
            {moreV && (
              <button
                type="button"
                onClick={() =>
                  void perform(async () => {
                    const p = await api<Page<Vehicle>>(
                      `/vehicles?limit=100&offset=${vehicles.length}`,
                    );
                    setVehicles([...vehicles, ...p.items]);
                    setMoreV(p.has_more);
                  })
                }
              >
                Ещё машины для дохода
              </button>
            )}
            <label>
              Связанный рейс
              <select
                name="income_trip"
                value={draft.trip_id}
                onChange={(e) => field("trip_id", e.target.value)}
              >
                <option value="">Вне рейса</option>
                {draft.trip_id &&
                  !trips.some((t) => t.id === draft.trip_id) && (
                    <option value={draft.trip_id}>{draft.trip_id}</option>
                  )}
                {trips.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.origin} → {t.destination} · {t.departure_date}
                  </option>
                ))}
              </select>
            </label>
            {moreT && (
              <button
                type="button"
                onClick={() =>
                  void perform(async () => {
                    const p = await api<Page<Trip>>(
                      `/trips?limit=100&offset=${trips.length}`,
                    );
                    setTrips([...trips, ...p.items]);
                    setMoreT(p.has_more);
                  })
                }
              >
                Ещё рейсы для дохода
              </button>
            )}
            <label>
              Дата признания
              <input
                name="income_date"
                type="date"
                required
                value={draft.recognized_on}
                onChange={(e) => field("recognized_on", e.target.value)}
              />
            </label>
            <label>
              Фактическая сумма, RUB
              <input
                name="income_amount"
                inputMode="decimal"
                required
                value={draft.amount}
                onChange={(e) => field("amount", e.target.value)}
              />
            </label>
            <label>
              Уникальный номер основания
              <input
                name="income_ref"
                required
                minLength={3}
                maxLength={120}
                value={draft.source_ref}
                onChange={(e) => field("source_ref", e.target.value)}
              />
            </label>
            <label>
              Описание основания
              <input
                name="income_note"
                required
                minLength={3}
                value={draft.note}
                onChange={(e) => field("note", e.target.value)}
              />
            </label>
            {draft.id && (
              <label>
                Причина изменения / перепроверки
                <input
                  name="income_reason"
                  required
                  minLength={3}
                  value={draft.reason}
                  onChange={(e) => field("reason", e.target.value)}
                />
              </label>
            )}
            <button>Сохранить доход</button>
            <button
              type="button"
              onClick={() => {
                setDraft(null);
                retry.current = null;
                setError("");
              }}
            >
              Отмена дохода
            </button>
          </fieldset>
        </form>
      )}
      {range && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void perform(async () => {
              await send(`/vehicles/${vehicleId}/period/income-review`, {
                ...range,
                expected_revision: s.revision,
                status: review,
                reason: basis,
              });
              await onChange();
            });
          }}
        >
          <fieldset disabled={busy}>
            <label>
              Полнота доходов периода
              <select
                aria-label="Полнота доходов"
                value={review}
                onChange={(e) => setReview(e.target.value)}
              >
                <option value="confirmed">Все доходы проверены</option>
                <option value="zero">Подтверждаю: доходов не было</option>
                <option value="unreviewed">Проверка не завершена</option>
              </select>
            </label>
            <label>
              Основание проверки
              <input
                name="income_review_reason"
                required
                minLength={3}
                value={basis}
                onChange={(e) => setBasis(e.target.value)}
              />
            </label>
            <button>Подтвердить доходы периода</button>
          </fieldset>
        </form>
      )}
    </section>
  );
}
export function TripIncomePanel({ trip }: { trip: Trip }) {
  const [data, setData] = useState<IncomeWorkspace | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    api<IncomeWorkspace>(`/trips/${trip.id}/income`)
      .then((d) => {
        if (alive) {
          setData(d);
          setError("");
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [trip.id, trip.version]);
  const load = async () => {
    setData(await api<IncomeWorkspace>(`/trips/${trip.id}/income`));
  };
  return (
    <>
      {error && <p role="alert">{error}</p>}
      {data && (
        <IncomePanel
          key={`${trip.id}:${trip.version}`}
          data={data}
          vehicleId={trip.vehicle_id}
          tripId={trip.id}
          onChange={load}
        />
      )}
    </>
  );
}
