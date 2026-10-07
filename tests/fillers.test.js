/*
 * Filler checks (run: node tests/fillers.test.js [seedsPerFiller])
 *
 * Everything is checked from the output JSON alone, independently of the
 * engine's own checks:
 *   - kit grid; rooms inside the site, never overlapping, at least 1 m wide
 *   - every connection honoured: one portal, exactly where the world asked,
 *     on an exterior wall, on the right side
 *   - every room reachable through the room graph
 *   - walkable by a walker 1 m wide (tests/walk.js): from the connections it
 *     reaches every floor cell, with walls, openings, partitions and columns
 *     taken into account, so no join is narrower than 1 m
 *   - deterministic, and independent of load order and connection order
 *   - the pool picks only fillers that fit, and leans enclosed
 *
 * ONLY=warren,cells node tests/fillers.test.js 80  checks just those fillers
 * (and skips the pool-wide checks).
 */
const path = require('path');
for (const f of ['core', 'tpl/grid', 'tpl/framework', 'tpl/fillers/engine', 'tpl/fillers/kit', 'tpl/fillers/pool', 'tpl/fillers/corridors', 'tpl/fillers/halls', 'tpl/fillers/rooms'])
  require(path.join(__dirname, '..', 'src', f + '.js'));
const BR = globalThis.BR, FILL = BR.FILL, TPL = BR.TPL, { Rng, hash4 } = BR;
const { walk1m } = require('./walk');

const N = +(process.argv[2] || 40);
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail ? '  (' + detail + ')' : ''));
  if (!ok) failures++;
}
const G = 0.5, onGrid = (v) => Math.abs(v * 2 - Math.round(v * 2)) < 1e-9;
const SHAPES = ['rect', 'rect', 'L', 'U', 'notched', 'random'];

/** a test site and connections from a seed: 6-44 m, any shape, 0-4 connections */
function caseFor(seed, minDim) {
  const rng = new Rng(hash4(seed, 0x74657374, 0, 0));
  const w = Math.round(rng.range(minDim || 6, 44) * 2) / 2, h = Math.round(rng.range(minDim || 6, 44) * 2) / 2;
  const shape = SHAPES[rng.int(0, SHAPES.length - 1)];
  const site = shape === 'rect' ? { w, h } : { rects: TPL.siteShape(w, h, shape, rng, ['S', 'E', 'N', 'W'][rng.int(0, 3)]) };
  return { site, connections: FILL.sampleConnections(site, rng.int(0, 4), seed) };
}

