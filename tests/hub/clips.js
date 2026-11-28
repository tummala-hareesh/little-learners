// Every name clip the Playroom hub can play: hub/audio{,-m}/app-<id>.wav, each saying the entry's `say`.
// Shared by tests/hub/content.spec.js and tools/voices/manifest.js (`node tools/voices/manifest.js hub`).

/** Globals of index.html that allClips() reads. */
const TABLES = ["APPS"];

/** Clip names from the content tables C. */
function allClips(C) {
  return C.APPS.map((a) => `app-${a.id}`);
}

/** What each clip says (the hub has no clipText(); the words are APPS[].say, which the device voice reads). */
function clipText(C, name) {
  const app = C.APPS.find((a) => `app-${a.id}` === name);
  return app ? app.say : "";
}

/** Each tile's name, for the listen-through page (built from APPS, so a new tile is never left out). */
const SAMPLES = (C) => allClips(C).map((n) => [n]);

module.exports = { TABLES, allClips, clipText, SAMPLES };
