# Insights — Fixes & Polish (from real-data review)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkbox (`- [ ]`) steps.

**Goal:** Fix the issues found reviewing the Insights screen against a real budget: charts render far too tall (must scroll on a 4K display), transaction-based charts over-count non-spending (a ~$233k starting-balance phantom), trailing empty/future months break two charts, plus per-chart legibility polish.

**Architecture:** Three systemic fixes + per-chart polish. (1) Every Insights chart + the Overview donut gets a fixed-height wrapper and `maintainAspectRatio: false`. (2) The five transaction-based charts consume a new **spending-only** transaction set (split-flattened, restricted to categories that appear in `insightsMonths` — i.e. YNAB category activity), instead of raw `insightsTxns`. (3) `insightsMonths` is trimmed to months with actual spend for the multi-month charts.

**Tech Stack:** Vanilla JS, Chart.js, `node:test`.

---

## Verified current-state facts

- `public/index.html` globals usable from `insights.js` at runtime: `flattenTxnsForSearch(iter)` (`:1521`, emits one row per split sub with `category_name`/`payee_name`/`amount`, else the parent), `fmtMoney`, `groupColor`, `escapeHtml`, `topCatMonthIdx`, `topCatNav(delta)`, `renderGroupDonut` is called in the dashboard render path.
- `processMonth` already excludes non-spending groups (`Internal Master Category` = Inflow/Starting Balance, `Credit Card Payments`) and inflow categories, so `insightsMonths[i].categories` (`[{id,name,group,amount}]`) is the authoritative spending-category set.
- `insights.js`: `renderInsights()` calls `loadInsightsData()` then the render fns. Transaction charts currently read `insightsTxns` (raw). Category charts read `insightsMonths`. Scope vars: `insightsScope` ({mode,year,month}), `insightsMonths`, `insightsTxns`.
- Transaction shapers (`dailyTotals`, `dayOfWeekTotals`, `amountHistogram`, `freqSizeByCategory`, `payeeTree`, `detectRecurring`) already re-apply an outflow filter, so feeding them pre-filtered rows is safe (idempotent).
- Insights cards: `#insights .grid` with `.card`/`.card.full`. Canvas ids: `bvaChart`, `heatmapChart`, `sankeyChart`, `dowChart`, `burnChart`, `histChart`, `bubbleChart`, `treemapChart`, `mixChart`, `moversChart`; donut `groupDonutChart`. Yearly-only cards carry `.insights-yearly`.
- Tests: `node --test test/insights.test.js` (23 passing).

---

### Task 1: Spending-only transaction filter (fixes 5 charts' data)

**Files:** `public/insights.js`, `test/insights.test.js`.

- [ ] **Step 1: Failing tests.** Append to `test/insights.test.js`:

```js
const { validSpendingCategories, spendingRows } = require('../public/insights.js');

test('validSpendingCategories collects category names from months', () => {
  const months = [
    { categories: [{ name: 'Groceries' }, { name: 'Mortgage' }] },
    { categories: [{ name: 'Groceries' }, { name: 'Dining' }] },
  ];
  const set = validSpendingCategories(months);
  assert.ok(set.has('Groceries') && set.has('Mortgage') && set.has('Dining'));
  assert.strictEqual(set.size, 3);
});

test('spendingRows keeps only outflow rows in valid categories', () => {
  const valid = new Set(['Groceries', 'Mortgage']);
  const rows = [
    { date: '2026-03-01', amount: -5000, category_name: 'Groceries' },          // keep
    { date: '2026-03-02', amount: -233000000, category_name: 'Inflow: Ready to Assign' }, // drop (not valid cat)
    { date: '2026-03-03', amount: -100000, category_name: null },                // drop (no cat / starting balance)
    { date: '2026-03-04', amount: 9000, category_name: 'Groceries' },            // drop (inflow)
    { date: '2026-03-05', amount: -7000, category_name: 'Mortgage', transfer_account_id: 'x' }, // drop (transfer)
  ];
  const out = spendingRows(rows, valid);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].category_name, 'Groceries');
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Add both helpers** to `public/insights.js` (near the other shapers):

```js
// Set of category names that count as real spending — derived from the
// already-filtered monthData/insightsMonths (YNAB category activity).
function validSpendingCategories(months) {
  const set = new Set();
  for (const m of months || []) for (const c of m.categories || []) set.add(c.name);
  return set;
}

