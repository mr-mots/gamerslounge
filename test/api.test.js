const { startTestServer } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');

let t;
test.before(async () => { t = await startTestServer(); });
test.after(async () => { await t.close(); });

test('health check', async () => {
  const res = await t.api('GET', '/api/health');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
});

test('unknown api route returns JSON 404', async () => {
  const res = await t.api('GET', '/api/nope');
  assert.equal(res.status, 404);
  assert.ok(res.body.error);
});

test('auth: register, login, me, duplicates and bad input', async () => {
  const reg = await t.api('POST', '/api/auth/register', {
    body: { username: 'alice', email: 'Alice@Test.dev', password: 'password123' },
  });
  assert.equal(reg.status, 201);
  assert.equal(reg.body.user.email, 'alice@test.dev');
  assert.equal(reg.body.user.role, 'user');
  assert.equal(reg.body.user.passwordHash, undefined);
  assert.match(reg.headers.get('set-cookie'), /token=.*HttpOnly/i);

  const me = await t.api('GET', '/api/auth/me', { token: reg.body.token });
  assert.equal(me.body.user.username, 'alice');

  const dupe = await t.api('POST', '/api/auth/register', {
    body: { username: 'alice2', email: 'alice@test.dev', password: 'password123' },
  });
  assert.equal(dupe.status, 409);

  const weak = await t.api('POST', '/api/auth/register', {
    body: { username: 'bob', email: 'bob@test.dev', password: 'short' },
  });
  assert.equal(weak.status, 400);
  assert.equal(weak.body.details[0].field, 'password');

  const login = await t.api('POST', '/api/auth/login', { body: { email: 'alice@test.dev', password: 'password123' } });
  assert.equal(login.status, 200);
  const wrong = await t.api('POST', '/api/auth/login', { body: { email: 'alice@test.dev', password: 'wrongpass1' } });
  assert.equal(wrong.status, 401);
  const ghost = await t.api('POST', '/api/auth/login', { body: { email: 'ghost@test.dev', password: 'password123' } });
  assert.equal(ghost.status, 401);
  assert.equal(ghost.body.error, wrong.body.error);

  assert.equal((await t.api('GET', '/api/auth/me')).status, 401);
  assert.equal((await t.api('GET', '/api/auth/me', { token: 'garbage' })).status, 401);
});

test('games: list, filter, search, sort, paginate, fetch by slug', async () => {
  const all = await t.api('GET', '/api/games?limit=100');
  assert.equal(all.body.total, 20);

  const mobile = await t.api('GET', '/api/games?platform=mobile&limit=100');
  assert.ok(mobile.body.data.length > 0 && mobile.body.data.every((g) => g.platform === 'mobile'));

  const search = await t.api('GET', '/api/games?q=fight');
  assert.deepEqual(search.body.data.map((g) => g.title), ['Shadow Fight Arena']);

  const byGenre = await t.api('GET', '/api/games?q=racing&limit=100');
  assert.ok(byGenre.body.data.length >= 3);

  const wildcard = await t.api('GET', '/api/games?q=%25'); // a literal "%" must not match everything
  assert.equal(wildcard.body.total, 0);

  const cheap = await t.api('GET', '/api/games?sort=price_asc&limit=3');
  assert.deepEqual(cheap.body.data.map((g) => g.priceCents), [1000, 1000, 1000]);

  const page2 = await t.api('GET', '/api/games?limit=5&page=2');
  assert.equal(page2.body.data.length, 5);
  assert.equal(page2.body.page, 2);

  const one = await t.api('GET', '/api/games/god-of-war');
  assert.equal(one.status, 200);
  assert.equal(one.body.price, 35);
  assert.equal((await t.api('GET', `/api/games/${one.body.id}`)).body.slug, 'god-of-war');
  assert.equal((await t.api('GET', '/api/games/does-not-exist')).status, 404);
  assert.equal((await t.api('GET', '/api/games?platform=console')).status, 400);
});

test('games: only admins can write; soft delete hides the game', async () => {
  const player = await t.register();
  const admin = await t.loginAdmin();
  const body = { title: 'Test Game', platform: 'pc', priceCents: 999, genre: 'Puzzle' };

  assert.equal((await t.api('POST', '/api/games', { body })).status, 401);
  assert.equal((await t.api('POST', '/api/games', { token: player.token, body })).status, 403);

  const created = await t.api('POST', '/api/games', { token: admin, body });
  assert.equal(created.status, 201);
  assert.equal(created.body.slug, 'test-game');
  const again = await t.api('POST', '/api/games', { token: admin, body });
  assert.equal(again.body.slug, 'test-game-2');

  const patched = await t.api('PATCH', `/api/games/${created.body.id}`, { token: admin, body: { priceCents: 500 } });
  assert.equal(patched.body.priceCents, 500);
  assert.equal(patched.body.title, 'Test Game');

  assert.equal((await t.api('POST', '/api/games', { token: admin, body: { ...body, priceCents: -5 } })).status, 400);

  assert.equal((await t.api('DELETE', `/api/games/${created.body.id}`, { token: admin })).status, 204);
  assert.equal((await t.api('GET', `/api/games/${created.body.id}`)).status, 404);
});

