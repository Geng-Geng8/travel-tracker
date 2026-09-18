/* Pure calculations shared by the Insights page and its Node tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.InsightsData = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const DAY = 86400000;
  function dateKey(date = new Date(), timeZone) {
    const d = date instanceof Date ? date : new Date(date);
    if (timeZone) {
      const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
      const y = parts.find(p => p.type === 'year').value;
      const m = parts.find(p => p.type === 'month').value;
      const dVal = parts.find(p => p.type === 'day').value;
      return `${y}-${m}-${dVal}`;
    }
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function parseDay(value) {
    const key = String(value || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
    const time = Date.parse(key + 'T00:00:00Z');
    return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === key ? key : null;
  }
  function dayNumber(key) { return Date.parse(key + 'T00:00:00Z') / DAY; }
  function addDays(key, days) { return new Date((dayNumber(key) + days) * DAY).toISOString().slice(0, 10); }
  function bounds(period, start, end, today = new Date(), timeZone) {
    const current = dateKey(today, timeZone);
    if (period === 'month') return { start: current.slice(0, 7) + '-01', end: current };
    if (period === '30days') return { start: addDays(current, -29), end: current };
    if (period === 'custom') {
      const from = parseDay(start), to = parseDay(end);
      if (!from || !to) return { error: 'Choose a start and end date to see this period.' };
      if (from > to) return { error: 'The end date must be on or after the start date.' };
      return { start: from, end: to };
    }
    return { start: null, end: null };
  }
  function label(value, fallback) { return typeof value === 'string' && value.trim() ? value.trim() : fallback; }
  function parseAmount(value) {
    if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : NaN;
    if (typeof value === 'string' && value.trim() !== '') {
      const num = Number(value.trim());
      return Number.isFinite(num) && num >= 0 ? num : NaN;
    }
    return NaN;
  }
  function normalize(records, currency) {
    const rows = [];
    let skipped = 0;
    for (const record of records) {
      const value = record && record[currency === 'PHP' ? 'cost_php' : 'cost_cad'];
      const amount = parseAmount(value);
      const cents = Math.round(amount * 100);
      const date = parseDay(record && record.date);
      if (!date || !Number.isSafeInteger(cents) || cents < 0) { skipped++; continue; }
      rows.push({ date, cents, category: label(record.category, 'Uncategorized'), bucket: label(record.bucket, 'Unassigned'), payment: label(record.payment_method, 'Unspecified') });
    }
    return { rows, skipped };
  }
  function matches(row, filters, range) {
    return (!range.start || row.date >= range.start) && (!range.end || row.date <= range.end)
      && (filters.bucket === 'all' || row.bucket === filters.bucket)
      && (filters.category === 'all' || row.category === filters.category)
      && (filters.payment === 'all' || row.payment === filters.payment);
  }
  function summarize(records, filters, today = new Date(), timeZone) {
    const normalized = normalize(records, filters.currency);
    const range = bounds(filters.period, filters.start, filters.end, today, timeZone);
    if (range.error) return { error: range.error, skipped: normalized.skipped };
    const rows = normalized.rows.filter(row => matches(row, filters, range));
    const groups = new Map();
    let total = 0;
    rows.forEach(row => {
      total += row.cents;
      const group = groups.get(row.category) || { name: row.category, cents: 0, count: 0 };
      group.cents += row.cents; group.count++;
      groups.set(row.category, group);
    });
    const categories = [...groups.values()].sort((a, b) => b.cents - a.cents || a.name.localeCompare(b.name));
    const dates = rows.map(row => row.date).sort();
    const start = range.start || dates[0];
    const end = range.end || dates[dates.length - 1];
    const days = start && end ? dayNumber(end) - dayNumber(start) + 1 : 0;
    const unit = days <= 62 ? 'day' : days <= 731 ? 'month' : 'year';
    const trend = [];
    if (start && end) {
      const keyFor = date => date.slice(0, unit === 'day' ? 10 : unit === 'month' ? 7 : 4);
      const totals = new Map();
      rows.forEach(row => { const key = keyFor(row.date); totals.set(key, (totals.get(key) || 0) + row.cents); });
      let cursor = unit === 'day' ? start : unit === 'month' ? start.slice(0, 7) + '-01' : start.slice(0, 4) + '-01-01';
      while (cursor <= end) {
        const key = keyFor(cursor);
        trend.push({ key, cents: totals.get(key) || 0 });
        if (unit === 'day') cursor = addDays(cursor, 1);
        else {
          const date = new Date(cursor + 'T00:00:00Z');
          if (unit === 'month') date.setUTCMonth(date.getUTCMonth() + 1);
          else date.setUTCFullYear(date.getUTCFullYear() + 1);
          cursor = date.toISOString().slice(0, 10);
        }
      }
    }
    return { total, count: rows.length, categories, start, end, days, average: days ? total / days : 0, trend, unit, skipped: normalized.skipped };
  }
  return { dateKey, parseDay, addDays, bounds, normalize, summarize, parseAmount };
});
