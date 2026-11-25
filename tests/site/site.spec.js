// The public site that GitHub Pages serves is assembled by tools/build-site.sh (the single source of
// truth for what's published). These tests build it into temp folders and check it contains exactly
// the site, byte for byte, and that it works.
//
// Safety: the script deletes the contents of its output folder, so tests NEVER point it at real folders
// (the repo, /, $HOME). Refusal cases run a copy of the script inside a throwaway fake repo.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { test, expect } = require("@playwright/test");
const { prepare, ROOT } = require("../helpers");

const SCRIPT = path.join(ROOT, "tools", "build-site.sh");
const ALLOWED_TOP = new Set(["index.html", "apps", "hub", ".nojekyll"]); // must match tools/build-site.sh

const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const run = (script, args, env = {}) =>
  execFileSync("bash", [script, ...args], { stdio: "pipe", env: { ...process.env, ...env } });
const fails = (fn) => { try { fn(); return false; } catch (e) { return true; } };

function files(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...files(p).map((f) => path.join(e.name, f)));
    else out.push(e.name);
  }
  return out.sort();
}

/** Files git tracks under a repo path (what build-site.sh publishes). */
const tracked = (root, p) =>
  execFileSync("git", ["-C", root, "ls-files", "--", p], { encoding: "utf8" }).split("\n").filter(Boolean)
    .map((f) => path.relative(p, f)).sort();

/** A throwaway git repo: a copy of the real script plus a tiny fake site (files staged). */
function fakeRepo({ hub = false } = {}) {
  const root = tmp("ll-fake-repo-");
  fs.mkdirSync(path.join(root, "tools"));
  fs.copyFileSync(SCRIPT, path.join(root, "tools", "build-site.sh"));
  fs.writeFileSync(path.join(root, "index.html"), "<h1>fake hub</h1>");
  fs.mkdirSync(path.join(root, "apps", "demo"), { recursive: true });
  fs.writeFileSync(path.join(root, "apps", "demo", "index.html"), "<h1>demo</h1>");
  fs.writeFileSync(path.join(root, "package.json"), "{}");
  if (hub) {
    fs.mkdirSync(path.join(root, "hub", "audio"), { recursive: true });
    fs.writeFileSync(path.join(root, "hub", "audio", "app-demo.wav"), Buffer.from([82, 73, 70, 70]));
  }
  execFileSync("git", ["init", "-q", root]);
  execFileSync("git", ["-C", root, "add", "-A"]);
  return { root, script: path.join(root, "tools", "build-site.sh") };
}

test.describe("built site", () => {
  test.describe.configure({ mode: "serial" }); // build the ~10 MB site once, in one worker
  test.skip(({ isMobile }) => isMobile, "file checks don't depend on the device; run once");

  let out;
  test.beforeAll(() => { out = tmp("ll-site-"); run(SCRIPT, [out]); });
  test.afterAll(() => { if (out) fs.rmSync(out, { recursive: true, force: true }); });

  test("contains only the site: index.html, apps/, hub/ and .nojekyll", () => {
    const top = fs.readdirSync(out);
    expect(top.filter((n) => !ALLOWED_TOP.has(n))).toEqual([]);
    expect(top).toContain("index.html");
    expect(top).toContain(".nojekyll");
  });

  test("has every tracked app file and clip from the repo, byte for byte", () => {
    for (const dir of ["apps", "hub"].filter((d) => fs.existsSync(path.join(ROOT, d)))) {
      const want = tracked(ROOT, dir);
      expect(files(path.join(out, dir)), dir).toEqual(want);
      for (const f of want) {
        expect(fs.readFileSync(path.join(out, dir, f)).equals(fs.readFileSync(path.join(ROOT, dir, f))), `${dir}/${f}`).toBe(true);
      }
    }
    expect(fs.readFileSync(path.join(out, "index.html")).equals(fs.readFileSync(path.join(ROOT, "index.html")))).toBe(true);
  });

  test("rebuilding into a previous build replaces it cleanly", () => {
    fs.writeFileSync(path.join(out, "stale.html"), "old");
    run(SCRIPT, [out]);
    expect(fs.existsSync(path.join(out, "stale.html"))).toBe(false);
    expect(fs.existsSync(path.join(out, "index.html"))).toBe(true);
  });

  test("works from the built folder: every game opens and its 🏠 comes back", async ({ page }) => {
    await prepare(page);
    await page.clock.install();
    const home = "file://" + path.join(out, "index.html");
    await page.goto(home);
    const apps = await page.evaluate(() => APPS);
    const gap = await page.evaluate(() => CONFIRM_GAP_MS);
    for (const a of apps) {
      expect(fs.existsSync(path.join(out, a.href)), `${a.href} in site`).toBe(true);
      const tile = page.locator(`#grid .tile[data-id="${a.id}"]`);
      await tile.click();
      await page.clock.fastForward(gap + 50);
      await tile.click();
      await expect(page.locator("h1"), a.id).toHaveText(a.name);
      await page.locator("a.home").click();
      await expect(page).toHaveURL(home);
    }
  });
});

