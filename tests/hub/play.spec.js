// Browser tests for the Playroom hub (root index.html).
const path = require("path");
const { test, expect } = require("@playwright/test");
const { openHub, openApp, playedClips, prepare, ROOT } = require("../helpers");

const tile = (page, id) => page.locator(`#grid .tile[data-id="${id}"]`);
const spoken = (page) => page.evaluate(() => window.__spoken.slice());

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
  await tile(page, app.id).click();
  await tile(page, app.id).click();
  await expect(page).toHaveURL(new RegExp(`/${app.href.replace(/\./g, "\\.")}$`));
  await expect(page.locator("h1")).toHaveText(app.name);
});

test("the ▶ button opens the picked app", async ({ page }) => {
  await openHub(page);
  const app = await page.evaluate(() => APPS[1]);
  await tile(page, app.id).click();
  await page.locator("#go").click();
  await expect(page).toHaveURL(new RegExp(`/${app.href.replace(/\./g, "\\.")}$`));
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

test("a recorded clip that fails to play falls back to the device voice", async ({ page }) => {
  await openHub(page, { failClips: true });
  const app = await page.evaluate(() => { APPS[0].clips = true; return APPS[0]; });
  await tile(page, app.id).click();
  await expect.poll(() => playedClips(page)).toContain(`/hub/audio/app-${app.id}.wav`);
  await expect.poll(() => spoken(page)).toContain(app.say);
});

test("the boy voice uses the audio-m clips", async ({ page }) => {
  await openHub(page);
  const app = await page.evaluate(() => { APPS[0].clips = true; return APPS[0]; });
  await page.evaluate(() => openPanel()); // the picker lives in the grown-ups corner
  await page.locator("#voice").selectOption("boy");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1_100); // survive the delayed voice-list refreshes
  await tile(page, app.id).click();
  await expect.poll(() => playedClips(page)).toContain(`/hub/audio-m/app-${app.id}.wav`);
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
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/${b.href.replace(/\./g, "\\.")}$`));
});

test("the pick clears itself after 8 seconds idle", async ({ page }) => {
  await page.clock.install();
  await openHub(page);
  const app = await page.evaluate(() => APPS[0]);
  await tile(page, app.id).click();
  await expect(tile(page, app.id)).toHaveAttribute("aria-pressed", "true");
  await page.clock.fastForward(8_500);
  await expect(tile(page, app.id)).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#go")).toBeHidden();
});

test("grown-ups corner: a tap only wiggles; a 2-second hold opens it; Esc closes", async ({ page }) => {
  await page.clock.install();
  await openHub(page);
  const gu = page.locator("#grownups");

  await gu.click();
  await expect(page.locator("#panel")).toBeHidden();

  await gu.dispatchEvent("pointerdown", { button: 0 });
  await page.clock.fastForward(1_000);
  await gu.dispatchEvent("pointerup", { button: 0 });
  await page.clock.fastForward(2_000);
  await expect(page.locator("#panel")).toBeHidden(); // let go too early

  await gu.dispatchEvent("pointerdown", { button: 0 });
  await page.clock.fastForward(2_100);
  await expect(page.locator("#panel")).toBeVisible();
  const names = await page.evaluate(() => APPS.map((a) => a.name));
  for (const n of names) await expect(page.locator("#appInfo")).toContainText(n);
  await expect(page.locator("#panel")).toContainText("No tracking");

  await page.keyboard.press("Escape");
  await expect(page.locator("#panel")).toBeHidden();
});

test("grown-ups corner opens by holding Enter on the ⚙ button", async ({ page, isMobile }) => {
  test.skip(isMobile, "keyboard is a desktop feature");
  await page.clock.install();
  await openHub(page);
  await page.locator("#grownups").focus();
  await page.keyboard.down("Enter");
  await page.clock.fastForward(2_100);
  await page.keyboard.up("Enter");
  await expect(page.locator("#panel")).toBeVisible();
});

test("a saved device voice that this device lacks falls back to Girl without losing the choice", async ({ page }) => {
  await prepare(page);
  await page.addInitScript(() => { try { localStorage.setItem("ll.hub.voice", "dev:Not A Real Voice"); } catch (e) {} });
  await page.goto("/index.html");
  await expect(page.locator("#voice")).toHaveValue("girl");
  expect(await page.evaluate(() => localStorage.getItem("ll.hub.voice"))).toBe("dev:Not A Real Voice");
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
  await page.goto("file://" + path.join(ROOT, "index.html"));
  const app = await page.evaluate(() => APPS[0]);
  await tile(page, app.id).click();
  await tile(page, app.id).click();
  await expect(page).toHaveURL(new RegExp(`/${app.href.replace(/\./g, "\\.")}$`));
  await expect(page.locator("h1")).toHaveText(app.name);
});
