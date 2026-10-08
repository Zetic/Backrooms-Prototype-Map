/*
 * Template checks (run: node tests/templates.test.js [seedsPerArchetype] [--full])
 *
 *   - every archetype builds on many seeds, main sides and site shapes
 *   - every building passes validation and keeps the br.building/0.2
 *     contract: kit grid, rooms inside the site and not overlapping,
 *     openings on their walls, an entrance, every room reachable from the
 *     surrounding backrooms (across levels too), architecture only
 *   - irregular sites (L / U shapes) still produce valid buildings
 *   - multi-level buildings: levels, stacked verticals, reachability
 *   - generation is deterministic and independent of what was built before
 */
const path = require('path');
for (const f of ['core', 'tpl/grid', 'tpl/framework', 'tpl/catalogue', 'tpl/house', 'tpl/room', 'tpl/composite', 'tpl/neighborhood', 'tpl/park', 'tpl/zone', 'tpl/archetypes/house', 'tpl/archetypes/room', 'tpl/archetypes/neighborhood', 'tpl/archetypes/park', 'tpl/archetypes/lone'])
  require(path.join(__dirname, '..', 'src', f + '.js'));
const BR = globalThis.BR, TPL = BR.TPL, TG = BR.TG, MODE = require('./mode');

const N = +(process.argv[2] || MODE.size(16, 40));
let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail ? '  (' + detail + ')' : ''));
  if (!ok) failures++;
}
const onGrid = (v) => Math.abs(v * 2 - Math.round(v * 2)) < 1e-9;
const PASS = new Set(['door', 'double', 'opening', 'slider', 'vehicle', 'open', 'stair', 'elevator', 'ladder']);
const FORBIDDEN = ['slots', 'lights', 'materials', 'gates', 'furniture'];

/** Contract problems of one building (empty = fine). */
function contract(b) {
  const bad = [];
  const G = b.grid;
  if (b.schema !== TPL.SCHEMA) bad.push('schema');
  for (const k of FORBIDDEN) if (k in b) bad.push('has ' + k + ' (templates are architecture only)');
  if (!Array.isArray(b.levels) || !b.levels.length) bad.push('no levels');
  // site raster
  const W = Math.round(b.site.w / G), H = Math.round(b.site.h / G), site = new Uint8Array(W * H);
  for (const r of b.site.rects) for (let y = Math.round(r[1] / G); y < Math.round(r[3] / G); y++) for (let x = Math.round(r[0] / G); x < Math.round(r[2] / G); x++) site[y * W + x] = 1;
  const cells = b.levels.map(() => new Int32Array(W * H).fill(-1));
  b.rooms.forEach((rm, i) => {
    if (!b.levels[rm.level]) { bad.push(rm.id + ' on a missing level'); return; }
    if (!Array.isArray(rm.tags)) bad.push(rm.id + ' has no tags');
    if ('materials' in rm) bad.push(rm.id + ' has materials');
    for (const r of rm.rects) {
      if (!r.every(onGrid)) bad.push(rm.id + ' off grid');
      for (let y = Math.round(r[1] / G); y < Math.round(r[3] / G); y++) for (let x = Math.round(r[0] / G); x < Math.round(r[2] / G); x++) {
        if (x < 0 || y < 0 || x >= W || y >= H || !site[y * W + x]) { bad.push(rm.id + ' outside the site'); return; }
        const c = cells[rm.level];
        if (c[y * W + x] >= 0) { bad.push(rm.id + ' overlaps ' + b.rooms[c[y * W + x]].id); return; }
        c[y * W + x] = i;
      }
    }
  });
  // walls / openings
  const walls = new Map(b.walls.map((w) => [w.id, w]));
  for (const w of b.walls) if (![...w.a, ...w.b].every(onGrid)) bad.push(w.id + ' off grid');
  for (const op of b.openings) {
    const w = walls.get(op.wall);
    if (!w) { bad.push(op.id + ' on a missing wall'); continue; }
    if (w.level !== op.level) bad.push(op.id + ' on another level than its wall');
    if (![...op.a, ...op.b].every(onGrid)) bad.push(op.id + ' off grid');
    const horiz = w.a[1] === w.b[1];
    const lo = horiz ? Math.min(w.a[0], w.b[0]) : Math.min(w.a[1], w.b[1]), hi = horiz ? Math.max(w.a[0], w.b[0]) : Math.max(w.a[1], w.b[1]);
    for (const p of [op.a, op.b]) {
      const t = horiz ? p[0] : p[1], c = horiz ? p[1] : p[0];
      if (t < lo - 1e-9 || t > hi + 1e-9 || Math.abs(c - (horiz ? w.a[1] : w.a[0])) > 1e-9) { bad.push(op.id + ' off its wall'); break; }
    }
  }
  // portals: on exterior walls, at least one way in
  for (const p of b.portals) {
    const op = b.openings.find((o) => o.id === p.opening), w = op && walls.get(op.wall);
    if (!w || w.kind !== 'exterior') bad.push(p.id + ' not on an exterior wall');
  }
  if (!b.portals.some((p) => p.role === 'entrance' || p.role === 'both')) bad.push('no entrance');
  const main = b.portals.find((p) => p.main);
  if (!main) bad.push('no main entrance'); else if (main.side !== b.approach) bad.push('main entrance faces ' + main.side + ', not ' + b.approach);
  // reachability over the room graph from the surrounding backrooms
  const adj = new Map([['outside', []]]);
  for (const r of b.rooms) adj.set(r.id, []);
  for (const [a, c, kind] of b.graph.edges) if (PASS.has(kind) && adj.has(a) && adj.has(c)) { adj.get(a).push(c); adj.get(c).push(a); }
  const seen = new Set(['outside']), st = ['outside'];
  while (st.length) for (const v of adj.get(st.pop())) if (!seen.has(v)) { seen.add(v); st.push(v); }
  for (const r of b.rooms) if (!seen.has(r.id)) bad.push(r.id + ' (' + r.type + ') unreachable');
  return bad;
}

