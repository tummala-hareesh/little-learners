// Content-table integrity, safety wording and question generation for Sign Spotters.
const { test, expect } = require("@playwright/test");
const { openApp, missingClips } = require("../helpers");

let C;

test.beforeEach(async ({ page }) => {
  await openApp(page, "sign-spotters");
  C = await page.evaluate(() => ({
    SHAPES, MEANINGS, SIGNS, LIGHTS, TRIP, ACTIONS, PRAISE, PHRASES, DEVICE_PHRASES, CLIPS_RECORDED,
    art: Object.keys(SIGN_ART),
  }));
});

/** Every clip name the game can play, derived from the content tables. */
function allClips() {
  const names = new Set([...Object.keys(C.PHRASES), ...Object.keys(C.DEVICE_PHRASES)]);
  C.PRAISE.forEach((_, i) => names.add(`p-${i}`));
  for (const s of C.SIGNS) names.add(`sign-${s.k}`);
  for (const m of C.MEANINGS) names.add(`mean-${m.k}`);
  for (const l of C.LIGHTS) names.add(`light-${l.k}`);
  for (const s of C.SHAPES) names.add(`shape-${s}`);
  return [...names];
}

test("signs have unique keys, a known shape and meaning, and a picture", () => {
  expect(C.SIGNS.length).toBeGreaterThanOrEqual(8);
  const keys = C.SIGNS.map((s) => s.k);
  expect(new Set(keys).size).toBe(keys.length);
  const meanings = C.MEANINGS.map((m) => m.k);
  for (const s of C.SIGNS) {
    expect(s.k, JSON.stringify(s)).toMatch(/^[a-z-]+$/);
    expect(s.say, s.k).toMatch(/^[a-z ]+$/);
    expect(C.SHAPES, s.k).toContain(s.shape);
    expect(meanings, s.k).toContain(s.means);
    expect(s.color, s.k).toBeTruthy();
    expect(C.art, s.k).toContain(s.k);
  }
  expect(C.art.sort()).toEqual(keys.sort());
});

test("every sign is drawn as an SVG with real shapes (no emoji)", async ({ page }) => {
  const out = await page.evaluate(() => SIGNS.map((s) => {
    const d = document.createElement("div");
    d.innerHTML = signSVG(s.k);
    return { k: s.k, svg: !!d.querySelector("svg[viewBox='0 0 100 100']"), shapes: d.querySelectorAll("polygon, rect, circle, path").length, text: d.textContent };
  }));
  for (const o of out) {
    expect(o.svg, o.k).toBe(true);
    expect(o.shapes, o.k).toBeGreaterThan(0);
    expect(o.text, o.k).toMatch(/^(STOP)?$/);
  }
});

test("the stop sign is really an octagon", async ({ page }) => {
  const n = await page.evaluate(() => octagon(48).split(" ").length);
  expect(n).toBe(8);
});

test("meanings have unique keys, a button label, an emoji and a spoken line", () => {
  const keys = C.MEANINGS.map((m) => m.k);
  expect(new Set(keys).size).toBe(keys.length);
  for (const m of C.MEANINGS) {
    expect(m.k).toMatch(/^[a-z-]+$/);
    expect(m.say, m.k).toBeTruthy();
    expect(m.e, m.k).toBeTruthy();
    expect(m.line, m.k).toMatch(/[.!?]$/);
  }
  expect(C.ACTIONS).toEqual(["stop", "slow", "go"]);
  for (const a of C.ACTIONS) expect(keys).toContain(a);
});

test("every Road trip event names a real sign or light and a car action; every light is used", () => {
  const signs = C.SIGNS.map((s) => s.k);
  for (const e of C.TRIP) {
    expect(!!e.sign !== !!e.light, JSON.stringify(e)).toBe(true);
    if (e.sign) expect(signs).toContain(e.sign);
    else expect(C.LIGHTS.map((l) => l.k)).toContain(e.light);
    expect(C.ACTIONS).toContain(e.act);
  }
  const lights = Object.fromEntries(C.TRIP.filter((e) => e.light).map((e) => [e.light, e.act]));
  expect(lights).toEqual({ red: "stop", yellow: "slow", green: "go" });
  expect(C.TRIP.find((e) => e.sign === "stop").act).toBe("stop");
});

