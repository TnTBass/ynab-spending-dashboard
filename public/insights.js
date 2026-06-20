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

// ── Insights scope (independent of the dashboard period selector) ──
let insightsScope = { mode: 'year', year: new Date().getFullYear(), month: new Date().getMonth() + 1 };
let insightsMonths = [];   // processed months for the current scope
let insightsTxns = [];     // raw transactions within the current scope

// Which calendar years to offer in the year picker: from the budget's earliest
// loaded month to the current year (fallback to current year only).
function insightsYearOptions() {
  const years = new Set([new Date().getFullYear()]);
  for (const m of monthData || []) { const y = +m.month.slice(0, 4); if (y) years.add(y); }
  return [...years].sort((a, b) => b - a);
}

// Populate the year/month <select>s from current state.
function populateScopePickers() {
  const ySel = document.getElementById('scopeYear');
  ySel.innerHTML = insightsYearOptions().map(y => `<option value="${y}">${y}</option>`).join('');
  ySel.value = String(insightsScope.year);
  const mSel = document.getElementById('scopeMonth');
  const names = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  mSel.innerHTML = names.map((n, i) => `<option value="${i + 1}">${n} ${insightsScope.year}</option>`).join('');
  mSel.value = String(insightsScope.month);
  mSel.style.display = insightsScope.mode === 'month' ? '' : 'none';
}

// Fetch + cache the scoped months' details and the scoped transactions, then
// re-render. Uses the existing fetchMonthDetail / fetchAllTransactions helpers.
async function loadInsightsData() {
  const months = monthsForScope(insightsScope);
  const details = await Promise.all(months.map(m => fetchMonthDetail(m, { quiet: true })));
  insightsMonths = months.map((m, i) => details[i]
    ? processMonth(details[i], m)
    : { month: m, label: fmtMonth(m), shortLabel: fmtMonth(m, true), total: 0, categories: [], groupTotals: {}, budgetRows: [] });
  const since = months[0];
  const before = nextYNABMonth(months[months.length - 1]);
  const data = await fetchAllTransactions(since, 0, { quiet: true });
  insightsTxns = (data.transactions || []).filter(t => !t.deleted && t.date >= since && t.date < before);
}

function setInsightsMode(mode) {
  insightsScope.mode = mode;
  document.getElementById('scopeYearBtn').classList.toggle('active', mode === 'year');
  document.getElementById('scopeMonthBtn').classList.toggle('active', mode === 'month');
  document.getElementById('scopeMonth').style.display = mode === 'month' ? '' : 'none';
  renderInsights();
}
function onScopeYearChange() { insightsScope.year = +document.getElementById('scopeYear').value; populateScopePickers(); renderInsights(); }
function onScopeMonthChange() { insightsScope.month = +document.getElementById('scopeMonth').value; renderInsights(); }

async function openInsights() {
  if (!activeBudget || !Array.isArray(monthData) || !monthData.length) return;
  showScreen('insights');
  populateScopePickers();
  await renderInsights();
}
function closeInsights() { showScreen('dashboard'); }

// Load scoped data, then (re)draw every Insights chart for the current scope.
async function renderInsights() {
  await loadInsightsData();
  renderBudgetVsActual();
  try { await loadScriptOnce('https://cdn.jsdelivr.net/npm/chartjs-chart-matrix@2'); renderHeatmap(); }
  catch (e) { showChartError('heatmapEmpty', "Couldn't load the heatmap library — check your connection."); }
  try { await loadScriptOnce('https://cdn.jsdelivr.net/npm/chartjs-chart-sankey@0.12.0'); renderSankey(); }
  catch (e) { showChartError('sankeyEmpty', "Couldn't load the flow-diagram library — check your connection."); }
  renderInsightsTrends();
  renderDayOfWeek();
  renderBurnRate();
  renderHistogram();
  renderFreqSize();
}

