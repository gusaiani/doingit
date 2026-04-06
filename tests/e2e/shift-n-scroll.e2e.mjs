/**
 * E2E test: Shift+N scrolls later input into visible viewport area.
 * Run: npx playwright test tests/e2e/shift-n-scroll.e2e.mjs
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

test('Shift+N scrolls later input into visible viewport', async ({ page }) => {
  // Create enough tasks to push the later section below the fold
  const tasks = Array.from({ length: 20 }, (_, i) => ({
    id: crypto.randomUUID(),
    name: `Task ${i + 1}`,
    sessions: [{ start: Date.now() - 3600000 + i * 1000, end: Date.now() - 3600000 + i * 1000 + 60000 }],
    projectId: null,
  }));

  await page.goto(BASE);
  await page.evaluate((t) => {
    localStorage.clear();
    localStorage.setItem('tt_guest_tasks', JSON.stringify({ tasks: t, later: [], projects: [] }));
    localStorage.setItem('tt_later_visible', 'false');
  }, tasks);
  await page.reload();
  await page.waitForSelector('#task-list', { state: 'visible', timeout: 5000 });

  // Press Shift+N to focus the later input
  await page.keyboard.press('Shift+N');

  // Wait for scrolling to settle
  await page.waitForTimeout(600);

  // Verify the later input is within the viewport
  const box = await page.locator('#later-input').boundingBox();
  const viewport = page.viewportSize();

  expect(box).not.toBeNull();
  // Input top should be above the bottom of the viewport with some margin
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  // Input should not be above the viewport
  expect(box.y).toBeGreaterThanOrEqual(0);
});
