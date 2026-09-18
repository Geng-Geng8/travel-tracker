# Travel Tracker

A static, mobile-friendly PHP/CAD expense tracker with local storage and optional Google Apps Script synchronization.

## Insights

Open the **Insights** tab beside **Add expense** to see:

- Category spending as a donut and ranked list, including exact amounts and percentages.
- Total spending, the largest category, and the daily average.
- Spending over time, with an expandable table of exact amounts.
- Period, bucket, category, and payment filters; switch between saved CAD and PHP amounts.

Select a category in the ranked list to filter the view. **Reset filters** returns to all time and all categories, preserving the selected display currency. Switching tabs preserves an unfinished expense form.

Insights reads the existing expense records; it requires no new backend or chart service. Saving, editing, deleting, and successful synchronization refresh the view. No migration or changes to the Google Apps Script endpoint are needed.

### Calculation details

- Uses the saved `cost_cad` or `cost_php` on each record. Historical expenses are not converted again using today's exchange rate.
- Adds amounts in integer cents. Valid numeric strings from Sheets are supported by the insights calculations.
- Custom date endpoints are inclusive. This month (to date) and last 30 days include today, using the device's local calendar date.
- For all time, the daily average covers the first through last matching expense. For a selected period, it covers every calendar day in that period, including days without expenses.
- Trends group by day for up to 62 days, by month for up to 731 days, and by year for longer ranges. Missing periods show zero spending.
- With more than six nonzero categories, the donut groups smaller categories as “Other categories”; the ranked list always shows every category separately.
- Records missing a valid date or a finite, nonnegative amount are excluded with a visible count. Missing labels receive an explicit fallback label. Zero-value records are retained.

## Files and deployment

Keep `index.html`, `insights.css`, `insights-data.js`, `insights.js`, and the existing app icon together in the site root. The site runs directly on GitHub Pages without a build step. Existing Tailwind, Font Awesome, and font dependencies are unchanged; charts use native SVG.

## Tests

With Node.js installed, run:

```sh
node --test tests/insights-data.test.cjs
```

Tests cover category totals, saved currencies, combined filters, inclusive date ranges, local calendar periods, invalid records, empty results, zero values, and daily/monthly/yearly aggregation.
