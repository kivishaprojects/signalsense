const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'signalsense-dev-secret-change-in-production';

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
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: `Access denied. Required role: ${roles.join(' or ')}` });
    }
    next();
  }];
}

function requireSuperAdmin() { return requireRole('superadmin'); }
function requireCityAdmin()  { return requireRole('superadmin', 'cityadmin'); }
function requireOperator()   { return requireRole('superadmin', 'cityadmin', 'operator'); }

// City-scope guard — non-superadmin can only access their own city
function requireCityScope(req, res, next) {
  if (req.user.role === 'superadmin') return next();
  const cityId = parseInt(req.params.cityId || req.body.cityId || req.query.cityId);
  if (cityId && cityId !== req.user.cityId) {
    return res.status(403).json({ error: 'Access denied to this city' });
  }
  req.scopedCityId = req.user.cityId;
  next();
}

module.exports = { requireAuth, requireRole, requireSuperAdmin, requireCityAdmin, requireOperator, requireCityScope, JWT_SECRET };
