const express = require('express');
const { z } = require('zod');
const { parse, badRequest, notFound, forbidden } = require('../errors');
const { requireAuth, requireAdmin } = require('../auth');

const createSchema = z.object({
  items: z
    .array(z.object({ gameId: z.number().int().positive(), quantity: z.number().int().min(1).max(10).default(1) }))
    .min(1)
    .max(50),
});
const statusSchema = z.object({ status: z.enum(['pending', 'paid', 'cancelled', 'refunded']) });
const listSchema = z.object({ all: z.enum(['true', 'false']).optional() });

module.exports = function ordersRoutes(db) {
  const router = express.Router();
  router.use(requireAuth);

  function loadOrder(id) {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
    if (!order) return null;
    const items = db
      .prepare(
        `SELECT oi.game_id, oi.price_cents, oi.quantity, g.title, g.slug
           FROM order_items oi JOIN games g ON g.id = oi.game_id
          WHERE oi.order_id = ? ORDER BY oi.id`
      )
      .all(id);
    return {
      id: order.id,
      userId: order.user_id,
      status: order.status,
      totalCents: order.total_cents,
      total: order.total_cents / 100,
      createdAt: order.created_at,
      items: items.map((i) => ({
        gameId: i.game_id,
        title: i.title,
        slug: i.slug,
        priceCents: i.price_cents,
        quantity: i.quantity,
      })),
    };
  }

  // Prices always come from the database; whatever the client sends is ignored.
  router.post('/', (req, res) => {
    const { items } = parse(createSchema, req.body);

    const wanted = new Map();
    for (const { gameId, quantity } of items) wanted.set(gameId, (wanted.get(gameId) || 0) + quantity);
    for (const qty of wanted.values()) {
      if (qty > 10) throw badRequest('You can order at most 10 copies of one game');
    }

    const ids = [...wanted.keys()];
    const games = db
      .prepare(`SELECT id, price_cents FROM games WHERE active = 1 AND id IN (${ids.map(() => '?').join(',')})`)
      .all(...ids);
    const found = new Map(games.map((g) => [g.id, g]));
    const missing = ids.filter((id) => !found.has(id));
    if (missing.length) throw badRequest('Some games are not available', { unavailableGameIds: missing });

    const create = db.transaction(() => {
      let total = 0;
      for (const [id, qty] of wanted) total += found.get(id).price_cents * qty;
      const info = db.prepare('INSERT INTO orders (user_id, total_cents) VALUES (?, ?)').run(req.user.id, total);
      const insertItem = db.prepare('INSERT INTO order_items (order_id, game_id, price_cents, quantity) VALUES (?, ?, ?, ?)');
      for (const [id, qty] of wanted) insertItem.run(info.lastInsertRowid, id, found.get(id).price_cents, qty);
      return info.lastInsertRowid;
    });

    res.status(201).json(loadOrder(create()));
  });

  router.get('/', (req, res) => {
    const { all } = parse(listSchema, req.query);
    const showAll = all === 'true';
    if (showAll && req.user.role !== 'admin') throw forbidden('Admin access required');
    const rows = showAll
      ? db.prepare('SELECT id FROM orders ORDER BY id DESC').all()
      : db.prepare('SELECT id FROM orders WHERE user_id = ? ORDER BY id DESC').all(req.user.id);
    res.json({ data: rows.map((r) => loadOrder(r.id)) });
  });

  router.get('/:id', (req, res) => {
    const order = /^\d+$/.test(req.params.id) && loadOrder(req.params.id);
    // 404 (not 403) for other people's orders so order ids can't be probed
    if (!order || (order.userId !== req.user.id && req.user.role !== 'admin')) throw notFound('Order not found');
    res.json(order);
  });

  router.patch('/:id/status', requireAdmin, (req, res) => {
    const { status } = parse(statusSchema, req.body);
    const info = /^\d+$/.test(req.params.id)
      ? db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, req.params.id)
      : { changes: 0 };
    if (!info.changes) throw notFound('Order not found');
    res.json(loadOrder(req.params.id));
  });

  return router;
};
