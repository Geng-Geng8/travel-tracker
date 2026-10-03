const test = require('node:test');
const assert = require('node:assert/strict');
const data = require('../insights-data.js');

function createMockStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear()
  };
}

// Emulates the trip manager logic from index.html (Universal Currency V2)
function createTripManager(storage) {
  const TRIP_PROFILES_STORAGE_KEY = 'travel_trip_profiles_v1';
  const LEGACY_TRIP_ID = data.LEGACY_TRIP_ID || 'philippines-2026';
  const LEGACY_TRIP_NAME = data.LEGACY_TRIP_NAME || 'Philippines 2026';
  const LEGACY_CURRENCY = data.LEGACY_CURRENCY || 'PHP';

  function getTripProfiles() {
    try {
      const raw = storage.getItem(TRIP_PROFILES_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.trips) && parsed.trips.length > 0) {
          parsed.trips.forEach(t => {
            if (!t.currency || typeof t.currency !== 'string' || !t.currency.trim()) {
              t.currency = (t.id === LEGACY_TRIP_ID) ? LEGACY_CURRENCY : LEGACY_CURRENCY;
            } else {
              t.currency = t.currency.trim().toUpperCase();
            }
          });
          if (!parsed.trips.some(t => t.id === LEGACY_TRIP_ID)) {
            parsed.trips.unshift({ id: LEGACY_TRIP_ID, name: LEGACY_TRIP_NAME, currency: LEGACY_CURRENCY });
          }
          if (!parsed.activeTripId || !parsed.trips.some(t => t.id === parsed.activeTripId)) {
            parsed.activeTripId = parsed.trips[0].id;
          }
          return parsed;
        }
      }
    } catch (err) {
      // fallback
    }
    return {
      version: 1,
      activeTripId: LEGACY_TRIP_ID,
      trips: [
        { id: LEGACY_TRIP_ID, name: LEGACY_TRIP_NAME, currency: LEGACY_CURRENCY }
      ]
    };
  }

  function saveTripProfiles(profiles) {
    storage.setItem(TRIP_PROFILES_STORAGE_KEY, JSON.stringify(profiles));
  }

  function getActiveTripId() {
    return getTripProfiles().activeTripId || LEGACY_TRIP_ID;
  }

  function getActiveTrip() {
    const profiles = getTripProfiles();
    return profiles.trips.find(t => t.id === profiles.activeTripId) || { id: LEGACY_TRIP_ID, name: LEGACY_TRIP_NAME, currency: LEGACY_CURRENCY };
  }

  function generateTripId(name, existingTrips = []) {
    let slug = String(name || '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (!slug) slug = 'trip-' + Date.now().toString(36);
    const existingIds = new Set((existingTrips || []).map(t => t.id));
    if (!existingIds.has(slug)) return slug;
    let candidate = slug;
    let counter = 2;
    while (existingIds.has(candidate)) {
      candidate = `${slug}-${counter}`;
      counter++;
    }
    return candidate;
  }

  function createTrip(name, currency) {
    const trimmedName = String(name || '').trim();
    if (!trimmedName) return null;
    const rawCurr = String(currency || '').trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(rawCurr)) return null;

    const profiles = getTripProfiles();
    const newId = generateTripId(trimmedName, profiles.trips);
    const newTrip = { id: newId, name: trimmedName, currency: rawCurr };
    profiles.trips.push(newTrip);
    profiles.activeTripId = newId;
    saveTripProfiles(profiles);
    return newTrip;
  }

  function switchActiveTrip(tripId) {
    const profiles = getTripProfiles();
    const target = profiles.trips.find(t => t.id === tripId);
    if (!target) return;
    profiles.activeTripId = target.id;
    saveTripProfiles(profiles);
  }

  function getCustomExchangeRate(currency) {
    const c = (currency || LEGACY_CURRENCY).toUpperCase();
    const stored = storage.getItem(`custom_exchange_rate_${c}`);
    if (stored && !isNaN(stored)) return parseFloat(stored);
    if (c === 'PHP') {
      const legacy = storage.getItem('custom_exchange_rate');
      if (legacy && !isNaN(legacy)) return parseFloat(legacy);
    }
    return null;
  }

  function setCustomExchangeRate(currency, rate) {
    const c = (currency || LEGACY_CURRENCY).toUpperCase();
    if (rate && !isNaN(rate) && Number(rate) > 0) {
      storage.setItem(`custom_exchange_rate_${c}`, String(rate));
      if (c === 'PHP') storage.setItem('custom_exchange_rate', String(rate));
    } else {
      storage.removeItem(`custom_exchange_rate_${c}`);
      if (c === 'PHP') storage.removeItem('custom_exchange_rate');
    }
  }

  function getActiveTripExpenses(masterExpenses) {
    const activeId = getActiveTripId();
    return (masterExpenses || []).filter(item => data.getExpenseTripId(item) === activeId);
  }

  function computeTotals(expenses, activeCurrency) {
    let totalCad = 0;
    let totalLocal = 0;
    for (const item of (expenses || [])) {
      const cad = data.parseAmount(item.cost_cad);
      const local = data.getExpenseLocalCost(item);
      if (Number.isFinite(cad)) totalCad += cad;
      if (Number.isFinite(local)) totalLocal += local;
    }
    return {
      totalCad: parseFloat(totalCad.toFixed(2)),
      totalLocal: parseFloat(totalLocal.toFixed(2)),
      currency: activeCurrency,
      count: expenses.length
    };
  }

  function formatCurrency(amount, currencyCode) {
    const code = (currencyCode || 'CAD').toUpperCase();
    const num = Number(amount);
    if (!Number.isFinite(num)) return `— ${code}`;
    try {
      const formatted = new Intl.NumberFormat('en-CA', {
        style: 'currency',
        currency: code,
        currencyDisplay: 'narrowSymbol'
      }).format(num);
      return `${formatted} ${code}`;
    } catch (e) {
      return `${num.toFixed(2)} ${code}`;
    }
  }

  function prepareExpenseRecord({ editingExpenseId, masterExpenses, inputVal, inputCurrency, rate }) {
    let tripId;
    let currencyLocal;
    let rateToUse = rate;

    if (editingExpenseId) {
      const existing = (masterExpenses || []).find(e => e.id.toString() === editingExpenseId.toString());
      tripId = data.getExpenseTripId(existing);
      currencyLocal = data.getExpenseLocalCurrency(existing);
      if (!rateToUse) {
        rateToUse = existing.exchange_rate || (currencyLocal === 'PHP' ? 0.0227 : 1.0);
      }
    } else {
      const activeTrip = getActiveTrip();
      tripId = activeTrip.id;
      currencyLocal = activeTrip.currency;
    }

    let costLocal, costCad;
    if (inputCurrency === 'CAD') {
      costCad = inputVal;
      costLocal = parseFloat((rateToUse > 0 ? (inputVal / rateToUse) : 0).toFixed(2));
    } else {
      costLocal = inputVal;
      costCad = parseFloat((inputVal * rateToUse).toFixed(2));
    }

    const record = {
      id: editingExpenseId || ('id-' + Math.random().toString(16).substring(2, 10)),
      trip_id: tripId,
      date: '2026-10-03',
      cost_local: costLocal,
      currency_local: currencyLocal,
      cost_cad: costCad,
      exchange_rate: rateToUse,
      payment_method: 'Cash',
      bucket: 'Play',
      category: 'Eating Out',
      item: 'Sample Item',
      notes: ''
    };

    if (currencyLocal === 'PHP') {
      record.cost_php = costLocal;
    }

    return record;
  }

  return {
    getTripProfiles,
    saveTripProfiles,
    getActiveTripId,
    getActiveTrip,
    generateTripId,
    createTrip,
    switchActiveTrip,
    getCustomExchangeRate,
    setCustomExchangeRate,
    getActiveTripExpenses,
    computeTotals,
    formatCurrency,
    prepareExpenseRecord
  };
}

