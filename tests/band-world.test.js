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

// Layered ownership (milestone 5) and the first growth (step 2): a column of
// the world holds several claims, stacked. A branch of house rooms stands over
// whole ground sites beside a two-storey house, entered from its stairwell
// carried on up (its pillar), with a pit drilled from it into the ground below.
const KNOWN = { seed: 7, i: 3, j: -2 };            // band 0: a two-storey house, a branch of 4 sites and a pit
{
  const w = new BR.BandWorld(KNOWN.seed), i = KNOWN.i, j = KNOWN.j, B = w.branch(0, i, j);
  assert(B, 'the known cell has a branch');
  assert.equal(B.floorZ, 6.5); assert(B.sites.length >= 2 && B.sites.length <= 4);
  assert.equal(B.archetype, 'two_storey'); assert.equal(B.biome, 'houseroom');
  assert.equal(w.cell(i, j, 0).sites.find((s) => s.id === B.anchor).kind, 'lot', 'its anchor is a house on its own lot');
  // the ground plan is identical with and without it
  // (the world without claims is built with claims switched off; the world with
  // them after they are back on, so its builds really have the branch over them)
  const groundPlan = (W) => JSON.stringify(W.cell(i, j, 0).sites.map((s) => [s.id, s.kind, s.rects, s.conns, s.pois.map((P) => P.id)]));
  const built = (W, s) => { const r = W.build(s), f = r.filler; return JSON.stringify([f && f.filler, f && f.rooms.map((q) => [q.id, q.rects, q.level || 0, q.floor || 0]), r.buildings.map((x) => [x.poi.id, x.b.footprint[0].rects])]); };
  const CLAIM = BR.CLAIM, without = {};
  let bareGround;
  BR.CLAIM = null;
  try {
    const bare = new BR.BandWorld(KNOWN.seed);
    assert.equal(bare.branch(0, i, j), null, 'without claims there is no branch');
    bareGround = groundPlan(bare);
    for (const s of bare.cell(i, j, 0).sites) without[s.id] = built(bare, s);
  } finally { BR.CLAIM = CLAIM; }
  assert(BR.CLAIM && BR.CLAIM.raiseStair, 'claims are back');
  const plain = new BR.BandWorld(KNOWN.seed);
  assert(plain.branch(0, i, j), 'and with them the branch');
  same(groundPlan(plain), bareGround);
  for (const s of plain.cell(i, j, 0).sites) assert.equal(built(plain, s), without[s.id], s.id + ': the floors below a claim are the same with and without it');
  // only the ceilings under the branch change: capped under its slab
  for (const id of B.over) assert(plain.build(plain.site(id)).filler.rooms.every((r) => (r.ceiling || 2.5) <= B.z - E.SLAB + 1e-7), id + ' is capped');

  // no two claims in the column overlap in 3D, and the slab between them is the branch's floor
  const res = w.reservationPlan(i, j, 0, 0), index = new E.ReservationIndex();
  for (const r of res) assert(index.reserve(r.owner, r.volumes).ok, r.owner + ' overlaps another claim');
  const over = new Map(B.caps.map((c) => [c.site, c.cap]));
  for (const rs of B.sites) {
    const mine = res.find((r) => r.owner === rs.owner), below = res.find((r) => r.owner === rs.over);
    assert(mine && below, rs.id + ' and the ground under it are both owned');
    assert.equal(below.volumes[0].z1, over.get(rs.over), 'the ground claim stops at the cap');
    assert.equal(mine.volumes[0].z0, rs.floorZ - E.SLAB, 'the claim above starts at its own floor slab');
    assert.equal(mine.volumes[0].z0, below.volumes[0].z1, 'one slab between them, no gap and no overlap');
    assert.equal(mine.volumes[0].z1, BR.BAND_CFG.ceilingLimit, 'and it owns the rest of the column');
    same(mine.volumes[0].rects, below.volumes[0].rects);
    // the ground site keeps its floor and every room under the cap
    const b = w.spatial(w.site(rs.over)).filler;
    assert(b.surfaces.every((s) => s.floorZ === 0 || s.floorZ > BR.BAND_CFG.floorLimit - 1e-7), rs.over + ' kept its floor');
    assert(b.surfaces.every((s) => s.ceilingZ <= over.get(rs.over) + 1e-7), rs.over + ' keeps under its cap');
  }
  // an unclaimed site still owns its whole band envelope
  const free = w.cell(i, j, 0).sites.find((s) => s.kind === 'filler' && !B.over.includes(s.id));
  assert.equal(w.ceilingOf(free), BR.BAND_CFG.ceilingLimit);

  // the landing: the house's own stair carried on up, and a door into the branch
  const host = w.spatial(w.site(B.anchor)), house = host.buildings.find((x) => x.poi.id === B.poi);
  const landing = house.b.rooms.find((r) => r.id === B.landing.room);
  assert(landing && landing.floorZ === B.floorZ, 'the landing stands at the branch floor');
  assert(house.b.connectors.some((c) => c.to === 's:' + landing.id), 'the house own stair climbs to it');
  assert.equal(house.conns[B.landing.portal], B.landing.connection, 'its door is the branch connection');
  const g = w.graph(i, j, i, j, [0]);
  same(g.issues, []); same(g.unresolved, []);
  assert.equal(components(g.nodes, g.edges).sizes.length, 1, 'the branch is part of the cell network, not a second one');
  const at = (z) => g.navigation.nodes.filter((s) => s.floorZ === z);
  assert(at(B.floorZ).length > 4 && at(0).length > 4, 'floors at both heights');
  // you can walk from the ground up into the branch and back down again, to every raised floor and every room in it
  const ground = at(0).find((s) => !s.owner.startsWith('journey:')), raised = at(B.floorZ).filter((s) => s.owner.startsWith(B.id + ':'));
  assert(raised.length && raised.every((r) => walk(g, ground.id).has(r.id) && walk(g, r.id).has(ground.id)), 'up into every room of the branch and back');
  assert(raised.some((r) => r.owner.includes('/')), 'house rooms stand in it');

  // the pit: one way down, from the branch into the ground site below
  assert(B.pit, 'the branch has a pit');
  assert.equal(g.pits.length, 1);
  const pit = g.pits[0];
  assert(pit.fall >= 3, 'a pit is a drop');
  const down = g.navigation.edges.filter((e) => e.kind === 'pit');
  assert.equal(down.length, 1); assert.equal(down[0].direction, 'forward');
  assert(!g.edges.some((e) => e.includes(pit.from) && e.includes(pit.to)), 'a pit is never a two-way edge');
  // its two halves agree, and each blueprint cuts its own side
  const top = w.raisedBuild(B.sites.find((rs) => rs.id === B.pit.top.site)).filler, low = w.spatial(w.site(B.pit.bottom.site)).filler;
  for (const [b, role, face] of [[top, 'top', 'floor'], [low, 'bottom', 'ceiling']]) {
    const d = b.drops.filter((x) => x.id === B.pit.id);
    assert.equal(d.length, 1, role + ' names the pit once');
    assert.equal(d[0].role, role);
    assert(b.holes.some((h) => h.connector === B.pit.id && h.face === face), role + ' cuts its ' + face);
    same(E.validate(b).errors.filter((e) => !/^no physical/.test(e)), []);
  }
  assert(low.voids.some((v) => v.id === 'void:' + B.pit.id), 'the lower claim keeps the shaft clear');
}
console.log('ok   a column holds stacked claims: a raised branch over capped ground sites, its landing, and a one-way pit back down');

