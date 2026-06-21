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

const { groupComposition } = require('../public/insights.js');

test('groupComposition sums a month\'s category amounts by group, desc', () => {
  const month = { groupTotals: { Food: 520, Fun: 80, Bills: 1200 } };
  assert.deepStrictEqual(groupComposition(month), [
    { group: 'Bills', total: 1200 },
    { group: 'Food', total: 520 },
    { group: 'Fun', total: 80 },
  ]);
});

test('groupComposition returns [] for a missing/empty month', () => {
  assert.deepStrictEqual(groupComposition(null), []);
  assert.deepStrictEqual(groupComposition({ groupTotals: {} }), []);
});

const { monthsForScope } = require('../public/insights.js');

test('monthsForScope: year mode returns the 12 months of that year', () => {
  const ms = monthsForScope({ mode: 'year', year: 2025 });
  assert.strictEqual(ms.length, 12);
  assert.strictEqual(ms[0], '2025-01-01');
  assert.strictEqual(ms[11], '2025-12-01');
});

test('monthsForScope: month mode returns the single month', () => {
  assert.deepStrictEqual(monthsForScope({ mode: 'month', year: 2026, month: 6 }), ['2026-06-01']);
});

// ════════════ Wave 2 ════════════
const { dayOfWeekTotals } = require('../public/insights.js');

test('dayOfWeekTotals buckets outflow dollars by weekday (Sun=0)', () => {
  // 2026-06-07 is a Sunday; 2026-06-08 a Monday.
  const txns = [
    { date: '2026-06-07', amount: -10000 },
    { date: '2026-06-07', amount: -5000 },
    { date: '2026-06-08', amount: -2000 },
    { date: '2026-06-08', amount: 9000 },
    { date: '2026-06-08', amount: -1000, transfer_account_id: 'a' },
  ];
  const out = dayOfWeekTotals(txns);
  assert.strictEqual(out.length, 7);
  assert.strictEqual(out[0].total, 15);
  assert.strictEqual(out[1].total, 2);
  assert.strictEqual(out[2].total, 0);
});

const { cumulativeByMonth } = require('../public/insights.js');

test('cumulativeByMonth returns per-month cumulative-by-day series', () => {
  const txns = [
    { date: '2026-06-02', amount: -10000 },
    { date: '2026-06-05', amount: -5000 },
    { date: '2026-04-10', amount: -4000 },
  ];
  const series = cumulativeByMonth(txns);
  const june = series.find(s => s.label === '2026-06');
  assert.strictEqual(june.data.length, 30);
  assert.deepStrictEqual(june.data[0], { x: 1, y: 0 });
  assert.deepStrictEqual(june.data[1], { x: 2, y: 10 });
  assert.deepStrictEqual(june.data[4], { x: 5, y: 15 });
  assert.deepStrictEqual(june.data[29], { x: 30, y: 15 });
  assert.strictEqual(series[0].label, '2026-04');
});

const { amountHistogram } = require('../public/insights.js');

test('amountHistogram bins outflow transaction sizes', () => {
  const txns = [
    { date: '2026-06-01', amount: -10000 },
    { date: '2026-06-01', amount: -24999 },
    { date: '2026-06-01', amount: -30000 },
    { date: '2026-06-01', amount: -600000 },
    { date: '2026-06-01', amount: 9000 },
  ];
  const bins = amountHistogram(txns);
  assert.strictEqual(bins.length, 6);
  assert.strictEqual(bins[0].label, '$0–25');
  assert.strictEqual(bins[0].count, 2);
  assert.strictEqual(bins[1].count, 1);
  assert.strictEqual(bins[5].count, 1);
});

const { freqSizeByCategory } = require('../public/insights.js');

