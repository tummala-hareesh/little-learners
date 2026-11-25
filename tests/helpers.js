// Shared test helpers: deterministic randomness, silent audio, offline network.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const APPS = path.join(ROOT, "apps");

/**
 * Seeded Math.random, stubbed audio playback and device speech, and no external network.
 * Every clip a page tries to play is recorded in window.__clips (its URL path);
 * every device-voice utterance in window.__spoken. With failClips, Audio.play() rejects
 * (as it does for a missing file), to exercise device-voice fallbacks.
 */
async function prepare(page, { seed = 1, failClips = false } = {}) {
  await page.route("**/*", (route) => {
    const host = new URL(route.request().url()).hostname;
    return host === "127.0.0.1" || host === "localhost" ? route.continue() : route.abort();
  });
  await page.addInitScript(({ s, failClips }) => {
    // mulberry32 — small seeded PRNG so rounds are reproducible
    let a = s >>> 0;
    Math.random = () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    window.__clips = [];
    window.__spoken = [];
    HTMLMediaElement.prototype.play = function () {
      window.__clips.push(new URL(this.src).pathname);
      if (failClips) {
        setTimeout(() => this.dispatchEvent(new Event("error")), 5);
        return Promise.reject(new DOMException("missing", "NotSupportedError"));
      }
      setTimeout(() => this.dispatchEvent(new Event("ended")), 5);
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function () {};
    // Device speech: record what would be said, finish immediately.
    const synth = {
      speak(u) { window.__spoken.push(u.text); setTimeout(() => u.onend && u.onend(), 5); },
      cancel() {}, resume() {}, pause() {}, getVoices() { return []; }, onvoiceschanged: null,
    };
    Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
    if (!window.SpeechSynthesisUtterance) {
      window.SpeechSynthesisUtterance = function (text) { this.text = text; };
    }
  }, { s: seed, failClips });
}

/** Open an app (apps/<app>/index.html) prepared as above. */
async function openApp(page, app, opts = {}) {
  await prepare(page, opts);
  await page.goto(`/apps/${app}/index.html`);
  await page.waitForFunction(() => typeof deck !== "undefined" && deck.length > 0);
}

/** Open the Playroom hub (root index.html) prepared as above. */
async function openHub(page, opts = {}) {
  await prepare(page, opts);
  await page.goto("/index.html");
  await page.waitForFunction(() => typeof APPS !== "undefined" && document.querySelectorAll(".tile").length > 0);
}

/** Paths of clips the page asked to play, e.g. "/apps/word-pictures/audio/w-cat.wav". */
async function playedClips(page) {
  return page.evaluate(() => window.__clips.slice());
}

/** Whether a clip URL path from the page exists on disk. */
function clipExists(urlPath) {
  return fs.existsSync(path.join(ROOT, decodeURIComponent(urlPath)));
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

module.exports = { prepare, openApp, openHub, playedClips, clipExists, missingClips, swipe, ROOT, APPS };
