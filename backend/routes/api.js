const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../db/pool');
const { requireAuth, requireSuperAdmin, requireCityAdmin, requireOperator, JWT_SECRET } = require('../middleware/auth');
const { createLicenseKey, validateLicenseKey, activateLicenseKey, getLicenseKeys } = require('../services/licenseService');
const { generatePDF, generateCSV } = require('../reports/generator');

const router = express.Router();
let engine; // set by server.js

function setEngine(e) { engine = e; }

// ── AUTH ──────────────────────────────────────────────────────────────────────
router.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  try {
    const result = await pool.query(
      'SELECT u.*, c.name as city_name, c.status as city_status FROM users u JOIN cities c ON c.id = u.city_id WHERE u.email = $1',
      [email.toLowerCase()]
    );
    if (!result.rows.length) return res.status(401).json({ error: 'Invalid email or password' });
    const user = result.rows[0];
    if (user.status !== 'active') return res.status(401).json({ error: 'Account is suspended' });
    if (!await bcrypt.compare(password, user.password_hash)) return res.status(401).json({ error: 'Invalid email or password' });

    await pool.query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);

    const token = jwt.sign(
      { userId: user.id, cityId: user.city_id, role: user.role, email: user.email, name: user.name },
      JWT_SECRET, { expiresIn: '12h' }
    );
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role, cityId: user.city_id, cityName: user.city_name } });
  } catch (err) { res.status(500).json({ error: 'Login failed' }); }
});

router.get('/auth/me', requireAuth, async (req, res) => {
  const result = await pool.query('SELECT u.id,u.name,u.email,u.role,u.city_id,c.name as city_name FROM users u JOIN cities c ON c.id=u.city_id WHERE u.id=$1', [req.user.userId]);
  res.json(result.rows[0] || {});
});

// ── SYSTEM STATUS ─────────────────────────────────────────────────────────────
router.get('/status', (req, res) => res.json({ status: 'operational', version: '1.0.0', timestamp: new Date().toISOString() }));

router.get('/snapshot', ...requireOperator(), (req, res) => {
  if (!engine) return res.status(503).json({ error: 'Engine not ready' });
  res.json(engine.snapshot());
});

// ── CITIES ────────────────────────────────────────────────────────────────────
router.get('/cities', ...requireSuperAdmin(), async (req, res) => {
  const result = await pool.query('SELECT c.*, (SELECT COUNT(*) FROM junctions WHERE city_id=c.id) as junction_count, (SELECT COUNT(*) FROM users WHERE city_id=c.id) as user_count FROM cities c ORDER BY c.name');
  res.json(result.rows);
});

router.post('/cities', ...requireSuperAdmin(), async (req, res) => {
  const { name, state, country, plan } = req.body;
  if (!name) return res.status(400).json({ error: 'City name required' });
  const result = await pool.query(
    'INSERT INTO cities (name, state, country, plan) VALUES ($1,$2,$3,$4) RETURNING *',
    [name, state || '', country || 'India', plan || 'trial']
  );
  res.status(201).json(result.rows[0]);
});

router.put('/cities/:id', ...requireSuperAdmin(), async (req, res) => {
  const { name, state, country, plan, status } = req.body;
  const result = await pool.query(
    'UPDATE cities SET name=COALESCE($1,name), state=COALESCE($2,state), plan=COALESCE($3,plan), status=COALESCE($4,status), updated_at=NOW() WHERE id=$5 RETURNING *',
    [name, state, plan, status, req.params.id]
  );
  res.json(result.rows[0]);
});

// ── USERS ─────────────────────────────────────────────────────────────────────
router.get('/users', ...requireCityAdmin(), async (req, res) => {
  const cityId = req.user.role === 'superadmin' ? (req.query.cityId || null) : req.user.cityId;
  const q = cityId
    ? 'SELECT id,name,email,role,status,last_login,created_at FROM users WHERE city_id=$1 ORDER BY created_at DESC'
    : 'SELECT u.id,u.name,u.email,u.role,u.status,u.last_login,u.created_at,c.name as city_name FROM users u JOIN cities c ON c.id=u.city_id ORDER BY u.created_at DESC';
  const result = await pool.query(q, cityId ? [cityId] : []);
  res.json(result.rows);
});

