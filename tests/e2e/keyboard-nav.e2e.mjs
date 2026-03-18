/**
 * E2E tests for keyboard navigation mode.
 * Run: npx playwright test tests/e2e/keyboard-nav.e2e.mjs
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
const day  = 24 * hour;

// Fix time to Wednesday so weekPastDays() always has Mon+Tue available.
const FIXED_NOW = new Date('2026-03-18T14:00:00').getTime();

function todayAt(hoursAgo) { return FIXED_NOW - hoursAgo * hour; }
function sess(start, dur = hour) { return { start, end: start + dur }; }

/** Session that started N days before FIXED_NOW (always in the past). */
function pastSess(daysAgo = 1) {
  const start = FIXED_NOW - daysAgo * day;
  return { start, end: start + hour };
}

async function seed(page, tasks, opts = {}) {
  await page.clock.install({ time: FIXED_NOW });
  await page.goto(BASE);
  await page.evaluate(({ tasks, opts }) => {
    localStorage.removeItem('tt_token');
    const store = { tasks };
    if (opts.later) store.later = opts.later;
    localStorage.setItem('tt_guest_tasks', JSON.stringify(store));
    localStorage.setItem('tt_tasks_visible', String(opts.tasksVisible ?? true));
    if (opts.weekVisible !== undefined) {
      localStorage.setItem('tt_week_visible', String(opts.weekVisible));
    } else {
      localStorage.removeItem('tt_week_visible');
    }
    if (opts.laterVisible !== undefined) {
      localStorage.setItem('tt_later_visible', String(opts.laterVisible));
    } else {
      localStorage.removeItem('tt_later_visible');
    }
  }, { tasks, opts });
  await page.reload();
  await page.waitForSelector('#total-row', { state: 'visible', timeout: 5000 });
}

/** Ensure no input is focused before starting keyboard nav */
async function blurAll(page) {
  await page.evaluate(() => document.activeElement?.blur());
}

