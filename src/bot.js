require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('./db');

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;

// ── Slash command definitions ──────────────────────────────────────────────
const commands = [
  new SlashCommandBuilder()
    .setName('rankings')
    .setDescription('Show the pickleball leaderboard'),

  new SlashCommandBuilder()
    .setName('profile')
    .setDescription('Show a player\'s stats')
    .addStringOption(opt =>
      opt.setName('player')
        .setDescription('Player name')
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName('matches')
    .setDescription('Show recent matches'),
].map(c => c.toJSON());

// ── Register commands with Discord ─────────────────────────────────────────
const rest = new REST({ version: '10' }).setToken(TOKEN);
rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands })
  .then(() => console.log('Slash commands registered.'))
  .catch(console.error);

// ── Helpers ────────────────────────────────────────────────────────────────

// Fetch all match rows with partner info joined, then deduplicate into games.
// Each game has: played_at, winner_score, loser_score,
//   w1/w2 (winner players), l1/l2 (loser players),
//   w1_before/w1_after, w2_before/w2_after, l1_before/l1_after, l2_before/l2_after
function fetchGames(whereClause, params, limit, callback) {
  db.all(
    `SELECT
       m.id, m.played_at, m.winner_score, m.loser_score,
       m.winner_id, m.loser_id,
       m.winner_rating_before, m.winner_rating_after,
       m.loser_rating_before,  m.loser_rating_after,
       w.name  as winner_name,
       l.name  as loser_name,
       p.id    as partner_id,
       pw.id   as pw_id,   pw.name as pw_name,
       pl.id   as pl_id,   pl.name as pl_name,
       p.winner_rating_before as pw_before, p.winner_rating_after as pw_after,
       p.loser_rating_before  as pl_before, p.loser_rating_after  as pl_after
     FROM matches m
     JOIN players w  ON w.id = m.winner_id
     JOIN players l  ON l.id = m.loser_id
     LEFT JOIN matches p ON (
       p.played_at  = m.played_at
       AND p.id        != m.id
       AND p.winner_id != m.winner_id
       AND p.loser_id  != m.loser_id
     )
     LEFT JOIN players pw ON pw.id = p.winner_id
     LEFT JOIN players pl ON pl.id = p.loser_id
     ${whereClause}
     ORDER BY m.played_at DESC, m.id ASC`,
    params,
    (err, rows) => {
      if (err) return callback(err, null);

      // Deduplicate: keep only one row per game (identified by played_at + winner pair)
      const seen = new Set();
      const games = [];
      for (const r of rows) {
        const key = `${r.played_at}|${Math.min(r.winner_id, r.pw_id || r.winner_id)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        games.push(r);
        if (games.length === limit) break;
      }

      callback(null, games);
    }
  );
}

// ── Bot client ─────────────────────────────────────────────────────────────
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', () => console.log(`Logged in as ${client.user.tag}`));

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;
  await interaction.deferReply();

  // ── /rankings ────────────────────────────────────────────────────────────
  if (commandName === 'rankings') {
    db.all(
      `SELECT name, rating, wins, losses,
              CASE WHEN (wins+losses)>0 THEN ROUND(wins*100.0/(wins+losses),1) ELSE 0 END as win_rate
       FROM players ORDER BY rating DESC`,
      (err, rows) => {
        if (err || !rows.length) return interaction.editReply('No players found.');

        const medals = ['🥇', '🥈', '🥉'];
        const lines = rows.map((p, i) => {
          const medal = medals[i] || `**${i + 1}.**`;
          return `${medal} **${p.name}** — ${Math.round(p.rating)} pts (${p.wins}W ${p.losses}L · ${p.win_rate}%)`;
        });

        const embed = new EmbedBuilder()
          .setTitle('🏓 Pickleball ELO Rankings')
          .setDescription(lines.join('\n'))
          .setColor(0x6c63ff)
          .setTimestamp();

        interaction.editReply({ embeds: [embed] });
      }
    );
  }

  // ── /profile ─────────────────────────────────────────────────────────────
  else if (commandName === 'profile') {
    const name = interaction.options.getString('player');

    db.get(
      `SELECT id, name, rating, wins, losses,
              CASE WHEN (wins+losses)>0 THEN ROUND(wins*100.0/(wins+losses),1) ELSE 0 END as win_rate
       FROM players WHERE name LIKE ?`,
      [`%${name}%`],
      (err, player) => {
        if (err || !player) return interaction.editReply(`No player found matching "${name}".`);

        fetchGames(
          `WHERE (m.winner_id = ? OR m.loser_id = ?)`,
          [player.id, player.id],
          100, // fetch all for chart; we'll slice for display
          (err, games) => {
            const recentGames = (games || []).slice(0, 5);
            const matchLines = recentGames.map(g => {
              const isWinner = g.winner_id === player.id || g.pw_id === player.id;
              const result = isWinner ? '✅' : '❌';

              // Build team strings
              const myTeam   = isWinner
                ? [g.winner_name, g.pw_name].filter(Boolean).join(' & ')
                : [g.loser_name,  g.pl_name].filter(Boolean).join(' & ');
              const oppTeam  = isWinner
                ? [g.loser_name,  g.pl_name].filter(Boolean).join(' & ')
                : [g.winner_name, g.pw_name].filter(Boolean).join(' & ');

              // Rating delta for this player
              let before, after;
              if (g.winner_id === player.id) { before = g.winner_rating_before; after = g.winner_rating_after; }
              else if (g.pw_id  === player.id) { before = g.pw_before;            after = g.pw_after; }
              else if (g.loser_id === player.id) { before = g.loser_rating_before; after = g.loser_rating_after; }
              else                               { before = g.pl_before;            after = g.pl_after; }

              const delta    = Math.round(after - before);
              const deltaStr = delta >= 0 ? `+${delta}` : `${delta}`;
              const score    = g.winner_score != null ? ` (${g.winner_score}-${g.loser_score})` : '';

              return `${result} **${myTeam}** vs **${oppTeam}**${score} \`${deltaStr}\``;
            });

            // Rating history chart (oldest → newest)
            const history = [...(games || [])].reverse();
            const getRatingAfter = g => {
              if (g.winner_id === player.id) return g.winner_rating_after;
              if (g.pw_id     === player.id) return g.pw_after;
              if (g.loser_id  === player.id) return g.loser_rating_after;
              return g.pl_after;
            };
            const getRatingBefore = g => {
              if (g.winner_id === player.id) return g.winner_rating_before;
              if (g.pw_id     === player.id) return g.pw_before;
              if (g.loser_id  === player.id) return g.loser_rating_before;
              return g.pl_before;
            };

            const startRating = history.length ? Math.round(getRatingBefore(history[0])) : Math.round(player.rating);
            const labels = ['Start', ...history.map(g => g.played_at.slice(5, 10))];
            const data   = [startRating, ...history.map(g => Math.round(getRatingAfter(g)))];

            const chartConfig = {
              type: 'line',
              data: {
                labels,
                datasets: [{
                  label: 'Rating',
                  data,
                  borderColor: '#6c63ff',
                  backgroundColor: 'rgba(108,99,255,0.15)',
                  pointBackgroundColor: '#6c63ff',
                  fill: true,
                  tension: 0.3,
                }],
              },
              options: {
                plugins: { legend: { display: false } },
                scales: {
                  y: { ticks: { color: '#aaa' }, grid: { color: '#333' } },
                  x: { ticks: { color: '#aaa' }, grid: { color: '#333' } },
                },
              },
            };

            const chartUrl = `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(chartConfig))}&backgroundColor=%230f1117&width=500&height=200`;

            const embed = new EmbedBuilder()
              .setTitle(`🏓 ${player.name}`)
              .setColor(0x6c63ff)
              .addFields(
                { name: 'Rating',         value: `**${Math.round(player.rating)}**`, inline: true },
                { name: 'Record',         value: `${player.wins}W ${player.losses}L`, inline: true },
                { name: 'Win Rate',       value: `${player.win_rate}%`, inline: true },
                { name: 'Recent Matches', value: matchLines.length ? matchLines.join('\n') : 'No matches yet.' }
              )
              .setImage(chartUrl)
              .setTimestamp();

            interaction.editReply({ embeds: [embed] });
          }
        );
      }
    );
  }

  // ── /matches ─────────────────────────────────────────────────────────────
  else if (commandName === 'matches') {
    fetchGames('', [], 10, (err, games) => {
      if (err || !games.length) return interaction.editReply('No matches found.');

      const lines = games.map(g => {
        const winners = [g.winner_name, g.pw_name].filter(Boolean).join(' & ');
        const losers  = [g.loser_name,  g.pl_name].filter(Boolean).join(' & ');
        const score   = g.winner_score != null ? ` ${g.winner_score}-${g.loser_score}` : '';
        const wDelta  = Math.round(g.winner_rating_after - g.winner_rating_before);
        const lDelta  = Math.round(g.loser_rating_after  - g.loser_rating_before);
        const date    = g.played_at.slice(0, 10);
        return `**${winners}** def. **${losers}**${score} · \`+${wDelta}/${lDelta}\` · ${date}`;
      });

      const embed = new EmbedBuilder()
        .setTitle('🏓 Recent Matches')
        .setDescription(lines.join('\n'))
        .setColor(0x6c63ff)
        .setTimestamp();

      interaction.editReply({ embeds: [embed] });
    });
  }
});

client.login(TOKEN);
