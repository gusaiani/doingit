/**
 * E2E tests for the Pomodoro timer toggle and settings.
 * Run: npx playwright test tests/e2e/pomodoro.e2e.mjs
 */
import { test, expect } from '@playwright/test';
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import path from 'path';

const ROOT = path.resolve('.');
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css', '.png':'image/png' };

let server, BASE;

test.beforeAll(async () => {
  server = createServer((req, res) => {
    let fp = path.join(ROOT, req.url === '/' ? 'index.html' : req.url);
    if (!existsSync(fp)) { res.writeHead(404); res.end(); return; }
    const ext = path.extname(fp);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(readFileSync(fp));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  BASE = `http://127.0.0.1:${server.address().port}`;
});

test.afterAll(() => { server?.close(); });

// ── Helpers ───────────────────────────────────────────────────────────────────

async function loadPage(page, overrides = {}) {
  await page.goto(BASE);
  await page.evaluate((opts) => {
    localStorage.clear();
    if (opts.pomodoroActive) localStorage.setItem('tt_pomodoro_active', 'true');
    if (opts.pomodoroMins) localStorage.setItem('tt_pomodoro_mins', opts.pomodoroMins);
  }, overrides);
  await page.reload();
  await page.waitForSelector('.header', { state: 'visible', timeout: 5000 });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Pomodoro', () => {

  test('pomodoro button is visible and inactive by default', async ({ page }) => {
    await loadPage(page);
    const btn = page.locator('#header-pomodoro');
    await expect(btn).toBeVisible();
    await expect(btn).not.toHaveClass(/active/);
  });

  test('clicking pomodoro button toggles active state', async ({ page }) => {
    await loadPage(page);
    const btn = page.locator('#header-pomodoro');

    await btn.click();
    await expect(btn).toHaveClass(/active/);

    await btn.click();
    await expect(btn).not.toHaveClass(/active/);
  });

  test('pomodoro active state persists across reload', async ({ page }) => {
    await loadPage(page, { pomodoroActive: true });
    await expect(page.locator('#header-pomodoro')).toHaveClass(/active/);
  });

  test('minutes input defaults to 25', async ({ page }) => {
    await loadPage(page);
    await expect(page.locator('#header-pomodoro-mins')).toHaveValue('25');
  });

  test('minutes input is disabled when pomodoro is inactive', async ({ page }) => {
    await loadPage(page);
    // The input should have pointer-events: none (via CSS sibling selector)
    const pointerEvents = await page.locator('#header-pomodoro-mins').evaluate(el =>
      getComputedStyle(el).pointerEvents
    );
    expect(pointerEvents).toBe('none');
  });

  test('minutes input is interactive when pomodoro is active', async ({ page }) => {
    await loadPage(page);
    await page.locator('#header-pomodoro').click();

    const pointerEvents = await page.locator('#header-pomodoro-mins').evaluate(el =>
      getComputedStyle(el).pointerEvents
    );
    expect(pointerEvents).toBe('auto');
  });

  test('custom minutes value persists across reload', async ({ page }) => {
    await loadPage(page, { pomodoroMins: '15' });
    await expect(page.locator('#header-pomodoro-mins')).toHaveValue('15');
  });
});
