const jwt = require('jsonwebtoken');
const config = require('./config');
const { unauthorized, forbidden } = require('./errors');

const COOKIE_NAME = 'token';
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, config.jwtSecret, { expiresIn: '7d' });
}

function setAuthCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd,
    maxAge: SEVEN_DAYS_MS,
  });
}

function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: 'lax', secure: config.isProd });
}

function publicUser(row) {
  return { id: row.id, username: row.username, email: row.email, role: row.role, createdAt: row.created_at };
}

// Reads the JWT from the cookie or an `Authorization: Bearer` header and attaches req.user.
// The user is re-loaded from the database on every request, so deleted users or role changes
// take effect immediately instead of waiting for the token to expire.
function authenticate(db) {
  const findUser = db.prepare('SELECT id, username, email, role, created_at FROM users WHERE id = ?');
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = req.cookies?.[COOKIE_NAME] || (header.startsWith('Bearer ') ? header.slice(7) : null);
    if (!token) return next();
    try {
      const payload = jwt.verify(token, config.jwtSecret);
      const user = findUser.get(payload.sub);
      if (user) req.user = user;
    } catch {
      // invalid or expired token: treat the request as anonymous
    }
    next();
  };
}

function requireAuth(req, res, next) {
  if (!req.user) return next(unauthorized());
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return next(unauthorized());
  if (req.user.role !== 'admin') return next(forbidden('Admin access required'));
  next();
}

module.exports = { signToken, setAuthCookie, clearAuthCookie, publicUser, authenticate, requireAuth, requireAdmin };
