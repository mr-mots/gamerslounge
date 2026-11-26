const express = require('express');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const { parse, conflict, unauthorized } = require('../errors');
const { signToken, setAuthCookie, clearAuthCookie, publicUser, requireAuth } = require('../auth');

const registerSchema = z.object({
  username: z.string().trim().min(3).max(30).regex(/^[a-zA-Z0-9_]+$/, 'Letters, numbers and underscores only'),
  email: z.string().trim().toLowerCase().email().max(254),
  // bcrypt only uses the first 72 bytes, so cap there
  password: z.string().min(8).max(72),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(72),
});

// Compared against when the email is unknown, so response time doesn't reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

module.exports = function authRoutes(db) {
  const router = express.Router();

  router.post('/register', (req, res) => {
    const { username, email, password } = parse(registerSchema, req.body);
    const taken = db.prepare('SELECT username, email FROM users WHERE username = ? OR email = ?').get(username, email);
    if (taken) {
      throw conflict(taken.email.toLowerCase() === email ? 'Email already registered' : 'Username already taken');
    }
    const info = db
      .prepare('INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)')
      .run(username, email, bcrypt.hashSync(password, 10));
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
    const token = signToken(user);
    setAuthCookie(res, token);
    res.status(201).json({ user: publicUser(user), token });
  });

  router.post('/login', (req, res) => {
    const { email, password } = parse(loginSchema, req.body);
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    const ok = bcrypt.compareSync(password, user ? user.password_hash : DUMMY_HASH);
    if (!user || !ok) throw unauthorized('Invalid email or password');
    const token = signToken(user);
    setAuthCookie(res, token);
    res.json({ user: publicUser(user), token });
  });

  router.post('/logout', (req, res) => {
    clearAuthCookie(res);
    res.json({ ok: true });
  });

  router.get('/me', requireAuth, (req, res) => {
    res.json({ user: publicUser(req.user) });
  });

  return router;
};
