require('dotenv').config();
const express = require('express');
const path = require('path');
const db = require('./db');
const { Glicko2 } = require('glicko2');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Shared admin password protecting all data-changing endpoints.
// Override on the host by setting the ADMIN_PASSWORD environment variable.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'hamster';

// Require the password on any mutating /api request (POST/PUT/DELETE/PATCH).
// Read-only GET endpoints stay public so the main leaderboard works for everyone.
app.use('/api', (req, res, next) => {
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    if (req.get('x-admin-password') !== ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Incorrect or missing admin password' });
    }
  }
  next();
});

// Lets the admin page verify the password before revealing the edit UI.
app.post('/api/auth', (req, res) => res.json({ ok: true }));

// Download a backup of the live SQLite database. Password-protected (it contains
// all data); checked here explicitly since the global guard only covers mutations.
app.get('/api/export', (req, res) => {
  if (req.get('x-admin-password') !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Incorrect or missing admin password' });
  }
  const stamp = new Date().toISOString().slice(0, 10);
  res.download(db.dbPath, `elo-backup-${stamp}.db`, (err) => {
    if (err && !res.headersSent) res.status(500).json({ error: 'Export failed' });
  });
});

// Glicko-2 settings
const G2_DEFAULTS = { tau: 0.5, rating: 1500, rd: 350, vol: 0.06 };

function makeGlicko() {
  return new Glicko2(G2_DEFAULTS);
}

// Score margin multiplier: 1.0 (no score) up to ~1.5 (blowout)
function marginMultiplier(winnerScore, loserScore) {
  if (winnerScore == null || loserScore == null) return 1;
  const margin = Math.max(1, winnerScore - loserScore);
  return 1 + 0.5 * Math.log(1 + margin) / Math.log(2);
}

// Calculate new Glicko-2 ratings for a doubles match.
// Returns { w1, w2, l1, l2 } each with { rating, rd, vol }
function calcGlicko(winners, losers, winnerScore, loserScore) {
  const glicko = makeGlicko();
  const mult = marginMultiplier(winnerScore, loserScore);

  const gw1 = glicko.makePlayer(winners[0].rating, winners[0].rd, winners[0].vol);
  const gw2 = winners[1] ? glicko.makePlayer(winners[1].rating, winners[1].rd, winners[1].vol) : null;
  const gl1 = glicko.makePlayer(losers[0].rating, losers[0].rd, losers[0].vol);
  const gl2 = losers[1] ? glicko.makePlayer(losers[1].rating, losers[1].rd, losers[1].vol) : null;

  // Each winner plays each loser (weighted by margin multiplier via score 1 vs 0)
  const matches = [];
  for (const gw of [gw1, gw2].filter(Boolean)) {
    for (const gl of [gl1, gl2].filter(Boolean)) {
      matches.push([gw, gl, 1]);   // winner beat loser
      matches.push([gl, gw, 0]);   // loser lost to winner
    }
  }

  glicko.updateRatings(matches);

  const round1 = p => Math.round(p.getRating() * 10) / 10;
  const roundRd = p => Math.round(p.getRd() * 100) / 100;

  return {
    w1: { rating: round1(gw1), rd: roundRd(gw1), vol: gw1.getVol() },
    w2: gw2 ? { rating: round1(gw2), rd: roundRd(gw2), vol: gw2.getVol() } : null,
    l1: { rating: round1(gl1), rd: roundRd(gl1), vol: gl1.getVol() },
    l2: gl2 ? { rating: round1(gl2), rd: roundRd(gl2), vol: gl2.getVol() } : null,
  };
}

// Calculate current win/loss streak for a player from match history
function calcStreak(playerId, callback) {
  db.all(
    `SELECT CASE WHEN winner_id = ? THEN 'W' ELSE 'L' END as result
     FROM matches WHERE winner_id = ? OR loser_id = ?
     ORDER BY played_at DESC, id DESC`,
    [playerId, playerId, playerId],
    (err, rows) => {
      if (err || !rows.length) return callback(0);
      const first = rows[0].result;
      let streak = 0;
      for (const r of rows) {
        if (r.result !== first) break;
        streak++;
      }
      callback(first === 'W' ? streak : -streak);
    }
  );
}

