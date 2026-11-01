"use client";
import { useEffect, useState } from "react";
import type { UserContext, Vehicle } from "@fleet/shared";
import { api, type Page } from "../api";
import { PeriodPanel } from "../period-ui";
export default function VehiclePeriods() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]),
    [more, setMore] = useState(false),
    [id, setId] = useState("");
  const [allowed, setAllowed] = useState(false),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const u = await api<UserContext>("/auth/me");
        if (!["owner", "accountant"].includes(u.role))
          throw new Error("Раздел доступен владельцу и бухгалтеру");
        const p = await api<Page<Vehicle>>("/vehicles?limit=100");
        if (alive) {
          setAllowed(true);
          setVehicles(p.items);
          setMore(p.has_more);
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  return (
    <main className="content">
      <a href="/">← Рейсы и автопарк</a>
      <h1>Эксплуатация техники за период</h1>
      {loading && <p role="status">Загрузка…</p>}
      {error && <p role="alert">{error}</p>}
      {allowed && (
        <>
          <label>
            Техника
            <select
              aria-label="Техника"
              value={id}
              onChange={(e) => setId(e.target.value)}
            >
              <option value="">Выберите машину</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} · {v.plate}
                </option>
              ))}
            </select>
          </label>
          {more && (
            <button
              onClick={() => {
                void api<Page<Vehicle>>(
                  `/vehicles?limit=100&offset=${vehicles.length}`,
                )
                  .then((p) => {
                    setVehicles([...vehicles, ...p.items]);
                    setMore(p.has_more);
                  })
                  .catch((e) => setError(e.message));
              }}
            >
              Загрузить ещё машины
            </button>
          )}
          {!vehicles.length && <p>Сначала создайте машину в автопарке.</p>}
          {id && <PeriodPanel key={id} vehicleId={id} />}
        </>
      )}
    </main>
  );
}