// -------------------------------------------------------------
// Targeted Test 1: legacy Philippines row resolves:
// cost_php → cost_local, currency_local → PHP
// -------------------------------------------------------------
test('1. legacy Philippines row resolves: cost_php -> cost_local, currency_local -> PHP', () => {
  const legacyRecord = {
    id: 'legacy-1',
    date: '2026-09-01',
    cost_php: 550,
    cost_cad: 12.50,
    item: 'Manila Lunch'
    // no trip_id, no cost_local, no currency_local
  };

  assert.equal(data.getExpenseTripId(legacyRecord), 'philippines-2026');
  assert.equal(data.getExpenseLocalCost(legacyRecord), 550);
  assert.equal(data.getExpenseLocalCurrency(legacyRecord), 'PHP');
});

// -------------------------------------------------------------
// Targeted Test 2: Philippines Trip Profile defaults to PHP
// -------------------------------------------------------------
test('2. Philippines Trip Profile defaults to PHP', () => {
  const storage = createMockStorage();
  const manager = createTripManager(storage);

  const activeTrip = manager.getActiveTrip();
  assert.equal(activeTrip.id, 'philippines-2026');
  assert.equal(activeTrip.name, 'Philippines 2026');
  assert.equal(activeTrip.currency, 'PHP');
});