// ── Enter / exit nav mode ─────────────────────────────────────────────────────
test.describe('Keyboard navigation', () => {

  test('j from bare screen highlights TODAY row', async ({ page }) => {
    await seed(page, [
      { id: 'A', name: 'Alpha', sessions: [sess(todayAt(2))] },
    ]);
    await blurAll(page);

    await page.keyboard.press('j');

    await expect(page.locator('#total-row')).toHaveClass(/nav-highlight/);
  });

  test('ArrowDown from bare screen highlights TODAY row', async ({ page }) => {
    await seed(page, [
      { id: 'A', name: 'Alpha', sessions: [sess(todayAt(2))] },
    ]);
    await blurAll(page);

    await page.keyboard.press('ArrowDown');

    await expect(page.locator('#total-row')).toHaveClass(/nav-highlight/);
  });

  test('Escape exits nav mode and removes highlight', async ({ page }) => {
    await seed(page, [
      { id: 'A', name: 'Alpha', sessions: [sess(todayAt(2))] },
    ]);
    await blurAll(page);

    await page.keyboard.press('j');
    await expect(page.locator('#total-row')).toHaveClass(/nav-highlight/);

    await page.keyboard.press('Escape');
    await expect(page.locator('#total-row')).not.toHaveClass(/nav-highlight/);
  });

  test('Mouse click exits nav mode', async ({ page }) => {
    await seed(page, [
      { id: 'A', name: 'Alpha', sessions: [sess(todayAt(2))] },
    ]);
    await blurAll(page);

    await page.keyboard.press('j');
    await expect(page.locator('#total-row')).toHaveClass(/nav-highlight/);

    await page.mouse.click(10, 10);
    // rAF clears the highlight
    await expect(page.locator('#total-row')).not.toHaveClass(/nav-highlight/);
  });

  // ── Tab from empty search ───────────────────────────────────────────────────
  test('Tab from empty search enters nav mode', async ({ page }) => {
    await seed(page, [
      { id: 'A', name: 'Alpha', sessions: [sess(todayAt(2))] },
    ]);

    // Focus search (empty)
    await page.locator('#search').focus();
    await page.keyboard.press('Tab');

    // Should highlight TODAY row and search should be blurred
    await expect(page.locator('#total-row')).toHaveClass(/nav-highlight/);
    const focused = await page.evaluate(() => document.activeElement?.id);
    expect(focused).not.toBe('search');
  });

  test('Tab from search with text still toggles expand (existing behaviour)', async ({ page }) => {
    await seed(page, [
      { id: 'A', name: 'Alpha', sessions: [sess(todayAt(2))] },
    ]);

    await page.locator('#search').focus();
    await page.keyboard.type('Alpha');
    // Select first result
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Tab');

    // Session log should be expanded
    await expect(page.locator('.session-log.open')).toBeVisible();
    // Should NOT be in nav mode (no nav-highlight on total row)
    await expect(page.locator('#total-row')).not.toHaveClass(/nav-highlight/);
  });

  // ── j/k navigation through items ───────────────────────────────────────────
  test('j/k navigate through today tasks', async ({ page }) => {
    await seed(page, [
      { id: 'A', name: 'Alpha', sessions: [sess(todayAt(3))] },
      { id: 'B', name: 'Bravo', sessions: [sess(todayAt(1))] },
    ]);
    await blurAll(page);

    // j → TODAY row
    await page.keyboard.press('j');
    await expect(page.locator('#total-row')).toHaveClass(/nav-highlight/);

    // j → first task (Alpha)
    await page.keyboard.press('j');
    await expect(page.locator('#total-row')).not.toHaveClass(/nav-highlight/);
    const alphaRow = page.locator('.task-row', { has: page.locator('.t-name:text-is("Alpha")') });
    await expect(alphaRow).toHaveClass(/selected/);

    // j → second task (Bravo)
    await page.keyboard.press('j');
    await expect(alphaRow).not.toHaveClass(/selected/);
    const bravoRow = page.locator('.task-row', { has: page.locator('.t-name:text-is("Bravo")') });
    await expect(bravoRow).toHaveClass(/selected/);

    // k → back to Alpha
    await page.keyboard.press('k');
    await expect(alphaRow).toHaveClass(/selected/);
    await expect(bravoRow).not.toHaveClass(/selected/);

    // k → back to TODAY
    await page.keyboard.press('k');
    await expect(page.locator('#total-row')).toHaveClass(/nav-highlight/);
  });

  test('k at top stays on first item', async ({ page }) => {
    await seed(page, [
      { id: 'A', name: 'Alpha', sessions: [sess(todayAt(1))] },
    ]);
    await blurAll(page);

    await page.keyboard.press('j');
    await page.keyboard.press('k');  // already at top, should stay
    await expect(page.locator('#total-row')).toHaveClass(/nav-highlight/);
  });

  test('j at bottom stays on last item', async ({ page }) => {
    await seed(page, [
      { id: 'A', name: 'Alpha', sessions: [sess(todayAt(1))] },
    ], { weekVisible: false });
    await blurAll(page);

    // Navigate to last item: TODAY → Alpha → (no week since weekVisible=false and no past sessions)
    await page.keyboard.press('j'); // TODAY
    await page.keyboard.press('j'); // Alpha
    await page.keyboard.press('j'); // should stay on Alpha
    const alphaRow = page.locator('.task-row', { has: page.locator('.t-name:text-is("Alpha")') });
    await expect(alphaRow).toHaveClass(/selected/);
  });

  // ── ArrowDown/ArrowUp work the same as j/k ─────────────────────────────────
  test('ArrowDown/ArrowUp navigate like j/k', async ({ page }) => {
    await seed(page, [
      { id: 'A', name: 'Alpha', sessions: [sess(todayAt(2))] },
    ]);
    await blurAll(page);

    await page.keyboard.press('ArrowDown');
    await expect(page.locator('#total-row')).toHaveClass(/nav-highlight/);

    await page.keyboard.press('ArrowDown');
    const alphaRow = page.locator('.task-row', { has: page.locator('.t-name:text-is("Alpha")') });
    await expect(alphaRow).toHaveClass(/selected/);

    await page.keyboard.press('ArrowUp');
    await expect(page.locator('#total-row')).toHaveClass(/nav-highlight/);
  });

  // ── Space toggles expand/collapse ───────────────────────────────────────────
  test('Space on TODAY row toggles task list visibility', async ({ page }) => {
    await seed(page, [
      { id: 'A', name: 'Alpha', sessions: [sess(todayAt(1))] },
    ]);
    await blurAll(page);

    await page.keyboard.press('j'); // highlight TODAY
    await expect(page.locator('#task-list')).toBeVisible();

    await page.keyboard.press(' '); // collapse
    await expect(page.locator('#task-list')).toBeHidden();

    await page.keyboard.press(' '); // expand
    await expect(page.locator('#task-list')).toBeVisible();
  });

  test('Space on task row toggles session log', async ({ page }) => {
    await seed(page, [
      { id: 'A', name: 'Alpha', sessions: [sess(todayAt(2)), sess(todayAt(1))] },
    ]);
    await blurAll(page);

    // Navigate to Alpha
    await page.keyboard.press('j'); // TODAY
    await page.keyboard.press('j'); // Alpha

    await page.keyboard.press(' '); // expand
    await expect(page.locator('.session-log.open')).toBeVisible();

    await page.keyboard.press(' '); // collapse
    await expect(page.locator('.session-log.open')).toHaveCount(0);
  });

  // ── Arrow right/left expand/collapse ────────────────────────────────────────
  test('ArrowRight expands, ArrowLeft collapses TODAY tasks', async ({ page }) => {
    await seed(page, [
      { id: 'A', name: 'Alpha', sessions: [sess(todayAt(1))] },
    ], { tasksVisible: false });
    await blurAll(page);

    await page.keyboard.press('j'); // TODAY (tasks hidden)
    await expect(page.locator('#task-list')).toBeHidden();

    await page.keyboard.press('ArrowRight'); // expand
    await expect(page.locator('#task-list')).toBeVisible();

    await page.keyboard.press('ArrowLeft'); // collapse
    await expect(page.locator('#task-list')).toBeHidden();
  });

  test('ArrowRight expands task sessions, ArrowLeft collapses', async ({ page }) => {
    await seed(page, [
      { id: 'A', name: 'Alpha', sessions: [sess(todayAt(2)), sess(todayAt(1))] },
    ]);
    await blurAll(page);

    await page.keyboard.press('j'); // TODAY
    await page.keyboard.press('j'); // Alpha

    await page.keyboard.press('ArrowRight'); // expand sessions
    await expect(page.locator('.session-log.open')).toBeVisible();

    await page.keyboard.press('ArrowLeft'); // collapse sessions
    await expect(page.locator('.session-log.open')).toHaveCount(0);
  });

  // ── Enter starts session on task ────────────────────────────────────────────
  test('Enter on task row starts a session', async ({ page }) => {
    await seed(page, [
      { id: 'A', name: 'Alpha', sessions: [sess(todayAt(2))] },
    ]);
    await blurAll(page);

    await page.keyboard.press('j'); // TODAY
    await page.keyboard.press('j'); // Alpha

    await page.keyboard.press('Enter');

    // Task should now be running (has a live session)
    const running = await page.evaluate(() => {
      const d = JSON.parse(localStorage.getItem('tt_guest_tasks'));
      return d.tasks[0].sessions.some(s => !s.end);
    });
    expect(running).toBe(true);

    // Running indicator should be visible
    await expect(page.locator('.task-row.running')).toBeVisible();
  });

  test('Enter on TODAY row toggles task list (like Space)', async ({ page }) => {
    await seed(page, [
      { id: 'A', name: 'Alpha', sessions: [sess(todayAt(1))] },
    ]);
    await blurAll(page);

    await page.keyboard.press('j'); // TODAY
    await expect(page.locator('#task-list')).toBeVisible();

    await page.keyboard.press('Enter'); // collapse
    await expect(page.locator('#task-list')).toBeHidden();
  });

  // ── n and / from nav mode focus search ──────────────────────────────────────
  test('n from nav mode exits nav and focuses search', async ({ page }) => {
    await seed(page, [
      { id: 'A', name: 'Alpha', sessions: [sess(todayAt(1))] },
    ]);
    await blurAll(page);

    await page.keyboard.press('j');
    await expect(page.locator('#total-row')).toHaveClass(/nav-highlight/);

    await page.keyboard.press('n');
    await expect(page.locator('#total-row')).not.toHaveClass(/nav-highlight/);
    const focused = await page.evaluate(() => document.activeElement?.id);
    expect(focused).toBe('search');
  });

  test('/ from nav mode exits nav and focuses search', async ({ page }) => {
    await seed(page, [
      { id: 'A', name: 'Alpha', sessions: [sess(todayAt(1))] },
    ]);
    await blurAll(page);

    await page.keyboard.press('j');
    await page.keyboard.press('/');

    await expect(page.locator('#total-row')).not.toHaveClass(/nav-highlight/);
    const focused = await page.evaluate(() => document.activeElement?.id);
    expect(focused).toBe('search');
  });

  test('/ from bare screen focuses search', async ({ page }) => {
    await seed(page, [
      { id: 'A', name: 'Alpha', sessions: [sess(todayAt(1))] },
    ]);
    await blurAll(page);

    await page.keyboard.press('/');
    const focused = await page.evaluate(() => document.activeElement?.id);
    expect(focused).toBe('search');
  });

  // ── c continues last task ────────────────────────────────────────────────
  test('c from bare screen resumes the most recently stopped task', async ({ page }) => {
    await seed(page, [
      { id: 'A', name: 'Alpha', sessions: [sess(todayAt(3), hour)] },
      { id: 'B', name: 'Bravo', sessions: [sess(todayAt(1), hour)] },
    ]);
    await blurAll(page);

    // No task running — c should start the most recently ended task (Bravo)
    await page.keyboard.press('c');

    const running = await page.evaluate(() => {
      const d = JSON.parse(localStorage.getItem('tt_guest_tasks'));
      const t = d.tasks.find(t => t.sessions.some(s => !s.end));
      return t?.name;
    });
    expect(running).toBe('Bravo');
  });

  test('c does nothing when a task is already running', async ({ page }) => {
    await seed(page, [
      { id: 'A', name: 'Alpha', sessions: [{ start: todayAt(1), end: null }] },
      { id: 'B', name: 'Bravo', sessions: [sess(todayAt(3), hour)] },
    ]);
    await blurAll(page);

    // Alpha is already running — c should not change anything
    await page.keyboard.press('c');

    const running = await page.evaluate(() => {
      const d = JSON.parse(localStorage.getItem('tt_guest_tasks'));
      return d.tasks.filter(t => t.sessions.some(s => !s.end)).map(t => t.name);
    });
    expect(running).toEqual(['Alpha']);
  });

  // ── Shift+N focuses later input ────────────────────────────────────────────
  test('Shift+N from bare screen focuses later input', async ({ page }) => {
    await seed(page, [
      { id: 'A', name: 'Alpha', sessions: [sess(todayAt(1))] },
    ], {
      later: [{ id: 'L1', text: 'Buy milk' }],
    });
    await blurAll(page);

    await page.keyboard.press('Shift+N');
    const focused = await page.evaluate(() => document.activeElement?.id);
    expect(focused).toBe('later-input');
  });

  test('Shift+N from nav mode exits nav and focuses later input', async ({ page }) => {
    await seed(page, [
      { id: 'A', name: 'Alpha', sessions: [sess(todayAt(1))] },
    ], {
      later: [{ id: 'L1', text: 'Buy milk' }],
    });
    await blurAll(page);

    await page.keyboard.press('j');
    await expect(page.locator('#total-row')).toHaveClass(/nav-highlight/);

    await page.keyboard.press('Shift+N');
    await expect(page.locator('#total-row')).not.toHaveClass(/nav-highlight/);
    const focused = await page.evaluate(() => document.activeElement?.id);
    expect(focused).toBe('later-input');
  });

  test('Shift+N expands later section if collapsed', async ({ page }) => {
    await seed(page, [
      { id: 'A', name: 'Alpha', sessions: [sess(todayAt(1))] },
    ], {
      later: [{ id: 'L1', text: 'Buy milk' }],
      laterVisible: false,
    });
    await blurAll(page);

    await expect(page.locator('#later-list')).toBeHidden();

    await page.keyboard.press('Shift+N');
    await expect(page.locator('#later-list')).toBeVisible();
    const focused = await page.evaluate(() => document.activeElement?.id);
    expect(focused).toBe('later-input');
  });

  // ── Week navigation ─────────────────────────────────────────────────────────
  test('Navigate to WEEK row and day rows', async ({ page }) => {
    await seed(page, [
      { id: 'A', name: 'Alpha', sessions: [sess(todayAt(1)), pastSess(1)] },
    ]);
    await blurAll(page);

    // j → TODAY
    await page.keyboard.press('j');
    // j → Alpha
    await page.keyboard.press('j');
    // j → WEEK
    await page.keyboard.press('j');
    await expect(page.locator('.week-total-row')).toHaveClass(/nav-highlight/);

    // j → day row
    await page.keyboard.press('j');
    await expect(page.locator('.day-row').first()).toHaveClass(/nav-highlight/);
  });

  test('Space on WEEK row toggles day rows', async ({ page }) => {
    await seed(page, [
      { id: 'A', name: 'Alpha', sessions: [sess(todayAt(1)), pastSess(1)] },
    ]);
    await blurAll(page);

    // Navigate to WEEK row
    await page.keyboard.press('j'); // TODAY
    await page.keyboard.press('j'); // Alpha
    await page.keyboard.press('j'); // WEEK

    // Day rows should be visible by default
    await expect(page.locator('.day-row').first()).toBeVisible();

    await page.keyboard.press(' '); // collapse week
    await expect(page.locator('.day-row')).toHaveCount(0);

    await page.keyboard.press(' '); // expand week
    await expect(page.locator('.day-row').first()).toBeVisible();
  });

  test('ArrowRight on day row expands tasks for that day', async ({ page }) => {
    await seed(page, [
      { id: 'A', name: 'Alpha', sessions: [sess(todayAt(1)), pastSess(1)] },
    ]);
    await blurAll(page);

    // Navigate to day row
    await page.keyboard.press('j'); // TODAY
    await page.keyboard.press('j'); // Alpha
    await page.keyboard.press('j'); // WEEK
    await page.keyboard.press('j'); // day row

    // Expand day
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.day-task-row').first()).toBeVisible();

    // Navigate down to day-task row
    await page.keyboard.press('j');
    await expect(page.locator('.day-task-row').first()).toHaveClass(/nav-highlight/);
  });

  test('Enter on day-task row starts session for that task', async ({ page }) => {
    await seed(page, [
      { id: 'A', name: 'Alpha', sessions: [pastSess(1)] },
    ]);
    await blurAll(page);

    // Alpha has no today sessions → shows as recent in today list, plus in week
    // Navigate: TODAY → Alpha (recent) → WEEK → day → expand → day-task
    await page.keyboard.press('j'); // TODAY
    await page.keyboard.press('j'); // Alpha (recent)
    await page.keyboard.press('j'); // WEEK
    await page.keyboard.press('j'); // day row
    await page.keyboard.press('ArrowRight'); // expand day tasks
    await page.keyboard.press('j'); // day-task row

    await page.keyboard.press('Enter'); // start session

    const running = await page.evaluate(() => {
      const d = JSON.parse(localStorage.getItem('tt_guest_tasks'));
      return d.tasks[0].sessions.some(s => !s.end);
    });
    expect(running).toBe(true);
  });

  // ── Hint row updates ───────────────────────────────────────────────────────
  test('Hint row shows nav shortcuts when in nav mode', async ({ page }) => {
    await seed(page, [
      { id: 'A', name: 'Alpha', sessions: [sess(todayAt(1))] },
    ]);
    await blurAll(page);

    const hintRow = page.locator('#search-hint');

    // Bare screen should show j/↓ navigate hint
    await expect(hintRow).toContainText('navigate');

    // Enter nav mode
    await page.keyboard.press('j');

    // Should show nav-specific hints
    await expect(hintRow).toContainText('navigate');
    await expect(hintRow).toContainText('toggle');
    await expect(hintRow).toContainText('expand');
    await expect(hintRow).toContainText('start');
    await expect(hintRow).toContainText('exit');
  });

  // ── Collapse hides children from nav ────────────────────────────────────────
  test('Collapsing TODAY skips tasks in nav order', async ({ page }) => {
    await seed(page, [
      { id: 'A', name: 'Alpha', sessions: [sess(todayAt(2)), pastSess(1)] },
    ]);
    await blurAll(page);

    // Navigate to TODAY, collapse it
    await page.keyboard.press('j'); // TODAY
    await page.keyboard.press('ArrowLeft'); // collapse tasks

    // Next j should go to WEEK, not Alpha (tasks hidden)
    await page.keyboard.press('j');
    await expect(page.locator('.week-total-row')).toHaveClass(/nav-highlight/);
  });

  test('Collapsing WEEK skips day rows in nav order', async ({ page }) => {
    await seed(page, [
      { id: 'A', name: 'Alpha', sessions: [sess(todayAt(1)), pastSess(1)] },
    ]);
    await blurAll(page);

    // Navigate to WEEK
    await page.keyboard.press('j'); // TODAY
    await page.keyboard.press('j'); // Alpha
    await page.keyboard.press('j'); // WEEK

    // Collapse week
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('.day-row')).toHaveCount(0);

    // j should stay on WEEK (no more items after it)
    await page.keyboard.press('j');
    await expect(page.locator('.week-total-row')).toHaveClass(/nav-highlight/);
  });

  // ── Fluid nav: today → week → later ──────────────────────────────────────
  test('Fluid nav flows from today tasks through week to later list', async ({ page }) => {
    await seed(page, [
      { id: 'A', name: 'Alpha', sessions: [sess(todayAt(1)), pastSess(1)] },
    ], {
      later: [{ id: 'L1', text: 'Buy milk' }, { id: 'L2', text: 'Read book' }],
    });
    await blurAll(page);

    await page.keyboard.press('j'); // TODAY
    await expect(page.locator('#total-row')).toHaveClass(/nav-highlight/);

    await page.keyboard.press('j'); // Alpha (task)
    const alphaRow = page.locator('.task-row', { has: page.locator('.t-name:text-is("Alpha")') });
    await expect(alphaRow).toHaveClass(/selected/);

    await page.keyboard.press('j'); // WEEK
    await expect(page.locator('.week-total-row')).toHaveClass(/nav-highlight/);

    // Navigate past day rows
    await page.keyboard.press('j'); // day row
    await expect(page.locator('.day-row').first()).toHaveClass(/nav-highlight/);

    await page.keyboard.press('j'); // LATER header
    await expect(page.locator('#later-header')).toHaveClass(/nav-highlight/);

    await page.keyboard.press('j'); // first later item (Read book = most recent)
    await expect(page.locator('.later-item').first()).toHaveClass(/nav-highlight/);

    await page.keyboard.press('j'); // second later item (Buy milk)
    await expect(page.locator('.later-item').nth(1)).toHaveClass(/nav-highlight/);

    // k goes back up
    await page.keyboard.press('k'); // back to first later item
    await expect(page.locator('.later-item').first()).toHaveClass(/nav-highlight/);

    await page.keyboard.press('k'); // LATER header
    await expect(page.locator('#later-header')).toHaveClass(/nav-highlight/);

    await page.keyboard.press('k'); // day row
    await expect(page.locator('.day-row').first()).toHaveClass(/nav-highlight/);
  });

  test('ArrowRight expands later list, ArrowLeft collapses', async ({ page }) => {
    await seed(page, [
      { id: 'A', name: 'Alpha', sessions: [sess(todayAt(1))] },
    ], {
      later: [{ id: 'L1', text: 'Buy milk' }],
      laterVisible: false,
    });
    await blurAll(page);

    // Navigate to LATER header
    await page.keyboard.press('j'); // TODAY
    await page.keyboard.press('j'); // Alpha
    await page.keyboard.press('j'); // LATER (no week since only today sessions)
    await expect(page.locator('#later-header')).toHaveClass(/nav-highlight/);

    // Later list should be collapsed
    await expect(page.locator('#later-list')).toBeHidden();

    // Expand
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#later-list')).toBeVisible();
    await expect(page.locator('.later-item')).toHaveCount(1);

    // Collapse
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('#later-list')).toBeHidden();
  });

  test('Space on later header toggles later list', async ({ page }) => {
    await seed(page, [
      { id: 'A', name: 'Alpha', sessions: [sess(todayAt(1))] },
    ], {
      later: [{ id: 'L1', text: 'Buy milk' }],
    });
    await blurAll(page);

    // Navigate to LATER header
    await page.keyboard.press('j'); // TODAY
    await page.keyboard.press('j'); // Alpha
    await page.keyboard.press('j'); // LATER
    await expect(page.locator('#later-header')).toHaveClass(/nav-highlight/);

    // Collapse
    await page.keyboard.press(' ');
    await expect(page.locator('#later-list')).toBeHidden();

    // Expand
    await page.keyboard.press(' ');
    await expect(page.locator('#later-list')).toBeVisible();
  });

  test('Collapsing later skips later items in nav order', async ({ page }) => {
    await seed(page, [
      { id: 'A', name: 'Alpha', sessions: [sess(todayAt(1))] },
    ], {
      later: [{ id: 'L1', text: 'Buy milk' }, { id: 'L2', text: 'Read book' }],
    });
    await blurAll(page);

    // Navigate to LATER header
    await page.keyboard.press('j'); // TODAY
    await page.keyboard.press('j'); // Alpha
    await page.keyboard.press('j'); // LATER

    // Collapse later
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('#later-list')).toBeHidden();

    // j should stay on LATER (no more items after it)
    await page.keyboard.press('j');
    await expect(page.locator('#later-header')).toHaveClass(/nav-highlight/);
  });

  test('Enter on later item promotes it to an active task', async ({ page }) => {
    await seed(page, [
      { id: 'A', name: 'Alpha', sessions: [sess(todayAt(1))] },
    ], {
      later: [{ id: 'L1', text: 'Buy milk' }],
    });
    await blurAll(page);

    // Navigate to later item
    await page.keyboard.press('j'); // TODAY
    await page.keyboard.press('j'); // Alpha
    await page.keyboard.press('j'); // LATER
    await page.keyboard.press('j'); // Buy milk

    await page.keyboard.press('Enter'); // promote to task

    // Buy milk should now be running as a task
    const running = await page.evaluate(() => {
      const d = JSON.parse(localStorage.getItem('tt_guest_tasks'));
      return d.tasks.some(t => t.name === 'Buy milk' && t.sessions.some(s => !s.end));
    });
    expect(running).toBe(true);

    // Later list should no longer contain it
    const laterCount = await page.evaluate(() => {
      const d = JSON.parse(localStorage.getItem('tt_guest_tasks'));
      return d.later.length;
    });
    expect(laterCount).toBe(0);
  });

  test('Later items render newest first', async ({ page }) => {
    await seed(page, [
      { id: 'A', name: 'Alpha', sessions: [sess(todayAt(1))] },
    ], {
      later: [
        { id: 'L1', text: 'First added' },
        { id: 'L2', text: 'Second added' },
        { id: 'L3', text: 'Third added' },
      ],
    });

    // Third added (newest) should be first in the DOM
    const firstText = await page.locator('.later-item').first().locator('.later-text').textContent();
    expect(firstText).toBe('Third added');

    const lastText = await page.locator('.later-item').last().locator('.later-text').textContent();
    expect(lastText).toBe('First added');
  });

  test('Later chevron is right-aligned in header row', async ({ page }) => {
    await seed(page, [
      { id: 'A', name: 'Alpha', sessions: [sess(todayAt(1))] },
    ], {
      later: [{ id: 'L1', text: 'Buy milk' }],
    });

    const header = page.locator('#later-header');
    const chevron = header.locator('.later-chevron');

    // Chevron should exist and be pushed to the right
    await expect(chevron).toBeVisible();

    // Chevron's right edge should be near the header's right edge
    const headerBox = await header.boundingBox();
    const chevronBox = await chevron.boundingBox();
    const chevronRight = chevronBox.x + chevronBox.width;
    const headerRight = headerBox.x + headerBox.width;
    // Chevron should be within 20px of the right edge
    expect(headerRight - chevronRight).toBeLessThan(20);
  });

  test('Click on later header toggles later list', async ({ page }) => {
    await seed(page, [
      { id: 'A', name: 'Alpha', sessions: [sess(todayAt(1))] },
    ], {
      later: [{ id: 'L1', text: 'Buy milk' }],
    });

    await expect(page.locator('#later-list')).toBeVisible();

    await page.locator('#later-header').click();
    await expect(page.locator('#later-list')).toBeHidden();

    await page.locator('#later-header').click();
    await expect(page.locator('#later-list')).toBeVisible();
  });
});
