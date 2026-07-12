// ---- Auth / password gate ----
let adminPassword = sessionStorage.getItem('adminPassword') || null;

async function verifyPassword(pw) {
  const res = await fetch('/api/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-password': pw },
  });
  return res.ok;
}

function showPanel() {
  document.getElementById('gate').style.display = 'none';
  document.getElementById('panel').style.display = 'block';
  load();
}

function showGate() {
  document.getElementById('panel').style.display = 'none';
  document.getElementById('gate').style.display = 'block';
  document.getElementById('gate-password').value = '';
}

// Auto-unlock if a valid password is already stored this session
(async function init() {
  if (adminPassword && await verifyPassword(adminPassword)) {
    showPanel();
  } else {
    adminPassword = null;
    sessionStorage.removeItem('adminPassword');
    showGate();
  }
})();

document.getElementById('gate-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pw = document.getElementById('gate-password').value;
  const errEl = document.getElementById('gate-error');
  errEl.textContent = '';

  if (await verifyPassword(pw)) {
    adminPassword = pw;
    sessionStorage.setItem('adminPassword', pw);
    showPanel();
  } else {
    errEl.textContent = 'Incorrect password.';
    document.getElementById('gate-password').value = '';
  }
});

document.getElementById('lock-btn').addEventListener('click', () => {
  adminPassword = null;
  sessionStorage.removeItem('adminPassword');
  showGate();
});

// Download a backup copy of the live database
document.getElementById('export-btn').addEventListener('click', async () => {
  try {
    const res = await fetch('/api/export', { headers: { 'x-admin-password': adminPassword || '' } });
    if (!res.ok) {
      if (res.status === 401) { showToast('Session expired — please unlock again', 'error'); showGate(); }
      else showToast('Export failed', 'error');
      return;
    }
    const blob = await res.blob();
    const stamp = new Date().toISOString().slice(0, 10);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `elo-backup-${stamp}.db`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('Backup downloaded', 'success');
  } catch (e) {
    showToast('Export failed', 'error');
  }
});

// Wrapper that attaches the admin password to every mutating request
async function adminFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), 'x-admin-password': adminPassword || '' },
  });
  if (res.status === 401) {
    showToast('Session expired — please unlock again', 'error');
    showGate();
  }
  return res;
}

// ---- Data loading ----
async function load() {
  const [playersRes, matchesRes] = await Promise.all([
    fetch('/api/rankings'),
    fetch('/api/matches'),
  ]);
  const players = await playersRes.json();
  const matches = await matchesRes.json();
  renderPlayers(players);
  renderMatches(matches);
  populateSelects(players);
}

// ---- Win probability ----
let _playersCache = [];

// Glicko-2 expected score: E = 1 / (1 + exp(-g(RD) * (r1 - r2) / 400))
function glickoExpected(r1, rd1, r2, rd2) {
  const g = rd => 1 / Math.sqrt(1 + 3 * rd * rd / (Math.PI * Math.PI * 400 * 400));
  return 1 / (1 + Math.exp(-g(Math.sqrt(rd1 * rd1 + rd2 * rd2)) * (r1 - r2) / 400));
}

function updateProbBar() {
  const row = document.getElementById('prob-row');
  const winners = selectedIds('W');
  const losers  = selectedIds('L');

  if (winners.length !== 2 || losers.length !== 2) { row.style.display = 'none'; return; }

  const byId = Object.fromEntries(_playersCache.map(p => [p.id, p]));
  const [w1, w2] = winners.map(id => byId[id]);
  const [l1, l2] = losers.map(id => byId[id]);
  if (!w1 || !w2 || !l1 || !l2) { row.style.display = 'none'; return; }

  // Average team ratings/RDs
  const wRating = (w1.rating + w2.rating) / 2;
  const wRd     = Math.sqrt((w1.rd * w1.rd + w2.rd * w2.rd) / 2);
  const lRating = (l1.rating + l2.rating) / 2;
  const lRd     = Math.sqrt((l1.rd * l1.rd + l2.rd * l2.rd) / 2);

  const winProb = Math.round(glickoExpected(wRating, wRd, lRating, lRd) * 100);
  const lossProb = 100 - winProb;

  document.getElementById('prob-win').style.width  = `${winProb}%`;
  document.getElementById('prob-loss').style.width = `${lossProb}%`;
  document.getElementById('prob-win-label').textContent  = winProb  > 15 ? `${winProb}%`  : '';
  document.getElementById('prob-loss-label').textContent = lossProb > 15 ? `${lossProb}%` : '';
  row.style.display = 'block';
}

