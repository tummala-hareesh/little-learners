// Every clip name Word Pictures can play, derived from its content tables. Shared by
// tests/word-pictures/content.spec.js and tools/voices/manifest.js (so the voice generator and the
// tests always agree on the list). ipa-* (phonics sounds) are hand-recorded: generate with --skip ipa-.

/** Globals of apps/word-pictures/index.html that allClips() reads. */
const TABLES = ["WORDS", "PHONICS", "PRAISE"];

/** Clip names from the content tables C (an object holding the TABLES). */
function allClips(C) {
  const names = new Set(["great"]);
  C.PRAISE.forEach((_, i) => names.add(`p-${i}`));
  for (const { w } of C.WORDS) names.add(`w-${w.toLowerCase()}`);
  for (const groups of Object.values(C.PHONICS)) {
    for (const [k] of groups) if (k !== "silent") names.add(`ipa-${k}`);
  }
  return [...names];
}

/** Sentences the game builds from clips (spellSequence: praise, the sounds, the word), for the listen page. */
const SAMPLES = [
  ["p-0", "ipa-k", "ipa-ae", "ipa-t", "w-cat"],
  ["ipa-k", "ipa-ae", "ipa-t", "w-cat"],
  ["w-ox"],
  ["great"],
];

module.exports = { TABLES, allClips, SAMPLES };
