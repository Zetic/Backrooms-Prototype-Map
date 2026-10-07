// Real geometry, authoritative portal matches, and stateless world ownership.
const assert = require('node:assert/strict');
const { BR, components } = require('./helpers');
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

// Planning is pure, negative coordinates use floor division, and neighboring
// pair owners never compete for the same cell. Border doors stay uncut.
let planned = 0;
for (let seed = 0; seed < 100; seed++) {
  const w = new BR.BandWorld(seed);
  for (let n = -5; n < 5; n++) for (const ri of [-2, 0, 3]) for (const rj of [-1, 1]) {
    const p = w.transitionPlan(n, ri, rj), next = w.transitionPlan(n + 1, ri, rj);
    assert.notEqual(p.i, next.i);
    assert(p.i >= ri * 4 && p.i < ri * 4 + 4 && p.j >= rj * 4 && p.j < rj * 4 + 4);
    same(p, new BR.BandWorld(seed).transitionPlan(n, ri, rj));
    for (const k of [n, n + 1]) {
      const world = w.worldFor(k), cuts = p.split === 'h' ? [p.rect[1] - p.j * C, p.rect[3] - p.j * C] : [p.rect[0] - p.i * C, p.rect[2] - p.i * C];
      const borders = p.split === 'h' ? [BR.borderOpenings(world.seed, 'v', p.i, p.j), BR.borderOpenings(world.seed, 'v', p.i + 1, p.j)]
        : [BR.borderOpenings(world.seed, 'h', p.i, p.j), BR.borderOpenings(world.seed, 'h', p.i, p.j + 1)];
      assert(cuts.every((q) => borders.flat().every(([a, b]) => q <= a - 1 || q >= b + 1)));
    }
    planned++;
  }
}
console.log('ok   ' + planned + ' deterministic journey placements, both directions, negative regions and border clearance');

// Build and connect actual transition cells, not just an abstract site graph.
let journeys = 0, rooms = 0;
for (const seed of [7, 99, 31337]) {
  const w = new BR.BandWorld(seed);
  for (const n of [-2, -1, 0, 1, 2]) for (const ri of [-1, 0]) for (const rj of [-1, 0]) {
    const p = w.transitionPlan(n, ri, rj);
    for (const k of [n + 1, n]) { // destination requested first
      const c = w.cell(p.i, p.j, k); tile(c);
      const s = c.sites.find((s) => s.owner === p.id);
      assert(s && s.kind === 'transition' && s.conns.length === 1);
      same(s.bbox, p.rect);
      const b = w.build(s).filler;
      same(E.validate(b).errors, []);
      assert.equal(b.portals.filter((p) => p.connection).length, 1);
      assert.equal(b.surfaces.find((s) => s.room === 'stack').band, 'band:' + n);
      assert(b.surfaces.find((s) => s.room === 'stack').ceilingZ > (n + 1) * 16);
      assert(!b.portals.some((p) => p.room === 'stack'), 'occupying upper height does not create an upper portal');
      for (const poi of c.pois) assert(!BR.TG.roverlap(poi.bbox, p.rect));
      w.reservationPlan(p.i, p.j, n - 1, n + 2); // shared void and slab space included
    }
    const g = w.graph(p.i, p.j, p.i, p.j, [n + 1, n]);
    same(g.issues, []); same(g.unresolved, []);
    assert.equal(components(g.nodes, g.edges).sizes.length, 1);
    const entrance = p.id + '/s:entry', arrival = p.id + '/s:arrival';
    assert(walk(g, entrance).has(arrival)); assert(walk(g, arrival).has(entrance));
    assert.equal([...g.nodes].filter((v) => v.startsWith(p.id + '/')).length, w.transition(p).surfaces.length, 'shared journey surfaces are emitted once');
    assert(w.transition(p).rooms.some((r) => r.tags.includes('vertical-infill')), 'world selects the populated atrium');
    assert(g.dangling.every((id) => /\|[vh]/.test(id)), 'only cell borders leave this region');
    const one = w.graph(p.i, p.j, p.i, p.j, [n]);
    assert(one.verticalFrontier.some((v) => v.owner === p.id && v.band === 'band:' + (n + 1)));
    journeys++; rooms += g.nodes.size;
  }
}
console.log('ok   ' + journeys + ' real journeys connect ' + rooms + ' rooms; occupancy, shared ownership and frontiers are explicit');

