const crypto = require('node:crypto');

// Pure functions for single-elimination brackets. No database access here, so they are easy to test.

function nextPowerOfTwo(n) {
  let size = 1;
  while (size < n) size *= 2;
  return size;
}

// Standard tournament seeding: seed 1 meets the lowest seed, and seeds 1 and 2 can only
// meet in the final. For size 8 this returns [1, 8, 4, 5, 2, 7, 3, 6].
function seedOrder(size) {
  let order = [1];
  while (order.length < size) {
    const len = order.length * 2;
    order = order.flatMap((seed) => [seed, len + 1 - seed]);
  }
  return order;
}

// Fisher-Yates with a CSPRNG so seeding can't be predicted.
function shuffle(items) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// `playerIds` is ordered by seed (index 0 = seed 1). Returns every match of the bracket,
// including empty later-round matches. When the field is not a power of two, the top seeds
// get byes: the match is created already completed and the player is moved to round 2.
function buildBracket(playerIds) {
  const n = playerIds.length;
  if (n < 2) throw new Error('A bracket needs at least 2 players');

  const size = nextPowerOfTwo(n);
  const totalRounds = Math.log2(size);
  const order = seedOrder(size);

  const matches = [];
  for (let round = 1; round <= totalRounds; round++) {
    for (let position = 0; position < size / 2 ** round; position++) {
      matches.push({ round, position, player1: null, player2: null, winner: null, isBye: false });
    }
  }
  const at = (round, position) => matches.find((m) => m.round === round && m.position === position);

  for (let p = 0; p < size / 2; p++) {
    const match = at(1, p);
    match.player1 = playerIds[order[2 * p] - 1] ?? null;
    match.player2 = playerIds[order[2 * p + 1] - 1] ?? null;
    if (!match.player1 || !match.player2) {
      match.winner = match.player1 ?? match.player2;
      match.isBye = true;
      const next = at(2, Math.floor(p / 2));
      if (next) next[p % 2 === 0 ? 'player1' : 'player2'] = match.winner;
    }
  }

  for (const m of matches) {
    m.status = m.winner ? 'completed' : m.player1 && m.player2 ? 'ready' : 'pending';
  }
  return { matches, totalRounds };
}

module.exports = { nextPowerOfTwo, seedOrder, shuffle, buildBracket };
