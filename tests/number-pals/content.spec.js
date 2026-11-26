// Content-table integrity and question generation for Number Pals.
const { test, expect } = require("@playwright/test");
const { openApp, missingClips } = require("../helpers");

let C;

test.beforeEach(async ({ page }) => {
  await openApp(page, "number-pals");
  C = await page.evaluate(() => ({ NUMBERS, THINGS, PRAISE, PHRASES, DEVICE_PHRASES, CLIPS_RECORDED }));
});

/** Every clip name the game can play, derived from the content tables. */
function allClips() {
  const names = new Set([...Object.keys(C.PHRASES), ...Object.keys(C.DEVICE_PHRASES)]);
  C.PRAISE.forEach((_, i) => names.add(`p-${i}`));
  for (const x of C.NUMBERS) names.add(`n-${x.n}`);
  for (const t of C.THINGS) { names.add(`thing-${t.k}-one`); names.add(`thing-${t.k}-many`); }
  return [...names];
}

test("numbers are 1 to 10 in order, each with an UPPERCASE word of 2–6 letters", () => {
  expect(C.NUMBERS.map((x) => x.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  expect(C.NUMBERS.map((x) => x.w)).toEqual(["ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE", "TEN"]);
  for (const x of C.NUMBERS) expect(x.w).toMatch(/^[A-Z]{2,6}$/);
});

test("things have unique keys, a singular and plural name, and an emoji", () => {
  expect(C.THINGS.length).toBeGreaterThanOrEqual(8);
  const keys = C.THINGS.map((t) => t.k);
  expect(new Set(keys).size).toBe(keys.length);
  for (const t of C.THINGS) {
    expect(t.k, JSON.stringify(t)).toMatch(/^[a-z]+$/);
    expect(t.one, t.k).toBeTruthy();
    expect(t.many, t.k).toBeTruthy();
    expect(t.e, t.k).toBeTruthy();
  }
});

test("five praise lines, one per p-<i> clip", () => {
  expect(C.PRAISE.length).toBe(5);
});

test("every clip has text for the device voices", async ({ page }) => {
  const empty = await page.evaluate((names) => names.filter((n) => !clipText(n)), allClips());
  expect(empty).toEqual([]);
  const texts = await page.evaluate(() => [clipText("n-3"), clipText("thing-bug-one"), clipText("thing-fish-many"), clipText("p-0")]);
  expect(texts).toEqual(["three", "bug", "fish", C_PRAISE0()]);
  function C_PRAISE0() { return C.PRAISE[0]; }
});

// Recorded clips are the product; until both voices are recorded the built-in voices use the device
// voice. CLIPS_RECORDED must say which: true needs every clip, and a full set means flip it to true.
test("clips exist in both voices, or CLIPS_RECORDED says they aren't recorded yet", () => {
  const missing = missingClips("number-pals", allClips());
  if (C.CLIPS_RECORDED) expect(missing).toEqual([]);
  else expect(missing.length, "every clip exists: set CLIPS_RECORDED = true").toBeGreaterThan(0);
});

test("generated questions are always answerable, for every mode and range", async ({ page }) => {
  const problems = await page.evaluate(() => {
    const out = [];
    for (const m of ["how", "show", "both"]) {
      for (const r of [5, 10]) {
        mode = m; rangeMax = r;
        const seen = new Set();
        for (let i = 0; i < 400; i++) {
          const q = makeQuestion();
          const tag = `${m}/${r} ${q.type} ${q.n}`;
          seen.add(q.type);
          if (m !== "both" && q.type !== m) out.push(`${tag}: wrong type`);
          if (!(q.n >= 1 && q.n <= r)) out.push(`${tag}: out of range`);
          if (!THINGS.includes(q.thing)) out.push(`${tag}: unknown thing`);
          if (q.type === "how") {
            if (q.choices.length !== CHOICES) out.push(`${tag}: ${q.choices.length} choices`);
            if (new Set(q.choices).size !== q.choices.length) out.push(`${tag}: duplicate choices`);
            if (!q.choices.includes(q.n)) out.push(`${tag}: answer missing`);
            if (q.choices.some((c) => c < 1 || c > r)) out.push(`${tag}: choice out of range`);
            if (q.choices.join() !== [...q.choices].sort((a, b) => a - b).join()) out.push(`${tag}: not in order`);
          } else if (!(q.pool >= q.n && q.pool <= 10)) out.push(`${tag}: pool ${q.pool}`);
        }
        if (m === "both" && seen.size !== 2) out.push(`both/${r}: only ${[...seen]}`);
      }
    }
    return [...new Set(out)].slice(0, 20);
  });
  expect(problems).toEqual([]);
});

test("shown text uses the singular for 1 and the plural otherwise, for every thing", async ({ page }) => {
  const lines = await page.evaluate(() => {
    const out = [];
    for (const t of THINGS) {
      for (const n of [1, 2]) {
        deck = [{ type: "show", n, thing: t, pool: n + 3 }];
        states = [freshState()];
        index = 0;
        renderQuestion();
        const ask = document.getElementById("prompt").textContent;
        states[0].solved = true;
        renderQuestion();
        out.push({ t: t.k, n, ask, done: document.getElementById("prompt").textContent, one: t.one, many: t.many });
      }
    }
    return out;
  });
  for (const l of lines) {
    const word = l.n === 1 ? l.one : l.many;
    expect(l.ask, l.t).toBe(`Show me ${l.n} ${word}`);
    expect(l.done, l.t).toBe(`${l.n} ${word}!`);
  }
});
