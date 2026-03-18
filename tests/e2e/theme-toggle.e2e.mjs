/**
 * E2E tests for dark-mode / theme toggle.
 * Run: npx playwright test tests/e2e/theme-toggle.e2e.mjs
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

async function loadPage(page, themeOverride) {
  await page.goto(BASE);
  await page.evaluate((theme) => {
    localStorage.removeItem('tt_token');
    if (theme !== undefined) {
      localStorage.setItem('tt_theme', theme);
    } else {
      localStorage.removeItem('tt_theme');
    }
  }, themeOverride);
  await page.reload();
  await page.waitForSelector('.header', { state: 'visible', timeout: 5000 });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Theme toggle', () => {

  test('toggle button is visible in header', async ({ page }) => {
    await loadPage(page);
    const btn = page.locator('#theme-toggle');
    await expect(btn).toBeVisible();
  });

  test('defaults to light theme when no localStorage value', async ({ page }) => {
    await loadPage(page);
    const theme = await page.evaluate(() => localStorage.getItem('tt_theme'));
    expect(theme).toBeNull();
    const attr = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expect(attr).toBe('light');
  });

  test('clicking cycles through light → dark → system → light', async ({ page }) => {
    await loadPage(page);
    const btn = page.locator('#theme-toggle');

    // starts at light (default)
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    // click → dark
    await btn.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await page.evaluate(() => localStorage.getItem('tt_theme'))).toBe('dark');

    // click → system
    await btn.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'system');
    expect(await page.evaluate(() => localStorage.getItem('tt_theme'))).toBe('system');

    // click → light (clears localStorage)
    await btn.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    expect(await page.evaluate(() => localStorage.getItem('tt_theme'))).toBeNull();
  });

  test('persists light theme across reload', async ({ page }) => {
    await loadPage(page, 'light');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });

  test('persists dark theme across reload', async ({ page }) => {
    await loadPage(page, 'dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('persists system theme across reload', async ({ page }) => {
    await loadPage(page, 'system');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'system');
  });

  test('dark theme applies dark background color', async ({ page }) => {
    await loadPage(page, 'dark');
    const bg = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
    );
    expect(bg).not.toBe('#FCFBFB');
  });

  test('light theme applies light background color', async ({ page }) => {
    await loadPage(page, 'light');
    const bg = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
    );
    expect(bg).toBe('#FCFBFB');
  });

  test('toggle button shows correct icon for each theme', async ({ page }) => {
    await loadPage(page);
    const btn = page.locator('#theme-toggle');

    // light mode (default) — shows moon icon (action: go dark)
    let icon = await btn.locator('[data-icon]').getAttribute('data-icon');
    expect(icon).toBe('light');

    // click → dark — shows sun icon (action: go light)
    await btn.click();
    icon = await btn.locator('[data-icon]').getAttribute('data-icon');
    expect(icon).toBe('dark');

    // click → system — shows sun icon with OS label
    await btn.click();
    icon = await btn.locator('[data-icon]').getAttribute('data-icon');
    expect(icon).toBe('system');
    await expect(btn.locator('.theme-os-label')).toHaveText('OS');
  });

  test('system theme follows prefers-color-scheme: dark', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await loadPage(page, 'system');

    const bg = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
    );
    expect(bg).not.toBe('#FCFBFB');
  });

  test('system theme follows prefers-color-scheme: light', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await loadPage(page, 'system');

    const bg = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
    );
    expect(bg).toBe('#FCFBFB');
  });

  test('toggle is right-aligned within the app width', async ({ page }) => {
    await loadPage(page);
    const toggle = page.locator('#theme-toggle');
    const app = page.locator('#app');

    const toggleBox = await toggle.boundingBox();
    const appBox = await app.boundingBox();

    // toggle right edge should be near the app right edge (within padding)
    const toggleRight = toggleBox.x + toggleBox.width;
    const appRight = appBox.x + appBox.width;
    expect(toggleRight).toBeLessThanOrEqual(appRight + 1);
    expect(toggleRight).toBeGreaterThan(appRight - 50);
  });

  test('toggle is positioned 10px from window top', async ({ page }) => {
    await loadPage(page);
    const toggle = page.locator('#theme-toggle');

    const toggleBox = await toggle.boundingBox();
    expect(toggleBox.y).toBeGreaterThanOrEqual(9);
    expect(toggleBox.y).toBeLessThanOrEqual(15);
  });
});
