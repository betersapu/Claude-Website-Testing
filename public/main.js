async function fetchData() {
  const [rankingsRes, matchesRes] = await Promise.all([
    fetch('/api/rankings'),
    fetch('/api/matches'),
  ]);
  renderRankings(await rankingsRes.json());
  renderRecent(await matchesRes.json());
}

function renderRankings(players) {
  const container = document.getElementById('rankings-container');
  if (!players.length) {
    container.innerHTML = '<p class="empty-state">No players yet.</p>';
    return;
  }

  const rows = players.map((p, i) => {
    const rank = i + 1;
    const rankClass = rank <= 3 ? `rank-${rank}` : '';
    return `
      <tr>
        <td><span class="rank-num ${rankClass}">${rank}</span></td>
        <td><a href="/profile.html?id=${p.id}" class="player-link">${escHtml(p.name)}</a></td>
        <td><span class="rating-badge">${p.rating}</span></td>
        <td class="win-rate">${p.win_rate}%</td>
        <td class="text-muted">${p.wins}W – ${p.losses}L</td>
        <td>${p.wins + p.losses}</td>
      </tr>
    `;
  }).join('');

  container.innerHTML = `
    <table class="rankings-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Player</th>
          <th>Rating</th>
          <th>Win Rate</th>
          <th>Record</th>
          <th>Games</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

// Group the two stored rows per doubles game into single games, then show the most recent.
function renderRecent(matches) {
  const el = document.getElementById('recent-container');
  if (!matches.length) {
    el.innerHTML = '<p class="empty-state">No games played yet.</p>';
    return;
  }

  const grouped = [];
  const seen = new Set();
  for (const m of matches) {
    if (seen.has(m.id)) continue;
    const partner = matches.find(n =>
      n.id !== m.id && !seen.has(n.id) &&
      n.played_at === m.played_at &&
      n.winner_id !== m.winner_id && n.loser_id !== m.loser_id
    );
    if (partner) {
      grouped.push({ m, partner });
      seen.add(m.id); seen.add(partner.id);
    } else {
      grouped.push({ m, partner: null });
      seen.add(m.id);
    }
  }

  const recent = grouped.slice(0, 10);

  el.innerHTML = `
    <table class="rankings-table">
      <thead>
        <tr><th>Date</th><th>Winners</th><th>Score</th><th>Losers</th></tr>
      </thead>
      <tbody>
        ${recent.map(({ m, partner }) => {
          const w2 = partner ? `& <a href="/profile.html?id=${partner.winner_id}" class="player-link">${escHtml(partner.winner_name)}</a>` : '';
          const l2 = partner ? `& <a href="/profile.html?id=${partner.loser_id}" class="player-link">${escHtml(partner.loser_name)}</a>` : '';
          const scoreStr = (m.winner_score != null && m.loser_score != null)
            ? `<span class="match-score" style="font-size:0.85rem">${m.winner_score}–${m.loser_score}</span>`
            : '<span class="text-muted">—</span>';
          const date = formatDateTime(m.played_at);
          return `
            <tr>
              <td class="text-muted" style="white-space:nowrap">${date}</td>
              <td><a href="/profile.html?id=${m.winner_id}" class="player-link">${escHtml(m.winner_name)}</a> ${w2}</td>
              <td>${scoreStr}</td>
              <td><a href="/profile.html?id=${m.loser_id}" class="player-link">${escHtml(m.loser_name)}</a> ${l2}</td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
}

function escHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatDateTime(ts) {
  const d = new Date(ts.replace(' ', 'T') + 'Z');
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

fetchData();
