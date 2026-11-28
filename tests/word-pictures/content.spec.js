// Content-table integrity for Word Pictures: words, phonics groups and audio clips.
const { test, expect } = require("@playwright/test");
const { openApp, missingClips } = require("../helpers");
const { allClips } = require("./clips");

let C; // content tables read from the page

test.beforeEach(async ({ page }) => {
  await openApp(page, "word-pictures");
  C = await page.evaluate(() => ({ WORDS, PHONICS, IPA_TEXT, PRAISE }));
});

test("words are unique uppercase A–Z, 2–6 letters, each with an emoji", () => {
  const ws = C.WORDS.map((x) => x.w);
  expect(new Set(ws).size).toBe(ws.length);
  for (const { w, e } of C.WORDS) {
    expect(w, w).toMatch(/^[A-Z]{2,6}$/);
    expect(e, w).toBeTruthy();
  }
});

test("every word length offered in settings has words", () => {
  for (const n of [2, 3, 4, 5, 6]) {
    expect(C.WORDS.filter((x) => x.w.length === n).length, `length ${n}`).toBeGreaterThan(0);
  }
});

test("every word has phonics and every phonics entry is a word", () => {
  const ws = C.WORDS.map((x) => x.w).sort();
  expect(Object.keys(C.PHONICS).sort()).toEqual(ws);
});

test("phonics letter counts sum to the word length and use known sounds", () => {
  for (const [w, groups] of Object.entries(C.PHONICS)) {
    const total = groups.reduce((s, [, n]) => s + n, 0);
    expect(total, `${w} letter counts`).toBe(w.length);
    for (const [k, n] of groups) {
      expect(n, `${w} group ${k}`).toBeGreaterThan(0);
      if (k !== "silent") expect(Object.keys(C.IPA_TEXT), `${w}: unknown sound "${k}"`).toContain(k);
    }
  }
});

test("every clip the game can play exists in both voices", () => {
  expect(missingClips("word-pictures", allClips(C))).toEqual([]);
});

test("scramble never returns the word unchanged when another order exists", async ({ page }) => {
  const bad = await page.evaluate(() => {
    const out = [];
    for (const { w } of WORDS) {
      if (new Set(w).size === 1) continue;
      for (let i = 0; i < 50; i++) {
        const s = scramble(w);
        if (s.join("") === w || [...s].sort().join("") !== [...w].sort().join("")) { out.push(`${w}→${s.join("")}`); break; }
      }
    }
    return out;
  });
  expect(bad).toEqual([]);
});
