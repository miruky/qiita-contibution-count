const QIITA_USER = 'miruky';
const TARGET_CONTRIBUTION = 6500;
const YEAR = 2026;

let cumulativeChart = null;
let dailyChartInstance = null;

// ===== Data Fetching =====

async function fetchHistory() {
  try {
    const res = await fetch('./data/history.json');
    if (!res.ok) throw new Error('No history data');
    return await res.json();
  } catch {
    return { target: TARGET_CONTRIBUTION, daily: [] };
  }
}

async function fetchAllPublicItems() {
  const items = [];
  let page = 1;
  while (true) {
    const res = await fetch(
      `https://qiita.com/api/v2/items?query=user:${QIITA_USER}&per_page=100&page=${page}`
    );
    if (!res.ok) break;
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) break;
    items.push(...data);
    if (data.length < 100) break;
    page++;
  }
  return items;
}

async function fetchRealtimeData() {
  try {
    const [userRes, items] = await Promise.all([
      fetch(`https://qiita.com/api/v2/users/${QIITA_USER}`).then(r => r.json()),
      fetchAllPublicItems()
    ]);

    const totalLikes = items.reduce((sum, item) => sum + (item.likes_count || 0), 0);
    const totalStocks = items.reduce((sum, item) => sum + (item.stocks_count || 0), 0);

    return {
      user: userRes,
      contribution: totalLikes + totalStocks / 2 + items.length,
      likes: totalLikes,
      stocks: totalStocks,
      articles: items.length,
      views: null
    };
  } catch (e) {
    console.warn('Real-time fetch failed, using cached data:', e);
    return null;
  }
}

// ===== Utility =====

function formatNumber(num) {
  if (num == null) return '-';
  return Math.floor(num).toLocaleString('ja-JP');
}

