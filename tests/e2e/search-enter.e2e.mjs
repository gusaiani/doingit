/**
 * E2E tests for search Enter behaviour: exact match vs new task creation.
 * Run: npx playwright test tests/e2e/search-enter.e2e.mjs
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
const hour = 3_600_000;
function todayAt(hoursAgo) { return Date.now() - hoursAgo * hour; }
function sess(start, dur = hour) { return { start, end: start + dur }; }

async function seed(page, tasks) {
  await page.goto(BASE);
  await page.evaluate((tasks) => {
    localStorage.removeItem('tt_token');
    localStorage.setItem('tt_guest_tasks', JSON.stringify({ tasks }));
    localStorage.setItem('tt_tasks_visible', 'true');
  }, tasks);
  await page.reload();
  await page.waitForSelector('#task-list', { state: 'visible', timeout: 5000 });
}

function getTaskNames(page) {
  return page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('tt_guest_tasks'));
    return d.tasks.map(t => t.name);
  });
}

function getRunningTaskName(page) {
  return page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('tt_guest_tasks'));
    const t = d.tasks.find(t => t.sessions.some(s => !s.end));
    return t?.name ?? null;
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────
test.describe('Search Enter behaviour', () => {

  test('Substring creates new task instead of starting existing one', async ({ page }) => {
    await seed(page, [
      { id: 'A', name: 'Interview Prep', sessions: [sess(todayAt(3))] },
    ]);

    await page.locator('#search').focus();
    await page.keyboard.type('Interview');
    await page.keyboard.press('Enter');

    const names = await getTaskNames(page);
    expect(names).toContain('Interview');
    expect(names).toContain('Interview Prep');

    const running = await getRunningTaskName(page);
    expect(running).toBe('Interview');
  });

  test('Exact match (case-insensitive) starts existing task', async ({ page }) => {
    await seed(page, [
      { id: 'A', name: 'Interview Prep', sessions: [sess(todayAt(3))] },
    ]);

    await page.locator('#search').focus();
    await page.keyboard.type('interview prep');
    await page.keyboard.press('Enter');

    // Should NOT create a new task
    const names = await getTaskNames(page);
    expect(names.filter(n => n.toLowerCase() === 'interview prep')).toHaveLength(1);

    const running = await getRunningTaskName(page);
    expect(running).toBe('Interview Prep');
  });

  test('Arrow-down to select partial match then Enter starts existing task', async ({ page }) => {
    await seed(page, [
      { id: 'A', name: 'Interview Prep', sessions: [sess(todayAt(3))] },
    ]);

    await page.locator('#search').focus();
    await page.keyboard.type('Interview');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');

    // Should start existing, not create new
    const names = await getTaskNames(page);
    expect(names).not.toContain('Interview');

    const running = await getRunningTaskName(page);
    expect(running).toBe('Interview Prep');
  });

  test('Brand new name with no matches creates task', async ({ page }) => {
    await seed(page, [
      { id: 'A', name: 'Interview Prep', sessions: [sess(todayAt(3))] },
    ]);

    await page.locator('#search').focus();
    await page.keyboard.type('Design Review');
    await page.keyboard.press('Enter');

    const names = await getTaskNames(page);
    expect(names).toContain('Design Review');

    const running = await getRunningTaskName(page);
    expect(running).toBe('Design Review');
  });
});
