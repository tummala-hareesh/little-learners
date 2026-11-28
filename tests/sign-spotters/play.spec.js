// Browser play-through tests for Sign Spotters.
const { test, expect } = require("@playwright/test");
const { openApp, playedClips, clipExists, swipe } = require("../helpers");

const current = (page) =>
  page.evaluate(() => {
    if (index >= deck.length) return null;
    const q = deck[index];
    return { index, type: q.type, answer: answerOf(q), sign: q.sign && q.sign.k, ev: q.ev };
  });

/**
 * Replace the round with fixed questions:
 * { find: "stop", choices: ["stop", "walk", "no-entry"] } or { trip: "red" | "<sign key>" }.
 */
async function setDeck(page, qs) {
  await page.evaluate((qs) => {
    stopAudio();
    deck = qs.map((q) => {
      if (q.find) {
        const sign = SIGNS.find((s) => s.k === q.find);
        const choices = q.choices ? q.choices.map((k) => SIGNS.find((s) => s.k === k)) : findQuestion(sign).choices;
        return { type: "find", sign, choices };
      }
      return { type: "trip", ev: TRIP.find((e) => e.light === q.trip || e.sign === q.trip) };
    });
    states = deck.map(freshState);
    index = 0;
    renderQuestion();
    window.__spoken.length = 0;
    window.__clips.length = 0;
  }, qs);
}

/**
 * What the game said: the text of every clip played (recorded voices, in order), then device-voice
 * speech (in order). The two groups are not interleaved. With CLIPS_RECORDED the built-in voices play clips, otherwise they speak.
 */
const spoken = (page) =>
  page.evaluate(() => [
    ...window.__clips.map((p) => clipText(decodeURIComponent(p).split("/").pop().replace(/\.wav$/, ""))),
    ...window.__spoken,
  ]);
const choice = (page, v) => page.locator(`#choices .choice[data-value="${v}"]`);

test.beforeEach(async ({ page }) => {
  await openApp(page, "sign-spotters", { seed: 5 });
});

test("starts a 5-question round with a spoken prompt", async ({ page }) => {
  await expect(page.locator("#progress .dot")).toHaveCount(5);
  const q = await current(page);
  if (q.type === "find") {
    await expect(page.locator("#prompt")).toHaveText(/^Find the .+!$/);
    await expect(page.locator("#choices .choice.sign")).toHaveCount(3);
    await expect.poll(() => spoken(page)).toContain("Find the");
  } else {
    await expect(page.locator("#prompt")).toHaveText(/What does the car do\?$/);
    await expect(page.locator("#choices .choice.act")).toHaveCount(3);
    await expect.poll(() => spoken(page)).toContain("What does the car do?");
  }
  await expect(page.locator("#back")).toBeDisabled();
});

test("Find the sign: signs are pictures labelled with their names", async ({ page }) => {
  await setDeck(page, [{ find: "stop", choices: ["walk", "stop", "no-entry"] }]);
  await expect(page.locator("#prompt")).toHaveText("Find the stop sign!");
  await expect(page.locator("#choices .choice")).toHaveCount(3);
  await expect(choice(page, "stop")).toHaveAttribute("aria-label", "stop sign");
  await expect(choice(page, "no-entry")).toHaveAttribute("aria-label", "no entry sign");
  await expect(choice(page, "stop").locator("svg polygon")).toHaveCount(2);
});

