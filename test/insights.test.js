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
