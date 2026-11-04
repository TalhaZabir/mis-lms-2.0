const jwt = require('jsonwebtoken');
const SECRET = process.env.JWT_SECRET || 'mis-du-dev-secret-change-me';
if (process.env.NODE_ENV === 'production' && SECRET === 'mis-du-dev-secret-change-me') {
  throw new Error('JWT_SECRET must be set in production');
}

function sign(user) {
  return jwt.sign({ id: user.id, role: user.role, email: user.email }, SECRET, { expiresIn: process.env.JWT_EXPIRES || '7d' });
}
function auth(required = true) {
  return (req, res, next) => {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token) {
      if (required) return res.status(401).json({ error: 'No token' });
      req.user = null; return next();
    }
    try { req.user = jwt.verify(token, SECRET); next(); }
    catch { return res.status(401).json({ error: 'Invalid token' }); }
  };
}
function requireRoles(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden: need ' + roles.join(',') });
    next();
  };
}
module.exports = { sign, auth, requireRoles, SECRET };
