const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../db/pool');
const { requireAuth, requireSuperAdmin, requireCityAdmin, requireZoneAdmin, requireOperator, JWT_SECRET } = require('../middleware/auth');
const { createLicenseKey, validateLicenseKey, activateLicenseKey } = require('../services/licenseService');

const router = express.Router();
let engine;
function setEngine(e) { engine = e; }

// ── AUTH ──────────────────────────────────────────────────────────────────
router.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  try {
    const r = await pool.query(
      'SELECT u.*,c.name as city_name FROM users u JOIN cities c ON c.id=u.city_id WHERE u.email=$1',
      [email.toLowerCase()]
    );
    if (!r.rows.length) return res.status(401).json({ error: 'Invalid email or password' });
    const user = r.rows[0];
    if (user.status !== 'active') return res.status(401).json({ error: 'Account suspended' });
    if (!await bcrypt.compare(password, user.password_hash)) return res.status(401).json({ error: 'Invalid email or password' });
    await pool.query('UPDATE users SET last_login=NOW() WHERE id=$1', [user.id]);
    const token = jwt.sign(
      { userId: user.id, cityId: user.city_id, zoneId: user.zone_id, role: user.role, email: user.email, name: user.name },
      JWT_SECRET, { expiresIn: '12h' }
    );
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role, cityId: user.city_id, cityName: user.city_name } });
  } catch (err) { res.status(500).json({ error: 'Login failed' }); }
});

router.get('/auth/me', requireAuth, async (req, res) => {
  const r = await pool.query('SELECT u.id,u.name,u.email,u.role,u.city_id,c.name as city_name FROM users u JOIN cities c ON c.id=u.city_id WHERE u.id=$1', [req.user.userId]);
  res.json(r.rows[0] || {});
});

// ── STATUS ────────────────────────────────────────────────────────────────
router.get('/status', (req, res) => res.json({ status: 'operational', version: '2.0.0', timestamp: new Date().toISOString() }));
router.get('/snapshot', ...requireOperator(), (req, res) => {
  if (!engine) return res.status(503).json({ error: 'Engine not ready' });
  res.json(engine.snapshot());
});

// ── CITIES ────────────────────────────────────────────────────────────────
router.get('/cities', ...requireSuperAdmin(), async (req, res) => {
  const r = await pool.query(`SELECT c.*,(SELECT COUNT(*) FROM zones WHERE city_id=c.id) as zone_count,(SELECT COUNT(*) FROM junctions WHERE city_id=c.id) as junction_count FROM cities c ORDER BY c.name`);
  res.json(r.rows);
});
router.post('/cities', ...requireSuperAdmin(), async (req, res) => {
  const { name, state, country, plan } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const r = await pool.query('INSERT INTO cities (name,state,country,plan) VALUES ($1,$2,$3,$4) RETURNING *', [name, state, country || 'India', plan || 'trial']);
  res.status(201).json(r.rows[0]);
});
router.put('/cities/:id', ...requireSuperAdmin(), async (req, res) => {
  const { name, state, plan, status } = req.body;
  const r = await pool.query('UPDATE cities SET name=COALESCE($1,name),state=COALESCE($2,state),plan=COALESCE($3,plan),status=COALESCE($4,status),updated_at=NOW() WHERE id=$5 RETURNING *', [name, state, plan, status, req.params.id]);
  res.json(r.rows[0]);
});

// ── ZONES ─────────────────────────────────────────────────────────────────
router.get('/zones', ...requireOperator(), async (req, res) => {
  const cityId = req.user.role === 'superadmin' ? (req.query.cityId || req.user.cityId) : req.user.cityId;
  const r = await pool.query(`SELECT z.*,(SELECT COUNT(*) FROM areas WHERE zone_id=z.id) as area_count,(SELECT COUNT(*) FROM junctions WHERE zone_id=z.id) as junction_count FROM zones z WHERE z.city_id=$1 ORDER BY z.name`, [cityId]);
  res.json(r.rows);
});
router.post('/zones', ...requireCityAdmin(), async (req, res) => {
  const { name, code, description, cityId } = req.body;
  const cid = req.user.role === 'superadmin' ? cityId : req.user.cityId;
  const r = await pool.query('INSERT INTO zones (city_id,name,code,description) VALUES ($1,$2,$3,$4) RETURNING *', [cid, name, code, description]);
  res.status(201).json(r.rows[0]);
});
router.put('/zones/:id', ...requireCityAdmin(), async (req, res) => {
  const { name, code, description, status } = req.body;
  const r = await pool.query('UPDATE zones SET name=COALESCE($1,name),code=COALESCE($2,code),description=COALESCE($3,description),status=COALESCE($4,status) WHERE id=$5 RETURNING *', [name, code, description, status, req.params.id]);
  res.json(r.rows[0]);
});
router.delete('/zones/:id', ...requireCityAdmin(), async (req, res) => {
  await pool.query('DELETE FROM zones WHERE id=$1', [req.params.id]);
  res.json({ success: true });
});

