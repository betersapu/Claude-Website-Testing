const params = new URLSearchParams(location.search);
const playerId = params.get('id');

if (!playerId) {
  document.getElementById('profile-content').innerHTML = '<p class="empty-state">No player specified.</p>';
} else {
  loadProfile();
}

async function loadProfile() {
  const [playerRes, historyRes, matchesRes, partnersRes, activityRes] = await Promise.all([
    fetch(`/api/players/${playerId}`),
    fetch(`/api/players/${playerId}/history`),
    fetch(`/api/players/${playerId}/matches`),
    fetch(`/api/players/${playerId}/partners`),
    fetch(`/api/players/${playerId}/activity`),
  ]);

  if (!playerRes.ok) {
    document.getElementById('profile-content').innerHTML = '<p class="empty-state">Player not found.</p>';
    return;
  }

  const player = await playerRes.json();
  const history = await historyRes.json();
  const matches = await matchesRes.json();
  const partners = await partnersRes.json();
  const activity = await activityRes.json();

  document.title = `${player.name} – Pickleball ELO`;

  const rankRes = await fetch('/api/rankings');
  const rankings = await rankRes.json();
  const rank = rankings.findIndex(p => p.id === player.id) + 1;

  renderProfile(player, rank, history, matches, partners, activity);
}

function computeBadges(player, rank, matches, history) {
  const badges = [];
  const total = player.wins + player.losses;

  // Result sequence newest→oldest
  const results = matches.map(m => m.winner_id === player.id ? 'W' : 'L');

  // 🔥 Hot streak / ❄️ Cold streak
  const streak = player.streak || 0;
  if (streak >= 3)  badges.push({ label: `🔥 ${streak}-Win Streak`,          cls: 'badge-hot',     tip: `On a ${streak}-game winning streak` });
  if (streak <= -3) badges.push({ label: `❄️ ${Math.abs(streak)}-Loss Streak`, cls: 'badge-cold',    tip: `On a ${Math.abs(streak)}-game losing streak` });

  // 👑 Top Dog
  if (rank === 1) badges.push({ label: '👑 Top Dog', cls: 'badge-gold', tip: 'Currently ranked #1' });

  // Chain wins / tilts (win-after-win rate)
  let waw = 0, wawTotal = 0, wal = 0, walTotal = 0;
  for (let i = 0; i < results.length - 1; i++) {
    if (results[i + 1] === 'W') { wawTotal++; if (results[i] === 'W') waw++; }
    else                         { walTotal++; if (results[i] === 'W') wal++; }
  }
  if (wawTotal >= 4) {
    const rate = waw / wawTotal;
    if (rate >= 0.60) badges.push({ label: '🔗 Chain Wins', cls: 'badge-chain', tip: `Wins ${Math.round(rate * 100)}% of games after a win` });
    if (rate <= 0.40) badges.push({ label: '📉 Tilts',      cls: 'badge-tilt',  tip: `Only wins ${Math.round(rate * 100)}% of games after a win` });
  }

  // 💪 Bounce Back
  if (walTotal >= 4 && wal / walTotal >= 0.60)
    badges.push({ label: '💪 Bounce Back', cls: 'badge-bounce', tip: `Wins ${Math.round(wal / walTotal * 100)}% of games after a loss` });

  // 📈 Rising / 📉 Falling
  if (history.length >= 3) {
    const gained = player.rating - history[0].rating_before;
    if (gained >= 50)  badges.push({ label: '📈 Rising',  cls: 'badge-rising',  tip: `Gained ${Math.round(gained)} rating in the last 30 days` });
    if (gained <= -50) badges.push({ label: '📉 Falling', cls: 'badge-falling', tip: `Lost ${Math.round(Math.abs(gained))} rating in the last 30 days` });
  }

  // 🏆 Veteran
  if (total >= 50) badges.push({ label: '🏆 Veteran', cls: 'badge-vet', tip: `Played ${total} total games` });

  return badges;
}

