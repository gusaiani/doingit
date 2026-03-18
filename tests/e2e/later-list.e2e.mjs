/**
 * E2E tests for the Later list: add, promote, delete, toggle.
 * Run: npx playwright test tests/e2e/later-list.e2e.mjs
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

async function loadWithLater(page, laterItems) {
  await page.goto(BASE);
  await page.evaluate((items) => {
    localStorage.clear();
    localStorage.setItem('tt_guest_tasks', JSON.stringify({ tasks: [], later: items }));
    localStorage.setItem('tt_later_visible', 'true');
  }, laterItems);
  await page.reload();
  await page.waitForSelector('#later', { state: 'visible', timeout: 5000 });
}

async function loadFresh(page) {
  await page.goto(BASE);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('tt_later_visible', 'true');
  });
  await page.reload();
  await page.waitForSelector('#later', { state: 'visible', timeout: 5000 });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Later list', () => {

  test('adding an item via input and Enter', async ({ page }) => {
    await loadFresh(page);
    const input = page.locator('#later-input');
    await input.fill('Buy groceries');
    await input.press('Enter');

    await expect(page.locator('.later-text').first()).toHaveText('Buy groceries');
  });

  test('input clears after adding an item', async ({ page }) => {
    await loadFresh(page);
    const input = page.locator('#later-input');
    await input.fill('Something');
    await input.press('Enter');

    await expect(input).toHaveValue('');
  });

  test('later items persist across reload', async ({ page }) => {
    await loadFresh(page);
    const input = page.locator('#later-input');
    await input.fill('Persistent item');
    await input.press('Enter');

    await page.reload();
    await page.waitForSelector('#later', { state: 'visible', timeout: 5000 });

    await expect(page.locator('.later-text').first()).toHaveText('Persistent item');
  });

  test('deleting a later item', async ({ page }) => {
    await loadWithLater(page, [
      { id: 'l1', text: 'Delete me' },
    ]);

    await page.locator('.later-item').first().hover();
    await page.locator('.later-del').first().click();

    await expect(page.locator('.later-item')).toHaveCount(0);
  });

  test('promoting a later item creates a task and starts it', async ({ page }) => {
    await loadWithLater(page, [
      { id: 'l1', text: 'Promote me' },
    ]);

    await page.locator('.later-item').first().hover();
    await page.locator('.later-promote').first().click();

    // Later item should be gone
    await expect(page.locator('.later-item')).toHaveCount(0);

    // A task should be created and running
    await expect(page.locator('.t-name').first()).toHaveText('Promote me');
    await expect(page.locator('.task-row.running')).toHaveCount(1);
  });

  test('collapsing and expanding later section via header click', async ({ page }) => {
    await loadWithLater(page, [
      { id: 'l1', text: 'Item A' },
    ]);

    // Items should be visible
    await expect(page.locator('.later-item').first()).toBeVisible();

    // Click the header to collapse — items become hidden (ul display:none)
    await page.locator('#later-header').click({ force: true });
    await expect(page.locator('#later-list')).not.toBeVisible();

    // Click header to expand
    await page.locator('#later-header').click({ force: true });
    await expect(page.locator('.later-item').first()).toBeVisible();
  });

  test('later collapse state persists across reload', async ({ page }) => {
    await loadWithLater(page, [
      { id: 'l1', text: 'Item A' },
    ]);

    // Collapse
    await page.locator('#later-header').click({ force: true });
    await expect(page.locator('#later-list')).not.toBeVisible();

    await page.reload();
    await page.waitForSelector('#later', { state: 'visible', timeout: 5000 });

    // Should still be collapsed
    await expect(page.locator('#later-list')).not.toBeVisible();
  });

  test('newest later items appear first', async ({ page }) => {
    await loadFresh(page);
    const input = page.locator('#later-input');

    await input.fill('First');
    await input.press('Enter');
    await input.fill('Second');
    await input.press('Enter');

    const texts = await page.locator('.later-text').allTextContents();
    expect(texts[0]).toBe('Second');
    expect(texts[1]).toBe('First');
  });
});
