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

// With the atrium retired, every band is an ordinary horizontal network.
for (const seed of [7,99,31337]) {
  const w = new BR.BandWorld(seed);
  for (const n of [-1,0,1]) {
    const c = w.cell(-1,0,n); tile(c);
    assert(!c.sites.some((s)=>s.kind==='transition'));
    const g = w.graph(-1,0,-1,0,[n]);
    same(g.issues,[]); same(g.unresolved,[]);
    assert.equal(components(g.nodes,g.edges).sizes.length,1);
    // templates keep their own floors (storeys, galleries, sunken floors) inside the band's envelope
    assert(g.navigation.nodes.some((s)=>s.floorZ===n*16));
    assert(g.navigation.nodes.every((s)=>s.floorZ>=n*16+BR.BAND_CFG.floorLimit&&s.ceilingZ<=n*16+BR.BAND_CFG.ceilingLimit));
  }
  const g = w.graph(-1,0,-1,0,[-1,0,1]);
  same(g.issues,[]); assert.equal(components(g.nodes,g.edges).sizes.length,3);
  assert(!g.navigation.edges.some((e)=>['ramp','ladder','stairs'].includes(e.kind)));
  assert.equal(w.transitionPlan,undefined); assert.equal(w.nearestTransition,undefined);
}
console.log('ok   horizontal band networks stay connected and separate, without atrium sites or routes');

// Canonical spatial export survives upper-first generation, tiny cell/build
// caches, whole-band eviction, remote exploration and reordered band input.
{
  const seed = 31337, a = new BR.BandWorld(seed), p = { i:-1, j:0 };
  const expected = a.exportRegion(p.i, p.j, p.i, p.j, [-1, 0, 1]);
  const b = new BR.BandWorld(seed, { limits: { cells: 2, builds: 2 }, elevationLimits: { bands: 1 } });
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
  console.log('ok   identical canonical export after reverse generation and eviction; all geometry fits planned 3D reservations');
}

// A corrupted height, clearance, side or missing endpoint cannot accidentally
// become a connection merely because two XY territories touch.
for (const fault of ['height', 'width', 'side', 'clearance', 'missing']) {
  const w = new BR.BandWorld(7), p = {i:0,j:0}, s = w.cell(0,0,0).sites.find((s) => w.spatial(s).filler?.portals.some((p)=>p.connection)), b = w.spatial(s).filler;
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
assert.equal(E.generate,undefined);
console.log('ok   invalid portal matching, region sizes and band indices rejected');
console.log('All band-world checks passed.');