function renderProfile(player, rank, history, matches, partners, activity) {
  const rankLabel = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`;

  const badges = computeBadges(player, rank, matches, history);
  const badgesHtml = badges.length
    ? `<div class="player-badges" style="margin-bottom:1.5rem">
        ${badges.map(b => `<span class="player-badge ${b.cls}" data-tip="${b.tip}">${b.label}</span>`).join('')}
      </div>`
    : '';

  document.getElementById('profile-content').innerHTML = `
    <div class="profile-header">
      <div>
        <h1>${escHtml(player.name)}</h1>
        <h2>Rank ${rankLabel}</h2>
      </div>
    </div>

    ${badgesHtml}

    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-value">${Math.round(player.rating)}</div>
        <div class="stat-label">ELO Rating</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" style="color:var(--gold)">${player.peak_rating ? Math.round(player.peak_rating) : Math.round(player.rating)}</div>
        <div class="stat-label">Peak Rating</div>
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
      ${(() => {
        const fav = partners.length
          ? partners.reduce((best, p) => p.wins > best.wins ? p : best)
          : null;
        return fav
          ? `<div class="stat-card">
              <div class="stat-value" style="font-size:1.1rem;line-height:1.3">
                <a href="/profile.html?id=${fav.partner_id}" class="player-link">${escHtml(fav.partner_name)}</a>
              </div>
              <div class="stat-label">Fav. Partner</div>
            </div>`
          : `<div class="stat-card">
              <div class="stat-value text-muted">—</div>
              <div class="stat-label">Fav. Partner</div>
            </div>`;
      })()}
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

    <div class="grid-2" style="margin-top:1.5rem">
      <div class="card">
        ${renderActivity(activity)}
      </div>
      <div class="card">
        <h3>Partner Stats</h3>
        ${renderPartners(partners)}
      </div>
    </div>
  `;

  renderChart(player, history);
}

function renderActivity(activity) {
  const map = {};
  let totalGames = 0;
  for (const r of activity) {
    const localDay = new Date(r.played_at.replace(' ', 'T') + 'Z')
      .toLocaleDateString('en-CA'); // YYYY-MM-DD in local timezone
    if (!map[localDay]) map[localDay] = { wins: 0, losses: 0 };
    if (r.won) map[localDay].wins++;
    else map[localDay].losses++;
    totalGames++;
  }

  const CELL = 12, GAP = 3, COL = CELL + GAP;

  function cellBg(wins, losses) {
    const n = wins + losses;
    if (!n) return '';
    const wr = wins / n;
    const a = Math.min(0.95, 0.3 + n * 0.22).toFixed(2);
    if (wr >= 0.6) return `rgba(0,212,170,${a})`;
    if (wr <= 0.4) return `rgba(255,83,112,${a})`;
    return `rgba(108,99,255,${a})`;
  }

  const today = new Date();
  today.setHours(23, 59, 59, 999);
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 119);
  startDate.setHours(0, 0, 0, 0);
  startDate.setDate(startDate.getDate() - startDate.getDay()); // back to Sunday

  const weeks = [];
  const monthSpans = [];
  let lastMonth = -1;
  const d = new Date(startDate);

  while (d <= today) {
    const weekStart = new Date(d);
    const mon = weekStart.getMonth();
    if (mon !== lastMonth) {
      monthSpans.push({ label: weekStart.toLocaleString('en-US', { month: 'short' }), cols: 1 });
      lastMonth = mon;
    } else {
      monthSpans[monthSpans.length - 1].cols++;
    }

    const week = [];
    for (let i = 0; i < 7; i++) {
      const ds = d.toISOString().slice(0, 10);
      week.push({ ds, future: d > today, ...(map[ds] || { wins: 0, losses: 0 }) });
      d.setDate(d.getDate() + 1);
    }
    weeks.push(week);
  }

  const monthRow = monthSpans.map(m =>
    `<div style="width:${m.cols * COL}px;font-size:0.65rem;color:var(--text-muted);overflow:hidden;white-space:nowrap">${m.label}</div>`
  ).join('');

  const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const dayLabels = dayNames.map(n => `<div class="ah-day-label">${n}</div>`).join('');

  const grid = weeks.map(week => {
    const cells = week.map(({ ds, future, wins, losses }) => {
      if (future) return `<div class="ah-cell" style="opacity:0"></div>`;
      const bg = cellBg(wins, losses);
      const n = wins + losses;
      const tip = n ? `${ds}: ${wins}W ${losses}L` : ds;
      return `<div class="ah-cell"${bg ? ` style="background:${bg}"` : ''} title="${tip}"></div>`;
    }).join('');
    return `<div class="ah-week">${cells}</div>`;
  }).join('');

  const legendSamples = [{w:0,l:0},{w:0,l:1},{w:1,l:1},{w:1,l:0},{w:3,l:0}];
  const legend = legendSamples.map(({w,l}) => {
    const bg = cellBg(w, l);
    return `<div class="ah-cell"${bg ? ` style="background:${bg}"` : ''}></div>`;
  }).join('');

  // Side stats
  const activeDays = Object.keys(map).length;
  const now = new Date();
  const thisMonthStr = now.toLocaleDateString('en-CA').slice(0, 7); // "YYYY-MM" local
  const monthName = now.toLocaleString('en-US', { month: 'long' });
  let monthWins = 0, monthLosses = 0;
  for (const [day, data] of Object.entries(map)) {
    if (day.startsWith(thisMonthStr)) { monthWins += data.wins; monthLosses += data.losses; }
  }

  return `
    <div class="activity-heatmap">
      <div class="ah-header">
        <span class="ah-title">Recent Activity</span>
        <span class="text-muted" style="font-size:0.8rem">Last 120 Days · ${totalGames} games</span>
      </div>
      <div class="ah-body">
        <div class="ah-day-labels">${dayLabels}</div>
        <div class="ah-scroll">
          <div class="ah-months">${monthRow}</div>
          <div class="ah-grid">${grid}</div>
        </div>
        <div class="ah-side-stats">
          <div class="ah-side-stat">
            <div class="ah-side-value">${activeDays}</div>
            <div class="ah-side-label">Active Days</div>
          </div>
          <div class="ah-side-stat">
            <div class="ah-side-value" style="font-size:0.95rem">${monthWins}W – ${monthLosses}L</div>
            <div class="ah-side-label">${monthName}</div>
          </div>
        </div>
      </div>
      <div class="ah-footer">
        <span style="font-size:0.75rem;color:var(--text-muted)">🟢 win day &nbsp;🔴 loss day &nbsp;🟣 mixed</span>
        <span class="ah-legend"><span style="font-size:0.75rem;color:var(--text-muted)">less</span>${legend}<span style="font-size:0.75rem;color:var(--text-muted)">more</span></span>
      </div>
    </div>
  `;
}

function renderPartners(partners) {
  if (!partners.length) return '<p class="empty-state">No partner data yet.</p>';
  const rows = partners.map(p => {
    const total = p.wins + p.losses;
    const wr = Math.round(p.wins * 100 / total);
    const formColor = wr >= 60 ? 'var(--win)' : wr <= 40 ? 'var(--loss)' : 'var(--text)';
    return `
      <tr>
        <td><a href="/profile.html?id=${p.partner_id}" class="player-link">${escHtml(p.partner_name)}</a></td>
        <td>${p.wins}W – ${p.losses}L</td>
        <td>${total}</td>
        <td style="color:${formColor};font-weight:600">${wr}%</td>
      </tr>`;
  }).join('');
  return `
    <table class="rankings-table">
      <thead>
        <tr><th>Partner</th><th>Record</th><th>Games</th><th>Win Rate</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderMatches(matches, playerId) {
  if (!matches.length) return '<p class="empty-state">No matches yet.</p>';

  return matches.map(m => {
    const won = m.winner_id === playerId;
    const ratingBefore = won ? m.winner_rating_before : m.loser_rating_before;
    const ratingAfter  = won ? m.winner_rating_after  : m.loser_rating_after;
    const delta = Math.round((ratingAfter - ratingBefore) * 10) / 10;
    const deltaStr = delta >= 0 ? `+${delta}` : `${delta}`;
    const date = formatDateTime(m.played_at);
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
    // Start point: rating before the first match in the window
    labels.push('Start');
    data.push(history[0].rating_before);

    history.forEach(h => {
      labels.push(formatDateTime(h.played_at));
      data.push(h.rating);
    });
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

// Stored timestamps are UTC ("YYYY-MM-DD HH:MM:SS"); parse as UTC, display local date + time
function formatDateTime(ts) {
  const d = new Date(ts.replace(' ', 'T') + 'Z');
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
