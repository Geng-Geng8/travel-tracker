const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const data = require('../insights-data.js');
const filters = { period: 'all', bucket: 'all', category: 'all', payment: 'all', currency: 'CAD' };
const records = [
  { date: '2026-09-01', cost_cad: 10.10, cost_php: 440, category: 'Eating Out', bucket: 'Play', payment_method: 'Cash' },
  { date: '2026-09-03', cost_cad: '20.20', cost_php: '890', category: 'Eating Out', bucket: 'Play', payment_method: 'Credit Card' },
  { date: '2026-09-03', cost_cad: 30, cost_php: 1300, category: 'Grocery', bucket: 'Necessity', payment_method: 'Cash' },
  { date: '2026-08-31', cost_cad: 5, cost_php: 210, category: 'Books', bucket: 'Education', payment_method: 'Cash' }
];
test('category totals use exact cents, numeric Sheet strings, and historical currency amounts', () => {
  const cad = data.summarize(records, filters);
  assert.equal(cad.total, 6530);
  assert.deepEqual(cad.categories.map(x => [x.name, x.cents]), [['Eating Out', 3030], ['Grocery', 3000], ['Books', 500]]);
  assert.equal(data.summarize(records, { ...filters, currency: 'PHP' }).total, 284000);
  assert.equal(cad.categories.reduce((sum, x) => sum + x.cents, 0), cad.total);
  assert.equal(cad.trend.reduce((sum, x) => sum + x.cents, 0), cad.total);
});
test('date, bucket, category, and payment filters intersect and include both boundary days', () => {
  const summary = data.summarize(records, { ...filters, period: 'custom', start: '2026-09-01', end: '2026-09-03', bucket: 'Play', category: 'Eating Out', payment: 'Credit Card' });
  assert.equal(summary.count, 1); assert.equal(summary.total, 2020);
  assert.equal(summary.days, 3); assert.equal(summary.average, 2020 / 3);
  assert.deepEqual(summary.trend.map(x => x.cents), [0, 0, 2020]);
  assert.equal(data.summarize(records, { ...filters, period: 'custom', start: '2026-09-01', end: '2026-09-03' }).count, 3);
});
test('this month (to date) and last 30 days stop at today and use local calendar dates', () => {
  const today = new Date(2026, 8, 18, 23, 30);
  assert.deepEqual(data.bounds('month', null, null, today), { start: '2026-09-01', end: '2026-09-18' });
  assert.deepEqual(data.bounds('30days', null, null, today), { start: '2026-08-20', end: '2026-09-18' });
  const summary = data.summarize([...records, { ...records[0], date: '2026-09-19' }], { ...filters, period: 'month' }, today);
  assert.equal(summary.count, 3); assert.equal(summary.days, 18);
});
test('invalid custom ranges never silently produce all-time figures', () => {
  for (const [start, end] of [['', ''], ['2026-09-03', '2026-09-01'], ['2026-02-30', '2026-09-01']]) {
    assert.ok(data.summarize(records, { ...filters, period: 'custom', start, end }).error);
  }
});
test('bad records are excluded explicitly, missing labels receive fallbacks, and zero stays valid', () => {
  const summary = data.summarize([
    { date: '2026-09-01T00:00:00.000Z', cost_cad: 0 },
    { date: 'invalid', cost_cad: 20 }, null,
    { date: '2026-09-01', cost_cad: -1 },
    { date: '2026-09-01', cost_cad: '' },
    { date: '2026-09-01', cost_cad: Infinity },
    { date: '2026-09-01', cost_cad: true }
  ], filters);
  assert.equal(summary.count, 1); assert.equal(summary.skipped, 6); assert.equal(summary.total, 0);
  assert.equal(summary.categories[0].name, 'Uncategorized');
});
test('no results and a single day remain well-defined', () => {
  const empty = data.summarize(records, { ...filters, category: 'Hotels' });
  assert.equal(empty.count, 0); assert.equal(empty.total, 0); assert.deepEqual(empty.trend, []);
  const one = data.summarize([records[0]], filters);
  assert.equal(one.days, 1); assert.equal(one.average, 1010); assert.equal(one.trend.length, 1);
});
test('longer ranges aggregate by month/year with missing periods retained', () => {
  const monthly = data.summarize([records[0], { ...records[0], date: '2026-12-01' }], filters);
  assert.equal(monthly.unit, 'month');
  assert.deepEqual(monthly.trend.map(x => x.cents), [1010, 0, 0, 1010]);
  const yearly = data.summarize([records[0], { ...records[0], date: '2029-01-01' }], filters);
  assert.equal(yearly.unit, 'year'); assert.equal(yearly.trend.length, 4);
  assert.equal(yearly.trend.reduce((sum, x) => sum + x.cents, 0), yearly.total);
});
test('leap days, duplicate categories across buckets, and HTML-like labels are preserved safely as data', () => {
  assert.equal(data.parseDay('2024-02-29'), '2024-02-29'); assert.equal(data.parseDay('2026-02-29'), null);
  const items = [records[0], { ...records[0], bucket: 'Business', category: '<script>alert(1)</script>' }];
  const before = JSON.stringify(items);
  const summary = data.summarize(items, filters);
  assert.equal(summary.count, 2); assert.equal(JSON.stringify(items), before);
});
test('shared local date helper agrees around midnight in Toronto and Manila', () => {
  const torontoEvening = new Date('2026-09-19T03:59:00Z'); // 23:59 EDT on Sep 18
  const torontoMorning = new Date('2026-09-19T04:01:00Z'); // 00:01 EDT on Sep 19
  const manilaEvening  = new Date('2026-09-18T15:59:00Z'); // 23:59 PHT on Sep 18
  const manilaMorning  = new Date('2026-09-18T16:01:00Z'); // 00:01 PHT on Sep 19

  // Toronto before midnight: local date is Sep 18 (while UTC date is already Sep 19)
  assert.equal(data.dateKey(torontoEvening, 'America/Toronto'), '2026-09-18');
  assert.equal(data.bounds('month', null, null, torontoEvening, 'America/Toronto').end, '2026-09-18');
  assert.notEqual(torontoEvening.toISOString().split('T')[0], data.dateKey(torontoEvening, 'America/Toronto'));

  // Toronto after midnight: local date is Sep 19
  assert.equal(data.dateKey(torontoMorning, 'America/Toronto'), '2026-09-19');
  assert.equal(data.bounds('month', null, null, torontoMorning, 'America/Toronto').end, '2026-09-19');

  // Manila before midnight: local date is Sep 18
  assert.equal(data.dateKey(manilaEvening, 'Asia/Manila'), '2026-09-18');
  assert.equal(data.bounds('month', null, null, manilaEvening, 'Asia/Manila').end, '2026-09-18');

  // Manila after midnight: local date is Sep 19
  assert.equal(data.dateKey(manilaMorning, 'Asia/Manila'), '2026-09-19');
  assert.equal(data.bounds('month', null, null, manilaMorning, 'Asia/Manila').end, '2026-09-19');
});
test('parseAmount validates numbers and numeric strings without defaulting invalid inputs to zero', () => {
  assert.equal(data.parseAmount(25.5), 25.5);
  assert.equal(data.parseAmount('25.50'), 25.5);
  assert.equal(data.parseAmount(0), 0);
  assert.equal(data.parseAmount('0'), 0);

  // Invalid values return NaN, never zero
  for (const bad of ['', '   ', null, undefined, 'abc', -5, Infinity, true, '1,200']) {
    assert.ok(Number.isNaN(data.parseAmount(bad)), `Expected NaN for: ${bad}`);
  }
});
test('production date behavior uses local device calendar date without shifting saved expense dates', () => {
  const rootDir = path.resolve(__dirname, '..');
  const now = new Date();
  const localToday = data.dateKey(now);
  assert.match(localToday, /^\d{4}-\d{2}-\d{2}$/);

  // Insights "This month" and "Last 30 days" end on the exact same local date
  assert.equal(data.bounds('month').end, localToday);
  assert.equal(data.bounds('30days').end, localToday);

  // Saved expense dates from Google Sheets/local records are calendar dates, preserved exactly
  const sheetRecord = { date: '2026-09-01', cost_cad: '10.50', cost_php: '450', category: 'Travel', bucket: 'Play', payment_method: 'Cash' };
  const normalized = data.normalize([sheetRecord], 'CAD');
  assert.equal(normalized.rows[0].date, '2026-09-01');

  const summarized = data.summarize([sheetRecord], { period: 'all', bucket: 'all', category: 'all', payment: 'all', currency: 'CAD' });
  assert.equal(summarized.start, '2026-09-01');
  assert.equal(summarized.end, '2026-09-01');

  // Verify generic behavior across generic timezones without Toronto/Manila-specific application logic
  const genericTimezones = ['America/Toronto', 'Asia/Manila', 'UTC', 'Pacific/Auckland'];
  for (const tz of genericTimezones) {
    const childScript = `
      const data = require('./insights-data.js');
      const now = new Date();
      const localToday = data.dateKey(now);
      const mBounds = data.bounds('month');
      const dBounds = data.bounds('30days');
      if (mBounds.end !== localToday) throw new Error('Month bounds end mismatch in ' + '${tz}');
      if (dBounds.end !== localToday) throw new Error('30days bounds end mismatch in ' + '${tz}');
      const norm = data.normalize([{ date: '2026-09-01', cost_cad: 10 }], 'CAD');
      if (norm.rows[0].date !== '2026-09-01') throw new Error('Saved date was shifted in ' + '${tz}');
    `;
    const res = cp.spawnSync(process.execPath, ['-e', childScript], {
      cwd: rootDir,
      env: { ...process.env, TZ: tz },
      timeout: 5000
    });
    assert.equal(res.status, 0, `TZ generic test failed for ${tz}: ${res.stderr.toString()}`);
  }
});

