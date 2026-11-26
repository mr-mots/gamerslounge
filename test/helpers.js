process.env.JWT_SECRET = 'test-secret';

const http = require('node:http');
const { openDb } = require('../src/db');
const { seed } = require('../src/seed');
const { createApp } = require('../src/app');

async function startTestServer() {
  const db = openDb(':memory:');
  seed(db, { admin: { username: 'admin', email: 'admin@test.dev', password: 'adminpass123' } });
  const server = http.createServer(createApp(db, { rateLimit: false }));
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  async function api(method, path, { token, body } = {}) {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
  }

  let counter = 0;
  async function register(name = `player${++counter}`) {
    const res = await api('POST', '/api/auth/register', {
      body: { username: name, email: `${name}@test.dev`, password: 'password123' },
    });
    return { token: res.body.token, user: res.body.user };
  }

  async function loginAdmin() {
    const res = await api('POST', '/api/auth/login', { body: { email: 'admin@test.dev', password: 'adminpass123' } });
    return res.body.token;
  }

  return {
    db,
    base,
    api,
    register,
    loginAdmin,
    close: () => new Promise((resolve) => server.close(() => { db.close(); resolve(); })),
  };
}

module.exports = { startTestServer };
