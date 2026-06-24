// Run once: node migrate-discord.js
// Adds discord_id column and sets IDs for each player

const sqlite3 = require('./node_modules/sqlite3').verbose();
const db = new sqlite3.Database('./elo.db');

db.serialize(() => {
  // Add column (safe to re-run — errors are ignored)
  db.run(`ALTER TABLE players ADD COLUMN discord_id TEXT`, err => {
    if (err && !err.message.includes('duplicate')) console.log('Column note:', err.message);
  });

  const discordIds = [
    ['519315420881223681', 'Connor'],
    ['635318504307949572', 'Sean'],
    ['412064493527498757', 'Jacky'],
    ['690691835882111027', 'Ketan'],
    ['513132503477911563', 'Jake'],
  ];

  for (const [discordId, name] of discordIds) {
    db.run(
      `UPDATE players SET discord_id = ? WHERE name = ?`,
      [discordId, name],
      function(err) {
        if (err) console.error(`Error updating ${name}:`, err.message);
        else console.log(`✓ ${name} → ${discordId} (${this.changes} row updated)`);
      }
    );
  }

  db.close(() => console.log('Done.'));
});
