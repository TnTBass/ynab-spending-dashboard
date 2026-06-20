# Insights Tab — Wave 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Insights" screen reachable from the dashboard header, containing the three flagship Wave-1 charts — Budget vs. Actual, a daily-spend Calendar Heatmap, and a Spending Sankey — reusing already-loaded `monthData` and `txIndex`.

**Architecture:** A new `public/insights.js` classic script holds pure data-shaping functions (unit-tested in Node) plus chart/render functions (verified manually in the browser preview). The Insights screen is a new `<div id="insights">` toggled via the existing `showScreen()` mechanism, mirroring the Search screen. Two Chart.js plugins (matrix, sankey) are lazy-loaded from jsDelivr only when Insights is opened.

**Tech Stack:** Vanilla JS, Chart.js (already loaded via jsDelivr), `chartjs-chart-matrix` + `chartjs-chart-sankey` (lazy CDN), Node's built-in `node:test`/`node:assert` for the pure shapers, Cloudflare Worker static serving (unchanged).

**Design reference:** `docs/superpowers/specs/2026-06-19-insights-charts-design.md`

---

## File Structure

- **Create `public/insights.js`** — all Wave-1 Insights logic:
  - Pure shapers: `budgetVsActual(monthData)`, `dailyTotals(txns)`, `sankeyFlows(monthData)`
  - Browser-only: `loadScriptOnce(src)`, `openInsights()`, `closeInsights()`, `renderBudgetVsActual()`, `renderHeatmap()`, `renderSankey()`, `showChartError()`
  - Ends with a CommonJS export guard so Node can `require()` the pure shapers.
  - **Invariant:** no code executes at load time except function declarations and the export guard. Everything touching `document`/`Chart`/`monthData`/`txIndex` lives inside functions called at runtime. This keeps the file `require()`-safe in Node.
- **Create `test/insights.test.js`** — `node:test` unit tests for the three pure shapers.
- **Modify `public/index.html`**:
  - Add an "📊 Insights" button to the dashboard header (next to the Search button).
  - Add the `<div id="insights">` screen markup (sub-sections + canvases + empty-state divs).
  - Add `<script src="insights.js"></script>` after the main inline script.
  - Extend `processMonth()` to also return `budgetRows` (and add `budgetRows: []` to the fallback object in `loadData()`).

**Field facts this plan relies on (verified in current code):**
- `txIndex` is a `Map<id, tx>`; `[...txIndex.values()]` yields raw YNAB transactions.
- Transaction outflow test: `t.amount < 0`; dollar value is `Math.abs(t.amount)/1000`.
- Transfers carry `t.transfer_account_id` (truthy) — excluded from spend shapers.
- `monthData[i].categories` = `[{id, name, group, amount}]` (outflow-only, dollars).
- `processMonth()` is at `public/index.html:1182`; the `loadData()` fallback object is at `public/index.html:1208-1209`.
- `makeChart(id, config)` (at `public/index.html:2008`) destroys any existing chart for `id` then `new Chart(...)` — reuse it for leak-free re-renders.
- `showScreen('dashboard')` shows the dashboard screen; the Search button lives near `public/index.html:515`.

---

### Task 1: Bootstrap `insights.js` + Node test harness + `budgetVsActual` shaper

**Files:**
- Create: `public/insights.js`
- Create: `test/insights.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/insights.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const { budgetVsActual } = require('../public/insights.js');

test('budgetVsActual aggregates budgeted and actual by group across months', () => {
  const monthData = [
    { budgetRows: [
      { group: 'Food', name: 'Groceries', budgeted: 400, actual: 350 },
      { group: 'Food', name: 'Dining',    budgeted: 100, actual: 160 },
      { group: 'Fun',  name: 'Games',     budgeted: 50,  actual: 0   },
    ] },
    { budgetRows: [
      { group: 'Food', name: 'Groceries', budgeted: 400, actual: 420 },
    ] },
  ];
  const rows = budgetVsActual(monthData);
  const food = rows.find(r => r.name === 'Food');
  assert.strictEqual(food.budgeted, 900);   // 400+100+400
  assert.strictEqual(food.actual, 930);      // 350+160+420
  // Sorted by actual desc → Food first
  assert.strictEqual(rows[0].name, 'Food');
  // Fun kept because it has budget even with zero spend
  assert.ok(rows.some(r => r.name === 'Fun'));
});

test('budgetVsActual tolerates months without budgetRows', () => {
  assert.deepStrictEqual(budgetVsActual([{}, { budgetRows: [] }]), []);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/insights.test.js`
