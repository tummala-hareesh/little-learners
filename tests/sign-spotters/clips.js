// Every clip name Sign Spotters can play, derived from its content tables. Shared by
// tests/sign-spotters/content.spec.js and tools/voices/manifest.js (so the voice generator and the
// tests always agree on the list).

/** Globals of apps/sign-spotters/index.html that allClips() reads. */
const TABLES = ["SHAPES", "MEANINGS", "SIGNS", "LIGHTS", "PRAISE", "PHRASES", "DEVICE_PHRASES"];

/** Clip names from the content tables C (an object holding the TABLES). */
function allClips(C) {
  const names = new Set([...Object.keys(C.PHRASES), ...Object.keys(C.DEVICE_PHRASES)]);
  C.PRAISE.forEach((_, i) => names.add(`p-${i}`));
  for (const s of C.SIGNS) names.add(`sign-${s.k}`);
  for (const m of C.MEANINGS) names.add(`mean-${m.k}`);
  for (const l of C.LIGHTS) names.add(`light-${l.k}`);
  for (const s of C.SHAPES) names.add(`shape-${s}`);
  return [...names];
}

/** Sentences the game builds from clips (promptClips / answerClips), for the listen-through page. */
const SAMPLES = [
  ["find-the", "sign-stop"],
  ["sign-stop", "its-an", "shape-octagon", "mean-stop"],
  ["sign-school", "its-a", "shape-triangle", "mean-careful"],
  ["light-red", "what-do"],
  ["sign-walk", "mean-stop", "teddy-cross"],
  ["look-again", "find-the", "sign-give-way"],
  ["p-2", "sign-crossing", "its-a", "shape-square", "mean-cross-here"],
  ["great"],
];

module.exports = { TABLES, allClips, SAMPLES };