test("Find the sign: the right sign scores a star and says its name, shape and meaning", async ({ page }) => {
  await setDeck(page, [{ find: "stop", choices: ["walk", "stop", "no-entry"] }, { find: "walk" }]);
  await page.locator("#sayBtn").click();
  await expect.poll(() => spoken(page)).toEqual(["Find the", "stop sign"]);
  await page.evaluate(() => { window.__spoken.length = 0; window.__clips.length = 0; });
  await choice(page, "stop").click();
  await expect(choice(page, "stop")).toHaveClass(/done/);
  await expect(page.locator("#stars")).toHaveText("⭐ 1");
  await expect(page.locator("#prompt")).toHaveText("Stop sign!");
  await expect(page.locator("#msg")).toHaveText(/ It's an octagon\. Stop!$/);
  await expect(page.locator("#progress .dot.on")).toHaveCount(1);
  await expect.poll(async () => (await spoken(page)).slice(1)).toEqual(["stop sign", "It's an", "octagon", "Stop!"]);
});

test("Find the sign: a wrong sign wobbles and says Let's look again, never Wrong", async ({ page }) => {
  await setDeck(page, [{ find: "school", choices: ["school", "stop", "crossing"] }]);
  await choice(page, "crossing").click();
  await expect(choice(page, "crossing")).toHaveClass(/wobble/);
  await expect(page.locator("#msg")).toHaveText("Let's look again!");
  await expect(page.locator("#stars")).toHaveText("⭐ 0");
  await expect.poll(() => spoken(page)).toEqual(["Let's look again!", "Find the", "school sign"]);
  await choice(page, "school").click();
  await expect(page.locator("#stars")).toHaveText("⭐ 1");
  await expect(page.locator("#msg")).toHaveText(/It's a triangle\. Be careful!$/);
  // tapping again after solving changes nothing
  await choice(page, "stop").click();
  await expect(choice(page, "stop")).not.toHaveClass(/wobble/);
  await expect(page.locator("body")).not.toContainText(/wrong/i);
});

test("Road trip: a red light, the car stops", async ({ page }) => {
  await setDeck(page, [{ trip: "red" }, { trip: "green" }]);
  await expect(page.locator("#prompt")).toHaveText("Red light! What does the car do?");
  await expect(page.locator("#road")).toBeVisible();
  await expect(page.locator("#choices .choice")).toHaveText(["🛑Stop", "🐢Slow down", "✅Go"]);
  await choice(page, "stop").click();
  await expect(page.locator("#car")).toHaveClass("stopped");
  await expect(page.locator("#prompt")).toHaveText("Red light! Stop!");
  await expect(page.locator("#stars")).toHaveText("⭐ 1");
  await expect.poll(async () => (await spoken(page)).slice(1)).toEqual(["Red light", "Stop!"]);
});

test("Road trip: a green light, the car drives on; a school sign, it slows down", async ({ page }) => {
  await setDeck(page, [{ trip: "green" }, { trip: "school" }]);
  await choice(page, "go").click();
  await expect(page.locator("#car")).toHaveClass("gone");
  await page.locator("#next").click();
  await expect(page.locator("#prompt")).toHaveText("School sign! What does the car do?");
  await choice(page, "go").click();
  await expect(page.locator("#msg")).toHaveText("Let's look again!");
  await expect(page.locator("#car")).not.toHaveClass(/gone|slow/);
  await choice(page, "slow").click();
  await expect(page.locator("#car")).toHaveClass("slow");
  await expect(page.locator("#stars")).toHaveText("⭐ 2");
});

test("Road trip: at a walk sign the car stops and Teddy crosses with a grown-up", async ({ page }) => {
  await setDeck(page, [{ trip: "walk" }]);
  await expect(page.locator("#walker")).not.toHaveClass(/cross/);
  await choice(page, "stop").click();
  await expect(page.locator("#car")).toHaveClass("stopped");
  await expect(page.locator("#walker")).toHaveClass("cross");
  await expect(page.locator("#msg")).toContainText("Teddy crosses with a grown-up. Look and listen!");
  await expect.poll(() => spoken(page)).toContain("Teddy crosses with a grown-up. Look and listen!");
});

test("Road trip with reduced motion: the car jumps straight to where it ends up", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await setDeck(page, [{ trip: "green" }]);
  await choice(page, "go").click();
  const left = await page.evaluate(() => {
    const car = document.getElementById("car"), road = document.getElementById("road");
    return car.getBoundingClientRect().left - road.getBoundingClientRect().right;
  });
  expect(left).toBeGreaterThan(0); // already past the end of the road, no drive animation
});

test("a solved Road trip question shows the car where it ended when you come back", async ({ page }) => {
  await setDeck(page, [{ trip: "stop" }, { trip: "green" }]);
  await choice(page, "stop").click();
  await page.locator("#next").click();
  await page.locator("#back").click();
  await expect(page.locator("#car")).toHaveClass("stopped");
  await expect(choice(page, "stop")).toHaveClass(/done/);
});

test("keys: S and G answer Road trip, 1–3 pick a sign", async ({ page, isMobile }) => {
  test.skip(isMobile, "keyboard is a desktop feature");
  await setDeck(page, [{ trip: "red" }, { trip: "green" }, { find: "no-entry", choices: ["stop", "walk", "no-entry"] }]);
  await page.keyboard.press("g");
  await expect(page.locator("#msg")).toHaveText("Let's look again!");
  await page.keyboard.press("s");
  await expect(page.locator("#stars")).toHaveText("⭐ 1");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("G");
  await expect(page.locator("#stars")).toHaveText("⭐ 2");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("s"); // not a Road trip question: nothing happens
  await expect(page.locator("#msg")).toHaveText("Tap the sign!");
  await page.keyboard.press("3");
  await expect(page.locator("#stars")).toHaveText("⭐ 3");
});

test("Up/Down move focus through the answers; Enter taps", async ({ page, isMobile }) => {
  test.skip(isMobile, "keyboard is a desktop feature");
  await setDeck(page, [{ find: "walk", choices: ["walk", "stop", "no-entry"] }]);
  await page.keyboard.press("ArrowDown");
  await expect(choice(page, "walk")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(choice(page, "stop")).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  await expect(page.locator("#stars")).toHaveText("⭐ 1");
  await expect(choice(page, "walk")).toBeFocused();
});

test("Help me highlights the right answer and repeats the question", async ({ page }) => {
  await setDeck(page, [{ find: "give-way", choices: ["stop", "give-way", "walk"] }, { trip: "yellow" }]);
  await page.locator("#hintBtn").click();
  await expect(choice(page, "give-way")).toHaveClass(/hint/);
  await expect(page.locator("#choices .hint")).toHaveCount(1);
  await expect(page.locator("#msg")).toHaveText("Look for the triangle!");
  await expect.poll(() => spoken(page)).toEqual(["Find the", "give way sign"]);
  await page.locator("#next").click();
  await page.locator("#hintBtn").click();
  await expect(choice(page, "slow")).toHaveClass(/hint/);
});

test("a hint appears by itself after 10 seconds", async ({ page }) => {
  await page.clock.install();
  await page.reload();
  await page.waitForFunction(() => typeof deck !== "undefined" && deck.length > 0);
  await expect(page.locator(".hint")).toHaveCount(0);
  await page.clock.fastForward(10_500);
  await expect(page.locator(".hint")).toHaveCount(1);
});

test("finishing a full round shows the score, points outside, and Play again restarts", async ({ page }) => {
  test.slow();
  for (let i = 0; i < 5; i++) {
    const q = await current(page);
    await choice(page, q.answer).click();
    await expect(page.locator("#stars")).toHaveText(`⭐ ${i + 1}`);
    await page.locator("#next").click();
  }
  await expect(page.locator("#msg")).toHaveText(/^You got 5 of 5 right!/);
  await expect(page.locator("#finish")).toContainText("Can you find a stop sign outside, with a grown-up?");
  await expect(page.locator("#next")).toHaveAttribute("aria-label", "Play again");
  await expect(page.locator("#sayBtn")).toBeDisabled();
  await expect.poll(() => spoken(page)).toContain("Great spotting! Can you find a stop sign outside, with a grown-up?");
  await page.locator("#next").click();
  expect((await current(page)).index).toBe(0);
  await expect(page.locator("#stars")).toHaveText("⭐ 0");
});

test("finishing with no stars still gets a happy message", async ({ page }) => {
  await setDeck(page, [{ trip: "red" }]);
  await page.locator("#next").click();
  await expect(page.locator("#msg")).toHaveText("Let's play again! 🔁");
});

test("arrow keys move between questions", async ({ page, isMobile }) => {
  test.skip(isMobile, "keyboard is a desktop feature");
  await page.keyboard.press("ArrowRight");
  expect((await current(page)).index).toBe(1);
  await page.keyboard.press("ArrowLeft");
  expect((await current(page)).index).toBe(0);
});

test("browser shortcuts (Alt/Ctrl + key) don't move or answer", async ({ page, isMobile }) => {
  test.skip(isMobile, "keyboard is a desktop feature");
  await setDeck(page, [{ trip: "red" }, { trip: "green" }]);
  await page.keyboard.press("Control+s");
  await page.keyboard.press("Alt+ArrowRight");
  expect((await current(page)).index).toBe(0);
  await expect(page.locator("#stars")).toHaveText("⭐ 0");
});

test("swipe left goes to the next question, swipe right goes back", async ({ page, isMobile }) => {
  test.skip(!isMobile, "touch only");
  await swipe(page, -150);
  expect((await current(page)).index).toBe(1);
  await swipe(page, 150);
  expect((await current(page)).index).toBe(0);
});

test("settings: game type and round size each start a new game; Esc closes", async ({ page }) => {
  const chip = (g, v) => page.locator(`.chip[data-group="${g}"][data-val="${v}"]`);
  await page.locator("#settingsBtn").click();
  await chip("round", 10).click();
  await expect(page.locator("#progress .dot")).toHaveCount(10);
  await expect(chip("round", 10)).toHaveAttribute("aria-pressed", "true");
  await expect(chip("round", 5)).toHaveAttribute("aria-pressed", "false");

  await chip("mode", "trip").click();
  expect(await page.evaluate(() => deck.every((q) => q.type === "trip"))).toBe(true);
  expect(await page.evaluate(() => !!deck[0].ev.light)).toBe(true); // each trip opens with a light
  await expect(page.locator("#road")).toBeVisible();

  await chip("mode", "find").click();
  expect(await page.evaluate(() => deck.every((q) => q.type === "find"))).toBe(true);
  await expect(page.locator("#road")).toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(page.locator("#setup")).not.toHaveClass(/open/);
  await expect(page.locator("#settingsBtn")).toHaveAttribute("aria-expanded", "false");
});

test("no missing audio (404) during play in either voice; no clip requests while clips aren't recorded", async ({ page }) => {
  const bad = [];
  page.on("response", (r) => { if (r.status() >= 400) bad.push(r.url()); });
  await setDeck(page, [{ find: "stop", choices: ["stop", "walk", "no-entry"] }, { trip: "walk" }]);
  await choice(page, "walk").click();
  await choice(page, "stop").click();
  await page.locator("#settingsBtn").click();
  await page.locator("#voice").selectOption("boy");
  await page.keyboard.press("Escape");
  await page.locator("#next").click();
  await choice(page, "stop").click();
  await page.waitForTimeout(300);
  const played = await playedClips(page);
  if (!(await page.evaluate(() => CLIPS_RECORDED))) expect(played).toEqual([]);
  else {
    // play() is stubbed, so nothing is fetched: check each clip the game asked for exists on disk
    expect(played.some((p) => p.includes("/audio/"))).toBe(true);
    expect(played.some((p) => p.includes("/audio-m/"))).toBe(true);
    expect(played.filter((p) => !clipExists(p))).toEqual([]);
  }
  expect(bad).toEqual([]);
  expect((await spoken(page)).length).toBeGreaterThan(3);
});

test("with recorded clips, the built-in voices play the right files from audio/ and audio-m/", async ({ page }) => {
  await page.evaluate(() => { CLIPS_RECORDED = true; });
  await setDeck(page, [{ trip: "road-works" }]);
  await page.locator("#sayBtn").click();
  await expect.poll(() => playedClips(page)).toEqual(
    ["sign-road-works", "what-do"].map((n) => `/apps/sign-spotters/audio/${n}.wav`)
  );
  await page.locator("#settingsBtn").click();
  await page.locator("#voice").selectOption("boy");
  await page.keyboard.press("Escape");
  await expect.poll(() => playedClips(page)).toContain("/apps/sign-spotters/audio-m/what-do.wav");
});

test("a clip that fails to play falls back to the device voice", async ({ page }) => {
  await openApp(page, "sign-spotters", { seed: 5, failClips: true });
  await page.evaluate(() => { CLIPS_RECORDED = true; });
  await setDeck(page, [{ trip: "red" }]);
  await page.locator("#sayBtn").click();
  await expect.poll(() => page.evaluate(() => window.__spoken.slice())).toEqual(["Red light", "What does the car do?"]);
});

// The ◀ ▶ arrows are fixed on screen; nothing a child taps may sit under them, even on small phones.
for (const [w, h] of [[320, 568], [360, 740], [412, 915], [1280, 720]]) {
  test(`at ${w}×${h} no sign, answer or button sits under the ◀ ▶ arrows`, async ({ page, isMobile }) => {
    test.skip(isMobile, "viewport set explicitly; run once");
    await page.setViewportSize({ width: w, height: h });
    const problems = [];
    for (const q of [{ find: "road-works", choices: ["road-works", "stop", "traffic-light"] }, { trip: "walk" }]) {
      await setDeck(page, [q]);
      problems.push(...(await page.evaluate(() => {
        const arrows = ["back", "next"].map((id) => document.getElementById(id).getBoundingClientRect());
        const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
        return [...document.querySelectorAll("#road, #choices button, .buttons .btn")]
          .map((e) => [e, e.getBoundingClientRect()])
          .filter(([, r]) => arrows.some((a) => hit(a, r)) || r.bottom > innerHeight || r.right > innerWidth || r.width < 44 || r.height < 44)
          .map(([e]) => `${deck[0].type}: ${e.id || e.className} ${e.getAttribute("aria-label")}`);
      })));
    }
    expect(problems).toEqual([]);
  });
}
