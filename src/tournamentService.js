const { buildBracket, shuffle } = require('./bracket');
const { badRequest, notFound, conflict } = require('./errors');

function createTournamentService(db) {
  const getRow = db.prepare('SELECT * FROM tournaments WHERE id = ?');

  function requireTournament(id) {
    const row = /^\d+$/.test(String(id)) && getRow.get(id);
    if (!row) throw notFound('Tournament not found');
    return row;
  }

  function summary(row) {
    const game = row.game_id ? db.prepare('SELECT id, title, slug FROM games WHERE id = ?').get(row.game_id) : null;
    const playerCount = db.prepare('SELECT COUNT(*) AS n FROM tournament_players WHERE tournament_id = ?').get(row.id).n;
    const winner = row.winner_user_id
      ? db.prepare('SELECT id, username FROM users WHERE id = ?').get(row.winner_user_id)
      : null;
    return {
      id: row.id,
      name: row.name,
      status: row.status,
      maxPlayers: row.max_players,
      playerCount,
      startsAt: row.starts_at,
      game: game && { id: game.id, title: game.title, slug: game.slug },
      winner,
    };
  }

  function list(status) {
    const rows = status
      ? db.prepare('SELECT * FROM tournaments WHERE status = ? ORDER BY starts_at, id').all(status)
      : db.prepare('SELECT * FROM tournaments ORDER BY starts_at, id').all();
    return rows.map(summary);
  }

  function detail(id) {
    const row = requireTournament(id);
    const players = db
      .prepare(
        `SELECT u.id, u.username, tp.seed FROM tournament_players tp JOIN users u ON u.id = tp.user_id
          WHERE tp.tournament_id = ? ORDER BY tp.seed IS NULL, tp.seed, tp.joined_at`
      )
      .all(row.id);
    const matches = db
      .prepare(
        `SELECT m.*, u1.username AS p1_name, u2.username AS p2_name
           FROM matches m
           LEFT JOIN users u1 ON u1.id = m.player1_id
           LEFT JOIN users u2 ON u2.id = m.player2_id
          WHERE m.tournament_id = ? ORDER BY m.round, m.position`
      )
      .all(row.id);
    const totalRounds = matches.reduce((max, m) => Math.max(max, m.round), 0);
    return {
      ...summary(row),
      players: players.map((p) => ({ id: p.id, username: p.username, seed: p.seed })),
      totalRounds,
      matches: matches.map((m) => ({
        id: m.id,
        round: m.round,
        position: m.position,
        status: m.status,
        isBye: Boolean(m.is_bye),
        player1: m.player1_id && { id: m.player1_id, username: m.p1_name },
        player2: m.player2_id && { id: m.player2_id, username: m.p2_name },
        winnerId: m.winner_id,
      })),
    };
  }

  function create({ name, gameId, maxPlayers, startsAt }) {
    if (gameId != null && !db.prepare('SELECT 1 FROM games WHERE id = ? AND active = 1').get(gameId)) {
      throw badRequest('Unknown gameId');
    }
    const info = db
      .prepare('INSERT INTO tournaments (name, game_id, max_players, starts_at) VALUES (?, ?, ?, ?)')
      .run(name, gameId ?? null, maxPlayers, startsAt ?? null);
    return detail(info.lastInsertRowid);
  }

  const join = db.transaction((tournamentId, userId) => {
    const t = requireTournament(tournamentId);
    if (t.status !== 'open') throw conflict('Registration is closed for this tournament');
    if (db.prepare('SELECT 1 FROM tournament_players WHERE tournament_id = ? AND user_id = ?').get(t.id, userId)) {
      throw conflict('You have already joined this tournament');
    }
    const count = db.prepare('SELECT COUNT(*) AS n FROM tournament_players WHERE tournament_id = ?').get(t.id).n;
    if (count >= t.max_players) throw conflict('This tournament is full');
    db.prepare('INSERT INTO tournament_players (tournament_id, user_id) VALUES (?, ?)').run(t.id, userId);
    return detail(t.id);
  });

  const leave = db.transaction((tournamentId, userId) => {
    const t = requireTournament(tournamentId);
    if (t.status !== 'open') throw conflict('You cannot leave once the tournament has started');
    const info = db.prepare('DELETE FROM tournament_players WHERE tournament_id = ? AND user_id = ?').run(t.id, userId);
    if (!info.changes) throw conflict('You are not registered in this tournament');
    return detail(t.id);
  });

  const start = db.transaction((tournamentId) => {
    const t = requireTournament(tournamentId);
    if (t.status !== 'open') throw conflict('Tournament has already started');
    const ids = db.prepare('SELECT user_id FROM tournament_players WHERE tournament_id = ?').all(t.id).map((r) => r.user_id);
    if (ids.length < 2) throw badRequest('At least 2 players are needed to start');

    const seeded = shuffle(ids); // index 0 = seed 1
    const setSeed = db.prepare('UPDATE tournament_players SET seed = ? WHERE tournament_id = ? AND user_id = ?');
    seeded.forEach((userId, i) => setSeed.run(i + 1, t.id, userId));

    const { matches } = buildBracket(seeded);
    const insert = db.prepare(
      `INSERT INTO matches (tournament_id, round, position, player1_id, player2_id, winner_id, is_bye, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const m of matches) {
      insert.run(t.id, m.round, m.position, m.player1, m.player2, m.winner, m.isBye ? 1 : 0, m.status);
    }
    db.prepare("UPDATE tournaments SET status = 'in_progress' WHERE id = ?").run(t.id);
    return detail(t.id);
  });

  const reportResult = db.transaction((tournamentId, matchId, winnerId) => {
    const t = requireTournament(tournamentId);
    if (t.status !== 'in_progress') throw conflict('Tournament is not in progress');

    const match = db.prepare('SELECT * FROM matches WHERE id = ? AND tournament_id = ?').get(matchId, t.id);
    if (!match) throw notFound('Match not found in this tournament');
    if (match.status === 'completed') throw conflict('A result was already reported for this match');
    if (match.status !== 'ready') throw conflict('This match is waiting for earlier rounds to finish');
    if (winnerId !== match.player1_id && winnerId !== match.player2_id) {
      throw badRequest('winnerId must be one of the two players in this match');
    }

    db.prepare("UPDATE matches SET winner_id = ?, status = 'completed' WHERE id = ?").run(winnerId, match.id);

    const totalRounds = db.prepare('SELECT MAX(round) AS r FROM matches WHERE tournament_id = ?').get(t.id).r;
    if (match.round === totalRounds) {
      db.prepare("UPDATE tournaments SET status = 'completed', winner_user_id = ? WHERE id = ?").run(winnerId, t.id);
    } else {
      const slot = match.position % 2 === 0 ? 'player1_id' : 'player2_id';
      const next = db
        .prepare('SELECT id FROM matches WHERE tournament_id = ? AND round = ? AND position = ?')
        .get(t.id, match.round + 1, Math.floor(match.position / 2));
      db.prepare(`UPDATE matches SET ${slot} = ? WHERE id = ?`).run(winnerId, next.id);
      db.prepare(
        "UPDATE matches SET status = 'ready' WHERE id = ? AND player1_id IS NOT NULL AND player2_id IS NOT NULL AND winner_id IS NULL"
      ).run(next.id);
    }
    return detail(t.id);
  });

  return { list, detail, create, join, leave, start, reportResult };
}

module.exports = { createTournamentService };