// Re-render Insights charts if the screen is currently showing (e.g. after a
// period or budget change refreshes monthData/txIndex). Safe to call anytime.
function refreshInsightsIfOpen() {
  const ins = document.getElementById('insights');
  if (!ins || getComputedStyle(ins).display === 'none') return;
  renderInsights();
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
  const rows = budgetVsActual(insightsMonths);
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

// ── Daily-spend calendar heatmap (chartjs-chart-matrix), scope-aware ──
function heatColor(v, max) {
  if (!v || max <= 0) return '#ebedf0';
  const t = Math.min(1, v / max);
  // interpolate #c6e0f5 -> #2b6cb0
  const a = [198, 224, 245], b = [43, 108, 176];
  const ch = a.map((c, i) => Math.round(c + (b[i] - c) * t));
  return `rgb(${ch[0]},${ch[1]},${ch[2]})`;
}

function renderHeatmap() {
  const totals = dailyTotals(insightsTxns);
  const empty = document.getElementById('heatmapEmpty');
  const subtitle = document.getElementById('heatmapSubtitle');
  const legend = document.getElementById('heatmapLegend');
  const months = monthsForScope(insightsScope);
  const scopeLabel = insightsScope.mode === 'year'
    ? `Daily spend · ${insightsScope.year}`
    : `Daily spend · ${fmtMonth(months[0])}`;
  if (subtitle) subtitle.textContent = scopeLabel;

  if (!totals.length) { empty.style.display = 'block'; if (legend) legend.innerHTML = ''; return; }
  empty.style.display = 'none';

  const map = {}; let max = 0;
  for (const d of totals) { map[d.date] = d.amount; if (d.amount > max) max = d.amount; }

  // Grid spans the whole scope window (so empty days show), not just spend days.
  const start = new Date(months[0] + 'T12:00:00Z');
  const endExclusive = new Date(nextYNABMonth(months[months.length - 1]) + 'T12:00:00Z');
  // Anchor week columns to the Sunday on/before start so weekday rows line up.
  const gridStart = new Date(start); gridStart.setUTCDate(gridStart.getUTCDate() - gridStart.getUTCDay());

  const cells = []; const monthTicks = {};
  for (let dt = new Date(gridStart); dt < endExclusive; dt.setUTCDate(dt.getUTCDate() + 1)) {
    const iso = dt.toISOString().slice(0, 10);
    const inScope = dt >= start && dt < endExclusive;
    const week = Math.floor((dt - gridStart) / (7 * 864e5));
    if (dt.getUTCDate() === 1) monthTicks[week] = dt.toLocaleString('default', { month: 'short', timeZone: 'UTC' });
    cells.push({ x: week, y: dt.getUTCDay(), d: iso, v: inScope ? (map[iso] || 0) : null });
  }
  const weeks = cells.length ? cells[cells.length - 1].x + 1 : 1;
  const dayLabels = ['', 'Mon', '', 'Wed', '', 'Fri', ''];

  makeChart('heatmapChart', {
    type: 'matrix',
    data: { datasets: [{
      label: 'Daily spend',
      data: cells,
      width: (c) => Math.max(3, ((c.chart.chartArea || {}).width || 0) / weeks - 2),
      height: (c) => Math.max(3, ((c.chart.chartArea || {}).height || 0) / 7 - 2),
      backgroundColor: (c) => c.raw.v === null ? 'transparent' : heatColor(c.raw.v, max),
      borderWidth: 0,
    }]},
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: { filter: (i) => i.raw.v !== null, callbacks: { title: (i) => i[0].raw.d, label: (i) => fmtMoney(i.raw.v || 0) } },
      },
      scales: {
        x: { type: 'linear', position: 'top', offset: true, min: 0, max: weeks,
             ticks: { stepSize: 1, autoSkip: false, callback: (v) => monthTicks[v] || '' }, grid: { display: false } },
        y: { type: 'linear', offset: true, min: -0.5, max: 6.5, reverse: true,
             ticks: { stepSize: 1, callback: (v) => dayLabels[v] || '' }, grid: { display: false } },
      },
    },
  });

  if (legend) {
    const stops = [0, 0.25, 0.5, 0.75, 1].map(t => heatColor(t * max || (t === 0 ? 0 : 1), max));
    legend.innerHTML = '<span>Less</span>' + stops.map(c => `<span class="sw" style="background:${c}"></span>`).join('') + '<span>More</span>';
  }
}

