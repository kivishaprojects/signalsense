-- =====================================================
-- SignalSense AI — Production Database Schema
-- =====================================================

-- Cities (tenants)
CREATE TABLE IF NOT EXISTS cities (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(255) NOT NULL,
  state         VARCHAR(100),
  country       VARCHAR(100) DEFAULT 'India',
  timezone      VARCHAR(100) DEFAULT 'Asia/Kolkata',
  logo_url      VARCHAR(500),
  plan          VARCHAR(50) DEFAULT 'trial',  -- trial | saas | license
  status        VARCHAR(20) DEFAULT 'active', -- active | suspended | expired
  created_at    TIMESTAMP DEFAULT NOW(),
  updated_at    TIMESTAMP DEFAULT NOW()
);

-- License keys (for on-premise deployments)
CREATE TABLE IF NOT EXISTS license_keys (
  id            SERIAL PRIMARY KEY,
  city_id       INTEGER REFERENCES cities(id) ON DELETE CASCADE,
  license_key   VARCHAR(64) UNIQUE NOT NULL,
  plan          VARCHAR(50) NOT NULL,         -- basic | pro | enterprise
  max_junctions INTEGER DEFAULT 10,
  max_cameras   INTEGER DEFAULT 60,
  issued_at     TIMESTAMP DEFAULT NOW(),
  expires_at    TIMESTAMP,
  activated_at  TIMESTAMP,
  status        VARCHAR(20) DEFAULT 'issued', -- issued | active | expired | revoked
  notes         TEXT
);

-- Users
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  city_id       INTEGER REFERENCES cities(id) ON DELETE CASCADE,
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name          VARCHAR(255) NOT NULL,
  role          VARCHAR(30) NOT NULL,  -- superadmin | cityadmin | operator
  status        VARCHAR(20) DEFAULT 'active',
  last_login    TIMESTAMP,
  created_at    TIMESTAMP DEFAULT NOW()
);

-- Junctions (intersections)
CREATE TABLE IF NOT EXISTS junctions (
  id            SERIAL PRIMARY KEY,
  city_id       INTEGER NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  code          VARCHAR(50) NOT NULL,  -- e.g. BPL-001
  name          VARCHAR(255) NOT NULL,
  location      VARCHAR(500),
  latitude      DECIMAL(10,7),
  longitude     DECIMAL(10,7),
  arm_count     INTEGER DEFAULT 4,
  camera_mode   VARCHAR(20) DEFAULT 'simulation', -- simulation | rtsp
  ai_enabled    BOOLEAN DEFAULT TRUE,
  status        VARCHAR(20) DEFAULT 'active',
  created_at    TIMESTAMP DEFAULT NOW(),
  UNIQUE(city_id, code)
);

-- Cameras
CREATE TABLE IF NOT EXISTS cameras (
  id            SERIAL PRIMARY KEY,
  junction_id   INTEGER NOT NULL REFERENCES junctions(id) ON DELETE CASCADE,
  code          VARCHAR(50) NOT NULL,
  arm           VARCHAR(20) NOT NULL, -- North | South | East | West
  label         VARCHAR(255),
  rtsp_url      TEXT,
  resolution    VARCHAR(20) DEFAULT '1080p',
  fps           INTEGER DEFAULT 25,
  status        VARCHAR(20) DEFAULT 'online', -- online | offline | error
  last_seen     TIMESTAMP DEFAULT NOW(),
  created_at    TIMESTAMP DEFAULT NOW()
);

-- Signal logs (every AI decision)
CREATE TABLE IF NOT EXISTS signal_logs (
  id              SERIAL PRIMARY KEY,
  junction_id     INTEGER NOT NULL REFERENCES junctions(id) ON DELETE CASCADE,
  green_arm       VARCHAR(20),
  phase_duration  INTEGER,   -- seconds
  ai_decision     TEXT,
  ai_confidence   DECIMAL(5,4),
  processing_ms   INTEGER,
  vehicle_counts  JSONB,     -- {North:12, South:8, East:15, West:5}
  created_at      TIMESTAMP DEFAULT NOW()
);

-- Alert / violation logs
CREATE TABLE IF NOT EXISTS alert_logs (
  id                SERIAL PRIMARY KEY,
  junction_id       INTEGER NOT NULL REFERENCES junctions(id) ON DELETE CASCADE,
  camera_id         INTEGER REFERENCES cameras(id),
  type              VARCHAR(50) NOT NULL,
  label             VARCHAR(255),
  severity          VARCHAR(20),  -- high | medium | low
  arm               VARCHAR(20),
  plate_number      VARCHAR(30),
  image_url         VARCHAR(500),
  status            VARCHAR(20) DEFAULT 'new', -- new | acknowledged | escalated
  acknowledged_by   INTEGER REFERENCES users(id),
  acknowledged_at   TIMESTAMP,
  created_at        TIMESTAMP DEFAULT NOW()
);

-- Daily stats (pre-aggregated for fast analytics)
CREATE TABLE IF NOT EXISTS daily_stats (
  id                  SERIAL PRIMARY KEY,
  junction_id         INTEGER NOT NULL REFERENCES junctions(id) ON DELETE CASCADE,
  stat_date           DATE NOT NULL,
  total_vehicles      INTEGER DEFAULT 0,
  total_violations    INTEGER DEFAULT 0,
  signal_cycles       INTEGER DEFAULT 0,
  avg_wait_time       DECIMAL(6,2),
  peak_hour           INTEGER,
  peak_vehicle_count  INTEGER,
  UNIQUE(junction_id, stat_date)
);

-- Audit log
CREATE TABLE IF NOT EXISTS audit_logs (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER REFERENCES users(id),
  city_id     INTEGER REFERENCES cities(id),
  action      VARCHAR(255) NOT NULL,
  entity      VARCHAR(100),
  entity_id   INTEGER,
  meta        JSONB,
  ip_address  VARCHAR(45),
  created_at  TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_junctions_city ON junctions(city_id);
CREATE INDEX IF NOT EXISTS idx_cameras_junction ON cameras(junction_id);
CREATE INDEX IF NOT EXISTS idx_signal_logs_junction_date ON signal_logs(junction_id, created_at);
CREATE INDEX IF NOT EXISTS idx_alert_logs_junction_date ON alert_logs(junction_id, created_at);
CREATE INDEX IF NOT EXISTS idx_alert_logs_status ON alert_logs(status);
CREATE INDEX IF NOT EXISTS idx_daily_stats_junction_date ON daily_stats(junction_id, stat_date);
CREATE INDEX IF NOT EXISTS idx_users_city ON users(city_id);
CREATE INDEX IF NOT EXISTS idx_license_keys_key ON license_keys(license_key);