// ── AREAS ─────────────────────────────────────────────────────────────────
router.get('/areas', ...requireOperator(), async (req, res) => {
  const cityId = req.user.role === 'superadmin' ? (req.query.cityId || req.user.cityId) : req.user.cityId;
  const zoneId = req.query.zoneId;
  const q = zoneId
    ? `SELECT a.*,z.name as zone_name,(SELECT COUNT(*) FROM junctions WHERE area_id=a.id) as junction_count FROM areas a JOIN zones z ON z.id=a.zone_id WHERE a.zone_id=$1 ORDER BY a.name`
    : `SELECT a.*,z.name as zone_name,(SELECT COUNT(*) FROM junctions WHERE area_id=a.id) as junction_count FROM areas a JOIN zones z ON z.id=a.zone_id WHERE a.city_id=$1 ORDER BY z.name,a.name`;
  const r = await pool.query(q, [zoneId || cityId]);
  res.json(r.rows);
});
router.post('/areas', ...requireCityAdmin(), async (req, res) => {
  const { name, code, description, zoneId, cityId } = req.body;
  const cid = req.user.role === 'superadmin' ? cityId : req.user.cityId;
  const r = await pool.query('INSERT INTO areas (zone_id,city_id,name,code,description) VALUES ($1,$2,$3,$4,$5) RETURNING *', [zoneId, cid, name, code, description]);
  res.status(201).json(r.rows[0]);
});
router.put('/areas/:id', ...requireCityAdmin(), async (req, res) => {
  const { name, code, description, status } = req.body;
  const r = await pool.query('UPDATE areas SET name=COALESCE($1,name),code=COALESCE($2,code),description=COALESCE($3,description),status=COALESCE($4,status) WHERE id=$5 RETURNING *', [name, code, description, status, req.params.id]);
  res.json(r.rows[0]);
});
router.delete('/areas/:id', ...requireCityAdmin(), async (req, res) => {
  await pool.query('DELETE FROM areas WHERE id=$1', [req.params.id]);
  res.json({ success: true });
});