// The branch is a function of (seed, band, cell): fresh worlds agree, caches
// may be evicted, and the export says the same thing in any order.
{
  const i = KNOWN.i, j = KNOWN.j, a = new BR.BandWorld(KNOWN.seed), B = a.branch(0, i, j);
  const expected = a.exportRegion(i, j, i, j, [0]);
  assert.equal(expected.schema, 'br.world-elevation/0.2');
  assert.equal(expected.policy.layeredOwnership, 'stacked-claims');
  assert.equal(expected.policy.raisedBranches, 'house-pillars');
  same(expected.policy.growth.biomes, ['houseroom']);
  assert.equal(expected.pits.length, 1);
  const slice = expected.slices[0];
  assert.equal(slice.raised.length, B.sites.length);
  for (const rs of slice.raised) {
    assert.equal(rs.floorZ, B.floorZ); assert.equal(rs.biome, 'houseroom');
    const under = slice.sites.find((s) => s.id === rs.over);
    assert(under && under.ceilingZ === rs.floorZ - E.SLAB, 'every slice says where one claim stops and the next begins');
    assert(expected.layouts.some((l) => l.reservationOwner === rs.owner && l.owner === rs.owner), 'a raised floor is a layout of its own');
  }
  // every raised floor's geometry fits the claim it was given
  for (const item of expected.layouts) {
    const r = expected.reservations.find((q) => q.owner === item.reservationOwner);
    assert(r, item.owner + ' has a claim');
    for (const v of item.blueprint.volumes) for (const q of v.rects) {
      const world = [q[0] + item.origin[0], q[1] + item.origin[1], q[2] + item.origin[0], q[3] + item.origin[1]];
      assert(r.volumes.some((e) => {
        let remainder = [world];
        for (const rect of e.rects) remainder = remainder.flatMap((p) => BR.TG.rsub(p, rect));
        return e.z0 <= v.z0 + 1e-7 && e.z1 >= v.z1 - 1e-7 && !remainder.length;
      }), item.owner + ': ' + v.id + ' fits its claim');
    }
  }
  // every room standing in the branch is a layout of its own, owned by its raised floor's claim
  for (const rs of B.sites) for (const x of rs.buildings) assert(expected.layouts.some((l) => l.owner === rs.owner + '/' + x.poi.id && l.reservationOwner === rs.owner), rs.id + '/' + x.poi.id + ' exported');
  const b = new BR.BandWorld(KNOWN.seed, { limits: { cells: 2, builds: 2 }, elevationLimits: { bands: 1, journeys: 1, claims: 1, branches: 1, raised: 1 } });
  // asked for in another order, with everything evicted in between
  for (const rs of b.raisedSites(0, i, j)) b.raisedBuild(rs);
  for (const s of b.cell(i, j, 0).sites.slice().reverse()) b.build(s);
  for (const n of [4, -4]) for (const s of b.cell(i + 7, j - 5, n).sites.slice(0, 3)) b.build(s);
  same(b.exportRegion(i, j, i, j, [0]), expected);
  const strip = (B) => JSON.parse(JSON.stringify(B, (k, v) => (k === 'ms' ? undefined : v)));   // (build times are diagnostics, not plan)
  same(strip(b.branch(0, i, j)), strip(a.branch(0, i, j)));
  assert(b.branches.size <= 1 && b.raisedBuilds.size <= 1, 'branch caches stay bounded');
}
console.log('ok   branches, their pits and their exports are the same in fresh and evicting worlds, in any order');

