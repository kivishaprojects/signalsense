-- ================================================================
-- SignalSense AI v2 — Complete Production Schema
-- Hierarchy: City → Zone → Area → Junction → Camera
-- ================================================================

-- Cities
CREATE TABLE IF NOT EXISTS cities (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(255) NOT NULL,
  state       VARCHAR(100),
  country     VARCHAR(100) DEFAULT 'India',
  timezone    VARCHAR(100) DEFAULT 'Asia/Kolkata',
  logo_url    VARCHAR(500),
  plan        VARCHAR(50)  DEFAULT 'trial',
  status      VARCHAR(20)  DEFAULT 'active',
  created_at  TIMESTAMP DEFAULT NOW(),
  updated_at  TIMESTAMP DEFAULT NOW()
);

-- Zones (within a city — e.g. North Zone, South Zone)
CREATE TABLE IF NOT EXISTS zones (
  id          SERIAL PRIMARY KEY,
  city_id     INTEGER NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  name        VARCHAR(255) NOT NULL,
  code        VARCHAR(50),
  description TEXT,
  status      VARCHAR(20) DEFAULT 'active',
  created_at  TIMESTAMP DEFAULT NOW()
);

-- Areas (within a zone — e.g. Ward 1, Arera Colony)
CREATE TABLE IF NOT EXISTS areas (
  id          SERIAL PRIMARY KEY,
  zone_id     INTEGER NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
  city_id     INTEGER NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  name        VARCHAR(255) NOT NULL,
  code        VARCHAR(50),
  description TEXT,
  status      VARCHAR(20) DEFAULT 'active',
  created_at  TIMESTAMP DEFAULT NOW()
);

-- Junctions (traffic signal points)
CREATE TABLE IF NOT EXISTS junctions (
  id                SERIAL PRIMARY KEY,
  area_id           INTEGER NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
  zone_id           INTEGER NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
  city_id           INTEGER NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  code              VARCHAR(50) NOT NULL,
  name              VARCHAR(255) NOT NULL,
  location          VARCHAR(500),
  latitude          DECIMAL(10,7),
  longitude         DECIMAL(10,7),
  arm_count         INTEGER DEFAULT 4,
  camera_mode       VARCHAR(20) DEFAULT 'simulation',
  ai_enabled        BOOLEAN DEFAULT TRUE,
  -- AI Signal timing config
  min_phase_seconds INTEGER DEFAULT 15,
  max_phase_seconds INTEGER DEFAULT 120,
  empty_road_threshold INTEGER DEFAULT 3,  -- vehicles below this = empty road
  peak_hour_max_phase  INTEGER DEFAULT 150,
  -- Status
  status            VARCHAR(20) DEFAULT 'active',
  created_at        TIMESTAMP DEFAULT NOW(),
  updated_at        TIMESTAMP DEFAULT NOW(),
  UNIQUE(city_id, code)
);

-- Signal timing profiles (peak/off-peak/night)
CREATE TABLE IF NOT EXISTS signal_profiles (
  id            SERIAL PRIMARY KEY,
  junction_id   INTEGER NOT NULL REFERENCES junctions(id) ON DELETE CASCADE,
  profile_name  VARCHAR(50) NOT NULL,  -- peak | offpeak | night | custom
  start_hour    INTEGER NOT NULL,      -- 0-23
  end_hour      INTEGER NOT NULL,      -- 0-23
  min_phase     INTEGER DEFAULT 15,
  max_phase     INTEGER DEFAULT 120,
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMP DEFAULT NOW()
);

-- Cameras
CREATE TABLE IF NOT EXISTS cameras (
  id            SERIAL PRIMARY KEY,
  junction_id   INTEGER NOT NULL REFERENCES junctions(id) ON DELETE CASCADE,
  code          VARCHAR(50) NOT NULL,
  arm           VARCHAR(20) NOT NULL,
  label         VARCHAR(255),
  rtsp_url      TEXT,
  resolution    VARCHAR(20) DEFAULT '1080p',
  fps           INTEGER DEFAULT 25,
  status        VARCHAR(20) DEFAULT 'online',
  last_seen     TIMESTAMP DEFAULT NOW(),
  created_at    TIMESTAMP DEFAULT NOW()
);

