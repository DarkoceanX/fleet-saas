CREATE TABLE organizations (id uuid PRIMARY KEY, name text NOT NULL);
CREATE TABLE users (id uuid PRIMARY KEY, email text NOT NULL UNIQUE, name text NOT NULL, password_hash text NOT NULL);
CREATE TABLE memberships (
 tenant_id uuid NOT NULL REFERENCES organizations(id), user_id uuid NOT NULL REFERENCES users(id),
 role text NOT NULL CHECK(role IN ('owner','dispatcher','accountant','viewer')), PRIMARY KEY(tenant_id,user_id)
);
CREATE TABLE sessions (
 token_hash text PRIMARY KEY, tenant_id uuid NOT NULL, user_id uuid NOT NULL, expires_at timestamptz NOT NULL,
 FOREIGN KEY(tenant_id,user_id) REFERENCES memberships(tenant_id,user_id) ON DELETE CASCADE
);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE vehicles (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES organizations(id), name text NOT NULL, plate text NOT NULL,
 version integer NOT NULL DEFAULT 1 CHECK(version > 0), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,plate)
);
CREATE TABLE trips (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES organizations(id), vehicle_id uuid NOT NULL,
 origin text NOT NULL, destination text NOT NULL, departure_date date NOT NULL,
 status text NOT NULL DEFAULT 'draft' CHECK(status = 'draft'), version integer NOT NULL DEFAULT 1 CHECK(version > 0),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,vehicle_id) REFERENCES vehicles(tenant_id,id)
);
CREATE INDEX trips_tenant_created ON trips(tenant_id,created_at DESC,id DESC);
CREATE INDEX vehicles_tenant_created ON vehicles(tenant_id,created_at DESC,id DESC);
CREATE TABLE cost_estimates (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES organizations(id), trip_id uuid NOT NULL,
 currency text NOT NULL CHECK(currency = 'RUB'), calculation_version text NOT NULL, tariff_version text NOT NULL,
 input_snapshot jsonb NOT NULL, result jsonb NOT NULL, total numeric(60,2) NOT NULL CHECK(total >= 0),
 created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,trip_id) REFERENCES trips(tenant_id,id),
 FOREIGN KEY(tenant_id,created_by) REFERENCES memberships(tenant_id,user_id), UNIQUE(tenant_id,id)
);
CREATE INDEX estimates_tenant_trip ON cost_estimates(tenant_id,trip_id,created_at DESC,id DESC);
CREATE TABLE audit_events (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, actor_id uuid NOT NULL, entity_id uuid NOT NULL,
 action text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(tenant_id,actor_id) REFERENCES memberships(tenant_id,user_id)
);
CREATE TABLE idempotency_keys (
 tenant_id uuid NOT NULL REFERENCES organizations(id), actor_id uuid NOT NULL, operation text NOT NULL, key uuid NOT NULL,
 request_hash text NOT NULL, response jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,actor_id,operation,key), FOREIGN KEY(tenant_id,actor_id) REFERENCES memberships(tenant_id,user_id)
);
