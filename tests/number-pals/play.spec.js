// Browser play-through tests for Number Pals.
const { test, expect } = require("@playwright/test");
const { openApp, playedClips, clipExists, swipe } = require("../helpers");

const current = (page) =>
  page.evaluate(() => {
    if (index >= deck.length) return null;
    const q = deck[index];
    return { index, type: q.type, n: q.n, thing: q.thing.k, one: q.thing.one, many: q.thing.many, choices: q.choices, pool: q.pool };
  });

/** Replace the round with fixed questions, e.g. [{ type: "how", n: 3, thing: "bug" }]. */
async function setDeck(page, qs) {
  await page.evaluate((qs) => {
    stopAudio();
    deck = qs.map((q) => {
      const thing = THINGS.find((t) => t.k === (q.thing || "bug"));
      return q.type === "how"
        ? { type: "how", n: q.n, thing, choices: q.choices || [q.n - 1 || 2, q.n, q.n + 1].sort((a, b) => a - b) }
        : { type: "show", n: q.n, thing, pool: q.pool || Math.min(10, q.n + 3) };
    });
    states = deck.map(freshState);
    index = 0;
    renderQuestion();
    window.__spoken.length = 0;
    window.__clips.length = 0;
  }, qs);
}

/**
 * What the game said, in order: the text of every clip played (recorded voices) followed by
 * device-voice speech. With CLIPS_RECORDED the built-in voices play clips, otherwise they speak.
 */
const spoken = (page) =>
  page.evaluate(() => [
    ...window.__clips.map((p) => clipText(decodeURIComponent(p).split("/").pop().replace(/\.wav$/, ""))),
    ...window.__spoken,
  ]);
const obj = (page, i) => page.locator(`#stage .obj[data-i="${i}"]`);
const choice = (page, v) => page.locator(`#choices .choice[data-value="${v}"]`);
const basket = (page) => page.locator("#basket .obj");

test.beforeEach(async ({ page }) => {
  await openApp(page, "number-pals", { seed: 5 });
});

test("starts a 5-question round with the right prompt and things to count", async ({ page }) => {
  await expect(page.locator("#progress .dot")).toHaveCount(5);
  const q = await current(page);
  if (q.type === "how") {
    await expect(page.locator("#prompt")).toHaveText(`How many ${q.many}?`);
    await expect(page.locator("#stage .obj")).toHaveCount(q.n);
    await expect(page.locator("#choices .choice")).toHaveCount(3);
    expect(q.choices).toContain(q.n);
  } else {
    await expect(page.locator("#prompt")).toHaveText(`Show me ${q.n} ${q.n === 1 ? q.one : q.many}`);
    await expect(page.locator("#stage .obj")).toHaveCount(q.pool);
    await expect(page.locator("#checkBtn")).toBeVisible();
  }
  await expect(page.locator("#back")).toBeDisabled();
  // the built-in voice says the prompt (a clip, or the device voice while clips aren't recorded)
  await expect.poll(() => spoken(page)).toContain(q.type === "how" ? "How many" : "Show me");
});

test("each tap counts the next number out loud; a counted thing is not counted twice", async ({ page }) => {
  await setDeck(page, [{ type: "how", n: 4, thing: "apple" }]);
  await obj(page, 2).click();
  await obj(page, 0).click();
  await obj(page, 2).click(); // already counted: says "one" again, no new number
  await obj(page, 3).click();
  await expect(obj(page, 2).locator(".badge")).toHaveText("1");
  await expect(obj(page, 0).locator(".badge")).toHaveText("2");
  await expect(obj(page, 3).locator(".badge")).toHaveText("3");
  await expect(obj(page, 1).locator(".badge")).toHaveCount(0);
  await obj(page, 1).click();
  await expect(obj(page, 1).locator(".badge")).toHaveText("4");
  await expect(obj(page, 1)).toHaveAttribute("aria-label", "apple, 4");
  await expect.poll(() => spoken(page)).toEqual(["one", "two", "one", "three", "four"]);
});

