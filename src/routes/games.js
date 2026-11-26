const express = require('express');
const { z } = require('zod');
const { parse, notFound } = require('../errors');
const { requireAdmin } = require('../auth');
const { slugify } = require('../seed');

const listSchema = z.object({
  platform: z.enum(['pc', 'mobile']).optional(),
  genre: z.string().trim().max(50).optional(),
  q: z.string().trim().max(100).optional(),
  sort: z.enum(['title', 'price_asc', 'price_desc', 'newest']).default('title'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const SORTS = {
  title: 'title COLLATE NOCASE ASC',
  price_asc: 'price_cents ASC, title COLLATE NOCASE ASC',
  price_desc: 'price_cents DESC, title COLLATE NOCASE ASC',
  newest: 'id DESC',
};

const createSchema = z.object({
  title: z.string().trim().min(1).max(120),
  platform: z.enum(['pc', 'mobile']),
  genre: z.string().trim().max(50).optional(),
  priceCents: z.number().int().min(0).max(1_000_000),
  image: z.string().trim().max(300).optional(),
  description: z.string().trim().max(2000).optional(),
});
const updateSchema = createSchema.partial().refine((v) => Object.keys(v).length > 0, 'Nothing to update');

const toGame = (r) => ({
  id: r.id,
  slug: r.slug,
  title: r.title,
  platform: r.platform,
  genre: r.genre,
  priceCents: r.price_cents,
  price: r.price_cents / 100,
  image: r.image,
  description: r.description,
});

const escapeLike = (s) => s.replace(/[\\%_]/g, '\\$&');

module.exports = function gamesRoutes(db) {
  const router = express.Router();

  function findByIdOrSlug(key) {
    const sql = /^\d+$/.test(key)
      ? 'SELECT * FROM games WHERE id = ? AND active = 1'
      : 'SELECT * FROM games WHERE slug = ? AND active = 1';
    return db.prepare(sql).get(key);
  }

  function uniqueSlug(title) {
    const base = slugify(title) || 'game';
    let slug = base;
    for (let i = 2; db.prepare('SELECT 1 FROM games WHERE slug = ?').get(slug); i++) slug = `${base}-${i}`;
    return slug;
  }

  router.get('/', (req, res) => {
    const { platform, genre, q, sort, page, limit } = parse(listSchema, req.query);
    const where = ['active = 1'];
    const params = [];
    if (platform) { where.push('platform = ?'); params.push(platform); }
    if (genre) { where.push('genre = ? COLLATE NOCASE'); params.push(genre); }
    if (q) {
      where.push("(title LIKE ? ESCAPE '\\' OR genre LIKE ? ESCAPE '\\')");
      const like = `%${escapeLike(q)}%`;
      params.push(like, like);
    }
    const clause = where.join(' AND ');
    const total = db.prepare(`SELECT COUNT(*) AS n FROM games WHERE ${clause}`).get(...params).n;
    const rows = db
      .prepare(`SELECT * FROM games WHERE ${clause} ORDER BY ${SORTS[sort]} LIMIT ? OFFSET ?`)
      .all(...params, limit, (page - 1) * limit);
    res.json({ data: rows.map(toGame), page, limit, total });
  });

  router.get('/:key', (req, res) => {
    const row = findByIdOrSlug(req.params.key);
    if (!row) throw notFound('Game not found');
    res.json(toGame(row));
  });

  router.post('/', requireAdmin, (req, res) => {
    const g = parse(createSchema, req.body);
    const info = db
      .prepare('INSERT INTO games (slug, title, platform, genre, price_cents, image, description) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(uniqueSlug(g.title), g.title, g.platform, g.genre ?? null, g.priceCents, g.image ?? null, g.description ?? null);
    res.status(201).json(toGame(db.prepare('SELECT * FROM games WHERE id = ?').get(info.lastInsertRowid)));
  });

  router.patch('/:id', requireAdmin, (req, res) => {
    const existing = findByIdOrSlug(req.params.id);
    if (!existing) throw notFound('Game not found');
    const g = parse(updateSchema, req.body);
    const merged = {
      title: g.title ?? existing.title,
      platform: g.platform ?? existing.platform,
      genre: g.genre ?? existing.genre,
      price_cents: g.priceCents ?? existing.price_cents,
      image: g.image ?? existing.image,
      description: g.description ?? existing.description,
    };
    db.prepare(
      'UPDATE games SET title = ?, platform = ?, genre = ?, price_cents = ?, image = ?, description = ? WHERE id = ?'
    ).run(merged.title, merged.platform, merged.genre, merged.price_cents, merged.image, merged.description, existing.id);
    res.json(toGame(db.prepare('SELECT * FROM games WHERE id = ?').get(existing.id)));
  });

  // Soft delete: keeps old orders intact while hiding the game from the store.
  router.delete('/:id', requireAdmin, (req, res) => {
    const existing = findByIdOrSlug(req.params.id);
    if (!existing) throw notFound('Game not found');
    db.prepare('UPDATE games SET active = 0 WHERE id = ?').run(existing.id);
    res.status(204).end();
  });

  return router;
};
