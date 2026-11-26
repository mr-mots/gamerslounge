const express = require('express');
const { z } = require('zod');
const { parse, notFound } = require('../errors');
const { requireAdmin } = require('../auth');

const messageSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(254),
  message: z.string().trim().min(10, 'Message must be at least 10 characters').max(2000),
});

const toMessage = (r) => ({
  id: r.id,
  name: r.name,
  email: r.email,
  message: r.body,
  isRead: Boolean(r.is_read),
  createdAt: r.created_at,
});

module.exports = function contactRoutes(db, { limiter } = {}) {
  const router = express.Router();

  // Public: this is the Contact Us form.
  router.post('/', ...(limiter ? [limiter] : []), (req, res) => {
    const { name, email, message } = parse(messageSchema, req.body);
    db.prepare('INSERT INTO messages (name, email, body) VALUES (?, ?, ?)').run(name, email, message);
    res.status(201).json({ ok: true, message: 'Thanks! Your message has been sent to our admins.' });
  });

  // Admin inbox
  router.get('/messages', requireAdmin, (req, res) => {
    const unreadOnly = req.query.unread === 'true';
    const rows = db
      .prepare(`SELECT * FROM messages ${unreadOnly ? 'WHERE is_read = 0' : ''} ORDER BY id DESC LIMIT 200`)
      .all();
    res.json({ data: rows.map(toMessage) });
  });

  router.patch('/messages/:id/read', requireAdmin, (req, res) => {
    const info = /^\d+$/.test(req.params.id)
      ? db.prepare('UPDATE messages SET is_read = 1 WHERE id = ?').run(req.params.id)
      : { changes: 0 };
    if (!info.changes) throw notFound('Message not found');
    res.json(toMessage(db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id)));
  });

  return router;
};
