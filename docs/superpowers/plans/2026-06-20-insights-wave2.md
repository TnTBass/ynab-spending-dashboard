# Insights Wave 2 — Timing & Distribution Charts

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add four native Chart.js charts to the Insights screen, all respecting the existing Yearly/Monthly scope: a **Day-of-week radar**, a **cumulative burn-rate** line, a **transaction-size histogram**, and a **frequency×size bubble**. No new CDN plugins.

**Architecture:** Each chart gets a pure shaper (unit-tested via `node:test`) that consumes `insightsTxns` (the scoped raw transactions established in Insights v2) and a render function that draws via the existing `makeChart()`. New cards go in the `#insights .grid`; each render is called from `renderInsights()` so it redraws on every scope change. All four work in both Yearly and Monthly scope (no hiding).

**Tech Stack:** Vanilla JS, Chart.js (already loaded — radar/line/bar/bubble are all built-in), `node:test`.

**Design reference:** `docs/superpowers/specs/2026-06-19-insights-charts-design.md` (charts 4, 5, 8, 9). Builds on `docs/superpowers/plans/2026-06-20-insights-v2.md` (scope model).

---

## Current-state facts (verified, post-v2)

- `public/insights.js` is a classic browser script: pure shapers at top-ish, render fns below, CommonJS export guard at the very bottom (`module.exports = { budgetVsActual, dailyTotals, sankeyFlows, groupComposition, monthsForScope }`). No load-time side effects except declarations + the guard.
- Globals available at runtime: `insightsTxns` (array of raw YNAB txns in scope), `insightsScope` ({mode,year,month}), `insightsMonths`, `makeChart(id,cfg)`, `groupColor(name)`, `fmtMoney(n)`.
- `renderInsights()` (in insights.js) loads scoped data then calls `renderBudgetVsActual()`, `renderHeatmap()`, `renderSankey()`, `renderInsightsTrends()`. Wave-2 render calls are appended here.
- Outflow convention (reuse in every shaper): skip when `!t || t.deleted || t.transfer_account_id`; skip when `typeof t.amount !== 'number' || t.amount >= 0`; dollars = `Math.abs(t.amount)/1000`. Parent rows only (no split descent).
- Insights cards live in `#insights .grid` (`public/index.html`, after the Wave-1.5 trend/stack cards `#groupTrendCard`/`#groupStackCard` and the `#trendMonthlyHint`). New cards go after those.
- Tests: `node --test test/insights.test.js` (currently 10 passing).
- Insights `.insights-empty` CSS class exists for empty states.

---

### Task 1: Day-of-week radar (`dayOfWeekTotals`)

**Files:** Modify `public/insights.js`, `test/insights.test.js`, `public/index.html`.

- [ ] **Step 1: Failing test.** Append to `test/insights.test.js`:

```js
const { dayOfWeekTotals } = require('../public/insights.js');

test('dayOfWeekTotals buckets outflow dollars by weekday (Sun=0)', () => {
  // 2026-06-07 is a Sunday; 2026-06-08 a Monday.
  const txns = [
    { date: '2026-06-07', amount: -10000 },                 // Sun $10
    { date: '2026-06-07', amount: -5000 },                  // Sun $5
    { date: '2026-06-08', amount: -2000 },                  // Mon $2
    { date: '2026-06-08', amount: 9000 },                   // inflow ignored
    { date: '2026-06-08', amount: -1000, transfer_account_id: 'a' }, // transfer ignored
  ];
  const out = dayOfWeekTotals(txns);
  assert.strictEqual(out.length, 7);
  assert.strictEqual(out[0].total, 15); // Sunday
  assert.strictEqual(out[1].total, 2);  // Monday
  assert.strictEqual(out[2].total, 0);  // Tuesday
});
```

- [ ] **Step 2: Run `node --test test/insights.test.js` → FAIL** (`dayOfWeekTotals is not a function`).

- [ ] **Step 3: Add the shaper** to `public/insights.js` after `monthsForScope` (before the export guard):

```js
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
```

Add `dayOfWeekTotals` to the export guard.

- [ ] **Step 4: Run `node --test test/insights.test.js` → PASS** (11 tests).

- [ ] **Step 5: Add the card.** In `public/index.html`, inside `#insights .grid`, after the `#trendMonthlyHint` element, add:

```html
      <div class="card">
        <h2>📆 Spending by day of week</h2>
        <div id="dowEmpty" class="insights-empty" style="display:none">No transactions in scope.</div>
        <canvas id="dowChart" height="200"></canvas>
      </div>
```

- [ ] **Step 6: Add the render fn** to `public/insights.js` after `renderInsightsTrends()`:

```js
// ── Spending by day of week (radar) ──
function renderDayOfWeek() {
  const rows = dayOfWeekTotals(insightsTxns);
  const empty = document.getElementById('dowEmpty');
  const any = rows.some(r => r.total > 0);
  if (!any) { empty.style.display = 'block'; return; }
  empty.style.display = 'none';
  const labels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  makeChart('dowChart', {
    type: 'radar',
    data: { labels, datasets: [{ label: 'Spending', data: rows.map(r => r.total), borderColor: '#4299e1', backgroundColor: 'rgba(66,153,225,0.18)', borderWidth: 2, pointBackgroundColor: '#4299e1' }] },
    options: { responsive: true, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => fmtMoney(c.parsed.r) } } }, scales: { r: { beginAtZero: true, ticks: { callback: (v) => '$' + v } } } },
  });
}
```

- [ ] **Step 7: Call it from `renderInsights()`** — add `renderDayOfWeek();` after the `renderInsightsTrends();` call.

- [ ] **Step 8: Commit**

```bash
git add public/insights.js test/insights.test.js public/index.html
git commit -m "feat(insights): day-of-week spending radar"
```

---

### Task 2: Cumulative burn-rate line (`cumulativeByMonth`)

**Files:** Modify `public/insights.js`, `test/insights.test.js`, `public/index.html`.

- [ ] **Step 1: Failing test.** Append:

```js
const { cumulativeByMonth } = require('../public/insights.js');

test('cumulativeByMonth returns per-month cumulative-by-day series', () => {
  const txns = [
    { date: '2026-06-02', amount: -10000 }, // $10 on day 2
    { date: '2026-06-05', amount: -5000 },  // $5 on day 5 → cum 15
    { date: '2026-04-10', amount: -4000 },  // separate month
  ];
  const series = cumulativeByMonth(txns);
  const june = series.find(s => s.label === '2026-06');
  assert.strictEqual(june.data.length, 30);          // June has 30 days
  assert.deepStrictEqual(june.data[0], { x: 1, y: 0 });   // day 1 no spend
  assert.deepStrictEqual(june.data[1], { x: 2, y: 10 });  // day 2
  assert.deepStrictEqual(june.data[4], { x: 5, y: 15 });  // day 5 cumulative
  assert.deepStrictEqual(june.data[29], { x: 30, y: 15 }); // carries to month end
  // sorted ascending by month label
  assert.strictEqual(series[0].label, '2026-04');
});
```

- [ ] **Step 2: Run → FAIL** (`cumulativeByMonth is not a function`).

- [ ] **Step 3: Add the shaper** after `dayOfWeekTotals`:

```js
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
```

Add `cumulativeByMonth` to the export guard.

- [ ] **Step 4: Run → PASS** (12 tests).

- [ ] **Step 5: Add the card.** After the day-of-week card in `#insights .grid`:

```html
      <div class="card">
        <h2>🏃 Spending pace (cumulative by day)</h2>
        <div class="hint">Each line is a month; steeper = faster spending</div>
        <div id="burnEmpty" class="insights-empty" style="display:none">No transactions in scope.</div>
        <canvas id="burnChart" height="200"></canvas>
      </div>
```

- [ ] **Step 6: Add the render fn** after `renderDayOfWeek()`:

```js
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
```

- [ ] **Step 7: Call `renderBurnRate();`** from `renderInsights()` after `renderDayOfWeek();`.

- [ ] **Step 8: Commit**

```bash
git add public/insights.js test/insights.test.js public/index.html
git commit -m "feat(insights): cumulative burn-rate line chart"
```

---

### Task 3: Transaction-size histogram (`amountHistogram`)

**Files:** Modify `public/insights.js`, `test/insights.test.js`, `public/index.html`.

- [ ] **Step 1: Failing test.** Append:

```js
const { amountHistogram } = require('../public/insights.js');

test('amountHistogram bins outflow transaction sizes', () => {
  const txns = [
    { date: '2026-06-01', amount: -10000 },  // $10 → $0–25
    { date: '2026-06-01', amount: -24999 },  // ~$25 → $0–25
    { date: '2026-06-01', amount: -30000 },  // $30 → $25–50
    { date: '2026-06-01', amount: -600000 }, // $600 → $500+
    { date: '2026-06-01', amount: 9000 },    // inflow ignored
  ];
  const bins = amountHistogram(txns);
  assert.strictEqual(bins.length, 6);
  assert.strictEqual(bins[0].label, '$0–25');
  assert.strictEqual(bins[0].count, 2);
  assert.strictEqual(bins[1].count, 1);   // $25–50
  assert.strictEqual(bins[5].count, 1);   // $500+
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Add the shaper** after `cumulativeByMonth`:

```js
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
```

Add `amountHistogram` to the export guard.

- [ ] **Step 4: Run → PASS** (13 tests).

- [ ] **Step 5: Add the card.** After the burn-rate card:

```html
      <div class="card">
        <h2>📊 Transaction sizes</h2>
        <div class="hint">How many transactions fall in each dollar range</div>
        <div id="histEmpty" class="insights-empty" style="display:none">No transactions in scope.</div>
        <canvas id="histChart" height="200"></canvas>
      </div>
