// Fills a tournament with fake players so you can demo brackets without making accounts by hand.
//   node src/demo.js                 -> adds 7 players to the first open tournament
//   node src/demo.js 2 12            -> adds 12 players to tournament #2
// Demo accounts are named demo_player1, demo_player2, ... (password: password123).
process.env.JWT_SECRET = process.env.JWT_SECRET || 'demo-script'; // this script never signs logins
const bcrypt = require('bcryptjs');
const config = require('./config');
const { openDb } = require('./db');
const { seed } = require('./seed');

const db = openDb(config.dbPath);
seed(db); // makes sure the games and tournaments exist; the server creates the admin on start

const [idArg, countArg] = process.argv.slice(2);
const tournament = idArg
  ? db.prepare('SELECT * FROM tournaments WHERE id = ?').get(Number(idArg))
  : db.prepare("SELECT * FROM tournaments WHERE status = 'open' ORDER BY id LIMIT 1").get();

if (!tournament) {
  console.error('No matching tournament found.');
  process.exit(1);
}
if (tournament.status !== 'open') {
  console.error(`Tournament "${tournament.name}" is already ${tournament.status}; players can only join while it is open.`);
  process.exit(1);
}

const wanted = Math.max(1, Math.min(Number(countArg) || 7, 64));
const hash = bcrypt.hashSync('password123', 10);

const findUser = db.prepare('SELECT id FROM users WHERE username = ?');
const addUser = db.prepare('INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)');
const isIn = db.prepare('SELECT 1 FROM tournament_players WHERE tournament_id = ? AND user_id = ?');
const join = db.prepare('INSERT INTO tournament_players (tournament_id, user_id) VALUES (?, ?)');
const countIn = db.prepare('SELECT COUNT(*) AS n FROM tournament_players WHERE tournament_id = ?');

let added = 0;
db.transaction(() => {
  for (let i = 1; added < wanted; i++) {
    if (countIn.get(tournament.id).n >= tournament.max_players) break;
    const name = `demo_player${i}`;
    const user = findUser.get(name) || { id: addUser.run(name, `${name}@demo.local`, hash).lastInsertRowid };
    if (!isIn.get(tournament.id, user.id)) {
      join.run(tournament.id, user.id);
      added++;
    }
    if (i > 500) break; // safety stop
  }
})();

console.log(`Added ${added} demo player(s) to "${tournament.name}" (${countIn.get(tournament.id).n}/${tournament.max_players} registered).`);
db.close();