// ---- Tap-to-assign player chips ----
// chipState maps a player id -> 'W' (winner) or 'L' (loser). Absent = unselected.
let chipState = {};

function selectedIds(team) {
  return Object.keys(chipState).filter(id => chipState[id] === team).map(Number);
}

// Tap cycles a chip: unselected -> Winner -> Loser -> unselected, respecting the 2-per-team cap.
function cycleChip(id) {
  const cur = chipState[id] || null;
  const winners = selectedIds('W').length;
  const losers  = selectedIds('L').length;

  if (cur === null) {
    if (winners < 2) chipState[id] = 'W';
    else if (losers < 2) chipState[id] = 'L';
    else showToast('Both teams are full', 'error');
  } else if (cur === 'W') {
    if (losers < 2) chipState[id] = 'L';
    else delete chipState[id];
  } else {
    delete chipState[id];
  }
  renderChips();
  updateProbBar();
}

function renderChips() {
  const grid = document.getElementById('chip-grid');
  if (!grid) return;
  const sorted = [..._playersCache].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

  grid.innerHTML = sorted.map(p => {
    const st = chipState[p.id];
    const cls = st === 'W' ? 'is-winner' : st === 'L' ? 'is-loser' : '';
    const tag = st ? `<span class="chip-tag">${st}</span>` : '';
    return `<button type="button" class="player-chip ${cls}" data-id="${p.id}">${escHtml(p.name)}${tag}</button>`;
  }).join('');

  grid.querySelectorAll('.player-chip').forEach(el =>
    el.addEventListener('click', () => cycleChip(+el.dataset.id)));

  renderSummary();
}

function renderSummary() {
  const byId = Object.fromEntries(_playersCache.map(p => [p.id, p]));
  const names = ids => ids.map(id => escHtml(byId[id]?.name || '')).join(' & ') || '—';
  document.getElementById('chip-summary').innerHTML =
    `<span class="sum-team win">${names(selectedIds('W'))}</span>` +
    `<span class="sum-vs">vs</span>` +
    `<span class="sum-team loss">${names(selectedIds('L'))}</span>`;
}

// Renders the roster into tappable chips (replaces the old dropdowns).
function populateSelects(players) {
  _playersCache = players;
  // Drop selections for players that no longer exist
  for (const id of Object.keys(chipState)) {
    if (!players.some(p => p.id === +id)) delete chipState[id];
  }
  renderChips();
  updateProbBar();
}

document.getElementById('match-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const winners = selectedIds('W');
  const losers  = selectedIds('L');

  if (winners.length !== 2 || losers.length !== 2)
    return showToast('Pick 2 winners and 2 losers', 'error');

  const ws = document.getElementById('winner-score').value;
  const ls = document.getElementById('loser-score').value;

  const res = await adminFetch('/api/matches', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ winner_ids: winners, loser_ids: losers, winner_score: ws, loser_score: ls }),
  });
  const data = await res.json();
  if (!res.ok) return showToast(data.error, 'error');

  const wNames = data.winners.map(p => p.name).join(' & ');
  const lNames = data.losers.map(p => p.name).join(' & ');
  showToast(`${wNames} beat ${lNames}`, 'success');
  chipState = {};
  document.getElementById('match-form').reset();
  load();
});

// ---- Add player ----
document.getElementById('add-player-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('player-name').value.trim();
  if (!name) return;

  const res = await adminFetch('/api/players', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  const data = await res.json();
  if (!res.ok) return showToast(data.error, 'error');

  showToast(`${name} added!`, 'success');
  document.getElementById('player-name').value = '';
  load();
});

