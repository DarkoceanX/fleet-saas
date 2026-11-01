CREATE TABLE drivers (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES organizations(id),
 name text NOT NULL, staff_code text NOT NULL, active boolean NOT NULL DEFAULT true,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,staff_code)
);
CREATE INDEX drivers_tenant_created ON drivers(tenant_id,created_at DESC,id DESC);
ALTER TABLE trips ADD COLUMN driver_id uuid,
 ADD COLUMN assignment_version integer NOT NULL DEFAULT 1 CHECK(assignment_version>0),
 ADD COLUMN baseline_estimate_id uuid,
 ADD COLUMN started_at timestamptz, ADD COLUMN completed_at timestamptz,
 ADD COLUMN cancelled_at timestamptz;
ALTER TABLE trips ADD FOREIGN KEY(tenant_id,driver_id) REFERENCES drivers(tenant_id,id);
ALTER TABLE trips DROP CONSTRAINT trips_status_check;
ALTER TABLE trips ADD CONSTRAINT trips_status_check CHECK(status IN ('draft','planned','in_progress','completed','cancelled'));
ALTER TABLE trips ADD CONSTRAINT trips_driver_required CHECK(status NOT IN ('planned','in_progress','completed') OR driver_id IS NOT NULL);
CREATE UNIQUE INDEX trips_active_vehicle ON trips(tenant_id,vehicle_id) WHERE status IN ('planned','in_progress');
CREATE UNIQUE INDEX trips_active_driver ON trips(tenant_id,driver_id) WHERE status IN ('planned','in_progress');
ALTER TABLE cost_estimates ADD COLUMN assignment_version integer,
 ADD COLUMN assignment_snapshot jsonb,
 ADD CONSTRAINT estimates_trip_identity UNIQUE(tenant_id,trip_id,id);
ALTER TABLE trips ADD FOREIGN KEY(tenant_id,id,baseline_estimate_id) REFERENCES cost_estimates(tenant_id,trip_id,id);
CREATE TABLE trip_status_events (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, trip_id uuid NOT NULL, actor_id uuid NOT NULL,
 from_status text NOT NULL, to_status text NOT NULL, reason text, trip_version integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,trip_id) REFERENCES trips(tenant_id,id),
 FOREIGN KEY(tenant_id,actor_id) REFERENCES memberships(tenant_id,user_id),
 UNIQUE(tenant_id,trip_id,trip_version)
);
CREATE TABLE expenses (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, trip_id uuid NOT NULL,
 category text NOT NULL CHECK(category IN ('fuel','driver','maintenance','depreciation','tolls','other_direct','overhead')),
 amount numeric(14,2) NOT NULL CHECK(amount>0), currency text NOT NULL CHECK(currency='RUB'),
 incurred_on date NOT NULL, note text NOT NULL, created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 voided_at timestamptz, voided_by uuid, void_reason text,
 FOREIGN KEY(tenant_id,trip_id) REFERENCES trips(tenant_id,id),
 FOREIGN KEY(tenant_id,created_by) REFERENCES memberships(tenant_id,user_id),
 FOREIGN KEY(tenant_id,voided_by) REFERENCES memberships(tenant_id,user_id),
 UNIQUE(tenant_id,id),
 CHECK((voided_at IS NULL AND voided_by IS NULL AND void_reason IS NULL) OR
       (voided_at IS NOT NULL AND voided_by IS NOT NULL AND length(void_reason)>=3))
);
CREATE INDEX expenses_tenant_trip ON expenses(tenant_id,trip_id,created_at DESC,id DESC);
ALTER TABLE audit_events ADD COLUMN details jsonb NOT NULL DEFAULT '{}'::jsonb;