test('historical Google Sheet records normalize correctly, preserve calendar dates without timezone shifting, and retain dropdown options', () => {
  const rootDir = path.resolve(__dirname, '..');
  const historicalRecord = {
    id: '1786806972932',
    date: 'Sun Jul 19 2026 00:00:00 GMT-0400 (Daylight na Oras sa Silangan ng Hilagang Amerika)',
    cost_php: 1250,
    cost_cad: 28.38,
    exchange_rate: 0.0227,
    payment_method: 'Credit Card',
    bucket: 'Play',
    category: 'Eating Out',
    item: 'Synthetic Merchant',
    notes: 'Synthetic Note'
  };

  // 1. Historical record normalizes correctly in CAD and PHP
  const normCad = data.normalize([historicalRecord], 'CAD');
  assert.equal(normCad.skipped, 0);
  assert.equal(normCad.rows.length, 1);
  assert.equal(normCad.rows[0].cents, 2838);
  assert.equal(normCad.rows[0].date, '2026-07-19');
  assert.equal(normCad.rows[0].bucket, 'Play');
  assert.equal(normCad.rows[0].category, 'Eating Out');
  assert.equal(normCad.rows[0].payment, 'Credit Card');

  const normPhp = data.normalize([historicalRecord], 'PHP');
  assert.equal(normPhp.skipped, 0);
  assert.equal(normPhp.rows.length, 1);
  assert.equal(normPhp.rows[0].cents, 125000);
  assert.equal(normPhp.rows[0].date, '2026-07-19');

  // 2. Date remains the correct calendar day across generic timezones without timezone shifting
  const testTzs = ['America/Toronto', 'Asia/Manila', 'UTC', 'Pacific/Auckland', 'Pacific/Honolulu'];
  for (const tz of testTzs) {
    const childScript = `
      const data = require('./insights-data.js');
      const parsed = data.parseDay('${historicalRecord.date}');
      if (parsed !== '2026-07-19') throw new Error('Expected 2026-07-19, got ' + parsed + ' in ' + '${tz}');
    `;
    const res = cp.spawnSync(process.execPath, ['-e', childScript], {
      cwd: rootDir,
      env: { ...process.env, TZ: tz },
      timeout: 5000
    });
    assert.equal(res.status, 0, `Date timezone shift detected in ${tz}: ${res.stderr.toString()}`);
  }

  // 3. CAD/PHP values parse correctly from numbers and valid numeric strings
  assert.equal(data.parseAmount(historicalRecord.cost_cad), 28.38);
  assert.equal(data.parseAmount(historicalRecord.cost_php), 1250);
  assert.equal(data.parseAmount('28.38'), 28.38);
  assert.equal(data.parseAmount('1250'), 1250);

  // 4. Bucket, category, and payment options remain available independently of currency usability
  const partialRecord = {
    id: '1786806972933',
    date: 'Mon Jul 20 2026 00:00:00 GMT-0400 (Eastern Daylight Time)',
    cost_php: 500,
    cost_cad: null, // missing/unusable CAD amount
    bucket: 'Giving',
    category: 'Charity',
    payment_method: 'Cash'
  };
  const labels = data.recordLabels([historicalRecord, partialRecord]);
  assert.deepEqual([...new Set(labels.map(l => l.bucket))].sort(), ['Giving', 'Play']);
  assert.deepEqual([...new Set(labels.map(l => l.category))].sort(), ['Charity', 'Eating Out']);
  assert.deepEqual([...new Set(labels.map(l => l.payment))].sort(), ['Cash', 'Credit Card']);

  // Normalizing CAD skips partialRecord, but options were preserved above
  const mixedCad = data.normalize([historicalRecord, partialRecord], 'CAD');
  assert.equal(mixedCad.skipped, 1);
  assert.equal(mixedCad.rows.length, 1);

  // 5. Genuinely invalid records are still excluded
  const invalidRecords = [
    { date: 'not-a-date', cost_cad: 10 },
    { date: 'Sun Feb 29 2026 00:00:00 GMT-0400', cost_cad: 10 },
    { date: 'Sun Jul 19 2026 00:00:00 GMT-0400', cost_cad: -10 },
    { date: 'Sun Jul 19 2026 00:00:00 GMT-0400', cost_cad: NaN }
  ];
  const normInvalid = data.normalize(invalidRecords, 'CAD');
  assert.equal(normInvalid.rows.length, 0);
  assert.equal(normInvalid.skipped, 4);

  // 6. Current/new record format still works
  const newRecord = {
    id: 'c0a1b2c3',
    date: '2026-09-18',
    cost_cad: 45.50,
    cost_php: 2000,
    bucket: 'Necessity',
    category: 'Grocery',
    payment_method: 'Debit'
  };
  const normNew = data.normalize([newRecord], 'CAD');
  assert.equal(normNew.skipped, 0);
  assert.equal(normNew.rows[0].date, '2026-09-18');
  assert.equal(normNew.rows[0].cents, 4550);
});

