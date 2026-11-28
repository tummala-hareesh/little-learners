#!/usr/bin/env node
// Write the clip manifest for one app: every clip name the app can play and the words it says.
//   node tools/voices/manifest.js <app>        → tools/voices/out/<app>/manifest.json
//   node tools/voices/manifest.js hub          → the Playroom hub's app-name clips (index.html → hub/)
// The clip list comes from tests/<app>/clips.js (the same list the content test checks) and the text
// from the app's own clipText() (or clips.js clipText(tables, name) for a page without one, like the hub),
// so the generated clips always say what the device voice says.
// Opens the app from disk in headless Chromium (Playwright, already a dev dependency); no network.
const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const ROOT = path.join(__dirname, "..", "..");

async function buildManifest(app) {
  if (!/^[a-z0-9-]+$/.test(app)) throw new Error(`bad app name: ${app}`);
  // The hub is the root index.html and keeps its clips in hub/; every micro app is apps/<app>/.
  const dir = app === "hub" ? "hub" : `apps/${app}`;
  const html = path.join(ROOT, app === "hub" ? "index.html" : `${dir}/index.html`);
  const clipsJs = path.join(ROOT, "tests", app, "clips.js");
  if (!fs.existsSync(html)) throw new Error(`no app at ${path.relative(ROOT, html)}`);
  if (!fs.existsSync(clipsJs)) throw new Error(`no clip list at tests/${app}/clips.js`);
  const { TABLES, allClips, SAMPLES = [], clipText: tableText } = require(clipsJs);

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.route("**/*", (r) => (new URL(r.request().url()).protocol === "file:" ? r.continue() : r.abort()));
    await page.goto("file://" + html);
    const tables = await page.evaluate((names) => Object.fromEntries(names.map((n) => [n, eval(n)])), TABLES);
    const names = allClips(tables);
    let texts;
    if (tableText) texts = names.map((n) => tableText(tables, n));
    else {
      await page.waitForFunction(() => typeof clipText === "function");
      texts = await page.evaluate((ns) => ns.map((n) => clipText(n)), names);
    }
    const clips = {};
    const empty = [];
    names.forEach((n, i) => { if (texts[i]) clips[n] = texts[i]; else empty.push(n); });
    if (empty.length) throw new Error(`clips with no text: ${empty.join(", ")}`);
    // SAMPLES is a list of clip sequences, or a function of the tables (so the hub lists every tile).
    const samples = typeof SAMPLES === "function" ? SAMPLES(tables) : SAMPLES;
    const unknown = samples.flat().filter((n) => !(n in clips));
    if (unknown.length) throw new Error(`SAMPLES name unknown clips: ${unknown.join(", ")}`);
    return { app, dir, clips, samples };
  } finally {
    await browser.close();
  }
}

async function main() {
  const app = process.argv[2];
  if (!app || app === "-h" || app === "--help") {
    console.log("usage: node tools/voices/manifest.js <app>");
    process.exit(app ? 0 : 1);
  }
  const m = await buildManifest(app);
  const out = path.join(__dirname, "out", app, "manifest.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(m, null, 2) + "\n");
  console.log(`wrote ${path.relative(ROOT, out)} (${Object.keys(m.clips).length} clips)`);
}

if (require.main === module) main().catch((e) => { console.error(`manifest: ${e.message}`); process.exit(1); });
module.exports = { buildManifest };
