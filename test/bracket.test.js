const test = require('node:test');
const assert = require('node:assert/strict');
const { nextPowerOfTwo, seedOrder, buildBracket } = require('../src/bracket');

test('nextPowerOfTwo', () => {
  assert.deepEqual([2, 3, 4, 5, 8, 9, 16].map(nextPowerOfTwo), [2, 4, 4, 8, 8, 16, 16]);
});

test('seedOrder follows standard tournament seeding', () => {
  assert.deepEqual(seedOrder(2), [1, 2]);
  assert.deepEqual(seedOrder(4), [1, 4, 2, 3]);
  assert.deepEqual(seedOrder(8), [1, 8, 4, 5, 2, 7, 3, 6]);
});

test('bracket for 2 players is a single ready final', () => {
  const { matches, totalRounds } = buildBracket([10, 20]);
  assert.equal(totalRounds, 1);
  assert.equal(matches.length, 1);
  assert.deepEqual([matches[0].player1, matches[0].player2, matches[0].status], [10, 20, 'ready']);
});

test('bracket for 3 players gives seed 1 a bye', () => {
  const { matches, totalRounds } = buildBracket([1, 2, 3]);
  assert.equal(totalRounds, 2);
  const r1 = matches.filter((m) => m.round === 1);
  assert.equal(r1.length, 2);
  const bye = r1.find((m) => m.isBye);
  assert.equal(bye.winner, 1);
  assert.equal(bye.status, 'completed');
  const final = matches.find((m) => m.round === 2);
  assert.equal(final.player1, 1); // bye winner already advanced
  assert.equal(final.status, 'pending'); // waiting for 2 vs 3
});

test('brackets of every size from 2 to 40 are well formed', () => {
  for (let n = 2; n <= 40; n++) {
    const ids = Array.from({ length: n }, (_, i) => i + 1);
    const { matches, totalRounds } = buildBracket(ids);
    const size = nextPowerOfTwo(n);

    assert.equal(matches.length, size - 1, `n=${n}: match count`);
    assert.equal(matches.filter((m) => m.isBye).length, size - n, `n=${n}: bye count`);

    // every player appears exactly once in round 1
    const seen = matches.filter((m) => m.round === 1).flatMap((m) => [m.player1, m.player2]).filter(Boolean);
    assert.deepEqual([...seen].sort((a, b) => a - b), ids, `n=${n}: round 1 players`);

    // no match has two byes, and the final is the only match in the last round
    assert.ok(matches.filter((m) => m.round === 1).every((m) => m.player1 || m.player2), `n=${n}: double bye`);
    assert.equal(matches.filter((m) => m.round === totalRounds).length, 1);
  }
});

test('top two seeds are on opposite halves of the bracket', () => {
  const { matches } = buildBracket(Array.from({ length: 16 }, (_, i) => i + 1));
  const r1 = matches.filter((m) => m.round === 1);
  const half = r1.length / 2;
  const where = (seed) => r1.findIndex((m) => m.player1 === seed || m.player2 === seed) < half ? 'top' : 'bottom';
  assert.notEqual(where(1), where(2));
});