// ---- Players table ----
function renderPlayers(players) {
  const el = document.getElementById('players-table');
  if (!players.length) {
    el.innerHTML = '<p class="empty-state">No players yet.</p>';
    return;
  }
  el.innerHTML = `
    <table class="rankings-table">
      <thead>
        <tr><th>Name</th><th>Rating</th><th>Wins</th><th>Losses</th><th>Win Rate</th><th>Games</th><th></th></tr>
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

// ---- Match history table ----
function renderMatches(matches) {
  const el = document.getElementById('matches-table');
  if (!matches.length) {
    el.innerHTML = '<p class="empty-state">No matches recorded yet.</p>';
    return;
  }

  const grouped = [];
  const seen = new Set();
  for (const m of matches) {
    if (m.type === 'decay') { grouped.push({ decay: m }); continue; }
    if (seen.has(m.id)) continue;
    const partner = matches.find(n =>
      n.type !== 'decay' && n.id !== m.id && !seen.has(n.id) &&
      n.played_at === m.played_at &&
      n.winner_id !== m.winner_id && n.loser_id !== m.loser_id
    );
    if (partner) {
      grouped.push({ ids: [m.id, partner.id], m, partner });
      seen.add(m.id); seen.add(partner.id);
    } else {
      grouped.push({ ids: [m.id], m, partner: null });
      seen.add(m.id);
    }
  }

  el.innerHTML = `
    <table class="rankings-table">
      <thead>
        <tr><th>Date</th><th>Winners</th><th>Score</th><th>Losers</th><th>Rating Δ</th><th></th></tr>
      </thead>
      <tbody>
        ${grouped.map((g) => {
          if (g.decay) {
            const d = g.decay;
            return `
            <tr>
              <td class="text-muted" style="white-space:nowrap">${formatDateTime(d.played_at)}</td>
              <td colspan="3"><span class="decay-tag">💤 Inactivity</span> — <a href="/profile.html?id=${d.player_id}" class="player-link">${escHtml(d.player_name)}</a></td>
              <td><span class="rating-change down">${d.amount}</span></td>
              <td></td>
            </tr>`;
          }
          const { ids, m, partner } = g;
          const w2 = partner ? `& <a href="/profile.html?id=${partner.winner_id}" class="player-link">${escHtml(partner.winner_name)}</a>` : '';
          const l2 = partner ? `& <a href="/profile.html?id=${partner.loser_id}" class="player-link">${escHtml(partner.loser_name)}</a>` : '';
          const scoreStr = (m.winner_score != null && m.loser_score != null)
            ? `<span class="match-score" style="font-size:0.85rem">${m.winner_score}–${m.loser_score}</span>`
            : '<span class="text-muted">—</span>';
          const delta = Math.round((m.winner_rating_after - m.winner_rating_before) * 10) / 10;
          const date = formatDateTime(m.played_at);
          return `
            <tr>
              <td class="text-muted" style="white-space:nowrap">${date}</td>
              <td><a href="/profile.html?id=${m.winner_id}" class="player-link">${escHtml(m.winner_name)}</a> ${w2}</td>
              <td>${scoreStr}</td>
              <td><a href="/profile.html?id=${m.loser_id}" class="player-link">${escHtml(m.loser_name)}</a> ${l2}</td>
              <td>
                <span class="delta-pair">
                  <span class="rating-change up">+${delta}</span>
                  <span class="rating-change down">−${Math.abs(Math.round((m.loser_rating_after - m.loser_rating_before) * 10) / 10)}</span>
                </span>
              </td>
              <td><button class="btn-delete" onclick="confirmDelete('match',${JSON.stringify(ids)},'this match')">✕</button></td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
}

// ---- Edit player modal ----
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
  const res = await adminFetch(`/api/players/${id}`, {
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

// ---- Delete confirm modal ----
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
    const res = await adminFetch(`/api/players/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) return showToast(data.error, 'error');
    showToast('Player deleted', 'success');
  } else {
    const ids = Array.isArray(id) ? id : [id];
    for (const mid of ids) {
      await adminFetch(`/api/matches/${mid}`, { method: 'DELETE' });
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

// ---- Helpers ----
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

function formatDateTime(ts) {
  const d = new Date(ts.replace(' ', 'T') + 'Z');
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}