function findBrowser() {
  if (process.env.CHROME_BIN && fs.existsSync(process.env.CHROME_BIN)) return process.env.CHROME_BIN;
  if (process.env.BROWSER_BIN && fs.existsSync(process.env.BROWSER_BIN)) return process.env.BROWSER_BIN;
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/msedge',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

test('history and insights handle numeric strings, preserve IDs, and render malicious fields safely in real DOM', () => {
  const browser = findBrowser();
  assert.ok(browser, 'A runtime-available browser (Chrome/Edge/Chromium) is required to verify real DOM security rendering');

  const rootDir = path.resolve(__dirname, '..');
  const indexHtmlPath = path.join(rootDir, 'index.html');
  const baseHtml = fs.readFileSync(indexHtmlPath, 'utf8')
    .replace(/https:\/\/cdn\.tailwindcss\.com/g, '')
    .replace(/https:\/\/cdnjs\.cloudflare\.com[^"]+/g, '');

  const testRunnerScript = `
    <script>
      window.addEventListener('DOMContentLoaded', () => {
        try {
          const hostileItem = {
            id: "exp_1'; alert(1); //",
            item: '<script>alert("xss-merchant")<\\/script>',
            category: '<img src=x onerror=alert("xss-cat")>',
            payment_method: '<b>Credit</b>',
            notes: '"><svg onload=alert("xss-notes")>',
            date: '<script>alert("xss-date")<\\/script>',
            cost_cad: '45.50',
            cost_php: '2000'
          };

          // 1. Date inputs & resetFormInputs verification
          const dateInput = document.getElementById('dateInput');
          if (!dateInput) throw new Error('dateInput not found');
          const expectedToday = InsightsData.dateKey(new Date());
          if (dateInput.value !== expectedToday) {
            throw new Error('Initial dateInput value (' + dateInput.value + ') does not match local today (' + expectedToday + ')');
          }

          dateInput.value = '2020-01-01';
          resetFormInputs();
          if (dateInput.value !== expectedToday) {
            throw new Error('resetFormInputs() did not restore local today');
          }

          // 2. Set up spies for edit, delete, and refresh
          let editedId = null;
          let deletedId = null;
          window.startEditExpense = function(id) { editedId = id; };
          window.deleteSingleExpense = function(id) { deletedId = id; };
          let refreshCalledWith = null;
          window.TravelInsights = {
            refresh: function(expenses) {
              refreshCalledWith = expenses;
            }
          };

          masterExpenses = [ hostileItem ];
          renderTotalsAndList();

          const container = document.getElementById('historyListContainer');
          if (!container) throw new Error('#historyListContainer container element not found');
          const card = container.children[0];
          if (!card) throw new Error('Expense card was not rendered');

          // 3. HTML-like merchant values display literally with no child elements
          const itemEl = card.querySelector('.font-bold.text-white');
          if (!itemEl) throw new Error('Merchant item element not found');
          if (itemEl.textContent !== hostileItem.item) {
            throw new Error('Merchant text mismatch: expected "' + hostileItem.item + '", got "' + itemEl.textContent + '"');
          }
          if (itemEl.children.length !== 0) {
            throw new Error('Merchant element contains unexpected child elements');
          }

          // 4. HTML-like date, category, and payment-method display literally with no child elements
          const metaContainer = card.querySelector('.text-\\\\[11px\\\\]');
          if (!metaContainer) throw new Error('Card metadata container not found');
          const metaSpans = metaContainer.querySelectorAll('span');
          if (metaSpans.length < 3) throw new Error('Expected 3 metadata spans, got ' + metaSpans.length);

          if (metaSpans[0].textContent !== hostileItem.date) {
            throw new Error('Date text mismatch: expected "' + hostileItem.date + '", got "' + metaSpans[0].textContent + '"');
          }
          if (metaSpans[0].children.length !== 0) {
            throw new Error('Date element contains unexpected child elements');
          }

          if (metaSpans[1].textContent !== hostileItem.category) {
            throw new Error('Category text mismatch: expected "' + hostileItem.category + '", got "' + metaSpans[1].textContent + '"');
          }
          if (metaSpans[1].children.length !== 0) {
            throw new Error('Category element contains unexpected child elements');
          }

          if (metaSpans[2].textContent !== hostileItem.payment_method) {
            throw new Error('Payment method text mismatch: expected "' + hostileItem.payment_method + '", got "' + metaSpans[2].textContent + '"');
          }
          if (metaSpans[2].children.length !== 0) {
            throw new Error('Payment method element contains unexpected child elements');
          }

          // 5. HTML-like notes display literally with no child elements
          const notesEl = card.querySelector('.italic');
          if (!notesEl) throw new Error('Notes element not found');
          if (notesEl.textContent !== '"' + hostileItem.notes + '"') {
            throw new Error('Notes text mismatch: expected "\\"' + hostileItem.notes + '\\"", got "' + notesEl.textContent + '"');
          }
          if (notesEl.children.length !== 0) {
            throw new Error('Notes element contains unexpected child elements');
          }

          // 6. No script, image error handler, SVG handler, or injected HTML element is created
          const hostileTags = container.querySelectorAll('script, img, svg, b');
          if (hostileTags.length > 0) {
            throw new Error('Found ' + hostileTags.length + ' injected HTML elements: ' + Array.from(hostileTags).map(t => t.tagName).join(', '));
          }

          const allElements = container.querySelectorAll('*');
          for (const el of allElements) {
            for (const attr of el.attributes) {
              if (attr.name.toLowerCase().startsWith('on') && attr.value.includes('alert')) {
                throw new Error('Found inline handler attribute with hostile code: ' + attr.name + '="' + attr.value + '"');
              }
            }
          }

          // 7. Unusual transaction ID containing quotes reaches Edit handler
          const editBtn = card.querySelector('button[title="Edit"]');
          if (!editBtn) throw new Error('Edit button not found');
          editBtn.click();
          if (editedId !== hostileItem.id) {
            throw new Error('Edit handler received wrong ID: ' + editedId);
          }

          // 8. Unusual transaction ID containing quotes reaches Delete handler
          const deleteBtn = card.querySelector('button[title="Delete"]');
          if (!deleteBtn) throw new Error('Delete button not found');
          deleteBtn.click();
          if (deletedId !== hostileItem.id) {
            throw new Error('Delete handler received wrong ID: ' + deletedId);
          }

          // 9. Numeric strings "45.50" and "2000" render correctly
          const amounts = card.querySelectorAll('.text-right div > div');
          if (!amounts[0] || !amounts[0].textContent.includes('$45.50 CAD')) {
            throw new Error('CAD numeric string amount not rendered correctly: ' + (amounts[0] ? amounts[0].textContent : 'null'));
          }
          if (!amounts[1] || !amounts[1].textContent.includes('₱2,000 PHP')) {
            throw new Error('PHP numeric string amount not rendered correctly: ' + (amounts[1] ? amounts[1].textContent : 'null'));
          }

          // 10. Rendering numeric strings does not prevent TravelInsights.refresh() from running
          if (!refreshCalledWith || refreshCalledWith !== masterExpenses) {
            throw new Error('TravelInsights.refresh() was not called with masterExpenses');
          }

          const resultEl = document.createElement('div');
          resultEl.id = 'test-result';
          resultEl.setAttribute('data-status', 'pass');
          document.body.appendChild(resultEl);
        } catch (err) {
          const resultEl = document.createElement('div');
          resultEl.id = 'test-result';
          resultEl.setAttribute('data-status', 'fail');
          resultEl.setAttribute('data-error', err.message || String(err));
          document.body.appendChild(resultEl);
        }
      });
    </script>
  `;

  function executeInBrowser(html) {
    const tmpFile = path.join(rootDir, 'temp_dom_test.html');
    fs.writeFileSync(tmpFile, html.replace('</body>', testRunnerScript + '</body>'), 'utf8');
    try {
      const res = cp.spawnSync(browser, [
        '--headless=new',
        '--disable-gpu',
        '--dump-dom',
        'file:///' + tmpFile.replace(/\\/g, '/')
      ], { timeout: 10000 });
      const stdout = res.stdout ? res.stdout.toString() : '';
      const match = stdout.match(/id="test-result"\s+data-status="([^"]+)"(?:\s+data-error="([^"]*)")?/);
      return {
        status: match ? match[1] : 'error',
        error: match ? (match[2] || '') : 'No test result found in dumped DOM. Process exit: ' + res.status + ', stderr: ' + (res.stderr ? res.stderr.toString() : '')
      };
    } finally {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    }
  }

  // 1. Verify that current safe implementation PASSES all checks
  const safeResult = executeInBrowser(baseHtml);
  assert.equal(safeResult.status, 'pass', `Safe DOM rendering check failed: ${safeResult.error}`);

  // 2. Verify that the test FAILS if the history renderer is changed back to unsafe innerHTML interpolation
  const originalRenderTotals = fs.readFileSync(indexHtmlPath, 'utf8');
  const renderTotalsBlock = originalRenderTotals.slice(
    originalRenderTotals.indexOf('function renderTotalsAndList()'),
    originalRenderTotals.indexOf('function openSettingsModal()')
  );

  const unsafePreFixRenderer = `function renderTotalsAndList() {
      let totalPhp = 0;
      let totalCad = 0;
      const container = document.getElementById('historyListContainer');
      container.innerHTML = '';
      masterExpenses.forEach(item => {
        totalPhp += (item.cost_php || 0);
        totalCad += (item.cost_cad || 0);
        const card = document.createElement('div');
        card.className = 'p-3 bg-slate-800/80 rounded-2xl border border-slate-700/60 flex justify-between items-center gap-2';
        card.innerHTML = \`
          <div class="flex-1 pr-1">
            <div class="font-bold text-white text-sm">\${escapeHtml(item.item)}</div>
            <div class="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5">
              <span>\${item.date}</span> • 
              <span class="text-amber-400 font-medium">\${item.category}</span> • 
              <span class="text-blue-400 font-medium">\${item.payment_method}</span>
            </div>
            \${item.notes ? \`<div class="text-[10px] text-slate-500 italic mt-0.5">"\${escapeHtml(item.notes)}"</div>\` : ''}
          </div>
          <div class="text-right flex items-center gap-2.5">
            <div>
              <div class="font-extrabold text-blue-300 text-sm">$\${item.cost_cad.toFixed(2)} CAD</div>
              <div class="text-[10px] font-semibold text-amber-400">₱\${Math.round(item.cost_php).toLocaleString()} PHP</div>
            </div>
            <div class="flex flex-col gap-1">
              <button type="button" onclick="startEditExpense('\${item.id}')" title="Edit" class="w-8 h-8 rounded-lg bg-slate-700/60 hover:bg-slate-700 text-blue-400 active:scale-90 flex items-center justify-center transition">
                <i class="fa-solid fa-pen text-xs"></i>
              </button>
              <button type="button" onclick="deleteSingleExpense('\${item.id}')" title="Delete" class="w-8 h-8 rounded-lg bg-slate-700/60 hover:bg-red-950/80 text-red-400 active:scale-90 flex items-center justify-center transition">
                <i class="fa-solid fa-trash-can text-xs"></i>
              </button>
            </div>
          </div>
        \`;
        container.appendChild(card);
      });
      if (masterExpenses.length === 0) {
        container.innerHTML = '<div class="text-center text-slate-500 py-8">No expenses logged yet.</div>';
      }
      document.getElementById('heroCadTotal').innerText = \`$\${totalCad.toFixed(2)}\`;
      document.getElementById('heroPhpTotal').innerText = \`₱\${Math.round(totalPhp).toLocaleString()} PHP\`;
      document.getElementById('historyCount').innerText = masterExpenses.length;
      if (window.TravelInsights) window.TravelInsights.refresh(masterExpenses);
    }
    `;

  const unsafeHtml = baseHtml.replace(renderTotalsBlock, unsafePreFixRenderer);
  const unsafeResult = executeInBrowser(unsafeHtml);
  assert.equal(unsafeResult.status, 'fail', 'Expected unsafe innerHTML renderer to fail security regression check');
  assert.ok(unsafeResult.error, 'Expected unsafe innerHTML renderer to produce an error');
});

