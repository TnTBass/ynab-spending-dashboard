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

// ── CommonJS export guard (Node tests only; ignored in the browser) ──
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { budgetVsActual, dailyTotals, sankeyFlows };
}
