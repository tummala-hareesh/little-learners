// The public site that GitHub Pages serves is assembled by tools/build-site.sh.
// These tests build it into a temp folder and check it contains exactly the site, and that it works.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { test, expect } = require("@playwright/test");
const { prepare, ROOT } = require("../helpers");

const ALLOWED_TOP = new Set(["index.html", "apps", "hub", ".nojekyll"]);

function buildSite() {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "ll-site-"));
  execFileSync("bash", [path.join(ROOT, "tools", "build-site.sh"), out], { stdio: "pipe" });
  return out;
}

function files(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...files(p).map((f) => path.join(e.name, f)));
    else out.push(e.name);
  }
  return out.sort();
}

test.describe("built site", () => {
  test.skip(({ isMobile }) => isMobile, "file checks don't depend on the device; run once");

  let out;
  test.beforeAll(() => { out = buildSite(); });
  test.afterAll(() => { if (out) fs.rmSync(out, { recursive: true, force: true }); });

  test("contains only the site: index.html, apps/, hub/ and .nojekyll", () => {
    const top = fs.readdirSync(out);
    expect(top.filter((n) => !ALLOWED_TOP.has(n))).toEqual([]);
    expect(top).toContain("index.html");
    expect(top).toContain(".nojekyll");
  });

  test("has every app and every clip from the repo, byte for byte", () => {
    const want = files(path.join(ROOT, "apps"));
    expect(files(path.join(out, "apps"))).toEqual(want);
    for (const f of want.filter((x) => x.endsWith(".html"))) {
      expect(fs.readFileSync(path.join(out, "apps", f)).equals(fs.readFileSync(path.join(ROOT, "apps", f))), f).toBe(true);
    }
    if (fs.existsSync(path.join(ROOT, "hub"))) {
      expect(files(path.join(out, "hub"))).toEqual(files(path.join(ROOT, "hub")));
    }
  });

  test("refuses to build into the repo root or an empty path", () => {
    for (const bad of [ROOT, "/", ""]) {
      let failed = false;
      try { execFileSync("bash", [path.join(ROOT, "tools", "build-site.sh"), bad], { stdio: "pipe" }); }
      catch (e) { failed = true; }
      expect(failed, `building into "${bad}" must fail`).toBe(true);
    }
    expect(fs.existsSync(path.join(ROOT, "index.html"))).toBe(true);
  });

  test("works from the built folder: every hub entry opens and 🏠 comes back", async ({ page }) => {
    await prepare(page);
    await page.clock.install();
    await page.goto("file://" + path.join(out, "index.html"));
    const apps = await page.evaluate(() => APPS);
    for (const a of apps) {
      expect(fs.existsSync(path.join(out, a.href)), `${a.href} in site`).toBe(true);
    }
    const first = apps[0];
    const tile = page.locator(`#grid .tile[data-id="${first.id}"]`);
    await tile.click();
    await page.clock.fastForward((await page.evaluate(() => CONFIRM_GAP_MS)) + 50);
    await tile.click();
    await expect(page.locator("h1")).toHaveText(first.name);
    await page.locator("a.home").click();
    await expect(page).toHaveURL(new RegExp(`^file://${out.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/index\\.html$`));
  });
});
