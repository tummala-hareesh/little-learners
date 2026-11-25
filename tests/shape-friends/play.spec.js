// Browser play-through tests for Shape Friends.
const { test, expect } = require("@playwright/test");
const { openApp, playedClips, clipExists, swipe } = require("../helpers");

const current = (page) =>
  page.evaluate(() => {
    if (index >= deck.length) return null;
    const q = deck[index];
    return {
      index, type: q.type, target: q.target, obj: q.obj.say,
      answer: q.type === "find" ? q.obj.k : q.target,
      values: q.choices.map((c) => (typeof c === "string" ? c : c.k)),
    };
  });

const choice = (page, value) => page.locator(`#choices .choice[data-value="${value}"]`);

async function answerCurrent(page) {
  const q = await current(page);
  await choice(page, q.answer).click();
  return q;
}

test.beforeEach(async ({ page }) => {
  await openApp(page, "shape-friends", { seed: 3 });
});

test("starts a 5-question round with 3 choices and the right prompt", async ({ page }) => {
  await expect(page.locator("#progress .dot")).toHaveCount(5);
  const q = await current(page);
  await expect(page.locator("#choices .choice")).toHaveCount(3);
  expect(q.values).toContain(q.answer);
  if (q.type === "find") {
    await expect(page.locator("#prompt")).toHaveText(`Find the ${q.target}`);
    await expect(page.locator("#stage")).toHaveText("?");
  } else {
    await expect(page.locator("#prompt")).toHaveText("What shape is this?");
    await expect(page.locator("#stage .emo")).toHaveAttribute("aria-label", q.obj);
  }
  await expect(page.locator("#back")).toBeDisabled();
});

test("the right answer is marked done, scores a star and names the shape", async ({ page }) => {
  const q = await answerCurrent(page);
  await expect(choice(page, q.answer)).toHaveClass(/done/);
  await expect(page.locator("#stars")).toHaveText("⭐ 1");
  await expect(page.locator("#prompt")).toContainText(`${q.obj} is`);
  await expect(page.locator("#prompt")).toContainText(`${q.target}!`);
  await expect(page.locator("#stage .emo")).toBeVisible();
  await expect(page.locator("#progress .dot.on")).toHaveCount(1);
});

test("a wrong answer wobbles and says Try again", async ({ page }) => {
  const q = await current(page);
  const wrong = q.values.find((v) => v !== q.answer);
  await choice(page, wrong).click();
  await expect(choice(page, wrong)).toHaveClass(/wobble/);
  await expect(page.locator("#msg")).toHaveText("Try again!");
  await expect(page.locator("#stars")).toHaveText("⭐ 0");
  // answering after a mistake still counts
  await choice(page, q.answer).click();
  await expect(page.locator("#stars")).toHaveText("⭐ 1");
});

test("tapping again after solving changes nothing", async ({ page }) => {
  const q = await answerCurrent(page);
  const wrong = q.values.find((v) => v !== q.answer);
  await choice(page, wrong).click();
  await expect(page.locator("#stars")).toHaveText("⭐ 1");
  await expect(choice(page, wrong)).not.toHaveClass(/wobble/);
});

test("Help me highlights only the correct choice", async ({ page }) => {
  const q = await current(page);
  await page.locator("#hintBtn").click();
  await expect(page.locator("#choices .choice.hint")).toHaveCount(1);
  await expect(choice(page, q.answer)).toHaveClass(/hint/);
});

test("a hint appears by itself after 10 seconds", async ({ page }) => {
  await page.clock.install();
  await page.reload();
  await page.waitForFunction(() => typeof deck !== "undefined" && deck.length > 0);
  await expect(page.locator("#choices .choice.hint")).toHaveCount(0);
  await page.clock.fastForward(10_500);
  await expect(page.locator("#choices .choice.hint")).toHaveCount(1);
});

test("finishing a full round shows the score and Play again restarts", async ({ page }) => {
  for (let i = 0; i < 5; i++) {
    await answerCurrent(page);
    await page.locator("#next").click();
  }
  await expect(page.locator("#msg")).toHaveText(/^You got 5 of 5 right!/);
  await expect(page.locator("#next")).toHaveAttribute("aria-label", "Play again");
  await expect(page.locator("#sayBtn")).toBeDisabled();
  await page.locator("#next").click();
  expect((await current(page)).index).toBe(0);
  await expect(page.locator("#stars")).toHaveText("⭐ 0");
});

test("arrow keys move between questions", async ({ page, isMobile }) => {
  test.skip(isMobile, "keyboard is a desktop feature");
  await page.keyboard.press("ArrowRight");
  expect((await current(page)).index).toBe(1);
  await page.keyboard.press("ArrowLeft");
  expect((await current(page)).index).toBe(0);
});

test("settings: shape set, choice count and round size", async ({ page }) => {
  const chip = (g, v) => page.locator(`.chip[data-group="${g}"][data-val="${v}"]`);
  await page.locator("#settingsBtn").click();

  await chip("count", 4).click();
  await expect(page.locator("#choices .choice")).toHaveCount(4);
  await expect(chip("count", 4)).toHaveAttribute("aria-pressed", "true");
  await expect(chip("count", 3)).toHaveAttribute("aria-pressed", "false");

  await chip("round", 10).click();
  await expect(page.locator("#progress .dot")).toHaveCount(10);

  await chip("kind", "2d").click();
  const outside = await page.evaluate(() => deck.filter((q) => !SHAPES_2D.includes(q.target)).length);
  expect(outside).toBe(0);

  // clicking outside the panel closes it
  await page.locator("h1").click();
  await expect(page.locator("#setup")).not.toHaveClass(/open/);
});

test("spoken clips exist on disk for both voices during play", async ({ page }) => {
  await answerCurrent(page);
  await page.waitForTimeout(300);
  await page.locator("#settingsBtn").click();
  await page.locator("#voice").selectOption("boy");
  await page.keyboard.press("Escape");
  await page.locator("#next").click();
  const q = await current(page);
  await choice(page, q.values.find((v) => v !== q.answer)).click(); // "try again"
  await page.waitForTimeout(100);
  await answerCurrent(page);
  await page.waitForTimeout(300);
  for (let i = 0; i < 4; i++) await page.locator("#next").click(); // reach finish → "great"
  await page.waitForTimeout(300);

  const clips = await playedClips(page);
  expect(clips.some((c) => c.includes("/audio/"))).toBe(true);
  expect(clips.some((c) => c.includes("/audio-m/"))).toBe(true);
  expect(clips.filter((c) => !clipExists(c))).toEqual([]);
});

test("swipe left goes to the next question, swipe right goes back", async ({ page, isMobile }) => {
  test.skip(!isMobile, "touch only");
  await swipe(page, -150);
  expect((await current(page)).index).toBe(1);
  await swipe(page, 150);
  expect((await current(page)).index).toBe(0);
});
