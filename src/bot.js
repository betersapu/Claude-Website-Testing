require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const TOKEN     = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const API       = process.env.RAILWAY_URL || 'http://localhost:3000';

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

// ── Register commands ──────────────────────────────────────────────────────
const rest = new REST({ version: '10' }).setToken(TOKEN);
rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands })
  .then(() => console.log('Slash commands registered.'))
  .catch(console.error);

// ── API helper ─────────────────────────────────────────────────────────────
async function api(path) {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`API ${path} → ${res.status}`);
  return res.json();
}

// ── Date helper ────────────────────────────────────────────────────────────
function toLocalDate(ts) {
  return new Date(ts.replace(' ', 'T') + 'Z')
    .toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }); // YYYY-MM-DD in PST
}

function toLocalShort(ts) {
  return new Date(ts.replace(' ', 'T') + 'Z')
    .toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric' });
}

// ── Bot client ─────────────────────────────────────────────────────────────
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', () => console.log(`Logged in as ${client.user.tag}`));

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName } = interaction;
  await interaction.deferReply();

  // ── /rankings ──────────────────────────────────────────────────────────
  if (commandName === 'rankings') {
    try {
      const players = await api('/api/rankings');
      if (!players.length) return interaction.editReply('No players found.');

      const medals = ['🥇', '🥈', '🥉'];
      const lines = players.map((p, i) => {
        const medal = medals[i] || `**${i + 1}.**`;
        return `${medal} **${p.name}** — ${Math.round(p.rating)} pts (${p.wins}W ${p.losses}L · ${p.win_rate}%)`;
      });

      const embed = new EmbedBuilder()
        .setTitle('🏓 Pickleball ELO Rankings')
        .setDescription(lines.join('\n'))
        .setColor(0x6c63ff)
        .setTimestamp();

      interaction.editReply({ embeds: [embed] });
    } catch (e) {
      interaction.editReply('Failed to fetch rankings.');
    }
  }

  // ── /profile ───────────────────────────────────────────────────────────
  else if (commandName === 'profile') {
    const name = interaction.options.getString('player');
    try {
      const players = await api('/api/rankings');
      const player  = players.find(p => p.name.toLowerCase().includes(name.toLowerCase()));
      if (!player) return interaction.editReply(`No player found matching "${name}".`);

      const [detail, matches, history, avatarData] = await Promise.all([
        api(`/api/players/${player.id}`),
        api(`/api/players/${player.id}/matches`),
        api(`/api/players/${player.id}/history`),
        api(`/api/players/${player.id}/avatar`).catch(() => null),
      ]);

      // Recent matches
      const matchLines = matches.slice(0, 5).map(m => {
        const won = m.winner_id === player.id;
        const myTeam  = won
          ? [m.winner_name,  m.partner_winner_name].filter(Boolean).join(' & ')
          : [m.loser_name,   m.partner_loser_name ].filter(Boolean).join(' & ');
        const oppTeam = won
          ? [m.loser_name,   m.partner_loser_name ].filter(Boolean).join(' & ')
          : [m.winner_name,  m.partner_winner_name].filter(Boolean).join(' & ');
        const before   = won ? m.winner_rating_before : m.loser_rating_before;
        const after    = won ? m.winner_rating_after  : m.loser_rating_after;
        const delta    = Math.round(after - before);
        const deltaStr = delta >= 0 ? `+${delta}` : `${delta}`;
        const score    = m.winner_score != null ? ` (${m.winner_score}-${m.loser_score})` : '';
        return `${won ? '✅' : '❌'} **${myTeam}** vs **${oppTeam}**${score} \`${deltaStr}\``;
      });

      // Rating chart
      const labels = ['Start', ...history.map(h => toLocalShort(h.played_at))];
      const data   = history.length
        ? [Math.round(history[0].rating_before), ...history.map(h => Math.round(h.rating))]
        : [Math.round(detail.rating)];

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

      // Streak
      const streak    = detail.streak || 0;
      const streakStr = streak === 0 ? '—' : streak > 0 ? `🔥 W${streak}` : `❄️ L${Math.abs(streak)}`;
      const peak      = detail.peak_rating ? Math.round(detail.peak_rating) : Math.round(detail.rating);

      // Avatar
      let avatarUrl = avatarData?.url || null;
      if (!avatarUrl && detail.discord_id) {
        try {
          const u = await client.users.fetch(detail.discord_id);
          avatarUrl = u.displayAvatarURL({ size: 128 });
        } catch (e) {}
      }

      const embed = new EmbedBuilder()
        .setTitle(`🏓 ${detail.name}`)
        .setColor(0x6c63ff)
        .addFields(
          { name: 'Rating',   value: `**${Math.round(detail.rating)}**`, inline: true },
          { name: 'Peak',     value: `**${peak}**`,                       inline: true },
          { name: 'Streak',   value: streakStr,                           inline: true },
          { name: 'Record',   value: `${detail.wins}W ${detail.losses}L`, inline: true },
          { name: 'Win Rate', value: `${detail.win_rate}%`,               inline: true },
          { name: '​',   value: '​',                            inline: true },
          { name: 'Recent Matches', value: matchLines.length ? matchLines.join('\n') : 'No matches yet.' }
        )
        .setImage(chartUrl)
        .setTimestamp();

      if (avatarUrl) embed.setThumbnail(avatarUrl);

      interaction.editReply({ embeds: [embed] });
    } catch (e) {
      console.error(e);
      interaction.editReply('Failed to fetch profile.');
    }
  }

  // ── /matches ───────────────────────────────────────────────────────────
  else if (commandName === 'matches') {
    try {
      const rows = await api('/api/matches');

      // Group into doubles games
      const seen = new Set();
      const games = [];
      for (const m of rows) {
        if (seen.has(m.id)) continue;
        const partner = rows.find(n =>
          !seen.has(n.id) && n.id !== m.id &&
          n.played_at === m.played_at &&
          n.winner_id !== m.winner_id && n.loser_id !== m.loser_id
        );
        games.push({ m, partner: partner || null });
        seen.add(m.id);
        if (partner) seen.add(partner.id);
        if (games.length === 10) break;
      }

      const lines = games.map(({ m, partner }) => {
        const winners = [m.winner_name, partner?.winner_name].filter(Boolean).join(' & ');
        const losers  = [m.loser_name,  partner?.loser_name ].filter(Boolean).join(' & ');
        const score = m.winner_score != null ? ` ${m.winner_score}-${m.loser_score}` : '';
        const date  = toLocalDate(m.played_at);
        return `**${winners}** def. **${losers}**${score} · ${date}`;
      });

      const embed = new EmbedBuilder()
        .setTitle('🏓 Recent Matches')
        .setDescription(lines.join('\n'))
        .setColor(0x6c63ff)
        .setTimestamp();

      interaction.editReply({ embeds: [embed] });
    } catch (e) {
      interaction.editReply('Failed to fetch matches.');
    }
  }
});

client.login(TOKEN);
