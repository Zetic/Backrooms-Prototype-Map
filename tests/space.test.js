/*
 * Room-first house checks (run: node tests/space.test.js [seedsPerHouse] [--full])
 *
 * The test bed in src/space, on its own: it is not part of tests/run-all.js.
 *
 *   - every house type builds on nearly every seed
 *   - every house keeps the promises (BR.SPACE.verify): no wall or filled
 *     nook on any room's floor, rooms exactly one interior wall apart or
 *     far enough apart for two outer walls, interior walls 0.15 m and outer
 *     walls 0.3 m whatever the room sizes, sizes inside each room's ranges,
 *     inside the lot, every room reached from the front door
 *   - the output contract (br.space/0.1)
 *   - generation is deterministic and independent of what was built before
 *   - the checker itself catches a wall on a floor, a bad gap and a cut-off room
 */
const path = require('path');
for (const f of ['core', 'space/recipes', 'space/space']) require(path.join(__dirname, '..', 'src', f + '.js'));
const SP = globalThis.BR.SPACE, MODE = require('./mode');

const N = +(process.argv[2] || MODE.size(40, 150));
let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail ? '  (' + detail + ')' : ''));
  if (!ok) failures++;
}

const houses = {};
for (const id of Object.keys(SP.RECIPES)) {
  let built = 0, ms = 0;
  const probs = [], list = houses[id] = [];
  for (let s = 1; s <= N; s++) {
    const h = SP.generate({ recipe: id, seed: s });
    ms += h.meta ? h.meta.ms : 0;
    if (h.error) continue;
    built++; list.push(h);
    for (const p of SP.verify(h)) probs.push('seed ' + s + ': ' + p);
  }
  check(id + ': builds on at least 93% of seeds', built >= Math.ceil(N * 0.93), built + '/' + N + ', ' + (ms / N).toFixed(1) + ' ms each');
  check(id + ': every house passes the checks', !probs.length, probs.slice(0, 3).join('; '));
}

// the contract
const all = Object.values(houses).flat();
const contract = (h) => {
  const bad = [];
  if (h.schema !== 'br.space/0.1') bad.push('schema');
  if (h.units !== 'm' || h.front !== 'S') bad.push('units / front');
  for (const s of h.spaces) {
    if (!s.id || !s.type || !s.name || !SP.MODULES[s.type]) bad.push('space fields');
    if (s.poly.length !== 4) bad.push('space poly');
    if (Math.abs(s.area - s.size[0] * s.size[1]) > 0.011) bad.push('area of ' + s.name);
    if (s.rect.some((v) => Math.abs(v * 20 - Math.round(v * 20)) > 1e-6)) bad.push(s.name + ' off the 5 cm step');
  }
  const ids = new Set(h.spaces.map((s) => s.id));
  for (const o of h.openings) if (!ids.has(o.rooms[0]) || (o.rooms[1] !== null && !ids.has(o.rooms[1]))) bad.push('opening rooms');
  for (const w of h.walls) if (!['interior', 'exterior', 'open'].includes(w.kind)) bad.push('wall kind');
  if (!h.openings.some((o) => o.role === 'front door')) bad.push('front door');
  if (h.spaces.some((s) => s.type === 'garage') !== h.openings.some((o) => o.role === 'garage door')) bad.push('garage door');
  return bad;
};
const broken = all.map((h) => [h, contract(h)]).filter(([, b]) => b.length);
check('every house keeps the br.space/0.1 contract', !broken.length, broken.slice(0, 2).map(([h, b]) => h.recipe + ' ' + h.seed + ': ' + b.join(', ')).join('; '));

// walls stay their own size whatever the rooms are
const thick = new Set(all.flatMap((h) => h.walls.filter((w) => w.kind !== 'open').map((w) => w.thickness)));
check('wall thickness is only ever 0.15 or 0.3 m', thick.size === 2 && thick.has(0.15) && thick.has(0.3), [...thick].join(', '));
const tiny = all.flatMap((h) => h.solids.walls.concat(h.solids.pockets).filter((r) => r[2] - r[0] < 0.049 || r[3] - r[1] < 0.049));
check('no solid sliver thinner than one 5 cm step', !tiny.length, tiny.length + ' slivers');

// deterministic, and independent of what was built before
const a = JSON.stringify(Object.assign(SP.generate({ recipe: 'ranch', seed: 7 }), { meta: null }));
SP.generate({ recipe: 'suburban', seed: 99 }); SP.generate({ recipe: 'cottage', seed: 3 });
const b = JSON.stringify(Object.assign(SP.generate({ recipe: 'ranch', seed: 7 }), { meta: null }));
check('the same seed gives the same house', a === b);
const fixed = SP.generate({ recipe: 'bungalow', seed: 5, site: { w: 13, h: 18 } });
check('a given lot is used as given', !fixed.error && fixed.site.w === 13 && fixed.site.h === 18 && !SP.verify(fixed).length);
const tooSmall = SP.generate({ recipe: 'suburban', seed: 5, site: { w: 8, h: 8 } });
check('a lot too small for the house fails plainly', !!tooSmall.error && tooSmall.why.lot > 0);

// the checker catches what it should
const h = JSON.parse(JSON.stringify(houses.ranch[0]));
const room = h.spaces.find((s) => s.type === 'living');
const onFloor = JSON.parse(JSON.stringify(h)); onFloor.solids.walls.push([room.rect[0] + 0.5, room.rect[1] + 0.5, room.rect[0] + 0.65, room.rect[1] + 2]);
check('the checker catches a wall on a room floor', SP.verify(onFloor).some((p) => p.includes('wall is on the floor')));
const gap = JSON.parse(JSON.stringify(h)), wall = gap.walls.find((w) => w.kind === 'interior');
const mover = gap.spaces.find((s) => s.id === wall.rooms[1]), horiz = wall.line[0][1] === wall.line[1][1];
mover.rect = horiz ? [mover.rect[0], mover.rect[1] + 0.1, mover.rect[2], mover.rect[3] + 0.1] : [mover.rect[0] + 0.1, mover.rect[1], mover.rect[2] + 0.1, mover.rect[3]];
check('the checker catches rooms neither one wall nor two outer walls apart', SP.verify(gap).some((p) => p.includes('cm apart')));
const cut = JSON.parse(JSON.stringify(h)), bed = cut.spaces.find((s) => s.type === 'bedroom');
cut.openings = cut.openings.filter((o) => !o.rooms.includes(bed.id));
check('the checker catches a room that cannot be reached', SP.verify(cut).some((p) => p.includes('cannot be reached')));

console.log(failures ? failures + ' checks failed' : 'All checks passed.');
process.exitCode = failures ? 1 : 0;
