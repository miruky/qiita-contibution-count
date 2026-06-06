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

const HEADERS = {
  'Authorization': `Bearer ${QIITA_TOKEN}`,
  // Identify the client. A descriptive UA reduces edge/WAF blocks on
  // shared GitHub Actions runner IPs (default `node` UA is more likely to be throttled).
  'User-Agent': 'qiita-contribution-count/1.0 (+https://github.com/miruky/qiita-contibution-count)'
};

// Qiita returns 403 not only for auth failures but also for rate limiting /
// edge throttling — and runs from GitHub Actions share IPs with the whole
// world, so these blips are hit intermittently. Retry transient failures with
// exponential backoff so a single blip doesn't fail the whole run. This does
// NOT change the schedule; it only makes each scheduled run resilient.
async function fetchWithRetry(url, { retries = 4, baseDelayMs = 2000 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers: HEADERS });
      if (res.ok) return res;
      // 403/429 = rate limit / throttling, 5xx = server side — all transient.
      const transient = res.status === 403 || res.status === 429 || res.status >= 500;
      lastErr = new Error(`Request failed: ${res.status} for ${url}`);
      if (!transient || attempt === retries) throw lastErr;
    } catch (err) {
      lastErr = err;
      if (attempt === retries) throw lastErr;
    }
    const delay = baseDelayMs * 2 ** attempt + Math.floor(Math.random() * 1000);
    console.warn(`Attempt ${attempt + 1} failed (${lastErr.message}); retrying in ${delay}ms...`);
    await new Promise(r => setTimeout(r, delay));
  }
  throw lastErr;
}

async function fetchUserInfo() {
  const res = await fetchWithRetry(`https://qiita.com/api/v2/users/${USER_ID}`);
  return res.json();
}

async function fetchAllItems() {
  const items = [];
  let page = 1;
  while (true) {
    const res = await fetchWithRetry(
      `https://qiita.com/api/v2/authenticated_user/items?per_page=100&page=${page}`
    );
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
