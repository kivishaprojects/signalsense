const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Railway provides DATABASE_URL — always prefer it over individual PG* vars
// Individual PG* vars from Railway's Postgres service can conflict if partially set
const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false
    })
  : new Pool({
      host: process.env.PGHOST,
      port: parseInt(process.env.PGPORT || '5432'),
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      database: process.env.PGDATABASE || 'signalsense',
    });

pool.on('error', (err) => console.error('DB pool error:', err));

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
  console.log('[DB] Schema migrated successfully');

  const bcrypt = require('bcryptjs');
  const existing = await pool.query("SELECT id FROM users WHERE role = 'superadmin' LIMIT 1");
  if (existing.rows.length === 0) {
    const cityRes = await pool.query(
      "INSERT INTO cities (name, state, plan, status) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING id",
      ['Demo City', 'Demo State', 'trial', 'active']
    );
    const cityId = cityRes.rows[0]?.id;

    if (cityId) {
      const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'Admin@1234', 10);
      await pool.query(
        "INSERT INTO users (city_id, email, password_hash, name, role) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (email) DO NOTHING",
        [cityId, process.env.ADMIN_EMAIL || 'admin@signalsense.ai', hash, 'Super Admin', 'superadmin']
      );

      const junctions = [
        { code: 'BPL-001', name: 'MG Road × DB Mall Road', location: 'MG Road, Bhopal', lat: 23.2340, lng: 77.4340 },
        { code: 'BPL-002', name: 'Arera Colony × Hoshangabad', location: 'Arera Colony, Bhopal', lat: 23.2180, lng: 77.4210 },
        { code: 'BPL-003', name: 'New Market × Sultania Road', location: 'New Market, Bhopal', lat: 23.2420, lng: 77.4080 },
      ];
      for (const j of junctions) {
        const jr = await pool.query(
          "INSERT INTO junctions (city_id, code, name, location, latitude, longitude) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (city_id, code) DO NOTHING RETURNING id",
          [cityId, j.code, j.name, j.location, j.lat, j.lng]
        );
        if (jr.rows[0]) {
          const jId = jr.rows[0].id;
          for (const arm of ['North','South','East','West']) {
            await pool.query(
              "INSERT INTO cameras (junction_id, code, arm, label) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING",
              [jId, `${j.code}-CAM-${arm[0]}`, arm, `Camera ${arm} — ${j.name}`]
            );
          }
        }
      }
      console.log('[DB] Seed data inserted');
      console.log(`[DB] Superadmin: ${process.env.ADMIN_EMAIL || 'admin@signalsense.ai'}`);
    }
  }
}

if (require.main === module) {
  migrate().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}

module.exports = { pool, migrate };
