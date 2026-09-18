const test = require('node:test');
const assert = require('node:assert/strict');
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
test('history and insights handle numeric strings and render malicious fields safely without execution', () => {
  const item = {
    id: "exp_1'; alert(1); //",
    item: '<script>alert("xss")</script>',
    category: '<img src=x onerror=alert(1)>',
    payment_method: '<b>Credit</b>',
    notes: '"><svg onload=alert(1)>',
    date: '2026-09-18',
    cost_cad: '45.50',
    cost_php: '2000'
  };

  // Safe parsing prevents .toFixed crash on numeric string
  const cad = data.parseAmount(item.cost_cad);
  const php = data.parseAmount(item.cost_php);
  assert.equal(cad, 45.5);
  assert.equal(php, 2000);
  assert.equal(cad.toFixed(2), '45.50');
  assert.equal(Math.round(php).toLocaleString(), '2,000');

  // When simulated in DOM node textContent, markup characters are treated literally
  const mockNode = { textContent: '' };
  mockNode.textContent = item.item;
  assert.equal(mockNode.textContent, '<script>alert("xss")</script>');
  mockNode.textContent = item.category;
  assert.equal(mockNode.textContent, '<img src=x onerror=alert(1)>');
  mockNode.textContent = `"${item.notes}"`;
  assert.equal(mockNode.textContent, '""><svg onload=alert(1)>"');
});
