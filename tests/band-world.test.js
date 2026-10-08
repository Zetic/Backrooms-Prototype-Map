// Real geometry, authoritative portal matches, and stateless world ownership.
const assert = require('node:assert/strict');
const { BR, components, MODE } = require('./helpers');
const C = BR.WORLD_CFG.cell, E = BR.ELEV;
const same = (a, b) => assert.deepEqual(a, b);
const inside = (r, q) => q[0] >= r[0] - 1e-7 && q[1] >= r[1] - 1e-7 && q[2] <= r[2] + 1e-7 && q[3] <= r[3] + 1e-7;
function walk(g, start) {
  const adj = new Map([...g.nodes].map((n) => [n, []]));
  for (const e of g.navigation.edges) {
    if (e.direction !== 'reverse') adj.get(e.from).push(e.to);
    if (e.direction !== 'forward') adj.get(e.to).push(e.from);
  }
  const seen = new Set([start]), todo = [start];
  while (todo.length) for (const v of adj.get(todo.pop())) if (!seen.has(v)) { seen.add(v); todo.push(v); }
  return seen;
}
function tile(c) {
  const own = new Uint8Array(C * C), x0 = c.i * C, y0 = c.j * C;
  for (const s of c.sites) for (const r of s.rects) {
    assert(r.every(Number.isInteger));
    assert(inside(c.rect, r));
    for (let y = r[1]; y < r[3]; y++) for (let x = r[0]; x < r[2]; x++) own[(y - y0) * C + x - x0]++;
  }
  assert(own.every((v) => v === 1), 'band ownership tiles the cell exactly');
}

// Every band is a horizontal network; a journey owns one territory in both
// bands of its pair (the same rectangle, a transition site in each).
const envelope = (node) => {
  const m = /^journey:(-?\d+):/.exec(node.owner), lower = m ? +m[1] : node.band === undefined ? 0 : +String(node.band).split(':')[1], upper = m ? lower + 1 : lower;
  return [lower * 16 + BR.BAND_CFG.floorLimit, upper * 16 + BR.BAND_CFG.ceilingLimit];
};
let met = 0;
for (const seed of MODE.size([31337], [7, 99, 31337])) {
  const w = new BR.BandWorld(seed), up = w.journeyPlan(0, -1, 0), down = w.journeyPlan(-1, -1, 0);
  // the cells holding the journeys up and down from band 0 of one region, in each of their bands
  for (const [p, n] of [[up, 0], [up, 1], [down, -1], [down, 0]]) {
    const c = w.cell(p.i, p.j, n); tile(c);
    const ts = c.sites.filter((s) => s.kind === 'transition');
    assert(ts.some((s) => s.owner === p.id));
    for (const s of ts) {
      const q = s.transition; met++;
      same(s.rects, [q.rect]); assert.equal(s.owner, q.id); assert(n === q.lower || n === q.upper);
      assert.equal(w.fillerOf(s), 'journey');
      // the world's connections to it are exactly the doors its plan gave that band
      const plan = BR.JOURNEY.plan({ seed: q.seed, w: q.rect[2] - q.rect[0], h: q.rect[3] - q.rect[1] })[n === q.lower ? 'low' : 'high'], key = (c) => [c.side, c.at, c.width, c.line].join();
      same(w.build(s).conns.map(key).sort(), plan.map(key).sort());
    }
    const g = w.graph(p.i, p.j, p.i, p.j, [n]);
    same(g.issues,[]); same(g.unresolved,[]);
    assert.equal(components(g.nodes,g.edges).sizes.length,1);
    // templates keep their own floors (storeys, galleries, sunken floors) inside the band's
    // envelope; a journey's floors stay inside the envelope of its two bands
    assert(g.navigation.nodes.some((s)=>s.floorZ===n*16));
    for (const s of g.navigation.nodes) { const [lo, hi] = envelope(s); assert(s.floorZ >= lo - 1e-7 && s.ceilingZ <= hi + 1e-7, s.id); }
  }
}
assert(met >= 4 * MODE.size(1, 3), 'every seed met its journeys');
console.log('ok   every band cell tiles exactly and is one network; journey sites own the same rectangle in both of their bands');

