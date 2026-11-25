// Content-table integrity and question generation for Shape Friends.
const { test, expect } = require("@playwright/test");
const { openApp, missingClips } = require("../helpers");

let C;

test.beforeEach(async ({ page }) => {
  await openApp(page, "shape-friends");
  C = await page.evaluate(() => ({ SHAPES_2D, SHAPES_3D, OBJECTS, PRAISE, PHRASES }));
});

test("every shape has at least one real object, and every object has a known shape", () => {
  const shapes = [...C.SHAPES_2D, ...C.SHAPES_3D];
  expect(new Set(shapes).size).toBe(shapes.length);
  for (const s of shapes) {
    expect(C.OBJECTS.filter((o) => o.shape === s).length, `objects for ${s}`).toBeGreaterThan(0);
  }
  for (const o of C.OBJECTS) expect(shapes, `${o.k}.shape`).toContain(o.shape);
});

test("object keys are unique and every object has a name and emoji", () => {
  const keys = C.OBJECTS.map((o) => o.k);
  expect(new Set(keys).size).toBe(keys.length);
  for (const o of C.OBJECTS) {
    expect(o.k, JSON.stringify(o)).toMatch(/^[a-z]+$/);
    expect(o.say, o.k).toBeTruthy();
    expect(o.e, o.k).toBeTruthy();
  }
});

test("each shape set has enough shapes for the largest choice count", () => {
  expect(C.SHAPES_2D.length).toBeGreaterThanOrEqual(4);
  expect(C.SHAPES_3D.length).toBeGreaterThanOrEqual(4);
});

test("every clip the game can play exists in both voices", () => {
  const names = new Set([...Object.keys(C.PHRASES), "great"]);
  C.PRAISE.forEach((_, i) => names.add(`p-${i}`));
  for (const s of [...C.SHAPES_2D, ...C.SHAPES_3D]) names.add(`shape-${s}`);
  for (const o of C.OBJECTS) names.add(`obj-${o.k}`);
  expect(missingClips("shape-friends", [...names])).toEqual([]);
});

test("generated questions are always answerable, for every shape set and choice count", async ({ page }) => {
  const problems = await page.evaluate(() => {
    const out = [];
    for (const k of ["2d", "3d", "both"]) {
      for (const n of [2, 3, 4]) {
        kind = k; choiceCount = n;
        const allowed = shapeSet();
        for (let i = 0; i < 300; i++) {
          const q = makeQuestion();
          const tag = `${k}/${n} ${q.type} ${q.target}`;
          if (!q.obj) { out.push(`${tag}: no object`); continue; }
          if (q.choices.length !== n) out.push(`${tag}: ${q.choices.length} choices`);
          if (!allowed.includes(q.target)) out.push(`${tag}: target outside ${k}`);
          if (q.obj.shape !== q.target) out.push(`${tag}: object ${q.obj.k} is a ${q.obj.shape}`);
          if (q.type === "find") {
            if (q.choices.some((c) => !c)) { out.push(`${tag}: undefined choice`); continue; }
            const shapes = q.choices.map((c) => c.shape);
            if (new Set(shapes).size !== n) out.push(`${tag}: duplicate shapes ${shapes}`);
            if (shapes.filter((s) => s === q.target).length !== 1) out.push(`${tag}: answer not unique`);
            if (shapes.some((s) => !allowed.includes(s))) out.push(`${tag}: distractor outside ${k}`);
          } else {
            if (new Set(q.choices).size !== n) out.push(`${tag}: duplicate names`);
            if (!q.choices.includes(q.target)) out.push(`${tag}: answer missing`);
            if (q.choices.some((s) => !allowed.includes(s))) out.push(`${tag}: choice outside ${k}`);
          }
        }
      }
    }
    return [...new Set(out)].slice(0, 20);
  });
  expect(problems).toEqual([]);
});

test("celebration text uses the right article for every object and shape", async ({ page }) => {
  const lines = await page.evaluate(() =>
    OBJECTS.map((o) => {
      deck = [{ type: "name", target: o.shape, obj: o, choices: [o.shape] }];
      states = [{ solved: true }];
      index = 0;
      renderQuestion();
      return document.getElementById("prompt").textContent;
    })
  );
  const an = (w) => (/^[aeiou]/i.test(w) ? "An" : "A");
  const bad = lines.filter((l) => {
    const m = l.match(/^(An?) (.+) is (an?) (\w+)!$/);
    return !m || m[1] !== an(m[2]) || m[3] !== an(m[4]).toLowerCase();
  });
  expect(bad).toEqual([]);
});

test("hint text uses the right article for every shape", async ({ page }) => {
  const lines = await page.evaluate(() =>
    SHAPES_2D.concat(SHAPES_3D).map((shape) => {
      const o = OBJECTS.find((x) => x.shape === shape);
      deck = [{ type: "name", target: shape, obj: o, choices: [shape] }];
      states = [{ solved: false }];
      index = 0;
      renderQuestion();
      showHint();
      return document.getElementById("msg").textContent;
    })
  );
  const bad = lines.filter((l) => {
    const m = l.match(/^This one is (an?) (\w+)!$/);
    return !m || m[1] !== (/^[aeiou]/i.test(m[2]) ? "an" : "a");
  });
  expect(bad).toEqual([]);
});
