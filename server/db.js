// Database: one SQLite file (data/myrightmyride.db). No external database service and no per-use fees.
const path = require("path");
const Database = require("better-sqlite3");

const file = process.env.DB_FILE || path.join(__dirname, "..", "data", "myrightmyride.db");
const db = new Database(file);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  last_login INTEGER,
  last_logout INTEGER,
  logged_in INTEGER NOT NULL DEFAULT 0,
  last_seen INTEGER,
  blocked INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS otps (
  phone TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  sent_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS drivers (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  vehicle_type TEXT NOT NULL,
  vehicle_no TEXT NOT NULL,
  licence_no TEXT,
  upi TEXT,
  status TEXT NOT NULL DEFAULT 'pending',      -- pending | approved | blocked
  undertaking_at INTEGER,
  online INTEGER NOT NULL DEFAULT 0,
  lat REAL, lng REAL, loc_at INTEGER
);
CREATE TABLE IF NOT EXISTS rides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  passenger_id INTEGER NOT NULL REFERENCES users(id),
  driver_id INTEGER REFERENCES users(id),
  vehicle_type TEXT NOT NULL,
  pickup_lat REAL NOT NULL, pickup_lng REAL NOT NULL, pickup_label TEXT NOT NULL,
  drop_lat REAL NOT NULL, drop_lng REAL NOT NULL, drop_label TEXT NOT NULL,
  note TEXT,
  fare_mode TEXT NOT NULL DEFAULT 'meter',      -- meter | fixed
  fixed_fare INTEGER,
  final_fare INTEGER,
  pay_method TEXT NOT NULL,                     -- cash | upi | card
  paid INTEGER NOT NULL DEFAULT 0, paid_at INTEGER, paid_confirmed_by TEXT,
  insurance TEXT NOT NULL DEFAULT 'none',
  otp TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'requested',     -- requested | accepted | started | completed | cancelled
  cancelled_by TEXT,
  pay_undertaking INTEGER NOT NULL DEFAULT 0,
  safety_ack INTEGER NOT NULL DEFAULT 0,
  driver_undertaking INTEGER NOT NULL DEFAULT 0,
  driver_lat REAL, driver_lng REAL,
  track TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL, accepted_at INTEGER, started_at INTEGER, ended_at INTEGER
);
CREATE INDEX IF NOT EXISTS rides_status ON rides(status, vehicle_type);
CREATE INDEX IF NOT EXISTS rides_passenger ON rides(passenger_id);
CREATE INDEX IF NOT EXISTS rides_driver ON rides(driver_id);
CREATE TABLE IF NOT EXISTS places (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  state TEXT, district TEXT, taluka TEXT,
  lat REAL, lng REAL,
  status TEXT NOT NULL DEFAULT 'approved',      -- approved | pending (suggested by a user)
  suggested_by INTEGER REFERENCES users(id),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS places_area ON places(state, district, taluka, category);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS admin_sessions (
  token TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);
`);

module.exports = db;
