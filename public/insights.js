/* Insights screen — charts and data-shapers for Spending Dashboard for YNAB.
 * Pure shapers are unit-tested via Node (test/insights.test.js); browser-only
 * render code is verified in the preview. No code runs at load time except
 * function declarations and the export guard at the bottom. */

// ── Lazy <script> loader (one fetch per src, resolves when ready) ──
const _loadedScripts = {};
function loadScriptOnce(src) {
  if (_loadedScripts[src]) return _loadedScripts[src];
  _loadedScripts[src] = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load ' + src));
    document.head.appendChild(s);
  });
  return _loadedScripts[src];
}

function showChartError(emptyId, msg) {
  const el = document.getElementById(emptyId);
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}

async function openInsights() {
  if (!activeBudget || !Array.isArray(monthData) || !monthData.length) return;
  showScreen('insights');
  renderBudgetVsActual();
  try {
    await loadScriptOnce('https://cdn.jsdelivr.net/npm/chartjs-chart-matrix@2');
    renderHeatmap();
  } catch (e) {
    showChartError('heatmapEmpty', 'Couldn’t load the heatmap library — check your connection.');
  }
  try {
    await loadScriptOnce('https://cdn.jsdelivr.net/npm/chartjs-chart-sankey@0.12.0');
    renderSankey();
  } catch (e) {
    showChartError('sankeyEmpty', 'Couldn’t load the flow-diagram library — check your connection.');
  }
}
function closeInsights() { showScreen('dashboard'); }

// Re-render Insights charts if the screen is currently showing (e.g. after a
// period or budget change refreshes monthData/txIndex). Safe to call anytime.
function refreshInsightsIfOpen() {
  const ins = document.getElementById('insights');
  if (!ins || getComputedStyle(ins).display === 'none') return;
  openInsights();
}

// ── Pure data-shapers ───────────────────────────────────────────
// Aggregate budgeted vs actual spend by category group across all loaded months.
// Input: monthData where each month may carry budgetRows:[{group,name,budgeted,actual}]
// (dollars). Output: [{name, budgeted, actual}] sorted by actual desc.
function budgetVsActual(monthData) {
  const byGroup = {};
  for (const m of monthData || []) {
    for (const r of (m && m.budgetRows) || []) {
      const g = byGroup[r.group] || (byGroup[r.group] = { name: r.group, budgeted: 0, actual: 0 });
      g.budgeted += r.budgeted || 0;
      g.actual += r.actual || 0;
    }
  }
  return Object.values(byGroup)
    .filter(g => g.budgeted > 0 || g.actual > 0)
    .sort((a, b) => b.actual - a.actual);
}

// Sum outflow spending per calendar day (dollars). Skips inflows, transfers,
// and deleted rows. Uses parent transaction amounts (splits are not descended,
// so totals are not double-counted). Input: array of raw YNAB transactions.
// Output: [{date:'YYYY-MM-DD', amount}] sorted by date ascending.
function dailyTotals(txns) {
  const byDay = {};
  for (const t of txns || []) {
    if (!t || t.deleted) continue;
    if (t.transfer_account_id) continue;
    if (typeof t.amount !== 'number' || t.amount >= 0) continue;
    byDay[t.date] = (byDay[t.date] || 0) + Math.abs(t.amount) / 1000;
  }
  return Object.keys(byDay)
    .sort()
    .map(date => ({ date, amount: byDay[date] }));
}

// Build Sankey flows from monthData: a single "Spending" root → each group,
// then each group → its categories. Amounts are summed across loaded months
// (dollars). Output: [{from, to, flow}] with flow > 0.
// Input note: relies on m.categories as produced by processMonth — already
// filtered to outflows only, with hidden/skipped categories excluded.
// Note: node identity in a Sankey is the label. Two categories with the same
// name in different groups will merge into one node (acceptable); a category
// named exactly "Spending" or sharing a group's name could create a cycle —
// rare, revisit in polish if it surfaces.
function sankeyFlows(monthData) {
  const groupTotals = {};
  const catTotals = {};
  for (const m of monthData || []) {
    for (const c of (m && m.categories) || []) {
      groupTotals[c.group] = (groupTotals[c.group] || 0) + c.amount;
      const key = c.group + ' ' + c.name;
      const entry = catTotals[key] || (catTotals[key] = { group: c.group, cat: c.name, amount: 0 });
      entry.amount += c.amount;
    }
  }
  const flows = [];
  for (const group of Object.keys(groupTotals)) {
    if (groupTotals[group] > 0) flows.push({ from: 'Spending', to: group, flow: groupTotals[group] });
  }
  for (const key of Object.keys(catTotals)) {
    const e = catTotals[key];
    if (e.amount > 0) flows.push({ from: e.group, to: e.cat, flow: e.amount });
  }
  return flows;
}