test("the right numeral is marked done, scores a star and counts the set back", async ({ page }) => {
  await setDeck(page, [{ type: "how", n: 3, thing: "bug" }, { type: "how", n: 2 }]);
  await choice(page, 3).click();
  await expect(choice(page, 3)).toHaveClass(/done/);
  await expect(page.locator("#stars")).toHaveText("⭐ 1");
  await expect(page.locator("#prompt")).toHaveText("3 bugs!");
  await expect(page.locator("#progress .dot.on")).toHaveCount(1);
  await expect(page.locator("#stage .badge")).toHaveText(["1", "2", "3"]);
  await expect.poll(async () => (await spoken(page)).slice(1)).toEqual(["one", "two", "three", "bugs"]);
});

test("a wrong numeral wobbles, says Let's count again and counts from one", async ({ page }) => {
  await setDeck(page, [{ type: "how", n: 3, thing: "car", choices: [2, 3, 4] }]);
  await obj(page, 0).click();
  await choice(page, 4).click();
  await expect(choice(page, 4)).toHaveClass(/wobble/);
  await expect(page.locator("#msg")).toHaveText("Let's count again!");
  await expect(page.locator("#stars")).toHaveText("⭐ 0");
  await expect.poll(() => spoken(page)).toEqual(["one", "Let's count again!", "one", "two", "three"]);
  await expect(page.locator("#stage .badge")).toHaveText(["1", "2", "3"]);
  // answering after a mistake still counts, and tapping again after solving changes nothing
  await choice(page, 3).click();
  await expect(page.locator("#stars")).toHaveText("⭐ 1");
  await choice(page, 2).click();
  await expect(choice(page, 2)).not.toHaveClass(/wobble/);
  await expect(page.locator("#stars")).toHaveText("⭐ 1");
});

test("one thing is shown and said in the singular", async ({ page }) => {
  await setDeck(page, [{ type: "how", n: 1, thing: "chick", choices: [1, 2, 3] }]);
  await choice(page, 1).click();
  await expect(page.locator("#prompt")).toHaveText("1 chick!");
  await expect.poll(() => spoken(page)).toContain("chick");
});

test("digit keys answer How many? (0 is ten)", async ({ page, isMobile }) => {
  test.skip(isMobile, "keyboard is a desktop feature");
  await setDeck(page, [{ type: "how", n: 10, thing: "star", choices: [8, 9, 10] }, { type: "how", n: 2, choices: [1, 2, 3] }]);
  await page.keyboard.press("9");
  await expect(page.locator("#msg")).toHaveText("Let's count again!");
  await page.keyboard.press("0");
  await expect(page.locator("#stars")).toHaveText("⭐ 1");
  await expect(choice(page, 10)).toHaveClass(/done/);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("2");
  await expect(page.locator("#stars")).toHaveText("⭐ 2");
});