function getDaysRemaining() {
  const now = new Date();
  const endOfYear = new Date(YEAR, 11, 31, 23, 59, 59);
  const diff = endOfYear - now;
  return Math.max(1, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

function getTodayString() {
  return new Date().toISOString().split('T')[0];
}

// ===== Rendering =====

function renderStats(realtimeData, history) {
  const latest = history?.daily?.[history.daily.length - 1];

  // User info
  const avatarEl = document.getElementById('user-avatar');
  const usernameEl = document.getElementById('username');

  const profileUrl = realtimeData?.user?.profile_image_url || history?.user?.profile_image_url;
  const userId = realtimeData?.user?.id || history?.user?.id || QIITA_USER;

  if (profileUrl) avatarEl.src = profileUrl;
  usernameEl.textContent = `@${userId}`;

  // Stats
  const contribution = realtimeData?.contribution ?? latest?.contribution ?? 0;
  const likes = realtimeData?.likes ?? latest?.likes ?? 0;
  const stocks = realtimeData?.stocks ?? latest?.stocks ?? 0;
  const articles = realtimeData?.articles ?? latest?.articles ?? 0;
  const views = realtimeData?.views ?? latest?.views ?? 0;

  // Animate contribution count
  animateValue('contribution-count', 0, Math.floor(contribution), 1200);
  animateValue('stat-articles', 0, articles, 800);
  animateValue('stat-likes', 0, likes, 900);
  animateValue('stat-stocks', 0, stocks, 1000);
  animateValue('stat-views', 0, views, 1100);

  // Progress
  const progress = Math.min(100, (contribution / TARGET_CONTRIBUTION) * 100);
  const daysRemaining = getDaysRemaining();
  const remaining = Math.max(0, TARGET_CONTRIBUTION - contribution);
  const dailyNeeded = remaining / daysRemaining;

  document.getElementById('progress-percent').textContent = `${progress.toFixed(1)}%`;
  document.getElementById('remaining-contribution').textContent = formatNumber(remaining);
  document.getElementById('daily-target').textContent = dailyNeeded.toFixed(1);
  document.getElementById('days-remaining').textContent = daysRemaining;
  document.getElementById('progress-current').textContent = `${formatNumber(contribution)} Contribution`;
  document.getElementById('progress-target').textContent = `${formatNumber(TARGET_CONTRIBUTION)} Contribution`;

  // Animate progress bar
  requestAnimationFrame(() => {
    document.getElementById('progress-bar-fill').style.width = `${progress}%`;
  });

  // Last updated
  document.getElementById('last-updated').textContent =
    `最終更新: ${new Date().toLocaleString('ja-JP')}`;
}

function animateValue(elementId, start, end, duration) {
  const el = document.getElementById(elementId);
  if (!el || end === 0) {
    if (el) el.textContent = formatNumber(end);
    return;
  }

  const startTime = performance.now();

  function step(currentTime) {
    const elapsed = currentTime - startTime;
    const ratio = Math.min(elapsed / duration, 1);
    // Ease out cubic
    const eased = 1 - Math.pow(1 - ratio, 3);
    const current = Math.floor(start + (end - start) * eased);
    el.textContent = current.toLocaleString('ja-JP');

    if (ratio < 1) {
      requestAnimationFrame(step);
    } else {
      el.textContent = end.toLocaleString('ja-JP');
    }
  }

  requestAnimationFrame(step);
}

function renderCumulativeChart(history, realtimeData) {
  const ctx = document.getElementById('contribution-chart');
  if (!ctx) return;

  const dailyData = [...(history?.daily || [])];

  // Add real-time data point for today
  const today = getTodayString();
  if (realtimeData) {
    const todayIndex = dailyData.findIndex(d => d.date === today);
    const currentEntry = {
      date: today,
      contribution: realtimeData.contribution,
      likes: realtimeData.likes,
      stocks: realtimeData.stocks,
      views: realtimeData.views || dailyData[dailyData.length - 1]?.views || 0,
      articles: realtimeData.articles
    };
    if (todayIndex >= 0) {
      dailyData[todayIndex] = currentEntry;
    } else {
      dailyData.push(currentEntry);
    }
  }

  dailyData.sort((a, b) => a.date.localeCompare(b.date));

  if (dailyData.length === 0) return;

  // Actual data points
  const actualData = dailyData.map(d => ({
    x: d.date,
    y: d.contribution
  }));

  // Target line: from first data point to Dec 31 at 6500
  const firstEntry = dailyData[0];
  const targetData = [
    { x: firstEntry.date, y: firstEntry.contribution },
    { x: `${YEAR}-12-31`, y: TARGET_CONTRIBUTION }
  ];

  if (cumulativeChart) cumulativeChart.destroy();

  cumulativeChart = new Chart(ctx.getContext('2d'), {
    type: 'line',
    data: {
      datasets: [
        {
          label: '実績',
          data: actualData,
          borderColor: '#3fb950',
          backgroundColor: createGradient(ctx, '#3fb950'),
          borderWidth: 2.5,
          fill: true,
          tension: 0.3,
          pointRadius: dailyData.length <= 60 ? 4 : 2,
          pointHoverRadius: 6,
          pointBackgroundColor: '#3fb950',
          pointBorderColor: '#0d1117',
          pointBorderWidth: 2,
          order: 1
        },
        {
          label: '目標ペース',
          data: targetData,
          borderColor: '#f0883e',
          borderWidth: 2,
          borderDash: [8, 4],
          fill: false,
          pointRadius: 0,
          tension: 0,
          order: 2
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1c2128',
          titleColor: '#e6edf3',
          bodyColor: '#8b949e',
          borderColor: '#30363d',
          borderWidth: 1,
          padding: 12,
          cornerRadius: 8,
          titleFont: { family: "'Inter', 'Noto Sans JP', sans-serif", weight: '600' },
          bodyFont: { family: "'Inter', 'Noto Sans JP', sans-serif" },
          callbacks: {
            title(items) {
              const d = new Date(items[0].parsed.x);
              return d.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' });
            },
            label(item) {
              const val = item.parsed.y;
              return ` ${item.dataset.label}: ${val != null ? val.toFixed(1) : '-'}`;
            }
          }
        }
      },
      scales: {
        x: {
          type: 'time',
          time: {
            unit: 'month',
            displayFormats: { month: 'M月', day: 'M/d' }
          },
          min: firstEntry.date,
          max: `${YEAR}-12-31`,
          grid: {
            color: '#21262d',
            drawBorder: false
          },
          ticks: {
            color: '#8b949e',
            font: { family: "'Inter', 'Noto Sans JP', sans-serif", size: 11 },
            maxTicksLimit: 12
          }
        },
        y: {
          min: Math.max(0, firstEntry.contribution - 200),
          max: TARGET_CONTRIBUTION + 500,
          grid: {
            color: '#21262d',
            drawBorder: false
          },
          ticks: {
            color: '#8b949e',
            font: { family: "'Inter', 'Noto Sans JP', sans-serif", size: 11 },
            callback: value => value.toLocaleString()
          }
        }
      }
    }
  });
}

function createGradient(canvas, color) {
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.clientHeight || 400);
  gradient.addColorStop(0, color + '33');
  gradient.addColorStop(1, color + '05');
  return gradient;
}

function renderDailyChart(history) {
  const dailyData = history?.daily || [];

  if (dailyData.length < 2) {
    // Not enough data for daily chart
    return;
  }

  // Show chart, hide placeholder
  document.getElementById('daily-chart-placeholder')?.classList.add('hidden');
  document.getElementById('daily-chart-wrapper')?.classList.remove('hidden');

  const labels = [];
  const deltas = [];

  for (let i = 1; i < dailyData.length; i++) {
    labels.push(dailyData[i].date);
    deltas.push(dailyData[i].contribution - dailyData[i - 1].contribution);
  }

  const daysRemaining = getDaysRemaining();
  const latest = dailyData[dailyData.length - 1];
  const remainingContribution = Math.max(0, TARGET_CONTRIBUTION - latest.contribution);
  const dailyTarget = remainingContribution / daysRemaining;

  // Target line as a dataset with constant value
  const targetLineData = labels.map(() => dailyTarget);

  const ctx = document.getElementById('daily-chart');
  if (!ctx) return;

  if (dailyChartInstance) dailyChartInstance.destroy();

  dailyChartInstance = new Chart(ctx.getContext('2d'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: '日次獲得',
          data: deltas,
          backgroundColor: deltas.map(d =>
            d >= dailyTarget ? 'rgba(63, 185, 80, 0.6)' : 'rgba(248, 81, 73, 0.6)'
          ),
          borderColor: deltas.map(d =>
            d >= dailyTarget ? '#3fb950' : '#f85149'
          ),
          borderWidth: 1,
          borderRadius: 4,
          order: 2
        },
        {
          label: `目標 (${dailyTarget.toFixed(1)}/日)`,
          data: targetLineData,
          type: 'line',
          borderColor: '#f0883e',
          borderWidth: 2,
          borderDash: [6, 3],
          pointRadius: 0,
          fill: false,
          order: 1
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          position: 'top',
          align: 'end',
          labels: {
            color: '#8b949e',
            font: { family: "'Inter', 'Noto Sans JP', sans-serif", size: 12 },
            boxWidth: 16,
            boxHeight: 2,
            padding: 16
          }
        },
        tooltip: {
          backgroundColor: '#1c2128',
          titleColor: '#e6edf3',
          bodyColor: '#8b949e',
          borderColor: '#30363d',
          borderWidth: 1,
          padding: 12,
          cornerRadius: 8
        }
      },
      scales: {
        x: {
          type: 'time',
          time: {
            unit: 'day',
            displayFormats: { day: 'M/d' }
          },
          grid: { color: '#21262d', drawBorder: false },
          ticks: {
            color: '#8b949e',
            font: { size: 11 }
          }
        },
        y: {
          beginAtZero: true,
          grid: { color: '#21262d', drawBorder: false },
          ticks: {
            color: '#8b949e',
            font: { size: 11 },
            callback: value => value.toFixed(1)
          }
        }
      }
    }
  });
}

// ===== Init =====

async function init() {
  const loadingEl = document.getElementById('loading');
  const dashboardEl = document.getElementById('dashboard');

  try {
    const [history, realtimeData] = await Promise.all([
      fetchHistory(),
      fetchRealtimeData()
    ]);

    renderStats(realtimeData, history);
    renderCumulativeChart(history, realtimeData);
    renderDailyChart(history);
  } catch (e) {
    console.error('Dashboard init error:', e);
  } finally {
    loadingEl?.classList.add('hidden');
    dashboardEl?.classList.remove('hidden');
  }
}

// Auto-refresh every 10 minutes
setInterval(() => init(), 10 * 60 * 1000);

document.addEventListener('DOMContentLoaded', init);
