// Real audio playback for Word Pictures, with the browser's real autoplay rule (a page may not play
// sound before the child touches it). Unlike the other specs, play() is NOT stubbed here: each clip
// really loads and plays, and we record whether the browser allowed it.
const { test, expect } = require("@playwright/test");

test.use({ launchOptions: { args: ["--autoplay-policy=user-gesture-required"] } });

test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) => {
    const u = new URL(route.request().url());
    return u.hostname === "127.0.0.1" ? route.continue() : route.abort();
  });
  await page.addInitScript(() => {
    window.__log = [];       // "ok w-cat" | "blocked w-cat"
    window.__players = [];   // every distinct audio element that played a clip
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      const name = new URL(this.src).pathname.split("/").pop().replace(/\.wav$/, "");
      if (!window.__players.includes(this)) window.__players.push(this);
      const p = play.call(this);
      p.then(() => window.__log.push("ok " + name), () => window.__log.push("blocked " + name));
      return p;
    };
  });
  await page.goto("/apps/word-pictures/index.html");
  await page.waitForFunction(() => typeof deck !== "undefined" && deck.length > 0);
});

const log = (page) => page.evaluate(() => window.__log.slice());
const word = (page) => page.evaluate(() => deck[index].w);

test("the word the browser blocked on open is said on the first touch", async ({ page }) => {
  const w = (await word(page)).toLowerCase();
  await expect.poll(() => log(page)).toContain("blocked w-" + w);   // no touch yet: the browser refuses
  await page.locator("#pic").click();                                // the child touches the screen
  await expect.poll(() => log(page)).toContain("ok w-" + w);
});

test("solving says the praise, every sound and the whole word through one audio element", async ({ page }) => {
  const W = await word(page);
  await page.locator("#pic").click();
  await expect.poll(() => log(page)).toContain("ok w-" + W.toLowerCase());
  for (const ch of W) await page.locator(`#tiles .tile:not(.gone)[data-letter="${ch}"]`).first().click();
  const sounds = await page.evaluate((T) => PHONICS[T].filter(([k]) => k !== "silent").map(([k]) => "ok ipa-" + k), W);
  await expect.poll(() => log(page), { timeout: 20000 }).toEqual(expect.arrayContaining(sounds));
  await expect.poll(async () => (await log(page)).filter((l) => l === "ok w-" + W.toLowerCase()).length,
    { timeout: 20000 }).toBe(2);                                    // once on the touch, once after the sounds
  expect((await log(page)).some((l) => l.startsWith("ok p-"))).toBe(true);
  expect(await page.evaluate(() => window.__players.length)).toBe(1);
});
