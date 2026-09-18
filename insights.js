(function () {
  'use strict';
  const data = window.InsightsData;
  const $ = id => document.getElementById(id);
  const palette = ['#f4b860', '#73b9f5', '#74d6bb', '#b69aef', '#f191a5', '#91a5c2', '#d0d678', '#e99d78'];
  const filters = { period: 'all', bucket: 'all', category: 'all', payment: 'all', currency: 'CAD', start: '', end: '' };
  let records = [], active = false, colors = new Map();
  const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const money = cents => new Intl.NumberFormat('en-CA', { style: 'currency', currency: filters.currency, currencyDisplay: 'narrowSymbol' }).format(cents / 100);
  const percent = (value, total) => total ? `${(value / total * 100).toFixed(1)}%` : '0.0%';
  const color = name => colors.get(name) || palette[0];
  const fullDate = key => new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(key + 'T00:00:00Z'));
  function setPage(insights, focus = false) {
    active = insights;
    $('expensePage').hidden = insights;
    $('insightsPage').hidden = !insights;
    document.querySelector('main').classList.toggle('insights-active', insights);
    ['expenseTab', 'insightsTab'].forEach((id, index) => {
      const selected = insights === (index === 1);
      $(id).setAttribute('aria-selected', String(selected));
      $(id).tabIndex = selected ? 0 : -1;
    });
    if (insights) render();
    if (focus) $(insights ? 'insightsTab' : 'expenseTab').focus();
  }
  function options(id, values, selected, allLabel) {
    const select = $(id);
    select.replaceChildren(new Option(allLabel, 'all'));
    [...new Set(values)].sort((a, b) => a.localeCompare(b)).forEach(value => select.add(new Option(value, value)));
    select.value = values.includes(selected) ? selected : 'all';
    return select.value;
  }
  function updateOptions() {
    const labels = data.recordLabels(records);
    filters.bucket = options('insightsBucket', labels.map(row => row.bucket), filters.bucket, 'All buckets');
    const relevant = labels.filter(row => filters.bucket === 'all' || row.bucket === filters.bucket);
    filters.category = options('insightsCategory', relevant.map(row => row.category), filters.category, 'All categories');
    filters.payment = options('insightsPayment', labels.map(row => row.payment), filters.payment, 'All methods');
    const names = [...new Set(labels.map(row => row.category))].sort();
    const familiar = ['Travel', 'Eating Out', 'Grocery', 'Entertainment', 'Gifts', 'Car & Transportation'];
    const ordered = [...familiar, ...names.filter(name => !familiar.includes(name))];
    colors = new Map(ordered.map((name, index) => [name, palette[index % palette.length]]));
  }
  function resetFilters() {
    Object.assign(filters, { period: 'all', bucket: 'all', category: 'all', payment: 'all', start: '', end: '' });
    $('insightsPeriod').value = 'all'; $('insightsStart').value = ''; $('insightsEnd').value = '';
    $('insightsCustomDates').hidden = true;
    updateOptions(); render();
  }
  function renderDonut(summary) {
    const nonzero = summary.categories.filter(group => group.cents > 0);
    const slices = nonzero.length > 6
      ? [...nonzero.slice(0, 5), { name: 'Other categories', cents: nonzero.slice(5).reduce((sum, group) => sum + group.cents, 0), grouped: true }]
      : nonzero;
    const circumference = 2 * Math.PI * 82;
    let offset = 0;
    const paths = slices.map(slice => {
      const length = slice.cents / summary.total * circumference;
      const markup = `<circle cx="110" cy="110" r="82" fill="none" stroke="${slice.grouped ? '#64748b' : color(slice.name)}" stroke-width="24" stroke-dasharray="${length} ${circumference - length}" stroke-dashoffset="${-offset}"><title>${escape(slice.name)}: ${escape(money(slice.cents))} (${percent(slice.cents, summary.total)})</title></circle>`;
      offset += length;
      return markup;
    }).join('');
    $('insightsDonut').innerHTML = `<svg viewBox="0 0 220 220" role="img" aria-label="Spending share by category. Exact amounts are listed in the category breakdown."><circle cx="110" cy="110" r="82" fill="none" stroke="#273247" stroke-width="24"/>${paths}</svg><div class="insights-donut-center"><strong>${summary.categories.length}</strong><span>${summary.categories.length === 1 ? 'category' : 'categories'}</span></div>`;
    $('insightsLegend').innerHTML = slices.map(slice => `<div class="insights-legend-row"><span class="insights-color-dot" style="background:${slice.grouped ? '#64748b' : color(slice.name)}"></span><span class="insights-legend-name">${escape(slice.name)}</span><strong>${percent(slice.cents, summary.total)}</strong></div>`).join('');
    if (!summary.total) $('insightsLegend').textContent = 'These expenses total zero in the selected currency.';
  }
  function renderBreakdown(summary) {
    $('insightsBreakdown').replaceChildren();
    summary.categories.forEach(group => {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'insights-category-row';
      button.setAttribute('aria-label', `${group.name}: ${money(group.cents)} ${filters.currency}, ${percent(group.cents, summary.total)} of spending. Filter by this category.`);
      button.innerHTML = `<div class="insights-category-top"><span class="insights-category-name">${escape(group.name)}</span><span class="insights-category-amount">${escape(money(group.cents))}</span></div><div class="insights-category-meta"><span>${group.count} ${group.count === 1 ? 'expense' : 'expenses'}</span><span>${percent(group.cents, summary.total)}</span></div><div class="insights-meter" aria-hidden="true"><span style="width:${summary.total ? group.cents / summary.total * 100 : 0}%;background:${color(group.name)}"></span></div>`;
      button.addEventListener('click', () => {
        filters.category = group.name; $('insightsCategory').value = group.name;
        render(); $('insightsCategory').focus();
      });
      $('insightsBreakdown').appendChild(button);
    });
  }
  function trendLabel(key, unit, long = false) {
    if (unit === 'year') return key;
    const date = new Date((unit === 'month' ? key + '-01' : key) + 'T00:00:00Z');
    return new Intl.DateTimeFormat('en-CA', { month: 'short', ...(unit === 'day' ? { day: 'numeric' } : {}), ...(long || unit === 'month' ? { year: 'numeric' } : {}), timeZone: 'UTC' }).format(date);
  }
  function renderTrend(summary) {
    // Keep labels readable on a phone; exact values remain available in the table.
    const width = $('insightsTrend').clientWidth < 450 ? 360 : 800;
    const height = width === 360 ? 210 : 225, left = 52, right = 15, top = 22, bottom = height - 33;
    const plotWidth = width - left - right, plotHeight = bottom - top;
    const max = Math.max(1, ...summary.trend.map(point => point.cents));
    const step = plotWidth / summary.trend.length;
    const barWidth = Math.max(.5, Math.min(35, step * .65));
    const compact = value => new Intl.NumberFormat('en-CA', { notation: 'compact', maximumFractionDigits: 1 }).format(value / 100);
    let svg = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Spending by ${summary.unit}, in ${filters.currency}. Expand View exact amounts for all values.">`;
    [0, .5, 1].forEach(fraction => {
      const y = bottom - plotHeight * fraction;
      svg += `<line x1="${left}" y1="${y}" x2="${width - right}" y2="${y}" stroke="#2b364a" stroke-dasharray="3 5"/><text x="${left - 9}" y="${y + 4}" text-anchor="end" fill="#9aa7bc" font-size="11">${compact(max * fraction)}</text>`;
    });
    const labelCount = width === 360 ? 3 : 5;
    const labelIndexes = new Set(Array.from({ length: Math.min(labelCount, summary.trend.length) }, (_, i) => Math.round(i * (summary.trend.length - 1) / (Math.min(labelCount, summary.trend.length) - 1 || 1))));
    summary.trend.forEach((point, index) => {
      const x = left + step * (index + .5), h = point.cents / max * plotHeight;
      if (point.cents > 0) svg += `<rect x="${x - barWidth / 2}" y="${bottom - h}" width="${barWidth}" height="${h}" rx="${Math.min(4, barWidth / 2, h / 2)}" fill="${point.cents === max ? '#f4b860' : '#799fba'}"><title>${escape(trendLabel(point.key, summary.unit, true))}: ${escape(money(point.cents))} ${filters.currency}</title></rect>`;
      if (labelIndexes.has(index)) svg += `<text x="${x}" y="${height - 10}" text-anchor="${index === 0 ? 'start' : index === summary.trend.length - 1 ? 'end' : 'middle'}" fill="#9aa7bc" font-size="10">${escape(trendLabel(point.key, summary.unit))}</text>`;
    });
    $('insightsTrend').innerHTML = svg + '</svg>';
    $('insightsTrendUnit').textContent = filters.currency;
    $('insightsTrendNote').textContent = `${summary.unit === 'day' ? 'Daily' : summary.unit === 'month' ? 'Monthly' : 'Yearly'} totals · ${fullDate(summary.start)} – ${fullDate(summary.end)}`;
    $('insightsTrendTable').innerHTML = `<table><caption class="sr-only">Spending over time in ${filters.currency}</caption><thead><tr><th scope="col">Period</th><th scope="col">Amount (${filters.currency})</th></tr></thead><tbody>${summary.trend.map(point => `<tr><th scope="row">${escape(trendLabel(point.key, summary.unit, true))}</th><td>${escape(money(point.cents))}</td></tr>`).join('')}</tbody></table>`;
  }
  function render() {
    if (!active) return;
    const summary = data.summarize(records, filters);
    const warning = summary.error || (summary.skipped ? `${summary.skipped} ${summary.skipped === 1 ? 'record is' : 'records are'} excluded because a date or ${filters.currency} amount is missing or invalid.` : '');
    $('insightsWarning').hidden = !warning; $('insightsWarning').textContent = warning;
    const period = $('insightsPeriod').selectedOptions[0].textContent;
    $('insightsScope').textContent = `${period} · ${filters.currency}${summary.error ? '' : ` · ${summary.count} ${summary.count === 1 ? 'expense' : 'expenses'}`}`;
    $('insightsContent').hidden = !!summary.error || !summary.count;
    $('insightsEmpty').hidden = !!summary.error || !!summary.count;
    if (summary.error) return;
    if (!summary.count) {
      const noRecords = records.length === 0;
      $('insightsEmptyTitle').textContent = noRecords ? 'Your next expense starts the story' : 'No expenses in this view';
      $('insightsEmptyText').textContent = noRecords ? 'Save an expense and your spending picture will appear here automatically.' : 'Try another period or reset your filters to see more of your spending.';
      $('insightsEmptyAction').textContent = noRecords ? 'Add an expense' : 'Reset filters';
      return;
    }
    const topCategory = summary.categories[0];
    $('insightsTotal').textContent = money(summary.total);
    $('insightsCount').textContent = `${filters.currency} across ${summary.count} ${summary.count === 1 ? 'expense' : 'expenses'}`;
    $('insightsTop').textContent = topCategory.name;
    $('insightsTopShare').textContent = `${money(topCategory.cents)} · ${percent(topCategory.cents, summary.total)} of total`;
    $('insightsAverage').textContent = money(summary.average);
    $('insightsAverageNote').textContent = `Across ${summary.days} calendar ${summary.days === 1 ? 'day' : 'days'}${filters.period === 'all' ? ' · first to last expense' : ' in this period'}`;
    renderDonut(summary); renderBreakdown(summary); renderTrend(summary);
  }
  $('expenseTab').addEventListener('click', () => setPage(false));
  $('insightsTab').addEventListener('click', () => setPage(true));
  document.querySelector('.app-tabs').addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    setPage(event.key === 'Home' ? false : event.key === 'End' ? true : !active, true);
  });
  ['Period', 'Bucket', 'Category', 'Payment', 'Start', 'End'].forEach(name => {
    $('insights' + name).addEventListener('change', event => {
      filters[name.toLowerCase()] = event.target.value;
      if (name === 'Period') {
        $('insightsCustomDates').hidden = filters.period !== 'custom';
        if (filters.period === 'custom' && !filters.start && !filters.end) {
          filters.end = data.dateKey(new Date()); filters.start = data.addDays(filters.end, -29);
          $('insightsStart').value = filters.start; $('insightsEnd').value = filters.end;
        }
      }
      if (name === 'Bucket') updateOptions();
      render();
    });
  });
  document.querySelectorAll('[data-currency]').forEach(button => button.addEventListener('click', () => {
    filters.currency = button.dataset.currency;
    document.querySelectorAll('[data-currency]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    updateOptions(); render();
  }));
  $('insightsReset').addEventListener('click', resetFilters);
  $('insightsEmptyAction').addEventListener('click', () => { if (!records.length) setPage(false, true); else resetFilters(); });
  let resizeTimer;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(render, 150); });
  window.TravelInsights = { refresh(expenses) { records = Array.isArray(expenses) ? expenses : []; updateOptions(); render(); } };
  window.TravelInsights.refresh(masterExpenses);
})();