```

- [ ] **Step 6: Add the render fn** after `renderBurnRate()`:

```js
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
```

- [ ] **Step 7: Call `renderHistogram();`** from `renderInsights()` after `renderBurnRate();`.

- [ ] **Step 8: Commit**

```bash
git add public/insights.js test/insights.test.js public/index.html
git commit -m "feat(insights): transaction-size histogram"
```

---

### Task 4: Frequency × size bubble (`freqSizeByCategory`)

**Files:** Modify `public/insights.js`, `test/insights.test.js`, `public/index.html`.

- [ ] **Step 1: Failing test.** Append:

```js
const { freqSizeByCategory } = require('../public/insights.js');

test('freqSizeByCategory aggregates count, total, avg per category', () => {
  const txns = [
    { date: '2026-06-01', amount: -10000, category_name: 'Groceries' }, // $10
    { date: '2026-06-02', amount: -20000, category_name: 'Groceries' }, // $20
    { date: '2026-06-03', amount: -50000, category_name: 'Rent' },      // $50
    { date: '2026-06-04', amount: -1000, category_name: 'Rent', transfer_account_id: 'a' }, // ignored
  ];
  const rows = freqSizeByCategory(txns);
  const groc = rows.find(r => r.label === 'Groceries');
  assert.strictEqual(groc.count, 2);
  assert.strictEqual(groc.total, 30);
  assert.strictEqual(groc.avg, 15);
  const rent = rows.find(r => r.label === 'Rent');
  assert.strictEqual(rent.count, 1);
  assert.strictEqual(rent.avg, 50);
});

test('freqSizeByCategory labels missing category as Uncategorized', () => {
  const rows = freqSizeByCategory([{ date: '2026-06-01', amount: -5000 }]);
  assert.strictEqual(rows[0].label, 'Uncategorized');
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Add the shaper** after `amountHistogram`:

```js
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
```

Add `freqSizeByCategory` to the export guard.

- [ ] **Step 4: Run → PASS** (15 tests).

- [ ] **Step 5: Add the card.** After the histogram card:

```html
      <div class="card full">
        <h2>🫧 Frequency vs. size by category</h2>
        <div class="hint">Right = more often · Up = bigger average · Bubble = total spent</div>
        <div id="bubbleEmpty" class="insights-empty" style="display:none">No transactions in scope.</div>
        <canvas id="bubbleChart" height="220"></canvas>
      </div>
```

- [ ] **Step 6: Add the render fn** after `renderHistogram()`:

```js
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
```

> `groupColor()` here is keyed by category label (not group); it still returns a stable color per distinct string, which is fine for visual separation.

- [ ] **Step 7: Call `renderFreqSize();`** from `renderInsights()` after `renderHistogram();`.

- [ ] **Step 8: Commit**

```bash
git add public/insights.js test/insights.test.js public/index.html
git commit -m "feat(insights): frequency-vs-size bubble chart"
```

---

## Self-Review

**Coverage:** Day-of-week radar → T1 (chart 4). Burn-rate → T2 (chart 5). Histogram → T3 (chart 8). Bubble → T4 (chart 9). All scope-aware via `insightsTxns`; all called from `renderInsights()` so they redraw on scope change. ✓

**Placeholder scan:** Complete code for every shaper, render fn, test, and markup block. ✓

**Type/name consistency:** Shapers `dayOfWeekTotals`/`cumulativeByMonth`/`amountHistogram`/`freqSizeByCategory` each added to the export guard and consumed by exactly one render fn. Canvas/empty ids unique: `dowChart`/`dowEmpty`, `burnChart`/`burnEmpty`, `histChart`/`histEmpty`, `bubbleChart`/`bubbleEmpty`. Each render call appended to `renderInsights()` in order. Outflow filter identical across all four shapers and matches existing `dailyTotals`. ✓

**Risks:** Burn-rate uses `parsing: false` with `{x,y}` data — Chart.js requires a `linear` x scale (configured). Bubble radius scales by `sqrt(total/maxTotal)`; a single-category scope still renders (maxTotal floor of 1 avoids divide-by-zero).