// Journeys join the bands: two neighbouring cells of a region, holding the
// journey from band -1 and the journey from band 0, make one network over
// three bands, and you can walk from the bottom to the top and back.
for (const seed of MODE.size([31337], [7, 31337])) {
  const w = new BR.BandWorld(seed);
  const pairs = [];
  for (let ri = -2; ri <= 2; ri++) for (let rj = -2; rj <= 2; rj++) {
    const a = w.journeyPlan(-1, ri, rj), b = w.journeyPlan(0, ri, rj);
    if (!a || !b) continue;
    // a band's journey down and its journey up never share ground: they use opposite halves of the region
    assert(!BR.TG.roverlap(a.rect, b.rect)); assert.notEqual(Math.floor(a.i / 2), Math.floor(b.i / 2));
    pairs.push({ a, b, n: (Math.abs(a.i - b.i) + 1) * (Math.abs(a.j - b.j) + 1) });
  }
  const best = pairs.filter((q) => q.n <= 2).find((q) => w.journey(q.a) && w.journey(q.b));
  assert(best, 'some region puts its two journeys in neighbouring cells');
  const { a, b } = best, i0 = Math.min(a.i, b.i), i1 = Math.max(a.i, b.i), j0 = Math.min(a.j, b.j), j1 = Math.max(a.j, b.j);
  const g = w.graph(i0, j0, i1, j1, [-1, 0, 1]);
  same(g.issues, []); same(g.unresolved, []);
  assert.equal(components(g.nodes, g.edges).sizes.length, 1, 'three bands, one network');
  // each journey's own climbs are navigation edges (not just some template's stairs)
  for (const p of [a, b]) {
    const climbs = g.navigation.edges.filter((e) => e.connector && e.connector.startsWith(p.id + '/k'));
    assert(climbs.length >= 4 && climbs.every((e) => ['ladder', 'stair', 'ramp'].includes(e.kind)), p.id + ' climbs');
  }
  const bottom = g.navigation.nodes.find((s) => s.floorZ === -16 && !s.owner.startsWith('journey:')), top = g.navigation.nodes.find((s) => s.floorZ === 16 && !s.owner.startsWith('journey:'));
  assert(walk(g, bottom.id).has(top.id) && walk(g, top.id).has(bottom.id), 'band -1 to band +1 and back');
  // each band binds only the doors at its own floor: none left over, none shared
  for (const p of [a, b]) for (const n of [p.lower, p.upper]) {
    const s = w.cell(p.i, p.j, n).sites.find((s) => s.owner === p.id), r = w.spatial(s);
    const bound = r.filler.portals.filter((q) => q.connection);
    assert(bound.length && bound.every((q) => q.floorZ === n * 16 && q.band === 'band:' + n));
    same(bound.map((q) => q.connection).sort(), s.conns.slice().sort());
  }
}
console.log('ok   journeys join neighbouring bands into one walkable network; each band binds only its own doors');