router.post('/users', ...requireCityAdmin(), async (req, res) => {
  const { name, email, password, role, cityId } = req.body;
  const targetCityId = req.user.role === 'superadmin' ? cityId : req.user.cityId;
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email, and password required' });
  if (!['cityadmin','operator'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  const hash = await bcrypt.hash(password, 10);
  const result = await pool.query(
    'INSERT INTO users (city_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,$5) RETURNING id,name,email,role,status',
    [targetCityId, email.toLowerCase(), hash, name, role]
  );
  res.status(201).json(result.rows[0]);
});

router.put('/users/:id/status', ...requireCityAdmin(), async (req, res) => {
  const { status } = req.body;
  const result = await pool.query('UPDATE users SET status=$1 WHERE id=$2 RETURNING id,name,status', [status, req.params.id]);
  res.json(result.rows[0]);
});

// ── JUNCTIONS ─────────────────────────────────────────────────────────────────
router.get('/junctions', ...requireOperator(), async (req, res) => {
  const cityId = req.user.role === 'superadmin' ? (req.query.cityId || req.user.cityId) : req.user.cityId;
  const result = await pool.query(
    'SELECT j.*, (SELECT COUNT(*) FROM cameras WHERE junction_id=j.id) as camera_count FROM junctions j WHERE j.city_id=$1 ORDER BY j.code',
    [cityId]
  );
  res.json(result.rows);
});

router.post('/junctions', ...requireCityAdmin(), async (req, res) => {
  const { code, name, location, latitude, longitude, cameraMode } = req.body;
  const cityId = req.user.role === 'superadmin' ? req.body.cityId : req.user.cityId;
  if (!code || !name) return res.status(400).json({ error: 'Code and name required' });
  const result = await pool.query(
    'INSERT INTO junctions (city_id,code,name,location,latitude,longitude,camera_mode) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
    [cityId, code, name, location, latitude, longitude, cameraMode || 'simulation']
  );
  if (engine) await engine.reloadJunctions();
  res.status(201).json(result.rows[0]);
});

router.put('/junctions/:id', ...requireCityAdmin(), async (req, res) => {
  const { name, location, cameraMode, aiEnabled, status } = req.body;
  const result = await pool.query(
    'UPDATE junctions SET name=COALESCE($1,name),location=COALESCE($2,location),camera_mode=COALESCE($3,camera_mode),ai_enabled=COALESCE($4,ai_enabled),status=COALESCE($5,status) WHERE id=$6 RETURNING *',
    [name, location, cameraMode, aiEnabled, status, req.params.id]
  );
  if (engine) await engine.reloadJunctions();
  res.json(result.rows[0]);
});

// ── CAMERAS ───────────────────────────────────────────────────────────────────
router.get('/cameras', ...requireOperator(), async (req, res) => {
  const { junctionId } = req.query;
  const q = junctionId
    ? 'SELECT * FROM cameras WHERE junction_id=$1 ORDER BY arm'
    : 'SELECT c.*,j.name as junction_name FROM cameras c JOIN junctions j ON j.id=c.junction_id ORDER BY j.code,c.arm';
  const result = await pool.query(q, junctionId ? [junctionId] : []);
  res.json(result.rows);
});

router.post('/cameras', ...requireCityAdmin(), async (req, res) => {
  const { junctionId, code, arm, label, rtspUrl, resolution, fps } = req.body;
  const result = await pool.query(
    'INSERT INTO cameras (junction_id,code,arm,label,rtsp_url,resolution,fps) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
    [junctionId, code, arm, label, rtspUrl, resolution || '1080p', fps || 25]
  );
  res.status(201).json(result.rows[0]);
});

router.put('/cameras/:id', ...requireCityAdmin(), async (req, res) => {
  const { rtspUrl, status, label, resolution, fps } = req.body;
  const result = await pool.query(
    'UPDATE cameras SET rtsp_url=COALESCE($1,rtsp_url),status=COALESCE($2,status),label=COALESCE($3,label),resolution=COALESCE($4,resolution),fps=COALESCE($5,fps) WHERE id=$6 RETURNING *',
    [rtspUrl, status, label, resolution, fps, req.params.id]
  );
  res.json(result.rows[0]);
});

// ── ALERTS ────────────────────────────────────────────────────────────────────
router.get('/alerts', ...requireOperator(), async (req, res) => {
  if (engine) return res.json(engine.snapshot().alerts);
  const cityId = req.user.role === 'superadmin' ? req.query.cityId : req.user.cityId;
  const result = await pool.query(
    `SELECT al.*,j.name as junction_name FROM alert_logs al JOIN junctions j ON j.id=al.junction_id WHERE j.city_id=$1 ORDER BY al.created_at DESC LIMIT 50`,
    [cityId]
  );
  res.json(result.rows);
});

router.get('/alerts/history', ...requireOperator(), async (req, res) => {
  const cityId = req.user.role === 'superadmin' ? req.query.cityId : req.user.cityId;
  const from = req.query.from || new Date(Date.now() - 7 * 86400000).toISOString();
  const to = req.query.to || new Date().toISOString();
  const result = await pool.query(
    `SELECT al.*,j.name as junction_name,j.code as junction_code FROM alert_logs al JOIN junctions j ON j.id=al.junction_id WHERE j.city_id=$1 AND al.created_at BETWEEN $2 AND $3 ORDER BY al.created_at DESC LIMIT 500`,
    [cityId, from, to]
  );
  res.json(result.rows);
});

router.post('/alerts/:id/acknowledge', ...requireOperator(), (req, res) => {
  if (!engine) return res.status(503).json({ error: 'Engine not ready' });
  const alert = engine.acknowledgeAlert(req.params.id, req.user.userId);
  if (!alert) return res.status(404).json({ error: 'Alert not found' });
  res.json({ success: true, alert });
});

// ── SIGNAL LOGS ───────────────────────────────────────────────────────────────
router.get('/signal-logs', ...requireOperator(), async (req, res) => {
  const cityId = req.user.role === 'superadmin' ? req.query.cityId : req.user.cityId;
  const from = req.query.from || new Date(Date.now() - 86400000).toISOString();
  const to = req.query.to || new Date().toISOString();
  const result = await pool.query(
    `SELECT sl.*,j.name as junction_name FROM signal_logs sl JOIN junctions j ON j.id=sl.junction_id WHERE j.city_id=$1 AND sl.created_at BETWEEN $2 AND $3 ORDER BY sl.created_at DESC LIMIT 200`,
    [cityId, from, to]
  );
  res.json(result.rows);
});

// ── ANALYTICS ─────────────────────────────────────────────────────────────────
router.get('/analytics/summary', ...requireOperator(), async (req, res) => {
  const cityId = req.user.role === 'superadmin' ? req.query.cityId : req.user.cityId;
  const from = req.query.from || new Date(Date.now() - 30 * 86400000).toISOString();
  const to = req.query.to || new Date().toISOString();

  const [violations, signals, junctions] = await Promise.all([
    pool.query(`SELECT type,severity,COUNT(*) as count FROM alert_logs al JOIN junctions j ON j.id=al.junction_id WHERE j.city_id=$1 AND al.created_at BETWEEN $2 AND $3 GROUP BY type,severity ORDER BY count DESC`, [cityId, from, to]),
    pool.query(`SELECT COUNT(*) as total,AVG(phase_duration)::numeric(6,1) as avg_phase FROM signal_logs sl JOIN junctions j ON j.id=sl.junction_id WHERE j.city_id=$1 AND sl.created_at BETWEEN $2 AND $3`, [cityId, from, to]),
    pool.query(`SELECT id,code,name FROM junctions WHERE city_id=$1 AND status='active'`, [cityId]),
  ]);

  res.json({ violations: violations.rows, signals: signals.rows[0], junctions: junctions.rows });
});

// ── REPORTS ───────────────────────────────────────────────────────────────────
router.get('/reports/pdf', ...requireCityAdmin(), async (req, res) => {
  const cityId = req.user.role === 'superadmin' ? req.query.cityId : req.user.cityId;
  const from = req.query.from || new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
  const to = req.query.to || new Date().toISOString().split('T')[0];
  const cityRes = await pool.query('SELECT name FROM cities WHERE id=$1', [cityId]);
  const cityName = cityRes.rows[0]?.name || 'Unknown City';
  await generatePDF(res, { cityId, cityName, from, to, reportType: 'full' });
});

router.get('/reports/csv/:type', ...requireCityAdmin(), async (req, res) => {
  const cityId = req.user.role === 'superadmin' ? req.query.cityId : req.user.cityId;
  const from = req.query.from || new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
  const to = req.query.to || new Date().toISOString().split('T')[0];
  await generateCSV(res, { cityId, from, to, type: req.params.type });
});

// ── LICENSE KEYS ──────────────────────────────────────────────────────────────
router.get('/licenses', ...requireSuperAdmin(), async (req, res) => {
  const keys = await getLicenseKeys(req.query.cityId || null);
  res.json(keys);
});

router.post('/licenses', ...requireSuperAdmin(), async (req, res) => {
  const { cityId, plan, validityDays, notes } = req.body;
  if (!cityId || !plan) return res.status(400).json({ error: 'cityId and plan required' });
  const key = await createLicenseKey({ cityId, plan, validityDays: validityDays || 365, notes });
  res.status(201).json(key);
});

router.post('/licenses/validate', async (req, res) => {
  const { key } = req.body;
  if (!key) return res.status(400).json({ error: 'License key required' });
  const result = await validateLicenseKey(key);
  res.json(result);
});

router.post('/licenses/activate', async (req, res) => {
  const { key } = req.body;
  if (!key) return res.status(400).json({ error: 'License key required' });
  const result = await activateLicenseKey(key);
  if (!result.valid) return res.status(400).json(result);
  res.json(result);
});

router.put('/licenses/:id/revoke', ...requireSuperAdmin(), async (req, res) => {
  await pool.query("UPDATE license_keys SET status='revoked' WHERE id=$1", [req.params.id]);
  res.json({ success: true });
});

module.exports = { router, setEngine };
