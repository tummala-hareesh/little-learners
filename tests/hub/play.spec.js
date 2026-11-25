// Browser tests for the Playroom hub (root index.html).
// openHub installs Playwright's fake clock, so timers are stepped with page.clock.fastForward.
const { test, expect } = require("@playwright/test");
const { openHub, openApp, playedClips, prepare } = require("../helpers");

const tile = (page, id) => page.locator(`#grid .tile[data-id="${id}"]`);
const spoken = (page) => page.evaluate(() => window.__spoken.slice());
const konst = (page, name) => page.evaluate((n) => window.eval(n), name); // read IDLE_MS etc. from the page
const hrefRe = (app) => new RegExp(`/${app.href.replace(/\./g, "\\.")}$`);

/** Tap a tile twice, waiting out the double-tap guard in between, so it opens. */
async function openTile(page, id) {
  await tile(page, id).click();
  await page.clock.fastForward((await konst(page, "CONFIRM_GAP_MS")) + 50);
  await tile(page, id).click();
}

/** Open the grown-ups corner the way a grown-up does: press and hold ⚙. */
async function holdOpen(page) {
  const gu = page.locator("#grownups");
  await gu.dispatchEvent("pointerdown", { button: 0, pointerId: 1 });
  await page.clock.fastForward((await konst(page, "HOLD_MS")) + 100);
  await gu.dispatchEvent("pointerup", { button: 0, pointerId: 1 });
  await expect(page.locator("#panel")).toBeVisible();
}

test("starts with every app as a tile, nothing picked, and nothing said", async ({ page }) => {
  await openHub(page);
  const n = await page.evaluate(() => APPS.length);
  await expect(page.locator("#grid .tile")).toHaveCount(n);
  await expect(page.locator("#gobar")).toContainText("Pick a friend");
  await expect(page.locator("#go")).toBeHidden();
  await expect(page.locator('#grid .tile[aria-pressed="true"]')).toHaveCount(0);
  // Browsers block audio before a gesture: the hub must not try to speak on load.
  expect(await playedClips(page)).toEqual([]);
  expect(await spoken(page)).toEqual([]);
});

test("first tap picks a tile and says its name without leaving the page", async ({ page }) => {
  await openHub(page);
  const app = await page.evaluate(() => APPS[0]);
  await tile(page, app.id).click();
  await expect(tile(page, app.id)).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#gobar")).toContainText(`${app.name}!`);
  await expect(page.locator("#go")).toBeVisible();
  await expect(page).toHaveURL(/\/index\.html$/);
  if (app.clips === false) await expect.poll(() => spoken(page)).toContain(app.say);
  else await expect.poll(() => playedClips(page)).toContain(`/hub/audio/app-${app.id}.wav`);
});

test("second tap on the picked tile opens the app", async ({ page }) => {
  await openHub(page);
  const app = await page.evaluate(() => APPS[0]);
  await openTile(page, app.id);
  await expect(page).toHaveURL(hrefRe(app));
  await expect(page.locator("h1")).toHaveText(app.name);
});

test("a quick double-tap only picks the tile, so the name is heard first", async ({ page }) => {
  await openHub(page);
  const app = await page.evaluate(() => APPS[0]);
  await tile(page, app.id).dblclick();
  await expect(page).toHaveURL(/\/index\.html$/);
  await expect(tile(page, app.id)).toHaveAttribute("aria-pressed", "true");
});

test("the ▶ button opens the picked app", async ({ page }) => {
  await openHub(page);
  const app = await page.evaluate(() => APPS[1]);
  await tile(page, app.id).click();
  await page.locator("#go").click();
  await expect(page).toHaveURL(hrefRe(app));
});

test("tapping another tile moves the pick and says the new name", async ({ page }) => {
  await openHub(page);
  const [a, b] = await page.evaluate(() => [APPS[0], APPS[1]]);
  await tile(page, a.id).click();
  await tile(page, b.id).click();
  await expect(tile(page, a.id)).toHaveAttribute("aria-pressed", "false");
  await expect(tile(page, b.id)).toHaveAttribute("aria-pressed", "true");
  await expect(page).toHaveURL(/\/index\.html$/);
  await expect(page.locator("#gobar")).toContainText(`${b.name}!`);
});

