-- Businesses using the platform
CREATE TABLE businesses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,           -- unique: it's now also the login identifier
  password_hash TEXT NOT NULL,         -- dashboard login (separate from the API key)
  api_key_hash TEXT NOT NULL,
  webhook_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Global customer address book — keyed by phone, shared across ALL businesses.
-- A location saved via Business A is immediately reusable by Business B.
CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT UNIQUE NOT NULL,          -- E.164 normalized, e.g. +237670000000
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Optional per-business bookkeeping reference for a customer.
-- Does NOT affect location reuse — that's keyed by phone alone.
CREATE TABLE business_customers (
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  customer_uid TEXT,                   -- business's own internal reference, optional
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (business_id, customer_id)
);

-- Driver accounts. A driver signs up once with their own credentials.
CREATE TABLE drivers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  phone TEXT UNIQUE NOT NULL,          -- E.164 normalized; also the login identifier
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Many-to-many: a driver can belong to multiple businesses.
-- No approval workflow — a valid business_id at signup makes this row active immediately.
CREATE TABLE driver_businesses (
  driver_id UUID REFERENCES drivers(id) ON DELETE CASCADE,
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (driver_id, business_id)
);

-- Deliveries
CREATE TABLE deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  order_id TEXT NOT NULL,
  customer_id UUID REFERENCES customers(id),
  customer_lat DOUBLE PRECISION,       -- snapshot at time of THIS order
  customer_lng DOUBLE PRECISION,       -- (a later address correction never rewrites this)
  driver_id UUID REFERENCES drivers(id),
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | assigned | in_progress | delivered
  picker_token TEXT,                   -- signed token for the location-picker link, if needed
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_deliveries_business ON deliveries(business_id);
CREATE INDEX idx_deliveries_driver ON deliveries(driver_id);
CREATE INDEX idx_deliveries_customer ON deliveries(customer_id);