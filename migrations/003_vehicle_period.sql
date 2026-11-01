-- No backfill guesses ownership, categories or recognition of existing trip expenses.
CREATE TABLE vehicle_cost_profiles (
 tenant_id uuid NOT NULL, vehicle_id uuid NOT NULL, ownership text NOT NULL CHECK(ownership IN ('owned','rented')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0), PRIMARY KEY(tenant_id,vehicle_id),
 FOREIGN KEY(tenant_id,vehicle_id) REFERENCES vehicles(tenant_id,id)
);
CREATE TABLE vehicle_readings (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, vehicle_id uuid NOT NULL, date date NOT NULL,
 km numeric(12,3) CHECK(km>=0), work_hours numeric(12,3) CHECK(work_hours>=0), engine_hours numeric(12,3) CHECK(engine_hours>=0),
 note text NOT NULL, version integer NOT NULL DEFAULT 1 CHECK(version>0),
 CHECK(km IS NOT NULL OR work_hours IS NOT NULL OR engine_hours IS NOT NULL),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,vehicle_id,date), FOREIGN KEY(tenant_id,vehicle_id) REFERENCES vehicles(tenant_id,id)
);
CREATE TABLE vehicle_cost_entries (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, vehicle_id uuid NOT NULL,
 source text NOT NULL CHECK(source IN ('manual','trip')), trip_expense_id uuid,
 source_vehicle_id uuid, source_category text, category text NOT NULL CHECK(category IN ('fuel','lubricants','technical_fluids','consumables','driver_pay','payroll_charges','operator_related','tires','repairs_maintenance','technical_inspection','diagnostics','spare_parts','insurance_tax','permits_fees','attachment_rental','parking_storage','washing','tolls','evacuation','communications','overhead','financing_interest','incidents','depreciation','rental','other')),
 date date, amount numeric(14,2) CHECK(amount>=0), currency text NOT NULL DEFAULT 'RUB' CHECK(currency='RUB'),
 note text NOT NULL CHECK(length(note)>=3), version integer NOT NULL DEFAULT 1 CHECK(version>0),
 deleted_at timestamptz, created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,trip_expense_id),
 FOREIGN KEY(tenant_id,vehicle_id) REFERENCES vehicles(tenant_id,id),
 FOREIGN KEY(tenant_id,trip_expense_id) REFERENCES expenses(tenant_id,id),
 FOREIGN KEY(tenant_id,source_vehicle_id) REFERENCES vehicles(tenant_id,id),
 FOREIGN KEY(tenant_id,created_by) REFERENCES memberships(tenant_id,user_id),
 CHECK((source='manual' AND trip_expense_id IS NULL AND source_category IS NULL AND source_vehicle_id IS NULL AND date IS NOT NULL AND amount IS NOT NULL)
 OR (source='trip' AND trip_expense_id IS NOT NULL AND source_category IS NOT NULL AND source_vehicle_id IS NOT NULL AND date IS NULL AND amount IS NULL AND deleted_at IS NULL))
);
CREATE INDEX vehicle_cost_entries_vehicle ON vehicle_cost_entries(tenant_id,vehicle_id);
CREATE TABLE vehicle_period_revisions (tenant_id uuid PRIMARY KEY REFERENCES organizations(id), revision integer NOT NULL DEFAULT 0);
CREATE TABLE vehicle_period_reviews (
 tenant_id uuid NOT NULL, vehicle_id uuid NOT NULL, start_date date NOT NULL, end_date date NOT NULL,
 revision integer NOT NULL, states jsonb NOT NULL, reviewed_by uuid NOT NULL, reviewed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,vehicle_id,start_date,end_date), CHECK(end_date>=start_date),
 FOREIGN KEY(tenant_id,vehicle_id) REFERENCES vehicles(tenant_id,id),
 FOREIGN KEY(tenant_id,reviewed_by) REFERENCES memberships(tenant_id,user_id)
);
-- A deliberately conservative tenant revision invalidates all period attestations.
-- The same lock is acquired by period reports/reviews; no mixed-source snapshots.
CREATE FUNCTION invalidate_vehicle_period() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE tenant uuid;
BEGIN
 tenant := CASE WHEN TG_OP='DELETE' THEN OLD.tenant_id ELSE NEW.tenant_id END;
 PERFORM pg_advisory_xact_lock(hashtextextended('vehicle-period:' || tenant::text,0));
 INSERT INTO vehicle_period_revisions(tenant_id,revision) VALUES(tenant,1)
 ON CONFLICT(tenant_id) DO UPDATE SET revision=vehicle_period_revisions.revision+1;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE TRIGGER period_profile_revision BEFORE INSERT OR UPDATE OR DELETE ON vehicle_cost_profiles FOR EACH ROW EXECUTE FUNCTION invalidate_vehicle_period();
CREATE TRIGGER period_reading_revision BEFORE INSERT OR UPDATE OR DELETE ON vehicle_readings FOR EACH ROW EXECUTE FUNCTION invalidate_vehicle_period();
CREATE TRIGGER period_entry_revision BEFORE INSERT OR UPDATE OR DELETE ON vehicle_cost_entries FOR EACH ROW EXECUTE FUNCTION invalidate_vehicle_period();
CREATE TRIGGER period_expense_revision BEFORE INSERT OR UPDATE OR DELETE ON expenses FOR EACH ROW EXECUTE FUNCTION invalidate_vehicle_period();
CREATE TRIGGER period_trip_revision BEFORE UPDATE OF vehicle_id ON trips FOR EACH ROW EXECUTE FUNCTION invalidate_vehicle_period();
CREATE TRIGGER period_vehicle_revision BEFORE UPDATE ON vehicles FOR EACH ROW EXECUTE FUNCTION invalidate_vehicle_period();