// Every branch anywhere obeys the same rules: it grows from a house that
// seeds growth, over whole plain sites joined edge to edge, from its biome's
// pool only, rooms densest beside the pillar, and only a share of the houses
// that could seed one do.
{
  let seen = 0, pits = 0, eligible = 0, rooms = [0, 0], sites = [0, 0];
  const pool = new Set(BR.BIOME.templates('houseroom').map((a) => a.id)), fillers = new Set(BR.BIOME.fillers('houseroom').map((F) => F.id));
  for (const seed of MODE.size([7], [31337, 7, 12345, 4242])) {
    const w = new BR.BandWorld(seed);
    for (let i = -3; i <= 2; i++) for (let j = -3; j <= 2; j++) {
      const cell = w.cell(i, j, 0);
      eligible += cell.lots.filter((L) => L.kind === 'yard' && BR.BIOME.anchorOf(BR.TPL.archetypes[L.pois[0].archetype]) && BR.CLAIM.stairTop(L.b)).length;
      const B = w.branch(0, i, j);
      if (!B) continue;
      seen++;
      if (B.pit) pits++;
      assert(BR.BIOME.anchorOf(BR.TPL.archetypes[B.archetype]) === B.biome, B.id + ' grows from a house that seeds its biome');
      assert(B.z >= 3.3 + 3 - 1e-7 && B.z <= BR.BAND_CFG.ceilingLimit - 3 + 1e-7 && Math.abs(B.z * 2 - Math.round(B.z * 2)) < 1e-7, B.id + ': its pillar climbs a flight, on the half metre');
      assert(B.sites.length >= 1 && B.sites.length <= 4 && B.sites.reduce((a, rs) => a + rs.area, 0) <= BR.BAND_CFG.branch.area);
      tile(cell);                                  // the ground still tiles its cell exactly
      for (const rs of B.sites) {
        const under = cell.sites.find((s) => s.id === rs.over);
        assert(under && under.kind === 'filler' && !under.pois.length, rs.id + ' stands over a plain filler site');
        same(rs.rects, under.rects);                // whole sites, never part of one
        // grown edge to edge from the site the landing opens onto
        if (rs.parent >= 0) { const up = B.sites.find((x) => x.k === rs.parent); assert(up && up.hop === rs.hop - 1 && rs.conns.some((cn) => cn.a === up.id || cn.b === up.id), rs.id + ' joins the site it grew from'); }
        else assert(rs.k === 0 && rs.hop === 0);
        const r = w.raisedBuild(rs), b = r.filler;
        assert(fillers.has(b.filler), rs.id + ': a ' + b.filler + ' is not a houseroom filler');
        const kinds = r.buildings.map((x) => x.poi.archetype);
        assert(kinds.every((a) => pool.has(a)) && new Set(kinds).size === kinds.length, rs.id + ': rooms from the pool, none twice: ' + kinds);
        rooms[rs.hop ? 1 : 0] += kinds.length; sites[rs.hop ? 1 : 0]++;
        for (const x of [b].concat(r.buildings.map((y) => y.b)))
          assert(x.surfaces.every((s) => s.floorZ >= rs.floorZ - 1e-7 && s.ceilingZ <= BR.BAND_CFG.ceilingLimit + 1e-7), rs.id + ' keeps inside its claim');
        assert(rs.conns.length && rs.conns.every((cn) => b.portals.some((p) => p.connection === cn.id)), rs.id + ' built every connection it was given');
      }
      const g = w.graph(i, j, i, j, [0]);
      same(g.issues, []);
      assert.equal(components(g.nodes, g.edges).sizes.length, 1, seed + ' ' + i + ',' + j + ': one network');
      for (const p of g.pits) assert(p.fall >= 3 && p.from !== p.to);
      w.exportRegion(i, j, i, j, [0]);             // throws on any invalid connection
    }
  }
  assert(seen >= MODE.size(3, 8), 'branches were found: ' + seen);
  assert(pits >= 1, 'and pits drilled: ' + pits);
  assert(seen < eligible, 'not every house that could seed growth grew a branch: ' + seen + ' of ' + eligible);
  assert(rooms[0] / sites[0] > rooms[1] / Math.max(1, sites[1]), 'rooms are densest beside the pillar: ' + (rooms[0] / sites[0]).toFixed(1) + ' against ' + (rooms[1] / Math.max(1, sites[1])).toFixed(1));
  console.log('ok   every branch grows from a seeding house over whole plain sites, from its biome only, densest by its pillar, inside its claim, one network (' + seen + ' branches of ' + eligible + ' possible, ' + pits + ' with a pit)');
}
// A share of the houses that could seed growth do; a branch only ever grows
// from one that does. And a raised floor that cannot be built is dropped with
// everything grown from it, the rest wired and built again.
{
  let yes = 0, no = 0;
  for (const seed of [7, 31337, 99]) {
    const w = new BR.BandWorld(seed);
    for (let i = -4; i <= 3; i++) for (let j = -4; j <= 3; j++) {
      for (const L of w.cell(i, j, 0).lots.filter((x) => x.kind === 'yard' && BR.BIOME.anchorOf(BR.TPL.archetypes[x.pois[0].archetype]))) w.seedsGrowth(0, i, j, L.pois[0]) ? yes++ : no++;
    }
    for (let i = -2; i <= 1; i++) for (let j = -2; j <= 1; j++) {
      const B = w.branch(0, i, j);
      if (B) assert(w.seedsGrowth(0, i, j, w.cell(i, j, 0).lots.flatMap((L) => L.pois).find((P) => P.id === B.poi)), B.id + ' grew from a house that seeds');
    }
  }
  assert(yes > 0 && no > 0 && yes > no, 'some seed, some do not: ' + yes + ' and ' + no);
  assert.equal(new BR.BandWorld(7).seedsGrowth(0, 0, 0, { id: 'x', archetype: 'ranch' }), false, 'a house with no stair of its own never seeds');

  const w = new BR.BandWorld(KNOWN.seed), full = w.branch(0, KNOWN.i, KNOWN.j);
  const victim = full.sites.find((rs) => rs.k > 0 && full.sites.some((c) => c.parent === rs.k)) || full.sites.find((rs) => rs.k > 0);
  const lost = new Set([victim.k]);
  for (const rs of full.sites) if (lost.has(rs.parent)) lost.add(rs.k);
  const f = new BR.BandWorld(KNOWN.seed), real = f.raisedSite.bind(f);
  f.raisedSite = (rs) => (rs.k === victim.k ? null : real(rs));
  const B = f.branch(0, KNOWN.i, KNOWN.j);
  same(B.sites.map((rs) => rs.k), full.sites.filter((rs) => !lost.has(rs.k)).map((rs) => rs.k), 'the failed floor and its subtree are gone, the rest stand');
  same(B.over, B.sites.map((rs) => rs.over)); same(B.caps.map((c) => c.site), B.over);
  for (const cn of B.conns) assert(B.sites.some((rs) => cn.a === rs.id || cn.b === rs.id), cn.id + ' joins a floor that stands');
  for (const rs of B.sites) assert(rs.conns.every((cn) => B.conns.includes(cn)) && rs.conns.every((cn) => rs.b.portals.some((p) => p.connection === cn.id)), rs.id + ' builds exactly its doors');
  const g = f.graph(KNOWN.i, KNOWN.j, KNOWN.i, KNOWN.j, [0]);
  same(g.issues, []); assert.equal(components(g.nodes, g.edges).sizes.length, 1);
  console.log('ok   a share of the houses that could seed growth do (' + yes + ' of ' + (yes + no) + '); a raised floor that cannot be built goes with its subtree, the rest rewired');
}
console.log('All band-world checks passed.');
