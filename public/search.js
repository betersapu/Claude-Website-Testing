(async function () {
  const input    = document.getElementById('search-input');
  const dropdown = document.getElementById('search-dropdown');
  if (!input) return;

  function updatePlaceholder() {
    input.placeholder = window.innerWidth <= 640 ? 'Search…' : 'Search players…';
  }
  updatePlaceholder();
  window.addEventListener('resize', updatePlaceholder);

  let players = [];
  let avatars = {};
  try {
    const [rankRes, avRes] = await Promise.all([fetch('/api/rankings'), fetch('/api/avatars')]);
    players = await rankRes.json();
    if (avRes.ok) avatars = await avRes.json();
  } catch (e) {}

  function esc(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function show(results) {
    if (!results.length) {
      dropdown.innerHTML = '<div class="search-empty">No players found</div>';
    } else {
      dropdown.innerHTML = results.map(p => {
        const initials = p.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
        const wr = p.win_rate;
        const wrColor = wr >= 55 ? 'var(--win)' : wr <= 45 ? 'var(--loss)' : 'var(--text-muted)';
        const avatarInner = avatars[p.id]
          ? `<img src="${avatars[p.id]}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`
          : esc(initials);
        return `
          <a href="/profile.html?id=${p.id}" class="search-result">
            <div class="search-avatar">${avatarInner}</div>
            <div class="search-info">
              <div class="search-name">${esc(p.name)}</div>
              <div class="search-meta">${p.rating} ELO &nbsp;·&nbsp; <span style="color:${wrColor}">${wr}%</span></div>
            </div>
          </a>`;
      }).join('');
    }
    dropdown.classList.add('show');
  }

  function hide() {
    dropdown.classList.remove('show');
  }

  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    if (!q) { hide(); return; }
    show(players.filter(p => p.name.toLowerCase().includes(q)).slice(0, 6));
  });

  input.addEventListener('focus', () => {
    if (input.value.trim()) input.dispatchEvent(new Event('input'));
  });

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const first = dropdown.querySelector('.search-result');
      if (first) { first.click(); }
    }
    if (e.key === 'Escape') { hide(); input.blur(); }
  });

  document.addEventListener('click', e => {
    if (!document.getElementById('nav-search').contains(e.target)) hide();
  });
})();
