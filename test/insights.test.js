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
