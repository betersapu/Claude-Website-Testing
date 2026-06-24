const playerName = document.querySelector('#player-name');
const playerRank = document.querySelector('#player-rank');
const playerRating = document.querySelector('#player-rating');
const playerWins = document.querySelector('#player-wins');
const playerLosses = document.querySelector('#player-losses');
const playerWinRate = document.querySelector('#player-winrate');
const playerGames = document.querySelector('#player-games');
const historyChartCanvas = document.querySelector('#history-chart');
const headToHeadBody = document.querySelector('#head-to-head-table tbody');

function getPlayerIdFromQuery() {
  const params = new URLSearchParams(window.location.search);
  return params.get('playerId');
}

function drawChart(history) {
  const ctx = historyChartCanvas.getContext('2d');
  const width = historyChartCanvas.width;
  const height = historyChartCanvas.height;
  ctx.clearRect(0, 0, width, height);

  if (!history.length) {
    ctx.fillStyle = '#2c3e50';
    ctx.font = '16px Arial';
    ctx.fillText('No rating history available yet.', 20, 50);
    return;
  }

  const ratings = history.map(item => item.rating);
  const dates = history.map(item => item.date.slice(0, 10));
  const minRating = Math.min(...ratings);
  const maxRating = Math.max(...ratings);
  const xStep = width / (ratings.length - 1 || 1);
  const yRange = maxRating - minRating || 1;

  ctx.strokeStyle = '#2c3e50';
  ctx.lineWidth = 3;
  ctx.beginPath();

  ratings.forEach((rating, index) => {
    const x = index * xStep;
    const y = height - ((rating - minRating) / yRange) * (height - 40) - 20;
    if (index === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });
  ctx.stroke();

  ctx.fillStyle = '#2c3e50';
  ctx.font = '12px Arial';
  ratings.forEach((rating, index) => {
    const x = index * xStep;
    const y = height - ((rating - minRating) / yRange) * (height - 40) - 20;
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillText(`${rating}`, x + 6, y - 8);
  });

  ctx.fillStyle = '#7f8c8d';
  ctx.textAlign = 'center';
  dates.forEach((label, index) => {
    const x = index * xStep;
    ctx.fillText(label, x, height - 4);
  });
}

function renderHeadToHead(records) {
  headToHeadBody.innerHTML = '';
  if (!records.length) {
    headToHeadBody.innerHTML = '<tr><td colspan="3">No head-to-head data yet.</td></tr>';
    return;
  }

  records.forEach(record => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${record.opponentId}</td>
      <td>${record.wins}</td>
      <td>${record.losses}</td>
    `;
    headToHeadBody.appendChild(row);
  });
}

async function initProfile() {
  const playerId = getPlayerIdFromQuery();
  if (!playerId) {
    playerName.textContent = 'Player ID is missing';
    return;
  }

  const response = await fetch(`/api/players/${playerId}`);
  if (!response.ok) {
    playerName.textContent = 'Unable to load player profile';
    return;
  }

  const { player, history } = await response.json();
  playerName.textContent = player.name;
  playerRank.textContent = player.rank;
  playerRating.textContent = player.rating;
  playerWins.textContent = player.wins;
  playerLosses.textContent = player.losses;
  playerWinRate.textContent = player.winRate;
  playerGames.textContent = player.totalGames;
  drawChart(history);

  const headResponse = await fetch(`/api/players/${playerId}/head-to-head`);
  const headRecords = headResponse.ok ? await headResponse.json() : [];
  renderHeadToHead(headRecords);
}

initProfile().catch(error => {
  console.error(error);
  playerName.textContent = 'Unable to load player profile';
});
