/**
 * E2E tests for task creation, deletion, and session start/stop.
 * Run: npx playwright test tests/e2e/task-crud.e2e.mjs
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

async function loadFresh(page) {
  await page.goto(BASE);
  await page.evaluate(() => {
    localStorage.clear();
  });
  await page.reload();
  await page.waitForSelector('#search', { state: 'visible', timeout: 5000 });
}

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

test.describe('Task creation', () => {

  test('typing a name and pressing Enter creates a task and starts a session', async ({ page }) => {
    await loadFresh(page);
    const search = page.locator('#search');
    await search.fill('My New Task');
    await search.press('Enter');

    // Task should appear in the list
    await expect(page.locator('.t-name').first()).toHaveText('My New Task');

    // Should be running (green dot visible)
    await expect(page.locator('.task-row.running')).toHaveCount(1);
  });

  test('search hint shows "↵ new" when typing a name that does not match existing tasks', async ({ page }) => {
    await loadFresh(page);
    const search = page.locator('#search');
    await search.fill('Brand New');

    await expect(page.locator('#search-create-hint')).toBeVisible();
  });

  test('creating a second task stops the first', async ({ page }) => {
    await loadFresh(page);
    const search = page.locator('#search');

    await search.fill('Task A');
    await search.press('Enter');
    await expect(page.locator('.task-row.running')).toHaveCount(1);

    await search.fill('Task B');
    await search.press('Enter');

    // Only one task should be running
    await expect(page.locator('.task-row.running')).toHaveCount(1);
    // The running task should be Task B
    await expect(page.locator('.task-row.running .t-name')).toHaveText('Task B');
  });

  test('entering an existing task name starts it instead of creating a duplicate', async ({ page }) => {
    const now = Date.now();
    await seedTasks(page, [
      { id: 'a', name: 'Existing Task', sessions: [{ start: now - hour, end: now }] },
    ]);

    const search = page.locator('#search');
    await search.fill('Existing Task');
    await search.press('Enter');

    // Should still be just one task
    await expect(page.locator('.task-row')).toHaveCount(1);
    // It should be running
    await expect(page.locator('.task-row.running')).toHaveCount(1);
  });
});

test.describe('Session start/stop', () => {

  test('pressing Escape stops a running task', async ({ page }) => {
    await loadFresh(page);
    const search = page.locator('#search');
    await search.fill('Running Task');
    await search.press('Enter');

    await expect(page.locator('.task-row.running')).toHaveCount(1);

    await page.keyboard.press('Escape');
    await expect(page.locator('.task-row.running')).toHaveCount(0);
  });

  test('clicking the pause button on a running task stops it', async ({ page }) => {
    await loadFresh(page);
    const search = page.locator('#search');
    await search.fill('Toggle Task');
    await search.press('Enter');

    await expect(page.locator('.task-row.running')).toHaveCount(1);

    // Hover to reveal the play/pause button and click it
    await page.locator('.task-row').first().hover();
    await page.locator('.t-play').first().click();
    await expect(page.locator('.task-row.running')).toHaveCount(0);
  });

  test('task data persists in localStorage for guests', async ({ page }) => {
    await loadFresh(page);
    const search = page.locator('#search');
    await search.fill('Persistent Task');
    await search.press('Enter');

    // Check localStorage has the task
    const stored = await page.evaluate(() => {
      const raw = localStorage.getItem('tt_guest_tasks');
      return raw ? JSON.parse(raw) : null;
    });
    expect(stored).not.toBeNull();
    expect(stored.tasks.length).toBe(1);
    expect(stored.tasks[0].name).toBe('Persistent Task');
  });

  test('tasks survive page reload', async ({ page }) => {
    await loadFresh(page);
    const search = page.locator('#search');
    await search.fill('Reload Task');
    await search.press('Enter');

    // Stop the task first
    await page.keyboard.press('Escape');

    await page.reload();
    await page.waitForSelector('#task-list', { state: 'visible', timeout: 5000 });

    await expect(page.locator('.t-name').first()).toHaveText('Reload Task');
  });
});

test.describe('Task deletion', () => {

  test('delete button removes task after confirm', async ({ page }) => {
    const now = Date.now();
    await seedTasks(page, [
      { id: 'del1', name: 'Delete Me', sessions: [{ start: now - hour, end: now }] },
    ]);

    page.on('dialog', dialog => dialog.accept());

    // Hover over task row to reveal delete button
    await page.locator('.task-row').first().hover();
    await page.locator('.t-del').first().click();

    await expect(page.locator('.task-row')).toHaveCount(0);
  });

  test('cancelling delete keeps the task', async ({ page }) => {
    const now = Date.now();
    await seedTasks(page, [
      { id: 'keep1', name: 'Keep Me', sessions: [{ start: now - hour, end: now }] },
    ]);

    page.on('dialog', dialog => dialog.dismiss());

    await page.locator('.task-row').first().hover();
    await page.locator('.t-del').first().click();

    await expect(page.locator('.task-row')).toHaveCount(1);
    await expect(page.locator('.t-name').first()).toHaveText('Keep Me');
  });
});

test.describe('Search filtering', () => {

  test('typing in search filters tasks', async ({ page }) => {
    const now = Date.now();
    await seedTasks(page, [
      { id: 'a', name: 'Alpha', sessions: [{ start: now - hour, end: now }] },
      { id: 'b', name: 'Beta', sessions: [{ start: now - 2 * hour, end: now - hour }] },
    ]);

    const search = page.locator('#search');
    await search.fill('Alpha');

    await expect(page.locator('.task-row')).toHaveCount(1);
    await expect(page.locator('.t-name').first()).toHaveText('Alpha');
  });

  test('clearing search shows all tasks', async ({ page }) => {
    const now = Date.now();
    await seedTasks(page, [
      { id: 'a', name: 'Alpha', sessions: [{ start: now - hour, end: now }] },
      { id: 'b', name: 'Beta', sessions: [{ start: now - 2 * hour, end: now - hour }] },
    ]);

    const search = page.locator('#search');
    await search.fill('Alpha');
    await expect(page.locator('.task-row')).toHaveCount(1);

    await search.fill('');
    await expect(page.locator('.task-row')).toHaveCount(2);
  });
});
