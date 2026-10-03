const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const data = require('../insights-data.js');

function createMockStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear()
  };
}

// Trip profile manager logic matching index.html
function createTripManager(storage) {
  const TRIP_PROFILES_STORAGE_KEY = 'travel_trip_profiles_v1';
  const LEGACY_TRIP_ID = data.LEGACY_TRIP_ID || 'philippines-2026';
  const LEGACY_TRIP_NAME = data.LEGACY_TRIP_NAME || 'Philippines 2026';

  function getTripProfiles() {
    try {
      const raw = storage.getItem(TRIP_PROFILES_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.trips) && parsed.trips.length > 0) {
          if (!parsed.trips.some(t => t.id === LEGACY_TRIP_ID)) {
            parsed.trips.unshift({ id: LEGACY_TRIP_ID, name: LEGACY_TRIP_NAME });
          }
          if (!parsed.activeTripId || !parsed.trips.some(t => t.id === parsed.activeTripId)) {
            parsed.activeTripId = parsed.trips[0].id;
          }
          parsed.version = 1;
          return parsed;
        }
      }
    } catch (err) {
      // fallback
    }
    return {
      version: 1,
      activeTripId: LEGACY_TRIP_ID,
      trips: [{ id: LEGACY_TRIP_ID, name: LEGACY_TRIP_NAME }]
    };
  }

  function saveTripProfiles(profiles) {
    storage.setItem(TRIP_PROFILES_STORAGE_KEY, JSON.stringify(profiles));
  }

  function getActiveTripId() {
    return getTripProfiles().activeTripId || LEGACY_TRIP_ID;
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

  function createTrip(name) {
    const trimmedName = String(name || '').trim();
    if (!trimmedName) return null;
    const profiles = getTripProfiles();
    const newId = generateTripId(trimmedName, profiles.trips);
    const newTrip = { id: newId, name: trimmedName };
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

  function getActiveTripExpenses(masterExpenses) {
    const activeId = getActiveTripId();
    return (masterExpenses || []).filter(item => data.getExpenseTripId(item) === activeId);
  }

  function computeTotals(expenses) {
    let totalCad = 0;
    let totalPhp = 0;
    for (const item of expenses) {
      const cad = data.parseAmount(item.cost_cad);
      const php = data.parseAmount(item.cost_php);
      if (Number.isFinite(cad)) totalCad += cad;
      if (Number.isFinite(php)) totalPhp += php;
    }
    return { totalCad, totalPhp, count: expenses.length };
  }

  function prepareExpenseRecord({ editingExpenseId, masterExpenses, formValues }) {
    let tripId;
    if (editingExpenseId) {
      const existing = (masterExpenses || []).find(e => e.id.toString() === editingExpenseId.toString());
      tripId = data.getExpenseTripId(existing);
    } else {
      tripId = getActiveTripId();
    }
    return {
      id: editingExpenseId || ('id-' + Math.random().toString(16).substring(2, 10)),
      trip_id: tripId,
      ...formValues
    };
  }

  return {
    getTripProfiles,
    saveTripProfiles,
    getActiveTripId,
    generateTripId,
    createTrip,
    switchActiveTrip,
    getActiveTripExpenses,
    computeTotals,
    prepareExpenseRecord
  };
}

test('1. record without trip_id resolves to Philippines 2026', () => {
  // Pure legacy records without trip_id
  assert.equal(data.getExpenseTripId({ id: '1', item: 'Flight', cost_cad: 1200 }), 'philippines-2026');
  // Explicit null, undefined, empty string, or whitespace
  assert.equal(data.getExpenseTripId({ trip_id: undefined }), 'philippines-2026');
  assert.equal(data.getExpenseTripId({ trip_id: null }), 'philippines-2026');
  assert.equal(data.getExpenseTripId({ trip_id: '' }), 'philippines-2026');
  assert.equal(data.getExpenseTripId({ trip_id: '   ' }), 'philippines-2026');
  assert.equal(data.getExpenseTripId(null), 'philippines-2026');
  assert.equal(data.getExpenseTripId(undefined), 'philippines-2026');

  // Explicit existing trip_id preserved
  assert.equal(data.getExpenseTripId({ trip_id: 'philippines-2026' }), 'philippines-2026');
  assert.equal(data.getExpenseTripId({ trip_id: 'japan-2027' }), 'japan-2027');
  assert.equal(data.getExpenseTripId({ trip_id: 'usa-2027' }), 'usa-2027');
});

test('2. new record receives active trip_id', () => {
  const storage = createMockStorage();
  const manager = createTripManager(storage);

  // Default active trip is philippines-2026
  const rec1 = manager.prepareExpenseRecord({
    editingExpenseId: null,
    masterExpenses: [],
    formValues: { item: 'Manila Ferry', cost_cad: 15, cost_php: 650 }
  });
  assert.equal(rec1.trip_id, 'philippines-2026');

  // Create and switch to Japan 2027
  manager.createTrip('Japan 2027');
  assert.equal(manager.getActiveTripId(), 'japan-2027');

  const rec2 = manager.prepareExpenseRecord({
    editingExpenseId: null,
    masterExpenses: [rec1],
    formValues: { item: 'Tokyo Subway Pass', cost_cad: 22, cost_php: 950 }
  });
  assert.equal(rec2.trip_id, 'japan-2027');
});

test('3. Philippines history excludes another trip\'s expenses', () => {
  const storage = createMockStorage();
  const manager = createTripManager(storage);

  const mixedExpenses = [
    { id: 'p1', item: 'Legacy Manila Lunch', cost_cad: 12.50, cost_php: 550 }, // legacy (no trip_id)
    { id: 'p2', trip_id: 'philippines-2026', item: 'Boracay Hotel', cost_cad: 200, cost_php: 8800 },
    { id: 'j1', trip_id: 'japan-2027', item: 'Kyoto Ramen', cost_cad: 18, cost_php: 790 },
    { id: 'u1', trip_id: 'usa-2027', item: 'NYC Bagel', cost_cad: 8, cost_php: 350 }
  ];

  // Active trip is Philippines 2026
  assert.equal(manager.getActiveTripId(), 'philippines-2026');
  const filtered = manager.getActiveTripExpenses(mixedExpenses);

  assert.equal(filtered.length, 2);
  assert.deepEqual(filtered.map(e => e.id), ['p1', 'p2']);
  assert.ok(!filtered.some(e => e.trip_id === 'japan-2027'));
  assert.ok(!filtered.some(e => e.trip_id === 'usa-2027'));
});

test('4. another trip excludes Philippines expenses', () => {
  const storage = createMockStorage();
  const manager = createTripManager(storage);

  manager.createTrip('Japan 2027');
  assert.equal(manager.getActiveTripId(), 'japan-2027');

  const mixedExpenses = [
    { id: 'p1', item: 'Legacy Manila Lunch', cost_cad: 12.50, cost_php: 550 },
    { id: 'p2', trip_id: 'philippines-2026', item: 'Boracay Hotel', cost_cad: 200, cost_php: 8800 },
    { id: 'j1', trip_id: 'japan-2027', item: 'Kyoto Ramen', cost_cad: 18, cost_php: 790 },
    { id: 'j2', trip_id: 'japan-2027', item: 'Shinkansen Ticket', cost_cad: 140, cost_php: 6100 },
    { id: 'u1', trip_id: 'usa-2027', item: 'NYC Bagel', cost_cad: 8, cost_php: 350 }
  ];

  const filtered = manager.getActiveTripExpenses(mixedExpenses);

  assert.equal(filtered.length, 2);
  assert.deepEqual(filtered.map(e => e.id), ['j1', 'j2']);
  assert.ok(!filtered.some(e => e.id === 'p1'));
  assert.ok(!filtered.some(e => e.id === 'p2'));
  assert.ok(!filtered.some(e => e.id === 'u1'));
});

test('5. totals use active trip only', () => {
  const storage = createMockStorage();
  const manager = createTripManager(storage);

  const mixedExpenses = [
    { id: 'p1', item: 'Legacy Manila Hotel', cost_cad: 100, cost_php: 4400 },
    { id: 'p2', trip_id: 'philippines-2026', item: 'Island Tour', cost_cad: 50, cost_php: 2200 },
    { id: 'j1', trip_id: 'japan-2027', item: 'Kyoto Hotel', cost_cad: 300, cost_php: 13200 }
  ];

  // Under Philippines 2026:
  const philExpenses = manager.getActiveTripExpenses(mixedExpenses);
  const philTotals = manager.computeTotals(philExpenses);
  assert.equal(philTotals.totalCad, 150);
  assert.equal(philTotals.totalPhp, 6600);
  assert.equal(philTotals.count, 2);

  // Under Japan 2027:
  manager.createTrip('Japan 2027');
  const japanExpenses = manager.getActiveTripExpenses(mixedExpenses);
  const japanTotals = manager.computeTotals(japanExpenses);
  assert.equal(japanTotals.totalCad, 300);
  assert.equal(japanTotals.totalPhp, 13200);
  assert.equal(japanTotals.count, 1);
});

test('6. Insights receives active-trip records only', () => {
  const storage = createMockStorage();
  const manager = createTripManager(storage);

  const mixedExpenses = [
    { id: 'p1', date: '2026-09-01', item: 'Manila Food', cost_cad: 40, cost_php: 1760, category: 'Eating Out', bucket: 'Play', payment_method: 'Cash' },
    { id: 'p2', trip_id: 'philippines-2026', date: '2026-09-02', item: 'Manila Grocery', cost_cad: 60, cost_php: 2640, category: 'Grocery', bucket: 'Necessity', payment_method: 'Cash' },
    { id: 'j1', trip_id: 'japan-2027', date: '2027-04-10', item: 'Tokyo Train', cost_cad: 50, cost_php: 2200, category: 'Travel', bucket: 'Play', payment_method: 'Credit Card' }
  ];

  // 1. Insights when Philippines is active
  const philExpenses = manager.getActiveTripExpenses(mixedExpenses);
  const philSummary = data.summarize(philExpenses, { period: 'all', bucket: 'all', category: 'all', payment: 'all', currency: 'CAD' });
  assert.equal(philSummary.count, 2);
  assert.equal(philSummary.total, 10000); // $100.00 in cents
  assert.deepEqual(philSummary.categories.map(c => c.name), ['Grocery', 'Eating Out']);
  assert.ok(!philSummary.categories.some(c => c.name === 'Travel'));

  // 2. Insights when Japan is active
  manager.createTrip('Japan 2027');
  const japanExpenses = manager.getActiveTripExpenses(mixedExpenses);
  const japanSummary = data.summarize(japanExpenses, { period: 'all', bucket: 'all', category: 'all', payment: 'all', currency: 'CAD' });
  assert.equal(japanSummary.count, 1);
  assert.equal(japanSummary.total, 5000); // $50.00 in cents
  assert.deepEqual(japanSummary.categories.map(c => c.name), ['Travel']);
  assert.ok(!japanSummary.categories.some(c => c.name === 'Eating Out'));
  assert.ok(!japanSummary.categories.some(c => c.name === 'Grocery'));

  // 3. Empty trip insights
  manager.createTrip('USA 2027');
  const usaExpenses = manager.getActiveTripExpenses(mixedExpenses);
  const usaSummary = data.summarize(usaExpenses, { period: 'all', bucket: 'all', category: 'all', payment: 'all', currency: 'CAD' });
  assert.equal(usaSummary.count, 0);
  assert.equal(usaSummary.total, 0);
  assert.deepEqual(usaSummary.categories, []);
});

test('7. editing preserves the expense\'s original trip', () => {
  const storage = createMockStorage();
  const manager = createTripManager(storage);

  const masterExpenses = [
    { id: 'exp-legacy', item: 'Cebu Mangoes', cost_cad: 10, cost_php: 440 }, // no trip_id
    { id: 'exp-japan', trip_id: 'japan-2027', item: 'Tokyo Sushi', cost_cad: 80, cost_php: 3500 }
  ];

  // Case A: Japan is currently active, but user edits the legacy Philippines expense
  manager.createTrip('Japan 2027');
  assert.equal(manager.getActiveTripId(), 'japan-2027');

  const updatedLegacy = manager.prepareExpenseRecord({
    editingExpenseId: 'exp-legacy',
    masterExpenses: masterExpenses,
    formValues: { item: 'Cebu Mangoes (2 boxes)', cost_cad: 20, cost_php: 880 }
  });
  assert.equal(updatedLegacy.trip_id, 'philippines-2026', 'Editing legacy expense while Japan is active must preserve philippines-2026');

  // Case B: Philippines is currently active, but user edits the Japan expense
  manager.switchActiveTrip('philippines-2026');
  assert.equal(manager.getActiveTripId(), 'philippines-2026');

  const updatedJapan = manager.prepareExpenseRecord({
    editingExpenseId: 'exp-japan',
    masterExpenses: masterExpenses,
    formValues: { item: 'Tokyo Sushi Deluxe', cost_cad: 95, cost_php: 4180 }
  });
  assert.equal(updatedJapan.trip_id, 'japan-2027', 'Editing Japan expense while Philippines is active must preserve japan-2027');
});

test('8. trip profiles survive localStorage reload', () => {
  const storage = createMockStorage();

  // Session 1: Create trips and set active trip
  {
    const manager1 = createTripManager(storage);
    assert.equal(manager1.getActiveTripId(), 'philippines-2026');

    manager1.createTrip('Japan 2027');
    manager1.createTrip('USA 2027');
    manager1.switchActiveTrip('japan-2027');

    const state = manager1.getTripProfiles();
    assert.equal(state.version, 1);
    assert.equal(state.activeTripId, 'japan-2027');
    assert.equal(state.trips.length, 3);
  }

  // Session 2: Fresh instance reading the same localStorage
  {
    const manager2 = createTripManager(storage);
    const restored = manager2.getTripProfiles();

    assert.equal(restored.version, 1);
    assert.equal(restored.activeTripId, 'japan-2027');
    assert.equal(manager2.getActiveTripId(), 'japan-2027');
    assert.deepEqual(
      restored.trips.map(t => [t.id, t.name]),
      [
        ['philippines-2026', 'Philippines 2026'],
        ['japan-2027', 'Japan 2027'],
        ['usa-2027', 'USA 2027']
      ]
    );
  }
});
