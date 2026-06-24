async function load() {
  const [playersRes, matchesRes] = await Promise.all([
    fetch('/api/rankings'),
    fetch('/api/matches'),
  ]);
  const players = await playersRes.json();
  const matches = await matchesRes.json();
  renderPlayers(players);
  renderMatches(matches);
}

function renderPlayers(players) {
  const el = document.getElementById('players-table');
  if (!players.length) {
    el.innerHTML = '<p class="empty-state">No players yet.</p>';
    return;
  }
  el.innerHTML = `
    <table class="rankings-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Rating</th>
          <th>Wins</th>
          <th>Losses</th>
          <th>Win Rate</th>
          <th>Games</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${players.map(p => `
          <tr>
            <td><a href="/profile.html?id=${p.id}" class="player-link">${escHtml(p.name)}</a></td>
            <td><span class="rating-badge">${p.rating}</span></td>
            <td>${p.wins}</td>
            <td>${p.losses}</td>
            <td class="win-rate">${p.win_rate}%</td>
            <td class="text-muted">${p.wins + p.losses}</td>
            <td style="display:flex;gap:0.4rem;align-items:center">
              <button class="btn-edit" onclick="openEdit(${p.id},'${escAttr(p.name)}',${p.rating},${p.wins},${p.losses})">Edit</button>
              <button class="btn-delete" onclick="confirmDelete('player',${p.id},'${escAttr(p.name)}')">✕</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function renderMatches(matches) {
  const el = document.getElementById('matches-table');
  if (!matches.length) {
    el.innerHTML = '<p class="empty-state">No matches recorded yet.</p>';
    return;
  }

  // Group paired rows (same played_at, partner match) into doubles games
  // Matches are stored as two rows per doubles game; group by timestamp
  const grouped = [];
  const seen = new Set();
  for (const m of matches) {
    if (seen.has(m.id)) continue;
    // Find the partner row: same timestamp, different players, winner of one is not in the other
    const partner = matches.find(n =>
      n.id !== m.id &&
      !seen.has(n.id) &&
      n.played_at === m.played_at &&
      n.winner_id !== m.winner_id &&
      n.loser_id !== m.loser_id
    );
    if (partner) {
      grouped.push({ ids: [m.id, partner.id], m, partner });
      seen.add(m.id);
      seen.add(partner.id);
    } else {
      grouped.push({ ids: [m.id], m, partner: null });
      seen.add(m.id);
    }
  }

  el.innerHTML = `
    <table class="rankings-table">
      <thead>
        <tr>
          <th>Date</th>
          <th>Winners</th>
          <th>Score</th>
          <th>Losers</th>
          <th>Rating Δ</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${grouped.map(({ ids, m, partner }) => {
          const w2 = partner ? `& <a href="/profile.html?id=${partner.winner_id}" class="player-link">${escHtml(partner.winner_name)}</a>` : '';
          const l2 = partner ? `& <a href="/profile.html?id=${partner.loser_id}" class="player-link">${escHtml(partner.loser_name)}</a>` : '';
          const scoreStr = (m.winner_score != null && m.loser_score != null)
            ? `<span class="match-score" style="font-size:0.85rem">${m.winner_score}–${m.loser_score}</span>`
            : '<span class="text-muted">—</span>';
          const delta = Math.round((m.winner_rating_after - m.winner_rating_before) * 10) / 10;
          const date = new Date(m.played_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
          return `
            <tr>
              <td class="text-muted" style="white-space:nowrap">${date}</td>
              <td>
                <a href="/profile.html?id=${m.winner_id}" class="player-link">${escHtml(m.winner_name)}</a>
                ${w2}
              </td>
              <td>${scoreStr}</td>
              <td>
                <a href="/profile.html?id=${m.loser_id}" class="player-link">${escHtml(m.loser_name)}</a>
                ${l2}
              </td>
              <td>
                <span class="delta-pair">
                  <span class="rating-change up">+${delta}</span>
                  <span class="rating-change down">−${Math.abs(Math.round((m.loser_rating_after - m.loser_rating_before) * 10) / 10)}</span>
                </span>
              </td>
              <td>
                <button class="btn-delete" onclick="confirmDelete('match',${JSON.stringify(ids)},'this match')">✕</button>
              </td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
}

// Edit player modal
function openEdit(id, name, rating, wins, losses) {
  document.getElementById('edit-id').value = id;
  document.getElementById('edit-name').value = name;
  document.getElementById('edit-rating').value = rating;
  document.getElementById('edit-wins').value = wins;
  document.getElementById('edit-losses').value = losses;
  document.getElementById('edit-modal').classList.add('show');
}

document.getElementById('edit-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('edit-id').value;
  const body = {
    name: document.getElementById('edit-name').value.trim(),
    rating: +document.getElementById('edit-rating').value,
    wins: +document.getElementById('edit-wins').value,
    losses: +document.getElementById('edit-losses').value,
  };
  const res = await fetch(`/api/players/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) return showToast(data.error, 'error');
  document.getElementById('edit-modal').classList.remove('show');
  showToast('Player updated', 'success');
  load();
});

document.getElementById('edit-cancel').addEventListener('click', () => {
  document.getElementById('edit-modal').classList.remove('show');
});

// Delete confirm modal
let pendingDelete = null;

function confirmDelete(type, id, label) {
  pendingDelete = { type, id };
  const msg = type === 'player'
    ? `Delete ${label}? This will also remove all their match history.`
    : `Delete this match? Player ratings and records will be reversed.`;
  document.getElementById('modal-msg').textContent = msg;
  document.getElementById('confirm-modal').classList.add('show');
}

document.getElementById('modal-confirm').addEventListener('click', async () => {
  if (!pendingDelete) return;
  document.getElementById('confirm-modal').classList.remove('show');
  const { type, id } = pendingDelete;
  pendingDelete = null;

  if (type === 'player') {
    const res = await fetch(`/api/players/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) return showToast(data.error, 'error');
    showToast('Player deleted', 'success');
  } else {
    // id is an array of match row ids
    const ids = Array.isArray(id) ? id : [id];
    for (const mid of ids) {
      await fetch(`/api/matches/${mid}`, { method: 'DELETE' });
    }
    showToast('Match deleted', 'success');
  }
  load();
});

document.getElementById('modal-cancel').addEventListener('click', () => {
  pendingDelete = null;
  document.getElementById('confirm-modal').classList.remove('show');
});

[document.getElementById('confirm-modal'), document.getElementById('edit-modal')].forEach(el => {
  el.addEventListener('click', (e) => {
    if (e.target === el) {
      pendingDelete = null;
      el.classList.remove('show');
    }
  });
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

function escAttr(str) {
  return String(str).replace(/'/g, "\\'");
}

load();
