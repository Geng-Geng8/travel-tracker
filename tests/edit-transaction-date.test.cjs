const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const vm = require('node:vm');
const InsightsData = require('../insights-data.js');

const rootDir = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
const appScript = html.split('<script>')[1].split('</script>')[0];

function createMockAppEnvironment(initialExpenses = []) {
  let storedExpenses = JSON.parse(JSON.stringify(initialExpenses));
  const elements = new Map();

  function getEl(id, type) {
    if (!elements.has(id)) {
      let val = '';
      const classSet = new Set();
      elements.set(id, {
        id,
        type,
        get value() { return val; },
        set value(v) {
          // Standard HTML5 <input type="date"> behavior:
          // Rejects any value not matching YYYY-MM-DD full-date pattern and resets to empty string
          if (type === 'date') {
            val = /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '';
          } else {
            val = String(v == null ? '' : v);
          }
        },
        classList: {
          add: (c) => classSet.add(c),
          remove: (c) => classSet.delete(c),
          toggle: (c) => classSet.has(c) ? classSet.delete(c) : classSet.add(c),
          contains: (c) => classSet.has(c)
        },
        innerText: '',
        textContent: '',
        replaceChildren: () => {},
        appendChild: () => {},
        addEventListener: () => {},
        querySelectorAll: () => []
      });
    }
    return elements.get(id);
  }

  const sandbox = {
    window: {
      InsightsData,
      addEventListener: () => {},
      scrollTo: () => {}
    },
    document: {
      getElementById: (id) => getEl(id, id === 'dateInput' ? 'date' : 'text'),
      querySelectorAll: () => [],
      createElement: () => ({
        appendChild: () => {},
        addEventListener: () => {},
        classList: { add: () => {}, remove: () => {}, toggle: () => {} }
      }),
      createTextNode: (t) => ({ textContent: t }),
      addEventListener: () => {}
    },
    localStorage: {
      getItem: (k) => k === 'travel_expenses_log' ? JSON.stringify(storedExpenses) : '[]',
      setItem: (k, v) => {
        if (k === 'travel_expenses_log') {
          storedExpenses = JSON.parse(v);
        }
      }
    },
    navigator: { onLine: true },
    fetch: async () => ({ ok: true, json: async () => ({ rates: { CAD: 0.0227 } }) }),
    setTimeout: () => {},
    clearTimeout: () => {},
    InsightsData,
    Intl,
    Date,
    Math,
    Number,
    String,
    JSON,
    parseFloat,
    parseInt,
    isNaN,
    console
  };
  sandbox.window.window = sandbox.window;
  sandbox.globalThis = sandbox.window;

  vm.createContext(sandbox);
  vm.runInContext(appScript, sandbox);

  return {
    sandbox,
    getEl,
    getStoredExpenses: () => storedExpenses
  };
}

// 1. editing a YYYY-MM-DD transaction retains its date
test('1. editing a YYYY-MM-DD transaction retains its date', () => {
  const ymdItem = {
    id: 'exp-ymd-1',
    date: '2026-08-15',
    cost_local: 500,
    cost_php: 500,
    currency_local: 'PHP',
    cost_cad: 11.35,
    exchange_rate: 0.0227,
    payment_method: 'Cash',
    bucket: 'Play',
    category: 'Eating Out',
    item: 'Lunch in Cebu',
    notes: 'Lechon'
  };

  const app = createMockAppEnvironment([ymdItem]);
  const dateInput = app.getEl('dateInput', 'date');

  // Prior to edit, simulate input holding today's date
  dateInput.value = '2026-10-03';

  // Initiate edit
  app.sandbox.startEditExpense('exp-ymd-1');

  // Value must strictly equal the transaction's recorded date
  assert.equal(dateInput.value, '2026-08-15');
});

// 2. a supported historical date format resolves to the correct YYYY-MM-DD date
test('2. a supported historical date format resolves to the correct YYYY-MM-DD date', () => {
  const historicalItem1 = {
    id: 'hist-ph-1',
    date: 'Sun Jul 19 2026 00:00:00 GMT-0400 (Daylight na Oras sa Silangan ng Hilagang Amerika)',
    cost_local: 1250,
    cost_php: 1250,
    currency_local: 'PHP',
    cost_cad: 28.38,
    exchange_rate: 0.0227,
    payment_method: 'Credit Card',
    bucket: 'Play',
    category: 'Eating Out',
    item: 'Historical Merchant',
    notes: 'Original Note'
  };

  const historicalItem2 = {
    id: 'hist-ph-2',
    date: 'Mon Jul 20 2026 00:00:00 GMT-0400 (Eastern Daylight Time)',
    cost_local: 800,
    cost_php: 800,
    currency_local: 'PHP',
    cost_cad: 18.16,
    exchange_rate: 0.0227,
    payment_method: 'Cash',
    bucket: 'Necessity',
    category: 'Grocery',
    item: 'Market Supplies',
    notes: ''
  };

  // Proof of HTML5 input behavior: assigning raw historical strings clears the input to ""
  const dateInputEmulator = {
    _val: '',
    get value() { return this._val; },
    set value(v) {
      this._val = /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '';
    }
  };
  dateInputEmulator.value = historicalItem1.date;
  assert.equal(dateInputEmulator.value, '', 'HTML5 date inputs reject unparsed historical date strings');

  // With the fix, app.startEditExpense resolves the date correctly to YYYY-MM-DD
  const app = createMockAppEnvironment([historicalItem1, historicalItem2]);
  const dateInput = app.getEl('dateInput', 'date');

  app.sandbox.startEditExpense('hist-ph-1');
  assert.equal(dateInput.value, '2026-07-19', 'Historical item 1 resolves to 2026-07-19');

  app.sandbox.startEditExpense('hist-ph-2');
  assert.equal(dateInput.value, '2026-07-20', 'Historical item 2 resolves to 2026-07-20');
});