// -------------------------------------------------------------
// Targeted Test 3: new Japan trip stores JPY
// -------------------------------------------------------------
test('3. new Japan trip stores JPY', () => {
  const storage = createMockStorage();
  const manager = createTripManager(storage);

  const created = manager.createTrip('Japan 2027', 'jpy'); // lowercase input test
  assert.ok(created);
  assert.equal(created.id, 'japan-2027');
  assert.equal(created.name, 'Japan 2027');
  assert.equal(created.currency, 'JPY');

  // Active trip is now Japan with currency JPY
  const current = manager.getActiveTrip();
  assert.equal(current.id, 'japan-2027');
  assert.equal(current.currency, 'JPY');

  // Invalid currency validation rejection
  assert.equal(manager.createTrip('Bad Trip', 'JP'), null);
  assert.equal(manager.createTrip('Bad Trip', 'TOOLONG'), null);
  assert.equal(manager.createTrip('Bad Trip', '123'), null);
});

// -------------------------------------------------------------
// Targeted Test 4: JPY expense stores: cost_local, currency_local = JPY, cost_cad, trip_id
// -------------------------------------------------------------
test('4. JPY expense stores: cost_local, currency_local = JPY, cost_cad, trip_id (and no cost_php)', () => {
  const storage = createMockStorage();
  const manager = createTripManager(storage);

  manager.createTrip('Japan 2027', 'JPY');
  const jpyRate = 0.0090; // 1 JPY = 0.0090 CAD

  const record = manager.prepareExpenseRecord({
    editingExpenseId: null,
    masterExpenses: [],
    inputVal: 2500,
    inputCurrency: 'LOCAL',
    rate: jpyRate
  });

  assert.equal(record.trip_id, 'japan-2027');
  assert.equal(record.cost_local, 2500);
  assert.equal(record.currency_local, 'JPY');
  assert.equal(record.cost_cad, 22.50); // 2500 * 0.0090 = 22.50
  assert.equal(record.exchange_rate, 0.0090);
  assert.equal(record.cost_php, undefined, 'JPY expense must not populate cost_php');
});

// -------------------------------------------------------------
// Targeted Test 5: USD expense works equivalently
// -------------------------------------------------------------
test('5. USD expense works equivalently', () => {
  const storage = createMockStorage();
  const manager = createTripManager(storage);

  manager.createTrip('USA 2027', 'USD');
  const usdRate = 1.35; // 1 USD = 1.35 CAD

  const record = manager.prepareExpenseRecord({
    editingExpenseId: null,
    masterExpenses: [],
    inputVal: 40,
    inputCurrency: 'LOCAL',
    rate: usdRate
  });

  assert.equal(record.trip_id, 'usa-2027');
  assert.equal(record.cost_local, 40);
  assert.equal(record.currency_local, 'USD');
  assert.equal(record.cost_cad, 54.00); // 40 * 1.35 = 54.00
  assert.equal(record.exchange_rate, 1.35);
  assert.equal(record.cost_php, undefined, 'USD expense must not populate cost_php');
});