test('freqSizeByCategory aggregates count, total, avg per category', () => {
  const txns = [
    { date: '2026-06-01', amount: -10000, category_name: 'Groceries' },
    { date: '2026-06-02', amount: -20000, category_name: 'Groceries' },
    { date: '2026-06-03', amount: -50000, category_name: 'Rent' },
    { date: '2026-06-04', amount: -1000, category_name: 'Rent', transfer_account_id: 'a' },
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

// ════════════ Wave 3 ════════════
const { payeeTree } = require('../public/insights.js');

test('payeeTree aggregates outflow by category+payee', () => {
  const txns = [
    { date: '2026-06-01', amount: -10000, category_name: 'Food', payee_name: 'Store A' },
    { date: '2026-06-02', amount: -5000,  category_name: 'Food', payee_name: 'Store A' },
    { date: '2026-06-03', amount: -8000,  category_name: 'Food', payee_name: 'Store B' },
    { date: '2026-06-04', amount: -2000,  category_name: 'Fun',  payee_name: 'Arcade' },
    { date: '2026-06-05', amount: 9000,   category_name: 'Food', payee_name: 'Refund' },
  ];
  const rows = payeeTree(txns);
  const a = rows.find(r => r.payee === 'Store A');
  assert.deepStrictEqual(a, { category: 'Food', payee: 'Store A', total: 15 });
  assert.strictEqual(rows.length, 3);
});

test('payeeTree labels missing payee/category', () => {
  const rows = payeeTree([{ date: '2026-06-01', amount: -1000 }]);
  assert.strictEqual(rows[0].category, 'Uncategorized');
  assert.strictEqual(rows[0].payee, '(no payee)');
});

const { groupMixShare } = require('../public/insights.js');

test('groupMixShare normalizes each month to 100% by group', () => {
  const months = [
    { shortLabel: 'Jan', groupTotals: { Food: 300, Fun: 100 } },
    { shortLabel: 'Feb', groupTotals: { Food: 100, Fun: 100 } },
  ];
  const { labels, datasets } = groupMixShare(months);
  assert.deepStrictEqual(labels, ['Jan', 'Feb']);
  const food = datasets.find(d => d.group === 'Food');
  assert.deepStrictEqual(food.data, [75, 50]);
  const fun = datasets.find(d => d.group === 'Fun');
  assert.deepStrictEqual(fun.data, [25, 50]);
});

test('groupMixShare yields no datasets for a zero-spend month', () => {
  const { datasets } = groupMixShare([{ shortLabel: 'Jan', groupTotals: {} }]);
  assert.deepStrictEqual(datasets, []);
});

const { biggestMovers } = require('../public/insights.js');

test('biggestMovers compares the last two months by category', () => {
  const months = [
    { categories: [{ name: 'Groceries', amount: 100 }, { name: 'Gas', amount: 50 }] },
    { categories: [{ name: 'Groceries', amount: 180 }, { name: 'Gas', amount: 20 }] },
  ];
  const rows = biggestMovers(months);
  const groc = rows.find(r => r.category === 'Groceries');
  assert.deepStrictEqual(groc, { category: 'Groceries', prev: 100, curr: 180, delta: 80 });
  const gas = rows.find(r => r.category === 'Gas');
  assert.strictEqual(gas.delta, -30);
  assert.strictEqual(rows[0].category, 'Groceries');
});

test('biggestMovers needs at least two months', () => {
  assert.deepStrictEqual(biggestMovers([{ categories: [] }]), []);
});

const { detectRecurring } = require('../public/insights.js');

test('detectRecurring flags payees appearing in >=3 distinct months', () => {
  const txns = [
    { date: '2026-01-15', amount: -15990, payee_name: 'Streamy' },
    { date: '2026-02-15', amount: -15990, payee_name: 'Streamy' },
    { date: '2026-03-15', amount: -15990, payee_name: 'Streamy' },
    { date: '2026-01-10', amount: -5000, payee_name: 'OneOff' },
    { date: '2026-02-10', amount: -2000, payee_name: 'Twice' },
    { date: '2026-03-10', amount: -2000, payee_name: 'Twice' },
  ];
  const rows = detectRecurring(txns);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].payee, 'Streamy');
  assert.strictEqual(rows[0].months, 3);
  assert.strictEqual(rows[0].avg, 15.99);
});

test('detectRecurring ignores transactions without a payee', () => {
  const rows = detectRecurring([
    { date: '2026-01-01', amount: -1000 },
    { date: '2026-02-01', amount: -1000 },
    { date: '2026-03-01', amount: -1000 },
  ]);
  assert.deepStrictEqual(rows, []);
});

// ════════════ Fixes/polish ════════════
const { validSpendingCategories, spendingRows, monthsWithSpend } = require('../public/insights.js');

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
    { date: '2026-03-01', amount: -5000, category_name: 'Groceries' },
    { date: '2026-03-02', amount: -233000000, category_name: 'Inflow: Ready to Assign' },
    { date: '2026-03-03', amount: -100000, category_name: null },
    { date: '2026-03-04', amount: 9000, category_name: 'Groceries' },
    { date: '2026-03-05', amount: -7000, category_name: 'Mortgage', transfer_account_id: 'x' },
  ];
  const out = spendingRows(rows, valid);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].category_name, 'Groceries');
});

test('monthsWithSpend drops months with no spending', () => {
  const months = [
    { shortLabel: '01', total: 1200, categories: [{ name: 'X', amount: 1200 }], groupTotals: { A: 1200 } },
    { shortLabel: '02', total: 0, categories: [], groupTotals: {} },
  ];
  const out = monthsWithSpend(months);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].shortLabel, '01');
});
