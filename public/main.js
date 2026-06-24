const winner1Select = document.querySelector('#winner1');
const winner2Select = document.querySelector('#winner2');
const loser1Select = document.querySelector('#loser1');
const loser2Select = document.querySelector('#loser2');
const matchForm = document.querySelector('#match-form');
const addPlayerForm = document.querySelector('#add-player-form');
const playerNameInput = document.querySelector('#player-name');
const addMessage = document.querySelector('#add-message');
const message = document.querySelector('#form-message');
const rankingsTableBody = document.querySelector('#rankings-table tbody');

async function fetchPlayers() {
  const response = await fetch('/api/players');
  return response.json();
}

function buildPlayerOptions(players) {
  winner1Select.innerHTML = '';
  winner2Select.innerHTML = '';
  loser1Select.innerHTML = '';
  loser2Select.innerHTML = '';

  players.forEach(player => {
    const option = document.createElement('option');
    option.value = player.id;
    option.textContent = `${player.name} (${player.rating})`;
    winner1Select.appendChild(option.cloneNode(true));
    winner2Select.appendChild(option.cloneNode(true));
    loser1Select.appendChild(option.cloneNode(true));
    loser2Select.appendChild(option.cloneNode(true));
  });
}

function renderRankings(players) {
  rankingsTableBody.innerHTML = '';
  players.forEach(player => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${player.rank}</td>
      <td>${player.name}</td>
      <td>${player.rating}</td>
      <td>${player.wins}</td>
      <td>${player.losses}</td>
      <td>${player.winRate}%</td>
      <td><a href="profile.html?playerId=${player.id}">View</a></td>
    `;
    rankingsTableBody.appendChild(row);
  });
}

async function refresh() {
  const players = await fetchPlayers();
  buildPlayerOptions(players);
  renderRankings(players);
}

async function createPlayer(name) {
  const response = await fetch('/api/players', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  });
  const result = await response.json();
  if (!response.ok) {
    throw result;
  }
  return result;
}

function getTeamSelections() {
  return {
    winnerIds: [parseInt(winner1Select.value, 10), parseInt(winner2Select.value, 10)],
    loserIds: [parseInt(loser1Select.value, 10), parseInt(loser2Select.value, 10)]
  };
}

function validateTeamSelection(winnerIds, loserIds) {
  const allIds = [...winnerIds, ...loserIds];
  if (allIds.some(id => Number.isNaN(id))) {
    return 'Please select two players for each team.';
  }
  const uniqueCount = new Set(allIds).size;
  if (uniqueCount !== allIds.length) {
    return 'Each player must appear only once in the match.';
  }
  return null;
}

matchForm.addEventListener('submit', async event => {
  event.preventDefault();
  const { winnerIds, loserIds } = getTeamSelections();
  const validationError = validateTeamSelection(winnerIds, loserIds);
  if (validationError) {
    message.textContent = validationError;
    return;
  }

  const response = await fetch('/api/matches', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ winnerIds, loserIds })
  });

  const result = await response.json();
  if (!response.ok) {
    message.textContent = result.error || 'Unable to submit match.';
    return;
  }

  message.textContent = 'Match recorded! Rankings updated.';
  await refresh();
});

if (addPlayerForm) {
  addPlayerForm.addEventListener('submit', async event => {
    event.preventDefault();
    const name = playerNameInput.value.trim();
    if (!name) {
      addMessage.textContent = 'Please enter a player name.';
      return;
    }

    try {
      const result = await createPlayer(name);
      playerNameInput.value = '';
      addMessage.textContent = `${result.name} added successfully.`;
      await refresh();
    } catch (error) {
      console.error(error);
      addMessage.textContent = error?.error || 'Unable to add player.';
    }
  });
}

refresh().catch(error => {
  console.error(error);
  message.textContent = 'Unable to load players. Try restarting the server.';
});