// Keep only genuine spending rows: outflow, not a transfer, and in a real
// spending category. Drops starting/opening balances, inflows, transfers,
// and uncategorized. Input rows should already be split-flattened.
function spendingRows(rows, validSet) {
  const out = [];
  for (const t of rows || []) {
    if (!t || t.deleted || t.transfer_account_id) continue;
    if (typeof t.amount !== 'number' || t.amount >= 0) continue;
    if (!t.category_name || !validSet.has(t.category_name)) continue;
    out.push(t);
  }
  return out;
}
```

Add both to the export guard.

- [ ] **Step 4: Run → PASS** (25 tests).

- [ ] **Step 5: Compute the spending set once + repoint the 5 charts.** In `public/insights.js`:
  - Add a module var near the scope vars: `let insightsSpend = [];`
  - In `renderInsights()`, immediately after `await loadInsightsData();`, add:

    ```js
      insightsSpend = spendingRows(flattenTxnsForSearch(insightsTxns), validSpendingCategories(insightsMonths));
    ```

    (`flattenTxnsForSearch` is a global from index.html.)
  - Change these render fns to read `insightsSpend` instead of `insightsTxns`:
    - `renderHeatmap`: `dailyTotals(insightsSpend)`
    - `renderDayOfWeek`: `dayOfWeekTotals(insightsSpend)`
    - `renderHistogram`: `amountHistogram(insightsSpend)`
    - `renderFreqSize`: `freqSizeByCategory(insightsSpend)`
    - `renderTreemap`: `payeeTree(insightsSpend)`
    - `renderRecurring`: `detectRecurring(insightsSpend)`

- [ ] **Step 6: Commit**

```bash
git add public/insights.js test/insights.test.js
git commit -m "fix(insights): count only real spending in transaction charts"
```

---

### Task 2: Trim trailing empty months (fixes group-mix cliff + empty movers)

**Files:** `public/insights.js`, `test/insights.test.js`.

- [ ] **Step 1: Failing tests.** Append:

```js
const { monthsWithSpend } = require('../public/insights.js');

test('monthsWithSpend drops months with no spending', () => {
  const months = [
    { shortLabel: '01', total: 1200, categories: [{ name: 'X', amount: 1200 }], groupTotals: { A: 1200 } },
    { shortLabel: '02', total: 0, categories: [], groupTotals: {} },
  ];
  const out = monthsWithSpend(months);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].shortLabel, '01');
});
```

Also update the existing `biggestMovers` test setup is unaffected (it already takes the array passed in).

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Add the helper** after `monthsForScope`:

```js
// Months that actually have spending — drops empty/future months in the year.
function monthsWithSpend(months) {
  return (months || []).filter(m => (m.categories && m.categories.length) || m.total > 0);
}
```

Add `monthsWithSpend` to the export guard.

- [ ] **Step 4: Run → PASS** (26 tests).

- [ ] **Step 5: Use trimmed months in the two affected charts.** In `public/insights.js`:
  - `renderGroupMix`: change `const { labels, datasets } = groupMixShare(insightsMonths);` to `groupMixShare(monthsWithSpend(insightsMonths))`.
  - `renderMovers`: change `const rows = biggestMovers(insightsMonths);` to `const rows = biggestMovers(monthsWithSpend(insightsMonths));`. Then handle the <2-months case: if `rows.length === 0`, set the card's canvas aside and show a hint. Replace the body after the month-mode early return with:

    ```js
      const trimmed = monthsWithSpend(insightsMonths);
      const rows = biggestMovers(trimmed);
      const empty = document.getElementById('moversEmpty');
      if (rows.length === 0) { if (empty) empty.style.display = 'block'; makeChart('moversChart', { type: 'bar', data: { labels: [], datasets: [] } }); return; }
      if (empty) empty.style.display = 'none';
    ```

    And add the empty div to the movers card markup in `public/index.html` (inside `#moversCard`, before the canvas): `<div id="moversEmpty" class="insights-empty" style="display:none">Need at least two months of spending to compare.</div>`

- [ ] **Step 6: Commit**

```bash
git add public/insights.js test/insights.test.js public/index.html
git commit -m "fix(insights): trim empty months for group mix + biggest movers"
```

---

### Task 3: Systemic chart sizing + Insights top padding

**Files:** `public/index.html` (CSS + wrap canvases), `public/insights.js` (set `maintainAspectRatio: false`).