// The plan is a function of (seed, region, band pair): fresh worlds agree,
// whatever was asked first, and a journey's slice in one band does not need
// the other band to have been planned.
{
  const a = new BR.BandWorld(99), b = new BR.BandWorld(99, { elevationLimits: { bands: 1, journeys: 1, claims: 1 } });
  for (const lower of [-3, -1, 0, 2]) for (const [ri, rj] of [[0, 0], [-1, 2], [3, -4]]) {
    const p = a.journeyPlan(lower, ri, rj);
    same(p, b.journeyPlan(lower, ri, rj));
    if (!p) continue;
    assert(BR.TG.rcontains([p.i * C + 8, p.j * C + 8, p.i * C + C - 8, p.j * C + C - 8], p.rect));
    assert.equal(Math.floor(p.i / 4), ri); assert.equal(Math.floor(p.j / 4), rj);
  }
  const p = a.journeyPlan(0, -1, 0); assert(p && a.journey(p));
  const strip = (r) => JSON.parse(JSON.stringify({ ...r, site: r.site.id, ms: 0, conns: r.conns.map((c) => c.id) }));
  const upFirst = strip(b.spatial(b.cell(p.i, p.j, 1).sites.find((s) => s.owner === p.id)));
  for (const n of [5, -5]) b.cell(p.i + 9, p.j, n);
  const downAfter = strip(b.spatial(b.cell(p.i, p.j, 0).sites.find((s) => s.owner === p.id)));
  same(upFirst, strip(a.spatial(a.cell(p.i, p.j, 1).sites.find((s) => s.owner === p.id))));
  same(downAfter, strip(a.spatial(a.cell(p.i, p.j, 0).sites.find((s) => s.owner === p.id))));
  assert(b.journeys.size <= 1 && b.claims.size <= 1 && b.worlds.size <= 1);
  const near = a.nearestJourney('up', (p.rect[0] + p.rect[2]) / 2, (p.rect[1] + p.rect[3]) / 2);
  assert.equal(near.id, p.id);
  a.setBand(1); assert.equal(a.nearestJourney('down', (p.rect[0] + p.rect[2]) / 2, (p.rect[1] + p.rect[3]) / 2).id, p.id);
  assert.throws(() => a.nearestJourney('sideways', 0, 0), /up or down/);
}
console.log('ok   journey plans and slices are the same in fresh and evicting worlds, whichever band is asked first');

// Planning a cell never builds a journey: its doors are part of the plan. A
// journey that cannot be built leaves an ordinary filler behind the same
// doors in each band, and the bands simply stay apart there.
{
  const w = new BR.BandWorld(31337), p = w.journeyPlan(0, -1, 0);
  for (const n of [0, 1]) w.cell(p.i, p.j, n);
  assert.equal(w.journeys.size, 0, 'cell plans need no journey built');
  const real = new BR.BandWorld(31337), doorsOf = (W, n) => W.cell(p.i, p.j, n).sites.find((s) => s.owner === p.id).lots[0].doors;
  const generate = BR.JOURNEY.generate;
  BR.JOURNEY.generate = () => { throw new Error('no journey fits'); };
  try {
    const f = new BR.BandWorld(31337);
    assert.equal(f.journey(p), null); assert.equal(f.nearestJourney('up', (p.rect[0] + p.rect[2]) / 2, (p.rect[1] + p.rect[3]) / 2), null, 'a journey that cannot be built is not found');
    for (const n of [0, 1]) {
      same(doorsOf(f, n), doorsOf(real, n));
      const s = f.cell(p.i, p.j, n).sites.find((s) => s.owner === p.id), b = f.spatial(s).filler;
      assert.notEqual(b.kind, 'journey'); assert.equal(b.fillId, p.id + '@band:' + n);
      assert(b.surfaces.every((v) => v.floorZ >= n * 16 + BR.BAND_CFG.floorLimit && v.ceilingZ <= n * 16 + BR.BAND_CFG.ceilingLimit));
      same(b.portals.filter((q) => q.connection).map((q) => q.connection).sort(), s.conns.slice().sort());
    }
    const g = f.graph(p.i, p.j, p.i, p.j, [0, 1]);
    same(g.issues, []); assert.equal(components(g.nodes, g.edges).sizes.length, 2, 'no journey: the bands stay apart');
    const x = f.exportRegion(p.i, p.j, p.i, p.j, [0, 1]);
    same(x.journeys, []); assert(x.layouts.some((l) => l.owner === p.id + '@band:0') && x.layouts.some((l) => l.owner === p.id + '@band:1'));
  } finally { BR.JOURNEY.generate = generate; }
}
console.log('ok   cell plans build no journey; one that cannot be built leaves a stand-in filler behind the same doors');

