// Every clip name Shape Friends can play, derived from its content tables. Shared by
// tests/shape-friends/content.spec.js and tools/voices/manifest.js (so the voice generator and the
// tests always agree on the list).

/** Globals of apps/shape-friends/index.html that allClips() reads. */
const TABLES = ["SHAPES_2D", "SHAPES_3D", "OBJECTS", "PRAISE", "PHRASES", "DEVICE_PHRASES"];

/** Clip names from the content tables C (an object holding the TABLES). */
function allClips(C) {
  const names = new Set([...Object.keys(C.PHRASES), ...Object.keys(C.DEVICE_PHRASES)]);
  C.PRAISE.forEach((_, i) => names.add(`p-${i}`));
  for (const s of [...C.SHAPES_2D, ...C.SHAPES_3D]) names.add(`shape-${s}`);
  for (const o of C.OBJECTS) names.add(`obj-${o.k}`);
  return [...names];
}

/** Sentences the game builds from clips (promptClips / solvedClips), for the listen-through page. */
const SAMPLES = [
  ["find-the", "shape-triangle"],
  ["what-shape"],
  ["obj-pizza", "is-a", "shape-triangle"],
  ["obj-coin", "is-a", "shape-circle"],
  ["p-2", "obj-pizza", "is-a", "shape-triangle"],
  ["try-again"],
  ["great"],
];

module.exports = { TABLES, allClips, SAMPLES };