test.describe("build-site.sh safety (throwaway fake repo only)", () => {
  test.skip(({ isMobile }) => isMobile, "script checks don't depend on the device; run once");

  test("with no argument it builds into <repo>/_site, without package.json or tools", () => {
    const { root, script } = fakeRepo();
    run(script, []);
    expect(fs.readdirSync(path.join(root, "_site")).sort()).toEqual([".nojekyll", "apps", "index.html"]);
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("copies hub/ when it exists", () => {
    const { root, script } = fakeRepo({ hub: true });
    const o = tmp("ll-out-");
    run(script, [o]);
    expect(fs.existsSync(path.join(o, "hub", "audio", "app-demo.wav"))).toBe(true);
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(o, { recursive: true, force: true });
  });

  test("refuses the repo root, $HOME and an empty path, and leaves them untouched", () => {
    const { root, script } = fakeRepo();
    const fakeHome = tmp("ll-home-");
    fs.writeFileSync(path.join(fakeHome, "precious.txt"), "keep me");
    expect(fails(() => run(script, [root])), "repo root").toBe(true);
    expect(fails(() => run(script, [fakeHome], { HOME: fakeHome })), "$HOME").toBe(true);
    expect(fails(() => run(script, [""])), "empty path").toBe(true);
    expect(fs.existsSync(path.join(root, "index.html"))).toBe(true);
    expect(fs.readFileSync(path.join(fakeHome, "precious.txt"), "utf8")).toBe("keep me");
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(fakeHome, { recursive: true, force: true });
  });

  test("publishes only files git tracks (untracked drafts stay out)", () => {
    const { root, script } = fakeRepo();
    fs.writeFileSync(path.join(root, "apps", "demo", "draft-notes.txt"), "not for the public");
    const o = tmp("ll-out-");
    run(script, [o]);
    expect(fs.existsSync(path.join(o, "apps", "demo", "index.html"))).toBe(true);
    expect(fs.existsSync(path.join(o, "apps", "demo", "draft-notes.txt"))).toBe(false);
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(o, { recursive: true, force: true });
  });

  test("refuses symlinks in the site (they could publish files from outside it)", () => {
    const { root, script } = fakeRepo();
    fs.symlinkSync("../../.git/config", path.join(root, "apps", "demo", "cfg"));
    execFileSync("git", ["-C", root, "add", "-A"]);
    const o = tmp("ll-out-");
    expect(fails(() => run(script, [o]))).toBe(true);
    expect(fs.readdirSync(o)).toEqual([]);
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(o, { recursive: true, force: true });
  });

  test("the real repo has no symlinks under apps/ or hub/", () => {
    const links = ["apps", "hub"].filter((d) => fs.existsSync(path.join(ROOT, d)))
      .flatMap((d) => tracked(ROOT, d).map((f) => path.join(d, f)))
      .filter((f) => fs.lstatSync(path.join(ROOT, f)).isSymbolicLink());
    expect(links).toEqual([]);
  });

  test("never empties a folder that isn't a previous build", () => {
    const { root, script } = fakeRepo();
    const dir = tmp("ll-not-site-");
    fs.writeFileSync(path.join(dir, "precious.txt"), "keep me");
    expect(fails(() => run(script, [dir]))).toBe(true);
    expect(fs.readFileSync(path.join(dir, "precious.txt"), "utf8")).toBe("keep me");
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