// Safety first: never teach a child to cross alone or in a hurry.
test("every line about crossing mentions a grown-up and looking or listening; none says run", async ({ page }) => {
  const lines = await page.evaluate((names) => names.map((n) => [n, clipText(n)]), allClips());
  const crossing = lines.filter(([, t]) => /\bcross(es)?\b|\bacross\b/i.test(t));
  expect(crossing.length).toBeGreaterThanOrEqual(3);
  for (const [n, t] of crossing) {
    expect(t, n).toMatch(/grown-up/);
    expect(t, n).toMatch(/\blook\b|\blisten\b/i);
  }
  for (const [n, t] of lines) expect(t, n).not.toMatch(/\b(run|hurry|quick(ly)?|alone)\b/i);
});

test("five praise lines, one per p-<i> clip", () => {
  expect(C.PRAISE.length).toBe(5);
});

test("every clip has text for the device voices", async ({ page }) => {
  const empty = await page.evaluate((names) => names.filter((n) => !clipText(n)), allClips());
  expect(empty).toEqual([]);
  const texts = await page.evaluate(() => [clipText("sign-stop"), clipText("shape-octagon"), clipText("mean-stop"), clipText("light-red")]);
  expect(texts).toEqual(["stop sign", "octagon", "Stop!", "Red light"]);
});

// Recorded clips are the product; until both voices are recorded the built-in voices use the device
// voice. CLIPS_RECORDED must say which: true needs every clip, and a full set means flip it to true.
test("clips exist in both voices, or CLIPS_RECORDED says they aren't recorded yet", () => {
  const missing = missingClips("sign-spotters", allClips());
  if (C.CLIPS_RECORDED) expect(missing).toEqual([]);
  else expect(missing.length, "every clip exists: set CLIPS_RECORDED = true").toBeGreaterThan(0);
});

test("every clip the game can ask for is in the content tables", async ({ page }) => {
  const asked = await page.evaluate(() => {
    const out = new Set(["great"]);
    for (const sign of SIGNS) {
      const q = findQuestion(sign);
      [...promptClips(q), ...answerClips(q)].forEach((c) => out.add(c));
    }
    for (const ev of TRIP) [...promptClips({ type: "trip", ev }), ...answerClips({ type: "trip", ev })].forEach((c) => out.add(c));
    PRAISE.forEach((_, i) => out.add(`p-${i}`));
    out.add("look-again");
    return [...out];
  });
  const known = new Set(allClips());
  expect(asked.filter((c) => !known.has(c))).toEqual([]);
});

test("generated rounds are always answerable, for every mode and size", async ({ page }) => {
  const problems = await page.evaluate(() => {
    const out = [];
    for (const m of ["find", "trip", "both"]) {
      for (const size of [3, 5, 10]) {
        const seen = new Set();
        for (let r = 0; r < 60; r++) {
          mode = m;
          const d = makeDeck(size);
          if (d.length !== size) out.push(`${m}/${size}: ${d.length} questions`);
          const firstTrip = d.find((q) => q.type === "trip");
          if (firstTrip && !firstTrip.ev.light) out.push(`${m}/${size}: trip doesn't open with a light`);
          const finds = d.filter((q) => q.type === "find").map((q) => q.sign.k);
          if (finds.length <= SIGNS.length && new Set(finds).size !== finds.length) out.push(`${m}/${size}: repeated sign`);
          for (const q of d) {
            seen.add(q.type);
            if (m !== "both" && q.type !== m) out.push(`${m}: wrong type`);
            if (q.type === "find") {
              if (q.choices.length !== CHOICES) out.push(`${q.sign.k}: ${q.choices.length} choices`);
              if (new Set(q.choices.map((s) => s.k)).size !== CHOICES) out.push(`${q.sign.k}: duplicate choices`);
              if (!q.choices.includes(q.sign)) out.push(`${q.sign.k}: answer missing`);
              if (q.choices.filter((s) => s.shape === q.sign.shape).length !== 1) out.push(`${q.sign.k}: another sign has its shape`);
            } else if (!TRIP.includes(q.ev)) out.push("unknown trip event");
          }
        }
        if (m === "both" && size === 10 && seen.size !== 2) out.push(`both: only ${[...seen]}`);
      }
    }
    return [...new Set(out)].slice(0, 20);
  });
  expect(problems).toEqual([]);
});

test("the answer line uses the right article for every shape", async ({ page }) => {
  const lines = await page.evaluate(() => SIGNS.map((s) => [s.shape, answerText({ type: "find", sign: s })]));
  for (const [shape, line] of lines) {
    const a = /^[aeiou]/.test(shape) ? "an" : "a";
    expect(line).toMatch(new RegExp(`^It's ${a} ${shape}\\. `));
  }
  expect(lines.find(([s]) => s === "octagon")[1]).toBe("It's an octagon. Stop!");
});