// ---------------------------------------------------------------- builds
const sides = ['S', 'E', 'N', 'W'];
let total = 0, errors = 0, issues = 0, ms = 0;
const bad = [];
for (const a of TPL.listArchetypes()) {
  let ok = 0, n = 0, score = 0, err = 0;
  for (let s = 1; s <= N; s++) {
    const spec = { archetype: a.id, seed: s * 7919, approach: sides[s % 4] };
    if (s % 3 === 0) spec.wrongness = 1;
    const b = TPL.generate(spec);
    n++; total++;
    if (b.error) { err++; errors++; continue; }
    ms += b.meta.ms;
    const hard = b.meta.issues.filter((x) => x.indexOf('ERROR') === 0);
    const c = contract(b);
    if (hard.length || c.length) { issues++; bad.push(a.id + ' #' + spec.seed + ': ' + hard.concat(c).slice(0, 3).join('; ')); continue; }
    ok++; score += b.meta.score;
  }
  console.log('     ' + a.id.padEnd(14) + ok + '/' + n + ' ok' + (err ? ', ' + err + ' no layout' : '') + ', avg score ' + (score / Math.max(1, ok)).toFixed(1));
}
check('archetypes build on their own site ranges', errors <= Math.ceil(total * 0.01), errors + ' of ' + total + ' had no layout');
check('every building validates and keeps the contract', issues === 0, issues + ' bad' + (bad.length ? ': ' + bad.slice(0, 4).join(' | ') : ''));
console.log('     avg ' + (ms / Math.max(1, total - errors)).toFixed(1) + ' ms per building');

// ---------------------------------------------------------------- irregular sites
{
  const shapes = {
    L: (w, h) => [[0, 0, w * 0.6, h], [w * 0.6, h * 0.4, w, h]],
    U: (w, h) => [[0, 0, w * 0.3, h], [w * 0.3, h * 0.45, w * 0.7, h], [w * 0.7, 0, w, h]]
  };
  const snap = (v) => Math.round(v * 2) / 2;
  let n = 0, built = 0, bad2 = [];
  for (const a of TPL.listArchetypes()) for (const [name, f] of Object.entries(shapes)) for (let s = 1; s <= 6; s++) {
    const w = snap(a.site.w[1] * 1.15), h = snap(a.site.h[1] * 1.3);
    const b = TPL.generate({ archetype: a.id, seed: s, site: { rects: f(w, h).map((r) => r.map(snap)) } });
    n++;
    if (b.error) continue;
    built++;
    const c = contract(b);
    if (c.length || b.meta.issues.some((x) => x.indexOf('ERROR') === 0)) bad2.push(a.id + '/' + name + ': ' + c.slice(0, 2).join('; '));
  }
  check('irregular sites give valid buildings', bad2.length === 0, built + ' of ' + n + ' built' + (bad2.length ? '; bad: ' + bad2.slice(0, 3).join(' | ') : ''));
  check('most templates fit an L or U site', built >= n * 0.75, built + ' of ' + n);
}

