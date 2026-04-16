import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// Read token from environment (GitHub Actions) or local.env
let QIITA_TOKEN = process.env.QIITA_API_TOKEN;
if (!QIITA_TOKEN) {
  try {
    const envContent = readFileSync(join(ROOT, 'local.env'), 'utf8');
    const match = envContent.match(/Qiita_API="?([a-f0-9]{40})"?/);
    if (match) QIITA_TOKEN = match[1];
  } catch { /* ignore */ }
}

if (!QIITA_TOKEN) {
  console.error('Error: QIITA_API_TOKEN not found in environment or local.env');
  process.exit(1);
}

const USER_ID = 'miruky';
const TARGET = 6500;

async function fetchUserInfo() {
  const res = await fetch(`https://qiita.com/api/v2/users/${USER_ID}`, {
    headers: { 'Authorization': `Bearer ${QIITA_TOKEN}` }
  });
  if (!res.ok) throw new Error(`Failed to fetch user: ${res.status}`);
  return res.json();
}

async function fetchAllItems() {
  const items = [];
  let page = 1;
  while (true) {
    const res = await fetch(
      `https://qiita.com/api/v2/authenticated_user/items?per_page=100&page=${page}`,
      { headers: { 'Authorization': `Bearer ${QIITA_TOKEN}` } }
    );
    if (!res.ok) throw new Error(`Failed to fetch items page ${page}: ${res.status}`);
    const data = await res.json();
    if (data.length === 0) break;
    items.push(...data);
    if (data.length < 100) break;
    page++;
  }
  return items;
}

async function main() {
  console.log('Fetching Qiita data...');
  const [user, items] = await Promise.all([fetchUserInfo(), fetchAllItems()]);

  const totalLikes = items.reduce((sum, item) => sum + item.likes_count, 0);
  const totalStocks = items.reduce((sum, item) => sum + (item.stocks_count || 0), 0);
  const totalViews = items.reduce((sum, item) => sum + (item.page_views_count || 0), 0);
  const contribution = totalLikes + totalStocks / 2 + items.length;

  const today = new Date().toISOString().split('T')[0];

  const dataDir = join(ROOT, 'data');
  const historyFile = join(dataDir, 'history.json');

  let history;
  try {
    history = JSON.parse(readFileSync(historyFile, 'utf8'));
  } catch {
    history = { target: TARGET, daily: [] };
  }

  const entry = {
    date: today,
    contribution,
    likes: totalLikes,
    stocks: totalStocks,
    views: totalViews,
    articles: items.length,
    followers: user.followers_count
  };

  // Update or append today's entry
  const existingIndex = history.daily.findIndex(d => d.date === today);
  if (existingIndex >= 0) {
    history.daily[existingIndex] = entry;
  } else {
    history.daily.push(entry);
  }

  // Sort by date
  history.daily.sort((a, b) => a.date.localeCompare(b.date));

  // Update user info and target
  history.target = TARGET;
  history.user = {
    id: user.id,
    name: user.name,
    profile_image_url: user.profile_image_url,
    followers_count: user.followers_count
  };

  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  writeFileSync(historyFile, JSON.stringify(history, null, 2));
  console.log(`Updated: ${today} | contribution=${contribution} | likes=${totalLikes} | stocks=${totalStocks} | views=${totalViews} | articles=${items.length}`);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