- [ ] **Step 1: Add a height-capped chart wrapper class.** In `public/index.html` `<style>`, add:

```css
    .chart-box { position: relative; height: 300px; }
    .chart-box.tall { height: 380px; }
    #insights, #dashboard, #searchScreen { padding-top: 24px; }
```

- [ ] **Step 2: Wrap each Insights canvas** in `public/index.html` so its height is bounded. For every Insights `<canvas id="…">` (bvaChart, heatmapChart, sankeyChart, dowChart, burnChart, histChart, bubbleChart, treemapChart, mixChart, moversChart) and the Overview `groupDonutChart`, wrap the canvas element in `<div class="chart-box"> … </div>` (use `chart-box tall` for `sankeyChart`, `treemapChart`, and `bvaChart`). Remove the now-redundant `height="…"` attributes on those canvases. Example:

```html
        <div class="chart-box"><canvas id="dowChart"></canvas></div>
```

- [ ] **Step 3: Disable aspect-ratio lock on every Insights chart + the donut.** In `public/insights.js`, add `maintainAspectRatio: false,` to the `options` object of each: `renderBudgetVsActual`, `renderHeatmap`, `renderSankey`, `renderDayOfWeek`, `renderBurnRate`, `renderHistogram`, `renderFreqSize`, `renderTreemap`, `renderGroupMix`, `renderMovers`, `renderGroupDonut`, plus the two charts in `renderInsightsTrends` (`insightsGroupTrend`, `insightsGroupStack`).

- [ ] **Step 4: Verify in preview** (synthetic data): open Insights, confirm each chart's rendered canvas height ≈ its `.chart-box` height (≤ 380px) rather than filling the viewport. `preview_console_logs level="error"` clean.

- [ ] **Step 5: Commit**

```bash
git add public/index.html public/insights.js
git commit -m "fix(insights): cap chart heights + add screen top padding"
```

---

### Task 4: Budget vs. Actual redesign (two bars, sane colors)

**Files:** `public/insights.js`.

- [ ] **Step 1: Rewrite `renderBudgetVsActual`** to grouped horizontal bars (budgeted vs actual, distinct fixed colors, capped thickness), keeping the `insightsMonths`/`budgetVsActual` data:

```js
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
        { label: 'Budgeted', data: rows.map(r => r.budgeted), backgroundColor: '#a0aec0', maxBarThickness: 18, borderRadius: 3 },
        { label: 'Actual', data: rows.map(r => r.actual), backgroundColor: rows.map(r => r.actual > r.budgeted ? '#e53e3e' : '#48bb78'), maxBarThickness: 18, borderRadius: 3 },
      ],
    },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'top' }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmtMoney(c.parsed.x)}` } } },
      scales: { x: { beginAtZero: true, ticks: { callback: (v) => '$' + v } } },
    },
  });
}
```

- [ ] **Step 2: Verify** (synthetic): bvaChart has two datasets `["Budgeted","Actual"]`, actual bars green/red vs budgeted grey. Commit:

```bash
git add public/insights.js
git commit -m "fix(insights): budget vs actual as grouped bars"
```

---

### Task 5: Heatmap cell borders + Sankey colors + histogram color ramp

**Files:** `public/insights.js`.

- [ ] **Step 1: Heatmap cell separation.** In `renderHeatmap`, on the matrix dataset set `borderWidth: 1` and `borderColor: '#fff'` (replacing `borderWidth: 0`) so days read as discrete squares.

- [ ] **Step 2: Sankey calmer colors.** In `renderSankey`, replace `colorMode: 'gradient'` + `color: '#4299e1'` with a single calm hue and node coloring: set `colorFrom: () => '#90cdf4'`, `colorTo: () => '#90cdf4'`, `colorMode: 'from'`, and `alpha: 0.4` on the dataset (drop the loud red→green default).

- [ ] **Step 3: Histogram color ramp.** In `renderHistogram`, replace the single `backgroundColor: '#4299e1'` with a per-bin sequential ramp:

```js
      datasets: [{ label: 'Transactions', data: bins.map(b => b.count), borderWidth: 0,
        backgroundColor: ['#c6e0f5', '#90cdf4', '#63b3ed', '#4299e1', '#3182ce', '#2b6cb0'] }],