/** Contract problems of one filler blueprint (empty = fine). */
function contract(b, spec) {
  const bad = [];
  if (b.schema !== FILL.SCHEMA) bad.push('schema');
  const W = Math.round(b.site.w / G), H = Math.round(b.site.h / G);
  const site = new Uint8Array(W * H), cell = new Int32Array(W * H).fill(-1);
  for (const r of b.site.rects) for (let y = Math.round(r[1] / G); y < Math.round(r[3] / G); y++) for (let x = Math.round(r[0] / G); x < Math.round(r[2] / G); x++) site[y * W + x] = 1;
  const ids = new Map(b.rooms.map((r, i) => [r.id, i]));
  b.rooms.forEach((rm, i) => {
    if (!Array.isArray(rm.tags) || rm.tags.indexOf('backrooms') < 0) bad.push(rm.id + ' not tagged backrooms');
    let wide = false;
    for (const r of rm.rects) {
      if (!r.every(onGrid)) bad.push(rm.id + ' off grid');
      if (Math.min(r[2] - r[0], r[3] - r[1]) >= 1) wide = true;
      for (let y = Math.round(r[1] / G); y < Math.round(r[3] / G); y++) for (let x = Math.round(r[0] / G); x < Math.round(r[2] / G); x++) {
        if (x < 0 || y < 0 || x >= W || y >= H || !site[y * W + x]) { bad.push(rm.id + ' outside the site'); return; }
        if (cell[y * W + x] >= 0) { bad.push(rm.id + ' overlaps ' + b.rooms[cell[y * W + x]].id); return; }
        cell[y * W + x] = i;
      }
    }
    if (!wide) bad.push(rm.id + ' narrower than 1 m');
  });
  // every room is at least 1 m wide everywhere: each cell sits in a 2x2 block of its room
  const own = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? -1 : cell[y * W + x]);
  let sliver = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = own(x, y);
    if (v < 0) continue;
    let ok = false;
    for (let dy = -1; dy <= 0 && !ok; dy++) for (let dx = -1; dx <= 0; dx++) if (own(x + dx, y + dy) === v && own(x + dx + 1, y + dy) === v && own(x + dx, y + dy + 1) === v && own(x + dx + 1, y + dy + 1) === v) { ok = true; break; }
    if (!ok) sliver++;
  }
  if (sliver) bad.push(sliver + ' cells in slivers under 1 m');
  // connections: one portal each, exactly as asked
  const walls = new Map(b.walls.map((w) => [w.id, w])), ops = new Map(b.openings.map((o) => [o.id, o]));
  for (const c of spec.connections || []) {
    const ps = b.portals.filter((p) => p.connection === c.id);
    if (ps.length !== 1) { bad.push('connection ' + c.id + ' has ' + ps.length + ' portals'); continue; }
    const p = ps[0], op = ops.get(p.opening), w = op && walls.get(op.wall);
    if (!w || w.kind !== 'exterior') { bad.push('portal ' + p.id + ' not on an exterior wall'); continue; }
    if (p.side !== c.side) bad.push('portal ' + p.id + ' faces ' + p.side + ', not ' + c.side);
    const horiz = c.side === 'N' || c.side === 'S';
    const s0 = Math.min(horiz ? op.a[0] : op.a[1], horiz ? op.b[0] : op.b[1]), s1 = Math.max(horiz ? op.a[0] : op.a[1], horiz ? op.b[0] : op.b[1]);
    const line = horiz ? op.a[1] : op.a[0];
    if (Math.abs(s0 - c.at) > 1e-9 || Math.abs(s1 - (c.at + c.width)) > 1e-9 || (c.line !== undefined && Math.abs(line - c.line) > 1e-9)) bad.push('portal ' + p.id + ' moved');
    // the room behind it is inside, the cell in front outside the site
    const mid = Math.round(((s0 + s1) / 2) / G - 0.5), L = Math.round(line / G);
    const inside = c.side === 'N' ? [mid, L] : c.side === 'S' ? [mid, L - 1] : c.side === 'W' ? [L, mid] : [L - 1, mid];
    const outside = c.side === 'N' ? [mid, L - 1] : c.side === 'S' ? [mid, L] : c.side === 'W' ? [L - 1, mid] : [L, mid];
    if (own(inside[0], inside[1]) !== ids.get(p.room)) bad.push('portal ' + p.id + ' not on its room');
    if (outside[0] >= 0 && outside[1] >= 0 && outside[0] < W && outside[1] < H && site[outside[1] * W + outside[0]]) bad.push('portal ' + p.id + ' opens into the site');
  }
  if (b.portals.length !== (spec.connections || []).length) bad.push(b.portals.length + ' portals for ' + (spec.connections || []).length + ' connections');
  // room graph
  const adj = new Map(b.rooms.map((r) => [r.id, []]));
  for (const [a, c, kind] of b.graph.edges) if (adj.has(a) && adj.has(c) && kind !== 'window') { adj.get(a).push(c); adj.get(c).push(a); }
  if (b.rooms.length) {
    const seen = new Set([b.rooms[0].id]), st = [b.rooms[0].id];
    while (st.length) for (const v of adj.get(st.pop())) if (!seen.has(v)) { seen.add(v); st.push(v); }
    if (seen.size !== b.rooms.length) bad.push((b.rooms.length - seen.size) + ' rooms unreachable in the graph');
  } else bad.push('no rooms');
  // walkability for a walker 1 m wide: from the connections it reaches every
  // floor cell, and every connection opens onto the same floor
  const wk = walk1m(b);
  if (wk.unreached) bad.push(wk.unreached + ' floor cells a 1 m walker cannot reach');
  if (wk.stuck.length) bad.push('nowhere to stand behind ' + wk.stuck.join(', '));
  if (wk.pieces > 1 && !FILL.fillers[b.filler].pieces) bad.push('the connections open onto ' + wk.pieces + ' separate floors');
  for (const k of ['furniture', 'materials', 'lights']) if (k in b) bad.push('has ' + k);
  // curves: each replaces stair-step pieces of its room's exterior walls, no
  // opening among them, and keeps close to the steps it replaces
  if (!!b.curves !== !!b.outline) bad.push('curves without an outline, or the other way round');
  for (const c of b.curves || []) {
    const A = c.pts[0], Z = c.pts[c.pts.length - 1], L0 = c.line[0], L1 = c.line[c.line.length - 1];
    if (Math.hypot(A[0] - L0[0], A[1] - L0[1]) > 1e-6 || Math.hypot(Z[0] - L1[0], Z[1] - L1[1]) > 1e-6) { bad.push('curve ' + c.id + ' does not start and end on its walls'); continue; }
    for (let k = 1; k < c.line.length; k++) {
      const p = c.line[k - 1], q = c.line[k], horiz = Math.abs(p[1] - q[1]) < 1e-9;
      if (!horiz && Math.abs(p[0] - q[0]) > 1e-9) { bad.push('curve ' + c.id + ' replaces a slanted piece'); break; }
      const lo = horiz ? Math.min(p[0], q[0]) : Math.min(p[1], q[1]), hi = horiz ? Math.max(p[0], q[0]) : Math.max(p[1], q[1]), at = horiz ? p[1] : p[0];
      const on = b.walls.filter((w) => w.kind === 'exterior' && w.rooms.indexOf(c.room) >= 0 && (Math.abs(w.a[1] - w.b[1]) < 1e-9) === horiz && Math.abs((horiz ? w.a[1] : w.a[0]) - at) < 1e-9 &&
        Math.min(horiz ? w.a[0] : w.a[1], horiz ? w.b[0] : w.b[1]) <= lo + 1e-9 && Math.max(horiz ? w.a[0] : w.a[1], horiz ? w.b[0] : w.b[1]) >= hi - 1e-9);
      if (!on.length) { bad.push('curve ' + c.id + ' replaces a piece that is not its room\'s exterior wall'); break; }
      if (b.openings.some((o) => on.some((w) => w.id === o.wall) && Math.min(horiz ? o.a[0] : o.a[1], horiz ? o.b[0] : o.b[1]) < hi - 1e-9 && Math.max(horiz ? o.a[0] : o.a[1], horiz ? o.b[0] : o.b[1]) > lo + 1e-9)) { bad.push('curve ' + c.id + ' runs over an opening'); break; }
    }
    const dist = (x, y) => Math.min(...c.line.slice(1).map((q, k) => {
      const p = c.line[k], dx = q[0] - p[0], dy = q[1] - p[1], t = Math.max(0, Math.min(1, ((x - p[0]) * dx + (y - p[1]) * dy) / (dx * dx + dy * dy || 1)));
      return Math.hypot(x - p[0] - t * dx, y - p[1] - t * dy);
    }));
    if (c.pts.some(([x, y]) => dist(x, y) > 1)) bad.push('curve ' + c.id + ' strays from its steps');
  }
  return bad;
}

