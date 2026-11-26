const crypto = require('node:crypto');
const path = require('node:path');

const isProd = process.env.NODE_ENV === 'production';

let jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  if (isProd) throw new Error('JWT_SECRET must be set when NODE_ENV=production');
  jwtSecret = crypto.randomBytes(32).toString('hex');
  console.warn('[config] JWT_SECRET not set: using a random one (logins reset on every restart)');
}

module.exports = {
  isProd,
  port: Number(process.env.PORT) || 3000,
  jwtSecret,
  dbPath: process.env.DB_PATH || path.join(__dirname, '..', 'data', 'gamerslounge.db'),
  // Comma-separated list of allowed browser origins, e.g. "http://localhost:5500"
  corsOrigin: process.env.CORS_ORIGIN || null,
  // Folder with the static front end (your HTML/CSS/images). Served if it exists.
  publicDir: process.env.PUBLIC_DIR || path.join(__dirname, '..', 'public'),
};