// Month-over-month group charts for the Insights Yearly view. Hidden in Monthly.
function renderInsightsTrends() {
  const monthly = insightsScope.mode === 'month';
  const trendCard = document.getElementById('groupTrendCard');
  const stackCard = document.getElementById('groupStackCard');
  const hint = document.getElementById('trendMonthlyHint');
  trendCard.style.display = monthly ? 'none' : '';
  stackCard.style.display = monthly ? 'none' : '';
  hint.style.display = monthly ? 'block' : 'none';
  if (monthly) return;

  const labels = insightsMonths.map(m => m.shortLabel);
  const groups = [...new Set(insightsMonths.flatMap(m => Object.keys(m.groupTotals)))];
  const datasets = groups.map(g => ({
    label: g, data: insightsMonths.map(m => m.groupTotals[g] || 0),
    borderColor: groupColor(g), backgroundColor: groupColor(g),
  }));

  makeChart('insightsGroupTrend', {
    type: 'line',
    data: { labels, datasets: datasets.map(d => ({ ...d, fill: false, tension: 0.3, borderWidth: 2, pointRadius: 3 })) },
    options: { responsive: true, plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 10 } } } }, scales: { y: { beginAtZero: true, ticks: { callback: (v) => '$' + v } } } },
  });
  makeChart('insightsGroupStack', {
    type: 'bar',
    data: { labels, datasets: datasets.map(d => ({ ...d, borderWidth: 0 })) },
    options: { responsive: true, plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 10 } } } }, scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, ticks: { callback: (v) => '$' + v } } } },
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
  const flows = sankeyFlows(insightsMonths);
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

// Expand an Insights scope into the YNAB month-start strings it covers.
// scope = { mode:'year', year } | { mode:'month', year, month(1-12) }
function monthsForScope(scope) {
  if (scope.mode === 'month') {
    return [`${scope.year}-${String(scope.month).padStart(2, '0')}-01`];
  }
  const out = [];
  for (let m = 1; m <= 12; m++) out.push(`${scope.year}-${String(m).padStart(2, '0')}-01`);
  return out;
}

// ════════════ Wave 2: timing & distribution ════════════

// Sum outflow spending by weekday across the given transactions (dollars).
// Output: [{day:0..6, total}] with day 0 = Sunday.
function dayOfWeekTotals(txns) {
  const buckets = [0, 0, 0, 0, 0, 0, 0];
  for (const t of txns || []) {
    if (!t || t.deleted || t.transfer_account_id) continue;
    if (typeof t.amount !== 'number' || t.amount >= 0) continue;
    const dow = new Date(t.date + 'T12:00:00Z').getUTCDay();
    buckets[dow] += Math.abs(t.amount) / 1000;
  }
  return buckets.map((total, day) => ({ day, total }));
}

// Cumulative outflow spend by day-of-month, one series per calendar month
// present in the transactions. Output: [{label:'YYYY-MM', data:[{x:day,y:cum}]}]
// sorted by month ascending; each series runs day 1..daysInMonth.
function cumulativeByMonth(txns) {
  const byMonth = {};
  for (const t of txns || []) {
    if (!t || t.deleted || t.transfer_account_id) continue;
    if (typeof t.amount !== 'number' || t.amount >= 0) continue;
    const ym = t.date.slice(0, 7);
    const day = +t.date.slice(8, 10);
    (byMonth[ym] || (byMonth[ym] = {}))[day] = (byMonth[ym][day] || 0) + Math.abs(t.amount) / 1000;
  }
  return Object.keys(byMonth).sort().map(ym => {
    const [y, m] = ym.split('-').map(Number);
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const days = byMonth[ym];
    let cum = 0;
    const data = [];
    for (let d = 1; d <= daysInMonth; d++) { cum += days[d] || 0; data.push({ x: d, y: +cum.toFixed(2) }); }
    return { label: ym, data };
  });
}

// Distribution of outflow transaction sizes into fixed dollar bins.
// Output: [{label, count}] in ascending bin order.
function amountHistogram(txns) {
  const edges = [0, 25, 50, 100, 250, 500, Infinity];
  const labels = ['$0–25', '$25–50', '$50–100', '$100–250', '$250–500', '$500+'];
  const counts = new Array(labels.length).fill(0);
  for (const t of txns || []) {
    if (!t || t.deleted || t.transfer_account_id) continue;
    if (typeof t.amount !== 'number' || t.amount >= 0) continue;
    const v = Math.abs(t.amount) / 1000;
    for (let i = 0; i < edges.length - 1; i++) {
      if (v >= edges[i] && v < edges[i + 1]) { counts[i]++; break; }
    }
  }
  return labels.map((label, i) => ({ label, count: counts[i] }));
}

// Per-category spending frequency and size. Output: [{label, count, total, avg}].
function freqSizeByCategory(txns) {
  const by = {};
  for (const t of txns || []) {
    if (!t || t.deleted || t.transfer_account_id) continue;
    if (typeof t.amount !== 'number' || t.amount >= 0) continue;
    const cat = t.category_name || 'Uncategorized';
    const v = Math.abs(t.amount) / 1000;
    const e = by[cat] || (by[cat] = { label: cat, count: 0, total: 0 });
    e.count++; e.total += v;
  }
  return Object.values(by).map(e => ({ label: e.label, count: e.count, total: +e.total.toFixed(2), avg: +(e.total / e.count).toFixed(2) }));
}