Expected: FAIL — `Cannot find module '../public/insights.js'`.

- [ ] **Step 3: Create `public/insights.js` with the shaper + export guard**

```js
/* Insights screen — charts and data-shapers for Spending Dashboard for YNAB.
 * Pure shapers are unit-tested via Node (test/insights.test.js); browser-only
 * render code is verified in the preview. No code runs at load time except
 * function declarations and the export guard at the bottom. */

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

// ── CommonJS export guard (Node tests only; ignored in the browser) ──
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { budgetVsActual };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/insights.test.js`
Expected: PASS — 2 tests passing.

- [ ] **Step 5: Commit**

```bash
git add public/insights.js test/insights.test.js
git commit -m "feat(insights): budgetVsActual shaper + Node test harness"
```

---

### Task 2: `dailyTotals` shaper (daily spend for the heatmap)

**Files:**
- Modify: `public/insights.js`
- Modify: `test/insights.test.js`

- [ ] **Step 1: Write the failing test**

Append to `test/insights.test.js`:

```js
const { dailyTotals } = require('../public/insights.js');

test('dailyTotals sums outflows per day, in dollars, sorted ascending', () => {
  const txns = [
    { date: '2026-05-02', amount: -12000 },                 // $12 outflow
    { date: '2026-05-02', amount: -3000 },                  // $3 outflow same day
    { date: '2026-05-01', amount: -5000 },                  // $5 outflow
    { date: '2026-05-03', amount:  9000 },                  // inflow → ignored
    { date: '2026-05-03', amount: -1000, transfer_account_id: 'acc1' }, // transfer → ignored
    { date: '2026-05-04', amount: -2000, deleted: true },   // deleted → ignored
  ];
  assert.deepStrictEqual(dailyTotals(txns), [
    { date: '2026-05-01', amount: 5 },
    { date: '2026-05-02', amount: 15 },
  ]);
});

test('dailyTotals returns [] for empty input', () => {
  assert.deepStrictEqual(dailyTotals([]), []);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/insights.test.js`
Expected: FAIL — `dailyTotals is not a function` (undefined import).

- [ ] **Step 3: Add the shaper to `public/insights.js`**

Insert directly after the `budgetVsActual` function:

```js
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
```

Update the export guard at the bottom of the file:

```js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { budgetVsActual, dailyTotals };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/insights.test.js`
Expected: PASS — 4 tests passing.

- [ ] **Step 5: Commit**

```bash
git add public/insights.js test/insights.test.js
git commit -m "feat(insights): dailyTotals shaper for calendar heatmap"
```

---

### Task 3: `sankeyFlows` shaper (Spending → Group → Category)

**Files:**
- Modify: `public/insights.js`
- Modify: `test/insights.test.js`

- [ ] **Step 1: Write the failing test**

Append to `test/insights.test.js`:

```js
const { sankeyFlows } = require('../public/insights.js');

test('sankeyFlows builds Spending→Group and Group→Category flows', () => {
  const monthData = [
    { categories: [
      { name: 'Groceries', group: 'Food', amount: 300 },
      { name: 'Dining',    group: 'Food', amount: 200 },
      { name: 'Games',     group: 'Fun',  amount: 50  },
    ] },
    { categories: [
      { name: 'Groceries', group: 'Food', amount: 100 },
    ] },
  ];
  const flows = sankeyFlows(monthData);
  // Spending → Food = 300+200+100 = 600
  assert.deepStrictEqual(
    flows.find(f => f.from === 'Spending' && f.to === 'Food'),
    { from: 'Spending', to: 'Food', flow: 600 }
  );
  // Spending → Fun = 50
  assert.deepStrictEqual(
    flows.find(f => f.from === 'Spending' && f.to === 'Fun'),
    { from: 'Spending', to: 'Fun', flow: 50 }
  );
  // Food → Groceries = 300+100 = 400
  assert.deepStrictEqual(
    flows.find(f => f.from === 'Food' && f.to === 'Groceries'),
    { from: 'Food', to: 'Groceries', flow: 400 }
  );
});

test('sankeyFlows returns [] when there is no spend', () => {
  assert.deepStrictEqual(sankeyFlows([{ categories: [] }]), []);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/insights.test.js`
Expected: FAIL — `sankeyFlows is not a function`.

- [ ] **Step 3: Add the shaper to `public/insights.js`**

Insert directly after the `dailyTotals` function:

```js
// Build Sankey flows from monthData: a single "Spending" root → each group,
// then each group → its categories. Amounts are summed across loaded months
// (dollars). Output: [{from, to, flow}] with flow > 0.
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
      const key = c.group + ' ' + c.name;
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
```

Update the export guard at the bottom of the file:

```js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { budgetVsActual, dailyTotals, sankeyFlows };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/insights.test.js`
Expected: PASS — 6 tests passing.

- [ ] **Step 5: Commit**

```bash
git add public/insights.js test/insights.test.js
git commit -m "feat(insights): sankeyFlows shaper for spending flow diagram"
```

---

### Task 4: Insights screen scaffold + navigation

**Files:**
- Modify: `public/index.html` (header button near `:515`, new screen markup, script include)

- [ ] **Step 1: Add the Insights button to the dashboard header**

Find the Search button near `public/index.html:515`:

```html
        <button id="dashSearchBtn" class="btn-secondary" onclick="openSearch()" disabled title="Indexing transactions…">🔎 Search</button>
```

Add immediately after it:

```html
        <button id="dashInsightsBtn" class="btn-secondary" onclick="openInsights()">📊 Insights</button>
```

- [ ] **Step 2: Add the Insights screen markup**