// -------------------------------------------------------------
// Targeted Test 6: exchange conversion uses active trip currency → CAD
// -------------------------------------------------------------
test('6. exchange conversion uses active trip currency -> CAD and custom rates are currency-safe', () => {
  const storage = createMockStorage();
  const manager = createTripManager(storage);

  // Set custom rate for PHP: 0.0227
  manager.setCustomExchangeRate('PHP', 0.0227);
  assert.equal(manager.getCustomExchangeRate('PHP'), 0.0227);

  // JPY has no custom rate set yet, should not inherit PHP override
  assert.equal(manager.getCustomExchangeRate('JPY'), null);

  // Set custom rate for JPY: 0.0092
  manager.setCustomExchangeRate('JPY', 0.0092);
  assert.equal(manager.getCustomExchangeRate('JPY'), 0.0092);
  assert.equal(manager.getCustomExchangeRate('PHP'), 0.0227, 'PHP rate must remain intact');

  // Verify CAD per 1 unit math
  const jpyCad = Number((1000 * manager.getCustomExchangeRate('JPY')).toFixed(2));
  assert.equal(jpyCad, 9.20);

  const phpCad = Number((1000 * manager.getCustomExchangeRate('PHP')).toFixed(2));
  assert.equal(phpCad, 22.70);
});

// -------------------------------------------------------------
// Targeted Test 7: history displays correct local currency
// -------------------------------------------------------------
test('7. history displays correct local currency', () => {
  const storage = createMockStorage();
  const manager = createTripManager(storage);

  // JPY formatting
  const jpyFormatted = manager.formatCurrency(2500, 'JPY');
  assert.equal(jpyFormatted, '¥2,500 JPY');

  // CAD formatting
  const cadFormatted = manager.formatCurrency(23.50, 'CAD');
  assert.equal(cadFormatted, '$23.50 CAD');

  // USD formatting
  const usdFormatted = manager.formatCurrency(40.00, 'USD');
  assert.equal(usdFormatted, '$40.00 USD');

  // PHP formatting
  const phpFormatted = manager.formatCurrency(550, 'PHP');
  assert.ok(phpFormatted.includes('PHP') && phpFormatted.includes('550'));
});

// -------------------------------------------------------------
// Targeted Test 8: totals use active trip only
// -------------------------------------------------------------
test('8. totals use active trip only', () => {
  const storage = createMockStorage();
  const manager = createTripManager(storage);

  const mixedExpenses = [
    { id: 'p1', trip_id: 'philippines-2026', cost_cad: 50, cost_local: 2200, currency_local: 'PHP' },
    { id: 'p2', cost_cad: 30, cost_php: 1320 }, // legacy record without trip_id
    { id: 'j1', trip_id: 'japan-2027', cost_cad: 100, cost_local: 11000, currency_local: 'JPY' },
    { id: 'u1', trip_id: 'usa-2027', cost_cad: 75, cost_local: 55, currency_local: 'USD' }
  ];

  // Under Philippines:
  const philExpenses = manager.getActiveTripExpenses(mixedExpenses);
  assert.equal(philExpenses.length, 2);
  const philTotals = manager.computeTotals(philExpenses, 'PHP');
  assert.equal(philTotals.totalCad, 80);
  assert.equal(philTotals.totalLocal, 3520);
  assert.equal(philTotals.currency, 'PHP');

  // Under Japan:
  manager.createTrip('Japan 2027', 'JPY');
  const japanExpenses = manager.getActiveTripExpenses(mixedExpenses);
  assert.equal(japanExpenses.length, 1);
  const japanTotals = manager.computeTotals(japanExpenses, 'JPY');
  assert.equal(japanTotals.totalCad, 100);
  assert.equal(japanTotals.totalLocal, 11000);
  assert.equal(japanTotals.currency, 'JPY');

  // Under USA:
  manager.createTrip('USA 2027', 'USD');
  const usaExpenses = manager.getActiveTripExpenses(mixedExpenses);
  assert.equal(usaExpenses.length, 1);
  const usaTotals = manager.computeTotals(usaExpenses, 'USD');
  assert.equal(usaTotals.totalCad, 75);
  assert.equal(usaTotals.totalLocal, 55);
  assert.equal(usaTotals.currency, 'USD');
});