// ── Budget vs. Actual (native Chart.js bar; budgeted shown as markers) ──
function renderBudgetVsActual() {
  const rows = budgetVsActual(monthData);
  const empty = document.getElementById('bvaEmpty');
  if (!rows.length) { empty.style.display = 'block'; return; }
  empty.style.display = 'none';
  makeChart('bvaChart', {
    type: 'bar',
    data: {
      labels: rows.map(r => r.name),
      datasets: [
        {
          label: 'Actual',
          data: rows.map(r => r.actual),
          backgroundColor: rows.map(r => r.actual > r.budgeted ? '#e53e3e' : '#48bb78'),
          order: 2,
        },
        {
          label: 'Budgeted',
          type: 'scatter',
          data: rows.map((r, i) => ({ x: r.budgeted, y: i })),
          backgroundColor: '#2d3748',
          pointStyle: 'rectRot',
          pointRadius: 7,
          pointHoverRadius: 8,
          order: 1,
        },
      ],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      plugins: {
        legend: { position: 'top' },
        tooltip: { callbacks: { label: (c) => `${c.dataset.label}: $${Number(c.parsed.x).toFixed(2)}` } },
      },
      scales: { x: { beginAtZero: true, ticks: { callback: (v) => '$' + v } } },
    },
  });
}

// ── Daily-spend calendar heatmap (chartjs-chart-matrix) ──
function renderHeatmap() {
  const totals = dailyTotals([...txIndex.values()]);
  const empty = document.getElementById('heatmapEmpty');
  if (!totals.length) { empty.style.display = 'block'; return; }
  empty.style.display = 'none';

  const map = {};
  let max = 0;
  for (const d of totals) { map[d.date] = d.amount; if (d.amount > max) max = d.amount; }

  const start = new Date(totals[0].date + 'T12:00:00Z');
  const end = new Date(totals[totals.length - 1].date + 'T12:00:00Z');
  const cells = [];
  for (let dt = new Date(start); dt <= end; dt.setUTCDate(dt.getUTCDate() + 1)) {
    const iso = dt.toISOString().slice(0, 10);
    const week = Math.floor((dt - start) / (7 * 864e5));
    cells.push({ x: week, y: dt.getUTCDay(), d: iso, v: map[iso] || 0 });
  }
  const weeks = cells.length ? cells[cells.length - 1].x + 1 : 1;
  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  makeChart('heatmapChart', {
    type: 'matrix',
    data: {
      datasets: [{
        label: 'Daily spend',
        data: cells,
        width: (c) => Math.max(2, ((c.chart.chartArea || {}).width || 0) / weeks - 2),
        height: (c) => Math.max(2, ((c.chart.chartArea || {}).height || 0) / 7 - 2),
        backgroundColor: (c) => {
          const v = c.raw.v;
          if (!v) return '#ebedf0';
          return `rgba(66,153,225,${0.15 + 0.85 * (v / max)})`;
        },
        borderWidth: 0,
      }],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { title: (i) => i[0].raw.d, label: (i) => '$' + i.raw.v.toFixed(2) } },
      },
      scales: {
        x: { display: false, type: 'linear', offset: true, min: 0, max: weeks },
        y: {
          type: 'linear', offset: true, min: -0.5, max: 6.5, reverse: true,
          ticks: { stepSize: 1, callback: (v) => dayLabels[v] || '' },
          grid: { display: false },
        },
      },
    },
  });
}

// Spending composition by group for a single processed month. Input: one
// monthData entry ({groupTotals}). Output: [{group, total}] sorted desc.
function groupComposition(month) {
  const totals = (month && month.groupTotals) || {};
  return Object.keys(totals)
    .map(group => ({ group, total: totals[group] }))
    .filter(g => g.total > 0)
    .sort((a, b) => b.total - a.total);
}

// ── Spending flow Sankey (chartjs-chart-sankey) ──
function renderSankey() {
  const flows = sankeyFlows(monthData);
  const empty = document.getElementById('sankeyEmpty');
  if (!flows.length) { empty.style.display = 'block'; return; }
  empty.style.display = 'none';
  makeChart('sankeyChart', {
    type: 'sankey',
    data: {
      datasets: [{
        label: 'Spending flow',
        data: flows.map(f => ({ from: f.from, to: f.to, flow: f.flow })),
        colorMode: 'gradient',
        color: '#4299e1',
        borderWidth: 0,
      }],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (c) => `${c.raw.from} → ${c.raw.to}: $${Number(c.raw.flow).toFixed(0)}` } },
      },
    },
  });
}

// ── Spending-by-group donut for the latest month (Overview) ──
function renderGroupDonut() {
  const month = monthData[monthData.length - 1];
  const rows = groupComposition(month);
  const labelEl = document.getElementById('groupDonutLabel');
  if (labelEl && month) labelEl.textContent = month.label.replace(' *', '');
  if (!rows.length) { makeChart('groupDonutChart', { type: 'doughnut', data: { labels: [], datasets: [{ data: [] }] } }); return; }
  const total = rows.reduce((s, r) => s + r.total, 0);
  makeChart('groupDonutChart', {
    type: 'doughnut',
    data: {
      labels: rows.map(r => r.group),
      datasets: [{ data: rows.map(r => r.total), backgroundColor: rows.map(r => groupColor(r.group)), borderWidth: 2, borderColor: '#fff' }],
    },
    options: {
      responsive: true,
      cutout: '62%',
      plugins: {
        legend: { position: 'right', labels: { boxWidth: 12, font: { size: 11 } } },
        tooltip: { callbacks: { label: (c) => `${c.label}: ${fmtMoney(c.parsed)} (${Math.round(100 * c.parsed / total)}%)` } },
      },
    },
  });
}

// ── CommonJS export guard (Node tests only; ignored in the browser) ──
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { budgetVsActual, dailyTotals, sankeyFlows, groupComposition };
}
