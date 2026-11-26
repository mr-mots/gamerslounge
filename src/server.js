const config = require('./config');
const { openDb } = require('./db');
const { seed, adminFromEnv } = require('./seed');
const { createApp } = require('./app');

const db = openDb(config.dbPath);
seed(db, { admin: adminFromEnv(config.isProd) });

const server = createApp(db).listen(config.port, () => {
  console.log(`GamersLounge API listening on http://localhost:${config.port}`);
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
