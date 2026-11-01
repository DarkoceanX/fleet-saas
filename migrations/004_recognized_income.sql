-- One canonical recognized income, viewed by trip and by vehicle; no import of estimate revenue.
CREATE TABLE recognized_income (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, vehicle_id uuid NOT NULL, trip_id uuid,
 source_vehicle_id uuid, recognized_on date NOT NULL, amount numeric(14,2) NOT NULL CHECK(amount>=0),
 currency text NOT NULL CHECK(currency='RUB'), source_ref text NOT NULL CHECK(length(source_ref) BETWEEN 3 AND 120 AND source_ref=upper(btrim(source_ref))),
 note text NOT NULL CHECK(length(note) BETWEEN 3 AND 2000), version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 voided_at timestamptz, voided_by uuid, void_reason text,
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,source_ref),
 FOREIGN KEY(tenant_id,vehicle_id) REFERENCES vehicles(tenant_id,id),
 FOREIGN KEY(tenant_id,trip_id) REFERENCES trips(tenant_id,id),
 FOREIGN KEY(tenant_id,source_vehicle_id) REFERENCES vehicles(tenant_id,id),
 FOREIGN KEY(tenant_id,created_by) REFERENCES memberships(tenant_id,user_id),
 FOREIGN KEY(tenant_id,voided_by) REFERENCES memberships(tenant_id,user_id),
 CHECK((trip_id IS NULL AND source_vehicle_id IS NULL) OR (trip_id IS NOT NULL AND source_vehicle_id IS NOT NULL)),
 CHECK((voided_at IS NULL AND voided_by IS NULL AND void_reason IS NULL) OR (voided_at IS NOT NULL AND voided_by IS NOT NULL AND length(void_reason)>=3))
);
CREATE INDEX income_vehicle_date ON recognized_income(tenant_id,vehicle_id,recognized_on);
CREATE INDEX income_trip ON recognized_income(tenant_id,trip_id);
CREATE TABLE income_period_reviews (
 tenant_id uuid NOT NULL, vehicle_id uuid NOT NULL, start_date date NOT NULL, end_date date NOT NULL CHECK(end_date>=start_date),
 revision integer NOT NULL CHECK(revision>=0), status text NOT NULL CHECK(status IN ('confirmed','zero','unreviewed')),
 reason text NOT NULL CHECK(length(reason)>=3), reviewed_by uuid NOT NULL, reviewed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,vehicle_id,start_date,end_date),
 FOREIGN KEY(tenant_id,vehicle_id) REFERENCES vehicles(tenant_id,id),
 FOREIGN KEY(tenant_id,reviewed_by) REFERENCES memberships(tenant_id,user_id)
);
CREATE TRIGGER income_period_revision BEFORE INSERT OR UPDATE OR DELETE ON recognized_income FOR EACH ROW EXECUTE FUNCTION invalidate_vehicle_period();
