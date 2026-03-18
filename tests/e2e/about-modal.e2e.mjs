/**
 * E2E tests for the About modal.
 * Run: npx playwright test tests/e2e/about-modal.e2e.mjs
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

async function loadPage(page) {
  await page.goto(BASE);
  await page.evaluate(() => {
    localStorage.clear();
    // Set about_seen so the modal doesn't auto-open
    localStorage.setItem('tt_about_seen', 'true');
  });
  await page.reload();
  await page.waitForSelector('.header', { state: 'visible', timeout: 5000 });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('About modal', () => {

  test('about button opens the modal', async ({ page }) => {
    await loadPage(page);
    await expect(page.locator('#about-modal')).not.toBeVisible();

    await page.locator('#header-about').click();
    await expect(page.locator('#about-modal')).toBeVisible();
  });

  test('close button dismisses the modal', async ({ page }) => {
    await loadPage(page);
    await page.locator('#header-about').click();
    await expect(page.locator('#about-modal')).toBeVisible();

    await page.locator('#about-close').click();
    await expect(page.locator('#about-modal')).not.toBeVisible();
  });

  test('clicking backdrop dismisses the modal', async ({ page }) => {
    await loadPage(page);
    await page.locator('#header-about').click();
    await expect(page.locator('#about-modal')).toBeVisible();

    // Click at the edge of the backdrop, outside the about-box
    await page.locator('#about-backdrop').click({ position: { x: 10, y: 10 } });
    await expect(page.locator('#about-modal')).not.toBeVisible();
  });

  test('modal contains app name and tagline', async ({ page }) => {
    await loadPage(page);
    await page.locator('#header-about').click();

    await expect(page.locator('.about-logo')).toHaveText('Doing It');
    await expect(page.locator('.about-tagline')).toContainText('to-do to done');
  });

  test('Escape key closes the modal', async ({ page }) => {
    await loadPage(page);
    await page.locator('#header-about').click();
    await expect(page.locator('#about-modal')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator('#about-modal')).not.toBeVisible();
  });
});
