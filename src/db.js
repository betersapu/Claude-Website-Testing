const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbFile = path.join(__dirname, '..', 'elo.db');
const db = new sqlite3.Database(dbFile);

const K_FACTOR = 32;

function runAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function getAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function allAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

async function init() {
  await runAsync(`CREATE TABLE IF NOT EXISTS players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE,
    rating INTEGER DEFAULT 1200,
    wins INTEGER DEFAULT 0,
    losses INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  await runAsync(`CREATE TABLE IF NOT EXISTS matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    winner_id INTEGER,
    loser_id INTEGER,
    winner_rating_before INTEGER,
    loser_rating_before INTEGER,
    winner_rating_after INTEGER,
    loser_rating_after INTEGER,
    played_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(winner_id) REFERENCES players(id),
    FOREIGN KEY(loser_id) REFERENCES players(id)
  )`);

  await runAsync(`CREATE TABLE IF NOT EXISTS head_to_head (
    player_id INTEGER,
    opponent_id INTEGER,
    wins INTEGER DEFAULT 0,
    losses INTEGER DEFAULT 0,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(player_id, opponent_id),
    FOREIGN KEY(player_id) REFERENCES players(id),
    FOREIGN KEY(opponent_id) REFERENCES players(id)
  )`);

  await runAsync(`CREATE TABLE IF NOT EXISTS rating_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER,
    rating INTEGER,
    recorded_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(player_id) REFERENCES players(id)
  )`);

}

async function addPlayer(name) {
  const result = await runAsync('INSERT INTO players (name, rating) VALUES (?, 1200)', [name]);
  await runAsync('INSERT INTO rating_history (player_id, rating) VALUES (?, 1200)', [result.lastID]);
  return getAsync('SELECT id, name, rating, wins, losses FROM players WHERE id = ?', [result.lastID]);
}

function calculateElo(winnerRating, loserRating) {
  const expectedWinner = 1 / (1 + Math.pow(10, (loserRating - winnerRating) / 400));
  const expectedLoser = 1 / (1 + Math.pow(10, (winnerRating - loserRating) / 400));

  const winnerNew = Math.round(winnerRating + K_FACTOR * (1 - expectedWinner));
  const loserNew = Math.round(loserRating + K_FACTOR * (0 - expectedLoser));

  return { winnerNew, loserNew };
}

async function getRankings() {
  const players = await allAsync(`SELECT id, name, rating, wins, losses FROM players ORDER BY rating DESC, name ASC`);
  const ranked = players.map((player, index) => {
    const total = player.wins + player.losses;
    return {
      ...player,
      rank: index + 1,
      winRate: total ? Number(((player.wins / total) * 100).toFixed(1)) : 0,
      totalGames: total
    };
  });
  return ranked;
}

async function getPlayerById(id) {
  const player = await getAsync('SELECT id, name, rating, wins, losses FROM players WHERE id = ?', [id]);
  if (!player) return null;
  const higherCount = await getAsync('SELECT COUNT(*) as count FROM players WHERE rating > ?', [player.rating]);
  const rank = higherCount.count + 1;
  const total = player.wins + player.losses;
  return {
    ...player,
    rank,
    winRate: total ? Number(((player.wins / total) * 100).toFixed(1)) : 0,
    totalGames: total
  };
}

async function getRatingHistory(playerId) {
  return allAsync(
    `SELECT rating, recorded_at as date FROM rating_history
     WHERE player_id = ?
     AND recorded_at >= datetime('now', '-30 days')
     ORDER BY recorded_at ASC`,
    [playerId]
  );
}

async function getHeadToHead(playerId) {
  return allAsync(
    `SELECT opponent_id as opponentId, wins, losses FROM head_to_head
     WHERE player_id = ?`,
    [playerId]
  );
}

async function updateHeadToHead(playerId, opponentId, isWinner) {
  const record = await getAsync(
    'SELECT wins, losses FROM head_to_head WHERE player_id = ? AND opponent_id = ?',
    [playerId, opponentId]
  );

  if (record) {
    const wins = record.wins + (isWinner ? 1 : 0);
    const losses = record.losses + (isWinner ? 0 : 1);
    await runAsync(
      'UPDATE head_to_head SET wins = ?, losses = ?, updated_at = CURRENT_TIMESTAMP WHERE player_id = ? AND opponent_id = ?',
      [wins, losses, playerId, opponentId]
    );
  } else {
    await runAsync(
      'INSERT INTO head_to_head (player_id, opponent_id, wins, losses) VALUES (?, ?, ?, ?)',
      [playerId, opponentId, isWinner ? 1 : 0, isWinner ? 0 : 1]
    );
  }
}

async function addMatchResult(winnerIds, loserIds) {
  const winnerPlayers = await allAsync(
    `SELECT id, rating, wins, losses FROM players WHERE id IN (?, ?)`,
    winnerIds
  );
  const loserPlayers = await allAsync(
    `SELECT id, rating, wins, losses FROM players WHERE id IN (?, ?)`,
    loserIds
  );
  if (winnerPlayers.length !== 2 || loserPlayers.length !== 2) {
    throw new Error('One or more players not found');
  }

  const winnerRating = Math.round(winnerPlayers.reduce((sum, player) => sum + player.rating, 0) / 2);
  const loserRating = Math.round(loserPlayers.reduce((sum, player) => sum + player.rating, 0) / 2);
  const { winnerNew, loserNew } = calculateElo(winnerRating, loserRating);

  const winnerDelta = winnerNew - winnerRating;
  const loserDelta = loserNew - loserRating;

  const updatedWinners = [];
  for (const player of winnerPlayers) {
    const newRating = player.rating + winnerDelta;
    await runAsync(
      'UPDATE players SET rating = ?, wins = wins + 1 WHERE id = ?',
      [newRating, player.id]
    );
    await runAsync('INSERT INTO rating_history (player_id, rating) VALUES (?, ?)', [player.id, newRating]);
    updatedWinners.push({ id: player.id, ratingBefore: player.rating, ratingAfter: newRating });
  }

  const updatedLosers = [];
  for (const player of loserPlayers) {
    const newRating = player.rating + loserDelta;
    await runAsync(
      'UPDATE players SET rating = ?, losses = losses + 1 WHERE id = ?',
      [newRating, player.id]
    );
    await runAsync('INSERT INTO rating_history (player_id, rating) VALUES (?, ?)', [player.id, newRating]);
    updatedLosers.push({ id: player.id, ratingBefore: player.rating, ratingAfter: newRating });
  }

  const storeMatchResult = async (winnerId, loserId, winnerRatingBefore, loserRatingBefore, winnerRatingAfter, loserRatingAfter) => {
    await runAsync(
      `INSERT INTO matches (winner_id, loser_id, winner_rating_before, loser_rating_before, winner_rating_after, loser_rating_after)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [winnerId, loserId, winnerRatingBefore, loserRatingBefore, winnerRatingAfter, loserRatingAfter]
    );
  };

  for (const winner of updatedWinners) {
    for (const loser of updatedLosers) {
      await storeMatchResult(winner.id, loser.id, winner.ratingBefore, loser.ratingBefore, winner.ratingAfter, loser.ratingAfter);
      await updateHeadToHead(winner.id, loser.id, true);
      await updateHeadToHead(loser.id, winner.id, false);
    }
  }

  return {
    winners: updatedWinners,
    losers: updatedLosers,
    winnerRatingBefore: winnerRating,
    loserRatingBefore: loserRating,
    winnerRatingAfter: winnerNew,
    loserRatingAfter: loserNew
  };
}

module.exports = {
  init,
  getRankings,
  getPlayerById,
  addPlayer,
  addMatchResult,
  getRatingHistory,
  getHeadToHead
};