// Complete three-band regions contain both up and down fills. Horizontal
// networks dominate, and every authoritative surface is reachable.
for (const [seed, ri, rj] of [[7, 0, 0], [99, -1, -1]]) {
  const w = new BR.BandWorld(seed), i0 = ri * 4, j0 = rj * 4;
  let horizontal = 0, transitionSlices = 0;
  for (const n of [-1, 0, 1]) for (let i = i0; i < i0 + 4; i++) for (let j = j0; j < j0 + 4; j++) {
    const c = w.cell(i, j, n); tile(c); horizontal += c.conns.length;
    transitionSlices += c.sites.filter((s) => s.kind === 'transition').length;
    for (const cn of c.conns.filter((c) => c.cross)) {
      const peer = w.cell(cn.peerCell[0], cn.peerCell[1], n).connById.get(cn.id);
      assert(peer); for (const k of ['o', 'c', 's0', 's1']) assert.equal(cn[k], peer[k]);
    }
  }
  assert.equal(transitionSlices, 6); assert(horizontal > 1000);
  const g = w.graph(i0, j0, i0 + 3, j0 + 3, [-1, 0, 1]);
  same(g.issues, []); same(g.unresolved, []);
  assert.equal(walk(g, [...g.nodes][0]).size, g.nodes.size);
  assert(g.navigation.nodes.some((n) => n.floorZ < 0) && g.navigation.nodes.some((n) => n.floorZ > 0));
  assert.equal(g.verticalFrontier.length, 2);
  console.log('ok   seed ' + seed + ': complete three-band region, ' + g.nodes.size + ' reachable rooms, ' + horizontal + ' horizontal connections');
}

// Canonical spatial export survives upper-first generation, tiny cell/build
// caches, whole-band eviction, remote exploration and reordered band input.
{
  const seed = 31337, a = new BR.BandWorld(seed), p = a.transitionPlan(0, -1, 0);
  const expected = a.exportRegion(p.i, p.j, p.i, p.j, [-1, 0, 1]);
  const b = new BR.BandWorld(seed, { limits: { cells: 2, builds: 2 }, elevationLimits: { bands: 1, transitions: 1, claims: 2 } });
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
  assert(b.worlds.size <= 1 && b.transitions.size <= 1 && b.claims.size <= 2);
  console.log('ok   identical canonical export after reverse generation and eviction; all geometry fits planned 3D reservations');
}

// A corrupted height, clearance, side or missing endpoint cannot accidentally
// become a connection merely because two XY territories touch.
for (const fault of ['height', 'width', 'side', 'clearance', 'missing']) {
  const w = new BR.BandWorld(7), p = w.transitionPlan(0, 0, 0), s = w.cell(p.i, p.j, 0).sites.find((s) => s.owner === p.id), b = w.build(s).filler;
  const portal = b.portals.find((p) => p.connection);
  if (fault === 'height') portal.floorZ += 0.5;
  if (fault === 'width') portal.width += 0.5;
  if (fault === 'side') portal.side = BR.TG.opposite(portal.side);
  if (fault === 'clearance') b.openings.find((o) => o.id === portal.opening).height = 1;
  if (fault === 'missing') delete portal.connection;
  assert(w.graph(p.i, p.j, p.i, p.j, [0, 1]).issues.length, fault);
}
assert.throws(() => new BR.BandWorld(7, { band: 0.5 }), /integer/);
assert.throws(() => new BR.BandWorld(7).exportRegion(0, 0, 8, 8, [0]), /64/);
same(E.validate(E.generate({ seed: 7, direction: 'down', rise: 16, site: { w: 56, h: 48 }, infill: true })).errors, []);
assert.throws(() => E.generate({ rise: 16 }), /too steep/);
console.log('ok   invalid portal matching, region sizes and slopes rejected; both-direction scaled fills remain physical');
console.log('All band-world checks passed.');
