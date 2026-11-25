// Shared test helpers: deterministic randomness, silent audio, offline network.
const fs = require("fs");
const path = require("path");

const APPS = path.join(__dirname, "..", "apps");

/**
 * Open an app with seeded Math.random, stubbed audio playback and no external network.
 * Every clip the app tries to play is recorded in window.__clips (its URL path).
 */
async function openApp(page, app, { seed = 1 } = {}) {
  await page.route("**/*", (route) => {
    const host = new URL(route.request().url()).hostname;
    return host === "127.0.0.1" || host === "localhost" ? route.continue() : route.abort();
  });
  await page.addInitScript((s) => {
    // mulberry32 — small seeded PRNG so rounds are reproducible
    let a = s >>> 0;
    Math.random = () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    window.__clips = [];
    HTMLMediaElement.prototype.play = function () {
      window.__clips.push(new URL(this.src).pathname);
      setTimeout(() => this.dispatchEvent(new Event("ended")), 5);
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function () {};
  }, seed);
  await page.goto(`/${app}/index.html`);
  await page.waitForFunction(() => typeof deck !== "undefined" && deck.length > 0);
}

/** Paths of clips the page asked to play, e.g. "/word-pictures/audio/w-cat.wav". */
async function playedClips(page) {
  return page.evaluate(() => window.__clips.slice());
}

/** Whether a clip URL path from the page exists on disk. */
function clipExists(urlPath) {
  return fs.existsSync(path.join(APPS, decodeURIComponent(urlPath)));
}

/** Clip names missing from either voice folder of an app. */
function missingClips(app, names) {
  const missing = [];
  for (const dir of ["audio", "audio-m"]) {
    for (const n of names) {
      if (!fs.existsSync(path.join(APPS, app, dir, `${n}.wav`))) missing.push(`${dir}/${n}.wav`);
    }
  }
  return missing;
}

/** Simulate a horizontal swipe on a touch device. */
async function swipe(page, dx) {
  await page.evaluate((delta) => {
    const x0 = innerWidth / 2, y = innerHeight / 2;
    const fire = (type, x) => {
      const t = new Touch({ identifier: 1, target: document.body, clientX: x, clientY: y });
      document.dispatchEvent(new TouchEvent(type, { changedTouches: [t], touches: type === "touchend" ? [] : [t], bubbles: true }));
    };
    fire("touchstart", x0);
    fire("touchend", x0 + delta);
  }, dx);
}

module.exports = { openApp, playedClips, clipExists, missingClips, swipe, APPS };
