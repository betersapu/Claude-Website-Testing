const path = require('path');
const express = require('express');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/players', async (req, res) => {
  try {
    const players = await db.getRankings();
    res.json(players);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to load players' });
  }
});

app.post('/api/players', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Player name is required' });
    }
    const player = await db.addPlayer(name.trim());
    res.status(201).json(player);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message || 'Failed to add player' });
  }
});

app.get('/api/players/:id', async (req, res) => {
  try {
    const player = await db.getPlayerById(Number(req.params.id));
    if (!player) {
      return res.status(404).json({ error: 'Player not found' });
    }
    const history = await db.getRatingHistory(player.id);
    res.json({ player, history });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to load player profile' });
  }
});

app.post('/api/matches', async (req, res) => {
  try {
    const { winnerIds, loserIds } = req.body;
    if (!Array.isArray(winnerIds) || !Array.isArray(loserIds) || winnerIds.length !== 2 || loserIds.length !== 2) {
      return res.status(400).json({ error: 'Valid winner and loser team arrays are required' });
    }
    const allIds = [...winnerIds, ...loserIds];
    const uniqueIds = new Set(allIds);
    if (uniqueIds.size !== allIds.length) {
      return res.status(400).json({ error: 'Each player must appear only once in the match' });
    }
    const result = await db.addMatchResult(winnerIds.map(Number), loserIds.map(Number));
    const players = await db.getRankings();
    res.json({ result, players });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message || 'Failed to record match' });
  }
});

app.get('/api/players/:id/head-to-head', async (req, res) => {
  try {
    const records = await db.getHeadToHead(Number(req.params.id));
    res.json(records);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to load head-to-head records' });
  }
});

app.listen(PORT, async () => {
  await db.init();
  console.log(`Friend Elo Ranking app is running at http://localhost:${PORT}`);
});
