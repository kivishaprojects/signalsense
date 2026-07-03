const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'signalsense-dev-secret';

function requireAuth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireRole(...roles) {
  return [requireAuth, (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Access denied' });
    next();
  }];
}

const requireSuperAdmin = () => requireRole('superadmin');
const requireCityAdmin  = () => requireRole('superadmin', 'cityadmin');
const requireZoneAdmin  = () => requireRole('superadmin', 'cityadmin', 'zoneadmin');
const requireOperator   = () => requireRole('superadmin', 'cityadmin', 'zoneadmin', 'operator');

module.exports = { requireAuth, requireRole, requireSuperAdmin, requireCityAdmin, requireZoneAdmin, requireOperator, JWT_SECRET };