// Get all players ranked by rating
app.get('/api/rankings', (req, res) => {
  db.all(
    `SELECT id, name, rating, rd, peak_rating, wins, losses,
            CASE WHEN (wins + losses) > 0 THEN ROUND(wins * 100.0 / (wins + losses), 1) ELSE 0 END as win_rate
     FROM players ORDER BY rating DESC`,
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!rows.length) return res.json(rows);

      // Build form (last 5 results) for all players in one query
      db.all(
        `SELECT winner_id, loser_id FROM matches ORDER BY played_at DESC, id DESC`,
        (err, matches) => {
          const formMap = {};
          for (const m of (matches || [])) {
            if (!formMap[m.winner_id]) formMap[m.winner_id] = [];
            if (!formMap[m.loser_id])  formMap[m.loser_id]  = [];
            if (formMap[m.winner_id].length < 5) formMap[m.winner_id].push('W');
            if (formMap[m.loser_id].length  < 5) formMap[m.loser_id].push('L');
          }
          rows.forEach(p => { p.form = formMap[p.id] || []; });

          // Attach streak to each player
          let remaining = rows.length;
          rows.forEach(p => {
            calcStreak(p.id, streak => {
              p.streak = streak;
              if (--remaining === 0) res.json(rows);
            });
          });
        }
      );
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
    const losers  = loser_ids.map(id => byId[id]);

    const ws = (winner_score != null && winner_score !== '') ? +winner_score : null;
    const ls = (loser_score  != null && loser_score  !== '') ? +loser_score  : null;

    const newRatings = calcGlicko(winners, losers, ws, ls);
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

    db.run(
      `INSERT INTO matches (winner_id, loser_id, winner_rating_before, loser_rating_before, winner_rating_after, loser_rating_after, winner_score, loser_score, played_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [winners[0].id, losers[0].id, winners[0].rating, losers[0].rating, newRatings.w1.rating, newRatings.l1.rating, ws, ls, now],
      (err) => {
        if (err) return res.status(500).json({ error: err.message });
        db.run(
          `INSERT INTO matches (winner_id, loser_id, winner_rating_before, loser_rating_before, winner_rating_after, loser_rating_after, winner_score, loser_score, played_at)
           VALUES (?,?,?,?,?,?,?,?,?)`,
          [winners[1].id, losers[1].id, winners[1].rating, losers[1].rating, newRatings.w2.rating, newRatings.l2.rating, ws, ls, now],
          (err) => {
            if (err) return res.status(500).json({ error: err.message });

            db.run(`UPDATE players SET rating=?, rd=?, vol=?, wins=wins+1,   peak_rating=MAX(COALESCE(peak_rating,0),?) WHERE id=?`, [newRatings.w1.rating, newRatings.w1.rd, newRatings.w1.vol, newRatings.w1.rating, winners[0].id]);
            db.run(`UPDATE players SET rating=?, rd=?, vol=?, wins=wins+1,   peak_rating=MAX(COALESCE(peak_rating,0),?) WHERE id=?`, [newRatings.w2.rating, newRatings.w2.rd, newRatings.w2.vol, newRatings.w2.rating, winners[1].id]);
            db.run(`UPDATE players SET rating=?, rd=?, vol=?, losses=losses+1,peak_rating=MAX(COALESCE(peak_rating,0),?) WHERE id=?`, [newRatings.l1.rating, newRatings.l1.rd, newRatings.l1.vol, newRatings.l1.rating, losers[0].id]);
            db.run(`UPDATE players SET rating=?, rd=?, vol=?, losses=losses+1,peak_rating=MAX(COALESCE(peak_rating,0),?) WHERE id=?`, [newRatings.l2.rating, newRatings.l2.rd, newRatings.l2.vol, newRatings.l2.rating, losers[1].id]);

            res.json({
              winners: [
                { id: winners[0].id, name: winners[0].name, rating: newRatings.w1.rating },
                { id: winners[1].id, name: winners[1].name, rating: newRatings.w2.rating },
              ],
              losers: [
                { id: losers[0].id, name: losers[0].name, rating: newRatings.l1.rating },
                { id: losers[1].id, name: losers[1].name, rating: newRatings.l2.rating },
              ],
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
    `SELECT id, name, rating, peak_rating, wins, losses,
            CASE WHEN (wins + losses) > 0 THEN ROUND(wins * 100.0 / (wins + losses), 1) ELSE 0 END as win_rate
     FROM players WHERE id = ?`,
    [id],
    (err, player) => {
      if (err || !player) return res.status(404).json({ error: 'Player not found' });
      calcStreak(player.id, streak => {
        player.streak = streak;
        res.json(player);
      });
    }
  );
});

// Get player's rating history over the past month
app.get('/api/players/:id/history', (req, res) => {
  const { id } = req.params;
  db.all(
    `SELECT
       CASE WHEN winner_id = ? THEN winner_rating_after  ELSE loser_rating_after  END as rating,
       CASE WHEN winner_id = ? THEN winner_rating_before ELSE loser_rating_before END as rating_before,
       played_at
     FROM matches
     WHERE (winner_id = ? OR loser_id = ?)
       AND played_at >= datetime('now', '-30 days')
     ORDER BY played_at ASC`,
    [id, id, id, id],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

// Get partner stats for a player
app.get('/api/players/:id/partners', (req, res) => {
  const id = parseInt(req.params.id);
  db.all(
    `SELECT partner_id, partner_name,
            SUM(CASE WHEN result='W' THEN 1 ELSE 0 END) as wins,
            SUM(CASE WHEN result='L' THEN 1 ELSE 0 END) as losses
     FROM (
       SELECT p.winner_id as partner_id, pw.name as partner_name, 'W' as result
       FROM matches m
       JOIN matches p ON p.played_at = m.played_at AND p.id != m.id
                      AND p.winner_id != m.winner_id AND p.loser_id != m.loser_id
       JOIN players pw ON pw.id = p.winner_id
       WHERE m.winner_id = ?
       UNION ALL
       SELECT p.loser_id as partner_id, pl.name as partner_name, 'L' as result
       FROM matches m
       JOIN matches p ON p.played_at = m.played_at AND p.id != m.id
                      AND p.winner_id != m.winner_id AND p.loser_id != m.loser_id
       JOIN players pl ON pl.id = p.loser_id
       WHERE m.loser_id = ?
     )
     GROUP BY partner_id, partner_name
     ORDER BY CAST(wins AS REAL) / (wins + losses) DESC`,
    [id, id],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows || []);
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

      // Reset all player state
      const state = {};
      players.forEach(p => {
        state[p.id] = { rating: G2_DEFAULTS.rating, rd: G2_DEFAULTS.rd, vol: G2_DEFAULTS.vol, wins: 0, losses: 0 };
      });

      // Group match rows into doubles games by timestamp
      const games = [];
      const seen = new Set();
      for (const m of matches) {
        if (seen.has(m.id)) continue;
        const partner = matches.find(n =>
          !seen.has(n.id) && n.id !== m.id &&
          n.played_at === m.played_at &&
          n.winner_id !== m.winner_id &&
          n.loser_id  !== m.loser_id
        );
        games.push({ primary: m, partner: partner || null });
        seen.add(m.id);
        if (partner) seen.add(partner.id);
      }

      const updates = [];

      for (const { primary: m, partner } of games) {
        const wIds = [m.winner_id, partner?.winner_id].filter(Boolean);
        const lIds = [m.loser_id,  partner?.loser_id ].filter(Boolean);

        const winners = wIds.map(id => ({ id, ...state[id] }));
        const losers  = lIds.map(id => ({ id, ...state[id] }));

        const nr = calcGlicko(winners, losers, m.winner_score, m.loser_score);

        // Primary row
        updates.push({ id: m.id, wBefore: winners[0].rating, wAfter: nr.w1.rating, lBefore: losers[0].rating, lAfter: nr.l1.rating });
        state[winners[0].id] = { ...nr.w1, wins: state[winners[0].id].wins + 1, losses: state[winners[0].id].losses };
        state[losers[0].id]  = { ...nr.l1, wins: state[losers[0].id].wins,  losses: state[losers[0].id].losses + 1 };

        // Partner row
        if (partner && nr.w2 && nr.l2) {
          updates.push({ id: partner.id, wBefore: winners[1].rating, wAfter: nr.w2.rating, lBefore: losers[1].rating, lAfter: nr.l2.rating });
          state[winners[1].id] = { ...nr.w2, wins: state[winners[1].id].wins + 1, losses: state[winners[1].id].losses };
          state[losers[1].id]  = { ...nr.l2, wins: state[losers[1].id].wins,  losses: state[losers[1].id].losses + 1 };
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
          const s = state[p.id];
          db.run(
            `UPDATE players SET rating=?, rd=?, vol=?, wins=?, losses=? WHERE id=?`,
            [s.rating, s.rd, s.vol, s.wins, s.losses, p.id]
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

// Get a player's Discord avatar URL via the bot token
app.get('/api/players/:id/avatar', (req, res) => {
  db.get('SELECT discord_id FROM players WHERE id = ?', [req.params.id], async (err, player) => {
    if (err || !player || !player.discord_id) return res.status(404).json({ error: 'No Discord ID' });
    try {
      const r = await fetch(`https://discord.com/api/v10/users/${player.discord_id}`, {
        headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}` }
      });
      const user = await r.json();
      const url = user.avatar
        ? `https://cdn.discordapp.com/avatars/${player.discord_id}/${user.avatar}.png?size=128`
        : `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(player.discord_id) % 6n)}.png`;
      res.json({ url });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
});

// Get daily activity for a player (last 120 days)
app.get('/api/players/:id/activity', (req, res) => {
  const { id } = req.params;
  db.all(
    `SELECT played_at,
            CASE WHEN winner_id = ? THEN 1 ELSE 0 END as won
     FROM matches
     WHERE (winner_id = ? OR loser_id = ?)
       AND played_at >= datetime('now', '-120 days')
     ORDER BY played_at ASC`,
    [id, id, id],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows || []);
    }
  );
});

app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
