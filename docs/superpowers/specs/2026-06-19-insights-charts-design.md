# Insights Tab — New Charts & Visualizations

**Status:** Design approved 2026-06-19
**Topic:** Add an "Insights" screen with 11 new visualizations to Spending Dashboard for YNAB

## Goal

Add a new top-level **Insights** screen to the dashboard that visualizes the
existing YNAB data in ways the current Overview does not: timing patterns, money
flow, merchants, distribution, and composition. Eleven new charts, built in three
waves, reusing data that is already loaded.

## Non-goals

- No new backend/API routes. The Cloudflare Worker is unchanged.
- No new data fetching beyond what the dashboard already loads (see Data Sources).
- No redesign of the existing Overview or Search screens.
- No persistence of user preferences for Insights (period selector already covers it).

## Architecture & Navigation

- New top-level screen `id="insights"` in `public/index.html`, shown/hidden via the
  existing `showScreen()` mechanism — the same pattern used for `setupScreen`,
  `dashboard`, `loadingScreen`, and the Search screen.
- Entry point: an **"📊 Insights"** button in the dashboard header, mirroring the
  existing **"🔎 Search"** button (`dashSearchBtn` → `openSearch()`). New
  `openInsights()` / `closeInsights()` with a **"← Back"** button.
- Insights reuses already-loaded in-memory state:
  - `monthData` — per-month processed category/group data. Note: `processMonth()`
    currently keeps only `activity`; it must be extended to also retain `budgeted`
    (and `goal` if needed) so Budget-vs-Actual works without a new fetch.
  - `txIndex` — `Map` of all transactions for the active period, with full fields
    (`date`, `amount`, `payee_name`, `category_name`, `account_name`, `cleared`,
    `flag_color`).
- Insights respects the **active period** selector and the existing
  **hidden-categories** handling (`hiddenCategoryIds`, the "Hidden Categories"
  group skip in `processMonth`).
- **Lazy rendering:** charts render only when the Insights screen is opened. Within
  Insights, prefer rendering the visible sub-section first and deferring others
  (e.g. render-on-first-reveal) so opening the screen is fast.

## Code Organization

- New file **`public/insights.js`**, included by `index.html` via a `<script>` tag.
  All Insights logic lives here to avoid further bloating the already-large
  `index.html`.
- **Pure data-shaping functions** (independently testable), each taking
  `txIndex`/`monthData` + options and returning plain arrays/objects:
  - `dailyTotals(txns)` → `[{date, amount}]` for the heatmap
  - `payeeTree(txns)` → nested `{group → category → payee → total}` for the treemap
  - `dayOfWeekBuckets(txns)` → 7 totals/averages for the radar
  - `cumulativeByMonth(txns, months)` → cumulative series per month for burn-rate
  - `amountHistogram(txns, bins)` → bin counts for the histogram
  - `freqSizeByCategory(txns)` → `[{label, count, avg, total}]` for the bubble chart
  - `groupMixShare(monthData)` → 100%-normalized group shares per month
  - `biggestMovers(monthData)` → category deltas vs prior month
  - `budgetVsActual(monthData)` → `[{name, budgeted, actual}]` per category/group
  - `detectRecurring(txns)` → payees with ~monthly cadence + per-period amounts
- **Chart builders** mirror the existing `makeChart(id, config)` helper and its
  `chartInstances` lifecycle (destroy-before-recreate) so re-renders on period
  change are leak-free.

## The 11 Charts (grouped by Insights sub-section; wave tag in brackets)

### 💸 Money flow
1. **Sankey (Income → Group → Category)** `[W1]` — ribbons sized by spend. Plugin:
   `chartjs-chart-sankey`. Source: `monthData` group/category totals (+ income from
   positive-activity categories or inflow transactions).
2. **Budget vs. Actual** `[W1]` — per category/group, budgeted as a target marker,
   actual as the bar, over/under color-coded (bullet/diverging style on native bar).
   Source: extended `monthData` (`budgeted` + `activity`).

