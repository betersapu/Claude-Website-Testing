const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// The database that ships in the repo — used as a seed source on hosts with an empty volume.
const bundledDb = path.join(__dirname, '../elo.db');

// On Railway, set DATABASE_PATH to a path inside a mounted volume (e.g. /data/elo.db)
// so the database survives redeploys. Locally it defaults to the bundled elo.db.
const dbPath = process.env.DATABASE_PATH || bundledDb;

const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS players (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      rating REAL DEFAULT 1500,
      wins INTEGER DEFAULT 0,
      losses INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      winner_id INTEGER NOT NULL,
      loser_id INTEGER NOT NULL,
      winner_rating_before REAL NOT NULL,
      loser_rating_before REAL NOT NULL,
      winner_rating_after REAL NOT NULL,
      loser_rating_after REAL NOT NULL,
      winner_score INTEGER,
      loser_score INTEGER,
      played_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (winner_id) REFERENCES players(id),
      FOREIGN KEY (loser_id) REFERENCES players(id)
    )
  `);

  // Migrations — ignore errors if columns already exist
  db.run(`ALTER TABLE matches ADD COLUMN winner_score INTEGER`, () => {});
  db.run(`ALTER TABLE matches ADD COLUMN loser_score INTEGER`, () => {});
  db.run(`ALTER TABLE players ADD COLUMN rd REAL DEFAULT 350`, () => {});
  db.run(`ALTER TABLE players ADD COLUMN vol REAL DEFAULT 0.06`, () => {});

  // Seed an empty volume DB (e.g. fresh Railway deploy) from the bundled elo.db.
  // Only runs when using a separate DB path AND the players table is empty, so it
  // never overwrites live data.
  console.log(`[startup] using database: ${dbPath}`);

  if (dbPath !== bundledDb && fs.existsSync(bundledDb)) {
    db.get(`SELECT COUNT(*) AS c FROM players`, (err, row) => {
      if (err) return console.log(`[startup] DB check failed: ${err.message}`);
      if (row.c > 0) return logPlayerCount(); // already has data — leave it alone

      console.log('[startup] empty volume detected — seeding from bundled elo.db');
      const seedSql = bundledDb.replace(/'/g, "''");
      db.serialize(() => {
        db.run(`ATTACH DATABASE '${seedSql}' AS seed`);
        db.run(`INSERT INTO players (id, name, rating, wins, losses, created_at, rd, vol)
                SELECT id, name, rating, wins, losses, created_at, rd, vol FROM seed.players`);
        db.run(`INSERT INTO matches (id, winner_id, loser_id, winner_rating_before, loser_rating_before,
                                     winner_rating_after, loser_rating_after, winner_score, loser_score, played_at)
                SELECT id, winner_id, loser_id, winner_rating_before, loser_rating_before,
                       winner_rating_after, loser_rating_after, winner_score, loser_score, played_at FROM seed.matches`);
        db.run(`DETACH DATABASE seed`, (e) => {
          if (e) console.error('[startup] seed FAILED:', e.message);
          else console.log('[startup] seeded database from bundled elo.db');
          logPlayerCount();
        });
      });
    });
  } else {
    logPlayerCount();
  }
});

function logPlayerCount() {
  db.get('SELECT COUNT(*) AS c FROM players', (err, row) => {
    if (err) console.log(`[startup] player count check failed: ${err.message}`);
    else console.log(`[startup] players in database: ${row.c}`);
  });
}

db.dbPath = dbPath;
module.exports = db;
