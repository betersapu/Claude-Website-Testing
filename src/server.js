const express = require('express');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = 3000;
const K = 32;

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

function expectedScore(ratingA, ratingB) {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

// Get all players ranked by rating
app.get('/api/rankings', (req, res) => {
  db.all(
    `SELECT id, name, rating, wins, losses,
            CASE WHEN (wins + losses) > 0 THEN ROUND(wins * 100.0 / (wins + losses), 1) ELSE 0 END as win_rate
     FROM players ORDER BY rating DESC`,
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

// Add a player
app.post('/api/players', (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name required' });
  db.run('INSERT INTO players (name) VALUES (?)', [name.trim()], function (err) {
    if (err) return res.status(400).json({ error: 'Player already exists' });
    db.get('SELECT * FROM players WHERE id = ?', [this.lastID], (err, row) => res.json(row));
  });
});

// Delete a player
app.delete('/api/players/:id', (req, res) => {
  const { id } = req.params;
  db.run('DELETE FROM matches WHERE winner_id = ? OR loser_id = ?', [id, id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    db.run('DELETE FROM match_players WHERE player_id = ?', [id], () => {});
    db.run('DELETE FROM players WHERE id = ?', [id], function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0) return res.status(404).json({ error: 'Player not found' });
      res.json({ success: true });
    });
  });
});

// Submit a doubles match result
// Body: { winner_ids: [id1, id2], loser_ids: [id3, id4], winner_score?, loser_score? }
app.post('/api/matches', (req, res) => {
  const { winner_ids, loser_ids, winner_score, loser_score } = req.body;

  if (
    !Array.isArray(winner_ids) || !Array.isArray(loser_ids) ||
    winner_ids.length !== 2 || loser_ids.length !== 2
  ) return res.status(400).json({ error: 'Provide exactly 2 winner_ids and 2 loser_ids' });

  const allIds = [...winner_ids, ...loser_ids];
  if (new Set(allIds).size !== 4) return res.status(400).json({ error: 'All four players must be different' });

  const placeholders = allIds.map(() => '?').join(',');
  db.all(`SELECT * FROM players WHERE id IN (${placeholders})`, allIds, (err, players) => {
    if (err || players.length !== 4) return res.status(404).json({ error: 'One or more players not found' });

    const byId = Object.fromEntries(players.map(p => [p.id, p]));
    const winners = winner_ids.map(id => byId[id]);
    const losers = loser_ids.map(id => byId[id]);

    const teamWinRating = (winners[0].rating + winners[1].rating) / 2;
    const teamLoseRating = (losers[0].rating + losers[1].rating) / 2;

    const ew = expectedScore(teamWinRating, teamLoseRating);
    const el = expectedScore(teamLoseRating, teamWinRating);

    const winDelta = K * (1 - ew);
    const loseDelta = K * (0 - el);

    const updates = [
      ...winners.map(p => ({ id: p.id, ratingBefore: p.rating, ratingAfter: Math.round((p.rating + winDelta) * 10) / 10, won: 1 })),
      ...losers.map(p => ({ id: p.id, ratingBefore: p.rating, ratingAfter: Math.round((p.rating + loseDelta) * 10) / 10, won: 0 })),
    ];

    // Store as two separate legacy match rows (winner_id/loser_id) for history compatibility
    // We pair up: winner[0] vs loser[0], winner[1] vs loser[1] — both recorded same timestamp
    const w0 = updates[0], w1 = updates[1], l0 = updates[2], l1 = updates[3];
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

    const ws = (winner_score != null && winner_score !== '') ? +winner_score : null;
    const ls = (loser_score != null && loser_score !== '') ? +loser_score : null;

    db.run(
      `INSERT INTO matches (winner_id, loser_id, winner_rating_before, loser_rating_before, winner_rating_after, loser_rating_after, winner_score, loser_score, played_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [w0.id, l0.id, w0.ratingBefore, l0.ratingBefore, w0.ratingAfter, l0.ratingAfter, ws, ls, now],
      (err) => {
        if (err) return res.status(500).json({ error: err.message });
        db.run(
          `INSERT INTO matches (winner_id, loser_id, winner_rating_before, loser_rating_before, winner_rating_after, loser_rating_after, winner_score, loser_score, played_at)
           VALUES (?,?,?,?,?,?,?,?,?)`,
          [w1.id, l1.id, w1.ratingBefore, l1.ratingBefore, w1.ratingAfter, l1.ratingAfter, ws, ls, now],
          (err) => {
            if (err) return res.status(500).json({ error: err.message });

            updates.forEach(u => {
              if (u.won) {
                db.run('UPDATE players SET rating = ?, wins = wins + 1 WHERE id = ?', [u.ratingAfter, u.id]);
              } else {
                db.run('UPDATE players SET rating = ?, losses = losses + 1 WHERE id = ?', [u.ratingAfter, u.id]);
              }
            });

            res.json({
              winners: updates.filter(u => u.won).map(u => ({ id: u.id, name: byId[u.id].name, rating: u.ratingAfter })),
              losers: updates.filter(u => !u.won).map(u => ({ id: u.id, name: byId[u.id].name, rating: u.ratingAfter })),
            });
          }
        );
      }
    );
  });
});

// Get player profile
app.get('/api/players/:id', (req, res) => {
  const { id } = req.params;
  db.get(
    `SELECT id, name, rating, wins, losses,
            CASE WHEN (wins + losses) > 0 THEN ROUND(wins * 100.0 / (wins + losses), 1) ELSE 0 END as win_rate
     FROM players WHERE id = ?`,
    [id],
    (err, player) => {
      if (err || !player) return res.status(404).json({ error: 'Player not found' });
      res.json(player);
    }
  );
});

// Get player's rating history over the past month
app.get('/api/players/:id/history', (req, res) => {
  const { id } = req.params;
  db.all(
    `SELECT
       CASE WHEN winner_id = ? THEN winner_rating_after ELSE loser_rating_after END as rating,
       played_at
     FROM matches
     WHERE (winner_id = ? OR loser_id = ?)
       AND played_at >= datetime('now', '-30 days')
     ORDER BY played_at ASC`,
    [id, id, id],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

// Get recent matches for a player
app.get('/api/players/:id/matches', (req, res) => {
  const { id } = req.params;
  db.all(
    `SELECT m.id, m.played_at,
            w.id as winner_id, w.name as winner_name,
            l.id as loser_id, l.name as loser_name,
            m.winner_rating_before, m.winner_rating_after,
            m.loser_rating_before, m.loser_rating_after,
            m.winner_score, m.loser_score
     FROM matches m
     JOIN players w ON w.id = m.winner_id
     JOIN players l ON l.id = m.loser_id
     WHERE m.winner_id = ? OR m.loser_id = ?
     ORDER BY m.played_at DESC LIMIT 20`,
    [id, id],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

// Update a player's data
app.put('/api/players/:id', (req, res) => {
  const { id } = req.params;
  const { name, rating, wins, losses } = req.body;
  db.run(
    `UPDATE players SET name = ?, rating = ?, wins = ?, losses = ? WHERE id = ?`,
    [name, rating, wins, losses, id],
    function (err) {
      if (err) return res.status(400).json({ error: err.message });
      if (this.changes === 0) return res.status(404).json({ error: 'Player not found' });
      db.get('SELECT * FROM players WHERE id = ?', [id], (err, row) => res.json(row));
    }
  );
});

// Get all matches
app.get('/api/matches', (req, res) => {
  db.all(
    `SELECT m.id, m.played_at, m.winner_score, m.loser_score,
            w.id as winner_id, w.name as winner_name,
            l.id as loser_id, l.name as loser_name,
            m.winner_rating_before, m.winner_rating_after,
            m.loser_rating_before, m.loser_rating_after
     FROM matches m
     JOIN players w ON w.id = m.winner_id
     JOIN players l ON l.id = m.loser_id
     ORDER BY m.played_at DESC`,
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

// Delete a single match
app.delete('/api/matches/:id', (req, res) => {
  db.get('SELECT * FROM matches WHERE id = ?', [req.params.id], (err, match) => {
    if (err || !match) return res.status(404).json({ error: 'Match not found' });

    // Reverse the rating/record changes for both players
    db.run(
      `UPDATE players SET rating = ?, wins = MAX(0, wins - 1) WHERE id = ?`,
      [match.winner_rating_before, match.winner_id]
    );
    db.run(
      `UPDATE players SET rating = ?, losses = MAX(0, losses - 1) WHERE id = ?`,
      [match.loser_rating_before, match.loser_id]
    );
    db.run('DELETE FROM matches WHERE id = ?', [req.params.id], function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    });
  });
});

app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
