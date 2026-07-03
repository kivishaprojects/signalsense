const crypto = require('crypto');
const { pool } = require('../db/pool');

const PLAN_LIMITS = {
  basic:      { max_junctions: 10,  max_cameras: 60  },
  pro:        { max_junctions: 50,  max_cameras: 300 },
  enterprise: { max_junctions: 500, max_cameras: 3000 },
};

function generateKey() {
  // Format: SS-XXXX-XXXX-XXXX-XXXX (SignalSense prefix + 4 groups of 4 hex chars)
  const raw = crypto.randomBytes(8).toString('hex').toUpperCase();
  return `SS-${raw.slice(0,4)}-${raw.slice(4,8)}-${raw.slice(8,12)}-${raw.slice(12,16)}`;
}

async function createLicenseKey({ cityId, plan, validityDays = 365, notes = '' }) {
  const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.basic;
  const key = generateKey();
  const expiresAt = new Date(Date.now() + validityDays * 24 * 60 * 60 * 1000);

  const result = await pool.query(
    `INSERT INTO license_keys (city_id, license_key, plan, max_junctions, max_cameras, expires_at, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [cityId, key, plan, limits.max_junctions, limits.max_cameras, expiresAt, notes]
  );
  return result.rows[0];
}

async function validateLicenseKey(key) {
  const result = await pool.query(
    `SELECT lk.*, c.name as city_name, c.status as city_status
     FROM license_keys lk
     JOIN cities c ON c.id = lk.city_id
     WHERE lk.license_key = $1`,
    [key]
  );
  if (!result.rows.length) return { valid: false, error: 'License key not found' };

  const lic = result.rows[0];
  if (lic.status === 'revoked') return { valid: false, error: 'License key has been revoked' };
  if (lic.expires_at && new Date(lic.expires_at) < new Date()) return { valid: false, error: 'License key has expired' };
  if (lic.city_status !== 'active') return { valid: false, error: 'City account is not active' };

  return { valid: true, license: lic };
}

async function activateLicenseKey(key) {
  const validation = await validateLicenseKey(key);
  if (!validation.valid) return validation;

  await pool.query(
    "UPDATE license_keys SET status = 'active', activated_at = NOW() WHERE license_key = $1",
    [key]
  );
  await pool.query(
    "UPDATE cities SET plan = $1 WHERE id = $2",
    [validation.license.plan, validation.license.city_id]
  );

  return { valid: true, license: validation.license };
}

async function getLicenseKeys(cityId = null) {
  const query = cityId
    ? "SELECT lk.*, c.name as city_name FROM license_keys lk JOIN cities c ON c.id = lk.city_id WHERE lk.city_id = $1 ORDER BY lk.created_at DESC"
    : "SELECT lk.*, c.name as city_name FROM license_keys lk JOIN cities c ON c.id = lk.city_id ORDER BY lk.created_at DESC";
  const result = await pool.query(query, cityId ? [cityId] : []);
  return result.rows;
}

module.exports = { createLicenseKey, validateLicenseKey, activateLicenseKey, getLicenseKeys, PLAN_LIMITS };