// ---------------------------------------------------------------- every filler, many sites
const stats = {};
let errors = 0, total = 0;
for (const F of FILL.list().filter((F) => !ONLY || ONLY.indexOf(F.id) >= 0)) {
  const st = stats[F.id] = { n: 0, ok: 0, ms: 0, built: 0, open: 0, skipped: 0, bad: [] };
  for (let s = 1; s <= N; s++) {
    const seed = s * 7919 + F.id.length;
    const cs = caseFor(seed);
    if (F.fits && !F.fits(FILL.makeSite(cs.site))) { st.skipped++; continue; }
    const spec = { filler: F.id, seed, site: cs.site, connections: cs.connections };
    const b = FILL.generate(spec);
    st.n++; total++;
    if (b.error) { errors++; st.bad.push('#' + seed + ' error: ' + b.error); continue; }
    const c = contract(b, spec).concat(b.meta.issues);
    if (c.length) { st.bad.push('#' + seed + ': ' + c.slice(0, 3).join('; ')); continue; }
    st.ok++; st.ms += b.meta.ms; st.built += b.meta.built; st.open += b.meta.openFloor;
  }
  console.log('     ' + F.id.padEnd(12) + (st.ok + '/' + st.n + ' ok').padEnd(10) + ' avg ' + (st.ms / Math.max(1, st.ok)).toFixed(2) + ' ms, built ' +
    Math.round((st.built / Math.max(1, st.ok)) * 100) + '%, open floor ' + Math.round((st.open / Math.max(1, st.ok)) * 100) + '%' + (st.skipped ? ', ' + st.skipped + ' sites too small' : ''));
}
const allBad = [].concat(...Object.keys(stats).map((k) => stats[k].bad.map((x) => k + ' ' + x)));
check('every filler builds on any site shape and keeps the contract', allBad.length === 0, allBad.length + ' bad of ' + total + (allBad.length ? ': ' + allBad.slice(0, 4).join(' | ') : ''));
check('connections that do not fit are refused, not moved', (() => {
  const b1 = FILL.generate({ filler: 'warren', seed: 1, site: { w: 20, h: 20 }, connections: [{ id: 'x', side: 'N', at: 19.5, width: 1.5 }] });
  const b2 = FILL.generate({ filler: 'warren', seed: 1, site: { rects: [[0, 0, 10, 20], [10, 10, 20, 20]] }, connections: [{ id: 'y', side: 'N', at: 12, width: 1.5, line: 0 }] });
  return !!b1.error && !!b2.error;
})());

