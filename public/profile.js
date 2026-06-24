const params = new URLSearchParams(location.search);
const playerId = params.get('id');

if (!playerId) {
  document.getElementById('profile-content').innerHTML = '<p class="empty-state">No player specified.</p>';
} else {
  loadProfile();
}

async function loadProfile() {
  const [playerRes, historyRes, matchesRes] = await Promise.all([
    fetch(`/api/players/${playerId}`),
    fetch(`/api/players/${playerId}/history`),
    fetch(`/api/players/${playerId}/matches`),
  ]);

  if (!playerRes.ok) {
    document.getElementById('profile-content').innerHTML = '<p class="empty-state">Player not found.</p>';
    return;
  }

  const player = await playerRes.json();
  const history = await historyRes.json();
  const matches = await matchesRes.json();

  document.title = `${player.name} – Pickleball ELO`;

  const rankRes = await fetch('/api/rankings');
  const rankings = await rankRes.json();
  const rank = rankings.findIndex(p => p.id === player.id) + 1;

  renderProfile(player, rank, history, matches);
}

function renderProfile(player, rank, history, matches) {
  const initials = player.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  const rankLabel = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`;

  document.getElementById('profile-content').innerHTML = `
    <div class="profile-header">
      <div class="avatar">${initials}</div>
      <div>
        <h1>${escHtml(player.name)}</h1>
        <h2>Rank ${rankLabel}</h2>
      </div>
    </div>

    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-value">${player.rating}</div>
        <div class="stat-label">ELO Rating</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" style="color:var(--win)">${player.win_rate}%</div>
        <div class="stat-label">Win Rate</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${player.wins}</div>
        <div class="stat-label">Wins</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" style="color:var(--loss)">${player.losses}</div>
        <div class="stat-label">Losses</div>
      </div>
    </div>

    <div class="grid-2">
      <div class="card">
        <h3>Rating History (Last 30 Days)</h3>
        <div class="chart-container">
          <canvas id="rating-chart"></canvas>
        </div>
      </div>

      <div class="card">
        <h3>Recent Matches</h3>
        <div id="matches-list">${renderMatches(matches, player.id)}</div>
      </div>
    </div>
  `;

  renderChart(player, history);
}

function renderMatches(matches, playerId) {
  if (!matches.length) return '<p class="empty-state">No matches yet.</p>';

  return matches.map(m => {
    const won = m.winner_id === playerId;
    const ratingBefore = won ? m.winner_rating_before : m.loser_rating_before;
    const ratingAfter  = won ? m.winner_rating_after  : m.loser_rating_after;
    const delta = Math.round((ratingAfter - ratingBefore) * 10) / 10;
    const deltaStr = delta >= 0 ? `+${delta}` : `${delta}`;
    const date = new Date(m.played_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const scoreStr = (m.winner_score != null && m.loser_score != null)
      ? `<span class="match-score">${won ? m.winner_score : m.loser_score}–${won ? m.loser_score : m.winner_score}</span>`
      : '';

    // Build team arrays from the two match rows joined together
    const myTeam = won
      ? [{ id: m.winner_id, name: m.winner_name }, m.partner_winner_id ? { id: m.partner_winner_id, name: m.partner_winner_name } : null]
      : [{ id: m.loser_id,  name: m.loser_name  }, m.partner_loser_id  ? { id: m.partner_loser_id,  name: m.partner_loser_name  } : null];
    const oppTeam = won
      ? [{ id: m.loser_id,  name: m.loser_name  }, m.partner_loser_id  ? { id: m.partner_loser_id,  name: m.partner_loser_name  } : null]
      : [{ id: m.winner_id, name: m.winner_name }, m.partner_winner_id ? { id: m.partner_winner_id, name: m.partner_winner_name } : null];

    const renderPlayer = (p) => {
      if (!p) return '';
      const isMe = p.id === playerId;
      return `<a href="/profile.html?id=${p.id}" class="team-player ${isMe ? 'team-player-me' : ''}">${escHtml(p.name)}</a>`;
    };

    const myStr  = myTeam.filter(Boolean).map(renderPlayer).join('<span class="team-amp"> & </span>');
    const oppStr = oppTeam.filter(Boolean).map(renderPlayer).join('<span class="team-amp"> & </span>');

    return `
      <div class="match-item">
        <div class="match-item-left">
          <span class="match-result ${won ? 'win' : 'loss'}">${won ? 'WIN' : 'LOSS'}</span>
          ${scoreStr}
          <span class="match-teams">${myStr}<span class="team-vs-text"> vs </span>${oppStr}</span>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <span class="rating-change ${delta >= 0 ? 'up' : 'down'}">${deltaStr}</span>
          <span class="text-muted" style="margin-left:0.6rem;font-size:0.78rem">${date}</span>
        </div>
      </div>
    `;
  }).join('');
}

function renderChart(player, history) {
  const ctx = document.getElementById('rating-chart').getContext('2d');

  // Build chart data: start point + each match result
  const labels = [];
  const data = [];

  if (history.length === 0) {
    labels.push('Now');
    data.push(player.rating);
  } else {
    // Add a "start" point showing rating before first match in range
    const firstMatch = history[0];
    labels.push('');
    data.push(null); // placeholder filled below

    history.forEach((h, i) => {
      const d = new Date(h.played_at);
      labels.push(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
      data.push(h.rating);
    });

    // Fill the first placeholder with a reasonable start (extrapolated)
    data[0] = data[1] ?? player.rating;
  }

  new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'ELO Rating',
        data,
        borderColor: '#6c63ff',
        backgroundColor: 'rgba(108,99,255,0.12)',
        borderWidth: 2.5,
        pointBackgroundColor: '#6c63ff',
        pointRadius: 4,
        pointHoverRadius: 6,
        tension: 0.3,
        fill: true,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => ` Rating: ${ctx.parsed.y}`,
          },
        },
      },
      scales: {
        x: {
          ticks: { color: '#7b82a8', font: { size: 11 } },
          grid: { color: '#2e3248' },
        },
        y: {
          ticks: { color: '#7b82a8', font: { size: 11 } },
          grid: { color: '#2e3248' },
        },
      },
    },
  });
}

function escHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
