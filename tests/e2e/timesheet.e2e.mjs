/**
 * E2E tests for the per-tag timesheet page (/timesheet/<token>): the read-only
 * view a client opens to follow hours worked on one #tag.
 * Run: npx playwright test tests/e2e/timesheet.e2e.mjs
 */
import { test, expect } from '@playwright/test';
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import path from 'path';

const ROOT = path.resolve('.');
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css', '.png':'image/png' };
const TOKEN = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const hour = 3_600_000, min = 60_000;

let server, BASE, timesheet, lastRange;

function iso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fixture({ running = 0 } = {}) {
  const now = Date.now();
  return {
    tag: 'acme',
    now,
    running_count: running,
    week: {
      start: '2026-09-07', end: '2026-09-09',
      total_ms: 5 * hour, net_ms: 5 * hour,
      tasks: [
        { name: 'Landing page', total_ms: 3 * hour, session_count: 4 },
        { name: 'Client calls', total_ms: 2 * hour, session_count: 2 },
      ],
    },
    month: {
      start: '2026-09-01', end: '2026-09-09',
      total_ms: 12 * hour, net_ms: 11 * hour,
      tasks: [{ name: 'Landing page', total_ms: 12 * hour, session_count: 9 }],
    },
    year: {
      start: '2026-01-01', end: '2026-09-09',
      total_ms: 40 * hour, net_ms: 40 * hour,
      tasks: [{ name: 'Landing page', total_ms: 40 * hour, session_count: 30 }],
    },
    days: [
      { date: '2026-08-14', total_ms: 28 * hour, net_ms: 28 * hour },
      { date: '2026-09-07', total_ms: 2 * hour, net_ms: 2 * hour },
      { date: '2026-09-08', total_ms: 3 * hour, net_ms: 3 * hour },
    ],
  };
}

