CREATE TABLE IF NOT EXISTS hotels (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  source_url TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS pricing_profiles (
  id TEXT PRIMARY KEY NOT NULL,
  adults INTEGER NOT NULL CHECK (adults > 0),
  children INTEGER NOT NULL CHECK (children >= 0),
  rooms INTEGER NOT NULL CHECK (rooms > 0),
  nights INTEGER NOT NULL CHECK (nights > 0),
  meal TEXT NOT NULL,
  point_mode TEXT NOT NULL,
  tax_included INTEGER NOT NULL CHECK (tax_included IN (0,1)),
  currency TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS crawl_runs (
  id TEXT PRIMARY KEY NOT NULL,
  hotel_id TEXT NOT NULL REFERENCES hotels(id),
  pricing_profile_id TEXT NOT NULL REFERENCES pricing_profiles(id),
  observed_at TEXT NOT NULL,
  ingested_at TEXT NOT NULL,
  crawler_version TEXT,
  payload_sha256 TEXT NOT NULL,
  observation_count INTEGER NOT NULL CHECK (observation_count BETWEEN 1 AND 400)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS price_observations (
  hotel_id TEXT NOT NULL REFERENCES hotels(id),
  pricing_profile_id TEXT NOT NULL REFERENCES pricing_profiles(id),
  run_id TEXT NOT NULL REFERENCES crawl_runs(id),
  stay_date TEXT NOT NULL,
  available INTEGER NOT NULL CHECK (available IN (0,1)),
  price_jpy INTEGER CHECK (price_jpy IS NULL OR price_jpy > 0),
  room_name TEXT,
  plan_name TEXT,
  source_url TEXT,
  observed_at TEXT NOT NULL,
  PRIMARY KEY (hotel_id,pricing_profile_id,stay_date,run_id),
  CHECK ((available = 1 AND price_jpy IS NOT NULL) OR
         (available = 0 AND price_jpy IS NULL))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_prices_date
  ON price_observations (hotel_id,pricing_profile_id,stay_date,observed_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_prices_observed
  ON price_observations (hotel_id,pricing_profile_id,observed_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_runs_hotel_observed
  ON crawl_runs (hotel_id,pricing_profile_id,observed_at DESC);
--> statement-breakpoint
INSERT OR IGNORE INTO hotels (id,name,source_url)
VALUES ('ritz-carlton-nikko','ザ・リッツ・カールトン日光','https://www.ikyu.com/00002777/');
--> statement-breakpoint
INSERT OR IGNORE INTO pricing_profiles
 (id,adults,children,rooms,nights,meal,point_mode,tax_included,currency)
VALUES ('standard-2a-1r-1n',2,0,1,1,'any','before_instant_point_discount',1,'JPY');