// ── JUNCTIONS ─────────────────────────────────────────────────────────────
router.get('/junctions', ...requireOperator(), async (req, res) => {
  const cityId = req.user.role === 'superadmin' ? (req.query.cityId || req.user.cityId) : req.user.cityId;
  const { zoneId, areaId } = req.query;
  let q = `SELECT j.*,a.name as area_name,z.name as zone_name,(SELECT COUNT(*) FROM cameras WHERE junction_id=j.id) as camera_count FROM junctions j JOIN areas a ON a.id=j.area_id JOIN zones z ON z.id=j.zone_id WHERE j.city_id=$1`;
  const params = [cityId];
  if (zoneId) { params.push(zoneId); q += ` AND j.zone_id=$${params.length}`; }
  if (areaId) { params.push(areaId); q += ` AND j.area_id=$${params.length}`; }
  q += ' ORDER BY j.code';
  const r = await pool.query(q, params);
  res.json(r.rows);
});
router.post('/junctions', ...requireCityAdmin(), async (req, res) => {
  const { code, name, location, latitude, longitude, areaId, zoneId, cityId, cameraMode, minPhase, maxPhase, emptyRoadThreshold } = req.body;
  const cid = req.user.role === 'superadmin' ? cityId : req.user.cityId;
  if (!code || !name || !areaId) return res.status(400).json({ error: 'Code, name and area required' });
  const r = await pool.query(
    `INSERT INTO junctions (area_id,zone_id,city_id,code,name,location,latitude,longitude,camera_mode,min_phase_seconds,max_phase_seconds,empty_road_threshold)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [areaId, zoneId, cid, code, name, location, latitude, longitude, cameraMode || 'simulation', minPhase || 15, maxPhase || 120, emptyRoadThreshold || 3]
  );
  if (engine) await engine.reloadJunctions();
  res.status(201).json(r.rows[0]);
});
router.put('/junctions/:id', ...requireCityAdmin(), async (req, res) => {
  const { name, location, cameraMode, aiEnabled, status, minPhase, maxPhase, emptyRoadThreshold } = req.body;
  const r = await pool.query(
    `UPDATE junctions SET name=COALESCE($1,name),location=COALESCE($2,location),camera_mode=COALESCE($3,camera_mode),
     ai_enabled=COALESCE($4,ai_enabled),status=COALESCE($5,status),min_phase_seconds=COALESCE($6,min_phase_seconds),
     max_phase_seconds=COALESCE($7,max_phase_seconds),empty_road_threshold=COALESCE($8,empty_road_threshold),updated_at=NOW()
     WHERE id=$9 RETURNING *`,
    [name, location, cameraMode, aiEnabled, status, minPhase, maxPhase, emptyRoadThreshold, req.params.id]
  );
  if (engine) await engine.reloadJunctions();
  res.json(r.rows[0]);
});
router.delete('/junctions/:id', ...requireCityAdmin(), async (req, res) => {
  await pool.query('UPDATE junctions SET status=$1 WHERE id=$2', ['inactive', req.params.id]);
  if (engine) await engine.reloadJunctions();
  res.json({ success: true });
});

// ── SIGNAL PROFILES ───────────────────────────────────────────────────────
router.get('/signal-profiles/:junctionId', ...requireOperator(), async (req, res) => {
  const r = await pool.query('SELECT * FROM signal_profiles WHERE junction_id=$1 ORDER BY start_hour', [req.params.junctionId]);
  res.json(r.rows);
});
router.post('/signal-profiles', ...requireCityAdmin(), async (req, res) => {
  const { junctionId, profileName, startHour, endHour, minPhase, maxPhase } = req.body;
  const r = await pool.query(
    'INSERT INTO signal_profiles (junction_id,profile_name,start_hour,end_hour,min_phase,max_phase) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
    [junctionId, profileName, startHour, endHour, minPhase, maxPhase]
  );
  if (engine) await engine.reloadJunctions();
  res.status(201).json(r.rows[0]);
});
router.put('/signal-profiles/:id', ...requireCityAdmin(), async (req, res) => {
  const { profileName, startHour, endHour, minPhase, maxPhase, isActive } = req.body;
  const r = await pool.query(
    'UPDATE signal_profiles SET profile_name=COALESCE($1,profile_name),start_hour=COALESCE($2,start_hour),end_hour=COALESCE($3,end_hour),min_phase=COALESCE($4,min_phase),max_phase=COALESCE($5,max_phase),is_active=COALESCE($6,is_active) WHERE id=$7 RETURNING *',
    [profileName, startHour, endHour, minPhase, maxPhase, isActive, req.params.id]
  );
  if (engine) await engine.reloadJunctions();
  res.json(r.rows[0]);
});
router.delete('/signal-profiles/:id', ...requireCityAdmin(), async (req, res) => {
  await pool.query('DELETE FROM signal_profiles WHERE id=$1', [req.params.id]);
  res.json({ success: true });
});

// ── CAMERAS ───────────────────────────────────────────────────────────────
router.get('/cameras', ...requireOperator(), async (req, res) => {
  const { junctionId } = req.query;
  const q = junctionId
    ? 'SELECT * FROM cameras WHERE junction_id=$1 ORDER BY arm'
    : 'SELECT c.*,j.name as junction_name,j.code as junction_code FROM cameras c JOIN junctions j ON j.id=c.junction_id ORDER BY j.code,c.arm';
  const r = await pool.query(q, junctionId ? [junctionId] : []);
  res.json(r.rows);
});
router.post('/cameras', ...requireCityAdmin(), async (req, res) => {
  const { junctionId, code, arm, label, rtspUrl, resolution, fps } = req.body;
  const r = await pool.query(
    'INSERT INTO cameras (junction_id,code,arm,label,rtsp_url,resolution,fps) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
    [junctionId, code, arm, label, rtspUrl, resolution || '1080p', fps || 25]
  );
  res.status(201).json(r.rows[0]);
});
router.put('/cameras/:id', ...requireCityAdmin(), async (req, res) => {
  const { rtspUrl, status, label, resolution, fps } = req.body;
  const r = await pool.query(
    'UPDATE cameras SET rtsp_url=COALESCE($1,rtsp_url),status=COALESCE($2,status),label=COALESCE($3,label),resolution=COALESCE($4,resolution),fps=COALESCE($5,fps) WHERE id=$6 RETURNING *',
    [rtspUrl, status, label, resolution, fps, req.params.id]
  );
  res.json(r.rows[0]);
});
router.delete('/cameras/:id', ...requireCityAdmin(), async (req, res) => {
  await pool.query('DELETE FROM cameras WHERE id=$1', [req.params.id]);
  res.json({ success: true });
});

// ── USERS ─────────────────────────────────────────────────────────────────
router.get('/users', ...requireCityAdmin(), async (req, res) => {
  const cityId = req.user.role === 'superadmin' ? (req.query.cityId || null) : req.user.cityId;
  const q = cityId
    ? 'SELECT id,name,email,role,status,last_login,created_at FROM users WHERE city_id=$1 ORDER BY created_at DESC'
    : 'SELECT u.id,u.name,u.email,u.role,u.status,u.last_login,u.created_at,c.name as city_name FROM users u JOIN cities c ON c.id=u.city_id ORDER BY u.created_at DESC';
  const r = await pool.query(q, cityId ? [cityId] : []);
  res.json(r.rows);
});
router.post('/users', ...requireCityAdmin(), async (req, res) => {
  const { name, email, password, role, cityId, zoneId } = req.body;
  const cid = req.user.role === 'superadmin' ? cityId : req.user.cityId;
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password required' });
  const hash = await bcrypt.hash(password, 10);
  const r = await pool.query(
    'INSERT INTO users (city_id,zone_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id,name,email,role,status',
    [cid, zoneId || null, email.toLowerCase(), hash, name, role || 'operator']
  );
  res.status(201).json(r.rows[0]);
});
router.put('/users/:id', ...requireCityAdmin(), async (req, res) => {
  const { name, status, role } = req.body;
  const r = await pool.query('UPDATE users SET name=COALESCE($1,name),status=COALESCE($2,status),role=COALESCE($3,role) WHERE id=$4 RETURNING id,name,email,role,status', [name, status, role, req.params.id]);
  res.json(r.rows[0]);
});

// ── ALERTS ────────────────────────────────────────────────────────────────
router.get('/alerts', ...requireOperator(), (req, res) => {
  if (!engine) return res.json([]);
  const snap = engine.snapshot();
  let alerts = snap.alerts;
  if (req.query.zoneId) alerts = alerts.filter(a => String(a.zoneId) === req.query.zoneId);
  if (req.query.areaId) alerts = alerts.filter(a => String(a.areaId) === req.query.areaId);
  res.json(alerts);
});
router.post('/alerts/:id/acknowledge', ...requireOperator(), (req, res) => {
  if (!engine) return res.status(503).json({ error: 'Engine not ready' });
  const alert = engine.acknowledgeAlert(req.params.id, req.user.userId);
  if (!alert) return res.status(404).json({ error: 'Alert not found' });
  res.json({ success: true, alert });
});

// ── SIGNAL LOGS ───────────────────────────────────────────────────────────
router.get('/signal-logs', ...requireOperator(), async (req, res) => {
  const cityId = req.user.role === 'superadmin' ? req.query.cityId : req.user.cityId;
  const from = req.query.from || new Date(Date.now() - 86400000).toISOString();
  const to = req.query.to || new Date().toISOString();
  const r = await pool.query(
    `SELECT sl.*,j.name as junction_name,j.code as junction_code FROM signal_logs sl JOIN junctions j ON j.id=sl.junction_id WHERE j.city_id=$1 AND sl.created_at BETWEEN $2 AND $3 ORDER BY sl.created_at DESC LIMIT 200`,
    [cityId, from, to]
  );
  res.json(r.rows);
});

// ── ANALYTICS ─────────────────────────────────────────────────────────────
router.get('/analytics/summary', ...requireOperator(), async (req, res) => {
  const cityId = req.user.role === 'superadmin' ? req.query.cityId : req.user.cityId;
  const from = req.query.from || new Date(Date.now() - 7 * 86400000).toISOString();
  const to = req.query.to || new Date().toISOString();
  const [violations, signals, timeSaved, zones] = await Promise.all([
    pool.query(`SELECT type,severity,COUNT(*) as count FROM alert_logs al JOIN junctions j ON j.id=al.junction_id WHERE j.city_id=$1 AND al.created_at BETWEEN $2 AND $3 GROUP BY type,severity`, [cityId, from, to]),
    pool.query(`SELECT COUNT(*) as total,AVG(phase_duration)::numeric(6,1) as avg_phase,SUM(CASE WHEN empty_road THEN 1 ELSE 0 END) as empty_cycles FROM signal_logs sl JOIN junctions j ON j.id=sl.junction_id WHERE j.city_id=$1 AND sl.created_at BETWEEN $2 AND $3`, [cityId, from, to]),
    pool.query(`SELECT COALESCE(SUM(time_saved),0) as total_seconds FROM signal_logs sl JOIN junctions j ON j.id=sl.junction_id WHERE j.city_id=$1 AND sl.created_at BETWEEN $2 AND $3`, [cityId, from, to]),
    pool.query(`SELECT z.id,z.name,(SELECT COUNT(*) FROM junctions WHERE zone_id=z.id) as junctions,(SELECT COUNT(*) FROM alert_logs al JOIN junctions j ON j.id=al.junction_id WHERE j.zone_id=z.id AND al.created_at BETWEEN $2 AND $3) as violations FROM zones z WHERE z.city_id=$1`, [cityId, from, to]),
  ]);
  res.json({ violations: violations.rows, signals: signals.rows[0], timeSaved: timeSaved.rows[0], zones: zones.rows });
});

// ── REPORTS ───────────────────────────────────────────────────────────────
router.get('/reports/csv/:type', ...requireCityAdmin(), async (req, res) => {
  const { stringify } = require('csv-stringify');
  const cityId = req.user.role === 'superadmin' ? req.query.cityId : req.user.cityId;
  const from = req.query.from || new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
  const to = req.query.to || new Date().toISOString().split('T')[0];

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="SignalSense_${req.params.type}_${from}_${to}.csv"`);

  if (req.params.type === 'violations') {
    const r = await pool.query(
      `SELECT al.created_at,j.name as junction,j.code,z.name as zone,a.name as area,al.type,al.label,al.severity,al.arm,al.plate_number,al.status FROM alert_logs al JOIN junctions j ON j.id=al.junction_id JOIN areas a ON a.id=j.area_id JOIN zones z ON z.id=j.zone_id WHERE j.city_id=$1 AND al.created_at BETWEEN $2 AND $3 ORDER BY al.created_at DESC`,
      [cityId, from, to]
    );
    stringify(r.rows.map(row => ({
      'Date/Time': new Date(row.created_at).toLocaleString('en-IN'),
      'Zone': row.zone, 'Area': row.area, 'Junction': row.junction,
      'Code': row.code, 'Type': row.type, 'Severity': row.severity,
      'Arm': row.arm, 'Plate': row.plate_number || '', 'Status': row.status,
    })), { header: true }).pipe(res);
  }

  if (req.params.type === 'signals') {
    const r = await pool.query(
      `SELECT sl.created_at,j.name as junction,j.code,z.name as zone,sl.green_arm,sl.phase_duration,sl.fixed_time_would_be,sl.time_saved,sl.empty_road,sl.ai_confidence FROM signal_logs sl JOIN junctions j ON j.id=sl.junction_id JOIN zones z ON z.id=j.zone_id WHERE j.city_id=$1 AND sl.created_at BETWEEN $2 AND $3 ORDER BY sl.created_at DESC LIMIT 5000`,
      [cityId, from, to]
    );
    stringify(r.rows.map(row => ({
      'Date/Time': new Date(row.created_at).toLocaleString('en-IN'),
      'Zone': row.zone, 'Junction': row.junction, 'Code': row.code,
      'Green Arm': row.green_arm, 'AI Phase (s)': row.phase_duration,
      'Fixed Timer Would Be (s)': row.fixed_time_would_be, 'Time Saved (s)': row.time_saved,
      'Empty Road': row.empty_road ? 'Yes' : 'No', 'AI Confidence': row.ai_confidence,
    })), { header: true }).pipe(res);
  }
});