// 3. saving an edit without changing the date preserves it
test('3. saving an edit without changing the date preserves it', () => {
  const historicalItem = {
    id: 'hist-edit-preserve',
    date: 'Sun Jul 19 2026 00:00:00 GMT-0400 (Daylight na Oras sa Silangan ng Hilagang Amerika)',
    cost_local: 1250,
    cost_php: 1250,
    currency_local: 'PHP',
    cost_cad: 28.38,
    exchange_rate: 0.0227,
    payment_method: 'Credit Card',
    bucket: 'Play',
    category: 'Eating Out',
    item: 'Historical Item',
    notes: 'Initial notes'
  };

  const app = createMockAppEnvironment([historicalItem]);
  app.sandbox.startEditExpense('hist-edit-preserve');

  // Verify date input is populated with original calendar date
  const dateInput = app.getEl('dateInput', 'date');
  assert.equal(dateInput.value, '2026-07-19');

  // User edits only notes without touching the date
  app.getEl('notesInput', 'text').value = 'Updated notes without changing date';
  app.sandbox.handleFormSubmit({ preventDefault: () => {} });

  const updatedExpenses = app.getStoredExpenses();
  assert.equal(updatedExpenses.length, 1);
  assert.equal(updatedExpenses[0].id, 'hist-edit-preserve');
  assert.equal(updatedExpenses[0].notes, 'Updated notes without changing date');
  assert.equal(updatedExpenses[0].date, '2026-07-19', 'Original calendar date preserved upon save');
});

// 4. changing the date intentionally still works
test('4. changing the date intentionally still works', () => {
  const item = {
    id: 'date-change-item',
    date: '2026-07-19',
    cost_local: 500,
    cost_php: 500,
    currency_local: 'PHP',
    cost_cad: 11.35,
    exchange_rate: 0.0227,
    payment_method: 'Cash',
    bucket: 'Play',
    category: 'Eating Out',
    item: 'Dinner',
    notes: ''
  };

  const app = createMockAppEnvironment([item]);
  app.sandbox.startEditExpense('date-change-item');

  // User deliberately modifies the date
  const dateInput = app.getEl('dateInput', 'date');
  assert.equal(dateInput.value, '2026-07-19');
  dateInput.value = '2026-08-01';

  app.sandbox.handleFormSubmit({ preventDefault: () => {} });

  const updatedExpenses = app.getStoredExpenses();
  assert.equal(updatedExpenses.length, 1);
  assert.equal(updatedExpenses[0].date, '2026-08-01', 'Intentionally modified date is saved');
});

// 5. no timezone/day shift occurs
test('5. no timezone/day shift occurs across generic timezones (Toronto, Manila, UTC, etc.)', () => {
  const testTzs = ['America/Toronto', 'Asia/Manila', 'UTC', 'Pacific/Auckland', 'Pacific/Honolulu'];
  const testCases = [
    { input: 'Sun Jul 19 2026 00:00:00 GMT-0400 (Eastern Daylight Time)', expected: '2026-07-19' },
    { input: 'Sun Jul 19 2026 00:00:00 GMT-0400 (Daylight na Oras sa Silangan ng Hilagang Amerika)', expected: '2026-07-19' },
    { input: 'Mon Jul 20 2026 00:00:00 GMT-0400 (Eastern Daylight Time)', expected: '2026-07-20' },
    { input: '2026-07-19', expected: '2026-07-19' },
    { input: '2026-12-31', expected: '2026-12-31' },
    { input: '2024-02-29', expected: '2024-02-29' }
  ];

  for (const tz of testTzs) {
    const childScript = `
      const InsightsData = require('./insights-data.js');
      const testCases = ${JSON.stringify(testCases)};
      for (const tc of testCases) {
        const res = InsightsData.parseDay(tc.input);
        if (res !== tc.expected) {
          throw new Error('In TZ ' + process.env.TZ + ', input ' + tc.input + ' produced ' + res + ', expected ' + tc.expected);
        }
      }
    `;

    const res = cp.spawnSync(process.execPath, ['-e', childScript], {
      cwd: rootDir,
      env: { ...process.env, TZ: tz },
      timeout: 5000
    });

    assert.equal(res.status, 0, `Timezone shift detected in ${tz}: ${res.stderr.toString()}`);
  }
});