test("Up/Down move focus through the things and answers; Enter taps", async ({ page, isMobile }) => {
  test.skip(isMobile, "keyboard is a desktop feature");
  await setDeck(page, [{ type: "how", n: 2, thing: "bug", choices: [1, 2, 3] }]);
  await page.keyboard.press("ArrowDown");
  await expect(obj(page, 0)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(obj(page, 0).locator(".badge")).toHaveText("1");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(choice(page, 1)).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(obj(page, 1)).toBeFocused();
});

test("Show me: tapping puts things in the basket counting aloud; tapping the basket takes one out", async ({ page }) => {
  await setDeck(page, [{ type: "show", n: 3, thing: "balloon", pool: 6 }]);
  await expect(page.locator("#prompt")).toHaveText("Show me 3 balloons");
  await expect(page.locator("#basketWrap")).toBeVisible();
  await obj(page, 0).click();
  await obj(page, 4).click();
  await expect(basket(page)).toHaveCount(2);
  await expect(obj(page, 0)).toHaveClass(/gone/);
  await basket(page).first().click(); // take the first one back out
  await expect(basket(page)).toHaveCount(1);
  await expect(obj(page, 0)).not.toHaveClass(/gone/);
  await expect.poll(() => spoken(page)).toEqual(["one", "two", "one"]);
});

test("Show me: too few or too many asks to count again; exactly right scores a star", async ({ page }) => {
  await setDeck(page, [{ type: "show", n: 2, thing: "fish", pool: 5 }]);
  await obj(page, 0).click();
  await page.locator("#checkBtn").click(); // too few
  await expect(page.locator("#msg")).toHaveText("Let's count again!");
  await expect(page.locator("#basket")).toHaveClass(/wobble/);
  await expect(page.locator("#stars")).toHaveText("⭐ 0");
  await expect.poll(async () => (await spoken(page)).slice(1)).toEqual(["Let's count again!", "one", "Show me", "two", "fish", "in the basket"]);

  await obj(page, 1).click();
  await obj(page, 2).click();
  await page.locator("#checkBtn").click(); // too many
  await expect(page.locator("#stars")).toHaveText("⭐ 0");

  await basket(page).last().click();
  await page.locator("#checkBtn").click(); // exactly 2
  await expect(page.locator("#stars")).toHaveText("⭐ 1");
  await expect(page.locator("#prompt")).toHaveText("2 fish!");
  await expect(page.locator("#checkBtn")).toHaveClass(/done/);
  // solved: the basket is locked
  await obj(page, 3).click();
  await expect(basket(page)).toHaveCount(2);
});

test("Help me highlights the right numeral and counts along", async ({ page }) => {
  await setDeck(page, [{ type: "how", n: 3, thing: "cookie", choices: [2, 3, 4] }]);
  await page.locator("#hintBtn").click();
  await expect(page.locator("#choices .choice.hint")).toHaveCount(1);
  await expect(choice(page, 3)).toHaveClass(/hint/);
  await expect.poll(() => spoken(page)).toEqual(["one", "two", "three"]);
});

test("Help me in Show me points at the next step", async ({ page }) => {
  await setDeck(page, [{ type: "show", n: 1, thing: "apple", pool: 4 }]);
  await page.locator("#hintBtn").click();
  await expect(page.locator("#msg")).toHaveText("Put an apple in the basket!");
  await expect(page.locator("#stage .obj.hint")).toHaveCount(1);
  // hinted things pulse, so clicks don't wait for them to stand still
  await obj(page, 0).click({ force: true });
  await obj(page, 1).click({ force: true });
  await page.locator("#hintBtn").click();
  await expect(page.locator("#msg")).toHaveText("Take an apple out!");
  await expect(page.locator("#basket .obj.hint")).toHaveCount(1);
  await basket(page).last().click({ force: true });
  await page.locator("#hintBtn").click();
  await expect(page.locator("#checkBtn")).toHaveClass(/hint/);
});

test("a hint appears by itself after 10 seconds", async ({ page }) => {
  await page.clock.install();
  await page.reload();
  await page.waitForFunction(() => typeof deck !== "undefined" && deck.length > 0);
  await expect(page.locator(".hint")).toHaveCount(0);
  await page.clock.fastForward(10_500);
  await expect(page.locator(".hint")).toHaveCount(1);
});

test("finishing a full round shows the score and Play again restarts", async ({ page }) => {
  test.slow();
  for (let i = 0; i < 5; i++) {
    const q = await current(page);
    if (q.type === "how") await choice(page, q.n).click();
    else {
      for (let j = 0; j < q.n; j++) await obj(page, j).click();
      await page.locator("#checkBtn").click();
    }
    await expect(page.locator("#stars")).toHaveText(`⭐ ${i + 1}`);
    await page.locator("#next").click();
  }
  await expect(page.locator("#msg")).toHaveText(/^You got 5 of 5 right!/);
  await expect(page.locator("#next")).toHaveAttribute("aria-label", "Play again");
  await expect(page.locator("#sayBtn")).toBeDisabled();
  await expect.poll(() => spoken(page)).toContain("Great counting! You are a super star!");
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

test("swipe left goes to the next question, swipe right goes back", async ({ page, isMobile }) => {
  test.skip(!isMobile, "touch only");
  await swipe(page, -150);
  expect((await current(page)).index).toBe(1);
  await swipe(page, 150);
  expect((await current(page)).index).toBe(0);
});

test("settings: game type, number range and round size each start a new game", async ({ page }) => {
  const chip = (g, v) => page.locator(`.chip[data-group="${g}"][data-val="${v}"]`);
  await page.locator("#settingsBtn").click();

  await chip("round", 10).click();
  await expect(page.locator("#progress .dot")).toHaveCount(10);
  await expect(chip("round", 10)).toHaveAttribute("aria-pressed", "true");
  await expect(chip("round", 5)).toHaveAttribute("aria-pressed", "false");

  await chip("range", 5).click();
  expect(await page.evaluate(() => deck.every((q) => q.n <= 5))).toBe(true);

  await chip("mode", "show").click();
  expect(await page.evaluate(() => deck.every((q) => q.type === "show"))).toBe(true);
  await expect(page.locator("#checkBtn")).toBeVisible();

  await chip("mode", "how").click();
  expect(await page.evaluate(() => deck.every((q) => q.type === "how"))).toBe(true);
  await expect(page.locator("#basketWrap")).toBeHidden();

  await page.locator("h1").click();
  await expect(page.locator("#setup")).not.toHaveClass(/open/);
});

test("no missing audio (404) during play in either voice; no clip requests while clips aren't recorded", async ({ page }) => {
  const bad = [];
  page.on("response", (r) => { if (r.status() >= 400) bad.push(r.url()); });
  await setDeck(page, [{ type: "how", n: 2 }, { type: "show", n: 2 }]);
  await choice(page, 1).click();
  await choice(page, 2).click();
  await page.locator("#settingsBtn").click();
  await page.locator("#voice").selectOption("boy");
  await page.keyboard.press("Escape");
  await page.locator("#next").click();
  await obj(page, 0).click();
  await page.locator("#checkBtn").click();
  await page.waitForTimeout(300);
  const played = await playedClips(page);
  if (!(await page.evaluate(() => CLIPS_RECORDED))) expect(played).toEqual([]);
  else {
    // play() is stubbed, so nothing is fetched: check each clip the game asked for exists on disk
    expect(played.some((p) => p.includes("/audio-m/"))).toBe(true);
    expect(played.filter((p) => !clipExists(p))).toEqual([]);
  }
  expect(bad).toEqual([]);
  expect((await spoken(page)).length).toBeGreaterThan(3);
});

test("with recorded clips, the built-in voices play the right files from audio/ and audio-m/", async ({ page }) => {
  await page.evaluate(() => { CLIPS_RECORDED = true; });
  await setDeck(page, [{ type: "show", n: 4, thing: "bug" }]);
  await page.locator("#sayBtn").click();
  await expect.poll(() => playedClips(page)).toEqual(
    ["show-me", "n-4", "thing-bug-many", "put-in"].map((n) => `/apps/number-pals/audio/${n}.wav`)
  );
  await page.locator("#settingsBtn").click();
  await page.locator("#voice").selectOption("boy");
  await page.keyboard.press("Escape");
  // changing the voice repeats the prompt in the new voice; wait for it to finish
  await expect.poll(() => playedClips(page)).toContain("/apps/number-pals/audio-m/put-in.wav");
  await page.evaluate(() => { window.__clips.length = 0; });
  await obj(page, 0).click();
  await expect.poll(() => playedClips(page)).toEqual(["/apps/number-pals/audio-m/n-1.wav"]);
});

test("a clip that fails to play falls back to the device voice", async ({ page }) => {
  await openApp(page, "number-pals", { seed: 5, failClips: true });
  await page.evaluate(() => { CLIPS_RECORDED = true; });
  await setDeck(page, [{ type: "how", n: 2, thing: "car" }]);
  await obj(page, 0).click();
  await expect.poll(() => page.evaluate(() => window.__spoken.slice())).toEqual(["one"]);
  expect(await playedClips(page)).toEqual(["/apps/number-pals/audio/n-1.wav"]);
});

// The ◀ ▶ arrows are fixed on screen; nothing a child taps may sit under them, even on small phones.
for (const [w, h] of [[320, 568], [360, 740], [412, 915], [1280, 720]]) {
  test(`at ${w}×${h} no thing, answer or button sits under the ◀ ▶ arrows`, async ({ page, isMobile }) => {
    test.skip(isMobile, "viewport set explicitly; run once");
    await page.setViewportSize({ width: w, height: h });
    const problems = [];
    for (const q of [{ type: "how", n: 10 }, { type: "show", n: 6, pool: 9, basket: 7 }]) {
      await setDeck(page, [q]);
      if (q.basket) await page.evaluate((k) => { states[0].basket = Array.from({ length: k }, (_, i) => i); renderQuestion(); }, q.basket);
      problems.push(...(await page.evaluate(() => {
        const arrows = ["back", "next"].map((id) => document.getElementById(id).getBoundingClientRect());
        const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
        return [...document.querySelectorAll("#stage .obj:not(.gone), #basket .obj, #choices button, .buttons .btn")]
          .map((e) => [e, e.getBoundingClientRect()])
          .filter(([, r]) => arrows.some((a) => hit(a, r)) || r.bottom > innerHeight || r.right > innerWidth || r.width < 44)
          .map(([e]) => `${deck[0].type}: ${e.id || e.className} ${e.getAttribute("aria-label")}`);
      })));
    }
    expect(problems).toEqual([]);
  });
}

test("the automatic hint keeps the child's own counting; it only points at the answer", async ({ page }) => {
  await page.clock.install();
  await page.reload();
  await page.waitForFunction(() => typeof deck !== "undefined" && deck.length > 0);
  await setDeck(page, [{ type: "how", n: 4, thing: "bug", choices: [3, 4, 5] }]);
  await obj(page, 3).click();
  await obj(page, 1).click();
  await page.clock.fastForward(10_500);
  await expect(choice(page, 4)).toHaveClass(/hint/);
  await expect(obj(page, 3).locator(".badge")).toHaveText("1");
  await expect(obj(page, 1).locator(".badge")).toHaveText("2");
  await expect(page.locator("#stage .badge")).toHaveCount(2);
});

test("browser shortcuts (Alt/Ctrl + key) don't move or answer", async ({ page, isMobile }) => {
  test.skip(isMobile, "keyboard is a desktop feature");
  await setDeck(page, [{ type: "how", n: 2, choices: [1, 2, 3] }, { type: "how", n: 3 }]);
  await page.keyboard.press("Control+2");
  await page.keyboard.press("Alt+ArrowRight");
  expect((await current(page)).index).toBe(0);
  await expect(page.locator("#stars")).toHaveText("⭐ 0");
});

test("finishing with no stars still gets a happy message", async ({ page }) => {
  await setDeck(page, [{ type: "how", n: 2 }]);
  await page.locator("#next").click();
  await expect(page.locator("#msg")).toHaveText("Let's play again! 🔁");
});

test("keyboard focus stays on the game after taking a thing out and after a right answer", async ({ page, isMobile }) => {
  test.skip(isMobile, "keyboard is a desktop feature");
  await setDeck(page, [{ type: "show", n: 1, thing: "car", pool: 4 }]);
  await obj(page, 2).click();
  await basket(page).first().click();
  await expect(obj(page, 2)).toBeFocused();
  await setDeck(page, [{ type: "how", n: 2, choices: [1, 2, 3] }]);
  await choice(page, 2).click();
  await expect(choice(page, 2)).toBeFocused();
});