test.beforeAll(async () => {
  server = createServer((req, res) => {
    const [url, qs = ''] = req.url.split('?');
    if (url === `/timesheet/${TOKEN}/data`) {
      const q = new URLSearchParams(qs);
      const body = { ...timesheet };
      if (q.has('from') && q.has('to')) {
        lastRange = { from: q.get('from'), to: q.get('to') };
        body.range = {
          start: q.get('from'), end: q.get('to'),
          total_ms: 7 * hour, net_ms: 6 * hour,
          tasks: [{ name: 'Range work', total_ms: 7 * hour, session_count: 5 }],
        };
        body.days = [...timesheet.days, { date: q.get('from'), total_ms: 7 * hour, net_ms: 6 * hour }];
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
      return;
    }
    const isPageRoute = url === '/' || url === `/timesheet/${TOKEN}`;
    const fp = path.join(ROOT, isPageRoute ? 'index.html' : url);
    if (!existsSync(fp)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
    res.end(readFileSync(fp));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  BASE = `http://127.0.0.1:${server.address().port}`;
});

test.afterAll(() => { server?.close(); });

test.beforeEach(() => { timesheet = fixture(); lastRange = null; });

test('shows the tag and hours for week, month and year', async ({ page }) => {
  await page.goto(`${BASE}/timesheet/${TOKEN}`);
  await expect(page.locator('.ts-title')).toHaveText('#acme');
  await expect(page.locator('#ts-total-week')).toHaveText('5h 0m');
  await expect(page.locator('#ts-decimal-week')).toHaveText('5.00 h');
  await expect(page.locator('#ts-total-month')).toHaveText('12h 0m');
  await expect(page.locator('#ts-total-year')).toHaveText('40h 0m');
});

test('shows net only where parallel tracking makes it differ', async ({ page }) => {
  await page.goto(`${BASE}/timesheet/${TOKEN}`);
  await expect(page.locator('#ts-net-month')).toHaveText('net 11h 0m');
  await expect(page.locator('#ts-net-week')).toHaveCount(0);
});

test('breaks the week down by task and by day, and the year by month', async ({ page }) => {
  await page.goto(`${BASE}/timesheet/${TOKEN}`);
  const names = page.locator('.report-task-name');
  await expect(names.first()).toHaveText('Landing page');
  // Week view: only the two days inside the week window
  await expect(names.filter({ hasText: 'Sep 7' })).toHaveCount(1);
  await expect(names.filter({ hasText: 'Aug 14' })).toHaveCount(0);

  await page.click('[data-ts-period="year"]');
  await expect(page.locator('.ts-section-title').last()).toHaveText('By month');
  await expect(names.filter({ hasText: 'August 2026' })).toHaveCount(1);
});

test('marks the tag as tracking while a session is running', async ({ page }) => {
  timesheet = fixture({ running: 1 });
  await page.goto(`${BASE}/timesheet/${TOKEN}`);
  await expect(page.locator('.ts-live-dot')).toBeVisible();
  await expect(page.locator('.ts-sub')).toContainText('tracking now');
});

test('reports a revoked link', async ({ page }) => {
  await page.route(`**/timesheet/${TOKEN}/data*`, route => route.fulfill({ status: 404, body: '{}' }));
  await page.goto(`${BASE}/timesheet/${TOKEN}`);
  await expect(page.locator('.done-empty')).toContainText('no longer active');
});

test('last month asks the server for the previous calendar month', async ({ page }) => {
  await page.goto(`${BASE}/timesheet/${TOKEN}`);
  await page.click('[data-ts-period="last-month"]');
  await expect(page.locator('#ts-total-range')).toHaveText('7h 0m');
  await expect(page.locator('#ts-decimal-range')).toHaveText('7.00 h');
  await expect(page.locator('#ts-net-range')).toHaveText('net 6h 0m');
  await expect(page.locator('.report-task-name').first()).toHaveText('Range work');

  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const last = new Date(now.getFullYear(), now.getMonth(), 0);
  expect(lastRange).toEqual({ from: iso(first), to: iso(last) });
  await expect(page).toHaveURL(/[?&]period=last-month/);
});

test('last week is the previous Monday to Sunday', async ({ page }) => {
  await page.goto(`${BASE}/timesheet/${TOKEN}`);
  await page.click('[data-ts-period="last-week"]');
  await expect(page.locator('#ts-total-range')).toHaveText('7h 0m');
  const from = new Date(lastRange.from + 'T12:00:00');
  const to = new Date(lastRange.to + 'T12:00:00');
  expect(from.getDay()).toBe(1);
  expect(to.getDay()).toBe(0);
  expect((to - from) / 86_400_000).toBe(6);
  expect(to < new Date()).toBe(true);
});

test('last year is the previous calendar year, broken down by month', async ({ page }) => {
  await page.goto(`${BASE}/timesheet/${TOKEN}`);
  await page.click('[data-ts-period="last-year"]');
  await expect(page.locator('#ts-total-range')).toHaveText('7h 0m');
  const y = new Date().getFullYear() - 1;
  expect(lastRange).toEqual({ from: `${y}-01-01`, to: `${y}-12-31` });
  await expect(page.locator('.ts-section-title').last()).toHaveText('By month');
});

test('a custom range is applied from the date pickers and kept in the URL', async ({ page }) => {
  await page.goto(`${BASE}/timesheet/${TOKEN}`);
  await page.click('[data-ts-period="custom"]');
  await page.fill('#ts-range-from', '2026-03-01');
  await page.fill('#ts-range-to', '2026-03-15');
  await page.click('#ts-range-apply');
  await expect(page.locator('#ts-total-range')).toHaveText('7h 0m');
  expect(lastRange).toEqual({ from: '2026-03-01', to: '2026-03-15' });
  await expect(page).toHaveURL(/[?&]from=2026-03-01/);
  await expect(page).toHaveURL(/[?&]to=2026-03-15/);
  await expect(page.locator('.ts-section-title').last()).toHaveText('By day');
});

test('a range in the URL is selected on load', async ({ page }) => {
  await page.goto(`${BASE}/timesheet/${TOKEN}?from=2026-03-01&to=2026-03-15`);
  await expect(page.locator('#ts-total-range')).toHaveText('7h 0m');
  await expect(page.locator('[data-ts-period="custom"]')).toHaveClass(/active/);
  await expect(page.locator('#ts-range-from')).toHaveValue('2026-03-01');
  expect(lastRange).toEqual({ from: '2026-03-01', to: '2026-03-15' });

  await page.goto(`${BASE}/timesheet/${TOKEN}?period=last-year`);
  await expect(page.locator('[data-ts-period="last-year"]')).toHaveClass(/active/);
  await expect(page.locator('#ts-total-range')).toHaveText('7h 0m');
});

test('going back to this week drops the range from the URL', async ({ page }) => {
  await page.goto(`${BASE}/timesheet/${TOKEN}?period=last-month`);
  await expect(page.locator('#ts-total-range')).toHaveText('7h 0m');
  await page.click('[data-ts-period="week"]');
  await expect(page.locator('#ts-total-range')).toHaveCount(0);
  await expect(page.locator('#ts-total-week')).toHaveText('5h 0m');
  await expect(page).not.toHaveURL(/period=/);
});
