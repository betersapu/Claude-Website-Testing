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

// Scale K by score margin: no score = K as-is, larger margin = higher K (capped at 2×)
function adjustedK(winnerScore, loserScore) {
  if (winnerScore == null || loserScore == null) return K;
  const margin = Math.max(1, winnerScore - loserScore);
  return K * Math.min(2, Math.log(1 + margin) / Math.log(1 + 1));
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

    const k = adjustedK(ws, ls);
    const winDelta = k * (1 - ew);
    const loseDelta = k * (0 - el);

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

// Get recent matches for a player (with full doubles teams)
app.get('/api/players/:id/matches', (req, res) => {
  const { id } = req.params;
  db.all(
    `SELECT
       m.id, m.played_at, m.winner_score, m.loser_score,
       w.id  as winner_id,  w.name  as winner_name,
       l.id  as loser_id,   l.name  as loser_name,
       m.winner_rating_before, m.winner_rating_after,
       m.loser_rating_before,  m.loser_rating_after,
       pw.id as partner_winner_id, pw.name as partner_winner_name,
       pl.id as partner_loser_id,  pl.name as partner_loser_name
     FROM matches m
     JOIN players w  ON w.id  = m.winner_id
     JOIN players l  ON l.id  = m.loser_id
     LEFT JOIN matches p ON (
       p.played_at = m.played_at
       AND p.id       != m.id
       AND p.winner_id != m.winner_id
       AND p.loser_id  != m.loser_id
     )
     LEFT JOIN players pw ON pw.id = p.winner_id
     LEFT JOIN players pl ON pl.id = p.loser_id
     WHERE (m.winner_id = ? OR m.loser_id = ?)
     ORDER BY m.played_at DESC LIMIT 20`,
    [id, id],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

// Recalculate all ratings from scratch using current formula
app.post('/api/recalculate', (req, res) => {
  db.all(`SELECT * FROM players`, (err, players) => {
    if (err) return res.status(500).json({ error: err.message });

    db.all(`SELECT * FROM matches ORDER BY played_at ASC, id ASC`, (err, matches) => {
      if (err) return res.status(500).json({ error: err.message });

      // Reset all player ratings
      const ratings = {};
      const wins = {};
      const losses = {};
      players.forEach(p => { ratings[p.id] = 1200; wins[p.id] = 0; losses[p.id] = 0; });

      // Group match rows into doubles games by timestamp
      const games = [];
      const seen = new Set();
      for (const m of matches) {
        if (seen.has(m.id)) continue;
        const partner = matches.find(n =>
          !seen.has(n.id) &&
          n.id !== m.id &&
          n.played_at === m.played_at &&
          n.winner_id !== m.winner_id &&
          n.loser_id !== m.loser_id
        );
        games.push({ primary: m, partner: partner || null });
        seen.add(m.id);
        if (partner) seen.add(partner.id);
      }

      const updates = []; // { id, winner_rating_before, winner_rating_after, loser_rating_before, loser_rating_after }

      for (const { primary: m, partner } of games) {
        const w1 = m.winner_id, l1 = m.loser_id;
        const w2 = partner ? partner.winner_id : null;
        const l2 = partner ? partner.loser_id : null;

        const teamWin = w2 != null ? (ratings[w1] + ratings[w2]) / 2 : ratings[w1];
        const teamLose = l2 != null ? (ratings[l1] + ratings[l2]) / 2 : ratings[l1];

        const ew = expectedScore(teamWin, teamLose);
        const el = expectedScore(teamLose, teamWin);
        const k = adjustedK(m.winner_score, m.loser_score);
        const winDelta = k * (1 - ew);
        const loseDelta = k * (0 - el);

        const newW1 = Math.round((ratings[w1] + winDelta) * 10) / 10;
        const newL1 = Math.round((ratings[l1] + loseDelta) * 10) / 10;

        updates.push({ id: m.id, wBefore: ratings[w1], wAfter: newW1, lBefore: ratings[l1], lAfter: newL1 });

        ratings[w1] = newW1; wins[w1]++;
        ratings[l1] = newL1; losses[l1]++;

        if (partner && w2 != null && l2 != null) {
          const newW2 = Math.round((ratings[w2] + winDelta) * 10) / 10;
          const newL2 = Math.round((ratings[l2] + loseDelta) * 10) / 10;
          updates.push({ id: partner.id, wBefore: ratings[w2], wAfter: newW2, lBefore: ratings[l2], lAfter: newL2 });
          ratings[w2] = newW2; wins[w2]++;
          ratings[l2] = newL2; losses[l2]++;
        }
      }

      // Apply all updates in a transaction
      db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        for (const u of updates) {
          db.run(
            `UPDATE matches SET winner_rating_before=?, winner_rating_after=?, loser_rating_before=?, loser_rating_after=? WHERE id=?`,
            [u.wBefore, u.wAfter, u.lBefore, u.lAfter, u.id]
          );
        }
        for (const p of players) {
          db.run(
            `UPDATE players SET rating=?, wins=?, losses=? WHERE id=?`,
            [ratings[p.id] ?? 1200, wins[p.id] ?? 0, losses[p.id] ?? 0, p.id]
          );
        }
        db.run('COMMIT', (err) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ success: true, players_updated: players.length, matches_updated: updates.length });
        });
      });
    });
  });
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

app.listen(PORT, '0.0.0.0', () => console.log(`Server running at http://localhost:${PORT}`));