// ---------------------------------------------------------------- multi-level (a test engine)
{
  // a stack of floors: a stair core on every level, rooms off a corridor, the entrance on level 0
  const T = {
    stair: { zone: 'circulation', minW: 2, tags: ['stair'] }, corridor: { zone: 'circulation', minW: 2, tags: ['circulation'] },
    office: { zone: 'private', minW: 4, tags: ['work'], win: { w: [2, 3], every: 6, max: 2 } }, lobby: { zone: 'public', minW: 4, tags: ['entry'] }
  };
  TPL.registerEngine({
    id: 'test_tower', name: 'test tower', types: T,
    program: () => ({ floors: 3 }),
    layout: (P, ctx, rng) => {
      const r = ctx.site.inner, rooms = [], conns = [], verticals = [];
      const w = r[2] - r[0], h = r[3] - r[1];
      if (w < 14 || h < 12) return null;
      const stairs = [];
      for (let lv = 0; lv < P.floors; lv++) {
        const add = (type, q) => { rooms.push({ type, level: lv, rects: [q] }); return rooms.length - 1; };
        const st = add('stair', [r[0], r[1], r[0] + 4, r[1] + 5]);
        const cor = add('corridor', [r[0] + 4, r[1], r[0] + 7, r[3]]);
        add(lv === 0 ? 'lobby' : 'office', [r[0], r[1] + 5, r[0] + 4, r[3]]);
        const cut = r[1] + Math.floor(h / 2) + rng.int(-1, 1);
        const o1 = add('office', [r[0] + 7, r[1], r[2], cut]), o2 = add('office', [r[0] + 7, cut, r[2], r[3]]);
        conns.push({ a: cor, b: st, kind: 'opening', w: 2, prio: 5, required: true });
        conns.push({ a: cor, b: o1, kind: 'door', prio: 5, required: true }, { a: cor, b: o2, kind: 'door', prio: 5, required: true });
        conns.push({ a: cor, b: cor + 1, kind: 'door', prio: 5, required: true });
        if (lv === 0) conns.push({ a: cor, b: TPL.OUTSIDE, kind: 'double', role: 'entrance', side: 'S', w: 3, main: true, prio: 10, required: true });
        if (lv === P.floors - 1) conns.push({ a: o1, b: TPL.OUTSIDE, kind: 'door', role: 'exit', side: 'N', prio: 4 });
        stairs.push(st);
      }
      verticals.push({ kind: 'stair', rooms: stairs });
      return { W: ctx.site.W, H: ctx.site.H, levels: P.floors, levelHeights: [4, 3.2, 3.2], rooms, conns, verticals, meta: { type: 'tower' } };
    }
  });
  TPL.registerArchetype({ id: 'test_tower', engine: 'test_tower', name: 'test tower', site: { w: [8, 11], h: [7, 9] }, windows: 1 });
  let okAll = true, why = '';
  for (let s = 1; s <= 10; s++) {
    const b = TPL.generate({ archetype: 'test_tower', seed: s, approach: sides[s % 4] });
    const c = b.error ? [b.error] : contract(b);
    const lv = b.levels || [];
    const v = (b.verticals || [])[0];
    if (c.length) { okAll = false; why = c.slice(0, 2).join('; '); break; }
    if (lv.length !== 3 || lv[1].elevation !== 4 || !v || v.rooms.length !== 3) { okAll = false; why = 'levels / verticals wrong'; break; }
    if (!b.walls.some((w) => w.level === 2) || !b.openings.some((o) => o.level === 2 && o.kind === 'window')) { okAll = false; why = 'upper level has no walls / windows'; break; }
  }
  check('multi-level buildings: levels, stacked stairs, reachable upper floors', okAll, why);
  // a broken stack must be caught
  TPL.registerEngine(Object.assign({}, TPL.engines.test_tower, { id: 'test_tower_bad', layout: (P, ctx, rng) => {
    const p = TPL.engines.test_tower.layout(P, ctx, rng);
    if (p) p.verticals = [];                      // no stairs: upper floors cut off
    return p;
  } }));
  TPL.registerArchetype({ id: 'test_tower_bad', engine: 'test_tower_bad', name: 'broken tower', site: { w: [8, 11], h: [7, 9] } });
  const bb = TPL.generate({ archetype: 'test_tower_bad', seed: 1 });
  check('a floor with no way up is rejected', !!bb.error && Object.keys(bb.meta.layoutFailures).some((k) => k.indexOf('unreachable') >= 0));
  delete TPL.archetypes.test_tower; delete TPL.archetypes.test_tower_bad;
}

// ---------------------------------------------------------------- determinism
{
  const spec = { archetype: 'suburban', seed: 4242, approach: 'E', wrongness: 0.5 };
  const strip = (b) => JSON.stringify(b, (k, v) => (k === 'ms' ? undefined : v));     // timing is not part of the building
  const a = strip(TPL.generate(spec));
  for (let k = 0; k < 5; k++) TPL.generate({ archetype: 'ranch', seed: 100 + k });
  const b = strip(TPL.generate(spec)), c = strip(TPL.generate(Object.assign({}, spec)));
  check('same spec gives the same building, whatever was built before', a === b && b === c);
  check('a different seed gives a different building', a !== strip(TPL.generate(Object.assign({}, spec, { seed: 4243 }))));
}
{
  // the main side only turns the building: same rooms and areas
  const S = TPL.generate({ archetype: 'ranch', seed: 77, site: { w: 28, h: 16 }, approach: 'S' });
  const E = TPL.generate({ archetype: 'ranch', seed: 77, site: { w: 16, h: 28 }, approach: 'E' });
  const sig = (b) => b.rooms.map((r) => r.type + ':' + r.area).join(',');
  check('facing another side keeps the plan', !S.error && sig(S) === sig(E) && S.site.w === E.site.h);
}
{
  // small end of the range
  const c = TPL.generate({ archetype: 'closet', seed: 3 });
  check('a one-room closet is a valid POI', !c.error && c.rooms.length === 1 && c.portals.length === 1 && contract(c).length === 0);
}

console.log(failures ? '\n' + failures + ' check(s) failed' : '\nall checks passed');
process.exit(failures ? 1 : 0);