// ── Spending by day of week (radar) ──
function renderDayOfWeek() {
  const rows = dayOfWeekTotals(insightsTxns);
  const empty = document.getElementById('dowEmpty');
  if (!rows.some(r => r.total > 0)) { empty.style.display = 'block'; return; }
  empty.style.display = 'none';
  const labels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  makeChart('dowChart', {
    type: 'radar',
    data: { labels, datasets: [{ label: 'Spending', data: rows.map(r => r.total), borderColor: '#4299e1', backgroundColor: 'rgba(66,153,225,0.18)', borderWidth: 2, pointBackgroundColor: '#4299e1' }] },
    options: { responsive: true, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => fmtMoney(c.parsed.r) } } }, scales: { r: { beginAtZero: true, ticks: { callback: (v) => '$' + v } } } },
  });
}

// ── Cumulative burn-rate (one line per month) ──
function renderBurnRate() {
  const series = cumulativeByMonth(insightsTxns);
  const empty = document.getElementById('burnEmpty');
  if (!series.length) { empty.style.display = 'block'; return; }
  empty.style.display = 'none';
  const palette = ['#4299e1', '#48bb78', '#ed8936', '#9f7aea', '#e53e3e', '#38b2ac', '#d69e2e', '#667eea', '#f56565', '#319795', '#dd6b20', '#805ad5'];
  makeChart('burnChart', {
    type: 'line',
    data: { datasets: series.map((s, i) => ({ label: s.label, data: s.data, borderColor: palette[i % palette.length], backgroundColor: palette[i % palette.length], borderWidth: 2, pointRadius: 0, tension: 0.15 })) },
    options: {
      responsive: true, parsing: false,
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 10 } } }, tooltip: { callbacks: { title: (i) => 'Day ' + i[0].parsed.x, label: (c) => `${c.dataset.label}: ${fmtMoney(c.parsed.y)}` } } },
      scales: { x: { type: 'linear', min: 1, max: 31, title: { display: true, text: 'Day of month' }, ticks: { stepSize: 5 } }, y: { beginAtZero: true, ticks: { callback: (v) => '$' + v } } },
    },
  });
}

// ── Transaction-size histogram (bar) ──
function renderHistogram() {
  const bins = amountHistogram(insightsTxns);
  const empty = document.getElementById('histEmpty');
  if (!bins.some(b => b.count > 0)) { empty.style.display = 'block'; return; }
  empty.style.display = 'none';
  makeChart('histChart', {
    type: 'bar',
    data: { labels: bins.map(b => b.label), datasets: [{ label: 'Transactions', data: bins.map(b => b.count), backgroundColor: '#4299e1', borderWidth: 0 }] },
    options: { responsive: true, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${c.parsed.y} transactions` } } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } },
  });
}

// ── Frequency × size bubble (one bubble per category) ──
function renderFreqSize() {
  const rows = freqSizeByCategory(insightsTxns);
  const empty = document.getElementById('bubbleEmpty');
  if (!rows.length) { empty.style.display = 'block'; return; }
  empty.style.display = 'none';
  const maxTotal = Math.max(...rows.map(r => r.total), 1);
  makeChart('bubbleChart', {
    type: 'bubble',
    data: {
      datasets: rows.map(r => ({
        label: r.label,
        data: [{ x: r.count, y: r.avg, r: 6 + 22 * Math.sqrt(r.total / maxTotal) }],
        backgroundColor: groupColor(r.label) + 'cc',
        borderColor: groupColor(r.label),
        borderWidth: 1,
      })),
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${c.raw.x}× · avg ${fmtMoney(c.raw.y)}` } },
      },
      scales: {
        x: { beginAtZero: true, title: { display: true, text: 'Number of transactions' }, ticks: { precision: 0 } },
        y: { beginAtZero: true, title: { display: true, text: 'Average size' }, ticks: { callback: (v) => '$' + v } },
      },
    },
  });
}

// ── CommonJS export guard (Node tests only; ignored in the browser) ──
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { budgetVsActual, dailyTotals, sankeyFlows, groupComposition, monthsForScope, dayOfWeekTotals, cumulativeByMonth, amountHistogram, freqSizeByCategory };
}
