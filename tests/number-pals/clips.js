// Every clip name Number Pals can play, derived from its content tables. Shared by
// tests/number-pals/content.spec.js and tools/voices/manifest.js (so the voice generator and the
// tests always agree on the list).

/** Globals of apps/number-pals/index.html that allClips() reads. */
const TABLES = ["NUMBERS", "THINGS", "PRAISE", "PHRASES", "DEVICE_PHRASES"];

/** Clip names from the content tables C (an object holding the TABLES). */
function allClips(C) {
  const names = new Set([...Object.keys(C.PHRASES), ...Object.keys(C.DEVICE_PHRASES)]);
  C.PRAISE.forEach((_, i) => names.add(`p-${i}`));
  for (const x of C.NUMBERS) names.add(`n-${x.n}`);
  for (const t of C.THINGS) { names.add(`thing-${t.k}-one`); names.add(`thing-${t.k}-many`); }
  return [...names];
}

/** Sentences the game builds from clips, for the listen-through page (tools/voices). */
const SAMPLES = [
  ["how-many", "thing-apple-many"],
  ["show-me", "n-3", "thing-car-many", "put-in"],
  ["show-me", "n-1", "thing-fish-one", "put-in"],
  ["count-again", "n-1", "n-2", "n-3"],
  ["p-1", "n-1", "n-2", "thing-star-many"],
  ["great"],
];

module.exports = { TABLES, allClips, SAMPLES };
