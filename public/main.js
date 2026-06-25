async function fetchData() {
  const [rankingsRes, matchesRes, avatarsRes] = await Promise.all([
    fetch('/api/rankings'),
    fetch('/api/matches'),
    fetch('/api/avatars'),
  ]);
  const players = await rankingsRes.json();
  const avatars = avatarsRes.ok ? await avatarsRes.json() : {};
  renderRankings(players, avatars);
  renderRecent(await matchesRes.json(), players);
}

function renderRankings(players, avatars = {}) {
  const container = document.getElementById('rankings-container');
  if (!players.length) {
    container.innerHTML = '<p class="empty-state">No players yet.</p>';
    return;
  }

  const rows = players.map((p, i) => {
    const rank = i + 1;
    const rankClass = rank <= 3 ? `rank-${rank}` : '';
    const formDots = (p.form || []).map(r =>
      `<span class="form-dot form-${r === 'W' ? 'w' : 'l'}"></span>`
    ).join('');
    const initials = p.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
    const avatarInner = avatars[p.id]
      ? `<img src="${avatars[p.id]}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`
      : initials;
    return `
      <tr>
        <td><span class="rank-num ${rankClass}">${rank}</span></td>
        <td>
          <div style="display:flex;align-items:center;gap:0.6rem">
            <div class="avatar avatar-sm">${avatarInner}</div>
            <a href="/profile.html?id=${p.id}" class="player-link">${escHtml(p.name)}</a>
          </div>
        </td>
        <td><span class="rating-badge">${p.rating}</span></td>
        <td class="win-rate">${p.win_rate}%</td>
        <td class="text-muted">${p.wins}W – ${p.losses}L</td>
        <td>${p.wins + p.losses}</td>
        <td><div class="form-dots">${formDots}</div></td>
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
          <th>Form</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

// ELO expected win probability (uses pre-match ratings) — fallback when no h2h data
function expectedWinProb(wRating, lRating) {
  return 1 / (1 + Math.pow(10, (lRating - wRating) / 400));
}

// Build a lookup of historical points scored between every pair of players
function buildH2H(matches) {
  const h2h = new Map();
  for (const m of matches) {
    if (m.winner_score == null || m.loser_score == null) continue;
    const a = Math.min(m.winner_id, m.loser_id);
    const b = Math.max(m.winner_id, m.loser_id);
    const key = `${a}-${b}`;
    const entry = h2h.get(key) || { a_pts: 0, b_pts: 0 };
    if (m.winner_id === a) { entry.a_pts += m.winner_score; entry.b_pts += m.loser_score; }
    else                   { entry.b_pts += m.winner_score; entry.a_pts += m.loser_score; }
    h2h.set(key, entry);
  }
  return h2h;
}

// Abramowitz & Stegun approximation of the standard normal CDF (error < 7.5e-8)
function normalCDF(z) {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z);
  const t = 1 / (1 + 0.2316419 * x);
  const poly = t * (0.319381530 + t * (-0.356563782
    + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const pdf = Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
  return 0.5 + sign * (0.5 - pdf * poly);
}

// Win probability via pooled h2h points + binomial normal approximation.
// Returns null when no cross-pairing history exists (caller falls back to Elo).
function h2hWinProb(winnerIds, loserIds, h2h) {
  let winnerPts = 0, totalPts = 0;
  for (const wId of winnerIds) {
    for (const lId of loserIds) {
      const a = Math.min(wId, lId), b = Math.max(wId, lId);
      const e = h2h.get(`${a}-${b}`);
      if (!e) continue;
      winnerPts += (wId === a) ? e.a_pts : e.b_pts;
      totalPts  += e.a_pts + e.b_pts;
    }
  }
  if (totalPts === 0) return null;
  const p = winnerPts / totalPts;
  const sigma = Math.sqrt(totalPts * p * (1 - p));
  if (sigma === 0) return p >= 0.5 ? 1 : 0;
  return normalCDF((winnerPts - totalPts / 2) / sigma);
}

// Generate game tags based on score, probability, and context
function gameTags(m, partner, prob, isRematch, topSeedId, topSeedName) {
  const tags = [];
  const ws = m.winner_score;
  const ls = m.loser_score;
  const hasScore = ws != null && ls != null;
  const margin = hasScore ? ws - ls : null;

  const winnerIds = [m.winner_id, partner?.winner_id].filter(Boolean);
  const loserIds  = [m.loser_id,  partner?.loser_id ].filter(Boolean);

  if (prob < 40)               tags.push({ label: '🔥 Upset',           cls: 'tag-upset',        tip: 'The underdog team won' });
  if (prob >= 75)              tags.push({ label: '⭐ Favored',          cls: 'tag-favored',      tip: 'The favored team won as expected' });
  if (hasScore && margin <= 2) tags.push({ label: '⚔️ Close Game',       cls: 'tag-close',        tip: 'Won by 2 points or fewer' });
  if (hasScore && margin >= 7) tags.push({ label: '💥 Stomp',            cls: 'tag-stomp',        tip: 'Won by 7 points or more' });
  if (hasScore && ls === 0 && ws === 11)
                               tags.push({ label: '🎯 Ace',              cls: 'tag-shutout',      tip: 'Perfect game — 11-0' });
  if (topSeedId && winnerIds.includes(topSeedId))
                               tags.push({ label: '👑 Top Seed',         cls: 'tag-topseed',      tip: `The top seed prevailed — ${topSeedName || 'the #1 player'}'s team wins` });
  if (topSeedId && loserIds.includes(topSeedId))
                               tags.push({ label: '💀 Top Seed Falls',   cls: 'tag-topseed-loss', tip: `The top seed falls — ${topSeedName || 'the #1 player'}'s team loses` });
  if (isRematch)               tags.push({ label: '🔁 Rematch',          cls: 'tag-rematch',      tip: 'These two teams have faced off before' });

  return tags;
}

// Group the two stored rows per doubles game into single games, then show the most recent.
function renderRecent(matches, players) {
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
      n.winner_score === m.winner_score &&
      n.loser_score === m.loser_score &&
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
  const topSeedId   = players && players[0] ? players[0].id   : null;
  const topSeedName = players && players[0] ? players[0].name : null;
  const h2h = buildH2H(matches);

  // Build combo keys preserving team composition (not just player set)
  function comboKey(m, partner) {
    const t1 = [m.winner_id, partner?.winner_id].filter(Boolean).sort().join(',');
    const t2 = [m.loser_id,  partner?.loser_id ].filter(Boolean).sort().join(',');
    return [t1, t2].sort().join('|');
  }

  // Build both table rows and mobile cards in one pass
  function delta(after, before) {
    const d = Math.round(after - before);
    return `<span class="rating-change ${d >= 0 ? 'up' : 'down'}">${d >= 0 ? '+' : ''}${d}</span>`;
  }

  const tableRows = [];
  const cardRows  = [];

  recent.forEach(({ m, partner }, gameIdx) => {
    const key = comboKey(m, partner);
    const isRematch = recent.some(({ m: om, partner: op }, otherIdx) =>
      otherIdx > gameIdx && otherIdx - gameIdx <= 4 && comboKey(om, op) === key
    );

    const w2 = partner ? ` & <a href="/profile.html?id=${partner.winner_id}" class="player-link">${escHtml(partner.winner_name)}</a>` : '';
    const l2 = partner ? ` & <a href="/profile.html?id=${partner.loser_id}" class="player-link">${escHtml(partner.loser_name)}</a>` : '';
    const scoreStr = (m.winner_score != null && m.loser_score != null)
      ? `<span class="match-score" style="font-size:0.85rem">${m.winner_score}–${m.loser_score}</span>`
      : '<span class="text-muted">—</span>';
    const date = formatDateTime(m.played_at);

    const winnerIds = [m.winner_id, partner?.winner_id].filter(Boolean);
    const loserIds  = [m.loser_id,  partner?.loser_id ].filter(Boolean);
    const h2hResult = h2hWinProb(winnerIds, loserIds, h2h);
    const wAvg = partner ? (m.winner_rating_before + partner.winner_rating_before) / 2 : m.winner_rating_before;
    const lAvg = partner ? (m.loser_rating_before  + partner.loser_rating_before)  / 2 : m.loser_rating_before;
    const prob  = h2hResult !== null
      ? Math.round(h2hResult * 100)
      : Math.round(expectedWinProb(wAvg, lAvg) * 100);

    const tags    = gameTags(m, partner, prob, isRematch, topSeedId, topSeedName);
    const probTag = `<span class="game-tag tag-prob" data-tip="Win probability for the winning team going into this match">📊 Winners: ${prob}%</span>`;
    const allTags = [probTag, ...tags.map(t => `<span class="game-tag ${t.cls}" data-tip="${t.tip}">${t.label}</span>`)];

    const wDelta1 = delta(m.winner_rating_after, m.winner_rating_before);
    const wDelta2 = partner ? delta(partner.winner_rating_after, partner.winner_rating_before) : '';
    const lDelta1 = delta(m.loser_rating_after,  m.loser_rating_before);
    const lDelta2 = partner ? delta(partner.loser_rating_after,  partner.loser_rating_before)  : '';

    tableRows.push(`
      <tbody>
        <tr>
          <td class="text-muted" style="white-space:nowrap">${date}</td>
          <td><a href="/profile.html?id=${m.winner_id}" class="player-link">${escHtml(m.winner_name)}</a>${w2}</td>
          <td>${scoreStr}</td>
          <td><a href="/profile.html?id=${m.loser_id}" class="player-link">${escHtml(m.loser_name)}</a>${l2}</td>
        </tr>
        <tr class="tags-row">
          <td><div class="tags-wrap">${allTags.join('')}</div></td>
          <td>${wDelta1}${wDelta2 ? ` · ${wDelta2}` : ''}</td>
          <td style="text-align:center;vertical-align:middle;color:var(--text-muted);font-size:0.7rem;font-weight:600;letter-spacing:0.08em;text-transform:uppercase">vs</td>
          <td>${lDelta1}${lDelta2 ? ` · ${lDelta2}` : ''}</td>
        </tr>
      </tbody>`);

    cardRows.push(`
      <div class="recent-card">
        <div class="recent-card-main">
          <div class="recent-card-team"><a href="/profile.html?id=${m.winner_id}" class="player-link">${escHtml(m.winner_name)}</a>${w2}</div>
          <div class="recent-card-score">${scoreStr}</div>
          <div class="recent-card-team recent-card-losers"><a href="/profile.html?id=${m.loser_id}" class="player-link">${escHtml(m.loser_name)}</a>${l2}</div>
        </div>
        <div class="tags-wrap recent-card-tags">${allTags.join('')}</div>
      </div>`);
  });

  el.innerHTML = `
    <table class="rankings-table recent-table">
      <thead><tr><th>Date</th><th>Winners</th><th>Score</th><th>Losers</th></tr></thead>
      ${tableRows.join('')}
    </table>
    <div class="recent-cards">${cardRows.join('')}</div>
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
