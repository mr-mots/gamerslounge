const bcrypt = require('bcryptjs');

// Taken from the original store.html. Prices are in cents. Genres are new (useful for search
// and for a recommender later). Two fixes vs the HTML: "Battle Grounds BuyMobile" -> "Battle Grounds
// Mobile" (find-and-replace typo) and FIFA 22 is tagged "pc" (it was tagged "mobile").
const GAMES = [
  ['Grand Theft Auto', 'pc', 'Action-adventure', 3000, 'gta5.jpeg'],
  ['Batman Arkham City', 'pc', 'Action-adventure', 1500, 'download (1).jpeg'],
  ['Assasins Creed Valhalla', 'pc', 'Action RPG', 5000, 'download (3).jpeg'],
  ['Spider man', 'pc', 'Action-adventure', 2000, 'download (4).jpeg'],
  ['God of War', 'pc', 'Action-adventure', 3500, 'gow ragnarok.jpeg'],
  ['Battle Grounds Mobile', 'mobile', 'Battle royale', 2500, 'images.jpeg'],
  ['Call Of Duty Mobile', 'mobile', 'Shooter', 4000, 'images (1).jpeg'],
  ['Free Fire', 'mobile', 'Battle royale', 4500, 'download (5).jpeg'],
  ['Shadow Fight Arena', 'mobile', 'Fighting', 2000, 'download (6).jpeg'],
  ['Asphalt 9', 'mobile', 'Racing', 1000, 'asphalt9.jpeg'],
  ['Genshin Impact', 'mobile', 'Action RPG', 1000, 'genshinimpact.jpeg'],
  ['Persona 5', 'pc', 'JRPG', 1500, 'persona 5.jpeg'],
  ['FIFA 22', 'pc', 'Sports', 2000, 'fifa22.jpeg'],
  ['Need For Speed', 'pc', 'Racing', 3000, 'nfs.jpeg'],
  ['Honkai Impact', 'mobile', 'Action RPG', 12000, 'honkai impact.jpeg'],
  ['Candy Crush', 'mobile', 'Puzzle', 5000, 'candy crush.jpeg'],
  ['FRAG', 'mobile', 'Shooter', 1000, 'frag.jpeg'],
  ['Beach Buggy Racing', 'mobile', 'Racing', 3000, 'bbracing.jpeg'],
  ['Cyberpunk 2077', 'pc', 'Action RPG', 5000, 'cyberpunk.jpeg'],
  ['Red Dead Redemption', 'pc', 'Action-adventure', 4500, 'rdr.jpeg'],
];

// The original news cards were generic business filler, so these are gaming placeholders.
const NEWS = [
  ['Weekly Cup Returns With Bigger Prize Pool', 'Esports', 'Elliot Anderson', 'Registration is open for this week\'s community cup. Sign in, join a bracket and climb the standings.', 'gm 1.jpeg', '2026-11-02 10:00:00'],
  ['New Titles Added To The Store', 'Store', 'Elliot Anderson', 'A fresh batch of PC and mobile games just landed in the catalog. Browse by platform to find your next favourite.', 'gm 2.jpeg', '2026-11-05 10:00:00'],
  ['How To Climb The Ranks In 1v1 Brackets', 'Guides', 'Elliot Anderson', 'Seeding, byes and what to expect in a single-elimination tournament, explained in plain language.', 'gm 3.jpeg', '2026-11-08 10:00:00'],
  ['Community Spotlight: Player Of The Month', 'Community', 'Elliot Anderson', 'Meet this month\'s standout player and see the matches that got them there.', 'gm 4.jpeg', '2026-11-12 10:00:00'],
  ['Patch Notes: Faster Search And Smoother Checkout', 'Updates', 'Elliot Anderson', 'Search now covers titles and genres, and orders are totalled on the server so prices are always correct.', 'gm 5.jpeg', '2026-11-15 10:00:00'],
  ['Behind The Scenes: Building GamersLounge', 'Updates', 'Elliot Anderson', 'A look at how the platform went from a static page to a full-stack app.', 'gm 6.jpeg', '2026-11-18 10:00:00'],
];

const TOURNAMENTS = [
  ['Shadow Fight Arena Weekly Cup', 'Shadow Fight Arena', 16, '2026-12-05 18:00:00'],
  ['FIFA 22 Champions Cup', 'FIFA 22', 16, '2026-12-12 18:00:00'],
  ['Free Fire 1v1 Clash', 'Free Fire', 8, '2026-12-19 18:00:00'],
];

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function seed(db, { admin = null } = {}) {
  const insertGame = db.prepare(
    'INSERT INTO games (slug, title, platform, genre, price_cents, image) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const insertNews = db.prepare(
    'INSERT INTO news (title, tag, author, summary, image, published_at) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const insertTournament = db.prepare(
    'INSERT INTO tournaments (name, game_id, max_players, starts_at) VALUES (?, ?, ?, ?)'
  );
  const findGame = db.prepare('SELECT id FROM games WHERE title = ?');

  const run = db.transaction(() => {
    if (db.prepare('SELECT COUNT(*) AS n FROM games').get().n === 0) {
      for (const [title, platform, genre, price, image] of GAMES) {
        insertGame.run(slugify(title), title, platform, genre, price, `images/${image}`);
      }
    }
    if (db.prepare('SELECT COUNT(*) AS n FROM news').get().n === 0) {
      for (const [title, tag, author, summary, image, date] of NEWS) {
        insertNews.run(title, tag, author, summary, `images/${image}`, date);
      }
    }
    if (db.prepare('SELECT COUNT(*) AS n FROM tournaments').get().n === 0) {
      for (const [name, gameTitle, max, startsAt] of TOURNAMENTS) {
        insertTournament.run(name, findGame.get(gameTitle)?.id ?? null, max, startsAt);
      }
    }
    if (admin && !db.prepare("SELECT 1 FROM users WHERE role = 'admin'").get()) {
      db.prepare('INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)').run(
        admin.username || 'admin',
        admin.email.toLowerCase(),
        bcrypt.hashSync(admin.password, 10),
        'admin'
      );
    }
  });
  run();
}

// Admin from env vars, or a throwaway dev admin outside production.
function adminFromEnv(isProd) {
  if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
    return { username: process.env.ADMIN_USERNAME || 'admin', email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD };
  }
  if (!isProd) {
    console.warn('[seed] No ADMIN_EMAIL/ADMIN_PASSWORD set: creating dev admin admin@gamerslounge.dev / admin12345');
    return { username: 'admin', email: 'admin@gamerslounge.dev', password: 'admin12345' };
  }
  console.warn('[seed] No admin created: set ADMIN_EMAIL and ADMIN_PASSWORD to create one');
  return null;
}

module.exports = { seed, adminFromEnv, slugify, GAMES };

if (require.main === module) {
  const config = require('./config');
  const { openDb } = require('./db');
  const db = openDb(config.dbPath);
  seed(db, { admin: adminFromEnv(config.isProd) });
  console.log(`Seeded ${config.dbPath}`);
}
