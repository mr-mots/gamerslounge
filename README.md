# GamersLounge Backend

REST API for the GamersLounge game store. It replaces the hard-coded HTML cards with a real database and adds accounts, orders, tournaments with brackets, and a contact inbox.

**Stack:** Node.js 22, Express 5, SQLite (better-sqlite3), JWT auth (httpOnly cookie or Bearer token), zod validation, helmet, rate limiting. Tests use the built-in `node:test`.

## Run it

```bash
npm install
npm start            # http://localhost:3000, creates and seeds data/gamerslounge.db on first run
npm test             # 23 tests
```

On first run in development it creates a dev admin: `admin@gamerslounge.dev` / `admin12345`.
For anything real, set `ADMIN_EMAIL`, `ADMIN_PASSWORD` and `JWT_SECRET` (see `.env.example`).

Put your existing front end (the HTML, CSS and `images/` folder) in a `public/` folder and the server will serve it at `/`.

## API

Errors are always JSON: `{ "error": "message", "details": [...] }`.

| Method | Path | Access | Notes |
|---|---|---|---|
| POST | `/api/auth/register` | public | `username`, `email`, `password` (8+ chars) |
| POST | `/api/auth/login` | public | returns `{ user, token }` and sets an httpOnly cookie |
| POST | `/api/auth/logout` | public | clears the cookie |
| GET | `/api/auth/me` | user | |
| GET | `/api/games` | public | `?platform=pc\|mobile&genre=&q=&sort=title\|price_asc\|price_desc\|newest&page=&limit=`. `q` searches title and genre |
| GET | `/api/games/:idOrSlug` | public | |
| POST / PATCH / DELETE | `/api/games[/:id]` | admin | DELETE is a soft delete, so old orders still show the game |
| GET | `/api/news` | public | `?tag=&page=&limit=` |
| GET | `/api/news/:id` | public | |
| POST / DELETE | `/api/news[/:id]` | admin | |
| POST | `/api/orders` | user | `{ items: [{ gameId, quantity }] }`. Prices are looked up server-side |
| GET | `/api/orders` | user | your orders (`?all=true` for admins) |
| GET | `/api/orders/:id` | owner/admin | |
| PATCH | `/api/orders/:id/status` | admin | `pending`, `paid`, `cancelled`, `refunded` |
| POST | `/api/contact` | public | `name`, `email`, `message` (5 per hour per IP) |
| GET | `/api/contact/messages` | admin | `?unread=true` |
| PATCH | `/api/contact/messages/:id/read` | admin | |
| GET | `/api/tournaments` | public | `?status=open\|in_progress\|completed` |
| GET | `/api/tournaments/:id` | public | players, seeds and every match in the bracket |
| POST | `/api/tournaments` | admin | `name`, `gameId?`, `maxPlayers` (2-64), `startsAt?` |
| POST | `/api/tournaments/:id/join` and `/leave` | user | only while registration is open |
| POST | `/api/tournaments/:id/start` | admin | randomly seeds players and builds the bracket |
| POST | `/api/tournaments/:id/matches/:matchId/result` | admin | `{ winnerId }`, advances the winner and crowns the champion after the final |

### How tournaments work

Single elimination. When an admin starts a tournament, players are shuffled into seeds and `src/bracket.js` builds every round. If the number of players isn't a power of two, the top seeds get byes and skip round 1. Standard seeding keeps seeds 1 and 2 apart until the final. Reporting a result moves the winner into the next match, and the tournament completes when the final is decided.

## Project layout

```
src/
  app.js                  Express app (security headers, rate limits, routes)
  server.js               entry point
  db.js                   SQLite schema
  seed.js                 games (from store.html), news, tournaments, admin
  auth.js, errors.js      JWT middleware, error helpers
  bracket.js              pure bracket logic
  tournamentService.js    tournament rules, all writes in transactions
  routes/                 one file per resource
test/                     API, tournament and bracket tests
```

## Demo data

To try a tournament without creating accounts by hand, fill one with fake players:

```bash
node src/demo.js          # adds 7 players to the first open tournament
node src/demo.js 2 12     # adds 12 players to tournament #2
```

Demo accounts are `demo_player1`, `demo_player2`, ... with password `password123`. Then log in as the admin, open the tournament page, press Start and report the results.

## Notes

- Orders are created as `pending`. There is no payment step yet: the next step is Stripe Checkout in test mode, which would flip the order to `paid` from a webhook.
- The CSP in `app.js` allows inline scripts because the current HTML pages use them. Once that JavaScript moves into `.js` files, remove `'unsafe-inline'`.
- Game cover art is copyrighted. Swap in your own or free images before deploying publicly.