Find the closing of the Search screen block (search for `<!-- ── Search ──`, near `public/index.html:563`, and locate that screen's closing `</div>`). Immediately AFTER the Search screen's closing `</div>`, add:

```html
  <!-- ── Insights ─────────────────────────────────────────── -->
  <div id="insights" style="display:none">
    <div class="dash-head">
      <h1>Insights</h1>
      <button class="btn-secondary" onclick="closeInsights()">← Back</button>
    </div>

    <section class="chart-card">
      <h2>💸 Budget vs. Actual</h2>
      <div id="bvaEmpty" class="insights-empty" style="display:none">No budget data for this period.</div>
      <canvas id="bvaChart" height="220"></canvas>
    </section>

    <section class="chart-card">
      <h2>📅 Daily spending heatmap</h2>
      <div id="heatmapEmpty" class="insights-empty" style="display:none">No transactions for this period.</div>
      <canvas id="heatmapChart" height="160"></canvas>
    </section>

    <section class="chart-card">
      <h2>🔀 Spending flow</h2>
      <div id="sankeyEmpty" class="insights-empty" style="display:none">No spending to chart for this period.</div>
      <canvas id="sankeyChart" height="320"></canvas>
    </section>
  </div>
```

> If `class="dash-head"` or `class="chart-card"` do not exist in the file, substitute the equivalent existing classes used by the dashboard's chart sections (search for the existing `<h2>Total Monthly Spending</h2>` wrapper near `:529` and reuse its wrapper class). Add a minimal style for `.insights-empty` in the `<style>` block: `.insights-empty{color:#718096;font-size:0.9rem;padding:8px 0;}`

- [ ] **Step 3: Include the insights script**

Find the closing `</script>` of the main inline script (near the end of `public/index.html`, before `</body>`). Immediately after it add:

```html
  <script src="insights.js"></script>
```

- [ ] **Step 4: Add temporary nav stubs so the screen toggles**

At this point `openInsights`/`closeInsights` don't exist yet. Add them temporarily to the TOP of `public/insights.js` (they will be replaced in Task 5/6/7 — for now they only navigate):

```js
function openInsights() { showScreen('insights'); }
function closeInsights() { showScreen('dashboard'); }
```

- [ ] **Step 5: Verify navigation in the preview**

Start the preview and exercise the nav:

```
preview_start name="wrangler"
```

Then in the browser: connect to YNAB (or load with existing token), click **📊 Insights** in the dashboard header. Verify with `preview_eval`:

```js
(() => {
  const ins = document.getElementById('insights');
  const dash = document.getElementById('dashboard');
  return { insightsDisplay: ins && getComputedStyle(ins).display,
           dashDisplay: dash && getComputedStyle(dash).display };
})()
```

Expected after clicking Insights: `insightsDisplay` is not `"none"`, `dashDisplay` is `"none"`. Click **← Back** and re-run: the reverse. Also confirm three empty `<canvas>` elements and three section headers are present via `preview_snapshot`.

- [ ] **Step 6: Commit**

```bash
git add public/index.html public/insights.js
git commit -m "feat(insights): Insights screen scaffold + header nav"
```

---

### Task 5: Extend `processMonth` for budget data + lazy-loader util + Budget vs. Actual chart

**Files:**
- Modify: `public/index.html` (`processMonth` at `:1182`, `loadData` fallback at `:1208`)
- Modify: `public/insights.js`

- [ ] **Step 1: Extend `processMonth()` to emit `budgetRows`**

In `public/index.html`, inside `processMonth(detail, monthStr)` (starts at `:1182`), build a `budgetRows` array covering all non-skipped, non-deleted categories (regardless of activity sign). Add this loop alongside the existing category loop, before the `return`:

```js
      const budgetRows = [];
      for (const cat of detail.categories ?? []) {
        if (isSkippedGroup(cat.category_group_name) || cat.deleted) continue;
        budgetRows.push({
          group: cat.category_group_name,
          name: cat.name,
          budgeted: (cat.budgeted || 0) / 1000,
          actual: cat.activity < 0 ? Math.abs(cat.activity) / 1000 : 0,
        });
      }
```

Then add `budgetRows` to the returned object:

```js
      return { month: monthStr, label: fmtMonth(monthStr)+(partial?' *':''), shortLabel: fmtMonth(monthStr,true)+(partial?'*':''), total, categories, groupTotals, budgetRows };
```

- [ ] **Step 2: Add `budgetRows: []` to the `loadData` fallback object**

In `loadData()` (near `:1208`), the fallback for a missing month detail currently reads:

```js
        : { month: m, label: fmtMonth(m), shortLabel: fmtMonth(m,true), total:0, categories:[], groupTotals:{} });
```

Change it to include `budgetRows`:

```js
        : { month: m, label: fmtMonth(m), shortLabel: fmtMonth(m,true), total:0, categories:[], groupTotals:{}, budgetRows:[] });
```

- [ ] **Step 3: Add the lazy-loader util and Budget-vs-Actual render to `insights.js`**

In `public/insights.js`, replace the temporary `openInsights`/`closeInsights` stubs from Task 4 with the real versions, and add the loader + render function. Place the loader near the top (after the stubs’ former location) and the render function after the shapers:

```js
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
```

- [ ] **Step 4: Wire `openInsights` to render Budget vs. Actual**

Replace the temporary stubs with:

```js
async function openInsights() {
  if (!activeBudget || !Array.isArray(monthData) || !monthData.length) return;
  showScreen('insights');
  renderBudgetVsActual();
}
function closeInsights() { showScreen('dashboard'); }
```

- [ ] **Step 5: Verify in the preview**

Reload the dashboard (so the extended `processMonth` runs), open Insights, and confirm the chart drew:

```js
(() => {
  const c = window.chartInstances && window.chartInstances['bvaChart'];
  return { hasChart: !!c, labels: c && c.data.labels.slice(0,3),
           datasets: c && c.data.datasets.map(d => d.label) };
})()
```

Expected: `hasChart: true`, `labels` shows category-group names, `datasets` = `["Actual","Budgeted"]`. Take a `preview_screenshot` of the Insights screen to confirm bars + budget markers render and over-budget groups are red.

- [ ] **Step 6: Commit**

```bash
git add public/index.html public/insights.js
git commit -m "feat(insights): Budget vs. Actual chart + budgetRows in processMonth"
```

---

### Task 6: Calendar heatmap (chartjs-chart-matrix, lazy-loaded)

**Files:**
- Modify: `public/insights.js`

- [ ] **Step 1: Add `renderHeatmap()` to `insights.js`**

Add after `renderBudgetVsActual()`:

```js
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
```

- [ ] **Step 2: Lazy-load the matrix plugin in `openInsights`**

Update `openInsights` to load the plugin then render, with error handling:

```js
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
}
```

- [ ] **Step 3: Verify in the preview**

Open Insights and confirm the matrix controller registered and the chart drew:

```js
(() => {
  const reg = !!(window.Chart && Chart.registry.controllers.get('matrix'));
  const c = window.chartInstances && window.chartInstances['heatmapChart'];
  return { matrixRegistered: reg, hasChart: !!c, cells: c && c.data.datasets[0].data.length };
})()
```

Expected: `matrixRegistered: true`, `hasChart: true`, `cells` > 0. Take a `preview_screenshot` — expect a calendar grid (weeks across, Sun–Sat down) with blue intensity by daily spend and grey for no-spend days. Hover a cell and confirm the tooltip shows the date and dollar amount (via `preview_eval` or visual check).

- [ ] **Step 4: Commit**

```bash
git add public/insights.js
git commit -m "feat(insights): daily-spend calendar heatmap (matrix plugin)"
```

---

### Task 7: Spending Sankey (chartjs-chart-sankey, lazy-loaded)

**Files:**
- Modify: `public/insights.js`

- [ ] **Step 1: Add `renderSankey()` to `insights.js`**

Add after `renderHeatmap()`:

```js
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
```

- [ ] **Step 2: Lazy-load the sankey plugin in `openInsights`**

Append to the body of `openInsights` (after the heatmap try/catch):

```js
  try {
    await loadScriptOnce('https://cdn.jsdelivr.net/npm/chartjs-chart-sankey@0.12.0');
    renderSankey();
  } catch (e) {
    showChartError('sankeyEmpty', 'Couldn’t load the flow-diagram library — check your connection.');
  }
```

- [ ] **Step 3: Verify in the preview**

Open Insights and confirm:

```js
(() => {
  const reg = !!(window.Chart && Chart.registry.controllers.get('sankey'));
  const c = window.chartInstances && window.chartInstances['sankeyChart'];
  return { sankeyRegistered: reg, hasChart: !!c, flows: c && c.data.datasets[0].data.length };
})()
```

Expected: `sankeyRegistered: true`, `hasChart: true`, `flows` > 0. Take a `preview_screenshot` — expect ribbons flowing "Spending" → groups → categories, widths proportional to spend. Confirm no console errors via `preview_console_logs level="error"` (watch for cycle warnings; if a cycle appears because a category shares a group/"Spending" name, note it for polish).

- [ ] **Step 4: Commit**

```bash
git add public/insights.js
git commit -m "feat(insights): spending flow Sankey (sankey plugin)"
```

---

### Task 8: Wave-1 polish — re-render on period change, regression check

**Files:**
- Modify: `public/index.html` (period-change handler) and/or `public/insights.js`

- [ ] **Step 1: Re-render Insights when it is the active screen and the period changes**

Find where the period selector triggers a reload (search for `periodSelect` change handler / the function that calls `loadData()` then re-renders dashboard charts). After dashboard data refreshes, if the Insights screen is currently visible, re-run the Insights renders. Add a small guard function to `insights.js`:

```js
// Re-render Insights charts if the screen is currently showing (e.g. after a
// period or budget change refreshes monthData/txIndex). Safe to call anytime.
function refreshInsightsIfOpen() {
  const ins = document.getElementById('insights');
  if (!ins || getComputedStyle(ins).display === 'none') return;
  openInsights();
}
```

Then call `refreshInsightsIfOpen()` at the end of the dashboard's post-`loadData` render path (the same place the Overview charts are rebuilt). If that path is `async`, `await loadData(...)` is already done there — call the guard right after the existing chart-render calls.

- [ ] **Step 2: Verify period-change re-render**

In the preview, open Insights, then change the period selector (e.g. 3 → 12 months). Confirm the charts update:

```js
(() => {
  const c = window.chartInstances && window.chartInstances['bvaChart'];
  return { bvaLabels: c && c.data.labels.length };
})()
```

Expected: chart still present and reflecting the new period (label count may change). Switch back and confirm no errors via `preview_console_logs level="error"`.

- [ ] **Step 3: Regression-check Overview and Search are unaffected**

Click **← Back** to the dashboard. Confirm the existing Overview charts still render and the Search button still works:

```js
(() => ({
  total: !!(window.chartInstances && window.chartInstances['totalChart']),
  topcat: !!(window.chartInstances && window.chartInstances['topCatBar']),
}))()
```

Expected: both `true`. Open Search, confirm it still lists transactions, close it.

- [ ] **Step 4: Run the full unit-test suite once more**

Run: `node --test test/insights.test.js`
Expected: PASS — 6 tests passing.

- [ ] **Step 5: Commit**

```bash
git add public/index.html public/insights.js
git commit -m "feat(insights): re-render on period change + Wave-1 polish"
```

---

## Self-Review

**Spec coverage (Wave 1 scope):**
- Insights screen + nav via `showScreen()` mirroring Search → Task 4. ✓
- Reuse `monthData` + `txIndex`, respect active period → Tasks 5–8. ✓
- `processMonth` extended for `budgeted` → Task 5. ✓
- Lazy plugin loading like the PDF libs → Tasks 5–7 (`loadScriptOnce`). ✓
- Chart 1 Sankey → Task 7; Chart 2 Budget vs Actual → Task 5; Chart 3 Calendar heatmap → Task 6. ✓
- Pure data-shapers as independently tested functions → Tasks 1–3 (Node test harness). ✓
- Error handling for failed plugin load + empty states → Tasks 4–7 (`showChartError`, `*Empty` divs). ✓
- Manual verification via preview → every UI task. ✓
- Out of Wave 1: charts 4–11 (Waves 2–3), recurring detector, treemap — intentionally excluded. ✓

**Placeholder scan:** No TBD/TODO; every code step contains complete code. The only conditional instruction (Task 4 Step 2 class-name fallback) names the exact existing element to copy from. ✓

**Type/name consistency:** `budgetRows` shape `{group,name,budgeted,actual}` is identical in `processMonth` (Task 5) and the `budgetVsActual` test/impl (Task 1). Canvas/empty-div ids (`bvaChart`/`bvaEmpty`, `heatmapChart`/`heatmapEmpty`, `sankeyChart`/`sankeyEmpty`) match between Task 4 markup and Tasks 5–7 render code. `loadScriptOnce`, `showChartError`, `openInsights`, `closeInsights`, `refreshInsightsIfOpen` are each defined once and referenced consistently. ✓
