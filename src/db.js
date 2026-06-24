const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const db = new sqlite3.Database(path.join(__dirname, '../elo.db'));

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
});

module.exports = db;