test("coming back with Back shows a fresh screen with nothing picked", async ({ page }) => {
  await openHub(page);
  const app = await page.evaluate(() => APPS[0]);
  await openTile(page, app.id);
  await expect(page).toHaveURL(hrefRe(app));
  await page.goBack();
  await expect(page).toHaveURL(/\/index\.html$/);
  await expect(page.locator('#grid .tile[aria-pressed="true"]')).toHaveCount(0);
  await expect(page.locator("#go")).toBeHidden();
});

test("a recorded clip that fails to play falls back to the device voice", async ({ page }) => {
  await openHub(page, { failClips: true });
  const app = await page.evaluate(() => { APPS[0].clips = true; return APPS[0]; });
  await tile(page, app.id).click();
  await expect.poll(() => playedClips(page)).toContain(`/hub/audio/app-${app.id}.wav`);
  await expect.poll(() => spoken(page)).toContain(app.say);
});

test("without any speech engine a tap still picks the tile and nothing breaks", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.clock.install();
  await prepare(page);
  // Some Android WebViews and Linux Firefox builds have no speechSynthesis at all.
  await page.addInitScript(() => { delete window.speechSynthesis; });
  await page.goto("/index.html");
  expect(await page.evaluate(() => "speechSynthesis" in window)).toBe(false);
  const app = await page.evaluate(() => APPS[0]);
  await tile(page, app.id).click();
  await expect(tile(page, app.id)).toHaveAttribute("aria-pressed", "true");
  expect(errors).toEqual([]);
});

test("the boy voice uses the audio-m clips, and the choice survives the voice-list refreshes", async ({ page }) => {
  await openHub(page);
  const app = await page.evaluate(() => { APPS[0].clips = true; return APPS[0]; });
  await holdOpen(page);
  await page.locator("#voice").selectOption("boy");
  await page.keyboard.press("Escape");
  await page.clock.fastForward(3_000); // past every scheduled fillVoices() refresh
  await expect(page.locator("#voice")).toHaveValue("boy");
  await tile(page, app.id).click();
  await expect.poll(() => playedClips(page)).toContain(`/hub/audio-m/app-${app.id}.wav`);
});

test("a saved device voice is restored when the device's voices load late", async ({ page }) => {
  await page.clock.install();
  await prepare(page);
  await page.addInitScript(() => {
    try { localStorage.setItem("ll.hub.voice", "dev:Late Voice"); } catch (e) {}
    let ready = false;
    window.speechSynthesis.getVoices = () => (ready ? [{ name: "Late Voice", lang: "en-US" }] : []);
    window.__voicesReady = () => { ready = true; if (speechSynthesis.onvoiceschanged) speechSynthesis.onvoiceschanged(); };
  });
  await page.goto("/index.html");
  await expect(page.locator("#voice")).toHaveValue("girl");
  await page.clock.fastForward(1_100); // a refresh before the voices exist must not lose the saved choice
  await page.evaluate(() => window.__voicesReady());
  await expect(page.locator("#voice")).toHaveValue("dev:Late Voice");
});

test("a saved device voice that this device lacks falls back to Girl without losing the choice", async ({ page }) => {
  await prepare(page);
  await page.addInitScript(() => { try { localStorage.setItem("ll.hub.voice", "dev:Not A Real Voice"); } catch (e) {} });
  await page.goto("/index.html");
  await expect(page.locator("#voice")).toHaveValue("girl");
  expect(await page.evaluate(() => localStorage.getItem("ll.hub.voice"))).toBe("dev:Not A Real Voice");
});