-- Users
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  city_id       INTEGER REFERENCES cities(id) ON DELETE CASCADE,
  zone_id       INTEGER REFERENCES zones(id),
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name          VARCHAR(255) NOT NULL,
  role          VARCHAR(30) NOT NULL,  -- superadmin | cityadmin | zoneadmin | operator
  status        VARCHAR(20) DEFAULT 'active',
  last_login    TIMESTAMP,
  created_at    TIMESTAMP DEFAULT NOW()
);

-- License keys
CREATE TABLE IF NOT EXISTS license_keys (
  id              SERIAL PRIMARY KEY,
  city_id         INTEGER REFERENCES cities(id) ON DELETE CASCADE,
  license_key     VARCHAR(64) UNIQUE NOT NULL,
  plan            VARCHAR(50) NOT NULL,
  max_junctions   INTEGER DEFAULT 10,
  max_cameras     INTEGER DEFAULT 60,
  issued_at       TIMESTAMP DEFAULT NOW(),
  expires_at      TIMESTAMP,
  activated_at    TIMESTAMP,
  status          VARCHAR(20) DEFAULT 'issued',
  notes           TEXT
);

-- Signal logs
CREATE TABLE IF NOT EXISTS signal_logs (
  id                SERIAL PRIMARY KEY,
  junction_id       INTEGER NOT NULL REFERENCES junctions(id) ON DELETE CASCADE,
  green_arm         VARCHAR(20),
  phase_duration    INTEGER,
  ai_decision       TEXT,
  ai_confidence     DECIMAL(5,4),
  processing_ms     INTEGER,
  vehicle_counts    JSONB,
  fixed_time_would_be INTEGER,  -- what fixed timer would have used
  time_saved        INTEGER,    -- seconds saved vs fixed timer
  empty_road        BOOLEAN DEFAULT FALSE,
  created_at        TIMESTAMP DEFAULT NOW()
);

-- Alert / violation logs
CREATE TABLE IF NOT EXISTS alert_logs (
  id                SERIAL PRIMARY KEY,
  junction_id       INTEGER NOT NULL REFERENCES junctions(id) ON DELETE CASCADE,
  camera_id         INTEGER REFERENCES cameras(id),
  type              VARCHAR(50) NOT NULL,
  label             VARCHAR(255),
  severity          VARCHAR(20),
  arm               VARCHAR(20),
  plate_number      VARCHAR(30),
  image_url         VARCHAR(500),
  status            VARCHAR(20) DEFAULT 'new',
  acknowledged_by   INTEGER REFERENCES users(id),
  acknowledged_at   TIMESTAMP,
  created_at        TIMESTAMP DEFAULT NOW()
);

-- Daily stats
CREATE TABLE IF NOT EXISTS daily_stats (
  id                  SERIAL PRIMARY KEY,
  junction_id         INTEGER NOT NULL REFERENCES junctions(id) ON DELETE CASCADE,
  stat_date           DATE NOT NULL,
  total_vehicles      INTEGER DEFAULT 0,
  total_violations    INTEGER DEFAULT 0,
  signal_cycles       INTEGER DEFAULT 0,
  avg_wait_time       DECIMAL(6,2),
  total_time_saved    INTEGER DEFAULT 0,
  empty_road_cycles   INTEGER DEFAULT 0,
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
CREATE INDEX IF NOT EXISTS idx_zones_city       ON zones(city_id);
CREATE INDEX IF NOT EXISTS idx_areas_zone       ON areas(zone_id);
CREATE INDEX IF NOT EXISTS idx_areas_city       ON areas(city_id);
CREATE INDEX IF NOT EXISTS idx_junctions_area   ON junctions(area_id);
CREATE INDEX IF NOT EXISTS idx_junctions_zone   ON junctions(zone_id);
CREATE INDEX IF NOT EXISTS idx_junctions_city   ON junctions(city_id);
CREATE INDEX IF NOT EXISTS idx_cameras_junction ON cameras(junction_id);
CREATE INDEX IF NOT EXISTS idx_signal_logs_junc ON signal_logs(junction_id, created_at);
CREATE INDEX IF NOT EXISTS idx_alert_logs_junc  ON alert_logs(junction_id, created_at);
CREATE INDEX IF NOT EXISTS idx_alert_logs_status ON alert_logs(status);
CREATE INDEX IF NOT EXISTS idx_daily_stats_junc ON daily_stats(junction_id, stat_date);
CREATE INDEX IF NOT EXISTS idx_users_city       ON users(city_id);
