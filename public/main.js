let players = [];

async function fetchRankings() {
  const res = await fetch('/api/rankings');
  players = await res.json();
  renderRankings(players);
  populateSelects(players);
}

function renderRankings(players) {
  const container = document.getElementById('rankings-container');
  if (!players.length) {
    container.innerHTML = '<p class="empty-state">No players yet. Add some players to get started!</p>';
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
        <td>
          <button class="btn-delete" onclick="confirmDelete(${p.id}, '${escHtml(p.name)}')" title="Delete player">✕</button>
        </td>
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
          <th></th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function populateSelects(players) {
  const ids = ['winner1', 'winner2', 'loser1', 'loser2'];
  const saved = Object.fromEntries(ids.map(id => [id, document.getElementById(id).value]));
  const opts = players.map(p => `<option value="${p.id}">${escHtml(p.name)}</option>`).join('');
  ids.forEach(id => {
    document.getElementById(id).innerHTML = `<option value="">Select player…</option>${opts}`;
    if (saved[id]) document.getElementById(id).value = saved[id];
  });
}

document.getElementById('match-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const w1 = +document.getElementById('winner1').value;
  const w2 = +document.getElementById('winner2').value;
  const l1 = +document.getElementById('loser1').value;
  const l2 = +document.getElementById('loser2').value;

  if (!w1 || !w2 || !l1 || !l2) return showToast('Select all four players', 'error');
  const all = [w1, w2, l1, l2];
  if (new Set(all).size !== 4) return showToast('All four players must be different', 'error');

  const ws = document.getElementById('winner-score').value;
  const ls = document.getElementById('loser-score').value;

  const res = await fetch('/api/matches', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ winner_ids: [w1, w2], loser_ids: [l1, l2], winner_score: ws, loser_score: ls }),
  });

  const data = await res.json();
  if (!res.ok) return showToast(data.error, 'error');

  const wNames = data.winners.map(p => p.name).join(' & ');
  const lNames = data.losers.map(p => p.name).join(' & ');
  showToast(`${wNames} beat ${lNames}`, 'success');
  document.getElementById('match-form').reset();
  fetchRankings();
});

document.getElementById('add-player-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('player-name').value.trim();
  if (!name) return;

  const res = await fetch('/api/players', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });

  const data = await res.json();
  if (!res.ok) return showToast(data.error, 'error');

  showToast(`${name} added!`, 'success');
  document.getElementById('player-name').value = '';
  fetchRankings();
});

// Delete player with confirmation modal
let pendingDeleteId = null;

function confirmDelete(id, name) {
  pendingDeleteId = id;
  document.getElementById('modal-msg').textContent = `Delete ${name}? This will also remove all their match history.`;
  document.getElementById('confirm-modal').classList.add('show');
}

document.getElementById('modal-confirm').addEventListener('click', async () => {
  if (!pendingDeleteId) return;
  document.getElementById('confirm-modal').classList.remove('show');

  const res = await fetch(`/api/players/${pendingDeleteId}`, { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok) return showToast(data.error, 'error');

  showToast('Player deleted', 'success');
  pendingDeleteId = null;
  fetchRankings();
});

document.getElementById('modal-cancel').addEventListener('click', () => {
  pendingDeleteId = null;
  document.getElementById('confirm-modal').classList.remove('show');
});

document.getElementById('confirm-modal').addEventListener('click', (e) => {
  if (e.target === document.getElementById('confirm-modal')) {
    pendingDeleteId = null;
    document.getElementById('confirm-modal').classList.remove('show');
  }
});

function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast ${type} show`;
  setTimeout(() => { t.className = 'toast'; }, 3500);
}

function escHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

fetchRankings();