// ---------------------------------------------------------------- tiny and odd sites
if (!ONLY) {
  const bad = [];
  const sites = [{ w: 2, h: 2 }, { w: 1.5, h: 9 }, { w: 3, h: 3 }, { rects: [[0, 0, 2, 12], [2, 10, 14, 12]] }, { rects: [[0, 0, 6, 6], [6, 2, 30, 4]] }];
  sites.forEach((site, k) => {
    for (let s = 1; s <= 6; s++) {
      const connections = FILL.sampleConnections(site, 1 + (s % 3), s);
      const spec = { seed: s, site, connections }, b = FILL.generate(spec);
      if (b.error) { bad.push('site ' + k + ': ' + b.error); continue; }
      const c = contract(b, spec).concat(b.meta.issues);
      if (c.length) bad.push('site ' + k + ' ' + b.filler + ': ' + c[0]);
    }
  });
  check('tiny, thin and odd sites still give a valid filler', bad.length === 0, bad.slice(0, 3).join(' | '));
}

// ---------------------------------------------------------------- determinism
{
  const cs = caseFor(4242, 20), spec = { filler: 'warren', seed: 4242, site: cs.site, connections: cs.connections };
  const strip = (b) => JSON.stringify(b, (k, v) => (k === 'ms' ? undefined : v));
  const a = strip(FILL.generate(spec));
  for (let k = 0; k < 6; k++) FILL.generate({ seed: 100 + k, site: { w: 18, h: 22 }, connections: FILL.sampleConnections({ w: 18, h: 22 }, 2, k) });
  const b = strip(FILL.generate(Object.assign({}, spec)));
  check('same spec gives the same filler, whatever was built before', a === b);
  const rev = strip(FILL.generate(Object.assign({}, spec, { connections: spec.connections.slice().reverse() })));
  check('connection order does not matter', a === rev);
  check('a different seed gives a different filler', a !== strip(FILL.generate(Object.assign({}, spec, { seed: 4243 }))));
}

// ---------------------------------------------------------------- the pool
if (!ONLY) {
  const feel = { enclosed: 0, mixed: 0, open: 0 }, seen = new Set(), PICKS = 4000;
  let misfit = 0;
  for (let s = 1; s <= PICKS; s++) {
    const cs = caseFor(s * 31, 8), id = FILL.pick({ seed: s, site: cs.site }), F = FILL.fillers[id];
    if (F.fits && !F.fits(FILL.makeSite(cs.site))) misfit++;
    feel[F.feel]++; seen.add(id);
  }
  check('the pool picks only fillers that fit the site', misfit === 0, misfit + ' misfits');
  check('every pool filler gets picked', seen.size === FILL.list().filter((F) => F.weight > 0).length, [...seen].join(', '));
  check('the pool leans enclosed', feel.enclosed > feel.mixed + feel.open && feel.open < feel.enclosed / 3,
    'enclosed ' + feel.enclosed + ', mixed ' + feel.mixed + ', open ' + feel.open + ' of ' + PICKS);
  const w = { enclosed: 0, mixed: 0, open: 0 };
  for (const F of FILL.list()) w[F.feel] += F.weight;
  check('pool weights are 70 / 20 / 10 enclosed / mixed / open', w.enclosed === 70 && w.mixed === 20 && w.open === 10, JSON.stringify(w));
}

// ---------------------------------------------------------------- speed
if (!ONLY) {
  let ms = 0, n = 0;
  for (let s = 1; s <= 200; s++) {
    const rng = new Rng(hash4(s, 0x7370, 0, 0)), site = { w: Math.round(rng.range(10, 24) * 2) / 2, h: Math.round(rng.range(10, 24) * 2) / 2 };
    const b = FILL.generate({ seed: s, site, connections: FILL.sampleConnections(site, rng.int(1, 4), s) });
    if (!b.error) { ms += b.meta.ms; n++; }
  }
  console.log('     avg ' + (ms / n).toFixed(2) + ' ms per filler on 10-24 m sites');
  check('fillers are fast (under 5 ms on average on 10-24 m sites)', ms / n < 5, (ms / n).toFixed(2) + ' ms');
}

console.log(failures ? '\n' + failures + ' check(s) failed' : '\nall checks passed');
process.exit(failures ? 1 : 0);
