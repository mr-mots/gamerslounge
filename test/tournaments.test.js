const { startTestServer } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');

let t;
test.before(async () => { t = await startTestServer(); });
test.after(async () => { await t.close(); });

test('tournaments: seeded list and filtering', async () => {
  const list = await t.api('GET', '/api/tournaments');
  assert.equal(list.body.data.length, 3);
  assert.ok(list.body.data.every((x) => x.status === 'open' && x.playerCount === 0));
  assert.equal(list.body.data[0].game.title, 'Shadow Fight Arena');
  assert.equal((await t.api('GET', '/api/tournaments?status=completed')).body.data.length, 0);
  assert.equal((await t.api('GET', '/api/tournaments/99999')).status, 404);
});

test('tournaments: registration rules', async () => {
  const admin = await t.loginAdmin();
  const p1 = await t.register();
  const p2 = await t.register();
  const cup = await t.api('POST', '/api/tournaments', { token: admin, body: { name: 'Mini Cup', maxPlayers: 2 } });
  assert.equal(cup.status, 201);
  const id = cup.body.id;

  assert.equal((await t.api('POST', '/api/tournaments', { token: p1.token, body: { name: 'Nope' } })).status, 403);
  assert.equal((await t.api('POST', `/api/tournaments/${id}/join`)).status, 401);

  assert.equal((await t.api('POST', `/api/tournaments/${id}/join`, { token: p1.token })).status, 200);
  assert.equal((await t.api('POST', `/api/tournaments/${id}/join`, { token: p1.token })).status, 409);
  assert.equal((await t.api('POST', `/api/tournaments/${id}/start`, { token: admin })).status, 400); // only 1 player

  assert.equal((await t.api('POST', `/api/tournaments/${id}/leave`, { token: p1.token })).status, 200);
  assert.equal((await t.api('POST', `/api/tournaments/${id}/leave`, { token: p1.token })).status, 409);

  await t.api('POST', `/api/tournaments/${id}/join`, { token: p1.token });
  await t.api('POST', `/api/tournaments/${id}/join`, { token: p2.token });
  const p3 = await t.register();
  assert.equal((await t.api('POST', `/api/tournaments/${id}/join`, { token: p3.token })).status, 409); // full

  assert.equal((await t.api('POST', `/api/tournaments/${id}/start`, { token: p1.token })).status, 403);
  assert.equal((await t.api('POST', `/api/tournaments/${id}/start`, { token: admin })).status, 200);
  assert.equal((await t.api('POST', `/api/tournaments/${id}/start`, { token: admin })).status, 409); // already started
  assert.equal((await t.api('POST', `/api/tournaments/${id}/leave`, { token: p1.token })).status, 409);
});

for (const size of [2, 3, 5, 8]) {
  test(`tournaments: a full ${size}-player tournament plays through to a champion`, async () => {
    const admin = await t.loginAdmin();
    const players = [];
    for (let i = 0; i < size; i++) players.push(await t.register());

    const cup = await t.api('POST', '/api/tournaments', { token: admin, body: { name: `Cup ${size}`, maxPlayers: 16 } });
    const id = cup.body.id;
    for (const p of players) await t.api('POST', `/api/tournaments/${id}/join`, { token: p.token });

    let state = (await t.api('POST', `/api/tournaments/${id}/start`, { token: admin })).body;
    assert.equal(state.status, 'in_progress');
    assert.equal(state.matches.length, 2 ** Math.ceil(Math.log2(size)) - 1);
    assert.deepEqual(state.players.map((p) => p.seed).sort((a, b) => a - b), players.map((_, i) => i + 1));

    // Always play the first ready match; player1 wins. Track who got beaten.
    const eliminated = new Set();
    for (let guard = 0; guard < 100 && state.status === 'in_progress'; guard++) {
      const match = state.matches.find((m) => m.status === 'ready');
      assert.ok(match, 'there is always a ready match while the tournament is in progress');
      const res = await t.api('POST', `/api/tournaments/${id}/matches/${match.id}/result`, {
        token: admin,
        body: { winnerId: match.player1.id },
      });
      assert.equal(res.status, 200);
      eliminated.add(match.player2.id);
      state = res.body;
    }

    assert.equal(state.status, 'completed');
    assert.ok(state.winner, 'a winner is recorded');
    assert.ok(!eliminated.has(state.winner.id), 'champion was never eliminated');
    assert.equal(eliminated.size, size - 1, 'everyone but the champion lost exactly once');
    assert.ok(state.matches.every((m) => m.status === 'completed'));

    // The detail endpoint shows the same finished state, and a finished tournament is closed to changes.
    const again = await t.api('GET', `/api/tournaments/${id}`);
    assert.equal(again.body.winner.id, state.winner.id);
    const final = state.matches.at(-1);
    const late = await t.api('POST', `/api/tournaments/${id}/matches/${final.id}/result`, {
      token: admin,
      body: { winnerId: final.player1.id },
    });
    assert.equal(late.status, 409);
  });
}

test('tournaments: result validation', async () => {
  const admin = await t.loginAdmin();
  const players = [await t.register(), await t.register(), await t.register(), await t.register()];
  const outsider = await t.register();
  const cup = await t.api('POST', '/api/tournaments', { token: admin, body: { name: 'Validation Cup' } });
  const id = cup.body.id;
  for (const p of players) await t.api('POST', `/api/tournaments/${id}/join`, { token: p.token });

  const early = await t.api('POST', `/api/tournaments/${id}/matches/1/result`, { token: admin, body: { winnerId: players[0].user.id } });
  assert.equal(early.status, 409); // not started yet

  const state = (await t.api('POST', `/api/tournaments/${id}/start`, { token: admin })).body;
  const ready = state.matches.find((m) => m.status === 'ready');
  const waiting = state.matches.find((m) => m.status === 'pending');
  const url = (m) => `/api/tournaments/${id}/matches/${m.id}/result`;

  assert.equal((await t.api('POST', url(ready), { token: players[0].token, body: { winnerId: ready.player1.id } })).status, 403);
  assert.equal((await t.api('POST', url(ready), { token: admin, body: { winnerId: outsider.user.id } })).status, 400);
  assert.equal((await t.api('POST', url(ready), { token: admin, body: {} })).status, 400);
  assert.equal((await t.api('POST', url(waiting), { token: admin, body: { winnerId: ready.player1.id } })).status, 409);
  assert.equal((await t.api('POST', `/api/tournaments/${id}/matches/999999/result`, { token: admin, body: { winnerId: ready.player1.id } })).status, 404);

  assert.equal((await t.api('POST', url(ready), { token: admin, body: { winnerId: ready.player1.id } })).status, 200);
  assert.equal((await t.api('POST', url(ready), { token: admin, body: { winnerId: ready.player2.id } })).status, 409); // no re-reporting
});