test('orders: totals are computed on the server and orders are private', async () => {
  const alice = await t.register();
  const eve = await t.register();
  const admin = await t.loginAdmin();
  const gow = (await t.api('GET', '/api/games/god-of-war')).body; // $35
  const asphalt = (await t.api('GET', '/api/games/asphalt-9')).body; // $10

  assert.equal((await t.api('POST', '/api/orders', { body: { items: [{ gameId: gow.id }] } })).status, 401);

  const order = await t.api('POST', '/api/orders', {
    token: alice.token,
    body: {
      items: [
        { gameId: gow.id, quantity: 2, priceCents: 1 }, // a client-sent price must be ignored
        { gameId: asphalt.id },
        { gameId: asphalt.id },
      ],
    },
  });
  assert.equal(order.status, 201);
  assert.equal(order.body.totalCents, 3500 * 2 + 1000 * 2);
  assert.equal(order.body.status, 'pending');
  assert.equal(order.body.items.length, 2);

  assert.equal((await t.api('POST', '/api/orders', { token: alice.token, body: { items: [] } })).status, 400);
  const bad = await t.api('POST', '/api/orders', { token: alice.token, body: { items: [{ gameId: 99999 }] } });
  assert.equal(bad.status, 400);
  assert.deepEqual(bad.body.details.unavailableGameIds, [99999]);
  const tooMany = await t.api('POST', '/api/orders', {
    token: alice.token,
    body: { items: [{ gameId: gow.id, quantity: 8 }, { gameId: gow.id, quantity: 8 }] },
  });
  assert.equal(tooMany.status, 400);

  assert.equal((await t.api('GET', `/api/orders/${order.body.id}`, { token: alice.token })).status, 200);
  assert.equal((await t.api('GET', `/api/orders/${order.body.id}`, { token: eve.token })).status, 404);
  assert.equal((await t.api('GET', `/api/orders/${order.body.id}`, { token: admin })).status, 200);

  const mine = await t.api('GET', '/api/orders', { token: eve.token });
  assert.equal(mine.body.data.length, 0);
  assert.equal((await t.api('GET', '/api/orders?all=true', { token: eve.token })).status, 403);
  assert.ok((await t.api('GET', '/api/orders?all=true', { token: admin })).body.data.length >= 1);

  assert.equal((await t.api('PATCH', `/api/orders/${order.body.id}/status`, { token: alice.token, body: { status: 'paid' } })).status, 403);
  const paid = await t.api('PATCH', `/api/orders/${order.body.id}/status`, { token: admin, body: { status: 'paid' } });
  assert.equal(paid.body.status, 'paid');
});

test('orders: a deleted game cannot be ordered but old orders keep working', async () => {
  const alice = await t.register();
  const admin = await t.loginAdmin();
  const g = await t.api('POST', '/api/games', { token: admin, body: { title: 'Short Lived', platform: 'mobile', priceCents: 100 } });
  const order = await t.api('POST', '/api/orders', { token: alice.token, body: { items: [{ gameId: g.body.id }] } });
  assert.equal(order.status, 201);
  await t.api('DELETE', `/api/games/${g.body.id}`, { token: admin });
  assert.equal((await t.api('POST', '/api/orders', { token: alice.token, body: { items: [{ gameId: g.body.id }] } })).status, 400);
  const old = await t.api('GET', `/api/orders/${order.body.id}`, { token: alice.token });
  assert.equal(old.body.items[0].title, 'Short Lived');
});

test('contact form saves messages for admins to read', async () => {
  const player = await t.register();
  const admin = await t.loginAdmin();

  const bad = await t.api('POST', '/api/contact', { body: { name: 'A', email: 'nope', message: 'hi' } });
  assert.equal(bad.status, 400);

  const ok = await t.api('POST', '/api/contact', {
    body: { name: 'Sam', email: 'sam@test.dev', message: 'Please add more racing games!' },
  });
  assert.equal(ok.status, 201);

  assert.equal((await t.api('GET', '/api/contact/messages')).status, 401);
  assert.equal((await t.api('GET', '/api/contact/messages', { token: player.token })).status, 403);

  const inbox = await t.api('GET', '/api/contact/messages?unread=true', { token: admin });
  assert.equal(inbox.body.data.length, 1);
  assert.equal(inbox.body.data[0].message, 'Please add more racing games!');

  const read = await t.api('PATCH', `/api/contact/messages/${inbox.body.data[0].id}/read`, { token: admin });
  assert.equal(read.body.isRead, true);
  assert.equal((await t.api('GET', '/api/contact/messages?unread=true', { token: admin })).body.data.length, 0);
});

test('news: list, filter, fetch, admin create and delete', async () => {
  const admin = await t.loginAdmin();
  const list = await t.api('GET', '/api/news');
  assert.equal(list.body.total, 6);
  assert.ok(list.body.data[0].publishedAt >= list.body.data[1].publishedAt);
  assert.ok((await t.api('GET', '/api/news?tag=esports')).body.data.length >= 1);

  const created = await t.api('POST', '/api/news', {
    token: admin,
    body: { title: 'Hello', tag: 'Updates', author: 'Admin', summary: 'First post' },
  });
  assert.equal(created.status, 201);
  assert.equal((await t.api('GET', `/api/news/${created.body.id}`)).body.title, 'Hello');
  assert.equal((await t.api('DELETE', `/api/news/${created.body.id}`, { token: admin })).status, 204);
  assert.equal((await t.api('GET', `/api/news/${created.body.id}`)).status, 404);
});

test('malformed JSON returns 400 instead of crashing', async () => {
  const res = await fetch(`${t.base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{not json',
  });
  assert.equal(res.status, 400);
});