### 📅 Timing
3. **Calendar heatmap** `[W1]` — GitHub-style; cell color = that day's spend. Plugin:
   `chartjs-chart-matrix`. Source: `dailyTotals(txIndex)`.
4. **Day-of-week radar** `[W2]` — spend by weekday. Native radar/bar.
   Source: `dayOfWeekBuckets(txIndex)`.
5. **Cumulative burn-rate race** `[W2]` — this month's running cumulative spend
   overlaid on prior months. Native line. Source: `cumulativeByMonth(txIndex)`.

### 🏪 Merchants
6. **Payee treemap** `[W3]` — nested rectangles sized by total spend
   (group → category → payee). Plugin: `chartjs-chart-treemap`. Source:
   `payeeTree(txIndex)`.
7. **Recurring/subscription detector** `[W3]` — list + sparkline of payees with
   ~monthly cadence. Logic-driven (`detectRecurring`), not a Chart.js chart type.
   **Fuzziest item; kept in scope per design review.**

### 📊 Distribution
8. **Transaction-size histogram** `[W2]` — distribution of amounts. Native bar.
   Source: `amountHistogram(txIndex)`.
9. **Frequency × size bubble** `[W2]` — x = frequency, y = avg amount, size = total,
   one bubble per category. Native bubble. Source: `freqSizeByCategory(txIndex)`.

### 🔀 Composition
10. **100% stacked-area mix** `[W3]` — each group's share of monthly spend over time.
    Native line/area, normalized. Source: `groupMixShare(monthData)`.
11. **Biggest-movers tornado** `[W3]` — diverging horizontal bars of categories that
    rose/fell most vs prior month. Native bar. Source: `biggestMovers(monthData)`.

## Build Waves

- **Wave 1 (flagship "wow"):** Sankey, Calendar heatmap, Budget vs. Actual.
  Also establishes: the Insights screen + nav, lazy plugin loading, the
  `processMonth` extension for `budgeted`, and the first data-shapers.
- **Wave 2 (timing & distribution natives):** Day-of-week radar, Burn-rate race,
  Histogram, Frequency×size bubble.
- **Wave 3 (merchants & composition):** Payee treemap, Recurring detector,
  100% stacked-area mix, Biggest-movers tornado.

Each wave is independently shippable and verifiable.

## Dependencies

- **Already loaded:** Chart.js (from jsDelivr). Covers charts 2, 4, 5, 8, 9, 10, 11.
- **New CDN plugins, lazy-loaded on Insights open** (same async pattern as the
  existing on-demand PDF libraries — not loaded at startup):
  - `chartjs-chart-sankey` (chart 1)
  - `chartjs-chart-matrix` (chart 3, heatmap)
  - `chartjs-chart-treemap` (chart 6)
- A small lazy-loader util that injects a `<script>` once and resolves when ready,
  reused for all three plugins.

## Error Handling

- If a lazy plugin fails to load (offline/CDN), the affected chart shows an inline
  "couldn't load this chart" message; other charts and the rest of the app are
  unaffected.
- Charts with no data for the active period render an empty-state message rather
  than a broken canvas.
- Data-shapers are defensive against missing fields (e.g. uncategorized
  transactions, null `payee_name`).

## Testing / Verification

- No test framework exists in the repo today; primary verification is manual via the
  preview server: each chart renders with real data, respects the period selector and
  hidden-categories rules, and the Overview/Search screens are unaffected.
- **Optional (W1):** introduce a tiny pure-function test harness for the data-shapers
  (they are pure and easy to unit-test). Decide at W1 implementation time.

## Open Questions / Future

- Recurring detector cadence threshold (what counts as "monthly") to be tuned during
  W3 against real data.
- Possible future: click-through from an Insights chart into the existing Search view
  with filters pre-applied. Out of scope for this spec.
