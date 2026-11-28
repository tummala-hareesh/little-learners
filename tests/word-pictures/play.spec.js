// Browser play-through tests for Word Pictures.
const { test, expect } = require("@playwright/test");
const { openApp, playedClips, clipExists, swipe } = require("../helpers");

const current = (page) =>
  page.evaluate(() => (index < deck.length ? { word: deck[index].w, filled: states[index].filled, index } : null));

async function tapLetter(page, letter) {
  await page.locator(`#tiles .tile:not(.gone)[data-letter="${letter}"]`).first().click();
}

async function spellCurrent(page) {
  const { word, filled } = await current(page);
  for (const ch of word.slice(filled)) await tapLetter(page, ch);
  return word;
}

test.beforeEach(async ({ page }) => {
  await openApp(page, "word-pictures", { seed: 7 });
});

test("starts a 5-word round of 3-letter words with scrambled tiles", async ({ page }) => {
  await expect(page.locator("#progress .dot")).toHaveCount(5);
  const { word } = await current(page);
  expect(word).toHaveLength(3);
  await expect(page.locator("#slots .slot")).toHaveCount(3);
  const tiles = await page.locator("#tiles .tile").allTextContents();
  expect([...tiles].sort()).toEqual([...word].sort());
  await expect(page.locator("#pic")).toHaveText("?");
  await expect(page.locator("#msg")).toHaveText("Find the first letter!");
  await expect(page.locator("#back")).toBeDisabled();
});

test("tapping letters in order spells the word and celebrates", async ({ page }) => {
  const word = await spellCurrent(page);
  await expect(page.locator("#stars")).toHaveText("⭐ 1");
  await expect(page.locator("#slots .slot.filled")).toHaveCount(word.length);
  await expect(page.locator("#banner")).toHaveClass(/show/);
  await expect(page.locator("#banner")).toHaveText(word);
  await expect(page.locator("#msg")).toContainText(`${word}!`);
  await expect(page.locator("#progress .dot.on")).toHaveCount(1);
  await expect(page.locator("#pic")).not.toHaveText("?");
});

test("a wrong letter wobbles and does not fill a slot", async ({ page }) => {
  const { word } = await current(page);
  const wrong = (await page.locator("#tiles .tile").allTextContents()).find((c) => c !== word[0]);
  test.skip(!wrong, "word made of one repeated letter");
  const tile = page.locator(`#tiles .tile[data-letter="${wrong}"]`).first();
  await tile.click();
  await expect(tile).toHaveClass(/wobble/);
  await expect(page.locator("#msg")).toHaveText("Not that one. Look again!");
  expect((await current(page)).filled).toBe(0);
});

test("typing on a keyboard spells the word; wrong keys are ignored", async ({ page, isMobile }) => {
  test.skip(isMobile, "keyboard input is a desktop feature");
  const { word } = await current(page);
  await page.keyboard.press("Q" === word[0] ? "Z" : "Q");
  expect((await current(page)).filled).toBe(0);
  for (const ch of word) await page.keyboard.press(ch.toLowerCase());
  await expect(page.locator("#stars")).toHaveText("⭐ 1");
});

test("Help me highlights the next correct tile", async ({ page }) => {
  const { word } = await current(page);
  await tapLetter(page, word[0]);
  await page.locator("#hintBtn").click();
  const hinted = page.locator("#tiles .tile.hint");
  await expect(hinted).toHaveCount(1);
  await expect(hinted).toHaveText(word[1]);
  await expect(page.locator("#msg")).toHaveText(`Find the letter ${word[1]}!`);
});

test("a hint appears by itself after 10 seconds of no progress", async ({ page }) => {
  await page.clock.install();
  await page.reload();
  await page.waitForFunction(() => typeof deck !== "undefined" && deck.length > 0);
  await expect(page.locator("#tiles .tile.hint")).toHaveCount(0);
  await page.clock.fastForward(10_500);
  await expect(page.locator("#tiles .tile.hint")).toHaveCount(1);
});

