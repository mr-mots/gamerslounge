const express = require('express');
const { z } = require('zod');
const { parse, notFound } = require('../errors');
const { requireAdmin } = require('../auth');

const listSchema = z.object({
  tag: z.string().trim().max(50).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(12),
});

const createSchema = z.object({
  title: z.string().trim().min(1).max(160),
  tag: z.string().trim().min(1).max(50),
  author: z.string().trim().min(1).max(80),
  summary: z.string().trim().min(1).max(2000),
  image: z.string().trim().max(300).optional(),
});

const toArticle = (r) => ({
  id: r.id,
  title: r.title,
  tag: r.tag,
  author: r.author,
  summary: r.summary,
  image: r.image,
  publishedAt: r.published_at,
});

module.exports = function newsRoutes(db) {
  const router = express.Router();

  router.get('/', (req, res) => {
    const { tag, page, limit } = parse(listSchema, req.query);
    const where = tag ? 'WHERE tag = ? COLLATE NOCASE' : '';
    const params = tag ? [tag] : [];
    const total = db.prepare(`SELECT COUNT(*) AS n FROM news ${where}`).get(...params).n;
    const rows = db
      .prepare(`SELECT * FROM news ${where} ORDER BY published_at DESC, id DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, (page - 1) * limit);
    res.json({ data: rows.map(toArticle), page, limit, total });
  });

  router.get('/:id', (req, res) => {
    const row = /^\d+$/.test(req.params.id) && db.prepare('SELECT * FROM news WHERE id = ?').get(req.params.id);
    if (!row) throw notFound('Article not found');
    res.json(toArticle(row));
  });

  router.post('/', requireAdmin, (req, res) => {
    const a = parse(createSchema, req.body);
    const info = db
      .prepare('INSERT INTO news (title, tag, author, summary, image) VALUES (?, ?, ?, ?, ?)')
      .run(a.title, a.tag, a.author, a.summary, a.image ?? null);
    res.status(201).json(toArticle(db.prepare('SELECT * FROM news WHERE id = ?').get(info.lastInsertRowid)));
  });

  router.delete('/:id', requireAdmin, (req, res) => {
    const info = /^\d+$/.test(req.params.id) ? db.prepare('DELETE FROM news WHERE id = ?').run(req.params.id) : { changes: 0 };
    if (!info.changes) throw notFound('Article not found');
    res.status(204).end();
  });

  return router;
};