// -------------------------------------------------------------
// Targeted Test 9: Insights supports CAD + active local currency
// -------------------------------------------------------------
test('9. Insights supports CAD + active local currency', () => {
  const storage = createMockStorage();
  const manager = createTripManager(storage);

  // Japan expenses
  const japanExpenses = [
    { id: 'j1', trip_id: 'japan-2027', date: '2027-04-10', cost_cad: 45.00, cost_local: 5000, currency_local: 'JPY', category: 'Eating Out', bucket: 'Play', payment_method: 'Cash' },
    { id: 'j2', trip_id: 'japan-2027', date: '2027-04-11', cost_cad: 90.00, cost_local: 10000, currency_local: 'JPY', category: 'Travel', bucket: 'Play', payment_method: 'Credit Card' }
  ];

  // 1. Insights in CAD
  const cadSummary = data.summarize(japanExpenses, { period: 'all', bucket: 'all', category: 'all', payment: 'all', currency: 'CAD' });
  assert.equal(cadSummary.count, 2);
  assert.equal(cadSummary.total, 13500); // $135.00 in cents

  // 2. Insights in active local currency JPY
  const jpySummary = data.summarize(japanExpenses, { period: 'all', bucket: 'all', category: 'all', payment: 'all', currency: 'JPY' });
  assert.equal(jpySummary.count, 2);
  assert.equal(jpySummary.total, 1500000); // 15,000 JPY in cents

  // 3. Requesting a non-matching currency skips rows
  const phpSummary = data.summarize(japanExpenses, { period: 'all', bucket: 'all', category: 'all', payment: 'all', currency: 'PHP' });
  assert.equal(phpSummary.count, 0);
  assert.equal(phpSummary.skipped, 2);
});

// -------------------------------------------------------------
// Targeted Test 10: editing preserves original trip and currency
// -------------------------------------------------------------
test('10. editing preserves original trip and currency', () => {
  const storage = createMockStorage();
  const manager = createTripManager(storage);

  const masterExpenses = [
    {
      id: 'legacy-p1',
      cost_php: 800,
      cost_cad: 18.00,
      item: 'Manila Jeepney'
      // legacy row: no trip_id, no cost_local, no currency_local
    },
    {
      id: 'j1',
      trip_id: 'japan-2027',
      currency_local: 'JPY',
      cost_local: 3000,
      cost_cad: 27.00,
      exchange_rate: 0.0090,
      item: 'Tokyo Ramen'
    }
  ];

  // Japan is currently active, but user edits legacy Philippines expense
  manager.createTrip('Japan 2027', 'JPY');
  assert.equal(manager.getActiveTripId(), 'japan-2027');

  const updatedLegacy = manager.prepareExpenseRecord({
    editingExpenseId: 'legacy-p1',
    masterExpenses: masterExpenses,
    inputVal: 1000,
    inputCurrency: 'LOCAL',
    rate: 0.0227
  });

  assert.equal(updatedLegacy.trip_id, 'philippines-2026', 'Editing legacy expense while Japan is active must preserve philippines-2026');
  assert.equal(updatedLegacy.currency_local, 'PHP', 'Editing legacy expense while Japan is active must preserve PHP');
  assert.equal(updatedLegacy.cost_local, 1000);
  assert.equal(updatedLegacy.cost_php, 1000, 'PHP records retain cost_php compatibility');

  // Philippines is active, but user edits Japan expense
  manager.switchActiveTrip('philippines-2026');
  assert.equal(manager.getActiveTripId(), 'philippines-2026');

  const updatedJapan = manager.prepareExpenseRecord({
    editingExpenseId: 'j1',
    masterExpenses: masterExpenses,
    inputVal: 3500,
    inputCurrency: 'LOCAL',
    rate: 0.0090
  });

  assert.equal(updatedJapan.trip_id, 'japan-2027', 'Editing Japan expense while Philippines is active must preserve japan-2027');
  assert.equal(updatedJapan.currency_local, 'JPY', 'Editing Japan expense while Philippines is active must preserve JPY');
  assert.equal(updatedJapan.cost_local, 3500);
  assert.equal(updatedJapan.cost_php, undefined, 'Non-PHP expenses must not store cost_php');
});