// ── LICENSES ──────────────────────────────────────────────────────────────
router.get('/licenses', ...requireSuperAdmin(), async (req, res) => {
  const r = await pool.query('SELECT lk.*,c.name as city_name FROM license_keys lk JOIN cities c ON c.id=lk.city_id ORDER BY lk.created_at DESC');
  res.json(r.rows);
});
router.post('/licenses', ...requireSuperAdmin(), async (req, res) => {
  const { cityId, plan, validityDays, notes } = req.body;
  if (!cityId || !plan) return res.status(400).json({ error: 'cityId and plan required' });
  const key = await createLicenseKey({ cityId, plan, validityDays: validityDays || 365, notes });
  res.status(201).json(key);
});
router.post('/licenses/validate', async (req, res) => {
  const result = await validateLicenseKey(req.body.key);
  res.json(result);
});
router.post('/licenses/activate', async (req, res) => {
  const result = await activateLicenseKey(req.body.key);
  if (!result.valid) return res.status(400).json(result);
  res.json(result);
});
router.put('/licenses/:id/revoke', ...requireSuperAdmin(), async (req, res) => {
  await pool.query("UPDATE license_keys SET status='revoked' WHERE id=$1", [req.params.id]);
  res.json({ success: true });
});

module.exports = { router, setEngine };
