const express = require('express');
const { z } = require('zod');
const { parse } = require('../errors');
const { requireAuth, requireAdmin } = require('../auth');
const { createTournamentService } = require('../tournamentService');

const listSchema = z.object({ status: z.enum(['open', 'in_progress', 'completed']).optional() });
const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  gameId: z.number().int().positive().optional(),
  maxPlayers: z.number().int().min(2).max(64).default(16),
  startsAt: z.string().trim().max(40).optional(),
});
const resultSchema = z.object({ winnerId: z.number().int().positive() });

module.exports = function tournamentRoutes(db) {
  const router = express.Router();
  const svc = createTournamentService(db);

  router.get('/', (req, res) => {
    const { status } = parse(listSchema, req.query);
    res.json({ data: svc.list(status) });
  });

  router.get('/:id', (req, res) => res.json(svc.detail(req.params.id)));

  router.post('/', requireAdmin, (req, res) => {
    res.status(201).json(svc.create(parse(createSchema, req.body)));
  });

  router.post('/:id/join', requireAuth, (req, res) => res.json(svc.join(req.params.id, req.user.id)));
  router.post('/:id/leave', requireAuth, (req, res) => res.json(svc.leave(req.params.id, req.user.id)));

  router.post('/:id/start', requireAdmin, (req, res) => res.json(svc.start(req.params.id)));

  router.post('/:id/matches/:matchId/result', requireAdmin, (req, res) => {
    const { winnerId } = parse(resultSchema, req.body);
    res.json(svc.reportResult(req.params.id, Number(req.params.matchId), winnerId));
  });

  return router;
};