// Canonical spatial export survives upper-first generation, tiny cell/build
// caches, whole-band eviction, remote exploration and reordered band input.
{
  const seed = 31337, a = new BR.BandWorld(seed), plan = a.journeyPlan(0, -1, 0), p = { i: plan.i, j: plan.j };
  const expected = a.exportRegion(p.i, p.j, p.i, p.j, [-1, 0, 1]);
  assert(expected.journeys.some((j) => j.id === plan.id), 'the region holds a journey');
  assert.equal(expected.policy.verticalJourneys, 'composed');
  const b = new BR.BandWorld(seed, { limits: { cells: 2, builds: 2 }, elevationLimits: { bands: 1, journeys: 1, claims: 1 } });
  for (const n of [1, 0, -1]) for (const s of b.cell(p.i, p.j, n).sites.slice().reverse()) b.build(s);
  for (const n of [8, -8, 3]) for (const s of b.cell(20 + n, -30, n).sites.slice(0, 4)) b.build(s);
  const actual = b.exportRegion(p.i, p.j, p.i, p.j, [1, -1, 0]);
  same(actual, expected);
  same(actual.issues, []);
  const nodes = new Set(actual.navigation.nodes.map((n) => n.id));
  for (const e of actual.navigation.edges) assert(nodes.has(e.from) && nodes.has(e.to));
  for (const item of actual.layouts) {
    for (const direction of ['up', 'down']) assert(!item.blueprint.capabilities[direction].deferred && item.blueprint.capabilities[direction].candidates.length, item.owner + ': export has physical vertical potential');
    const r = actual.reservations.find((r) => r.owner === item.reservationOwner); assert(r);
    for (const v of item.blueprint.volumes) for (const q of v.rects) {
      const world = [q[0] + item.origin[0], q[1] + item.origin[1], q[2] + item.origin[0], q[3] + item.origin[1]];
      assert(r.volumes.some((e) => {
        let remainder = [world];
        for (const rect of e.rects) remainder = remainder.flatMap((q) => BR.TG.rsub(q, rect));
        return e.z0 <= v.z0 + 1e-7 && e.z1 >= v.z1 - 1e-7 && !remainder.length;
      }), item.owner + ': geometry fits reservation');
    }
  }
  assert(b.worlds.size <= 1);
  // a journey whose other band is outside the export leaves its doors there as a vertical frontier
  const one = a.exportRegion(p.i, p.j, p.i, p.j, [0]), up = one.verticalFrontier.filter((f) => f.owner === plan.id);
  assert(up.length && up.every((f) => f.band === 'band:1' && f.state === 'outside-region' && f.at[2] === 16));
  console.log('ok   identical canonical export after reverse generation and eviction; all geometry fits planned 3D reservations; a journey cut by the export leaves a vertical frontier');
}

// A corrupted height, clearance, side or missing endpoint cannot accidentally
// become a connection merely because two XY territories touch.
// (one world: each fault is made on its cached blueprint, checked, and undone;
// the graph is worked out afresh from the blueprints on every call)
{
  const w = new BR.BandWorld(7), p = {i:0,j:0}, s = w.cell(0,0,0).sites.find((s) => w.spatial(s).filler?.portals.some((p)=>p.connection)), b = w.spatial(s).filler;
  const portal = b.portals.find((p) => p.connection), opening = b.openings.find((o) => o.id === portal.opening), keep = { ...portal }, height = opening.height;
  same(w.graph(p.i, p.j, p.i, p.j, [0, 1]).issues, []);
  for (const fault of ['height', 'width', 'side', 'clearance', 'missing']) {
    if (fault === 'height') portal.floorZ += 0.5;
    if (fault === 'width') portal.width += 0.5;
    if (fault === 'side') portal.side = BR.TG.opposite(portal.side);
    if (fault === 'clearance') opening.height = 1;
    if (fault === 'missing') delete portal.connection;
    assert(w.graph(p.i, p.j, p.i, p.j, [0, 1]).issues.length, fault);
    Object.assign(portal, keep); if (height === undefined) delete opening.height; else opening.height = height;
    same(w.graph(p.i, p.j, p.i, p.j, [0, 1]).issues, [], 'undone: ' + fault);
  }
}
assert.throws(() => new BR.BandWorld(7, { band: 0.5 }), /integer/);
assert.throws(() => new BR.BandWorld(7).exportRegion(0, 0, 8, 8, [0]), /64/);
assert.equal(E.generate,undefined);
console.log('ok   invalid portal matching, region sizes and band indices rejected');
console.log('All band-world checks passed.');