// -------------------------------------------------------------
// Targeted Test 11: Trip Profiles V1 localStorage migrates safely
// -------------------------------------------------------------
test('11. Trip Profiles V1 localStorage migrates safely', () => {
  // Simulate pre-existing V1 storage without currency property
  const v1StorageData = {
    version: 1,
    activeTripId: 'japan-2027',
    trips: [
      { id: 'philippines-2026', name: 'Philippines 2026' },
      { id: 'japan-2027', name: 'Japan 2027' }
    ]
  };

  const storage = createMockStorage({
    travel_trip_profiles_v1: JSON.stringify(v1StorageData)
  });

  const manager = createTripManager(storage);
  const profiles = manager.getTripProfiles();

  // Ensure profiles migrated safely without errors
  assert.equal(profiles.trips.length, 2);
  const phil = profiles.trips.find(t => t.id === 'philippines-2026');
  assert.ok(phil);
  assert.equal(phil.currency, 'PHP', 'Philippines 2026 must default to PHP');

  const japan = profiles.trips.find(t => t.id === 'japan-2027');
  assert.ok(japan);
  assert.ok(japan.currency, 'Existing profiles must have a safe fallback currency');

  assert.equal(manager.getActiveTripId(), 'japan-2027', 'Active trip selection is preserved');
});

// -------------------------------------------------------------
// Targeted Test 12: existing 93 legacy Philippines records require no migration
// -------------------------------------------------------------
test('12. existing 93 legacy Philippines records require no migration', () => {
  // Simulate 93 historical Philippines records having only A:K columns
  const mock93Rows = Array.from({ length: 93 }, (_, i) => ({
    id: `legacy-row-${i + 1}`,
    date: '2026-09-05',
    cost_php: 100 + i * 10,
    cost_cad: parseFloat(((100 + i * 10) * 0.0227).toFixed(2)),
    exchange_rate: 0.0227,
    payment_method: i % 2 === 0 ? 'Cash' : 'Credit Card',
    bucket: 'Play',
    category: 'Eating Out',
    item: `Manila Meal ${i + 1}`,
    notes: 'No migration row'
    // Intentionally no trip_id, no cost_local, no currency_local
  }));

  // 1. All 93 resolve to trip_id 'philippines-2026'
  for (const row of mock93Rows) {
    assert.equal(data.getExpenseTripId(row), 'philippines-2026');
    assert.equal(data.getExpenseLocalCost(row), row.cost_php);
    assert.equal(data.getExpenseLocalCurrency(row), 'PHP');
  }

  // 2. Trip filtering includes all 93 for Philippines
  const storage = createMockStorage();
  const manager = createTripManager(storage);
  const filtered = manager.getActiveTripExpenses(mock93Rows);
  assert.equal(filtered.length, 93);

  // 3. Summarize in Insights without modification
  const summaryCad = data.summarize(mock93Rows, { period: 'all', bucket: 'all', category: 'all', payment: 'all', currency: 'CAD' });
  assert.equal(summaryCad.count, 93);
  assert.equal(summaryCad.skipped, 0);

  const summaryPhp = data.summarize(mock93Rows, { period: 'all', bucket: 'all', category: 'all', payment: 'all', currency: 'PHP' });
  assert.equal(summaryPhp.count, 93);
  assert.equal(summaryPhp.skipped, 0);

  // 4. Verify no modifications were made to the original 93 objects
  for (const row of mock93Rows) {
    assert.equal(row.trip_id, undefined, 'Original records remain strictly unmutated');
    assert.equal(row.cost_local, undefined, 'Original records remain strictly unmutated');
    assert.equal(row.currency_local, undefined, 'Original records remain strictly unmutated');
  }
});
