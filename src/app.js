const fs = require('node:fs');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');

const config = require('./config');
const { authenticate } = require('./auth');
const { notFound, errorHandler } = require('./errors');

function limiter(windowMs, max, message) {
  return rateLimit({ windowMs, limit: max, standardHeaders: true, legacyHeaders: false, message: { error: message } });
}

function createApp(db, { rateLimit: useRateLimit = true } = {}) {
  const app = express();
  app.disable('x-powered-by');
  if (config.isProd) app.set('trust proxy', 1); // behind a host's proxy (Render, Railway, ...)

  // The CSP allows the CDNs the current HTML pages load (Boxicons, Ionicons, Google Fonts) and inline
  // scripts. Once the inline <script> blocks and onclick attributes move into .js files, remove
  // 'unsafe-inline' to lock it down.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'", 'https://unpkg.com'],
          scriptSrcAttr: ["'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://unpkg.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com', 'https://unpkg.com', 'data:'],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          // Safari would upgrade http://localhost assets to https and fail to load them in dev
          upgradeInsecureRequests: config.isProd ? [] : null,
        },
      },
    })
  );
  if (config.corsOrigin) {
    app.use('/api', cors({ origin: config.corsOrigin.split(',').map((s) => s.trim()), credentials: true }));
  }
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use(authenticate(db));

  const noop = (req, res, next) => next();
  const apiLimiter = useRateLimit ? limiter(15 * 60 * 1000, 300, 'Too many requests, slow down') : noop;
  const authLimiter = useRateLimit ? limiter(15 * 60 * 1000, 20, 'Too many attempts, try again later') : noop;
  const contactLimiter = useRateLimit ? limiter(60 * 60 * 1000, 5, 'Too many messages, try again later') : null;

  app.get('/api/health', (req, res) => res.json({ ok: true }));

  app.use('/api', apiLimiter);
  app.use('/api/auth/login', authLimiter);
  app.use('/api/auth/register', authLimiter);
  app.use('/api/auth', require('./routes/auth')(db));
  app.use('/api/games', require('./routes/games')(db));
  app.use('/api/news', require('./routes/news')(db));
  app.use('/api/orders', require('./routes/orders')(db));
  app.use('/api/contact', require('./routes/contact')(db, { limiter: contactLimiter }));
  app.use('/api/tournaments', require('./routes/tournaments')(db));
  app.use('/api', (req, res, next) => next(notFound('No such endpoint')));

  // Serve the front end (your HTML/CSS/JS/images) from ./public if that folder exists.
  if (fs.existsSync(config.publicDir)) app.use(express.static(config.publicDir));

  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
