// On-device play log (#25): each app counts finished rounds in localStorage "ll.plays";
// the hub's grown-ups corner shows "This week on this device". Nothing leaves the device.
const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");
const { openApp, openHub, APPS } = require("../helpers");

const GAMES = ["shape-friends", "word-pictures", "number-pals", "sign-spotters"];
const RENDER = { "word-pictures": "renderWord" }; // the others use renderQuestion

const plays = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("ll.plays") || "null"));
const today = (page) => page.evaluate(() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
});

/** Jump to the last item with `solved` items marked solved, then press Next to reach the finish screen. */
async function finishRound(page, app, solved) {
  await page.evaluate(({ fn, solved }) => {
    states.forEach((s, i) => { s.solved = i < solved; });
    index = deck.length - 1;
    window[fn]();
  }, { fn: RENDER[app] || "renderQuestion", solved });
  await page.locator("#next").click();
  await expect(page.locator("#next")).toHaveAttribute("aria-label", "Play again");
}

for (const app of GAMES) {
  test.describe(app, () => {
    test("a finished round is counted once under today's date", async ({ page }) => {
      await openApp(page, app);
      await finishRound(page, app, 3);
      const day = await today(page);
      expect((await plays(page)).days[day][app]).toEqual({ rounds: 1, stars: 3 });

      // Back to the last question and Next to the finish again: still one round
      await page.locator("#back").click();
      await page.locator("#next").click();
      await expect(page.locator("#next")).toHaveAttribute("aria-label", "Play again");
      expect((await plays(page)).days[day][app]).toEqual({ rounds: 1, stars: 3 });

      // Play again and finish: a second round
      await page.locator("#next").click();
      await finishRound(page, app, 2);
      expect((await plays(page)).days[day][app]).toEqual({ rounds: 2, stars: 5 });
    });

    test("leaving mid-round records nothing", async ({ page }) => {
      await openApp(page, app);
      await page.locator("#next").click();
      expect(await plays(page)).toBeNull();
    });

    test("a corrupt log is replaced and old days are dropped", async ({ page }) => {
      await openApp(page, app);
      await page.evaluate(() => localStorage.setItem("ll.plays", "{"));
      await finishRound(page, app, 1);
      expect(Object.keys((await plays(page)).days)).toEqual([await today(page)]);

      await page.evaluate((app) => {
        const old = new Date(); old.setDate(old.getDate() - 31);
        const k = `${old.getFullYear()}-${String(old.getMonth() + 1).padStart(2, "0")}-${String(old.getDate()).padStart(2, "0")}`;
        localStorage.setItem("ll.plays", JSON.stringify({ v: 1, days: { [k]: { [app]: { rounds: 4, stars: 9 } } } }));
      }, app);
      await page.locator("#next").click();
      await finishRound(page, app, 1);
      expect(Object.keys((await plays(page)).days)).toEqual([await today(page)]);
    });

    test("blocked storage never stops play", async ({ page }) => {
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.addInitScript(() => {
        Object.defineProperty(window, "localStorage", { get() { throw new DOMException("blocked", "SecurityError"); } });
      });
      await openApp(page, app);
      await finishRound(page, app, 2);
      expect(errors).toEqual([]);
    });
  });
}

test("every game folder records its own id", () => {
  for (const id of fs.readdirSync(APPS)) {
    const html = fs.readFileSync(path.join(APPS, id, "index.html"), "utf8");
    expect(html, id).toContain(`recordRound("${id}"`);
  }
});

/* ---------- hub ---------- */

async function holdOpen(page) {
  await page.locator("#grownups").dispatchEvent("pointerdown", { button: 0, pointerId: 1 });
  await page.clock.fastForward((await page.evaluate(() => HOLD_MS)) + 100);
  await page.locator("#grownups").dispatchEvent("pointerup", { button: 0, pointerId: 1 });
  await expect(page.locator("#panel")).toBeVisible();
}

/** Seed ll.plays with { daysAgo: { app: [rounds, stars] } } relative to the page's today. */
async function seed(page, spec) {
  await page.evaluate((spec) => {
    const days = {};
    for (const [ago, apps] of Object.entries(spec)) {
      const d = new Date(); d.setDate(d.getDate() - Number(ago));
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      days[k] = {};
      for (const [app, [rounds, stars]] of Object.entries(apps)) days[k][app] = { rounds, stars };
    }
    localStorage.setItem("ll.plays", JSON.stringify({ v: 1, days }));
  }, spec);
}

test("hub: this week shows rounds, days and stars per game; older days are ignored", async ({ page }) => {
  await openHub(page);
  await seed(page, {
    0: { "shape-friends": [2, 9], "number-pals": [1, 5] },
    3: { "shape-friends": [3, 12] },
    6: { "shape-friends": [1, 4] },
    7: { "shape-friends": [5, 20], "word-pictures": [2, 8] },
  });
  await holdOpen(page);
  const rows = page.locator("#plays li");
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toHaveText("🔺 Shape Friends · 6 rounds · 3 days · ⭐ 25");
  await expect(rows.nth(1)).toHaveText("🐱 Word Pictures · 0 rounds");
  await expect(rows.nth(2)).toHaveText("🐞 Number Pals · 1 round · 1 day · ⭐ 5");
  await expect(rows.nth(3)).toHaveText("🚦 Sign Spotters · 0 rounds");
});

test("hub: empty log shows the empty line", async ({ page }) => {
  await openHub(page);
  await seed(page, { 8: { "shape-friends": [1, 1] } });
  await holdOpen(page);
  await expect(page.locator("#plays")).toHaveText(/No rounds finished yet on this device\./);
  await expect(page.locator("#plays li")).toHaveCount(0);
});

test("hub: clearing needs two presses within 3 seconds", async ({ page }) => {
  await openHub(page);
  await seed(page, { 0: { "shape-friends": [1, 3] } });
  await holdOpen(page);
  const clear = page.locator("#clearPlays");
  await expect(clear).toHaveText("Clear play log");
  await clear.click();
  await expect(clear).toHaveText("Tap again to clear");
  await page.clock.fastForward(3_100);
  await expect(clear).toHaveText("Clear play log");
  expect(await plays(page)).not.toBeNull();

  await clear.click();
  await clear.click();
  expect(await plays(page)).toBeNull();
  await expect(page.locator("#plays")).toHaveText(/No rounds finished yet on this device\./);
});

test("hub: a corrupt log still opens the corner", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openHub(page);
  await page.evaluate(() => localStorage.setItem("ll.plays", "{"));
  await holdOpen(page);
  await expect(page.locator("#plays")).toHaveText(/No rounds finished yet/);
  expect(errors).toEqual([]);
});

test("hub: blocked storage opens the corner and clear does nothing harmful", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", { get() { throw new DOMException("blocked", "SecurityError"); } });
  });
  await openHub(page);
  await holdOpen(page);
  await expect(page.locator("#plays")).toHaveText(/No rounds finished yet/);
  await page.locator("#clearPlays").click();
  await page.locator("#clearPlays").click();
  expect(errors).toEqual([]);
});
