async function loadArchive() {
  const res = await fetch('/api/leagues');
  const leagues = await res.json();
  const archived = leagues.filter(l => l.status === 'archived');
  const el = document.getElementById('archived-leagues');

  if (!archived.length) {
    el.innerHTML = '<div class="card"><p class="empty-state">No archived seasons yet.</p></div>';
    return;
  }

  el.innerHTML = archived.map(archiveCard).join('');
}

function medal(i) { return i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`; }

function archiveCard(l) {
  const top = (l.top_players || []).map((p, i) =>
    `<div class="league-top-row">
       <span class="league-top-rank">${medal(i)}</span>
       <span class="league-top-name">${escHtml(p.name)}</span>
       <span class="rating-badge">${p.rating}</span>
     </div>`).join('') || '<p class="empty-state">No players.</p>';

  return `
    <div class="card" style="margin-bottom:1.5rem">
      <div class="league-card-head">
        <h3 style="margin:0;text-transform:none;letter-spacing:0;font-size:1.2rem;color:var(--text)">${escHtml(l.name)}</h3>
        <span class="league-badge archived">Archived</span>
      </div>
      ${l.description ? `<p class="league-desc" style="max-width:60ch">${escHtml(l.description)}</p>` : ''}
      <div class="archive-toplabel">Top 5 — final standings</div>
      <div class="league-top">${top}</div>
      <a href="/league.html?id=${l.id}" class="btn btn-secondary" style="width:auto;margin-top:1.25rem">View full standings →</a>
    </div>`;
}

function escHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

loadArchive();