test("keyboard: arrows move between tiles, Enter picks, Enter again opens", async ({ page, isMobile }) => {
  test.skip(isMobile, "keyboard is a desktop feature");
  await openHub(page);
  const [a, b] = await page.evaluate(() => [APPS[0], APPS[1]]);
  await page.keyboard.press("Tab");
  await expect(tile(page, a.id)).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(tile(page, b.id)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(tile(page, b.id)).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(tile(page, b.id)).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Enter");
  await page.clock.fastForward((await konst(page, "CONFIRM_GAP_MS")) + 50);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(hrefRe(b));
});

test("the pick clears itself after the idle time", async ({ page }) => {
  await openHub(page);
  const app = await page.evaluate(() => APPS[0]);
  await tile(page, app.id).click();
  await expect(tile(page, app.id)).toHaveAttribute("aria-pressed", "true");
  await page.clock.fastForward((await konst(page, "IDLE_MS")) + 500);
  await expect(tile(page, app.id)).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#go")).toBeHidden();
});

test("grown-ups corner: a tap only wiggles; letting go or sliding off early cancels; a full hold opens", async ({ page }) => {
  await openHub(page);
  const gu = page.locator("#grownups");
  const hold = await konst(page, "HOLD_MS");

  await gu.click();
  await expect(page.locator("#panel")).toBeHidden();

  for (const early of ["pointerup", "pointerleave", "pointercancel"]) {
    await gu.dispatchEvent("pointerdown", { button: 0, pointerId: 1 });
    await page.clock.fastForward(hold / 2);
    await gu.dispatchEvent(early, { button: 0, pointerId: 1 });
    await page.clock.fastForward(hold);
    await expect(page.locator("#panel"), `${early} cancels`).toBeHidden();
  }

  await holdOpen(page);
  const names = await page.evaluate(() => APPS.map((a) => a.name));
  for (const n of names) await expect(page.locator("#appInfo")).toContainText(n);
  await expect(page.locator("#panel")).toContainText("No tracking");

  await page.keyboard.press("Escape");
  await expect(page.locator("#panel")).toBeHidden();
});

test("grown-ups corner closes from ✕ and from the backdrop", async ({ page }) => {
  await openHub(page);
  await holdOpen(page);
  await page.locator("#closePanel").click();
  await expect(page.locator("#panel")).toBeHidden();
  await holdOpen(page);
  await page.locator("#panel").click({ position: { x: 5, y: 5 } });
  await expect(page.locator("#panel")).toBeHidden();
});

test("while the grown-ups corner is open, Tab stays inside it", async ({ page, isMobile }) => {
  test.skip(isMobile, "keyboard is a desktop feature");
  await openHub(page);
  await holdOpen(page);
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.getElementById("panel").contains(document.activeElement))).toBe(true);
  }
});

for (const key of ["Enter", " "]) {
  test(`holding ${key === " " ? "Space" : "Enter"} on ⚙ opens the corner and it stays open after letting go`, async ({ page, isMobile }) => {
    test.skip(isMobile, "keyboard is a desktop feature");
    await openHub(page);
    const hold = await konst(page, "HOLD_MS");
    await page.locator("#grownups").focus();
    await page.keyboard.down(key);
    await page.clock.fastForward(hold + 100);
    await expect(page.locator("#panel")).toBeVisible();
    await page.keyboard.down(key); // OS auto-repeat lands on ✕, which now has focus
    await page.keyboard.up(key);
    await expect(page.locator("#panel")).toBeVisible();
  });
}

test("a short Enter press on ⚙ only wiggles", async ({ page, isMobile }) => {
  test.skip(isMobile, "keyboard is a desktop feature");
  await openHub(page);
  await page.locator("#grownups").focus();
  await page.keyboard.down("Enter");
  await page.clock.fastForward(300);
  await page.keyboard.up("Enter");
  await page.clock.fastForward(3_000);
  await expect(page.locator("#panel")).toBeHidden();
});

for (const app of ["shape-friends", "word-pictures"]) {
  test(`🏠 in ${app} returns to the hub`, async ({ page }) => {
    await openApp(page, app);
    const home = page.locator("a.home");
    await expect(home).toHaveAttribute("aria-label", "Home");
    await home.click();
    await expect(page).toHaveURL(/\/index\.html$/);
    await expect(page.locator("#grid .tile").first()).toBeVisible();
  });
}

test("works when opened straight from disk (file://)", async ({ page }) => {
  await openHub(page, { url: "file" });
  const app = await page.evaluate(() => APPS[0]);
  await openTile(page, app.id);
  await expect(page).toHaveURL(hrefRe(app));
  await expect(page.locator("h1")).toHaveText(app.name);
});
