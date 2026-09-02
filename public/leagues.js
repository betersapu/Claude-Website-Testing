async function loadLeagues() {
  const res = await fetch('/api/leagues');
  const leagues = await res.json();
  const active = leagues.filter(l => l.status === 'active');
  renderActive(active);
}

function renderActive(leagues) {
  const el = document.getElementById('active-leagues');
  if (!leagues.length) {
    el.innerHTML = `<div class="card"><p class="empty-state">No active leagues yet. Click <strong>+ New League</strong> to start one.</p></div>`;
    return;
  }
  el.innerHTML = `<div class="league-grid">${leagues.map(leagueCard).join('')}</div>`;
}

function leagueCard(l) {
  const top = l.top_players && l.top_players.length
    ? l.top_players.map((p, i) =>
        `<div class="league-top-row"><span class="league-top-rank">${i + 1}</span>
         <span class="league-top-name">${escHtml(p.name)}</span>
         <span class="rating-badge">${p.rating}</span></div>`).join('')
    : `<p class="empty-state" style="padding:0.5rem 0">No players yet.</p>`;
  return `
    <a href="/league.html?id=${l.id}" class="card league-card">
      <div class="league-card-head">
        <h3 style="margin:0;text-transform:none;letter-spacing:0;font-size:1.1rem;color:var(--text)">${escHtml(l.name)}</h3>
        <span class="league-badge active">Active</span>
      </div>
      ${l.description ? `<p class="league-desc">${escHtml(l.description)}</p>` : ''}
      <div class="league-meta">${l.player_count} player${l.player_count === 1 ? '' : 's'}</div>
      <div class="league-top">${top}</div>
      <div class="league-card-cta">View league →</div>
    </a>`;
}

// ---- Create league modal ----
const modal = document.getElementById('create-modal');
document.getElementById('new-league-btn').addEventListener('click', () => {
  document.getElementById('create-error').textContent = '';
  modal.classList.add('show');
});
document.getElementById('create-cancel').addEventListener('click', () => modal.classList.remove('show'));
modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('show'); });

document.getElementById('create-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('league-name-input').value.trim();
  const description = document.getElementById('league-desc-input').value.trim();
  const pw = document.getElementById('league-pw-input').value;
  const errEl = document.getElementById('create-error');
  errEl.textContent = '';
  if (!name) return;

  const res = await fetch('/api/leagues', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-password': pw },
    body: JSON.stringify({ name, description }),
  });
  if (res.status === 401) { errEl.textContent = 'Incorrect admin password.'; return; }
  const data = await res.json();
  if (!res.ok) { errEl.textContent = data.error || 'Could not create league.'; return; }

  modal.classList.remove('show');
  showToast(`Created "${name}"`, 'success');
  // Jump straight to the new league so you can add players.
  location.href = `/league.html?id=${data.id}`;
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

loadLeagues();