```

- [ ] **Step 4: Verify** (synthetic): heatmap cells have white borders; histogram bars step light→dark; sankey no longer red/green. Commit:

```bash
git add public/insights.js
git commit -m "fix(insights): heatmap cell borders, calmer sankey, histogram ramp"
```

---

### Task 6: Donut height + shared month nav with Top Categories

**Files:** `public/insights.js`, `public/index.html`.

- [ ] **Step 1: Point the donut at the Top-Categories month.** In `renderGroupDonut`, change `const month = monthData[monthData.length - 1];` to `const month = monthData[typeof topCatMonthIdx === 'number' ? topCatMonthIdx : monthData.length - 1];` (`topCatMonthIdx` is the global month index used by the Top Categories card).

- [ ] **Step 2: Re-render the donut when the Top-Categories month changes.** Find `function topCatNav(` in `public/index.html` and add `renderGroupDonut();` at the end of it (after it updates `topCatMonthIdx` and re-renders the top-cat bar), so the two cards move together.

- [ ] **Step 3: Verify** (synthetic): stepping Top Categories also updates the donut's month label + slices. Commit:

```bash
git add public/insights.js public/index.html
git commit -m "fix(overview): donut follows Top Categories month nav"
```

---

### Task 7: Group mix → stacked bar; bubble labels; recurring max-height

**Files:** `public/insights.js`, `public/index.html`.

- [ ] **Step 1: Group mix as a 100% stacked bar** (discrete months read more clearly than an area). In `renderGroupMix`, after computing `const { labels, datasets } = groupMixShare(monthsWithSpend(insightsMonths));`, render:

```js
  makeChart('mixChart', {
    type: 'bar',
    data: { labels, datasets: datasets.map(d => ({ label: d.group, data: d.data, backgroundColor: groupColor(d.group), borderWidth: 0 })) },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 10 } } }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${c.parsed.y}%` } } },
      scales: { x: { stacked: true }, y: { stacked: true, min: 0, max: 100, ticks: { callback: (v) => v + '%' } } },
    },
  });
```

- [ ] **Step 2: Bubble on-bubble labels.** In `renderFreqSize`, add the datalabel via a tooltip-independent label: set each dataset's `label` already exists; add `options.plugins.legend` to show a compact legend at the bottom (`legend: { display: true, position: 'bottom', labels: { boxWidth: 10, font: { size: 9 } } }`) so categories are identifiable without hover. (No new plugin.)

- [ ] **Step 3: Recurring table max-height + scroll.** In `public/index.html`, wrap the recurring list in a scroll container: change the `#recurringList` div to `<div id="recurringList" style="max-height:360px;overflow-y:auto"></div>`.

- [ ] **Step 4: Verify** (synthetic): mix is a stacked bar summing to 100%; bubble shows a category legend; recurring list scrolls past ~360px. Commit:

```bash
git add public/insights.js public/index.html
git commit -m "fix(insights): stacked-bar mix, bubble legend, recurring scroll"
```

---

## Self-Review

**Coverage of feedback:**
- Charts too tall / scroll on 4K → T3 (height caps + aspect-ratio off), applied per chart in T4–T7 too.
- $233k phantom / over-counting (radar, heatmap, histogram, bubble, treemap, recurring) → T1 spending-only filter.
- Empty Biggest Movers + group-mix cliff → T2 trim empty months.
- Insights jammed to top → T3 top padding.
- Budget vs Actual giant red slab → T4 grouped two-bar.
- Heatmap no day separation → T5 borders. Sankey loud colors → T5. Histogram all-blue → T5 ramp.
- Donut huge + no month flip → T3 height + T6 shared nav.
- Bubble unintuitive → T3 size + T1 data + T7 legend (cut remains an option if still weak).
- Group mix hard to read → T7 stacked bar (+ T2 trim).
- Recurring too tall → T7 scroll.

**Placeholder scan:** complete code for all shapers, helpers, and the rewritten render fns; mechanical edits (wrappers, `maintainAspectRatio`, colors) specified per element. ✓

**Consistency:** `validSpendingCategories`/`spendingRows`/`monthsWithSpend` added to the export guard and consumed in render code. `insightsSpend` computed once in `renderInsights` and read by the five transaction charts. ✓

**Verification note:** the spending filter and trimming are validated by unit tests + synthetic preview rendering; the definitive check (the $233k phantom actually gone, correct totals) requires a logged-in YNAB session — flag for the user.
