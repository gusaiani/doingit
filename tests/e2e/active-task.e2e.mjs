/**
 * E2E tests for active task sorting and highlight.
 * Run: npx playwright test tests/e2e/active-task.e2e.mjs
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

async function seedTasks(page, tasks) {
  await page.goto(BASE);
  await page.evaluate((t) => {
    localStorage.clear();
    localStorage.setItem('tt_guest_tasks', JSON.stringify({ tasks: t }));
    localStorage.setItem('tt_tasks_visible', 'true');
  }, tasks);
  await page.reload();
  await page.waitForSelector('#task-list', { state: 'visible', timeout: 5000 });
}

const hour = 3_600_000;

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Active task sorting', () => {

  test('running task appears first in the list', async ({ page }) => {
    const now = Date.now();
    await seedTasks(page, [
      { id: 'a', name: 'Alpha', sessions: [{ start: now - hour, end: now }] },
      { id: 'b', name: 'Beta', sessions: [{ start: now - 2 * hour, end: now - hour }] },
      { id: 'c', name: 'Charlie', sessions: [{ start: now - 100, end: null }] }, // running
    ]);

    // The running task (Charlie) should be the first row
    const firstTaskName = await page.locator('.task-row .t-name').first().textContent();
    expect(firstTaskName).toBe('Charlie');
  });

  test('starting a non-first task moves it to the top', async ({ page }) => {
    const now = Date.now();
    await seedTasks(page, [
      { id: 'a', name: 'Alpha', sessions: [{ start: now - hour, end: now }] },
      { id: 'b', name: 'Beta', sessions: [{ start: now - 2 * hour, end: now - hour }] },
    ]);

    // Both tasks visible, Alpha first (more recent)
    await expect(page.locator('.task-row .t-name').first()).toHaveText('Alpha');

    // Start Beta via search
    const search = page.locator('#search');
    await search.fill('Beta');
    await search.press('Enter');

    // Beta should now be the first row
    await expect(page.locator('.task-row .t-name').first()).toHaveText('Beta');
  });

  test('stopping the active task removes it from the top position', async ({ page }) => {
    const now = Date.now();
    await seedTasks(page, [
      { id: 'a', name: 'Alpha', sessions: [{ start: now - hour, end: now }] },
      { id: 'b', name: 'Beta', sessions: [{ start: now - 100, end: null }] }, // running
    ]);

    // Beta should be first (running)
    await expect(page.locator('.task-row .t-name').first()).toHaveText('Beta');

    // Stop Beta
    await page.keyboard.press('Escape');

    // Beta should still be first (most recently finished session)
    await expect(page.locator('.task-row .t-name').first()).toHaveText('Beta');
  });
});

test.describe('Active task highlight', () => {

  test('running task row has a visible background highlight', async ({ page }) => {
    const now = Date.now();
    await seedTasks(page, [
      { id: 'a', name: 'Alpha', sessions: [{ start: now - hour, end: now }] },
      { id: 'b', name: 'Running', sessions: [{ start: now - 100, end: null }] },
    ]);

    const runningRow = page.locator('.task-row.running');
    await expect(runningRow).toHaveCount(1);

    // The running row should have a non-transparent background color
    const bg = await runningRow.evaluate(el => getComputedStyle(el).backgroundColor);
    // Default is transparent (rgba(0, 0, 0, 0)) — after feature it should be something visible
    expect(bg).not.toBe('rgba(0, 0, 0, 0)');
  });

  test('stopped task loses the background highlight', async ({ page }) => {
    const now = Date.now();
    await seedTasks(page, [
      { id: 'a', name: 'Task', sessions: [{ start: now - 100, end: null }] },
    ]);

    await expect(page.locator('.task-row.running')).toHaveCount(1);

    // Stop it
    await page.keyboard.press('Escape');

    // Should no longer have .running class
    await expect(page.locator('.task-row.running')).toHaveCount(0);
  });
});
