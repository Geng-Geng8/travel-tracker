const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');

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

test('isolated browser verification: flows, filters, currency, errors, responsiveness, and safe rendering', () => {
  const browser = findBrowser();
  assert.ok(browser, 'Runtime-available browser required for isolated browser verification');

  const rootDir = path.resolve(__dirname, '..');
  const indexHtmlPath = path.join(rootDir, 'index.html');
  const baseHtml = fs.readFileSync(indexHtmlPath, 'utf8')
    .replace(/https:\/\/cdn\.tailwindcss\.com/g, '')
    .replace(/https:\/\/cdnjs\.cloudflare\.com[^"]+/g, '');

  const e2eScript = `
    <script>
      window.addEventListener('DOMContentLoaded', () => {
        const $ = id => document.getElementById(id);
        const results = [];
        const check = (desc, cond) => {
          if (!cond) throw new Error('Check failed: ' + desc);
          results.push(desc);
        };

        try {
          // 0. Initial state check: no live webhook configured
          check('No live webhook in storage', localStorage.getItem('gas_webhook_url') === null || localStorage.getItem('gas_webhook_url') === '');

          // 1. Form defaults & unfinished input preservation
          const todayKey = InsightsData.dateKey(new Date());
          check('Date defaults to local calendar today', $('dateInput').value === todayKey);

          $('costInput').value = '42.50';
          $('itemInput').value = 'Unfinished draft item';
          $('notesInput').value = 'Unfinished note';

          // Switch to Insights tab
          $('insightsTab').click();
          check('Insights tab becomes active', !$('insightsPage').hidden && $('expensePage').hidden);
          check('Empty state visible initially', !$('insightsEmpty').hidden);

          // Switch back to Add Expense
          $('expenseTab').click();
          check('Add Expense tab becomes active', !$('expensePage').hidden && $('insightsPage').hidden);
          check('Unfinished costInput preserved', $('costInput').value === '42.50');
          check('Unfinished itemInput preserved', $('itemInput').value === 'Unfinished draft item');
          check('Unfinished notesInput preserved', $('notesInput').value === 'Unfinished note');

          // Reset inputs
          resetFormInputs();
          check('resetFormInputs restores local today', $('dateInput').value === todayKey);
          check('resetFormInputs clears costInput', $('costInput').value === '');

          // 2. Save an expense -> History and Insights update
          setInputCurrency('PHP');
          $('costInput').value = '500';
          $('itemInput').value = 'Jollibee Dinner';
          $('notesInput').value = 'Delicious chickenjoy';
          selectBucket('Play');
          selectCategory('Eating Out');
          selectPaymentMethod('Cash');

          // Submit form
          const submitEvent = new Event('submit', { cancelable: true });
          document.getElementById('expenseForm').dispatchEvent(submitEvent);

          check('Master expenses count is 1', masterExpenses.length === 1);
          check('Hero PHP total updated', $('heroPhpTotal').textContent.includes('₱500 PHP'));
          const cadPreview = (500 * exchangeRateCadPerPhp).toFixed(2);
          check('Hero CAD total updated', $('heroCadTotal').textContent.includes('$' + cadPreview));

          // Verify history list
          const container = $('historyListContainer');
          check('History container has 1 card', container.children.length === 1);
          check('History card has item title', container.textContent.includes('Jollibee Dinner'));
          check('History card has category', container.textContent.includes('Eating Out'));

          // Verify Insights updated
          $('insightsTab').click();
          check('Insights content visible', !$('insightsContent').hidden);
          check('Top category is Eating Out', $('insightsTop').textContent === 'Eating Out');

          // 3. Edit expense -> History and Insights update
          const savedId = masterExpenses[0].id;
          startEditExpense(savedId);
          check('Edit banner displayed', !$('editingBanner').classList.contains('hidden'));
          check('Submit button says Update Expense', $('submitBtnText').textContent === 'Update Expense');
          check('Date retained on edit', $('dateInput').value === todayKey);

          $('costInput').value = '600';
          $('notesInput').value = 'Dinner with halo-halo';
          document.getElementById('expenseForm').dispatchEvent(new Event('submit', { cancelable: true }));

          check('Editing banner hidden after save', $('editingBanner').classList.contains('hidden'));
          check('Cost updated to 600', masterExpenses[0].cost_php === 600);
          check('History updated with new cost', container.textContent.includes('₱600 PHP'));
          check('History updated with new notes', container.textContent.includes('Dinner with halo-halo'));

          // 4. Add more synthetic expenses to verify filters & CAD/PHP switching
          masterExpenses = [
            { id: '1', date: '2026-09-01', bucket: 'Play', category: 'Eating Out', payment_method: 'Cash', cost_cad: 10, cost_php: 440, item: 'Lunch' },
            { id: '2', date: '2026-09-02', bucket: 'Play', category: 'Entertainment', payment_method: 'Credit Card', cost_cad: 20, cost_php: 880, item: 'Cinema' },
            { id: '3', date: '2026-09-03', bucket: 'Necessity', category: 'Grocery', payment_method: 'Cash', cost_cad: 30, cost_php: 1320, item: 'Veggies' },
            { id: '4', date: '2026-09-04', bucket: 'Education', category: 'Books', payment_method: 'Credit Card', cost_cad: 15, cost_php: 660, item: 'Novel' }
          ];
          renderTotalsAndList();
          $('insightsTab').click();

          // CAD vs PHP switching uses stored values directly
          const cadBtn = document.querySelector('[data-currency="CAD"]');
          const phpBtn = document.querySelector('[data-currency="PHP"]');
          cadBtn.click();
          check('CAD total is 75.00', $('insightsTotal').textContent.includes('$75.00'));
          phpBtn.click();
          check('PHP total is 3,300', $('insightsTotal').textContent.includes('3,300'));
          cadBtn.click(); // back to CAD

          // Filter intersections: Bucket + category + payment + date
          $('insightsBucket').value = 'Play';
          $('insightsBucket').dispatchEvent(new Event('change'));
          check('Bucket Play total is 30.00', $('insightsTotal').textContent.includes('$30.00'));

          $('insightsCategory').value = 'Eating Out';
          $('insightsCategory').dispatchEvent(new Event('change'));
          check('Category Eating Out total is 10.00', $('insightsTotal').textContent.includes('$10.00'));

          $('insightsPayment').value = 'Cash';
          $('insightsPayment').dispatchEvent(new Event('change'));
          check('Payment Cash total is 10.00', $('insightsTotal').textContent.includes('$10.00'));

          $('insightsPayment').value = 'Credit Card';
          $('insightsPayment').dispatchEvent(new Event('change'));
          check('Zero results view when payment is Credit Card', $('insightsContent').hidden && !$('insightsEmpty').hidden);

          // Reset filters
          $('insightsReset').click();
          check('Reset restored all 75.00', $('insightsTotal').textContent.includes('$75.00'));

          // Empty results empty state
          $('insightsBucket').value = 'Giving';
          $('insightsBucket').dispatchEvent(new Event('change'));
          check('Empty view title shows No expenses in this view', $('insightsEmptyTitle').textContent === 'No expenses in this view');
          check('Empty action button says Reset filters', $('insightsEmptyAction').textContent === 'Reset filters');
          $('insightsEmptyAction').click();
          check('Empty action resets filters', !$('insightsContent').hidden);

          // Invalid custom date range shows warning instead of all-time totals
          $('insightsPeriod').value = 'custom';
          $('insightsPeriod').dispatchEvent(new Event('change'));
          $('insightsStart').value = '2026-09-20';
          $('insightsEnd').value = '2026-09-10'; // Start > End
          $('insightsStart').dispatchEvent(new Event('change'));
          $('insightsEnd').dispatchEvent(new Event('change'));

          check('Warning displayed for invalid range', !$('insightsWarning').hidden);
          check('Warning message correct', $('insightsWarning').textContent === 'The end date must be on or after the start date.');
          check('Insights content hidden on error', $('insightsContent').hidden);

          $('insightsPeriod').value = 'all';
          $('insightsPeriod').dispatchEvent(new Event('change'));
          check('Warning hidden when period reset', $('insightsWarning').hidden);

          // 5. Delete an expense -> History and Insights update
          check('Count before delete is 4', masterExpenses.length === 4);
          // Delete item 1
          masterExpenses = masterExpenses.filter(e => e.id !== '1');
          renderTotalsAndList();
          check('Count after delete is 3', masterExpenses.length === 3);
          check('Total after delete is 65.00', $('insightsTotal').textContent.includes('$65.00'));

          // 6. Keyboard tab navigation
          const tabContainer = document.querySelector('.app-tabs');
          tabContainer.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
          check('ArrowLeft switches to Expense tab', !$('expensePage').hidden);
          tabContainer.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
          check('ArrowRight switches to Insights tab', !$('insightsPage').hidden);
          tabContainer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home' }));
          check('Home switches to Expense tab', !$('expensePage').hidden);
          tabContainer.dispatchEvent(new KeyboardEvent('keydown', { key: 'End' }));
          check('End switches to Insights tab', !$('insightsPage').hidden);

          // 7. Desktop layout readability
          const desktopTrend = $('insightsTrend').querySelector('svg');
          check('Desktop trend SVG exists', !!desktopTrend);
          check('Breakdown container has category rows', $('insightsBreakdown').children.length > 0);

          // 8. Hostile text in history renders safely
          const hostileItem = {
            id: "hostile_';alert(1);//",
            item: '<' + 'script>alert("xss")</' + 'script>',
            category: '<img src=x onerror=alert(1)>',
            payment_method: '<b>Credit</b>',
            notes: '"><svg onload=alert(1)>',
            date: '2026-09-05',
            cost_cad: '45.50',
            cost_php: '2000'
          };
          masterExpenses.unshift(hostileItem);
          renderTotalsAndList();

          const hostileCard = $('historyListContainer').children[0];
          check('Hostile merchant text is literal', hostileCard.querySelector('.font-bold.text-white').textContent === hostileItem.item);
          check('Hostile notes text is literal', hostileCard.querySelector('.italic').textContent === '"' + hostileItem.notes + '"');
          check('No hostile tags created in card', hostileCard.querySelectorAll('script, img, svg, b').length === 0);

          const resultEl = document.createElement('div');
          resultEl.id = 'e2e-result';
          resultEl.setAttribute('data-status', 'pass');
          resultEl.setAttribute('data-count', String(results.length));
          document.body.appendChild(resultEl);
        } catch (err) {
          const resultEl = document.createElement('div');
          resultEl.id = 'e2e-result';
          resultEl.setAttribute('data-status', 'fail');
          resultEl.setAttribute('data-error', err.message || String(err));
          document.body.appendChild(resultEl);
        }
      });
    </script>
  `;

  // Test at standard desktop resolution
  const tmpDesktop = path.join(rootDir, 'temp_e2e_desktop.html');
  fs.writeFileSync(tmpDesktop, baseHtml.replace('</body>', () => e2eScript + '</body>'), 'utf8');

  let resDesktop;
  try {
    resDesktop = cp.spawnSync(browser, [
      '--headless=new',
      '--disable-gpu',
      '--window-size=1200,800',
      '--dump-dom',
      'file:///' + tmpDesktop.replace(/\\/g, '/')
    ], { timeout: 15000 });
  } finally {
    if (fs.existsSync(tmpDesktop)) fs.unlinkSync(tmpDesktop);
  }

  function parseResult(html, targetId) {
    const tagMatch = html.match(new RegExp('<[^>]*id="' + targetId + '"[^>]*>'));
    if (!tagMatch) return null;
    const tag = tagMatch[0];
    const statusMatch = tag.match(/data-status="([^"]*)"/);
    const errorMatch = tag.match(/data-error="([^"]*)"/);
    const countMatch = tag.match(/data-count="([^"]*)"/);
    return {
      status: statusMatch ? statusMatch[1] : 'unknown',
      error: errorMatch ? errorMatch[1] : '',
      count: countMatch ? countMatch[1] : ''
    };
  }

  const stdoutDesktop = resDesktop.stdout ? resDesktop.stdout.toString() : '';
  const resultDesktop = parseResult(stdoutDesktop, 'e2e-result');
  assert.ok(resultDesktop, 'E2E desktop test completed with DOM output: ' + (resDesktop.stderr ? resDesktop.stderr.toString() : 'no output'));
  assert.equal(resultDesktop.status, 'pass', `E2E Desktop verification failed: ${resultDesktop.error}`);

  // Test at ~390px mobile phone resolution
  const tmpMobile = path.join(rootDir, 'temp_e2e_mobile.html');
  fs.writeFileSync(tmpMobile, baseHtml.replace('</body>', () => e2eScript + '</body>'), 'utf8');

  let resMobile;
  try {
    resMobile = cp.spawnSync(browser, [
      '--headless=new',
      '--disable-gpu',
      '--window-size=390,844',
      '--dump-dom',
      'file:///' + tmpMobile.replace(/\\/g, '/')
    ], { timeout: 15000 });
  } finally {
    if (fs.existsSync(tmpMobile)) fs.unlinkSync(tmpMobile);
  }

  const stdoutMobile = resMobile.stdout ? resMobile.stdout.toString() : '';
  const resultMobile = parseResult(stdoutMobile, 'e2e-result');
  assert.ok(resultMobile, 'E2E mobile test completed with DOM output');
  assert.equal(resultMobile.status, 'pass', `E2E Mobile verification failed: ${resultMobile.error}`);
});