test("finishing a full round shows the score and Play again restarts", async ({ page }) => {
  test.slow(); // plays every item of a round: dozens of taps, ~25 s on a busy machine
  for (let i = 0; i < 5; i++) {
    await spellCurrent(page);
    await page.locator("#next").click();
  }
  await expect(page.locator("#msg")).toHaveText(/^You got 5 of 5 words!/);
  await expect(page.locator("#next")).toHaveAttribute("aria-label", "Play again");
  await expect(page.locator("#hintBtn")).toBeDisabled();
  await page.locator("#next").click();
  expect((await current(page)).index).toBe(0);
  await expect(page.locator("#stars")).toHaveText("⭐ 0");
});

test("skipping words counts only solved ones, and Back returns to them", async ({ page }) => {
  await spellCurrent(page);
  for (let i = 0; i < 5; i++) await page.locator("#next").click();
  await expect(page.locator("#msg")).toHaveText(/^You got 1 of 5 words!/);
  await page.locator("#back").click();
  expect((await current(page)).index).toBe(4);
});

test("settings: word length is multi-select but keeps at least one; round size changes dots", async ({ page }) => {
  await page.locator("#settingsBtn").click();
  await expect(page.locator("#setup")).toHaveClass(/open/);
  const chip = (g, v) => page.locator(`.chip[data-group="${g}"][data-val="${v}"]`);

  await chip("len", 6).click();
  await chip("len", 3).click();
  await expect(chip("len", 3)).toHaveAttribute("aria-pressed", "false");
  const lens = await page.evaluate(() => deck.map((d) => d.w.length));
  expect(new Set(lens)).toEqual(new Set([6]));

  await chip("len", 6).click(); // last one selected: must stay on
  await expect(chip("len", 6)).toHaveAttribute("aria-pressed", "true");

  await chip("count", 3).click();
  await expect(page.locator("#progress .dot")).toHaveCount(3);

  await page.keyboard.press("Escape");
  await expect(page.locator("#setup")).not.toHaveClass(/open/);
});

test("short rounds use every available word when the pool is smaller than the round", async ({ page }) => {
  await page.locator("#settingsBtn").click();
  await page.locator('.chip[data-group="len"][data-val="2"]').click();
  await page.locator('.chip[data-group="len"][data-val="3"]').click();
  const n2 = await page.evaluate(() => WORDS.filter((w) => w.w.length === 2).length);
  await expect(page.locator("#progress .dot")).toHaveCount(Math.min(5, n2));
});

test("spoken clips exist on disk for both voices during play", async ({ page }) => {
  await spellCurrent(page);
  await page.waitForTimeout(300);
  await page.locator("#settingsBtn").click();
  await page.locator("#voice").selectOption("boy");
  await page.keyboard.press("Escape");
  await page.locator("#next").click();
  await spellCurrent(page);
  await page.waitForTimeout(300);

  const clips = await playedClips(page);
  expect(clips.some((c) => c.includes("/audio/"))).toBe(true);
  expect(clips.some((c) => c.includes("/audio-m/"))).toBe(true);
  expect(clips.filter((c) => !clipExists(c))).toEqual([]);
});

test("swipe left goes to the next word, swipe right goes back", async ({ page, isMobile }) => {
  test.skip(!isMobile, "touch only");
  await swipe(page, -150);
  expect((await current(page)).index).toBe(1);
  await swipe(page, 150);
  expect((await current(page)).index).toBe(0);
});

test("a device voice refused before the first touch speaks on that touch", async ({ page }) => {
  await page.evaluate(() => {
    let refusedOnce = false;
    speechSynthesis.getVoices = () => [{ name: "Test", lang: "en-US" }];
    speechSynthesis.speak = (u) => {
      if (!refusedOnce) { refusedOnce = true; setTimeout(() => u.onerror({ error: "not-allowed" }), 5); return; }
      window.__spoken.push(u.text);
      setTimeout(() => u.onend && u.onend(), 5);
    };
    window.SpeechSynthesisUtterance = function (text) { this.text = text; };   // takes the fake voice
    fillVoices();
    $("voice").value = "dev:Test";
    window.__spoken.length = 0;
    sayWord();
  });
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => window.__spoken.slice())).toEqual([]);   // refused: nothing said yet
  await page.locator("#pic").click();                                       // the child touches the screen
  const w = await page.evaluate(() => deck[index].w.toLowerCase());
  await expect.poll(() => page.evaluate(() => window.__spoken.slice())).toEqual([w]);
});
