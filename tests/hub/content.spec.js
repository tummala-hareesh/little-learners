// Registry integrity for the Playroom hub: APPS ↔ app folders ↔ name clips.
const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");
const { openHub, ROOT } = require("../helpers");

let registry; // the page's APPS table

test.beforeEach(async ({ page }) => {
  await openHub(page);
  registry = await page.evaluate(() => APPS);
});

test("every entry has the fields the hub and grown-ups corner need", () => {
  expect(registry.length).toBeGreaterThan(0);
  for (const a of registry) {
    for (const k of ["id", "href", "e", "name", "say", "ages", "skills"]) {
      expect(a[k], `${a.id}.${k}`).toBeTruthy();
    }
    expect(a.id, a.id).toMatch(/^[a-z0-9-]+$/);
  }
  const ids = registry.map((a) => a.id);
  expect(new Set(ids).size).toBe(ids.length);
});

test("every entry points at its own app folder's index.html (works from file:// too)", () => {
  for (const a of registry) {
    expect(a.href, a.id).toBe(`apps/${a.id}/index.html`);
    expect(fs.existsSync(path.join(ROOT, a.href)), `${a.href} exists`).toBe(true);
  }
});

test("every app folder on disk has a registry entry", () => {
  const folders = fs
    .readdirSync(path.join(ROOT, "apps"), { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(ROOT, "apps", d.name, "index.html")))
    .map((d) => d.name)
    .sort();
  expect(registry.map((a) => a.id).sort()).toEqual(folders);
});

test("tile emoji are pictures, not letters (pre-readers read pictures)", () => {
  const letterish = /[A-Za-z0-9]|[\u{1F520}-\u{1F524}\u{1F170}-\u{1F189}]/u;
  for (const a of registry) expect(letterish.test(a.e), `${a.id} emoji ${a.e}`).toBe(false);
});

test("name clips exist in both voices unless the entry says clips: false", () => {
  const problems = [];
  for (const a of registry) {
    const files = ["audio", "audio-m"].map((d) => path.join(ROOT, "hub", d, `app-${a.id}.wav`));
    const present = files.filter((f) => fs.existsSync(f));
    if (a.clips === false) {
      if (present.length === 2) problems.push(`${a.id}: both clips exist — remove "clips: false"`);
    } else if (present.length !== 2) {
      problems.push(`${a.id}: missing ${files.filter((f) => !fs.existsSync(f)).map((f) => path.relative(ROOT, f)).join(", ")}`);
    }
  }
  expect(problems).toEqual([]);
});
