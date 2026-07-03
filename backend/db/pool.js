const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

pool.on('error', (err) => console.error('DB pool error:', err));

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
  console.log('[DB] Schema migrated successfully');

  const bcrypt = require('bcryptjs');
  const existing = await pool.query("SELECT id FROM users WHERE role='superadmin' LIMIT 1");
  if (existing.rows.length > 0) return;

  // Seed demo city
  const cityRes = await pool.query(
    "INSERT INTO cities (name,state,plan,status) VALUES ($1,$2,$3,$4) RETURNING id",
    ['Bhopal', 'Madhya Pradesh', 'trial', 'active']
  );
  const cityId = cityRes.rows[0].id;

  // Seed zones
  const zones = ['North Zone', 'South Zone', 'East Zone', 'West Zone'];
  const zoneIds = [];
  for (const z of zones) {
    const zr = await pool.query(
      "INSERT INTO zones (city_id,name,code) VALUES ($1,$2,$3) RETURNING id",
      [cityId, z, z.split(' ')[0].toUpperCase()]
    );
    zoneIds.push(zr.rows[0].id);
  }

  // Seed areas
  const areaData = [
    { zone: 0, name: 'Arera Colony', code: 'AC' },
    { zone: 0, name: 'MP Nagar', code: 'MPN' },
    { zone: 1, name: 'New Market', code: 'NM' },
    { zone: 1, name: 'Sultania', code: 'SUL' },
    { zone: 2, name: 'Kolar', code: 'KOL' },
    { zone: 3, name: 'Lalghati', code: 'LG' },
  ];
  const areaIds = [];
  for (const a of areaData) {
    const ar = await pool.query(
      "INSERT INTO areas (zone_id,city_id,name,code) VALUES ($1,$2,$3,$4) RETURNING id",
      [zoneIds[a.zone], cityId, a.name, a.code]
    );
    areaIds.push(ar.rows[0].id);
  }

  // Seed junctions
  const junctionData = [
    { area: 0, code: 'BPL-001', name: 'MG Road × DB Mall', lat: 23.2340, lng: 77.4340, min: 15, max: 120 },
    { area: 0, code: 'BPL-002', name: 'Arera Colony × Hoshangabad', lat: 23.2180, lng: 77.4210, min: 15, max: 90 },
    { area: 2, code: 'BPL-003', name: 'New Market × Sultania', lat: 23.2420, lng: 77.4080, min: 20, max: 120 },
    { area: 5, code: 'BPL-004', name: 'Lalghati Square', lat: 23.2290, lng: 77.3980, min: 15, max: 100 },
    { area: 1, code: 'BPL-005', name: 'MP Nagar Zone II', lat: 23.2510, lng: 77.4190, min: 15, max: 90 },
    { area: 2, code: 'BPL-006', name: 'Roshanpura Square', lat: 23.2380, lng: 77.4290, min: 20, max: 150 },
  ];

  for (const j of junctionData) {
    const jr = await pool.query(
      `INSERT INTO junctions (area_id,zone_id,city_id,code,name,location,latitude,longitude,min_phase_seconds,max_phase_seconds)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [areaIds[j.area], zoneIds[0], cityId, j.code, j.name, j.name, j.lat, j.lng, j.min, j.max]
    );
    const jId = jr.rows[0].id;

    // Seed cameras for each junction
    for (const arm of ['North', 'South', 'East', 'West']) {
      await pool.query(
        "INSERT INTO cameras (junction_id,code,arm,label) VALUES ($1,$2,$3,$4)",
        [jId, `${j.code}-CAM-${arm[0]}`, arm, `Camera ${arm} — ${j.name}`]
      );
    }

    // Seed signal profiles
    const profiles = [
      { name: 'peak', start: 8, end: 10, min: j.min, max: j.max },
      { name: 'peak', start: 17, end: 20, min: j.min, max: j.max },
      { name: 'offpeak', start: 10, end: 17, min: j.min, max: Math.round(j.max * 0.7) },
      { name: 'night', start: 22, end: 6, min: 10, max: Math.round(j.max * 0.4) },
    ];
    for (const p of profiles) {
      await pool.query(
        "INSERT INTO signal_profiles (junction_id,profile_name,start_hour,end_hour,min_phase,max_phase) VALUES ($1,$2,$3,$4,$5,$6)",
        [jId, p.name, p.start, p.end, p.min, p.max]
      );
    }
  }

  // Seed superadmin
  const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'Admin@1234', 10);
  await pool.query(
    "INSERT INTO users (city_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,$5)",
    [cityId, process.env.ADMIN_EMAIL || 'admin@signalsense.ai', hash, 'Super Admin', 'superadmin']
  );

  console.log('[DB] Seed data inserted');
  console.log(`[DB] Login: ${process.env.ADMIN_EMAIL || 'admin@signalsense.ai'} / ${process.env.ADMIN_PASSWORD || 'Admin@1234'}`);
}

if (require.main === module) {
  migrate().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}

module.exports = { pool, migrate };
