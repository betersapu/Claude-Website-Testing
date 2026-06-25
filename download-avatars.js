// Run once: node download-avatars.js
// Downloads Discord avatars as static files into public/avatars/
// Requires DISCORD_TOKEN in .env

require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const https = require('https');

const TOKEN = process.env.DISCORD_TOKEN;
if (!TOKEN) { console.error('No DISCORD_TOKEN in .env'); process.exit(1); }

const outDir = path.join(__dirname, 'public', 'avatars');
fs.mkdirSync(outDir, { recursive: true });

// Map player DB id → discord_id (matches your migrate-discord.js)
const players = [
  { id: 6,  name: 'Ketan',   discord_id: '690691835882111027' },
  { id: 7,  name: 'Sean',    discord_id: '635318504307949572' },
  { id: 8,  name: 'Connor',  discord_id: '519315420881223681' },
  { id: 9,  name: 'Jacky',   discord_id: '412064493527498757' },
  { id: 10, name: 'Jake',    discord_id: '513132503477911563' },
];

function fetchJson(url, headers) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
    }).on('error', reject);
  });
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', err => { fs.unlink(dest, () => {}); reject(err); });
  });
}

(async () => {
  for (const p of players) {
    try {
      const user = await fetchJson(
        `https://discord.com/api/v10/users/${p.discord_id}`,
        { Authorization: `Bot ${TOKEN}` }
      );

      let avatarUrl;
      if (user.avatar) {
        avatarUrl = `https://cdn.discordapp.com/avatars/${p.discord_id}/${user.avatar}.png?size=128`;
      } else {
        const idx = Number(BigInt(p.discord_id) % 6n);
        avatarUrl = `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
      }

      const dest = path.join(outDir, `${p.id}.png`);
      await downloadFile(avatarUrl, dest);
      console.log(`✓ ${p.name} (id=${p.id}) → ${dest}`);
    } catch (e) {
      console.error(`✗ ${p.name}:`, e.message);
    }
  }
  console.log('Done. Commit public/avatars/ to your repo.');
})();
